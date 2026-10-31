/* 项目收集 */

import { $, $$, esc, hostOf, toast, emptyState, observeReveal } from '../core/ui.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { openItemEditor, openCategoryPicker, ARCHIVE_ID } from '../ui/item-editor.js';
import { pheadHTML } from '../ui/page-head.js';

const ARCHIVE_NAME = 'SCP-6183-A';
const WIKI_HOME = 'https://scp-wiki-cn.wikidot.com/';

/** cat: 当前分类 / q: 检索词 / mode: include 只看匹配，exclude 只看不匹配 */
const filter = { cat: 'all', q: '', mode: 'include' };

const catsOf = (it) => {
  const list = Array.isArray(it.catIds) ? it.catIds.filter(Boolean) : [];
  return list.length ? list : it.catId ? [it.catId] : [];
};
const catObj = (id) => store.data.categories.find((c) => c.id === id) || null;
/** 只躺在归档分类里的条目：视作「副本」，不进「全部项目」 */
const isArchiveOnly = (it) => {
  const cs = catsOf(it);
  return cs.length === 1 && cs[0] === ARCHIVE_ID;
};

/* ---------------- 检索 ---------------- */

/** SCP 维基习惯：空格 = 同时满足，-词 = 排除，"短语" = 精确片段 */
function parseQuery(raw) {
  const out = [];
  const re = /(-?)("([^"]*)"|(\S+))/g;
  let m = re.exec(raw);
  while (m) {
    const neg = m[1] === '-';
    const term = String(m[3] != null ? m[3] : m[4] || '').trim().toLowerCase();
    if (term) out.push({ neg, term });
    m = re.exec(raw);
  }
  return out;
}

function haystack(it) {
  const names = catsOf(it).map((id) => (catObj(id) || {}).name || '').join(' ');
  return `${it.code || ''} ${it.title || ''} ${it.note || ''} ${names}`.toLowerCase();
}

function matches(it, terms) {
  if (!terms.length) return true;
  const hay = haystack(it);
  for (const t of terms) {
    const has = hay.includes(t.term);
    if (t.neg ? has : !has) return false;
  }
  return true;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 把命中的词在文本里标出来（先切分再转义，避免破坏 HTML 实体） */
function hl(text, terms) {
  const raw = String(text == null ? '' : text);
  const pos = terms.filter((t) => !t.neg).map((t) => escapeRe(t.term)).filter(Boolean);
  if (!pos.length) return esc(raw);
  const re = new RegExp(`(${pos.join('|')})`, 'gi');
  return raw.split(re).map((part, i) => (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part))).join('');
}

/* ---------------- 视图 ---------------- */

function catCount(id) {
  if (id === 'all') return store.items.filter((i) => !isArchiveOnly(i)).length;
  return store.items.filter((i) => catsOf(i).includes(id)).length;
}

function filteredItems() {
  const terms = parseQuery(filter.q);
  const keep = filter.mode === 'exclude' ? (it) => !matches(it, terms) : (it) => matches(it, terms);
  return store.items
    .filter((i) => {
      const cs = catsOf(i);
      if (filter.cat === 'all') { if (isArchiveOnly(i)) return false; }
      else if (!cs.includes(filter.cat)) return false;
      return keep(i);
    })
    .slice()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function cardHTML(it, i, terms) {
  const cs = catsOf(it);
  const displayId = it.displayCatId && cs.includes(it.displayCatId) ? it.displayCatId : cs[0];
  const cat = displayId ? catObj(displayId) : null;
  const extra = cs.length > 1 ? `<span class="dcard__more">+${cs.length - 1}</span>` : '';
  const host = it.url ? hostOf(it.url) : '';
  const delay = Math.min(i * 32, 280);

  return `
    <article class="dcard${it.snapshotOf ? ' is-copy' : ''}" data-id="${it.id}" style="animation-delay:${delay}ms">
      <div class="dcard__top">
        <span class="dcard__code">${hl(it.code || '—', terms)}</span>
        <span class="dcard__tax">
          <span class="dcard__tag">${esc(cat ? cat.name : '未分类')}${extra}</span>
          <button class="dcard__taxedit" type="button" data-item-tax="${it.id}" data-owner-only>编辑分类</button>
        </span>
      </div>
      <div class="dcard__mid">
        <div class="dcard__text">
          <h3 class="dcard__title">${hl(it.title, terms)}</h3>
          <p class="dcard__desc">${it.note ? hl(it.note, terms) : '<span class="dcard__none">—</span>'}</p>
        </div>
        ${it.image
          ? `<div class="dcard__art"><img src="${esc(it.image)}" alt="" loading="lazy" decoding="async"></div>`
          : ''}
      </div>
      <div class="dcard__foot">
        ${it.url
          ? `<a class="dcard__link" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer"><em>${esc(host)}</em><span>↗</span></a>`
          : '<span class="dcard__link dcard__link--off"><em>无链接</em></span>'}
        <span class="dcard__acts">
          <button type="button" data-item-edit="${it.id}">编辑</button>
          <button type="button" class="danger" data-item-del="${it.id}">删除</button>
        </span>
      </div>
    </article>`;
}

function metaHTML() {
  return `
    <span>RECORDS <b id="mItems">${store.items.filter((i) => !isArchiveOnly(i)).length}</b></span>
    <span>CATEGORIES <b id="mCats">${store.categories.length}</b></span>
    <span>ARCHIVED <b id="mArch">${store.items.filter((i) => isArchiveOnly(i)).length}</b></span>`;
}

function sideHTML(isOwner) {
  const cats = store.categories.map((c) => {
    const on = filter.cat === c.id;
    return `
    <div class="cat${on ? ' is-on' : ''}${c.locked ? ' is-locked' : ''}" role="button" tabindex="0" data-cat="${c.id}">
      <span class="cat__name">${esc(c.name)}</span>
      <span class="cat__n">${catCount(c.id)}</span>
      ${isOwner && !c.locked ? `<button type="button" class="cat__x" data-cat-del="${c.id}" aria-label="删除分类">✕</button>` : ''}
    </div>`;
  }).join('');

  return `
    <aside class="side">
      <div class="side__h"><span>分类 / Categories</span><span>${store.categories.length}</span></div>
      <div class="cats">
        <div class="cat${filter.cat === 'all' ? ' is-on' : ''}" role="button" tabindex="0" data-cat="all">
          <span class="cat__name">全部项目</span><span class="cat__n">${catCount('all')}</span>
        </div>
        ${cats}
      </div>
      ${isOwner ? `
      <div class="side__add">
        <button type="button" class="side__new" data-cat-form>＋ 新建分类</button>
        <form class="side__form" id="catForm" hidden>
          <input class="mini" name="name" placeholder="分类名称" maxlength="24" autocomplete="off">
          <div class="side__acts">
            <button type="submit" class="btn btn--primary">建立</button>
            <button type="button" class="btn" data-cat-cancel>取消</button>
          </div>
        </form>
      </div>` : ''}
    </aside>`;
}

function toolbarHTML(isOwner) {
  return `
    <div class="toolbar">
      <div class="searchwrap">
        <label class="search">
          <span class="search__ico">⌕</span>
          <input id="q" type="search" placeholder="检索 编号 / 名称 / 备注 / 分类" autocomplete="off" value="${esc(filter.q)}">
        </label>
        <div class="search__row">
          <div class="modes" role="group" aria-label="检索方式">
            <button type="button" class="mode${filter.mode === 'include' ? ' is-on' : ''}" data-mode="include">筛选</button>
            <button type="button" class="mode${filter.mode === 'exclude' ? ' is-on' : ''}" data-mode="exclude">排除</button>
          </div>
          <span class="search__hint">空格 = 同时满足 · <b>-词</b> = 排除 · <b>"短语"</b> = 精确</span>
        </div>
      </div>
      ${isOwner ? '<button type="button" class="btn btn--primary" data-item-new>＋ 新建项目</button>' : ''}
    </div>`;
}

function randomBtnHTML() {
  return `<button class="randombox" type="button" data-random title="随机打开一条已收录的链接">
    <span class="randombox__k">↻</span><span class="randombox__t">随机页面</span>
  </button>`;
}

/* ---------------- 挂载 ---------------- */
export async function mount({ isOwner }) {
  const app = $('#app');
  app.innerHTML = `
    <section class="page page--archive">
      ${pheadHTML('01', '项目收集', 'Collection / Archive', metaHTML(), randomBtnHTML())}
      <div class="archive">
        ${sideHTML(isOwner)}
        <div class="content">
          ${toolbarHTML(isOwner)}
          <div class="cards" id="cards"></div>
        </div>
      </div>
    </section>`;

  const terms = () => parseQuery(filter.q);

  paint();
  observeReveal(app);

  // 配图文件被回收 / 丢失时不留下破图标，整块让位给文字
  const cardsEl = $('#cards');
  if (cardsEl) {
    cardsEl.addEventListener('error', (e) => {
      const img = e.target;
      if (!img || img.tagName !== 'IMG') return;
      const art = img.closest('.dcard__art');
      if (art) art.remove();
    }, true);
  }

  function paint() {
    const wrap = $('#cards');
    if (!wrap) return;
    const list = filteredItems();
    const t = parseQuery(filter.q);
    wrap.classList.toggle('is-redacted', filter.cat === ARCHIVE_ID);

    if (!list.length) {
      const none = store.items.length === 0;
      const inArchive = filter.cat === ARCHIVE_ID;
      wrap.innerHTML = emptyState({
        kicker: inArchive ? 'deleted / department' : none ? 'no records' : 'no match',
        title: inArchive ? '「内部」已撤除' : none ? '档案柜还是空的' : '没有符合条件的项目',
        hint: inArchive
          ? '这个部门曾经的图片已被移除。留下的噪点仍在自行复制，偶尔会浮出旧条目的影子。'
          : none
            ? (isOwner ? '点击右上「新建项目」收录第一个条目，先建分类也可以。' : '所有者还没有收录任何条目。')
            : (filter.mode === 'exclude' ? '排除模式下把这些都滤掉了，换个词试试。' : '换个关键词，或切回「全部」分类。'),
        action: none && isOwner ? '<button type="button" class="btn btn--primary" data-item-new>＋ 新建项目</button>' : '',
      });
      return;
    }
    wrap.innerHTML = list.map((it, i) => cardHTML(it, i, t)).join('');
  }

  function paintSide() {
    const side = $('.side', app);
    if (side) side.outerHTML = sideHTML(isOwner);
  }

  function refreshMeta() {
    const mi = $('#mItems'); const mc = $('#mCats'); const ma = $('#mArch');
    if (mi) mi.textContent = store.items.filter((i) => !isArchiveOnly(i)).length;
    if (mc) mc.textContent = store.categories.length;
    if (ma) ma.textContent = store.items.filter((i) => isArchiveOnly(i)).length;
  }

  /** 任何写操作之后整体重取，保证多分类 / 副本 / 计数始终一致 */
  async function reload() {
    await store.load();
    paintSide();
    paint();
    refreshMeta();
  }

  /* ---------- 点击 ---------- */
  app.addEventListener('click', async (e) => {
    const catEl = e.target.closest('[data-cat]');
    const catDel = e.target.closest('[data-cat-del]');
    const itemNew = e.target.closest('[data-item-new]');
    const itemEdit = e.target.closest('[data-item-edit]');
    const itemTax = e.target.closest('[data-item-tax]');
    const itemDel = e.target.closest('[data-item-del]');
    const modeBtn = e.target.closest('[data-mode]');

    if (catDel) {
      e.stopPropagation();
      if (!isOwner) return;
      const id = catDel.dataset.catDel;
      const cat = catObj(id);
      const name = cat ? cat.name : '该分类';
      const n = catCount(id);
      if (!confirm(`删除分类「${name}」？${n ? `其中 ${n} 个项目将从该分类中移除（条目本身不会删除）。` : ''}`)) return;
      try {
        await api.del(`/api/categories/${id}`);
        if (filter.cat === id) filter.cat = 'all';
        await reload();
        toast('分类已删除');
      } catch (err) { toast(err.message || '删除失败'); }
      return;
    }

    if (catEl) {
      filter.cat = catEl.dataset.cat;
      $$('.cat', app).forEach((n) => n.classList.toggle('is-on', n.dataset.cat === filter.cat));
      paint();
      return;
    }

    if (modeBtn) {
      filter.mode = modeBtn.dataset.mode === 'exclude' ? 'exclude' : 'include';
      $$('.mode', app).forEach((b) => b.classList.toggle('is-on', b.dataset.mode === filter.mode));
      paint();
      return;
    }

    if (itemNew) {
      if (!isOwner) return;
      // 归档分类是"旧版本"的去处，新条目不该直接落进去
      const preset = filter.cat !== 'all' && filter.cat !== ARCHIVE_ID ? filter.cat : null;
      openItemEditor({
        item: null,
        categories: store.categories,
        presetCatId: preset,
        onSaved: reload,
      });
      return;
    }

    if (itemTax) {
      if (!isOwner) return;
      const item = store.items.find((x) => x.id === itemTax.dataset.itemTax);
      if (!item) return;
      openCategoryPicker({
        categories: store.categories,
        catIds: catsOf(item),
        displayCatId: item.displayCatId || null,
        onDone: async ({ catIds, displayCatId }) => {
          try {
            await api.patch(`/api/items/${item.id}`, { catIds, displayCatId });
            await reload();
            toast('分类已更新');
          } catch (err) { toast(err.message || '更新失败'); }
        },
      });
      return;
    }

    if (itemEdit) {
      if (!isOwner) return;
      const item = store.items.find((x) => x.id === itemEdit.dataset.itemEdit);
      if (!item) return;
      openItemEditor({ item, categories: store.categories, onSaved: reload });
      return;
    }

    if (itemDel) {
      if (!isOwner) return;
      const item = store.items.find((x) => x.id === itemDel.dataset.itemDel);
      if (!item) return;
      if (!confirm(`删除记录「${item.title}」？此操作不可撤销。`)) return;
      try {
        await api.del(`/api/items/${item.id}`);
        await reload();
        toast('记录已删除');
      } catch (err) { toast(err.message || '删除失败'); }
      return;
    }

    if (e.target.closest('[data-random]')) {
      const pool = store.items.filter((i) => !isArchiveOnly(i) && /^https?:\/\//i.test(i.url || ''));
      if (!pool.length) {
        toast('还没有可跳转的链接，回到维基主页');
        setTimeout(() => { location.href = WIKI_HOME; }, 420);
        return;
      }
      const pick = pool[Math.floor(Math.random() * pool.length)];
      location.href = pick.url;
    }
  });

  /* ---------- 分类新建 ---------- */
  app.addEventListener('click', (e) => {
    const showBtn = e.target.closest('[data-cat-form]');
    const cancelBtn = e.target.closest('[data-cat-cancel]');
    const form = $('#catForm');
    if (showBtn && form) { form.hidden = false; form.querySelector('input').focus(); }
    if (cancelBtn && form) { form.hidden = true; form.reset(); }
  });

  app.addEventListener('submit', async (e) => {
    if (e.target.id !== 'catForm') return;
    e.preventDefault();
    const input = e.target.querySelector('input');
    const name = (input.value || '').trim();
    if (!name) { input.focus(); return; }
    if (name.toUpperCase() === ARCHIVE_NAME) { toast('该名称为系统归档分类保留'); input.select(); return; }
    if (store.categories.some((c) => c.name === name)) { toast('分类已存在'); input.select(); return; }
    try {
      await api.post('/api/categories', { name });
      await reload();
      const f = $('#catForm');
      if (f) { f.hidden = true; f.reset(); }
      toast('分类已建立');
    } catch (err) { toast(err.message || '建立失败'); }
  });

  app.addEventListener('input', (e) => {
    if (e.target.id !== 'q') return;
    filter.q = e.target.value;
    paint();
  });

  app.addEventListener('keydown', (e) => {
    const cat = e.target.closest('[data-cat]');
    if (cat && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      cat.click();
    }
  });
}
