/* 条目编辑器 + 分类归属选择面板 */

import { esc, toast } from '../core/ui.js';
import { api } from '../core/api.js';
import { show, closeModal, askConfirm } from './modal.js';
import { prepareItemImage } from '../modules/imgprep.js';

export const ARCHIVE_ID = 'cat_6183a';
const ARCHIVE_NAME = 'SCP-6183-A';

const catsOf = (it) => {
  if (!it) return [];
  const list = Array.isArray(it.catIds) ? it.catIds.filter(Boolean) : [];
  return list.length ? list : it.catId ? [it.catId] : [];
};

function chipHTML(cat, isDisplay) {
  return `<span class="chip${isDisplay ? ' is-display' : ''}">${esc(cat.name)}${isDisplay ? '<i class="chip__pin">主</i>' : ''}</span>`;
}

/* ============================================================
   分类归属：勾选多个分类 + 选一个展示名
   ============================================================ */
export function openCategoryPicker({ categories, catIds = [], displayCatId = null, title = '编辑分类', onDone }) {
  const list = categories.slice();
  const selected = new Set(catIds.filter((id) => list.some((c) => c.id === id)));
  let display = displayCatId && selected.has(displayCatId) ? displayCatId : '';

  const orderedSelected = () => list.filter((c) => selected.has(c.id)).map((c) => c.id);
  const firstSelected = () => orderedSelected()[0] || null;
  const nameOf = (id) => (list.find((c) => c.id === id) || {}).name || '';

  const rows = list.map((c) => `
    <li class="taxrow" data-id="${esc(c.id)}">
      <label class="taxrow__l">
        <input type="checkbox" value="${esc(c.id)}" ${selected.has(c.id) ? 'checked' : ''}>
        <span class="taxrow__box" aria-hidden="true"></span>
        <span class="taxrow__n">${esc(c.name)}</span>
        ${c.locked ? '<span class="taxrow__lock">归档</span>' : ''}
      </label>
    </li>`).join('');

  const wrap = document.createElement('div');
  wrap.className = 'modal tax';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.innerHTML = `
      <div class="modal__bd" data-tax-close></div>
      <div class="modal__pn">
        <header class="modal__hd">
          <span class="modal__k">EDIT TAXONOMY</span>
          <h2 class="modal__t">${esc(title)}</h2>
          <button class="modal__x" type="button" data-tax-close aria-label="关闭">✕</button>
        </header>

        <div class="taxpick__h">
          <span>归属 / MEMBERSHIP</span>
          <span class="taxpick__tools">
            <span id="taxCount"></span>
            <button type="button" class="linkbtn" data-tax-clear>清空</button>
          </span>
        </div>
        <ul class="taxpick__list">${rows || '<li class="taxpick__none">还没有任何分类</li>'}</ul>

        <div class="field">
          <label for="taxDisplay">展示名称 / DISPLAY</label>
          <select id="taxDisplay"></select>
          <p class="field__hint">展示条目右上角显示的分类名。留空则取最上方被勾选的那一项。</p>
        </div>

        <footer class="modal__ft">
          <span class="modal__hint">条目会同时出现在所有勾选的分类页</span>
          <button class="btn" type="button" data-tax-close>取消</button>
          <button class="btn btn--primary" type="button" data-tax-done>分类完成</button>
        </footer>
      </div>`;

  (document.getElementById('modal-root') || document.body).appendChild(wrap);

  const sel = wrap.querySelector('#taxDisplay');
  const cnt = wrap.querySelector('#taxCount');

  function paintSelect() {
    const ids = orderedSelected();
    if (display && !ids.includes(display)) display = '';
    const head = ids.length
      ? `<option value="">默认 · ${esc(nameOf(ids[0]))}</option>`
      : '<option value="">未选择分类</option>';
    sel.innerHTML = head + ids.map((id) => `<option value="${esc(id)}">${esc(nameOf(id))}</option>`).join('');
    sel.value = display || '';
    sel.disabled = !ids.length;
    cnt.textContent = `${ids.length} / ${list.length}`;
  }

  let closed = false;
  function close(payload) {
    if (closed) return;
    closed = true;
    wrap.remove();
    document.removeEventListener('keydown', onKey, true);
    if (payload !== null && onDone) onDone(payload);
  }
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    // 捕获阶段先拦下，避免底下的编辑弹窗一起被关掉
    e.stopPropagation();
    close(null);
  };
  document.addEventListener('keydown', onKey, true);

  wrap.addEventListener('change', (e) => {
    const cb = e.target.closest('input[type=checkbox]');
    if (cb) {
      if (cb.checked) selected.add(cb.value);
      else selected.delete(cb.value);
      paintSelect();
      return;
    }
    if (e.target === sel) display = sel.value || '';
  });

  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-tax-done]')) {
      const ids = orderedSelected();
      close({ catIds: ids, displayCatId: display || ids[0] || null });
      return;
    }
    if (e.target.closest('[data-tax-clear]')) {
      selected.clear();
      display = '';
      wrap.querySelectorAll('input[type=checkbox]').forEach((cb) => { cb.checked = false; });
      paintSelect();
      return;
    }
    if (e.target.closest('[data-tax-close]')) close(null);
  });

  paintSelect();
  setTimeout(() => sel.focus(), 40);
  return wrap;
}

/* ============================================================
   条目编辑器
   ============================================================ */
export function openItemEditor({ item, categories, presetCatId = null, onSaved }) {
  const editing = !!item;
  const startCats = editing ? catsOf(item) : presetCatId && presetCatId !== 'all' ? [presetCatId] : [];
  const state = {
    catIds: startCats.slice(),
    displayCatId: editing ? item.displayCatId || startCats[0] || null : startCats[0] || null,
    image: editing ? item.image || '' : '',
    pending: null,
    working: false,
  };
  if (state.displayCatId && !state.catIds.includes(state.displayCatId)) {
    state.displayCatId = state.catIds[0] || null;
  }
  // 已经躺在归档分类里的副本，不需要再复制一份副本
  const inArchiveOnly = state.catIds.length === 1 && state.catIds[0] === ARCHIVE_ID;

  const body = `
    <div class="field">
      <label for="f-code">① 项目编号 / CODE</label>
      <input id="f-code" name="code" placeholder="SCP-173" spellcheck="false" maxlength="32" value="${esc(item?.code || '')}">
    </div>
    <div class="field">
      <label for="f-title">② 项目名称 / TITLE *</label>
      <input id="f-title" name="title" placeholder="雕像" maxlength="100" value="${esc(item?.title || '')}">
    </div>
    <div class="field">
      <label for="f-url">③ 链接 / URL</label>
      <input id="f-url" name="url" placeholder="https://scp-wiki-cn.wikidot.com/scp-173" spellcheck="false" value="${esc(item?.url || '')}">
    </div>
    <div class="field">
      <span class="field__label">④ 分类 / CATEGORY</span>
      <div class="taxline">
        <div class="taxrow__chips" id="fCats"></div>
        <button type="button" class="linkbtn" data-tax-open>编辑分类</button>
      </div>
      <p class="field__hint">可多选；条目会同时出现在所选分类页。</p>
    </div>
    <div class="field">
      <label for="f-note">⑤ 备注 / NOTE</label>
      <textarea id="f-note" name="note" rows="3" placeholder="为什么收藏它？">${esc(item?.note || '')}</textarea>
    </div>
    <div class="field">
      <span class="field__label">⑥ 图片 / IMAGE</span>
      <div class="shot" id="fShot"></div>
      <input type="file" id="fFile" accept="image/*" hidden>
      <div class="shot__acts">
        <button class="btn" type="button" data-img-pick>插入图片</button>
        <button class="btn" type="button" data-img-clear hidden>移除图片</button>
      </div>
      <p class="field__hint">选中后自动去除背景并淡化，统一为方形缩略图，显示在展示条目右侧。</p>
    </div>
    <div class="field__err" id="modalErr"></div>`;

  const el = show({
    kicker: editing ? 'EDIT RECORD' : 'NEW RECORD',
    title: editing ? '编辑记录' : '新建项目',
    body,
    submit: editing ? '编辑完成' : '保存记录',
    hint: editing ? '完成前会询问是否保留修改前的副本' : '保存后写入服务器，所有访客同步可见',
    onSubmit: async (fd) => {
      const title = String(fd.get('title') || '').trim();
      if (!title) {
        document.getElementById('f-title')?.focus();
        throw new Error('请填写项目名称');
      }
      const payload = {
        code: String(fd.get('code') || '').trim() || '—',
        title,
        url: String(fd.get('url') || '').trim(),
        note: String(fd.get('note') || '').trim(),
        catIds: state.catIds,
        displayCatId: state.displayCatId,
        image: state.image,
      };

      // 新配图先落盘，再写条目，避免图片上传失败留下半条记录
      if (state.pending) {
        const up = await api.post('/api/uploads', { dataUrl: state.pending.dataUrl });
        payload.image = up.url;
        state.image = up.url;
        state.pending = null;
      }

      let copied = false;
      if (editing && !inArchiveOnly) {
        const keep = await askConfirm({
          kicker: 'KEEP ORIGINAL',
          title: '保留修改前的副本？',
          body: `<p class="ask__p">原条目会被复制一份到 <b>${ARCHIVE_NAME}</b> 分类，保留改动前的编号、名称、链接、备注与配图。</p>
                 <p class="ask__p ask__p--dim">该分类固定沉在列表最底部，随时可以翻回去对照。</p>`,
          yes: '保留副本',
          no: '不保留',
        });
        if (keep) {
          try {
            await api.post('/api/items', {
              code: item.code || '—',
              title: item.title,
              url: item.url || '',
              note: item.note || '',
              image: item.image || '',
              catIds: [ARCHIVE_ID],
              displayCatId: ARCHIVE_ID,
              snapshotOf: item.snapshotOf || item.id,
            });
            copied = true;
          } catch (err) {
            toast(`副本未保存：${err.message || '未知错误'}`);
          }
        }
      }

      const saved = editing
        ? await api.patch(`/api/items/${item.id}`, payload)
        : await api.post('/api/items', payload);

      closeModal();
      toast(editing ? (copied ? '已更新，原条目存入 SCP-6183-A' : '记录已更新') : '记录已归档');
      if (onSaved) onSaved({ ...saved, id: saved.id || saved._id }, { copied });
    },
  });

  /* ---- 分类 chips ---- */
  const chipsEl = el.querySelector('#fCats');
  function paintCats() {
    if (!chipsEl) return;
    const picked = state.catIds
      .map((id) => categories.find((c) => c.id === id))
      .filter(Boolean);
    chipsEl.innerHTML = picked.length
      ? picked.map((c) => chipHTML(c, c.id === state.displayCatId)).join('')
      : '<span class="chip chip--none">未分类</span>';
  }
  paintCats();

  el.querySelector('[data-tax-open]')?.addEventListener('click', () => {
    openCategoryPicker({
      categories,
      catIds: state.catIds,
      displayCatId: state.displayCatId,
      onDone: ({ catIds, displayCatId }) => {
        state.catIds = catIds;
        state.displayCatId = displayCatId;
        paintCats();
      },
    });
  });

  /* ---- 图片 ---- */
  const shotEl = el.querySelector('#fShot');
  const fileEl = el.querySelector('#fFile');
  const clearBtn = el.querySelector('[data-img-clear]');
  const pickBtn = el.querySelector('[data-img-pick]');

  function paintShot() {
    const src = state.pending ? state.pending.dataUrl : state.image;
    if (!src) {
      shotEl.innerHTML = '<span class="shot__empty">暂无图片</span>';
    } else {
      const tag = state.pending
        ? `已去背景 · ${state.pending.side}px`
        : '已保存';
      shotEl.innerHTML = `<img class="shot__img" src="${esc(src)}" alt="条目配图预览">
        <span class="shot__meta">${tag}</span>`;
    }
    clearBtn.hidden = !src;
    pickBtn.disabled = state.working;
    pickBtn.textContent = state.working ? '处理中…' : src ? '更换图片' : '插入图片';
    shotEl.classList.toggle('is-busy', state.working);
    // 处理中不许提交，避免把没处理完的图丢掉
    const sub = el.querySelector('#modalSubmit');
    if (sub) sub.disabled = state.working;
  }
  paintShot();

  pickBtn.addEventListener('click', () => fileEl.click());
  clearBtn.addEventListener('click', () => {
    state.pending = null;
    state.image = '';
    paintShot();
  });
  fileEl.addEventListener('change', async () => {
    const file = fileEl.files && fileEl.files[0];
    fileEl.value = '';
    if (!file) return;
    state.working = true;
    paintShot();
    try {
      const out = await prepareItemImage(file);
      state.pending = out;
      if (out.removed < 0.02) toast('背景比较花，已保留原图轮廓，仅做淡化');
    } catch (err) {
      toast(err.message || '图片处理失败');
    } finally {
      state.working = false;
      paintShot();
    }
  });

  return el;
}
