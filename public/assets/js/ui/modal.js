/* 弹窗：条目编辑 / 登录 */

import { $, esc, toast } from '../core/ui.js';
import { api, login } from '../core/api.js';
import { store } from '../core/store.js';

let modalEl = null;
let onCloseHook = null;

function ensure() {
  if (modalEl) return modalEl;
  const root = document.getElementById('modal-root') || document.body;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="modal" id="modal" hidden>
      <div class="modal__bd" data-modal-close></div>
      <form class="modal__pn" id="modalForm" autocomplete="off" novalidate>
        <header class="modal__hd">
          <span class="modal__k" id="modalKicker">RECORD</span>
          <h2 class="modal__t" id="modalTitle">标题</h2>
          <button class="modal__x" type="button" data-modal-close aria-label="关闭">✕</button>
        </header>
        <div id="modalBody"></div>
        <footer class="modal__ft">
          <span class="modal__hint" id="modalHint"></span>
          <button class="btn" type="button" data-modal-close>取消</button>
          <button class="btn btn--primary" type="submit" id="modalSubmit">保存</button>
        </footer>
      </form>
    </div>`;
  modalEl = wrap.firstElementChild;
  root.appendChild(modalEl);

  modalEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-modal-close]')) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalEl && !modalEl.hidden) closeModal();
  });
  return modalEl;
}

export function closeModal() {
  if (!modalEl) return;
  modalEl.hidden = true;
  modalEl.querySelector('#modalForm').reset();
  if (onCloseHook) { const fn = onCloseHook; onCloseHook = null; fn(); }
}

function show({ kicker, title, body, submit = '保存', hint = '', width = '', onSubmit }) {
  const el = ensure();
  el.querySelector('#modalKicker').textContent = kicker;
  el.querySelector('#modalTitle').textContent = title;
  el.querySelector('#modalBody').innerHTML = body;
  el.querySelector('#modalHint').innerHTML = hint;
  const pn = el.querySelector('.modal__pn');
  pn.classList.toggle('modal__pn--sm', width === 'sm');

  const form = el.querySelector('#modalForm');
  const btn = el.querySelector('#modalSubmit');
  btn.textContent = submit;
  btn.disabled = false;

  const handler = async (e) => {
    e.preventDefault();
    btn.disabled = true;
    try {
      await onSubmit(new FormData(form), el);
    } catch (err) {
      const errEl = el.querySelector('.field__err');
      if (errEl) errEl.textContent = err.message || '操作失败';
      else toast(err.message || '操作失败');
      btn.disabled = false;
    }
  };
  if (form.__handler) form.removeEventListener('submit', form.__handler);
  form.__handler = handler;
  form.addEventListener('submit', handler);

  el.hidden = false;
  setTimeout(() => {
    const first = el.querySelector('input, textarea, select');
    if (first) first.focus();
  }, 60);
  return el;
}

/* ---------------- 条目 ---------------- */
export function openItemModal({ item, categories, onSaved }) {
  const editing = !!item;
  const options = categories
    .map((c) => `<option value="${esc(c.id)}" ${item && item.catId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`)
    .join('');
  const body = `
    <div class="field">
      <label for="f-code">编号 / CODE</label>
      <input id="f-code" name="code" placeholder="SCP-XXXX" spellcheck="false" value="${esc(item?.code || '')}">
    </div>
    <div class="field">
      <label for="f-title">名称 / TITLE *</label>
      <input id="f-title" name="title" placeholder="条目名称" maxlength="100" value="${esc(item?.title || '')}">
    </div>
    <div class="field">
      <label for="f-url">链接 / URL</label>
      <input id="f-url" name="url" placeholder="https://scp-wiki-cn.wikidot.com/..." spellcheck="false" value="${esc(item?.url || '')}">
    </div>
    <div class="field">
      <label for="f-cat">分类 / CATEGORY</label>
      <select id="f-cat" name="catId">
        ${options}
        <option value="" ${!item || !item.catId ? 'selected' : ''}>未分类</option>
      </select>
    </div>
    <div class="field">
      <label for="f-note">备注 / NOTE</label>
      <textarea id="f-note" name="note" rows="3" placeholder="为什么收藏它？">${esc(item?.note || '')}</textarea>
    </div>
    <div class="field__err" id="modalErr"></div>`;

  show({
    kicker: editing ? 'EDIT RECORD' : 'NEW RECORD',
    title: editing ? '编辑记录' : '新建项目',
    body,
    submit: editing ? '保存修改' : '保存记录',
    hint: '保存后写入服务器，所有访客同步可见',
    onSubmit: async (fd) => {
      const payload = {
        code: String(fd.get('code') || '').trim() || '—',
        title: String(fd.get('title') || '').trim(),
        url: String(fd.get('url') || '').trim(),
        catId: String(fd.get('catId') || '') || null,
        note: String(fd.get('note') || '').trim(),
      };
      if (!payload.title) {
        const errEl = document.getElementById('modalErr');
        if (errEl) errEl.textContent = '请填写名称';
        document.getElementById('f-title')?.focus();
        throw new Error('请填写名称');
      }
      const saved = editing
        ? await api.patch(`/api/items/${item.id}`, payload)
        : await api.post('/api/items', payload);
      const normalized = { ...saved, id: saved.id || saved._id };
      store.replaceItem(normalized);
      closeModal();
      toast(editing ? '记录已更新' : '记录已归档');
      if (onSaved) onSaved(normalized);
    },
  });
}

/* ---------------- 登录 ---------------- */
export function openLoginModal({ onSuccess }) {
  const body = `
    <div class="field">
      <label for="f-email">邮箱 / EMAIL</label>
      <input id="f-email" name="email" type="email" placeholder="you@example.com" autocomplete="username" spellcheck="false">
    </div>
    <div class="field">
      <label for="f-pass">密码 / PASSWORD</label>
      <input id="f-pass" name="password" type="password" placeholder="••••••••" autocomplete="current-password">
    </div>
    <div class="field__err" id="modalErr"></div>`;

  show({
    kicker: 'OWNER ACCESS',
    title: '所有者登录',
    body,
    submit: '登录',
    hint: '仅站点所有者可编辑内容，访客无需登录',
    width: 'sm',
    onSubmit: async (fd) => {
      const email = String(fd.get('email') || '').trim();
      const password = String(fd.get('password') || '');
      if (!email || !password) throw new Error('请填写邮箱与密码');
      await login(email, password);
      closeModal();
      toast('登录成功');
      if (onSuccess) onSuccess();
    },
  });
}
