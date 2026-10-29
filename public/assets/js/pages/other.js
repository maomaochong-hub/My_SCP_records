/* 其他（预留板块） */

import { $, esc, toast } from '../core/ui.js';
import { store } from '../core/store.js';
import { queue } from '../core/saver.js';
import { pheadHTML } from '../ui/page-head.js';

const SLOTS = ['模块 A', '模块 B', '模块 C'];

export async function mount({ isOwner }) {
  const app = $('#app');
  const ghosts = SLOTS.map((t, i) => `
    <div class="ghost reveal" style="transition-delay:${i * 70}ms">
      <span class="ghost__k">SLOT 0${i + 1} / UNASSIGNED</span>
      <span class="ghost__t">${t}</span>
      <span class="ghost__lock">⌗</span>
      <span class="ghost__num">0${i + 1}</span>
      <span class="ghost__line"></span>
      <span class="ghost__s">// 内容暂未确定<br>等待归档指令</span>
    </div>`).join('');

  app.innerHTML = `
    <section class="page page--other">
      ${pheadHTML('03', '其他', 'Miscellaneous / Reserved',
        '<span>STATUS <b>预留</b></span><span>SLOTS <b>3</b></span><span>CONTENT <b>待定</b></span>')}
      <div class="ghost-grid">${ghosts}</div>
      <div class="reserve">
        <span>// 三个槽位保留给后续内容</span>
        <span>${isOwner ? '下方备注可编辑并自动保存' : '只读浏览'}</span>
      </div>
      <div class="slot">
        <div class="slot__h"><span>预留备注 / Notes for later</span><span>${isOwner ? '可编辑 · 自动保存' : '只读'}</span></div>
        <div class="slot__body" ${isOwner ? 'contenteditable="true"' : ''} spellcheck="false"
          data-slot="remark" data-ph="这个板块之后想放什么？随手记在这里，会自动保存。">${esc(store.other.remark || '')}</div>
      </div>
    </section>`;

  const { observeReveal } = await import('../core/ui.js');
  observeReveal(app);

  app.addEventListener('input', (e) => {
    const slot = e.target.closest('[data-slot="remark"]');
    if (!slot || !isOwner) return;
    store.data.other.remark = slot.innerText.replace(/\u00a0/g, ' ');
    queue('settings:remark', {
      path: '/api/settings',
      method: 'PATCH',
      payload: { other: { remark: store.data.other.remark } },
      delay: 520,
    });
  });
}
