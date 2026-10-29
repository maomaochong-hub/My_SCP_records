/* HUD / 页脚 / 时钟 / 导出 / 登录入口 */

import { $, clockStr, dateStr, toast } from '../core/ui.js';
import { api, logout } from '../core/api.js';
import { go } from '../core/nav.js';
import { openLoginModal } from './modal.js';

const PAGE_LABEL = {
  home: 'INDEX',
  stage: 'INDEX II',
  archive: 'COLLECTION',
  writing: 'NOTES',
  other: 'MISCELLANEOUS',
  stats: 'STATISTICS',
};

export function mountShell(page) {
  const top = $('#hud-top');
  if (top) {
    top.className = 'hud hud--top';
    top.innerHTML = `
      <div class="hud__l">
        <a class="hud__brand" href="/" data-veil="RETURNING / INDEX">
          <span class="hud__dot"></span>
          <span>SCP FOUNDATION</span>
          <span class="hud__sep hud__rest">/</span>
          <span class="hud__rest">PERSONAL TERMINAL</span>
        </a>
      </div>
      <div class="hud__c">SITE-05 · CLEARANCE 3 · ${PAGE_LABEL[page] || 'INDEX'}</div>
      <div class="hud__r">
        <span class="save" id="saveState" data-state="readonly" data-owner-only><i></i><span id="saveText">只读</span></span>
        <a class="hud__btn" href="/stats/" data-owner-only data-veil="OPENING / STATISTICS">统计</a>
        <button class="hud__btn" type="button" data-act="export" data-owner-only>导出</button>
        <button class="hud__btn is-accent" type="button" data-act="logout" data-owner-only>退出</button>
        <button class="hud__btn is-accent" type="button" data-act="login" data-guest-only>登录</button>
      </div>`;
  }

  const bot = $('#hud-bot');
  if (bot) {
    bot.className = 'hud hud--bot';
    bot.innerHTML = `
      <span>SECURE · CONTAIN · PROTECT</span>
      <span class="hud__clock"><span id="clock">--:--:--</span><span class="hud__sep">//</span><span id="clockDate">----</span></span>`;
    const dateEl = $('#clockDate');
    if (dateEl) dateEl.textContent = dateStr();
    const tick = () => { const el = $('#clock'); if (el) el.textContent = clockStr(); };
    tick();
    setInterval(tick, 1000);
  }

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;

    if (act === 'login') {
      openLoginModal({ onSuccess: () => location.reload() });
      return;
    }
    if (act === 'logout') {
      await logout();
      toast('已退出登录');
      setTimeout(() => go('/', 'RETURNING / INDEX'), 320);
      return;
    }
    if (act === 'export') {
      btn.disabled = true;
      try {
        const data = await api.get('/api/export');
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `scp-terminal-${dateStr().replace(/\./g, '')}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        toast('档案已导出');
      } catch (err) {
        toast(err.message || '导出失败');
      } finally {
        btn.disabled = false;
      }
    }
  });
}
