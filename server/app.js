import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { matchRoute, previewHtml, workSource } from './routes.js';
import { readSession } from './auth.js';
import { AppError, MIME, clientIp, parseCookies, serializeCookie } from './util.js';

const MAX_BODY = 1024 * 1024;
const UPLOAD_BODY = 3 * 1024 * 1024;

/* ---------------- 安全响应头 ---------------- */
const PAGE_CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "frame-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const PREVIEW_CSP = [
  'sandbox allow-scripts allow-forms allow-modals allow-popups',
  "default-src 'none'",
  'img-src * data: blob:',
  'media-src * data: blob:',
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  'font-src data:',
  "connect-src 'none'",
  "frame-ancestors 'self'",
].join('; ');

function securityHeaders(res, { html = false } = {}) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (html) {
    res.setHeader('Content-Security-Policy', PAGE_CSP);
    res.setHeader('X-Frame-Options', 'DENY');
  }
}

/* ---------------- 限流 ---------------- */
const buckets = new Map();
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count++;
  if (b.count > limit) {
    const retry = Math.ceil((b.resetAt - now) / 1000);
    const err = new AppError(429, 'E_RATE_LIMITED', `请求过于频繁，请 ${retry} 秒后再试`);
    err.retryAfter = retry;
    throw err;
  }
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  }
}

const loginFails = new Map();
function noteLoginFail(ip) {
  const now = Date.now();
  const rec = loginFails.get(ip) || { count: 0, until: now + 15 * 60 * 1000 };
  if (rec.until <= now) { rec.count = 0; rec.until = now + 15 * 60 * 1000; }
  rec.count++;
  loginFails.set(ip, rec);
  return rec;
}

/* ---------------- 工具 ---------------- */
function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function sendEmpty(res, status, headers = {}) {
  res.writeHead(status, headers);
  res.end();
}

async function readBody(req, limit = MAX_BODY) {
  const type = String(req.headers['content-type'] || '');
  const len = Number(req.headers['content-length'] || 0);
  if (!type && (req.method === 'DELETE' || len === 0)) return {};
  if (!/^application\/json\b/i.test(type)) {
    throw new AppError(415, 'E_UNSUPPORTED_MEDIA_TYPE', '请求必须是 application/json');
  }
  if (len > limit) throw new AppError(413, 'E_TOO_LARGE', '请求体过大');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new AppError(413, 'E_TOO_LARGE', '请求体过大');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError(400, 'E_VALIDATION', 'JSON 解析失败');
  }
}

/**
 * 允许的来源：PUBLIC_ORIGIN 支持逗号分隔多值（本地 + 域名并行、带/不带 www 等）。
 * 都没配时退回请求自身的 proto://host。
 */
function allowedOrigins(req) {
  const list = String(config.publicOrigin || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (list.length) return list;
  const host = req.headers.host || `localhost:${config.port}`;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0] || (config.cookieSecure ? 'https' : 'http');
  return [`${proto}://${host}`];
}

/**
 * 开发期把 localhost 与 127.0.0.1 视为同一个源：
 * 同一台机器、同一个端口，只是名字不同，没必要因此拦住登录。
 * 生产环境要求精确匹配，不放宽。
 */
function sameLoopbackHost(a, b) {
  if (config.isProd) return false;
  const norm = (u) => String(u).replace('://localhost', '://127.0.0.1');
  return norm(a) === norm(b);
}

function checkCsrf(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  if (req.headers['x-csrf'] !== '1') throw new AppError(403, 'E_CSRF', '缺少请求校验头');
  const site = String(req.headers['sec-fetch-site'] || '');
  if (site && site !== 'same-origin' && site !== 'none') {
    throw new AppError(403, 'E_CSRF', '跨站请求被拒绝');
  }
  const origin = req.headers.origin;
  if (origin) {
    const allowed = allowedOrigins(req);
    const ok = allowed.includes(origin) || sameLoopbackHost(allowed[0], origin);
    if (!ok) throw new AppError(403, 'E_CSRF', '来源校验失败');
  }
}

/* ---------------- 静态文件 ---------------- */
async function serveStatic(req, res, pathname) {
  let rel = pathname;
  try { rel = decodeURIComponent(pathname); } catch { /* keep raw */ }
  if (rel.endsWith('/')) rel += 'index.html';
  let file = path.join(config.publicDir, path.normalize(rel));
  if (!file.startsWith(config.publicDir)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  let stat = null;
  try { stat = await fsp.stat(file); } catch { /* not found */ }

  if ((!stat || !stat.isFile()) && !path.extname(rel)) {
    // /stage → /stage/index.html（目录 stat 会成功，所以同时判断 isFile）
    try {
      const alt = path.join(config.publicDir, path.normalize(rel), 'index.html');
      if (alt.startsWith(config.publicDir)) {
        const altStat = await fsp.stat(alt);
        if (altStat.isFile()) { stat = altStat; file = alt; rel = path.join(rel, 'index.html'); }
      }
    } catch { /* ignore */ }
  }

  if (!stat || !stat.isFile()) {
    const notFound = path.join(config.publicDir, '404.html');
    if (fs.existsSync(notFound)) {
      securityHeaders(res, { html: true });
      const body = await fsp.readFile(notFound);
      res.writeHead(404, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
    }
    return;
  }

  const ext = path.extname(rel).toLowerCase();
  const isHtml = ext === '.html';
  securityHeaders(res, { html: isHtml });
  const url = new URL(req.url, 'http://x');
  const fingerprinted = url.searchParams.has('v');
  // 开发环境一律 no-cache：改完 JS/CSS 普通刷新就能看到，不必记着强制刷新
  const cache = isHtml
    ? 'no-cache'
    : fingerprinted
      ? 'public, max-age=31536000, immutable'
      : config.isProd ? 'public, max-age=300' : 'no-cache';
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', cache);
  res.setHeader('Last-Modified', stat.mtime.toUTCString());
  if (req.method === 'HEAD') { res.writeHead(200); res.end(); return; }
  res.writeHead(200);
  fs.createReadStream(file).pipe(res);
}

/* ---------------- 条目配图 ---------------- */
const MEDIA_NAME = /^[A-Za-z0-9_-]{4,64}\.(?:png|jpe?g|webp)$/i;

async function serveMedia(req, res, pathname) {
  const name = pathname.slice('/media/'.length);
  // 只认扁平文件名：不解析子目录、不接受 . / .. ，路径穿越无从谈起
  if (!MEDIA_NAME.test(name)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
    return;
  }
  const file = path.join(config.uploadsDir, name);
  let stat = null;
  try { stat = await fsp.stat(file); } catch { /* not found */ }
  if (!stat || !stat.isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
    return;
  }
  const ext = path.extname(name).toLowerCase();
  securityHeaders(res);
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  res.setHeader('Content-Length', stat.size);
  // 文件名随机且永不复用，可以放心长缓存
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  if (req.method === 'HEAD') { res.writeHead(200); res.end(); return; }
  res.writeHead(200);
  fs.createReadStream(file).pipe(res);
}

/* ---------------- 主处理 ---------------- */
export function createServer(store) {
  return http.createServer(async (req, res) => {
    const start = Date.now();
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    let status = 200;

    try {
      /* --- 预览（独立沙箱文档，必须在静态之前） --- */
      const previewMatch = pathname.match(/^\/w\/([A-Za-z0-9_]+)\/preview$/);
      if (previewMatch) {
        const cookies = parseCookies(req.headers.cookie);
        const session = readSession(store, cookies[config.cookieName]);
        if (!session) throw new AppError(401, 'E_AUTH_REQUIRED', '请先登录');
        const source = workSource(store, previewMatch[1], { draft: url.searchParams.get('draft') === '1' });
        const html = previewHtml(source);
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': PREVIEW_CSP,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(req.method === 'HEAD' ? undefined : html);
        return;
      }

      /* --- API --- */
      if (pathname.startsWith('/api/')) {
        securityHeaders(res);
        const cookies = parseCookies(req.headers.cookie);
        const token = cookies[config.cookieName];
        const session = readSession(store, token);
        const ip = clientIp(req, config.trustProxy);

        const found = matchRoute(req.method === 'HEAD' ? 'GET' : req.method, pathname);
        if (!found) throw new AppError(404, 'E_NOT_FOUND', '接口不存在');

        checkCsrf(req);

        if (pathname === '/api/track') rateLimit(`track:${ip}`, 60, 60 * 1000);
        if (pathname === '/api/auth/login') {
          const rec = loginFails.get(ip);
          if (rec && rec.count >= 10 && rec.until > Date.now()) {
            rateLimit(`login-lock:${ip}`, 0, 1000);
          }
        }
        if (!['GET', 'HEAD'].includes(req.method)) rateLimit(`write:${ip}`, 240, 60 * 1000);

        const isOwner = !!session;
        if (found.route.auth === 'owner' && !isOwner) {
          throw new AppError(401, 'E_AUTH_REQUIRED', '需要所有者登录');
        }

        const parsed = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
          ? await readBody(req, pathname === '/api/uploads' ? UPLOAD_BODY : MAX_BODY)
          : {};
        // JSON 允许 null / 数字 / 数组 / 字符串字面量，但所有 handler 都按对象取字段：
        // 在这里统一收口，避免 `body.xxx` 直接抛错变成 500。
        const body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};

        let result;
        try {
          result = await found.route.handler({
            req, res, store, body,
            params: found.params,
            query: Object.fromEntries(url.searchParams),
            session, isOwner, token,
            ownerId: session ? session.ownerId : null,
          });
        } catch (err) {
          if (pathname === '/api/auth/login') noteLoginFail(ip);
          throw err;
        }

        status = result.status || 200;
        if (result.headers) for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v);
        if (result.cookies) {
          res.setHeader('Set-Cookie', result.cookies.map((c) => serializeCookie(c.name, c.value, c.opts)));
        }
        if (result.raw) {
          sendEmpty(res, status);
          return;
        }
        if (status === 304) {
          sendEmpty(res, 304, { ETag: res.getHeader('ETag') || '' });
          return;
        }
        sendJson(res, status, { ok: true, data: result.body });
        return;
      }

      /* --- 条目配图（不走 public 目录） --- */
      if (pathname.startsWith('/media/')) {
        await serveMedia(req, res, pathname);
        return;
      }

      /* --- /stats 页面级鉴权 --- */
      if (pathname === '/stats' || pathname === '/stats/') {
        const cookies = parseCookies(req.headers.cookie);
        if (!readSession(store, cookies[config.cookieName])) {
          res.writeHead(302, { Location: '/?login=1&next=/stats/' });
          res.end();
          return;
        }
      }

      /* --- 静态 --- */
      await serveStatic(req, res, pathname);
      return;
    } catch (err) {
      const isApi = pathname.startsWith('/api/');
      const appErr = err instanceof AppError ? err : null;
      const statusCode = appErr ? appErr.status : 500;
      status = statusCode;
      if (!appErr) console.error(`[500] ${req.method} ${pathname}`, err);

      if (res.headersSent) { try { res.end(); } catch { /* ignore */ } return; }

      const payload = {
        ok: false,
        error: {
          code: appErr ? appErr.code : 'E_INTERNAL',
          message: appErr ? appErr.message : '服务器内部错误',
          ...(appErr && appErr.details ? { details: appErr.details } : {}),
        },
      };
      if (!isApi) {
        res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(appErr ? appErr.message : 'Internal Server Error');
        return;
      }
      if (appErr && appErr.retryAfter) res.setHeader('Retry-After', String(appErr.retryAfter));
      sendJson(res, statusCode, payload);
    } finally {
      if (!pathname.startsWith('/api/')) return;
      const ms = Date.now() - start;
      if (ms > 800) console.log(`[slow] ${req.method} ${pathname} ${ms}ms`);
    }
  });
}
