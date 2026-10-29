/* 项目收集 */

import { $, $$, esc, hostOf, toast, emptyState, observeReveal } from '../core/ui.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { openItemModal } from '../ui/modal.js';
import { pheadHTML } from '../ui/page-head.js';

const filter = { cat: 'all', q: '' };

function catCount(id) {
  return store.items.filter((i) => (i.catId || '') === id).length;
}

function filteredItems() {
  const q = filter.q.trim().toLowerCase();
  return store.items
    .filter((i) => {
      if (filter.cat !== 'all' && (i.catId || '') !== filter.cat) return false;
      if (!q) return true;
      return `${i.title} ${i.code || ''} ${i.note || ''} ${hostOf(i.url)}`.toLowerCase().includes(q);
    })
    .slice()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function cardHTML(it, i) {
  const cat = store.data.categories.find((c) => c.id === it.catId);
  const host = it.url ? hostOf(it.url) : '';
  return `
    <article class="dcard" data-id="${it.id}" style="animation-delay:${Math.min(i * 35, 300)}ms">
      <div class="dcard__top">
        <span class="dcard__code">${esc(it.code || '—')}</span>
        <span class="dcard__tag">${esc(cat ? cat.name : '未分类')}</span>
      </div>
      <h3 class="dcard__title">${esc(it.title)}</h3>
      <p class="dcard__desc">${esc(it.note || '')}</p>
      <div class="dcard__foot">
        ${it.url
          ? `<a class="dcard__link" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer"><em>${esc(host)}</em><span>↗</span></a>`
          : '<span class="dcard__link"><em>无链接</em></span>'}
        <span class="dcard__acts">
          <button type="button" data-item-edit="${it.id}">编辑</button>
          <button type="button" class="danger" data-item-del="${it.id}">删除</button>
        </span>
      </div>
    </article>`;
}

function metaHTML() {
  return `
    <span>RECORDS <b id="mItems">${store.items.length}</b></span>
    <span>CATEGORIES <b id="mCats">${store.categories.length}</b></span>`;
}

function sideHTML(isOwner) {
  const cats = store.categories.map((c) => `
    <div class="cat${filter.cat === c.id ? ' is-on' : ''}" role="button" tabindex="0" data-cat="${c.id}">
      <span class="cat__name">${esc(c.name)}</span>
      <span class="cat__n">${catCount(c.id)}</span>
      ${isOwner ? `<button type="button" class="cat__x" data-cat-del="${c.id}" aria-label="删除分类">✕</button>` : ''}
    </div>`).join('');

  return `
    <aside class="side">
      <div class="side__h"><span>分类 / Categories</span><span>${store.categories.length}</span></div>
      <div class="cats">
        <div class="cat${filter.cat === 'all' ? ' is-on' : ''}" role="button" tabindex="0" data-cat="all">
          <span class="cat__name">全部项目</span><span class="cat__n">${store.items.length}</span>
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

export async function mount({ isOwner }) {
  const app = $('#app');
  app.innerHTML = `
    <section class="page page--archive">
      ${pheadHTML('01', '项目收集', 'Collection / Archive', metaHTML())}
      <div class="archive">
        ${sideHTML(isOwner)}
        <div class="content">
          <div class="toolbar">
            <label class="search">
              <span class="search__ico">⌕</span>
              <input id="q" type="search" placeholder="检索编号 / 名称 / 备注 / 域名" autocomplete="off" value="${esc(filter.q)}">
            </label>
            ${isOwner ? '<button type="button" class="btn btn--primary" data-item-new>＋ 新建项目</button>' : ''}
          </div>
          <div class="cards" id="cards"></div>
        </div>
      </div>
    </section>`;

  paint();
  observeReveal(app);

  function paint() {
    const wrap = $('#cards');
    if (!wrap) return;
    const list = filteredItems();
    if (!list.length) {
      const none = store.items.length === 0;
      wrap.innerHTML = emptyState({
        kicker: none ? 'no records' : 'no match',
        title: none ? '档案柜还是空的' : '没有符合条件的项目',
        hint: none
          ? (isOwner ? '点击右上「新建项目」收录第一个条目，先建分类也可以。' : '所有者还没有收录任何条目。')
          : '换个关键词，或切回「全部」分类。',
        action: none && isOwner ? '<button type="button" class="btn btn--primary" data-item-new>＋ 新建项目</button>' : '',
      });
    } else {
      wrap.innerHTML = list.map(cardHTML).join('');
    }
  }

  function paintSide() {
    const side = $('.side', app);
    if (side) side.outerHTML = sideHTML(isOwner);
  }

  function refreshMeta() {
    const mi = $('#mItems'); const mc = $('#mCats');
    if (mi) mi.textContent = store.items.length;
    if (mc) mc.textContent = store.categories.length;
  }

  /* ---------- 事件 ---------- */
  app.addEventListener('click', async (e) => {
    const catEl = e.target.closest('[data-cat]');
    const catDel = e.target.closest('[data-cat-del]');
    const itemNew = e.target.closest('[data-item-new]');
    const itemEdit = e.target.closest('[data-item-edit]');
    const itemDel = e.target.closest('[data-item-del]');

    if (catDel) {
      e.stopPropagation();
      if (!isOwner) return;
      const id = catDel.dataset.catDel;
      const name = store.categoryName(id);
      const n = catCount(id);
      if (!confirm(`删除分类「${name}」？${n ? `其中 ${n} 个项目将移入「未分类」。` : ''}`)) return;
      try {
        await api.del(`/api/categories/${id}`);
        store.removeCategory(id);
        if (filter.cat === id) filter.cat = 'all';
        paintSide(); paint(); refreshMeta();
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

    if (itemNew) {
      if (!isOwner) return;
      openItemModal({
        item: null,
        categories: store.categories,
        onSaved: () => { paint(); refreshMeta(); },
      });
      return;
    }

    if (itemEdit) {
      if (!isOwner) return;
      const item = store.items.find((x) => x.id === itemEdit.dataset.itemEdit);
      if (!item) return;
      openItemModal({
        item,
        categories: store.categories,
        onSaved: () => { paint(); refreshMeta(); },
      });
      return;
    }

    if (itemDel) {
      if (!isOwner) return;
      const item = store.items.find((x) => x.id === itemDel.dataset.itemDel);
      if (!item) return;
      if (!confirm(`删除记录「${item.title}」？此操作不可撤销。`)) return;
      try {
        await api.del(`/api/items/${item.id}`);
        store.removeItem(item.id);
        paint(); paintSide(); refreshMeta();
        toast('记录已删除');
      } catch (err) { toast(err.message || '删除失败'); }
    }
  });

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
    if (store.categories.some((c) => c.name === name)) { toast('分类已存在'); input.select(); return; }
    try {
      const cat = await api.post('/api/categories', { name });
      store.addCategory({ ...cat, id: cat.id || cat._id });
      paintSide(); refreshMeta();
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
