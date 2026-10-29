/* 灵感写作：便签画布 + 网页创作 */

import { $, toast } from '../core/ui.js';
import { store } from '../core/store.js';
import { pheadHTML } from '../ui/page-head.js';
import { boardHTML, bindBoard, createNote } from '../modules/notes-board.js';
import { studioHTML, mountStudio } from '../modules/studio.js';

function metaHTML() {
  return `
    <span>NOTES <b id="mNotes">${store.notes.length}</b></span>
    <span>MODE <b>FREE FLOAT</b></span>
    <span>AUTOSAVE <b>ON</b></span>`;
}

export async function mount({ isOwner }) {
  const app = $('#app');
  app.innerHTML = `
    <section class="page page--writing${isOwner ? '' : ' is-guest'}">
      ${pheadHTML('02', '灵感写作', 'Notes / Inspiration', metaHTML())}
      <div class="boardbar">
        <span class="boardbar__hint">${isOwner
          ? '拖动标题栏移动便签 · 点击文字直接编辑 · 修改自动保存'
          : '只读浏览 · 登录后可编辑便签与网页作品'}</span>
        <span class="boardbar__count"><b id="noteCount">${store.notes.length}</b> 张便签</span>
        ${isOwner ? '<button type="button" class="btn btn--primary" data-new-note>＋ 新建笔记</button>' : ''}
      </div>
      <div class="board" id="board">${boardHTML(store.notes)}</div>
      ${isOwner ? studioHTML() : ''}
    </section>`;

  const board = $('#board', app);

  const refresh = () => {
    board.innerHTML = boardHTML(store.notes);
    const c = $('#noteCount');
    if (c) c.textContent = store.notes.length;
    const m = $('#mNotes');
    if (m) m.textContent = store.notes.length;
  };

  bindBoard(board, { isOwner, onChange: refresh });

  if (isOwner) {
    app.addEventListener('click', async (e) => {
      if (!e.target.closest('[data-new-note]')) return;
      try {
        const note = await createNote();
        refresh();
        const el = document.querySelector(`.note[data-id="${note.id}"] .note__title`);
        if (el) el.focus();
        toast('已新建便签');
      } catch (err) {
        toast(err.message || '新建失败');
      }
    });

    await mountStudio();
  }
}
