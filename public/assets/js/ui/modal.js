/* 弹窗：通用外壳 / 确认框 / 登录 */

import { esc, toast } from '../core/ui.js';
import { login } from '../core/api.js';

let modalEl = null;
let onCloseHook = null;
/** 有阻塞式子弹窗（确认框）打开时，底层弹窗不响应 Esc */
let blocking = 0;

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
    if (e.key !== 'Escape' || !modalEl || modalEl.hidden || blocking) return;
    closeModal();
  });
  return modalEl;
}

export function closeModal() {
  if (!modalEl || blocking) return;
  modalEl.hidden = true;
  const form = modalEl.querySelector('#modalForm');
  if (form) form.reset();
  if (onCloseHook) { const fn = onCloseHook; onCloseHook = null; fn(); }
}

/**
 * 打开通用弹窗外壳。body 为表单内容 HTML。
 * onSubmit(fd, el) 抛错时，错误文案会写进弹窗内的 .field__err。
 */
export function show({ kicker, title, body, submit = '保存', hint = '', width = '', onSubmit, submitTone = '' }) {
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
  btn.classList.toggle('btn--danger', submitTone === 'danger');
  btn.disabled = false;

  const handler = async (e) => {
    e.preventDefault();
    if (btn.disabled) return;
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
    const first = el.querySelector('#modalBody input:not([type=file]), #modalBody textarea, #modalBody select');
    if (first) first.focus();
  }, 60);
  return el;
}

/* ---------------- 确认框 ---------------- */
/**
 * 阻塞式二选一，返回 Promise<boolean>。
 * 不做成 show() 的变体，因为它要叠在编辑弹窗上面。
 */
export function askConfirm({
  kicker = 'CONFIRM', title, body = '', yes = '确定', no = '取消', tone = 'normal',
} = {}) {
  return new Promise((resolve) => {
    blocking++;
    const wrap = document.createElement('div');
    wrap.className = 'modal ask';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.innerHTML = `
      <div class="modal__bd" data-ask="no"></div>
      <div class="modal__pn modal__pn--sm">
        <header class="modal__hd">
          <span class="modal__k">${esc(kicker)}</span>
          <h2 class="modal__t">${esc(title || '')}</h2>
        </header>
        ${body ? `<div class="ask__body">${body}</div>` : ''}
        <footer class="modal__ft">
          <span class="modal__hint"></span>
          <button class="btn" type="button" data-ask="no">${esc(no)}</button>
          <button class="btn ${tone === 'danger' ? 'btn--danger' : 'btn--primary'}" type="button" data-ask="yes">${esc(yes)}</button>
        </footer>
      </div>`;
    (document.getElementById('modal-root') || document.body).appendChild(wrap);

    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      blocking = Math.max(0, blocking - 1);
      document.removeEventListener('keydown', onKey);
      wrap.remove();
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); done(false); }
      if (e.key === 'Enter') { e.preventDefault(); done(true); }
    };
    wrap.addEventListener('click', (e) => {
      const hit = e.target.closest('[data-ask]');
      if (!hit) return;
      done(hit.dataset.ask === 'yes');
    });
    document.addEventListener('keydown', onKey);
    setTimeout(() => {
      const b = wrap.querySelector('[data-ask="yes"]');
      if (b) b.focus();
    }, 40);
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
