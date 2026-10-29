/**
 * 冒烟测试：鉴权边界、内容写入、作品版本、访客统计去重与月度归档
 * 运行：npm test
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8911 + Math.floor(Math.random() * 80);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-test-'));
const OWNER = { email: 'owner@test.local', password: 'test-password-1234' };

let child = null;
let cookie = '';

const env = {
  ...process.env,
  NODE_ENV: 'test',
  PORT: String(PORT),
  DATA_DIR,
  OWNER_EMAIL: OWNER.email,
  OWNER_PASSWORD: OWNER.password,
  PUBLIC_ORIGIN: ORIGIN,
  COOKIE_SECURE: 'false',
  COOKIE_NAME: 'scp_sid',
  SESSION_SECRET: 'test-session-secret-0123456789',
  AUTH_PEPPER: 'test-pepper-0123456789',
  STATS_SECRET: 'test-stats-0123456789',
  STATS_EXCLUDE_OWNER: 'true',
};

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${ORIGIN}/api/health`);
      if (res.ok) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error('server did not start');
}

function api(pathname, { method = 'GET', body, auth = false, csrf = true } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (csrf && method !== 'GET') headers['X-CSRF'] = '1';
  if (auth && cookie) headers.Cookie = cookie;
  return fetch(ORIGIN + pathname, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
}

before(async () => {
  const seed = spawnSync(process.execPath, [path.join(ROOT, 'scripts/seed.js')], { env, encoding: 'utf8' });
  assert.equal(seed.status, 0, 'seed 失败: ' + seed.stderr);
  child = spawn(process.execPath, [path.join(ROOT, 'server/server.js')], { env, stdio: 'ignore' });
  await waitForServer();
});

after(() => {
  if (child) child.kill();
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

/* ---------------- 鉴权 ---------------- */
test('匿名访问所有写接口一律 401', async () => {
  const cases = [
    ['POST', '/api/categories', { name: 'x' }],
    ['PATCH', '/api/categories/c1', { name: 'x' }],
    ['DELETE', '/api/categories/c1'],
    ['POST', '/api/items', { title: 'x' }],
    ['PATCH', '/api/items/i1', { title: 'x' }],
    ['DELETE', '/api/items/i1'],
    ['POST', '/api/notes', { title: 'x' }],
    ['PATCH', '/api/notes/n1', { title: 'x' }],
    ['PATCH', '/api/notes/n1/geometry', { x: 1, y: 2 }],
    ['DELETE', '/api/notes/n1'],
    ['PATCH', '/api/settings', { other: { remark: 'x' } }],
    ['POST', '/api/works', { title: 'x' }],
    ['GET', '/api/works'],
    ['GET', '/api/stats/overview'],
    ['GET', '/api/stats/months'],
    ['POST', '/api/stats/archive', {}],
    ['GET', '/api/export'],
  ];
  for (const [method, p, body] of cases) {
    const res = await api(p, { method, body });
    assert.equal(res.status, 401, `${method} ${p} 应返回 401，实际 ${res.status}`);
  }
});

test('匿名无法读取统计，且响应体不含数字', async () => {
  const res = await api('/api/stats/overview');
  const text = await res.text();
  assert.equal(res.status, 401);
  assert.ok(!/"uv"/.test(text), '未授权响应不应包含统计字段');
});

test('跨站 Origin 被拒绝（403）', async () => {
  const res = await fetch(`${ORIGIN}/api/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF': '1', Origin: 'https://evil.example' },
    body: JSON.stringify({ title: 'x' }),
  });
  assert.equal(res.status, 403);
});

test('非 JSON 请求体被拒绝（415）', async () => {
  const res = await fetch(`${ORIGIN}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'X-CSRF': '1' },
    body: 'email=a&password=b',
  });
  assert.equal(res.status, 415);
});

test('错误口令不通过，正确口令拿到会话 Cookie', async () => {
  const bad = await api('/api/auth/login', { method: 'POST', body: { email: OWNER.email, password: 'wrong' } });
  assert.equal(bad.status, 401);

  const res = await api('/api/auth/login', { method: 'POST', body: OWNER });
  assert.equal(res.status, 200);
  const set = res.headers.get('set-cookie') || '';
  assert.ok(set.includes('scp_sid='), '应下发会话 Cookie');
  assert.ok(/HttpOnly/i.test(set));
  cookie = set.split(';')[0];

  const session = await api('/api/auth/session', { auth: true });
  const json = await session.json();
  assert.equal(json.data.authenticated, true);
});

/* ---------------- 内容 ---------------- */
test('分类与条目可写可读', async () => {
  const cat = await api('/api/categories', { method: 'POST', auth: true, body: { name: '测试分类' } });
  assert.equal(cat.status, 201);
  const catData = (await cat.json()).data;

  const item = await api('/api/items', {
    method: 'POST', auth: true,
    body: { title: '测试条目', catId: catData._id || catData.id, url: 'https://example.com' },
  });
  assert.equal(item.status, 201);

  const content = await api('/api/content');
  const data = (await content.json()).data;
  assert.ok(data.items.some((i) => i.title === '测试条目'));
  assert.ok(data.categories.some((c) => c.name === '测试分类'));
});

test('/api/content 支持 ETag 304', async () => {
  const first = await api('/api/content');
  const etag = first.headers.get('etag');
  assert.ok(etag);
  const second = await fetch(ORIGIN + '/api/content', { headers: { 'If-None-Match': etag } });
  assert.equal(second.status, 304);
});

/* ---------------- 作品 ---------------- */
test('作品版本与回滚：历史只追加', async () => {
  const created = await api('/api/works', {
    method: 'POST', auth: true, body: { title: '测试作品', html: '<h1>v1</h1>' },
  });
  assert.equal(created.status, 201);
  const work = (await created.json()).data.work;

  const v2 = await api(`/api/works/${work.id}/versions`, {
    method: 'POST', auth: true, body: { html: '<h1>v2</h1>', css: '', js: '', note: '第二版' },
  });
  assert.equal((await v2.json()).data.versionNo, 2);

  const rb = await api(`/api/works/${work.id}/rollback`, { method: 'POST', auth: true, body: { versionNo: 1 } });
  const rbData = (await rb.json()).data;
  assert.equal(rbData.newVersionNo, 3);
  assert.equal(rbData.restoredFrom, 1);

  const list = await api(`/api/works/${work.id}/versions`, { auth: true });
  const versions = (await list.json()).data;
  assert.equal(versions.length, 3);
  assert.deepEqual(versions.map((v) => v.versionNo), [3, 2, 1]);

  const v1 = await api(`/api/works/${work.id}/versions/1`, { auth: true });
  assert.ok((await v1.json()).data.html.includes('v1'), 'v1 内容不应被回滚改写');
});

test('预览文档只对所有者可用，并带沙箱 CSP', async () => {
  const list = await api('/api/works', { auth: true });
  const work = (await list.json()).data[0];

  const anon = await fetch(`${ORIGIN}/w/${work.id}/preview`);
  assert.equal(anon.status, 401);

  const res = await fetch(`${ORIGIN}/w/${work.id}/preview?draft=1`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  const csp = res.headers.get('content-security-policy') || '';
  assert.ok(csp.includes('sandbox'), '预览必须带 sandbox');
  assert.ok(!csp.includes('allow-same-origin'), '不得给 allow-same-origin');
});

/* ---------------- 统计 ---------------- */
test('同一访客同日只计 1 次 UV，PV 逐次累加', async () => {
  const before = await api('/api/stats/overview', { auth: true });
  const b = (await before.json()).data.today;

  for (let i = 0; i < 3; i++) {
    await api('/api/track', { method: 'POST', body: { vid: 'test-visitor-aaaa-bbbb', path: '/' } });
  }
  const afterRes = await api('/api/stats/overview', { auth: true });
  const a = (await afterRes.json()).data.today;

  assert.equal(a.uv - b.uv, 1, '同一 vid 三次上报只应增加 1 UV');
  assert.equal(a.pv - b.pv, 3, 'PV 应逐次累加');
});

test('不同访客分别计入 UV', async () => {
  const before = await api('/api/stats/overview', { auth: true });
  const b = (await before.json()).data.today;
  await api('/api/track', { method: 'POST', body: { vid: 'test-visitor-1111', path: '/' } });
  await api('/api/track', { method: 'POST', body: { vid: 'test-visitor-2222', path: '/archive/' } });
  const afterRes = await api('/api/stats/overview', { auth: true });
  const a = (await afterRes.json()).data.today;
  assert.equal(a.uv - b.uv, 2);
});

test('月度列表包含当月且标记进行中', async () => {
  const res = await api('/api/stats/months', { auth: true });
  const months = (await res.json()).data;
  assert.ok(months.length >= 1);
  assert.equal(months[0].current, true);
  assert.equal(months[0].archived, false);
});
