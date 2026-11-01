/**
 * 画板 / 连接板：节点 + 连线的最小图形文档。
 *
 * kind:
 *   links  项目收集的「连接板」，节点是条目的简化形式
 *   idea   灵感写作的压缩条目
 *   board  纯画板（文字 / 图片 / 手绘 / 形状）
 *
 * 数据整块存在 db.json 里，图片只存 /media/<name>，不进 JSON。
 */

import { fail, num, str, text } from './util.js';
import { newId } from './util.js';

const LIMIT = {
  title: 80,
  note: 400,
  text: 8000,
  nodes: 400,
  edges: 600,
  points: 2400,
  label: 120,
};

const KINDS = new Set(['links', 'idea', 'board', 'surface']);
const NODE_TYPES = new Set(['ref', 'refboard', 'note', 'text', 'image', 'shape', 'stroke']);
const SHAPES = new Set(['rect', 'circle', 'triangle', 'arrow', 'angle', 'line']);
const COLOR = /^#[0-9a-f]{3,8}$/i;

function normColor(v, def = '#d8443a') {
  const s = str(v, { max: 9 });
  return COLOR.test(s) ? s : def;
}

function normMedia(v) {
  const s = str(v, { max: 200 });
  if (!s) return '';
  return /^\/media\/[A-Za-z0-9_-]{4,64}\.(png|jpe?g|webp)$/i.test(s) ? s : '';
}

function coord(v, def) {
  return num(v, { min: -6000, max: 16000, def });
}

function normNode(raw, i) {
  const n = raw && typeof raw === 'object' ? raw : {};
  const typeStr = text(n.type, 20);
  const type = NODE_TYPES.has(typeStr) ? typeStr : 'note';
  const node = {
    id: str(n.id, { max: 36 }) || newId('nd'),
    type,
    x: coord(n.x, 32 + (i % 6) * 40),
    y: coord(n.y, 32 + Math.floor(i / 6) * 60),
    w: num(n.w, { min: 90, max: 2200, def: type === 'note' ? 250 : 160 }),
    h: num(n.h, { min: 34, max: 2200, def: type === 'note' ? 150 : 64 }),
    z: num(n.z, { min: 1, max: 99999, def: i + 1 }),
    color: normColor(n.color, '#cfd2c9'),
  };

  if (type === 'ref') {
    node.refId = str(n.refId, { max: 40 }) || '';
    node.code = str(n.code, { max: 32 }) || '';
    node.title = str(n.title, { max: LIMIT.title }) || '';
  } else if (type === 'refboard') {
    node.boardId = str(n.boardId, { max: 40 }) || '';
    node.title = str(n.title, { max: LIMIT.title }) || '';
  } else if (type === 'note' || type === 'text') {
    node.text = str(n.text, { max: LIMIT.text, trim: false }) || '';
    node.size = num(n.size, { min: 9, max: 72, def: 13 });
    node.color = normColor(n.color, type === 'text' ? '#cfd2c9' : '#e6e3dc');
  } else if (type === 'image') {
    node.image = normMedia(n.image);
    node.caption = str(n.caption, { max: LIMIT.label }) || '';
  } else if (type === 'shape') {
    const shapeStr = text(n.shape, 20);
    node.shape = SHAPES.has(shapeStr) ? shapeStr : 'rect';
    node.rot = num(n.rot, { min: -360, max: 360, def: 0 });
    node.symbol = str(n.symbol, { max: 8 }) || '';
  } else if (type === 'stroke') {
    const pts = Array.isArray(n.points) ? n.points.slice(0, LIMIT.points) : [];
    node.points = pts
      .map((p) => (Array.isArray(p) ? [num(p[0], { def: 0 }), num(p[1], { def: 0 })] : null))
      .filter(Boolean);
    node.width = num(n.width, { min: 0.5, max: 12, def: 2 });
  }
  return node;
}

function normEdge(raw, ids) {
  const e = raw && typeof raw === 'object' ? raw : {};
  const from = str(e.from, { max: 36 });
  const to = str(e.to, { max: 36 });
  if (!from || !to || from === to || !ids.has(from) || !ids.has(to)) return null;
  return {
    id: str(e.id, { max: 36 }) || newId('eg'),
    from,
    to,
    color: normColor(e.color, '#8d9188'),
    note: str(e.note, { max: LIMIT.label, trim: false }) || '',
  };
}

export function normBoardOut(doc) {
  const { _id, ...rest } = doc;
  return {
    id: _id,
    ...rest,
    cats: Array.isArray(rest.cats) ? rest.cats.filter(Boolean) : [],
    nodes: Array.isArray(rest.nodes) ? rest.nodes : [],
    edges: Array.isArray(rest.edges) ? rest.edges : [],
  };
}

function bump(store) {
  const s = store.get('settings', 'site');
  if (!s) return;
  store.update('settings', 'site', {
    contentVersion: (s.contentVersion || 1) + 1,
    updatedAt: Date.now(),
  });
}

function normGraph(raw) {
  const seen = new Set();
  const nodes = (Array.isArray(raw.nodes) ? raw.nodes : [])
    .slice(0, LIMIT.nodes)
    .map(normNode)
    // 重复 id 会让连线指到两个节点上，只保留第一个
    .filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));
  const ids = seen;
  const edges = (Array.isArray(raw.edges) ? raw.edges : [])
    .slice(0, LIMIT.edges)
    .map((e) => normEdge(e, ids))
    .filter(Boolean);
  return { nodes, edges };
}

function normCats(store, raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const v of list.slice(0, 16)) {
    const id = str(v, { max: 40 });
    if (!id || out.includes(id)) continue;
    if (!store.get('categories', id)) continue;
    out.push(id);
  }
  return out;
}

export function listBoards(store, { kind } = {}) {
  return store
    .all('boards')
    .filter((b) => !kind || b.kind === kind)
    .slice()
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .map(normBoardOut);
}

export function getBoard(store, id) {
  const doc = store.get('boards', id);
  if (!doc) fail(404, 'E_NOT_FOUND', '画板不存在');
  return normBoardOut(doc);
}

export function createBoard(store, body) {
  const kindStr = text(body.kind, 20);
  const kind = KINDS.has(kindStr) ? kindStr : 'links';
  const now = Date.now();
  const graph = normGraph(body);
  const doc = store.insert('boards', {
    _id: newId('bd'),
    kind,
    title: str(body.title, { max: LIMIT.title }) || (kind === 'board' ? '未命名画板' : '未命名连接'),
    note: str(body.note, { max: LIMIT.note }) || '',
    cats: normCats(store, body.cats),
    x: coord(body.x, 40),
    y: coord(body.y, 40),
    w: num(body.w, { min: 180, max: 900, def: 300 }),
    h: num(body.h, { min: 80, max: 900, def: 180 }),
    color: normColor(body.color, '#8d9188'),
    nodes: graph.nodes,
    edges: graph.edges,
    createdAt: now,
    updatedAt: now,
  });
  bump(store);
  return normBoardOut(doc);
}

export function updateBoard(store, id, body) {
  const doc = store.get('boards', id);
  if (!doc) fail(404, 'E_NOT_FOUND', '画板不存在');
  const patch = { updatedAt: Date.now() };

  if (body.title != null) {
    const t = str(body.title, { max: LIMIT.title });
    if (!t) fail(400, 'E_VALIDATION', '名称不能为空', { field: 'title' });
    patch.title = t;
  }
  if (body.note != null) patch.note = str(body.note, { max: LIMIT.note }) || '';
  if (body.cats !== undefined) patch.cats = normCats(store, body.cats);
  const kindPatch = text(body.kind, 20);
  if (body.kind != null && KINDS.has(kindPatch)) patch.kind = kindPatch;
  if (body.x != null) patch.x = coord(body.x, doc.x);
  if (body.y != null) patch.y = coord(body.y, doc.y);
  if (body.w != null) patch.w = num(body.w, { min: 180, max: 900, def: doc.w });
  if (body.h != null) patch.h = num(body.h, { min: 80, max: 900, def: doc.h });
  if (body.color != null) patch.color = normColor(body.color, doc.color);
  if (body.nodes !== undefined || body.edges !== undefined) {
    const graph = normGraph({
      nodes: body.nodes !== undefined ? body.nodes : doc.nodes,
      edges: body.edges !== undefined ? body.edges : doc.edges,
    });
    patch.nodes = graph.nodes;
    patch.edges = graph.edges;
  }

  const next = store.update('boards', id, patch);
  bump(store);
  return normBoardOut(next);
}

export function deleteBoard(store, id) {
  if (!store.remove('boards', id)) fail(404, 'E_NOT_FOUND', '画板不存在');
  bump(store);
  return { deleted: true };
}
