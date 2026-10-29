import crypto from 'node:crypto';
import { config } from './config.js';

/* ---------------- ids / 加密 ---------------- */
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';

export function newId(prefix) {
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < 10; i++) out += B32[bytes[i % 8] % 32];
  return `${prefix}_${out}`;
}

export function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

export function hmac(str, secret = config.statsSecret) {
  return crypto.createHmac('sha256', secret).update(str).digest('base64url');
}

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const buf = crypto.scryptSync(password + config.authPepper, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${buf.toString('base64url')}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  try {
    const salt = Buffer.from(saltB64, 'base64url');
    const expect = Buffer.from(hashB64, 'base64url');
    const actual = crypto.scryptSync(password + config.authPepper, salt, expect.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
    });
    return actual.length === expect.length && crypto.timingSafeEqual(actual, expect);
  } catch {
    return false;
  }
}

export function timingSafeEq(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/* ---------------- 时间 ---------------- */
const dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: config.siteTz, year: 'numeric', month: '2-digit', day: '2-digit',
});

/** 2026-10-25（站点时区，不受部署机器时区影响） */
export function dayKey(ts = Date.now()) {
  return dayFmt.format(new Date(ts));
}
export function monthKey(ts = Date.now()) {
  return dayKey(ts).slice(0, 7);
}
export function prevMonthKey(month) {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
export function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/* ---------------- cookie ---------------- */
export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx < 1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

export function serializeCookie(name, value, opts = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`];
  bits.push(`Path=${opts.path || '/'}`);
  if (opts.maxAge != null) bits.push(`Max-Age=${Math.floor(opts.maxAge)}`);
  if (opts.httpOnly !== false) bits.push('HttpOnly');
  if (opts.secure) bits.push('Secure');
  bits.push(`SameSite=${opts.sameSite || 'Lax'}`);
  if (opts.domain) bits.push(`Domain=${opts.domain}`);
  return bits.join('; ');
}

/* ---------------- 校验 ---------------- */
export function str(value, { max = 500, min = 0, trim = true } = {}) {
  if (value == null) return '';
  let s = String(value);
  if (trim) s = s.trim();
  if (s.length > max) s = s.slice(0, max);
  if (s.length < min) return null;
  return s;
}

export function num(value, { min = -1e9, max = 1e9, def = 0 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

export function bool(value, def = false) {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return def;
}

export function httpUrl(value) {
  const s = str(value, { max: 2000 });
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) return '';
  try { const u = new URL(s); return u.toString(); } catch { return ''; }
}

export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details || null;
  }
}

export function fail(status, code, message, details) {
  throw new AppError(status, code, message, details);
}

/* ---------------- 静态文件 ---------------- */
export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

export function clientIp(req, trustProxy) {
  const raw = trustProxy
    ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress
    : req.socket.remoteAddress;
  return String(raw || '').replace(/^::ffff:/, '');
}
