/* 灵感写作：压缩条目面 + 网页创作 */

import { $, $$, esc, toast, emptyState } from '../core/ui.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { pheadHTML } from '../ui/page-head.js';
import { createBoard } from '../modules/board.js';
import { openBoardWorkspace, editEdgeNote } from '../ui/board-workspace.js';
import { studioHTML, mountStudio } from '../modules/studio.js';

const filter = { cat: 'all', q: '', mode: 'include' };

const entries = () => store.boards.filter((b) => b.kind === 'idea' || b.kind === 'board');
const surfaceBoard = () => store.boards.find((b) => b.kind === 'surface') || null;
const catObj = (id) => store.categories.find((c) => c.id === id) || null;
const catsOf = (b) => (Array.isArray(b.cats) ? b.cats.filter(Boolean) : []);
const catNames = (b) => catsOf(b).map((id) => (catObj(id) || {}).name || '').join(' ');

/** 检索：名字 / 备注 / 分类名 / 板内所有笔记与条目文字 */
function haystack(b) {
  const inner = (b.nodes || []).map((n) => `${n.text || ''} ${n.title || ''} ${n.code || ''}`).join(' ');
  return `${b.title || ''} ${b.note || ''} ${catNames(b)} ${inner}`.toLowerCase();
}

function parseQuery(raw) {
  const out = [];
  const re = /(-?)("([^"]*)"|(\S+))/g;
  let m = re.exec(raw);
  while (m) {
    const term = String(m[3] != null ? m[3] : m[4] || '').trim().toLowerCase();
    if (term) out.push({ neg: m[1] === '-', term });
    m = re.exec(raw);
  }
  return out;
}

function matches(b, terms) {
  if (!terms.length) return true;
  const hay = haystack(b);
  for (const t of terms) {
    const has = hay.includes(t.term);
    if (t.neg ? has : !has) return false;
  }
  return true;
}

function filtered() {
  const terms = parseQuery(filter.q);
  return entries().filter((b) => {
    if (filter.cat !== 'all' && !catsOf(b).includes(filter.cat)) return false;
    const hit = matches(b, terms);
    return filter.mode === 'exclude' ? !hit : hit;
  });
}

/* ---------------- 选择器 ---------------- */

function openBoardPicker({ list, exclude = [], onPick }) {
  let q = '';
  const taken = new Set(exclude);
  const wrap = document.createElement('div');
  wrap.className = 'modal pick';
  wrap.innerHTML = `
    <div class="modal__bd" data-pk-close></div>
    <div class="modal__pn">
      <header class="modal__hd">
        <span class="modal__k">ADD ENTRIES</span>
        <h2 class="modal__t">添加压缩条目</h2>
        <button class="modal__x" type="button" data-pk-close aria-label="关闭">✕</button>
      </header>
      <label class="search">
        <span class="search__ico">⌕</span>
        <input id="pkQ" type="search" placeholder="检索名称 / 备注" autocomplete="off">
      </label>
      <ul class="pick__list" id="pkList"></ul>
      <footer class="modal__ft">
        <span class="modal__hint">已在分类中的会置灰</span>
        <button class="btn" type="button" data-pk-close>取消</button>
      </footer>
    </div>`;
  (document.getElementById('modal-root') || document.body).appendChild(wrap);

  const listEl = wrap.querySelector('#pkList');
  function paint() {
    const n = q.trim().toLowerCase();
    const rows = list.filter((b) => !n || `${b.title} ${b.note || ''}`.toLowerCase().includes(n));
    listEl.innerHTML = rows.length
      ? rows.map((b) => {
        const off = taken.has(b.id);
        return `<li class="pick__row${off ? ' is-off' : ''}">
          <button type="button" data-pk="${esc(b.id)}" ${off ? 'disabled' : ''}>
            <span class="pick__code">${b.kind === 'board' ? 'CANVAS' : 'IDEA'}</span>
            <span class="pick__title">${esc(b.title)}</span>
          </button></li>`;
      }).join('')
      : '<li class="pick__none">还没有可以添加的条目</li>';
  }
  paint();
  wrap.querySelector('#pkQ').addEventListener('input', (e) => { q = e.target.value; paint(); });
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-pk-close]')) { wrap.remove(); return; }
    const hit = e.target.closest('[data-pk]');
    if (!hit || hit.disabled) return;
    const b = list.find((x) => x.id === hit.dataset.pk);
    wrap.remove();
    if (b && onPick) onPick(b);
  });
  setTimeout(() => wrap.querySelector('#pkQ').focus(), 40);
}

/* ---------------- 挂载 ---------------- */

export async function mount({ isOwner }) {
  const app = $('#app');
  app.innerHTML = `
    <section class="page page--writing${isOwner ? '' : ' is-guest'}">
      ${pheadHTML('02', '灵感写作', 'Notes / Inspiration', metaHTML())}
      <div class="wbar">
        <label class="search">
          <span class="search__ico">⌕</span>
          <input id="wq" type="search" placeholder="检索 名称 / 备注 / 笔记内容 / 分类" autocomplete="off" value="${esc(filter.q)}">
        </label>
        <div class="modes" role="group" aria-label="检索方式">
          <button type="button" class="mode${filter.mode === 'include' ? ' is-on' : ''}" data-wmode="include">筛选</button>
          <button type="button" class="mode${filter.mode === 'exclude' ? ' is-on' : ''}" data-wmode="exclude">排除</button>
        </div>
        ${isOwner ? `
        <button type="button" class="btn btn--primary" data-new-idea>＋ 新建灵感</button>
        <button type="button" class="btn" data-new-board>＋ 新建画板</button>` : ''}
      </div>
      <div class="wgrid">
        <aside class="wside" id="wside"></aside>
        <div class="wsurface">
          <div class="wsurface__bar">
            <span class="wsurface__hint" id="whint"></span>
            ${isOwner ? '<button type="button" class="wsurface__link" data-wconnect>连线模式</button>' : ''}
          </div>
          <div class="wsurface__box" id="surface"></div>
        </div>
      </div>
      ${isOwner ? studioHTML() : ''}
    </section>`;

  let model = { nodes: [], edges: [] };
  let engine = null;
  let saveTimer = null;
  let connectMode = false;

  /* ---------- 数据 ---------- */

  /** 把「所有条目」摊到面上：缺节点的按网格补位，指向已删的节点剔除 */
  function buildModel() {
    const s = surfaceBoard();
    const nodes = (s && Array.isArray(s.nodes) ? s.nodes : []).map((n) => ({ ...n }));
    const edges = (s && Array.isArray(s.edges) ? s.edges : []).map((e) => ({ ...e }));
    const list = entries();

    list.forEach((b, i) => {
      if (nodes.some((n) => n.type === 'refboard' && n.boardId === b.id)) return;
      nodes.push({
        id: `nd_${b.id.slice(-10)}`,
        type: 'refboard',
        boardId: b.id,
        title: b.title,
        x: 48 + (i % 4) * 268,
        y: 44 + Math.floor(i / 4) * 200,
        w: 236, h: 140, z: i + 1,
      });
    });

    const valid = new Set(list.map((b) => b.id));
    const kept = nodes.filter((n) => n.type !== 'refboard' || valid.has(n.boardId));
    const ids = new Set(kept.map((n) => n.id));
    return { nodes: kept, edges: edges.filter((e) => ids.has(e.from) && ids.has(e.to)) };
  }

  function viewOf(m) {
    const show = new Set(filtered().map((b) => b.id));
    const nodes = m.nodes.filter((n) => n.type !== 'refboard' || show.has(n.boardId));
    const ids = new Set(nodes.map((n) => n.id));
    return { nodes, edges: m.edges.filter((e) => ids.has(e.from) && ids.has(e.to)) };
  }

  async function persist() {
    if (!isOwner) return;
    let s = surfaceBoard();
    if (!s) {
      try {
        await api.post('/api/boards', { kind: 'surface', title: '灵感基层', nodes: [], edges: [] });
        await store.load();
        s = surfaceBoard();
      } catch { return; }
      if (!s) return;
    }
    try {
      await api.patch(`/api/boards/${s.id}`, { nodes: model.nodes, edges: model.edges });
    } catch (err) {
      toast(err.message || '位置保存失败');
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 600);
  }

  function syncFromEngine() {
    if (!engine) return;
    const d = engine.getData();
    const map = new Map(model.nodes.map((n) => [n.id, n]));
    for (const n of d.nodes) {
      const t = map.get(n.id);
      if (t) { t.x = n.x; t.y = n.y; t.z = n.z; }
      else model.nodes.push(n);
    }
    for (const e of d.edges) {
      const t = model.edges.find((x) => x.id === e.id);
      if (!t) { model.edges.push(e); continue; }
      t.note = e.note || '';
      t.color = e.color;
    }
  }

  /* ---------- 视图 ---------- */

  function metaHTML() {
    return `
      <span>ENTRIES <b id="wEntries">${entries().length}</b></span>
      <span>CATEGORIES <b>${store.categories.length}</b></span>
      <span>MODE <b>${isOwner ? 'EDITABLE' : 'READ ONLY'}</b></span>`;
  }

  function sideHTML() {
    const list = store.categories.map((c) => {
      const on = filter.cat === c.id;
      const n = entries().filter((b) => catsOf(b).includes(c.id)).length;
      return `<div class="cat${on ? ' is-on' : ''}${c.locked ? ' is-locked' : ''}" role="button" tabindex="0" data-wcat="${esc(c.id)}">
        <span class="cat__name">${esc(c.name)}</span><span class="cat__n">${n}</span>
        ${isOwner && !c.locked ? `<button type="button" class="cat__x" data-wcat-del="${esc(c.id)}" aria-label="删除分类">✕</button>` : ''}
      </div>`;
    }).join('');

    const cur = filter.cat === 'all' ? null : catObj(filter.cat);

    return `
      <div class="side__h"><span>分类 / Categories</span><span>${store.categories.length}</span></div>
      <div class="cats">
        <div class="cat${filter.cat === 'all' ? ' is-on' : ''}" role="button" tabindex="0" data-wcat="all">
          <span class="cat__name">全部条目</span>
          <span class="cat__n">${entries().length}</span>
        </div>
        ${list}
      </div>
      ${isOwner ? `
      <div class="side__add">
        ${cur ? `<button type="button" class="side__new" data-wadd>＋ 添加到「${esc(cur.name)}」</button>` : '<p class="wside__tip">选中一个分类后可以往里添加条目</p>'}
        <button type="button" class="side__new" data-wcat-form>＋ 新建分类</button>
        <form class="side__form" id="wcatForm" hidden>
          <input class="mini" name="name" placeholder="分类名称" maxlength="24" autocomplete="off">
          <div class="side__acts">
            <button type="submit" class="btn btn--primary">建立</button>
            <button type="button" class="btn" data-wcat-cancel>取消</button>
          </div>
        </form>
      </div>` : ''}`;
  }

  function paintSide() {
    const side = $('#wside');
    if (!side) return;
    side.innerHTML = sideHTML();
    const hint = $('#whint');
    if (hint) {
      const n = filtered().length;
      hint.textContent = `${n} 个压缩条目 · 双击打开 · 拖动摆位置${connectMode ? ' · 点两个条目即可连线' : ''}`;
    }
    const cnt = $('#wEntries');
    if (cnt) cnt.textContent = entries().length;
  }

  function mountSurface() {
    const host = $('#surface');
    if (!host) return;
    model = buildModel();
    const view = viewOf(model);

    if (!view.nodes.length) {
      host.innerHTML = emptyState({
        kicker: entries().length ? 'no match' : 'empty surface',
        title: entries().length ? '没有符合条件的条目' : '还没有任何灵感条目',
        hint: entries().length
          ? '换个关键词，或切回「全部条目」。'
          : (isOwner ? '点「新建灵感」开一块空板，写下第一段。保存后会作为压缩条目出现在这里。' : '所有者还没有写下任何灵感。'),
        action: !entries().length && isOwner
          ? '<button type="button" class="btn btn--primary" data-new-idea>＋ 新建灵感</button>' : '',
      });
      engine = null;
      return;
    }

    engine = createBoard(host, {
      nodes: view.nodes,
      edges: view.edges,
      tool: 'select',
      editable: isOwner,
      createOnDblClick: false,
      minW: 1240,
      minH: 620,
      lookupBoard: (id) => store.boards.find((b) => b.id === id) || null,
      onChange: () => { syncFromEngine(); scheduleSave(); },
      onPickChange: (pick) => {
        if (connectMode && pick.length === 2 && engine) {
          const edge = engine.connect();
          if (edge && edge.duplicate) toast('这两个条目已经连着了');
          else if (edge) { syncFromEngine(); scheduleSave(); toast('已连线'); }
        }
      },
      onEdgeActivate: (edge, mode) => {
        if (!isOwner) return;
        if (mode === 'view') { toast(edge.note || '这条线还没有备注'); return; }
        editEdgeNote(edge, {
          onNote: (v) => { engine.setEdgeNote(edge.id, v); syncFromEngine(); scheduleSave(); },
          onColor: (c) => { engine.setEdgeColor(edge.id, c); syncFromEngine(); scheduleSave(); },
        });
      },
    });

    host.addEventListener('dblclick', (e) => {
      const el = e.target.closest('.bdn--refboard');
      if (!el) return;
      const n = view.nodes.find((x) => x.id === el.dataset.id);
      if (!n) return;
      const b = store.boards.find((x) => x.id === n.boardId);
      if (!b) return;
      openEntry(b);
    });
  }

  function repaint() {
    paintSide();
    if (engine) {
      // 已有引擎：只换数据，避免整块重建闪一下
      syncFromEngine();
      engine.setData(viewOf(model), { silent: true });
    } else {
      mountSurface();
    }
  }

  /* ---------- 打开 / 新建 ---------- */

  function openEntry(b) {
    openBoardWorkspace({
      mode: b.kind === 'board' ? 'board' : 'idea',
      board: b,
      boards: store.boards,
      items: store.items,
      onSaved: async () => {
        await store.load();
        mountSurface();
        paintSide();
      },
    });
  }

  function createEntry(kind) {
    openBoardWorkspace({
      mode: kind,
      boards: store.boards,
      items: store.items,
      onSaved: async () => {
        await store.load();
        mountSurface();
        paintSide();
        toast(kind === 'board' ? '画板已保存' : '灵感已保存');
      },
    });
  }

  /* ---------- 事件 ---------- */

  mountSurface();
  paintSide();

  app.addEventListener('click', async (e) => {
    const catEl = e.target.closest('[data-wcat]');
    const catDel = e.target.closest('[data-wcat-del]');
    const addBtn = e.target.closest('[data-wadd]');
    const modeBtn = e.target.closest('[data-wmode]');

    if (catDel) {
      e.stopPropagation();
      const id = catDel.dataset.wcatDel;
      const c = catObj(id);
      if (!confirm(`删除分类「${c ? c.name : ''}」？条目本身不会删除。`)) return;
      try {
        await api.del(`/api/categories/${id}`);
        if (filter.cat === id) filter.cat = 'all';
        await store.load();
        repaint();
        toast('分类已删除');
      } catch (err) { toast(err.message || '删除失败'); }
      return;
    }

    if (catEl) {
      filter.cat = catEl.dataset.wcat || 'all';
      repaint();
      return;
    }

    if (modeBtn) {
      filter.mode = modeBtn.dataset.wmode === 'exclude' ? 'exclude' : 'include';
      $$('[data-wmode]', app).forEach((b) => b.classList.toggle('is-on', b.dataset.wmode === filter.mode));
      repaint();
      return;
    }

    if (e.target.closest('[data-new-idea]')) { if (isOwner) createEntry('idea'); return; }
    if (e.target.closest('[data-new-board]')) { if (isOwner) createEntry('board'); return; }

    if (e.target.closest('[data-wconnect]')) {
      if (!engine) return;
      connectMode = !connectMode;
      engine.setTool(connectMode ? 'connect' : 'select');
      e.target.closest('[data-wconnect]').classList.toggle('is-on', connectMode);
      paintSide();
      return;
    }

    if (addBtn) {
      if (!isOwner || filter.cat === 'all') return;
      const catId = filter.cat;
      openBoardPicker({
        list: entries(),
        exclude: entries().filter((b) => catsOf(b).includes(catId)).map((b) => b.id),
        onPick: async (b) => {
          try {
            const next = [...new Set([...catsOf(b), catId])];
            await api.patch(`/api/boards/${b.id}`, { cats: next });
            await store.load();
            mountSurface();
            paintSide();
            toast(`已加入「${catObj(catId)?.name || ''}」`);
          } catch (err) { toast(err.message || '添加失败'); }
        },
      });
      return;
    }

    const showForm = e.target.closest('[data-wcat-form]');
    const cancelForm = e.target.closest('[data-wcat-cancel]');
    const form = $('#wcatForm');
    if (showForm && form) { form.hidden = false; form.querySelector('input').focus(); }
    if (cancelForm && form) { form.hidden = true; form.reset(); }
  });

  app.addEventListener('input', (e) => {
    if (e.target.id !== 'wq') return;
    filter.q = e.target.value;
    repaint();
  });

  app.addEventListener('submit', async (e) => {
    if (e.target.id !== 'wcatForm') return;
    e.preventDefault();
    const input = e.target.querySelector('input');
    const name = (input.value || '').trim();
    if (!name) { input.focus(); return; }
    if (store.categories.some((c) => c.name === name)) { toast('分类已存在'); input.select(); return; }
    try {
      await api.post('/api/categories', { name });
      await store.load();
      repaint();
      toast('分类已建立');
    } catch (err) { toast(err.message || '建立失败'); }
  });

  if (isOwner) await mountStudio();
}
