/* 整页跳转：幕布收拢 → 导航 → 目标页幕布展开 */

import { reduceMotion } from './ui.js';
import { flushAll } from './saver.js';

const prefetched = new Set();

export function closeVeil() {
  const veil = document.getElementById('veil');
  if (!veil) return;
  if (reduceMotion()) {
    veil.classList.remove('is-on', 'is-out');
    document.documentElement.classList.remove('is-booting');
    return;
  }
  // 等一帧，确保首屏已经绘制过一次
  requestAnimationFrame(() => {
    document.documentElement.classList.remove('is-booting');
    veil.classList.remove('is-on');
    veil.classList.add('is-out');
    setTimeout(() => veil.classList.remove('is-out'), 560);
  });
}

export function go(href, label) {
  const veil = document.getElementById('veil');
  const lab = document.getElementById('veilLabel');
  if (lab && label) lab.textContent = label;
  if (!veil || reduceMotion()) {
    flushAll();
    location.assign(href);
    return;
  }
  veil.classList.add('is-on');
  flushAll();
  setTimeout(() => location.assign(href), 380);
}

export function initNav() {
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    if (a.target || a.hasAttribute('download')) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.hash) return;
    e.preventDefault();
    const label = a.dataset.veil || '';
    go(url.pathname + url.search + url.hash, label);
  });

  document.addEventListener('pointerover', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    if (prefetched.has(url.pathname)) return;
    prefetched.add(url.pathname);
    fetch(url.pathname, { priority: 'low', credentials: 'same-origin' }).catch(() => {});
  }, { passive: true });

  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    const veil = document.getElementById('veil');
    if (veil) veil.classList.remove('is-on', 'is-out');
    document.documentElement.classList.remove('is-booting');
  });
}
