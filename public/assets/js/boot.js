/* 每个页面的唯一入口 */

import { mountShell } from './ui/shell.js';
import { applyRole, lockEditing } from './ui/guard.js';
import { store } from './core/store.js';
import { getSession } from './core/api.js';
import { initNav, closeVeil } from './core/nav.js';
import { setIdle } from './core/saver.js';
import { track } from './core/track.js';
import { toast, reduceMotion } from './core/ui.js';
import { openLoginModal } from './ui/modal.js';

const page = document.body.dataset.page || 'home';

async function boot() {
  // 入场动画只在确认可动效时才启用；默认状态始终可见
  if (!reduceMotion()) document.documentElement.classList.add('motion');

  initNav();
  mountShell(page);

  const [content, session] = await Promise.all([store.load(), getSession()]);
  const isOwner = applyRole(session);

  if (store.error && !store.loaded) {
    toast('数据读取失败，页面为只读空态');
  }

  try {
    const mod = await import(`./pages/${page}.js`);
    await mod.mount({ content, session, isOwner });
  } catch (err) {
    console.error('[boot]', err);
    const app = document.getElementById('app');
    if (app) {
      app.innerHTML = `<section class="page"><div class="stats-empty">// 页面加载失败<br>${String(err && err.message ? err.message : err)}</div></section>`;
    }
  }

  if (!isOwner) lockEditing();
  setIdle();
  closeVeil();
  track(page);

  const params = new URLSearchParams(location.search);
  if (params.get('login') === '1' && !isOwner) {
    openLoginModal({
      onSuccess: () => {
        const next = params.get('next') || '/';
        location.assign(next);
      },
    });
  }
}

boot();
