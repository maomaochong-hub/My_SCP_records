import { fail, httpUrl, num, str } from './util.js';
import { newId } from './util.js';
import { removeImageIfUnused } from './uploads.js';

const MAX = {
  catName: 24,
  itemCode: 32,
  itemTitle: 100,
  itemNote: 600,
  noteTitle: 120,
  noteBody: 20000,
  remark: 4000,
  catsPerItem: 16,
};

/**
 * 归档分类：修改条目时可以把「改之前的那一份」复制到这里。
 * 永远沉在列表最底部，不可重命名、不可删除，初始为空。
 */
export const ARCHIVE_CAT = { id: 'cat_6183a', name: 'SCP-6183-A', sort: 1e9 };

export function settings(store) {
  let s = store.get('settings', 'site');
  if (!s) {
    s = store.insert('settings', {
      _id: 'site',
      other: { remark: '' },
      contentVersion: 1,
      schemaVersion: 2,
      updatedAt: Date.now(),
    });
  }
  return s;
}

/** 归档分类缺失时即时补齐（老库存量数据无需迁移脚本） */
export function ensureArchiveCategory(store) {
  let cat = store.get('categories', ARCHIVE_CAT.id);
  if (cat) {
    if (!cat.locked) store.update('categories', cat._id, { locked: true, sort: ARCHIVE_CAT.sort });
    return cat;
  }
  const now = Date.now();
  cat = store.insert('categories', {
    _id: ARCHIVE_CAT.id,
    name: ARCHIVE_CAT.name,
    sort: ARCHIVE_CAT.sort,
    locked: true,
    createdAt: now,
    updatedAt: now,
  });
  return cat;
}

/* ---------------- 条目 / 分类 归一化 ---------------- */

/** 一个条目所属的全部分类；兼容只有 catId 的旧数据 */
export function itemCatIds(it) {
  const list = Array.isArray(it.catIds) ? it.catIds.filter(Boolean) : [];
  if (list.length) return list;
  return it.catId ? [it.catId] : [];
}

function displayOf(it, ids) {
  if (it.displayCatId && ids.includes(it.displayCatId)) return it.displayCatId;
  return ids[0] || null;
}

function normImage(v) {
  const s = str(v, { max: 200 });
  if (!s) return '';
  return /^\/media\/[A-Za-z0-9_-]{4,64}\.(png|jpe?g|webp)$/i.test(s) ? s : '';
}

function normCode(v) {
  let s = str(v, { max: MAX.itemCode }) || '';
  s = s.replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ');
  // 纯 ASCII 编号统一大写：scp-173 → SCP-173
  if (/^[\x20-\x7e]+$/.test(s)) s = s.toUpperCase();
  return s || '—';
}

/** 过滤非法分类 id、去重、保序；空则退回旧 catId */
function normIds(store, raw, fallback) {
  const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const ids = [];
  for (const v of list) {
    const id = str(v, { max: 40 });
    if (!id || ids.includes(id)) continue;
    if (!store.get('categories', id)) continue;
    ids.push(id);
    if (ids.length >= MAX.catsPerItem) break;
  }
  if (!ids.length && fallback && store.get('categories', fallback)) ids.push(fallback);
  return ids;
}

function bump(store) {
  const s = settings(store);
  store.update('settings', 'site', {
    contentVersion: (s.contentVersion || 1) + 1,
    updatedAt: Date.now(),
  });
  return s.contentVersion + 1;
}

export function snapshot(store) {
  const s = settings(store);
  ensureArchiveCategory(store);
  const strip = (d) => {
    const { _id, ...rest } = d;
    return { id: _id, ...rest };
  };
  const cats = store.all('categories').slice().sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.createdAt - b.createdAt);
  const items = store.all('items').slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const notes = store.all('notes').slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  return {
    version: s.contentVersion,
    categories: cats.map(strip),
    items: items.map((it) => {
      const ids = itemCatIds(it);
      return {
        ...strip(it),
        catIds: ids,
        catId: ids[0] || null,
        displayCatId: displayOf(it, ids),
        image: normImage(it.image),
        snapshotOf: it.snapshotOf || null,
      };
    }),
    notes: notes.map(strip),
    other: s.other || { remark: '' },
    updatedAt: s.updatedAt || Date.now(),
  };
}

export function summary(store) {
  ensureArchiveCategory(store);
  return {
    items: store.count('items'),
    categories: store.count('categories'),
    notes: store.count('notes'),
    works: store.count('works', (w) => !w.deletedAt),
    version: settings(store).contentVersion,
  };
}

/* ---------------- 分类 ---------------- */
export function createCategory(store, body) {
  ensureArchiveCategory(store);
  const name = str(body.name, { max: MAX.catName, min: 1 });
  if (!name) fail(400, 'E_VALIDATION', '分类名称不能为空', { field: 'name' });
  if (name.toUpperCase() === ARCHIVE_CAT.name.toUpperCase()) fail(409, 'E_CONFLICT', '该分类为系统保留名称');
  if (store.all('categories').some((c) => c.name === name)) fail(409, 'E_CONFLICT', '分类已存在');
  const now = Date.now();
  const doc = store.insert('categories', {
    _id: newId('cat'), name, sort: num(body.sort, { def: now % 100000 }), createdAt: now, updatedAt: now,
  });
  bump(store);
  return doc;
}

export function updateCategory(store, id, body) {
  const doc = store.get('categories', id);
  if (!doc) fail(404, 'E_NOT_FOUND', '分类不存在');
  if (doc.locked) fail(400, 'E_LOCKED', '系统归档分类不可修改');
  const patch = {};
  if (body.name != null) {
    const name = str(body.name, { max: MAX.catName, min: 1 });
    if (!name) fail(400, 'E_VALIDATION', '分类名称不能为空', { field: 'name' });
    if (store.all('categories').some((c) => c.name === name && c._id !== id)) fail(409, 'E_CONFLICT', '分类已存在');
    patch.name = name;
  }
  if (body.sort != null) patch.sort = num(body.sort);
  patch.updatedAt = Date.now();
  const next = store.update('categories', id, patch);
  bump(store);
  return next;
}

export function deleteCategory(store, id) {
  const doc = store.get('categories', id);
  if (!doc) fail(404, 'E_NOT_FOUND', '分类不存在');
  if (doc.locked) fail(400, 'E_LOCKED', '系统归档分类不可删除');
  store.remove('categories', id);
  let moved = 0;
  for (const item of store.all('items')) {
    const ids = itemCatIds(item);
    if (!ids.includes(id)) continue;
    const next = ids.filter((x) => x !== id);
    item.catIds = next;
    item.catId = next[0] || null;
    if (item.displayCatId === id) item.displayCatId = next[0] || null;
    moved++;
  }
  bump(store);
  return { removed: true, movedItems: moved };
}

/* ---------------- 条目 ---------------- */
export function createItem(store, body) {
  ensureArchiveCategory(store);
  const title = str(body.title, { max: MAX.itemTitle, min: 1 });
  if (!title) fail(400, 'E_VALIDATION', '名称不能为空', { field: 'title' });
  const catIds = normIds(store, body.catIds != null ? body.catIds : body.catId, null);
  const now = Date.now();
  const doc = store.insert('items', {
    _id: newId('it'),
    catId: catIds[0] || null,
    catIds,
    displayCatId: displayOf({ displayCatId: str(body.displayCatId, { max: 40 }) }, catIds),
    code: normCode(body.code),
    title,
    url: httpUrl(body.url),
    note: str(body.note, { max: MAX.itemNote }),
    image: normImage(body.image),
    snapshotOf: str(body.snapshotOf, { max: 40 }) || null,
    createdAt: now,
    updatedAt: now,
  });
  bump(store);
  return doc;
}

export async function updateItem(store, id, body) {
  ensureArchiveCategory(store);
  const doc = store.get('items', id);
  if (!doc) fail(404, 'E_NOT_FOUND', '条目不存在');
  const patch = {};
  if (body.title != null) {
    const title = str(body.title, { max: MAX.itemTitle, min: 1 });
    if (!title) fail(400, 'E_VALIDATION', '名称不能为空', { field: 'title' });
    patch.title = title;
  }
  if (body.code != null) patch.code = normCode(body.code);
  if (body.url != null) patch.url = httpUrl(body.url);
  if (body.note != null) patch.note = str(body.note, { max: MAX.itemNote });
  if (body.image !== undefined) patch.image = normImage(body.image);
  if (body.catIds !== undefined || body.catId !== undefined) {
    const catIds = normIds(store, body.catIds != null ? body.catIds : body.catId, null);
    patch.catIds = catIds;
    patch.catId = catIds[0] || null;
    const wantDisplay = str(body.displayCatId, { max: 40 });
    patch.displayCatId = wantDisplay && catIds.includes(wantDisplay) ? wantDisplay : catIds[0] || null;
  } else if (body.displayCatId !== undefined) {
    const catIds = itemCatIds(doc);
    const wantDisplay = str(body.displayCatId, { max: 40 });
    patch.displayCatId = wantDisplay && catIds.includes(wantDisplay) ? wantDisplay : catIds[0] || null;
  }
  patch.updatedAt = Date.now();
  const prevImage = doc.image || '';
  const next = store.update('items', id, patch);
  bump(store);
  if (prevImage && prevImage !== next.image) await removeImageIfUnused(store, prevImage);
  return next;
}

export async function deleteItem(store, id) {
  const doc = store.get('items', id);
  if (!store.remove('items', id)) fail(404, 'E_NOT_FOUND', '条目不存在');
  bump(store);
  await removeImageIfUnused(store, doc && doc.image);
  return { deleted: true };
}

/* ---------------- 便签 ---------------- */
export function createNote(store, body) {
  const now = Date.now();
  const doc = store.insert('notes', {
    _id: newId('nt'),
    title: str(body.title, { max: MAX.noteTitle }) || '',
    body: str(body.body, { max: MAX.noteBody, trim: false }) || '',
    x: num(body.x, { min: 0, max: 6000, def: 40 }),
    y: num(body.y, { min: 0, max: 6000, def: 40 }),
    w: num(body.w, { min: 200, max: 900, def: 310 }),
    z: num(body.z, { min: 1, max: 9999, def: 1 }),
    accent: ['bone', 'amber', 'red'].includes(body.accent) ? body.accent : 'bone',
    createdAt: now,
    updatedAt: now,
  });
  bump(store);
  return doc;
}

export function updateNote(store, id, body) {
  const doc = store.get('notes', id);
  if (!doc) fail(404, 'E_NOT_FOUND', '便签不存在');
  const patch = { updatedAt: Date.now() };
  if (body.title != null) patch.title = str(body.title, { max: MAX.noteTitle }) || '';
  if (body.body != null) patch.body = str(body.body, { max: MAX.noteBody, trim: false }) || '';
  if (body.accent != null && ['bone', 'amber', 'red'].includes(body.accent)) patch.accent = body.accent;
  const next = store.update('notes', id, patch);
  bump(store);
  return next;
}

export function updateNoteGeometry(store, id, body) {
  const doc = store.get('notes', id);
  if (!doc) fail(404, 'E_NOT_FOUND', '便签不存在');
  const next = store.update('notes', id, {
    x: num(body.x, { min: 0, max: 6000, def: doc.x }),
    y: num(body.y, { min: 0, max: 6000, def: doc.y }),
    z: num(body.z, { min: 1, max: 99999, def: doc.z }),
    updatedAt: Date.now(),
  });
  return next;
}

export function deleteNote(store, id) {
  if (!store.remove('notes', id)) fail(404, 'E_NOT_FOUND', '便签不存在');
  bump(store);
  return { deleted: true };
}

/* ---------------- 设置 ---------------- */
export function updateSettings(store, body) {
  const s = settings(store);
  const other = { ...(s.other || {}) };
  if (body.other && body.other.remark != null) {
    other.remark = str(body.other.remark, { max: MAX.remark, trim: false }) || '';
  }
  store.update('settings', 'site', { other, updatedAt: Date.now() });
  bump(store);
  return { other };
}

/* ---------------- 导入 / 导出 ---------------- */
export function exportAll(store, { includeWorks = false } = {}) {
  const data = snapshot(store);
  if (includeWorks) {
    data.works = store.all('works').map((w) => ({ ...w }));
    data.workVersions = store.all('work_versions').map((v) => ({ ...v }));
  }
  return data;
}

export function importAll(store, body) {
  const data = body && body.data ? body.data : body;
  if (!data || !Array.isArray(data.items) || !Array.isArray(data.notes)) {
    fail(400, 'E_VALIDATION', '导入文件格式不正确');
  }
  const mode = body.mode === 'merge' ? 'merge' : 'replace';
  const now = Date.now();
  const counts = { categories: 0, items: 0, notes: 0 };

  if (mode === 'replace') {
    store.removeWhere('categories', (c) => !c.locked);
    store.removeWhere('items', () => true);
    store.removeWhere('notes', () => true);
  }
  ensureArchiveCategory(store);

  const catMap = new Map();
  for (const c of Array.isArray(data.categories) ? data.categories : []) {
    const name = str(c.name, { max: MAX.catName, min: 1 });
    if (!name) continue;
    const existing = store.all('categories').find((x) => x.name === name);
    if (existing) { catMap.set(String(c.id || c._id), existing._id); continue; }
    const id = newId('cat');
    store.insert('categories', {
      _id: id, name, sort: num(c.sort, { def: counts.categories }), createdAt: num(c.createdAt, { def: now }), updatedAt: now,
    });
    catMap.set(String(c.id || c._id), id);
    counts.categories++;
  }

  for (const it of data.items) {
    const title = str(it.title, { max: MAX.itemTitle, min: 1 });
    if (!title) continue;
    const rawIds = Array.isArray(it.catIds) ? it.catIds : it.catId ? [it.catId] : [];
    const ids = [];
    for (const raw of rawIds) {
      const mapped = catMap.get(String(raw)) || (store.get('categories', String(raw)) ? String(raw) : null);
      if (mapped && !ids.includes(mapped)) ids.push(mapped);
    }
    const display = str(it.displayCatId, { max: 40 });
    store.insert('items', {
      _id: newId('it'),
      catId: ids[0] || null,
      catIds: ids,
      displayCatId: display && ids.includes(catMap.get(display) || display) ? (catMap.get(display) || display) : ids[0] || null,
      code: normCode(it.code),
      title,
      url: httpUrl(it.url),
      note: str(it.note, { max: MAX.itemNote }),
      image: normImage(it.image),
      snapshotOf: str(it.snapshotOf, { max: 40 }) || null,
      createdAt: num(it.createdAt, { def: now }),
      updatedAt: num(it.updatedAt, { def: now }),
    });
    counts.items++;
  }

  for (const n of data.notes) {
    store.insert('notes', {
      _id: newId('nt'),
      title: str(n.title, { max: MAX.noteTitle }) || '',
      body: str(n.body, { max: MAX.noteBody, trim: false }) || '',
      x: num(n.x, { max: 6000, def: 40 }),
      y: num(n.y, { max: 6000, def: 40 }),
      w: num(n.w, { min: 200, max: 900, def: 310 }),
      z: num(n.z, { min: 1, max: 9999, def: 1 }),
      accent: ['bone', 'amber', 'red'].includes(n.accent) ? n.accent : 'bone',
      createdAt: num(n.createdAt, { def: now }),
      updatedAt: num(n.updatedAt, { def: now }),
    });
    counts.notes++;
  }

  if (data.other && data.other.remark != null) {
    store.update('settings', 'site', {
      other: { remark: str(data.other.remark, { max: MAX.remark, trim: false }) || '' },
    });
  }

  bump(store);
  return counts;
}
