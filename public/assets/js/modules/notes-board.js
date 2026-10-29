/* 便签画布：拖拽 / 就地编辑 / 自动保存 */

import { $, $$, esc, relTime, toast } from '../core/ui.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { queue } from '../core/saver.js';

const ACCENTS = ['amber', 'bone', 'red'];

export function boardHTML(notes) {
  return notes.map((n, i) => `
    <article class="note" data-id="${n.id}" data-accent="${esc(n.accent || 'bone')}"
      style="left:${n.x || 24}px;top:${n.y || 24}px;width:${n.w || 310}px;z-index:${n.z || 1};--d:-${(i * 1.7).toFixed(1)}s">
      <header class="note__bar">
        <span class="note__dot"></span>
        <span class="note__idx">NOTE ${String(i + 1).padStart(2, '0')}</span>
        <button type="button" class="note__del" data-note-del="${n.id}" aria-label="删除笔记" data-owner-only>✕</button>
      </header>
      <div class="note__title" contenteditable="true" spellcheck="false" data-field="title" data-ph="未命名笔记">${esc(n.title)}</div>
      <div class="note__body" contenteditable="true" spellcheck="false" data-field="body" data-ph="在这里写下灵感……">${esc(n.body)}</div>
      <footer class="note__foot"><span data-updated>${relTime(n.updatedAt)}</span><span>${(n.body || '').length} 字</span></footer>
    </article>`).join('') + '<p class="board__hint" aria-hidden="true">双击空白处 · 新建便签</p>';
}

export function bindBoard(board, { isOwner, onChange }) {
  let zTop = store.topZ();

  function bringFront(el) {
    if (!isOwner) return;
    const z = parseInt(el.style.zIndex, 10) || 1;
    if (z >= zTop) return;
    el.style.zIndex = ++zTop;
  }

  /* ---- 拖拽 ---- */
  board.addEventListener('pointerdown', (e) => {
    const note = e.target.closest('.note');
    if (!note) return;
    if (isOwner) bringFront(note);
    if (!isOwner) return;
    const bar = e.target.closest('.note__bar');
    if (!bar || e.target.closest('[data-note-del]')) return;
    if (window.matchMedia('(max-width: 720px)').matches) return;

    e.preventDefault();
    const nr = note.getBoundingClientRect();
    const br = board.getBoundingClientRect();
    const dx = e.clientX - nr.left;
    const dy = e.clientY - nr.top;
    const noteW = nr.width;
    const noteH = nr.height;

    note.classList.add('is-dragging');
    if (bar.setPointerCapture) { try { bar.setPointerCapture(e.pointerId); } catch { /* ignore */ } }

    const move = (ev) => {
      const x = Math.max(4, Math.min(ev.clientX - br.left - dx, br.width - noteW - 4));
      const y = Math.max(4, Math.min(ev.clientY - br.top - dy, Math.max(4, br.height - noteH - 4)));
      note.style.left = x + 'px';
      note.style.top = y + 'px';
    };
    const end = () => {
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', end);
      bar.removeEventListener('pointercancel', end);
      note.classList.remove('is-dragging');
      const id = note.dataset.id;
      const data = {
        x: Math.round(parseFloat(note.style.left) || 0),
        y: Math.round(parseFloat(note.style.top) || 0),
        z: parseInt(note.style.zIndex, 10) || 1,
      };
      const n = store.note(id);
      if (n) Object.assign(n, data);
      queue(`note:geo:${id}`, {
        path: `/api/notes/${id}/geometry`, method: 'PATCH', payload: data, delay: 180,
      });
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
  });

  /* ---- 编辑 ---- */
  board.addEventListener('input', (e) => {
    if (!isOwner) return;
    const field = e.target.closest('[data-field]');
    if (!field) return;
    const noteEl = field.closest('.note');
    const n = store.note(noteEl.dataset.id);
    if (!n) return;
    n[field.dataset.field] = field.innerText.replace(/\u00a0/g, ' ');
    n.updatedAt = Date.now();
    const upd = noteEl.querySelector('[data-updated]');
    if (upd) upd.textContent = '刚刚';
    const cnt = noteEl.querySelector('.note__foot span:last-child');
    if (cnt) cnt.textContent = (n.body || '').length + ' 字';
    queue(`note:text:${n.id}`, {
      path: `/api/notes/${n.id}`, method: 'PATCH',
      payload: { title: n.title, body: n.body }, delay: 420,
    });
  });

  /* ---- 删除 ---- */
  board.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-note-del]');
    if (!del || !isOwner) return;
    if (!confirm('删除这张便签？')) return;
    const id = del.dataset.noteDel;
    try {
      await api.del(`/api/notes/${id}`);
      store.removeNote(id);
      del.closest('.note')?.remove();
      toast('便签已删除');
      onChange && onChange();
    } catch (err) {
      toast(err.message || '删除失败');
    }
  });

  /* ---- 双击新建 ---- */
  board.addEventListener('dblclick', async (e) => {
    if (!isOwner || e.target.closest('.note')) return;
    const r = board.getBoundingClientRect();
    await createNote({
      x: Math.max(8, e.clientX - r.left - 150),
      y: Math.max(8, e.clientY - r.top - 20),
    });
  });
}

export async function createNote(pos = {}) {
  const board = $('#board');
  const bw = board ? board.clientWidth : 900;
  const bh = board ? board.clientHeight : 520;
  const idx = store.notes.length;
  const payload = {
    title: '',
    body: '',
    x: Math.round(pos.x ?? Math.min(28 + (idx % 5) * 34, Math.max(8, bw - 340))),
    y: Math.round(pos.y ?? Math.min(30 + (idx % 5) * 30, Math.max(8, bh - 180))),
    w: Math.min(330, Math.max(240, bw - 110)),
    z: store.topZ() + 1,
    accent: ACCENTS[idx % ACCENTS.length],
  };
  const note = await api.post('/api/notes', payload);
  const normalized = { ...note, id: note.id || note._id };
  store.addNote(normalized);
  return normalized;
}
