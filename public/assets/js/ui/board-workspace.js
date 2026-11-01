/**
 * 画布工作台：全屏覆盖层 + 工具栏 + 条目选择 + 连线备注 + 保存。
 *
 * links  项目收集的连接板（选条目 → 连接 → 保存成一条展示条目）
 * idea   灵感写作的压缩条目（笔记 / 图片 / 手绘 / 形状 / 连接）
 * board  纯画板（同上，但没有「连接」以外的条目语义）
 */

import { esc, toast } from '../core/ui.js';
import { api } from '../core/api.js';
import { show, closeModal, askConfirm } from './modal.js';
import { createBoard } from '../modules/board.js';

const SHAPES = [
  { t: 'shape:rect', label: '方框' },
  { t: 'shape:circle', label: '圆圈' },
  { t: 'shape:triangle', label: '三角' },
  { t: 'shape:arrow', label: '箭头' },
  { t: 'shape:angle', label: '角度' },
];

const SYMBOLS = [
  '∑', '∫', '√', '∞', 'π', '±', '×', '÷', '≈', '≠', '≤', '≥',
  '→', '←', '↑', '↓', '⇒', '⇔', '∴', '∵',
  'α', 'β', 'γ', 'δ', 'θ', 'λ', 'μ', 'σ', 'φ', 'ω', 'Δ', 'Ω',
];

const KIND_KICKER = { links: 'CONNECTIONS', idea: 'INSPIRATION', board: 'CANVAS' };

const uid = (p) => `${p}_${Math.random().toString(36).slice(2, 8)}`;

/* ---------------- 条目选择器 ---------------- */

function openItemPicker({ items, exclude = [], onPick }) {
  const taken = new Set(exclude);
  let q = '';
  const wrap = document.createElement('div');
  wrap.className = 'modal pick';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.innerHTML = `
    <div class="modal__bd" data-pick-close></div>
    <div class="modal__pn">
      <header class="modal__hd">
        <span class="modal__k">ADD TO BOARD</span>
        <h2 class="modal__t">选择条目</h2>
        <button class="modal__x" type="button" data-pick-close aria-label="关闭">✕</button>
      </header>
      <label class="search">
        <span class="search__ico">⌕</span>
        <input id="pickQ" type="search" placeholder="检索 编号 / 名称 / 分类" autocomplete="off">
      </label>
      <ul class="pick__list" id="pickList"></ul>
      <footer class="modal__ft">
        <span class="modal__hint">已在板上的条目会置灰</span>
        <button class="btn" type="button" data-pick-close>取消</button>
      </footer>
    </div>`;
  (document.getElementById('modal-root') || document.body).appendChild(wrap);

  const listEl = wrap.querySelector('#pickList');

  function paint() {
    const needle = q.trim().toLowerCase();
    const rows = items.filter((it) => {
      if (!needle) return true;
      return `${it.code || ''} ${it.title || ''}`.toLowerCase().includes(needle);
    });
    listEl.innerHTML = rows.length
      ? rows.map((it) => {
        const off = taken.has(it.id);
        return `<li class="pick__row${off ? ' is-off' : ''}">
          <button type="button" data-pick="${esc(it.id)}" ${off ? 'disabled' : ''}>
            <span class="pick__code">${esc(it.code || '—')}</span>
            <span class="pick__title">${esc(it.title || '')}</span>
          </button>
        </li>`;
      }).join('')
      : '<li class="pick__none">没有匹配的条目</li>';
  }

  paint();
  wrap.querySelector('#pickQ').addEventListener('input', (e) => { q = e.target.value; paint(); });
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-pick-close]')) { wrap.remove(); return; }
    const hit = e.target.closest('[data-pick]');
    if (!hit || hit.disabled) return;
    const it = items.find((x) => x.id === hit.dataset.pick);
    if (it && onPick) onPick(it);
    wrap.remove();
  });
  setTimeout(() => wrap.querySelector('#pickQ').focus(), 40);
  return wrap;
}

/* ---------------- 备注：编辑 / 阅读 ---------------- */

export function editEdgeNote(edge, { onNote, onColor }) {
  show({
    kicker: 'LINK NOTE',
    title: '连线备注',
    width: 'sm',
    body: `
      <div class="field">
        <label for="f-linknote">备注 / NOTE</label>
        <textarea id="f-linknote" name="note" rows="4" maxlength="120"
          placeholder="这条线代表什么关系？">${esc(edge.note || '')}</textarea>
        <p class="field__hint">留空则线上不显示标记；不超过 5 个字会直接显示在线上。</p>
      </div>
      <div class="field">
        <label for="f-linkcolor">颜色 / COLOR</label>
        <input id="f-linkcolor" type="color" value="${esc(edge.color || '#8d9188')}"
          style="width:56px;height:30px;padding:2px;border:1px solid var(--line-2);background:none">
      </div>
      <div class="field__err"></div>`,
    submit: '保存备注',
    onSubmit: async () => {
      const note = document.querySelector('#f-linknote')?.value ?? '';
      const col = document.querySelector('#f-linkcolor')?.value;
      onNote(String(note).trim());
      if (col && onColor) onColor(col);
      closeModal();
    },
  });
}

function readEdgeNote(edge, { onEdit, onRemove }) {
  const wrap = document.createElement('div');
  wrap.className = 'modal noteview';
  wrap.innerHTML = `
    <div class="modal__bd" data-nv-close></div>
    <div class="modal__pn modal__pn--sm">
      <header class="modal__hd">
        <span class="modal__k">LINK NOTE</span>
        <h2 class="modal__t">连线备注</h2>
        <button class="modal__x" type="button" data-nv-close aria-label="关闭">✕</button>
      </header>
      <p class="noteview__t">${esc(edge.note)}</p>
      <footer class="modal__ft">
        <span class="modal__hint">双击线上的标记可直接删除备注</span>
        <button class="btn" type="button" data-nv-edit>编辑</button>
        <button class="btn btn--danger" type="button" data-nv-del>删除备注</button>
      </footer>
    </div>`;
  (document.getElementById('modal-root') || document.body).appendChild(wrap);
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-nv-close]')) wrap.remove();
    else if (e.target.closest('[data-nv-edit]')) { wrap.remove(); onEdit(); }
    else if (e.target.closest('[data-nv-del]')) { wrap.remove(); onRemove(); }
  });
}

/* ---------------- 工作台 ---------------- */

export function openBoardWorkspace({
  mode = 'links',
  board = null,
  boards = [],
  items = [],
  onSaved = null,
}) {
  const isNew = !board;
  const state = {
    title: board ? board.title : (mode === 'board' ? '未命名画板' : '未命名连接'),
    note: board ? board.note || '' : '',
    dirty: false,
    color: '#d8443a',
  };

  const lookupBoard = (id) => boards.find((b) => b.id === id) || null;

  const root = document.createElement('div');
  root.className = 'ws';
  root.dataset.kind = mode;
  root.innerHTML = `
    <header class="ws__bar">
      <div class="ws__brand">
        <span class="ws__k">${esc(KIND_KICKER[mode] || 'BOARD')}</span>
        <h2 class="ws__t">${esc(state.title)}</h2>
      </div>
      <div class="ws__tools" role="toolbar" aria-label="画布工具">
        <button type="button" class="ws__tool is-on" data-tool="select">选择</button>
        <button type="button" class="ws__tool" data-tool="delete">删除</button>
        <button type="button" class="ws__tool" data-tool="connect">连接</button>
        ${mode === 'links' ? '' : `
        <span class="ws__div"></span>
        <button type="button" class="ws__tool" data-tool="text">文字</button>
        <button type="button" class="ws__tool" data-tool="image">图片</button>
        <button type="button" class="ws__tool" data-tool="pen">画笔</button>
        <span class="ws__pop">
          <button type="button" class="ws__tool" data-pop="shape">形状 ▾</button>
          <span class="ws__menu" data-menu="shape" hidden>
            ${SHAPES.map((s) => `<button type="button" data-tool="${s.t}">${s.label}</button>`).join('')}
          </span>
        </span>
        <span class="ws__pop">
          <button type="button" class="ws__tool" data-pop="symbol">符号 ▾</button>
          <span class="ws__menu ws__menu--sym" data-menu="symbol" hidden>
            ${SYMBOLS.map((s) => `<button type="button" data-sym="${esc(s)}">${esc(s)}</button>`).join('')}
          </span>
        </span>`}
        <span class="ws__div"></span>
        <label class="ws__color" title="连线 / 图形颜色">
          <input type="color" id="wsColor" value="#d8443a" aria-label="颜色">
        </label>
        <button type="button" class="ws__tool ws__tool--go" data-act="link" hidden>建立连接</button>
        <button type="button" class="ws__tool ws__tool--del" data-act="do-del" hidden>删除所选</button>
      </div>
      <div class="ws__acts">
        <button type="button" class="btn" data-act="cancel">取消</button>
        <button type="button" class="btn btn--primary" data-act="save">保存</button>
      </div>
    </header>
    <div class="ws__stage-wrap">
      <div class="ws__board" id="wsBoard"></div>
      <div class="ws__hint" id="wsHint"></div>
    </div>`;

  document.body.appendChild(root);
  document.body.classList.add('ws-open');

  const boardRoot = root.querySelector('#wsBoard');
  const hint = root.querySelector('#wsHint');
  const colorInput = root.querySelector('#wsColor');

  const engine = createBoard(boardRoot, {
    nodes: board ? board.nodes : [],
    edges: board ? board.edges : [],
    tool: 'select',
    editable: true,
    color: state.color,
    lookupBoard,
    onChange: (reason) => {
      state.dirty = true;
      if (reason !== 'move') setHint();
    },
    onPickChange: (pick, marked) => {
      const goLink = root.querySelector('[data-act="link"]');
      const goDel = root.querySelector('[data-act="do-del"]');
      if (goLink) {
        goLink.hidden = root.dataset.tool !== 'connect';
        goLink.disabled = pick.length !== 2;
        goLink.textContent = pick.length === 2 ? '建立连接' : `建立连接 (${pick.length}/2)`;
      }
      if (goDel) {
        goDel.hidden = root.dataset.tool !== 'delete';
        goDel.disabled = marked === 0;
        goDel.textContent = marked ? `删除所选 (${marked})` : '删除所选';
      }
    },
    onEdgeActivate: (edge, mode2) => {
      if (mode2 === 'removeNote') {
        askConfirm({
          kicker: 'REMOVE NOTE',
          title: '删除这条备注？',
          body: '<p class="ask__p">只删除备注文字，连线本身保留。</p>',
          yes: '删除', no: '取消', tone: 'danger',
        }).then((ok) => {
          if (!ok) return;
          engine.setEdgeNote(edge.id, '');
          toast('备注已删除');
        });
        return;
      }
      if (mode2 === 'view') {
        readEdgeNote(edge, {
          onEdit: () => editEdgeNote(edge, {
            onNote: (v) => engine.setEdgeNote(edge.id, v),
            onColor: (c) => engine.setEdgeColor(edge.id, c),
          }),
          onRemove: async () => {
            const ok = await askConfirm({
              kicker: 'REMOVE NOTE', title: '删除这条备注？',
              body: '<p class="ask__p">只删除备注文字，连线本身保留。</p>',
              yes: '删除', no: '取消', tone: 'danger',
            });
            if (!ok) return;
            engine.setEdgeNote(edge.id, '');
            toast('备注已删除');
          },
        });
        return;
      }
      editEdgeNote(edge, {
        onNote: (v) => engine.setEdgeNote(edge.id, v),
        onColor: (c) => engine.setEdgeColor(edge.id, c),
      });
    },
    onNeedImage: (cb) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        try {
          const out = await prepareImage(file);
          const up = await api.post('/api/uploads', { dataUrl: out });
          cb(up.url);
        } catch (err) {
          toast(err.message || '图片上传失败');
        }
      });
      input.click();
    },
  });

  function setHint() {
    const c = engine.counts();
    if (root.dataset.tool === 'connect') {
      hint.textContent = '点两个条目 → 建立连接 · 点连线可以写备注';
    } else if (root.dataset.tool === 'delete') {
      hint.textContent = '点选要删除的条目或连线 · 相关连线会一起断开';
    } else if (root.dataset.tool === 'select') {
      hint.textContent = `${c.nodes} 个条目 · ${c.edges} 条连线 · 拖动即可移动`;
    } else {
      hint.textContent = '在空白处按下拖拽绘制 · 画好的图形可以直接拖动';
    }
  }
  setHint();

  /* ---- 图片压缩（画板用，不做去背景） ---- */
  function prepareImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('读取图片失败'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('图片格式不支持'));
        img.onload = () => {
          const max = 1400;
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const cv = document.createElement('canvas');
          cv.width = w;
          cv.height = h;
          const ctx = cv.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          resolve(cv.toDataURL('image/webp', 0.86));
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }

  /* ---- 工具切换 ---- */
  function setTool(t) {
    root.dataset.tool = t;
    root.querySelectorAll('button[data-tool]').forEach((b) => {
      b.classList.toggle('is-on', b.dataset.tool === t);
    });
    root.querySelectorAll('[data-menu]').forEach((m) => { m.hidden = true; });
    engine.setTool(t);
    setHint();
  }

  root.addEventListener('click', (e) => {
    const pop = e.target.closest('[data-pop]');
    if (pop) {
      const menu = root.querySelector(`[data-menu="${pop.dataset.pop}"]`);
      if (menu) menu.hidden = !menu.hidden;
      return;
    }
    const sym = e.target.closest('[data-sym]');
    if (sym) {
      engine.addSymbol(sym.dataset.sym);
      root.querySelectorAll('[data-menu]').forEach((m) => { m.hidden = true; });
      return;
    }

    const toolBtn = e.target.closest('button[data-tool]');
    if (toolBtn) {
      const t = toolBtn.dataset.tool;
      if (t === 'select' && mode === 'links') {
        setTool('select');
        openItemPicker({
          items,
          exclude: engine.getData().nodes.filter((n) => n.type === 'ref').map((n) => n.refId),
          onPick: (it) => {
            const d = engine.getData();
            const node = {
              id: uid('nd'), type: 'ref', refId: it.id,
              code: it.code || '—', title: it.title || '',
              x: 60 + (d.nodes.length % 5) * 250,
              y: 80 + Math.floor(d.nodes.length / 5) * 130,
              w: 220, h: 92, z: 1 + d.nodes.length,
            };
            engine.setData({ nodes: [...d.nodes, node], edges: d.edges });
          },
        });
        return;
      }
      setTool(t);
      return;
    }

    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'link') {
      const edge = engine.connect();
      if (edge && edge.duplicate) toast('这两条之间已经有连线了');
      else if (edge) toast('已连接，点这条线可以写备注');
      return;
    }
    if (act.dataset.act === 'do-del') {
      const n = engine.deleteMarked();
      if (n) toast(`已删除 ${n} 项`);
      return;
    }
    if (act.dataset.act === 'cancel') { close(); return; }
    if (act.dataset.act === 'save') { save(); }
  });

  colorInput.addEventListener('input', () => {
    state.color = colorInput.value;
    engine.setColor(colorInput.value);
  });

  /* ---- 保存 ---- */
  async function save() {
    const data = engine.getData();
    show({
      kicker: isNew ? 'SAVE BOARD' : 'SAVE BOARD',
      title: mode === 'links' ? '保存连接' : mode === 'idea' ? '保存灵感' : '保存画板',
      width: 'sm',
      body: `
        <div class="field">
          <label for="f-bt">名称 / TITLE *</label>
          <input id="f-bt" name="title" maxlength="80" value="${esc(state.title)}" placeholder="给这块板起个名字">
        </div>
        <div class="field">
          <label for="f-bn">备注 / NOTE</label>
          <textarea id="f-bn" name="note" rows="3" maxlength="400" placeholder="一句话说明它记的是什么">${esc(state.note)}</textarea>
        </div>
        <div class="field__err"></div>`,
      submit: '保存',
      hint: `${data.nodes.length} 个节点 · ${data.edges.length} 条连线`,
      onSubmit: async (fd) => {
        const title = String(fd.get('title') || '').trim();
        if (!title) {
          root.querySelector('#f-bt')?.focus();
          throw new Error('请填写名称');
        }
        state.title = title;
        state.note = String(fd.get('note') || '').trim();

        const payload = { title, note: state.note, nodes: data.nodes, edges: data.edges };
        const saved = isNew
          ? await api.post('/api/boards', { ...payload, kind: mode })
          : await api.patch(`/api/boards/${board.id}`, payload);

        closeModal();
        state.dirty = false;
        toast(isNew ? '已保存' : '已更新');
        close(true);
        if (onSaved) onSaved(saved);
      },
    });
  }

  /* ---- 关闭 ---- */
  let closed = false;
  async function close(saved = false) {
    if (closed) return;
    if (!saved && state.dirty) {
      const ok = await askConfirm({
        kicker: 'DISCARD', title: '放弃未保存的改动？',
        body: '<p class="ask__p">关闭后这块板上的改动不会保留。</p>',
        yes: '放弃', no: '继续编辑', tone: 'danger',
      });
      if (!ok) return;
    }
    closed = true;
    root.remove();
    document.body.classList.remove('ws-open');
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    if (document.querySelector('.modal:not([hidden])')) return;
    e.preventDefault();
    close();
  }
  document.addEventListener('keydown', onKey);

  root.querySelector('.ws__t').textContent = state.title;
  return { root, engine, close };
}
