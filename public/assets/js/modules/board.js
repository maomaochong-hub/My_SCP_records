/**
 * 画布引擎：节点 + 连线。
 *
 * 一个引擎同时服务三种场景——
 *   项目收集的「连接板」：节点是条目简化形式
 *   灵感写作的压缩条目面：节点是已保存的画板
 *   纯画板：文字 / 图片 / 手绘 / 形状
 *
 * 不做缩放，画布随内容撑大、外层滚动。所有坐标都是舞台坐标。
 */

import { esc } from '../core/ui.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uid = (p) => `${p}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;

/* ---------------- 几何 ---------------- */

/** 从节点中心朝 target 方向，射线与节点边框的交点 */
function anchor(n, tx, ty) {
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const hw = n.w / 2;
  const hh = n.h / 2;
  const sx = dx ? hw / Math.abs(dx) : Infinity;
  const sy = dy ? hh / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

/* ---------------- 形状 / 笔画 ---------------- */

function shapeSVG(n) {
  const w = Math.max(4, n.w);
  const h = Math.max(4, n.h);
  const c = n.color || '#cfd2c9';
  const pad = 2;
  const rot = n.rot ? ` transform="rotate(${n.rot} ${w / 2} ${h / 2})"` : '';
  const open = `<svg class="bdn__svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" fill="none" stroke="${esc(c)}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><g${rot}>`;
  const close = '</g></svg>';
  switch (n.shape) {
    case 'circle':
      return `${open}<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2 - pad}" ry="${h / 2 - pad}"/>${close}`;
    case 'triangle':
      return `${open}<path d="M ${w / 2} ${pad} L ${w - pad} ${h - pad} L ${pad} ${h - pad} Z"/>${close}`;
    case 'arrow': {
      const y = h / 2;
      const head = Math.min(14, w / 3);
      return `${open}<path d="M ${pad} ${y} L ${w - pad} ${y}"/><path d="M ${w - pad - head} ${y - head * 0.62} L ${w - pad} ${y} L ${w - pad - head} ${y + head * 0.62}"/>${close}`;
    }
    case 'angle': {
      const x = pad + 1;
      const y = h - pad - 1;
      const r = Math.min(w, h) * 0.72;
      const a1 = -Math.PI / 6;
      const a2 = -Math.PI / 2.6;
      const p1 = [x + Math.cos(a1) * r, y + Math.sin(a1) * r];
      const p2 = [x + Math.cos(a2) * r, y + Math.sin(a2) * r];
      return `${open}<path d="M ${x} ${y} L ${p1[0].toFixed(1)} ${p1[1].toFixed(1)}"/><path d="M ${x} ${y} L ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}"/><path d="M ${x + 22} ${y} A 22 22 0 0 0 ${x + 22 * Math.cos(a2)} ${y + 22 * Math.sin(a2)}"/>${close}`;
    }
    case 'line':
      return `${open}<path d="M ${pad} ${h - pad} L ${w - pad} ${pad}"/>${close}`;
    case 'rect':
    default:
      return `${open}<rect x="${pad}" y="${pad}" width="${w - pad * 2}" height="${h - pad * 2}"/>${close}`;
  }
}

function strokeSVG(n) {
  const pts = Array.isArray(n.points) ? n.points : [];
  if (pts.length < 2) return '';
  const d = pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  return `<svg class="bdn__svg" viewBox="0 0 ${n.w} ${n.h}" width="${n.w}" height="${n.h}" fill="none"
    stroke="${esc(n.color || '#cfd2c9')}" stroke-width="${n.width || 2}" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
}

/* ---------------- 引擎 ---------------- */

export function createBoard(root, options = {}) {
  const opts = {
    nodes: [],
    edges: [],
    tool: 'select',
    color: '#d8443a',
    editable: true,
    tools: [],
    minW: 1800,
    minH: 980,
    lookupBoard: null,
    onChange: null,
    onEdgeActivate: null,
    onNeedImage: null,
    onPickChange: null,
    onSelect: null,
    createOnDblClick: true,
  };
  Object.assign(opts, options);

  let nodes = (opts.nodes || []).map((n) => ({ ...n }));
  let edges = (opts.edges || []).map((e) => ({ ...e }));
  let tool = opts.tool;
  let color = opts.color;
  let pick = [];
  const marked = new Set();     // 待删除的节点 / 连线
  let focusId = null;

  root.classList.add('bd');
  root.innerHTML = `
    <div class="bd__stage">
      <svg class="bd__edges" xmlns="${SVG_NS}"></svg>
      <div class="bd__labels"></div>
      <div class="bd__nodes"></div>
    </div>`;

  const stage = root.querySelector('.bd__stage');
  const svg = root.querySelector('.bd__edges');
  const nodesEl = root.querySelector('.bd__nodes');
  const labelsEl = root.querySelector('.bd__labels');

  const byId = (id) => nodes.find((n) => n.id === id) || null;
  const sizeOf = () => {
    let x = 0;
    let y = 0;
    for (const n of nodes) {
      x = Math.max(x, n.x + n.w);
      y = Math.max(y, n.y + n.h);
    }
    return { w: Math.max(opts.minW, x + 260), h: Math.max(opts.minH, y + 260) };
  };

  function applySize() {
    const s = sizeOf();
    stage.style.width = `${s.w}px`;
    stage.style.height = `${s.h}px`;
    svg.setAttribute('viewBox', `0 0 ${s.w} ${s.h}`);
    svg.setAttribute('width', s.w);
    svg.setAttribute('height', s.h);
  }

  /* ---------- 节点 ---------- */

  function boardOf(id) {
    return opts.lookupBoard ? opts.lookupBoard(id) : null;
  }

  function nodeInner(n) {
    switch (n.type) {
      case 'ref':
        return `<div class="bdn__hd"><span class="bdn__code">${esc(n.code || '—')}</span></div>
                <div class="bdn__bd"><span class="bdn__t">${esc(n.title || '')}</span></div>`;
      case 'refboard': {
        const b = boardOf(n.boardId);
        const kind = b ? b.kind : 'idea';
        const label = kind === 'board' ? 'CANVAS' : kind === 'links' ? 'LINK' : 'IDEA';
        const title = b ? b.title : n.title || '已撤除的条目';
        const note = b ? b.note || '' : '';
        const meta = b ? `${(b.nodes || []).length} 节点 · ${(b.edges || []).length} 连线` : '内容不可用';
        return `<div class="bdn__hd"><span class="bdn__flag">${label}</span><span class="bdn__go">双击打开 ↗</span></div>
                <div class="bdn__bd">
                  <span class="bdn__t">${esc(title)}</span>
                  ${note ? `<span class="bdn__note">${esc(note)}</span>` : ''}
                  <span class="bdn__m">${esc(meta)}</span>
                </div>`;
      }
      case 'note':
        return `<div class="bdn__hd"><span class="bdn__flag">NOTE</span></div>
                <div class="bdn__bd bdn__bd--note" data-field="text">${esc(n.text || '')}</div>`;
      case 'text':
        return `<div class="bdn__bd bdn__bd--text" data-field="text" style="font-size:${n.size || 13}px">${esc(n.text || '')}</div>`;
      case 'image':
        return n.image
          ? `<img class="bdn__img" src="${esc(n.image)}" alt="" loading="lazy" decoding="async">`
          : '<div class="bdn__bd bdn__m">无图片</div>';
      case 'shape':
        return shapeSVG(n);
      case 'stroke':
        return strokeSVG(n);
      default:
        return '';
    }
  }

  function nodeEl(n) {
    const el = document.createElement('div');
    el.className = `bdn bdn--${n.type}`;
    el.dataset.id = n.id;
    el.style.cssText = `left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px;z-index:${n.z || 1};`;
    if (n.color && (n.type === 'text' || n.type === 'shape' || n.type === 'stroke')) {
      el.style.color = n.type === 'text' ? n.color : '';
    }
    el.innerHTML = `<span class="bdn__chk" aria-hidden="true"></span>${nodeInner(n)}`;
    return el;
  }

  function paintNodes() {
    nodesEl.innerHTML = '';
    const sorted = nodes.slice().sort((a, b) => (a.z || 1) - (b.z || 1));
    for (const n of sorted) {
      const el = nodeEl(n);
      if (marked.has(n.id) && tool === 'delete') el.classList.add('is-del');
      if (pick.includes(n.id)) el.classList.add('is-pick');
      if (n.id === focusId) el.classList.add('is-focus');
      nodesEl.appendChild(el);
    }
    syncEditable();
  }

  /** 文字可编辑的时机：有编辑权，且不在「点选删除 / 点选连线」的取点状态里 */
  function syncEditable() {
    const on = opts.editable && tool !== 'connect' && tool !== 'delete';
    nodesEl.querySelectorAll('[data-field]').forEach((el) => {
      if (on) el.setAttribute('contenteditable', 'plaintext-only');
      else el.removeAttribute('contenteditable');
    });
  }

  /* ---------- 连线 ---------- */

  function edgeGeom(e) {
    const a = byId(e.from);
    const b = byId(e.to);
    if (!a || !b) return null;
    const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
    const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const p1 = anchor(a, cb.x, cb.y);
    const p2 = anchor(b, ca.x, ca.y);
    const mx = p1.x + (p2.x - p1.x) * 0.4;
    const my = p1.y + (p2.y - p1.y) * 0.4;
    return { p1, p2, mx, my };
  }

  function edgePath(el, e) {
    const g = edgeGeom(e);
    if (!g) return null;
    el.setAttribute('d', `M ${g.p1.x.toFixed(1)} ${g.p1.y.toFixed(1)} L ${g.p2.x.toFixed(1)} ${g.p2.y.toFixed(1)}`);
    return g;
  }

  function chipLabel(note) {
    const t = String(note || '');
    return t.length <= 5 ? t : '查看备注';
  }

  function paintEdges() {
    svg.innerHTML = '';
    for (const e of edges) {
      const g = edgeGeom(e);
      if (!g) continue;
      const group = document.createElementNS(SVG_NS, 'g');
      group.dataset.edge = e.id;
      group.setAttribute('class', 'bde');
      if (marked.has(e.id) && tool === 'delete') group.classList.add('is-del');

      const hit = document.createElementNS(SVG_NS, 'path');
      hit.setAttribute('class', 'bde__hit');
      group.appendChild(hit);

      const line = document.createElementNS(SVG_NS, 'path');
      line.setAttribute('class', 'bde__line');
      line.setAttribute('stroke', e.color || '#8d9188');
      group.appendChild(line);

      group.dataset.id = e.id;
      svg.appendChild(group);
      edgePath(line, e);
      edgePath(hit, e);
    }
    paintLabels();
  }

  function paintLabels() {
    labelsEl.innerHTML = '';
    for (const e of edges) {
      if (!e.note) continue;
      const g = edgeGeom(e);
      if (!g) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `bde__chip${String(e.note).length <= 5 ? ' is-short' : ''}`;
      b.dataset.edge = e.id;
      b.style.left = `${g.mx}px`;
      b.style.top = `${g.my - 13}px`;
      b.textContent = chipLabel(e.note);
      labelsEl.appendChild(b);
    }
  }

  function syncEdges() {
    for (const group of svg.querySelectorAll('.bde')) {
      const e = edges.find((x) => x.id === group.dataset.id);
      if (!e) continue;
      edgePath(group.querySelector('.bde__line'), e);
      edgePath(group.querySelector('.bde__hit'), e);
    }
    for (const chip of labelsEl.querySelectorAll('.bde__chip')) {
      const e = edges.find((x) => x.id === chip.dataset.edge);
      if (!e) continue;
      const g = edgeGeom(e);
      if (!g) continue;
      chip.style.left = `${g.mx}px`;
      chip.style.top = `${g.my - 13}px`;
    }
  }

  /* ---------- 渲染 ---------- */

  function paint() {
    applySize();
    paintNodes();
    paintEdges();
  }

  function changed(reason) {
    if (opts.onChange) opts.onChange(reason || 'edit');
  }

  function topZ() {
    return nodes.reduce((m, n) => Math.max(m, n.z || 1), 0);
  }

  function raise(n) {
    if ((n.z || 1) >= topZ()) return;
    n.z = topZ() + 1;
    const el = nodesEl.querySelector(`.bdn[data-id="${n.id}"]`);
    if (el) el.style.zIndex = n.z;
  }

  /* ---------- 拖拽 ---------- */

  let drag = null;

  function startDrag(e, n, el) {
    const rect = stage.getBoundingClientRect();
    drag = {
      n,
      el,
      ox: e.clientX - rect.left - n.x,
      oy: e.clientY - rect.top - n.y,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
    };
    el.classList.add('is-drag');
    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);
  }

  function onDragMove(ev) {
    if (!drag) return;
    const rect = stage.getBoundingClientRect();
    const nx = Math.round(ev.clientX - rect.left - drag.ox);
    const ny = Math.round(ev.clientY - rect.top - drag.oy);
    if (!drag.moved && Math.abs(ev.clientX - drag.startX) + Math.abs(ev.clientY - drag.startY) < 3) return;
    drag.moved = true;
    drag.n.x = clamp(nx, 0, 14000);
    drag.n.y = clamp(ny, 0, 14000);
    drag.el.style.left = `${drag.n.x}px`;
    drag.el.style.top = `${drag.n.y}px`;
    syncEdges();
  }

  function endDrag() {
    if (!drag) return;
    const { n, el, moved } = drag;
    drag = null;
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', endDrag);
    document.removeEventListener('pointercancel', endDrag);
    if (el) el.classList.remove('is-drag');
    if (moved) {
      applySize();
      changed('move');
    }
    void n;
  }

  /* ---------- 手绘 / 拉框创建 ---------- */

  let drawState = null;

  function startDraw(e) {
    const rect = stage.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const kind = tool.startsWith('shape:') ? 'shape' : tool === 'pen' ? 'stroke' : null;
    if (!kind) return;

    if (kind === 'stroke') {
      const ghost = document.createElementNS(SVG_NS, 'path');
      ghost.setAttribute('class', 'bde__ghost');
      ghost.setAttribute('stroke', color);
      svg.appendChild(ghost);
      drawState = { kind, points: [[x, y]], ghost };
      document.addEventListener('pointermove', drawMove);
      document.addEventListener('pointerup', drawEnd);
    } else {
      const ghost = document.createElement('div');
      ghost.className = 'bdn__ghost';
      nodesEl.appendChild(ghost);
      drawState = { kind, shape: tool.slice(6), x0: x, y0: y, ghost };
      document.addEventListener('pointermove', drawMove);
      document.addEventListener('pointerup', drawEnd);
    }
  }

  function drawMove(ev) {
    if (!drawState) return;
    const rect = stage.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    if (drawState.kind === 'stroke') {
      const last = drawState.points[drawState.points.length - 1];
      if (Math.hypot(x - last[0], y - last[1]) < 2.5) return;
      drawState.points.push([x, y]);
      drawState.ghost.setAttribute('d', drawState.points.map((p, i) => `${i ? 'L' : 'M'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' '));
    } else {
      const sx = Math.min(drawState.x0, x);
      const sy = Math.min(drawState.y0, y);
      const w = Math.abs(x - drawState.x0);
      const h = Math.abs(y - drawState.y0);
      drawState.ghost.style.cssText = `left:${sx}px;top:${sy}px;width:${w}px;height:${h}px;border-color:${color}`;
      drawState.rect = { x: sx, y: sy, w, h };
    }
  }

  function drawEnd() {
    document.removeEventListener('pointermove', drawMove);
    document.removeEventListener('pointerup', drawEnd);
    const st = drawState;
    drawState = null;
    if (!st) return;

    if (st.kind === 'stroke') {
      st.ghost.remove();
      if (st.points.length < 2) return;
      const xs = st.points.map((p) => p[0]);
      const ys = st.points.map((p) => p[1]);
      const minX = Math.min(...xs) - 2;
      const minY = Math.min(...ys) - 2;
      const w = Math.max(6, Math.max(...xs) - minX + 2);
      const h = Math.max(6, Math.max(...ys) - minY + 2);
      const node = {
        id: uid('nd'), type: 'stroke',
        x: Math.round(minX), y: Math.round(minY), w: Math.round(w), h: Math.round(h),
        z: topZ() + 1, color,
        points: st.points.map((p) => [Number((p[0] - minX).toFixed(1)), Number((p[1] - minY).toFixed(1))]),
        width: 2,
      };
      nodes.push(node);
      paint();
      changed('add');
      return;
    }

    st.ghost.remove();
    const r = st.rect;
    if (!r) return;
    const linear = st.shape === 'arrow' || st.shape === 'line';
    let { x, y, w, h } = r;
    if (linear) {
      // 箭头 / 直线常常是水平或垂直画出来的，另一轴要补一个最小高度
      if (Math.max(w, h) < 12) return;
      if (w < 26) { w = 26; x = r.x + r.w / 2 - 13; }
      if (h < 26) { h = 26; y = r.y + r.h / 2 - 13; }
    } else if (w < 10 || h < 10) {
      return;
    }
    const node = {
      id: uid('nd'), type: 'shape', shape: st.shape,
      x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h),
      z: topZ() + 1, color, rot: 0,
    };
    nodes.push(node);
    paint();
    changed('add');
  }

  /* ---------- 交互 ---------- */

  root.addEventListener('pointerdown', (e) => {
    const chk = e.target.closest('.bdn__chk');
    const nodeElDom = e.target.closest('.bdn');
    const chip = e.target.closest('.bde__chip');
    const edgeEl = e.target.closest('.bde');

    if (chip) { e.preventDefault(); return; }

    if (edgeEl && !nodeElDom) {
      const edge = edges.find((x) => x.id === edgeEl.dataset.id);
      if (!edge) return;
      if (tool === 'delete') {
        e.preventDefault();
        if (marked.has(edge.id)) marked.delete(edge.id); else marked.add(edge.id);
        edgeEl.classList.toggle('is-del', marked.has(edge.id));
        notifyPick();
        return;
      }
      e.preventDefault();
      if (opts.onEdgeActivate) opts.onEdgeActivate(edge, 'edit');
      return;
    }

    if (nodeElDom) {
      const n = byId(nodeElDom.dataset.id);
      if (!n) return;

      if (tool === 'delete') {
        e.preventDefault();
        if (marked.has(n.id)) marked.delete(n.id); else marked.add(n.id);
        nodeElDom.classList.toggle('is-del', marked.has(n.id));
        notifyPick();
        return;
      }

      if (tool === 'connect') {
        e.preventDefault();
        if (pick.includes(n.id)) pick = pick.filter((x) => x !== n.id);
        else pick = [...pick, n.id].slice(-2);
        paintNodes();
        notifyPick();
        return;
      }

      if (chk) return;

      focusId = n.id;
      raise(n);
      if (opts.onSelect) opts.onSelect(n);

      if (opts.editable && tool === 'select' && !e.target.closest('[data-field]')) {
        e.preventDefault();
        startDrag(e, n, nodeElDom);
      }
      return;
    }

    // 空白处
    if (tool === 'select') {
      pick = [];
      paintNodes();
      notifyPick();
      return;
    }
    if (tool === 'text') {
      e.preventDefault();
      addTextAt(e.clientX, e.clientY);
      return;
    }
    if (tool === 'image') {
      e.preventDefault();
      if (opts.onNeedImage) opts.onNeedImage((url) => addImageAt(url, e.clientX, e.clientY));
      return;
    }
    if (tool === 'pen' || tool.startsWith('shape:')) {
      e.preventDefault();
      startDraw(e);
    }
  });

  root.addEventListener('click', (e) => {
    const chip = e.target.closest('.bde__chip');
    if (!chip) return;
    const edge = edges.find((x) => x.id === chip.dataset.edge);
    if (!edge) return;
    if (opts.onEdgeActivate) opts.onEdgeActivate(edge, 'view');
  });

  root.addEventListener('dblclick', (e) => {
    const chip = e.target.closest('.bde__chip');
    if (chip) {
      const edge = edges.find((x) => x.id === chip.dataset.edge);
      if (edge && opts.onEdgeActivate) opts.onEdgeActivate(edge, 'removeNote');
      return;
    }
    if (tool !== 'select' || e.target.closest('.bdn') || !opts.createOnDblClick) return;
    addTextAt(e.clientX, e.clientY, 'note');
  });

  root.addEventListener('input', (e) => {
    const field = e.target.closest('[data-field]');
    if (!field || !opts.editable) return;
    const host = field.closest('.bdn');
    const n = byId(host.dataset.id);
    if (!n) return;
    n.text = field.innerText.replace(/\u00a0/g, ' ');
    changed('text');
  });

  function notifyPick() {
    if (opts.onPickChange) opts.onPickChange(pick.slice(), marked.size);
  }

  /* ---------- 对外方法 ---------- */

  function addTextAt(cx, cy, type = 'text') {
    const rect = stage.getBoundingClientRect();
    const node = {
      id: uid('nd'),
      type,
      x: Math.round(cx - rect.left - 90),
      y: Math.round(cy - rect.top - (type === 'note' ? 40 : 12)),
      w: type === 'note' ? 250 : 180,
      h: type === 'note' ? 150 : 40,
      z: topZ() + 1,
      text: '',
      size: 13,
      color: type === 'note' ? '#e6e3dc' : '#cfd2c9',
    };
    nodes.push(node);
    paint();
    changed('add');
    const el = nodesEl.querySelector(`.bdn[data-id="${node.id}"] [data-field]`);
    if (el) el.focus();
    return node;
  }

  function addImageAt(url, cx, cy) {
    const rect = stage.getBoundingClientRect();
    const node = {
      id: uid('nd'), type: 'image',
      x: Math.round(cx - rect.left - 100),
      y: Math.round(cy - rect.top - 75),
      w: 200, h: 150, z: topZ() + 1, image: url,
    };
    nodes.push(node);
    paint();
    changed('add');
  }

  function addSymbol(symbol) {
    const node = {
      id: uid('nd'), type: 'text',
      x: 80 + Math.random() * 120, y: 80 + Math.random() * 80,
      w: 90, h: 64, z: topZ() + 1,
      text: symbol, size: 34, color: '#cfd2c9',
    };
    nodes.push(node);
    paint();
    changed('add');
    return node;
  }

  function connect() {
    if (pick.length !== 2) return null;
    const [a, b] = pick;
    if (edges.some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a))) {
      pick = [];
      paintNodes();
      notifyPick();
      return { duplicate: true };
    }
    const edge = { id: uid('eg'), from: a, to: b, color, note: '' };
    edges.push(edge);
    pick = [];
    paint();
    notifyPick();
    changed('connect');
    return edge;
  }

  function deleteMarked() {
    if (!marked.size) return 0;
    const n = marked.size;
    const nodeIds = new Set([...marked].filter((id) => nodes.some((x) => x.id === id)));
    const edgeIds = new Set([...marked].filter((id) => edges.some((x) => x.id === id)));
    nodes = nodes.filter((x) => !nodeIds.has(x.id));
    edges = edges.filter((x) => !edgeIds.has(x.id) && !nodeIds.has(x.from) && !nodeIds.has(x.to));
    marked.clear();
    pick = [];
    paint();
    notifyPick();
    changed('delete');
    return n;
  }

  function setEdgeNote(id, note) {
    const e = edges.find((x) => x.id === id);
    if (!e) return;
    e.note = String(note || '').slice(0, 120);
    paintLabels();
    changed('note');
  }

  function setEdgeColor(id, c) {
    const e = edges.find((x) => x.id === id);
    if (!e) return;
    e.color = c;
    paintEdges();
    changed('color');
  }

  function removeEdge(id) {
    edges = edges.filter((x) => x.id !== id);
    paint();
    changed('delete');
  }

  function removeNode(id) {
    nodes = nodes.filter((x) => x.id !== id);
    edges = edges.filter((x) => x.from !== id && x.to !== id);
    paint();
    changed('delete');
  }

  function setTool(t) {
    tool = t;
    pick = [];
    if (t !== 'delete') marked.clear();
    root.dataset.tool = t;
    paint();
    notifyPick();
  }

  function setColor(c) {
    color = c;
  }

  function getData() {
    return {
      nodes: nodes.map((n) => ({ ...n })),
      edges: edges.map((e) => ({ ...e })),
    };
  }

  /** 供外部（例如在别处新增了压缩条目后）同步数据 */
  function setData(next, { silent } = {}) {
    nodes = (next.nodes || []).map((n) => ({ ...n }));
    edges = (next.edges || []).map((e) => ({ ...e }));
    paint();
    if (!silent) changed('reset');
  }

  function focus(id) {
    focusId = id;
    const n = byId(id);
    if (!n) return;
    raise(n);
    paintNodes();
  }

  function counts() {
    return { nodes: nodes.length, edges: edges.length };
  }

  paint();
  notifyPick();

  return {
    setTool, setColor, connect, deleteMarked, setEdgeNote, setEdgeColor,
    removeEdge, removeNode, getData, setData, focus, counts,
    addSymbol, addTextAt, addImageAt, paint,
    get pick() { return pick.slice(); },
    get marked() { return marked.size; },
  };
}
