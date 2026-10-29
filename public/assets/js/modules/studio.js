/* 网页创作：三标签源码 + 沙箱实时预览 + 版本快照与回滚 */

import { $, esc, toast, fmtTime, bytes } from '../core/ui.js';
import { api } from '../core/api.js';

const TABS = [
  { key: 'html', label: 'HTML', ph: '<h1>你的页面</h1>\n<p>写点什么……</p>' },
  { key: 'css', label: 'CSS', ph: 'body{ background:#0b0d10; color:#e8e6e0 }' },
  { key: 'js', label: 'JS', ph: "document.querySelector('h1').textContent = 'hello'" },
];

export function studioHTML() {
  return `
    <section class="studio" id="studio" data-owner-only>
      <div class="studio__bar">
        <span class="studio__k">网页创作 / Web Craft</span>
        <select class="mini" id="wkSelect" aria-label="选择作品"></select>
        <input class="studio__name" id="wkName" placeholder="作品名称" maxlength="60" spellcheck="false">
        <button class="btn" type="button" data-st="new">＋ 新建</button>
        <button class="btn btn--primary" type="button" data-st="save">保存版本</button>
        <span class="studio__spacer"></span>
        <button class="btn" type="button" data-st="del">删除</button>
      </div>

      <div class="studio__body" id="wkBody" hidden>
        <div class="studio__ed">
          <div class="studio__tabs" id="wkTabs">
            ${TABS.map((t, i) => `<button class="studio__tab${i === 0 ? ' is-on' : ''}" type="button" data-tab="${t.key}">${t.label}</button>`).join('')}
          </div>
          <textarea class="studio__code" id="wkCode" spellcheck="false" autocomplete="off"></textarea>
        </div>
        <div class="studio__pv">
          <div class="studio__pvbar">
            <span>PREVIEW / <b id="wkPvState">draft</b></span>
            <span class="studio__spacer"></span>
            <button class="btn btn--ghost" type="button" data-st="refresh">刷新</button>
            <button class="btn btn--ghost" type="button" data-st="width">手机</button>
          </div>
          <div class="studio__wrap" id="wkWrap">
            <iframe class="studio__frame" id="wkFrame" title="预览"
              sandbox="allow-scripts allow-forms allow-modals" src="about:blank"></iframe>
          </div>
        </div>
      </div>

      <div class="studio__empty" id="wkEmpty">// NO WORK SELECTED<br>点击「新建」开始写一个页面</div>

      <div class="studio__foot">
        <span class="studio__msg" id="wkMsg">输入停止 0.6s 自动同步草稿 · Ctrl/⌘+S 保存版本</span>
        <span class="studio__spacer"></span>
        <span id="wkMeta"></span>
      </div>

      <div class="versions" id="wkVersions"></div>
    </section>`;
}

export async function mountStudio() {
  const el = document.getElementById('studio');
  if (!el) return;

  const ui = {
    select: $('#wkSelect', el),
    name: $('#wkName', el),
    tabs: $('#wkTabs', el),
    code: $('#wkCode', el),
    frame: $('#wkFrame', el),
    wrap: $('#wkWrap', el),
    versions: $('#wkVersions', el),
    msg: $('#wkMsg', el),
    meta: $('#wkMeta', el),
    body: $('#wkBody', el),
    empty: $('#wkEmpty', el),
  };

  const state = { list: [], id: null, src: { html: '', css: '', js: '' }, tab: 'html', draftTimer: null, nameTimer: null };

  const say = (text, isErr = false) => {
    ui.msg.textContent = text;
    ui.msg.classList.toggle('is-err', !!isErr);
  };

  function fillTabs() {
    const t = TABS.find((x) => x.key === state.tab);
    ui.code.value = state.src[state.tab] || '';
    ui.code.placeholder = t.ph;
    ui.code.disabled = !state.id;
  }

  function previewUrl(bust = true) {
    return `/w/${state.id}/preview?draft=1${bust ? '&t=' + Date.now() : ''}`;
  }

  function loadPreview() {
    if (!state.id) { ui.frame.src = 'about:blank'; return; }
    ui.frame.src = previewUrl();
  }

  function renderVersions(versions, currentVersion) {
    if (!versions.length) {
      ui.versions.innerHTML = '<div class="versions__h"><span>VERSIONS</span><span>0</span></div>';
      return;
    }
    ui.versions.innerHTML = `
      <div class="versions__h"><span>VERSIONS / 版本记录</span><span>${versions.length}</span></div>
      ${versions.map((v) => `
        <div class="ver${v.versionNo === currentVersion ? ' is-current' : ''}">
          <span class="ver__no">v${v.versionNo}</span>
          <span class="ver__time">${fmtTime(v.createdAt)}</span>
          <span class="ver__note">${esc(v.note || (v.restoredFrom ? '回滚自 v' + v.restoredFrom : '—'))}</span>
          <span class="ver__time">${bytes(v.bytes)}</span>
          <button class="ver__act" type="button" data-roll="${v.versionNo}">回滚</button>
        </div>`).join('')}`;
  }

  async function loadVersions() {
    if (!state.id) return;
    const list = await api.get(`/api/works/${state.id}/versions`);
    renderVersions(list, state.list.find((w) => w.id === state.id)?.currentVersion);
  }

  async function loadList(selectId) {
    state.list = await api.get('/api/works');
    ui.select.innerHTML = state.list.length
      ? state.list.map((w) => `<option value="${w.id}">${esc(w.title)}</option>`).join('')
      : '<option value="">（暂无作品）</option>';
    if (!state.list.length) {
      state.id = null;
      ui.body.hidden = true;
      ui.empty.hidden = false;
      ui.versions.innerHTML = '';
      ui.name.value = '';
      fillTabs();
      return;
    }
    const target = selectId || state.id || state.list[0].id;
    ui.select.value = target;
    await selectWork(target);
  }

  async function selectWork(id) {
    state.id = id;
    const w = await api.get(`/api/works/${id}`);
    const draft = w.draft && w.draft.rev ? w.draft : w.source;
    state.src = { html: draft.html || '', css: draft.css || '', js: draft.js || '' };
    ui.body.hidden = false;
    ui.empty.hidden = true;
    ui.name.value = w.title || '';
    ui.tab = 'html';
    [...ui.tabs.children].forEach((b, i) => b.classList.toggle('is-on', i === 0));
    fillTabs();
    loadPreview();
    const idx = state.list.findIndex((x) => x.id === id);
    if (idx >= 0) state.list[idx] = { ...state.list[idx], currentVersion: w.currentVersion, latestVersionNo: w.latestVersionNo };
    await loadVersions();
    ui.meta.textContent = `v${w.currentVersion} · ${w.versionCount} 个版本`;
    say('已载入 ' + (w.title || '未命名作品'));
  }

  async function saveDraft() {
    if (!state.id) return;
    try {
      await api.put(`/api/works/${state.id}/draft`, state.src);
      ui.frame.src = previewUrl();
      say('草稿已同步 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }));
    } catch (err) {
      say(err.message || '草稿同步失败', true);
    }
  }

  function scheduleDraft() {
    clearTimeout(state.draftTimer);
    state.draftTimer = setTimeout(saveDraft, 600);
  }

  /* ---------- 事件 ---------- */
  ui.tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    state.src[state.tab] = ui.code.value;
    state.tab = btn.dataset.tab;
    [...ui.tabs.children].forEach((b) => b.classList.toggle('is-on', b === btn));
    fillTabs();
    ui.code.focus();
  });

  ui.code.addEventListener('input', () => {
    state.src[state.tab] = ui.code.value;
    scheduleDraft();
  });

  ui.code.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = ui.code.selectionStart;
      const v = ui.code.value;
      ui.code.value = v.slice(0, s) + '  ' + v.slice(ui.code.selectionEnd);
      ui.code.selectionStart = ui.code.selectionEnd = s + 2;
      state.src[state.tab] = ui.code.value;
      scheduleDraft();
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      el.querySelector('[data-st="save"]').click();
    }
  });

  ui.select.addEventListener('change', () => {
    state.src[state.tab] = ui.code.value;
    selectWork(ui.select.value).catch((err) => say(err.message, true));
  });

  ui.name.addEventListener('input', () => {
    clearTimeout(state.nameTimer);
    state.nameTimer = setTimeout(async () => {
      if (!state.id) return;
      try {
        const w = await api.patch(`/api/works/${state.id}`, { title: ui.name.value.trim() || '未命名作品' });
        const item = state.list.find((x) => x.id === state.id);
        if (item) item.title = w.title;
        const opt = [...ui.select.options].find((o) => o.value === state.id);
        if (opt) opt.textContent = w.title;
      } catch (err) { say(err.message, true); }
    }, 500);
  });

  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-st]');
    const roll = e.target.closest('[data-roll]');

    if (roll) {
      const versionNo = Number(roll.dataset.roll);
      if (!confirm(`回滚到 v${versionNo}？当前内容会保留在版本记录里。`)) return;
      try {
        const r = await api.post(`/api/works/${state.id}/rollback`, { versionNo });
        toast(`已回滚，生成 v${r.newVersionNo}`);
        await loadList(state.id);
        await loadVersions();
      } catch (err) { toast(err.message || '回滚失败'); }
      return;
    }

    if (!btn) return;
    const act = btn.dataset.st;

    if (act === 'new') {
      try {
        const r = await api.post('/api/works', { title: '未命名作品', html: '<h1>新页面</h1>\n<p>从这里开始。</p>' });
        toast('已新建作品');
        await loadList(r.work.id);
        ui.name.focus();
        ui.name.select();
      } catch (err) { toast(err.message || '新建失败'); }
      return;
    }

    if (act === 'save') {
      if (!state.id) return;
      state.src[state.tab] = ui.code.value;
      try {
        const r = await api.post(`/api/works/${state.id}/versions`, { ...state.src, note: '手动保存' });
        toast(`已保存 v${r.versionNo}`);
        state.list = await api.get('/api/works');
        await loadVersions();
        ui.meta.textContent = `v${r.versionNo} · ${state.list.find((x) => x.id === state.id)?.versionCount || 0} 个版本`;
        loadPreview();
      } catch (err) { toast(err.message || '保存失败'); }
      return;
    }

    if (act === 'del') {
      if (!state.id) return;
      if (!confirm('删除这个作品？版本记录会一并移除。')) return;
      try {
        await api.del(`/api/works/${state.id}`);
        toast('作品已删除');
        state.id = null;
        await loadList();
      } catch (err) { toast(err.message || '删除失败'); }
      return;
    }

    if (act === 'refresh') { loadPreview(); say('已刷新预览'); return; }
    if (act === 'width') {
      ui.wrap.classList.toggle('is-mobile');
      btn.textContent = ui.wrap.classList.contains('is-mobile') ? '桌面' : '手机';
    }
  });

  await loadList();
}
