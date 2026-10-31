import { config } from './config.js';
import { changePassword, clearedCookie, destroySession, login, readSession, sessionCookie } from './auth.js';
import {
  createCategory, createItem, createNote, deleteCategory, deleteItem, deleteNote,
  exportAll, importAll, snapshot, summary, updateCategory, updateItem, updateNote,
  updateNoteGeometry, updateSettings,
} from './content.js';
import {
  createWork, deleteWork, getVersion, getWork, listVersions, listWorks, previewHtml,
  rollback, saveDraft, saveVersion, updateWork, workSource,
} from './works.js';
import { archiveNow, dailySeries, monthSeries, overview, track } from './stats.js';
import { saveImageDataUrl } from './uploads.js';
import { clientIp, dayKey } from './util.js';

const routes = [];

function route(method, pattern, handler, auth = 'public') {
  const parts = pattern.split('/').filter(Boolean);
  routes.push({
    method,
    auth,
    handler,
    match(pathname) {
      const segs = pathname.split('/').filter(Boolean);
      if (segs.length !== parts.length) return null;
      const params = {};
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(segs[i]);
        else if (p !== segs[i]) return null;
      }
      return params;
    },
  });
}

function matchRoute(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const params = r.match(pathname);
    if (params) return { route: r, params };
  }
  return null;
}

/* ---------------- auth ---------------- */
route('POST', '/api/auth/login', async (ctx) => {
  const ua = String(ctx.req.headers['user-agent'] || '');
  const ip = clientIp(ctx.req, config.trustProxy);
  const result = await login(ctx.store, {
    email: ctx.body.email,
    password: ctx.body.password,
    ipHash: clientIp(ctx.req, config.trustProxy),
    uaHash: ua.slice(0, 120),
  });
  void ip;
  const cookie = sessionCookie(result.token);
  const owner = ctx.store.single('owner');
  return {
    status: 200,
    body: {
      authenticated: true,
      owner: result.owner,
      expiresAt: (owner && Date.now() + 7 * 86400000) || 0,
    },
    cookies: [cookie],
  };
}, 'public');

route('POST', '/api/auth/logout', (ctx) => {
  destroySession(ctx.store, ctx.token);
  return { status: 200, body: { authenticated: false }, cookies: [clearedCookie()] };
}, 'public');

route('GET', '/api/auth/session', (ctx) => ({
  status: 200,
  body: {
    authenticated: !!ctx.isOwner,
    owner: ctx.isOwner ? { email: ctx.store.single('owner')?.email || '' } : null,
  },
}), 'public');

route('POST', '/api/auth/password', (ctx) => {
  changePassword(ctx.store, ctx.ownerId, ctx.body.currentPassword, ctx.body.newPassword);
  return { status: 200, body: { changedAt: Date.now() }, cookies: [clearedCookie()] };
}, 'owner');

/* ---------------- content ---------------- */
route('GET', '/api/content', (ctx) => {
  const data = snapshot(ctx.store);
  const etag = `W/"c-${data.version}"`;
  if (ctx.req.headers['if-none-match'] === etag) {
    return { status: 304, raw: true, headers: { ETag: etag } };
  }
  return { status: 200, body: data, headers: { ETag: etag } };
}, 'public');

route('GET', '/api/content/summary', (ctx) => ({ status: 200, body: summary(ctx.store) }), 'public');

route('GET', '/api/export', (ctx) => ({
  status: 200,
  body: exportAll(ctx.store, { includeWorks: ctx.query.include === 'works' }),
}), 'owner');

route('POST', '/api/import', (ctx) => ({ status: 200, body: importAll(ctx.store, ctx.body) }), 'owner');

route('POST', '/api/categories', (ctx) => ({ status: 201, body: createCategory(ctx.store, ctx.body) }), 'owner');
route('PATCH', '/api/categories/:id', (ctx) => ({ status: 200, body: updateCategory(ctx.store, ctx.params.id, ctx.body) }), 'owner');
route('DELETE', '/api/categories/:id', (ctx) => ({ status: 200, body: deleteCategory(ctx.store, ctx.params.id) }), 'owner');

route('GET', '/api/items', (ctx) => ({ status: 200, body: snapshot(ctx.store).items }), 'public');
route('POST', '/api/items', (ctx) => ({ status: 201, body: createItem(ctx.store, ctx.body) }), 'owner');
route('PATCH', '/api/items/:id', async (ctx) => ({ status: 200, body: await updateItem(ctx.store, ctx.params.id, ctx.body) }), 'owner');
route('DELETE', '/api/items/:id', async (ctx) => ({ status: 200, body: await deleteItem(ctx.store, ctx.params.id) }), 'owner');

/* ---------------- 配图 ---------------- */
route('POST', '/api/uploads', async (ctx) => ({ status: 201, body: await saveImageDataUrl(ctx.body.dataUrl) }), 'owner');

route('POST', '/api/notes', (ctx) => ({ status: 201, body: createNote(ctx.store, ctx.body) }), 'owner');
route('PATCH', '/api/notes/:id/geometry', (ctx) => ({ status: 200, body: updateNoteGeometry(ctx.store, ctx.params.id, ctx.body) }), 'owner');
route('PATCH', '/api/notes/:id', (ctx) => ({ status: 200, body: updateNote(ctx.store, ctx.params.id, ctx.body) }), 'owner');
route('DELETE', '/api/notes/:id', (ctx) => ({ status: 200, body: deleteNote(ctx.store, ctx.params.id) }), 'owner');

route('PATCH', '/api/settings', (ctx) => ({ status: 200, body: updateSettings(ctx.store, ctx.body) }), 'owner');

/* ---------------- works ---------------- */
route('GET', '/api/works', (ctx) => ({ status: 200, body: listWorks(ctx.store) }), 'owner');
route('POST', '/api/works', (ctx) => ({ status: 201, body: createWork(ctx.store, ctx.body) }), 'owner');
route('GET', '/api/works/:id', (ctx) => {
  const w = getWork(ctx.store, ctx.params.id);
  return {
    status: 200,
    body: {
      id: w._id, title: w.title, currentVersion: w.currentVersion, latestVersionNo: w.latestVersionNo,
      versionCount: w.versionCount, updatedAt: w.updatedAt,
      draft: w.draft || { html: '', css: '', js: '', rev: 0 },
      source: workSource(ctx.store, w._id),
    },
  };
}, 'owner');
route('PATCH', '/api/works/:id', (ctx) => ({ status: 200, body: updateWork(ctx.store, ctx.params.id, ctx.body) }), 'owner');
route('DELETE', '/api/works/:id', (ctx) => ({ status: 200, body: deleteWork(ctx.store, ctx.params.id) }), 'owner');
route('PUT', '/api/works/:id/draft', (ctx) => ({ status: 200, body: saveDraft(ctx.store, ctx.params.id, ctx.body) }), 'owner');
route('POST', '/api/works/:id/versions', (ctx) => ({ status: 201, body: saveVersion(ctx.store, ctx.params.id, ctx.body) }), 'owner');
route('GET', '/api/works/:id/versions', (ctx) => ({
  status: 200, body: listVersions(ctx.store, ctx.params.id, { limit: Number(ctx.query.limit) || 50 }),
}), 'owner');
route('GET', '/api/works/:id/versions/:no', (ctx) => ({
  status: 200, body: getVersion(ctx.store, ctx.params.id, Number(ctx.params.no)),
}), 'owner');
route('POST', '/api/works/:id/rollback', (ctx) => ({
  status: 200, body: rollback(ctx.store, ctx.params.id, Number(ctx.body.versionNo)),
}), 'owner');

/* ---------------- stats ---------------- */
route('POST', '/api/track', (ctx) => {
  try {
    track(ctx.store, {
      vid: ctx.body.vid,
      ip: clientIp(ctx.req, config.trustProxy),
      ua: String(ctx.req.headers['user-agent'] || ''),
      isOwner: !!ctx.isOwner,
      path: ctx.body.path,
    });
  } catch (err) {
    console.error('[track]', err.message);
  }
  return { status: 204, raw: true };
}, 'public');

route('GET', '/api/stats/overview', (ctx) => ({ status: 200, body: overview(ctx.store) }), 'owner');
route('GET', '/api/stats/daily', (ctx) => ({
  status: 200,
  body: dailySeries(ctx.store, {
    days: Number(ctx.query.days) || 30,
    month: String(ctx.query.month || ''),
  }),
}), 'owner');
route('GET', '/api/stats/months', (ctx) => ({
  status: 200, body: monthSeries(ctx.store, { limit: Number(ctx.query.limit) || 24 }),
}), 'owner');
route('POST', '/api/stats/archive', (ctx) => ({ status: 200, body: archiveNow(ctx.store, ctx.body.month) }), 'owner');

/* ---------------- health ---------------- */
route('GET', '/api/health', (ctx) => ({
  status: 200,
  body: {
    ok: true,
    storage: config.storageDriver,
    version: config.version,
    day: dayKey(),
    uptime: Math.round(process.uptime()),
    ...(ctx.isOwner ? { owner: true } : {}),
  },
}), 'public');

export { matchRoute, routes };
export { previewHtml, workSource, getWork };
