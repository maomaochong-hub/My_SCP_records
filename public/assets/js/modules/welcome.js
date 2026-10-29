/* 欢迎页共用骨架：首页（拉丁句 + 流星）与次页（三入口）只差中间那一块 */

import { $, reduceMotion } from '../core/ui.js';
import { store } from '../core/store.js';
import { mountMeteors } from './meteors.js';

function latinHTML() {
  return `
    <a class="latin" href="/stage/" data-veil="OPENING / INDEX" aria-label="Per Aspera Ad Astra — 进入索引">
      <span class="latin__brk latin__brk--tr" aria-hidden="true"></span>
      <span class="latin__t">Per Aspera Ad Astra</span>
      <span class="latin__brk latin__brk--bl" aria-hidden="true"></span>
    </a>`;
}

const ENTRY_MARK = (href, veil, idx, zh, en, meta) => `
      <a class="entry" href="${href}" data-veil="${veil}">
        <span class="entry__in">
          <span class="entry__idx">${idx}</span>
          <span class="entry__t">${zh}</span>
          <span class="entry__sub"><span class="entry__en">${en}</span>${meta}</span>
        </span>
        <span class="entry__arrow">→</span>
      </a>`;

function entriesHTML() {
  const nItems = store.items.length;
  const nCats = store.categories.length;
  const nNotes = store.notes.length;
  return `
    <nav class="entries" aria-label="板块入口">
      ${ENTRY_MARK('/archive/', 'OPENING / COLLECTION', '01', '项目收集', 'Collection',
        `<b>${nItems}</b> 个项目 · <b>${nCats}</b> 个分类`)}
      ${ENTRY_MARK('/writing/', 'OPENING / NOTES', '02', '灵感写作', 'Notes',
        `<b>${nNotes}</b> 张便签 · 含网页创作`)}
      ${ENTRY_MARK('/other/', 'OPENING / MISCELLANEOUS', '03', '其他', 'Misc.', '未编目 · 占位')}
    </nav>`;
}

/** 顶部（两页完全一致）+ 中部（按模式切换） */
function coreHTML(mode) {
  return `
    <div class="welcome__grid">
      <div class="welcome__top">
        <div class="welcome__meta">
          <span>File // 6183</span>
          <b>Rev. 05 · ${new Date().getFullYear()}</b>
        </div>
        <h1 class="wordmark" aria-label="S_C_P">
          <span>S</span><span class="u"></span><span>C</span><span class="u"></span><span>P</span>
        </h1>
        <p class="alert"><i>[</i><span>此网站已被标记为待删除</span><i>]</i></p>
      </div>
    </div>
    <div class="welcome__center">${mode === 'stage' ? entriesHTML() : latinHTML()}</div>`;
}

export function welcomeHTML(mode) {
  const core = coreHTML(mode);
  return `
    <section class="welcome" data-mode="${mode}">
      <div class="welcome__ghost" aria-hidden="true">
        <img src="/assets/sigil.png" alt="" width="783" height="678" fetchpriority="high">
      </div>
      <div class="welcome__sigil" aria-hidden="true">
        <img src="/assets/sigil.png" alt="" width="783" height="678" fetchpriority="high">
      </div>
      ${core}
      <div class="glare" aria-hidden="true" inert><div class="glare__stage">${core}</div></div>
      ${mode === 'home' ? '<div class="meteor-field" aria-hidden="true"></div><div class="starfield" aria-hidden="true"></div>' : ''}
    </section>`;
}

export function mountWelcome(mode) {
  const app = $('#app');
  if (!app) return;
  app.innerHTML = welcomeHTML(mode);

  // 照亮层是纯视觉克隆：不可聚焦、不可点击
  $('.glare', app)?.querySelectorAll('a').forEach((a) => {
    a.tabIndex = -1;
    a.setAttribute('aria-hidden', 'true');
  });

  initParallax(app);
  if (mode === 'home') {
    mountMeteors(app);
  } else {
    initMagnet(app);
  }
}

/** 徽记与虚影的指针视差：符号与影子反向位移，最多 ±6px / ±10px */
function initParallax(app) {
  if (reduceMotion()) return;
  const welcome = $('.welcome', app);
  if (!welcome) return;

  let raf = null;
  let tx = 0;
  let ty = 0;

  app.addEventListener('pointermove', (e) => {
    const r = welcome.getBoundingClientRect();
    tx = ((e.clientX - r.left) / r.width - 0.5) * 12;
    ty = ((e.clientY - r.top) / r.height - 0.5) * 10;
    if (!raf) raf = requestAnimationFrame(apply);
  }, { passive: true });

  app.addEventListener('pointerleave', () => {
    tx = 0;
    ty = 0;
    if (!raf) raf = requestAnimationFrame(apply);
  });

  function apply() {
    raf = null;
    welcome.style.setProperty('--px', tx.toFixed(1) + 'px');
    welcome.style.setProperty('--py', ty.toFixed(1) + 'px');
  }
}

/** 入口轻微磁吸：指针位置驱动 3px 位移 */
function initMagnet(app) {
  let current = null;
  app.addEventListener('pointermove', (e) => {
    const entry = e.target.closest('.entry');
    if (!entry) return;
    if (current && current !== entry) reset(current);
    current = entry;
    const r = entry.getBoundingClientRect();
    const dx = (e.clientX - r.left - r.width / 2) / (r.width / 2);
    const dy = (e.clientY - r.top - r.height / 2) / (r.height / 2);
    entry.style.setProperty('--mx', (dx * 4).toFixed(2) + 'px');
    entry.style.setProperty('--my', (dy * 3).toFixed(2) + 'px');
  }, { passive: true });

  app.addEventListener('pointerleave', () => {
    if (current) reset(current);
    current = null;
  });

  function reset(el) {
    el.style.setProperty('--mx', '0px');
    el.style.setProperty('--my', '0px');
  }
}
