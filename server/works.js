import { config } from './config.js';
import { fail, num, str } from './util.js';
import { newId } from './util.js';

const LIMITS = { html: 200000, css: 100000, js: 100000, total: 256000 };

function sizeOk(source) {
  const html = String(source.html || '');
  const css = String(source.css || '');
  const js = String(source.js || '');
  if (html.length + css.length + js.length > LIMITS.total) {
    fail(413, 'E_TOO_LARGE', '作品体积超过 256KB 上限');
  }
  return { html, css, js };
}

function publicWork(w) {
  return {
    id: w._id,
    title: w.title,
    visibility: w.visibility || 'private',
    latestVersionNo: w.latestVersionNo || 0,
    currentVersion: w.currentVersion || 0,
    versionCount: w.versionCount || 0,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  };
}

export function listWorks(store) {
  return store
    .all('works')
    .filter((w) => !w.deletedAt)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map(publicWork);
}

export function getWork(store, id) {
  const w = store.get('works', id);
  if (!w || w.deletedAt) fail(404, 'E_NOT_FOUND', '作品不存在');
  return w;
}

export function createWork(store, body) {
  const title = str(body.title, { max: 60 }) || '未命名作品';
  const source = sizeOk(body);
  const now = Date.now();
  const id = newId('wk');
  const work = store.insert('works', {
    _id: id,
    title,
    visibility: 'private',
    latestVersionNo: 1,
    currentVersion: 1,
    versionCount: 1,
    draft: { ...source, rev: 1, updatedAt: now },
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
  store.insert('work_versions', {
    _id: `${id}__v000001`,
    workId: id,
    versionNo: 1,
    ...source,
    bytes: source.html.length + source.css.length + source.js.length,
    note: '初始版本',
    restoredFrom: null,
    createdAt: now,
  });
  return { work: publicWork(work), versionNo: 1 };
}

export function updateWork(store, id, body) {
  const w = getWork(store, id);
  const patch = { updatedAt: Date.now() };
  if (body.title != null) patch.title = str(body.title, { max: 60 }) || '未命名作品';
  const next = store.update('works', id, patch);
  return publicWork(next);
}

export function deleteWork(store, id) {
  getWork(store, id);
  const now = Date.now();
  store.update('works', id, { deletedAt: now, updatedAt: now });
  return { deletedAt: now };
}

export function saveDraft(store, id, body) {
  const w = getWork(store, id);
  const source = sizeOk(body);
  const rev = (w.draft?.rev || 0) + 1;
  store.update('works', id, {
    draft: { ...source, rev, updatedAt: Date.now() },
    updatedAt: Date.now(),
  });
  return { rev };
}

export function saveVersion(store, id, body) {
  const w = getWork(store, id);
  const source = sizeOk(body);
  const now = Date.now();
  const versionNo = (w.latestVersionNo || 0) + 1;
  store.insert('work_versions', {
    _id: `${id}__v${String(versionNo).padStart(6, '0')}`,
    workId: id,
    versionNo,
    ...source,
    bytes: source.html.length + source.css.length + source.js.length,
    note: str(body.note, { max: 120 }) || '',
    restoredFrom: null,
    createdAt: now,
  });
  store.update('works', id, {
    latestVersionNo: versionNo,
    currentVersion: versionNo,
    versionCount: (w.versionCount || 0) + 1,
    draft: { ...source, rev: (w.draft?.rev || 0) + 1, updatedAt: now },
    updatedAt: now,
  });
  pruneVersions(store, id);
  return { versionNo, bytes: source.html.length + source.css.length + source.js.length };
}

function pruneVersions(store, workId) {
  const versions = store
    .find('work_versions', (v) => v.workId === workId)
    .sort((a, b) => a.versionNo - b.versionNo);
  const max = config.maxVersionsPerWork;
  if (versions.length <= max) return;
  const keep = new Set(versions.slice(-max).map((v) => v._id));
  keep.add(versions[0]._id); // 永远保留 v1
  for (const v of versions) {
    if (!keep.has(v._id)) store.remove('work_versions', v._id);
  }
}

export function listVersions(store, id, { limit = 50 } = {}) {
  getWork(store, id);
  return store
    .find('work_versions', (v) => v.workId === id)
    .sort((a, b) => b.versionNo - a.versionNo)
    .slice(0, Math.min(limit, 100))
    .map((v) => ({
      versionNo: v.versionNo,
      bytes: v.bytes,
      note: v.note || '',
      restoredFrom: v.restoredFrom || null,
      createdAt: v.createdAt,
    }));
}

export function getVersion(store, id, no) {
  getWork(store, id);
  const v = store.get('work_versions', `${id}__v${String(no).padStart(6, '0')}`);
  if (!v) fail(404, 'E_NOT_FOUND', '版本不存在');
  return { versionNo: v.versionNo, html: v.html, css: v.css, js: v.js, createdAt: v.createdAt };
}

export function rollback(store, id, no) {
  const w = getWork(store, id);
  const target = store.get('work_versions', `${id}__v${String(no).padStart(6, '0')}`);
  if (!target) fail(404, 'E_NOT_FOUND', '版本不存在');
  const now = Date.now();
  const versionNo = (w.latestVersionNo || 0) + 1;
  const source = { html: target.html, css: target.css, js: target.js };
  store.insert('work_versions', {
    _id: `${id}__v${String(versionNo).padStart(6, '0')}`,
    workId: id,
    versionNo,
    ...source,
    bytes: target.bytes,
    note: `回滚自 v${target.versionNo}`,
    restoredFrom: target.versionNo,
    createdAt: now,
  });
  store.update('works', id, {
    latestVersionNo: versionNo,
    currentVersion: versionNo,
    versionCount: (w.versionCount || 0) + 1,
    draft: { ...source, rev: (w.draft?.rev || 0) + 1, updatedAt: now },
    updatedAt: now,
  });
  pruneVersions(store, id);
  return { currentVersion: versionNo, newVersionNo: versionNo, restoredFrom: target.versionNo };
}

export function workSource(store, id, { draft = false } = {}) {
  const w = getWork(store, id);
  if (draft) {
    const d = w.draft || {};
    return { html: d.html || '', css: d.css || '', js: d.js || '' };
  }
  const v = store.get('work_versions', `${id}__v${String(w.currentVersion || 1).padStart(6, '0')}`);
  if (!v) return { html: '', css: '', js: '' };
  return { html: v.html, css: v.css, js: v.js };
}

/** 独立沙箱文档：主站永不直接渲染用户 HTML */
export function previewHtml(source) {
  const css = String(source.css || '');
  const js = String(source.js || '');
  const html = String(source.html || '');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PREVIEW</title>
<style>html{color-scheme:dark}body{margin:0;font-family:system-ui,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:#0b0d10;color:#d8dad3}
${css}</style>
</head>
<body>
${html}
<script>
try{${js}}catch(e){document.title='JS ERROR: '+e.message;console.error(e);}
</script>
</body>
</html>`;
}
