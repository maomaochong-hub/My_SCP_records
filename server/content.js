import { fail, httpUrl, num, str } from './util.js';
import { newId } from './util.js';

const MAX = {
  catName: 24,
  itemCode: 32,
  itemTitle: 100,
  itemNote: 600,
  noteTitle: 120,
  noteBody: 20000,
  remark: 4000,
};

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
    items: items.map(strip),
    notes: notes.map(strip),
    other: s.other || { remark: '' },
    updatedAt: s.updatedAt || Date.now(),
  };
}

export function summary(store) {
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
  const name = str(body.name, { max: MAX.catName, min: 1 });
  if (!name) fail(400, 'E_VALIDATION', '分类名称不能为空', { field: 'name' });
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
  if (!store.get('categories', id)) fail(404, 'E_NOT_FOUND', '分类不存在');
  store.remove('categories', id);
  let moved = 0;
  for (const item of store.all('items')) {
    if (item.catId === id) { item.catId = null; moved++; }
  }
  bump(store);
  return { removed: true, movedItems: moved };
}

/* ---------------- 条目 ---------------- */
export function createItem(store, body) {
  const title = str(body.title, { max: MAX.itemTitle, min: 1 });
  if (!title) fail(400, 'E_VALIDATION', '名称不能为空', { field: 'title' });
  const catId = str(body.catId, { max: 40 }) || null;
  if (catId && !store.get('categories', catId)) fail(400, 'E_VALIDATION', '分类不存在', { field: 'catId' });
  const now = Date.now();
  const doc = store.insert('items', {
    _id: newId('it'),
    catId,
    code: str(body.code, { max: MAX.itemCode }) || '—',
    title,
    url: httpUrl(body.url),
    note: str(body.note, { max: MAX.itemNote }),
    createdAt: now,
    updatedAt: now,
  });
  bump(store);
  return doc;
}

export function updateItem(store, id, body) {
  const doc = store.get('items', id);
  if (!doc) fail(404, 'E_NOT_FOUND', '条目不存在');
  const patch = {};
  if (body.title != null) {
    const title = str(body.title, { max: MAX.itemTitle, min: 1 });
    if (!title) fail(400, 'E_VALIDATION', '名称不能为空', { field: 'title' });
    patch.title = title;
  }
  if (body.code != null) patch.code = str(body.code, { max: MAX.itemCode }) || '—';
  if (body.url != null) patch.url = httpUrl(body.url);
  if (body.note != null) patch.note = str(body.note, { max: MAX.itemNote });
  if (body.catId !== undefined) {
    const catId = str(body.catId, { max: 40 }) || null;
    if (catId && !store.get('categories', catId)) fail(400, 'E_VALIDATION', '分类不存在', { field: 'catId' });
    patch.catId = catId;
  }
  patch.updatedAt = Date.now();
  const next = store.update('items', id, patch);
  bump(store);
  return next;
}

export function deleteItem(store, id) {
  if (!store.remove('items', id)) fail(404, 'E_NOT_FOUND', '条目不存在');
  bump(store);
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
    store.removeWhere('categories', () => true);
    store.removeWhere('items', () => true);
    store.removeWhere('notes', () => true);
  }

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
    const mapped = it.catId ? catMap.get(String(it.catId)) : null;
    const catId = mapped || (it.catId && store.get('categories', String(it.catId)) ? String(it.catId) : null);
    store.insert('items', {
      _id: newId('it'),
      catId,
      code: str(it.code, { max: MAX.itemCode }) || '—',
      title,
      url: httpUrl(it.url),
      note: str(it.note, { max: MAX.itemNote }),
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
