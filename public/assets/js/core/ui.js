/* 通用工具：DOM、转义、时间、toast */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export const pad = (n) => (n < 10 ? '0' + n : '' + n);

export function clockStr(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
export function dateStr(d = new Date()) {
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}
export function fmtTime(ts) {
  const d = new Date(ts);
  return `${dateStr(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function relTime(ts) {
  const s = (Date.now() - (ts || Date.now())) / 1000;
  if (s < 60) return '刚刚';
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
  return new Date(ts).toLocaleDateString('zh-CN');
}
export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}
export function bytes(n) {
  if (!n) return '0 B';
  if (n < 1024) return n + ' B';
  return (n / 1024).toFixed(1) + ' KB';
}

export function debounce(fn, ms = 300) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

let toastTimer = null;
export function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 2400);
}

export const reduceMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function emptyState({ kicker, title, hint, action }) {
  return `
    <div class="empty">
      <span class="empty__k">// ${esc(kicker)}</span>
      <span class="empty__t">${esc(title)}</span>
      <span class="empty__h">${esc(hint)}</span>
      ${action || ''}
    </div>`;
}

/** 滚动揭示 */
export function observeReveal(root = document) {
  const items = $$('.reveal', root);
  if (!items.length) return;
  if (reduceMotion() || !('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('is-in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      }
    }
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
  items.forEach((el) => io.observe(el));
}
