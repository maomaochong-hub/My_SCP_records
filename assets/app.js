/* =========================================================
   S_C_P · PERSONAL TERMINAL
   Local-first personal archive. All data lives in localStorage.
   ========================================================= */
(function () {
  'use strict';

  var KEY = 'scp_terminal_v1';
  var app = document.getElementById('app');
  var veil = document.getElementById('veil');
  var veilLabel = document.getElementById('veilLabel');
  var modal = document.getElementById('modal');
  var toastEl = document.getElementById('toast');
  var form = document.getElementById('itemForm');

  /* ---------------- helpers ---------------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function now() { return Date.now(); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function clockStr(d) { d = d || new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
  function dateStr(d) { d = d || new Date(); return d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate()); }
  function relTime(ts) {
    var s = (now() - (ts || now())) / 1000;
    if (s < 60) return '刚刚';
    if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
    if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
    return new Date(ts).toLocaleDateString('zh-CN');
  }
  function safeUrl(u) {
    u = String(u || '').trim();
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) return '';
    try { new URL(u); return u; } catch (e) { return ''; }
  }
  function hostOf(u) {
    try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }
  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-on'); }, 2200);
  }

  /* ---------------- data ---------------- */
  var storageOK = true;

  function seed() {
    var t = now();
    var c1 = { id: 'cat_classic', name: '经典条目', createdAt: t };
    var c2 = { id: 'cat_sites', name: '站点与工具', createdAt: t };
    return {
      categories: [c1, c2],
      items: [
        { id: uid(), catId: c2.id, code: '—', title: 'SCP 基金会中文维基', url: 'https://scp-wiki-cn.wikidot.com/', note: '主站入口，所有条目的源头。', createdAt: t - 3000, updatedAt: t - 3000 },
        { id: uid(), catId: c1.id, code: 'SCP-6183', title: '本终端的视觉参考', url: 'https://scp-wiki-cn.wikidot.com/scp-6183', note: '配色、字体与版式均由此页面取意。', createdAt: t - 2000, updatedAt: t - 2000 },
        { id: uid(), catId: c1.id, code: 'SCP-173', title: '雕像', url: 'https://scp-wiki-cn.wikidot.com/scp-173', note: '第一条被写下的项目，值得反复重读。', createdAt: t - 1000, updatedAt: t - 1000 }
      ],
      notes: [
        {
          id: uid(), title: '欢迎 · 在这里记录灵感',
          body: '直接点击这段文字就可以编辑。\n\n拖动上方的标题栏可以把这张便签移到任意位置。\n\n所有修改都会自动写入本地档案，刷新或关闭页面都不会丢失。',
          x: 46, y: 44, w: 326, z: 3, accent: 'amber', createdAt: t, updatedAt: t
        },
        {
          id: uid(), title: '待展开的线索',
          body: '· 一个从不重复的收容编号\n· 一段被删除的访谈记录\n· 档案员自己的名字',
          x: 412, y: 108, w: 288, z: 2, accent: 'bone', createdAt: t - 60000, updatedAt: t - 60000
        }
      ],
      other: { remark: '' },
      meta: { createdAt: t }
    };
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { storageOK = false; }
    if (!raw) return seed();
    try {
      var d = JSON.parse(raw);
      return {
        categories: Array.isArray(d.categories) ? d.categories : [],
        items: Array.isArray(d.items) ? d.items : [],
        notes: Array.isArray(d.notes) ? d.notes : [],
        other: { remark: (d.other && d.other.remark) || '' },
        meta: d.meta || {}
      };
    } catch (e) {
      return seed();
    }
  }

  var S = load();
  var zTop = S.notes.reduce(function (m, n) { return Math.max(m, n.z || 1); }, 1);

  var saveTimer = null;
  function save(immediate) {
    setSaveState('saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(KEY, JSON.stringify(S));
        setSaveState('ok');
      } catch (e) {
        setSaveState('err');
        if (!storageOK) toast('本地存储不可用，修改仅保留在当前页面');
      }
    }, immediate ? 0 : 220);
  }

  function setSaveState(state) {
    var el = document.getElementById('saveState');
    var txt = document.getElementById('saveText');
    if (!el) return;
    el.setAttribute('data-state', state);
    txt.textContent = state === 'ok' ? '已保存 ' + clockStr() : state === 'saving' ? '保存中' : '存储失败';
  }

  /* ---------------- router ---------------- */
  var rendered = '';
  var pending = null;
  var suppressHash = false;

  function currentRoute() {
    var h = location.hash.replace(/^#\/?/, '').trim();
    return ['archive', 'writing', 'other'].indexOf(h) > -1 ? h : '';
  }

  var VIEWS = { '': renderHome, archive: renderArchive, writing: renderWriting, other: renderOther };

  function render(route) {
    var fn = VIEWS[route] || renderHome;
    app.innerHTML = fn();
    rendered = route;
    if (route === 'archive') paintCards();
    if (route === '') setSaveState('ok');
  }

  function navigate(route, fromHash) {
    if (route === rendered || route === pending) return;
    pending = route;
    veilLabel.textContent = route ? 'OPENING / ' + route.toUpperCase() : 'RETURNING / INDEX';
    veil.classList.add('is-on');
    veil.classList.remove('is-out');

    setTimeout(function () {
      rendered = route;
      pending = null;
      if (!fromHash) {
        suppressHash = true;
        location.hash = route ? '#/' + route : '#/';
      }
      window.scrollTo(0, 0);
      render(route);
      veil.classList.remove('is-on');
      veil.classList.add('is-out');
      setTimeout(function () {
        veil.classList.remove('is-out');
        suppressHash = false;
      }, 520);
    }, 540);
  }

  window.addEventListener('hashchange', function () {
    if (suppressHash) return;
    var r = currentRoute();
    if (r === rendered) return;
    navigate(r, true);
  });

  /* ---------------- shared fragments ---------------- */
  function pheadHTML(num, title, en, meta) {
    return '' +
      '<header class="phead">' +
      '  <a class="phead__back" href="#/" data-act="home">← <span>返回索引</span></a>' +
      '  <div class="phead__row">' +
      '    <span class="phead__num">' + num + '</span>' +
      '    <h1 class="phead__title">' + title + '</h1>' +
      '    <span class="phead__en">' + en + '</span>' +
      '  </div>' +
      (meta ? '  <div class="phead__meta" id="pheadMeta">' + meta + '</div>' : '') +
      '</header>';
  }

  /* ---------------- home ---------------- */
  function renderHome() {
    var nItems = S.items.length, nCats = S.categories.length, nNotes = S.notes.length;
    var marks = '<span>S</span><span class="u"></span><span>C</span><span class="u"></span><span>P</span>';

    return '' +
      '<section class="home">' +
      '  <div class="home__top">' +
      '    <div class="home__meta-line"><span>File // 6183</span><b>Rev. 04 · ' + dateStr() + '</b></div>' +
      '    <h1 class="wordmark" aria-label="SCP">' + marks + '</h1>' +
      '    <div class="home__rule"><span>Secure · Contain · Protect</span></div>' +
      '  </div>' +

      '  <div class="home__mid">' +
      '    <figure class="sigil"><img src="assets/sigil.png" alt="SCP 基金会徽记" width="783" height="678"></figure>' +
      '    <div class="banner">' +
      '      <span class="banner__led" aria-hidden="true"></span>' +
      '      <span class="banner__txt">本网站已被标记为待删除</span>' +
      '      <span class="banner__code">Deletion&nbsp;Pending</span>' +
      '    </div>' +
      '    <p class="home__sub">归档流程进行中 · 内容仍可访问与编辑</p>' +
      '  </div>' +

      '  <nav class="entries" aria-label="板块入口">' +
      '    <a class="entry" href="#/archive" data-route="archive">' +
      '      <span class="entry__in">' +
      '        <span class="entry__idx">01</span>' +
      '        <span class="entry__t">项目收集</span>' +
      '        <span class="entry__en">Collection</span>' +
      '        <span class="entry__meta"><b>' + nItems + '</b> 个项目 · <b>' + nCats + '</b> 个分类</span>' +
      '      </span>' +
      '      <span class="entry__arrow">→</span>' +
      '    </a>' +
      '    <a class="entry" href="#/writing" data-route="writing">' +
      '      <span class="entry__in">' +
      '        <span class="entry__idx">02</span>' +
      '        <span class="entry__t">灵感写作</span>' +
      '        <span class="entry__en">Notes</span>' +
      '        <span class="entry__meta"><b>' + nNotes + '</b> 张便签 · 自动保存</span>' +
      '      </span>' +
      '      <span class="entry__arrow">→</span>' +
      '    </a>' +
      '    <a class="entry" href="#/other" data-route="other">' +
      '      <span class="entry__in">' +
      '        <span class="entry__idx">03</span>' +
      '        <span class="entry__t">其他</span>' +
      '        <span class="entry__en">Misc.</span>' +
      '        <span class="entry__meta">未编目 · 占位</span>' +
      '      </span>' +
      '      <span class="entry__arrow">→</span>' +
      '    </a>' +
      '  </nav>' +
      '</section>';
  }

  /* ---------------- archive ---------------- */
  var filter = { cat: 'all', q: '' };

  function catCount(id) {
    return S.items.filter(function (i) { return (i.catId || '') === id; }).length;
  }

  function filteredItems() {
    var q = filter.q.trim().toLowerCase();
    return S.items
      .filter(function (i) {
        if (filter.cat !== 'all' && (i.catId || '') !== filter.cat) return false;
        if (!q) return true;
        return (i.title + ' ' + (i.code || '') + ' ' + (i.note || '') + ' ' + hostOf(i.url)).toLowerCase().indexOf(q) > -1;
      })
      .slice()
      .sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
  }

  function cardHTML(it, i) {
    var cat = S.categories.filter(function (c) { return c.id === it.catId; })[0];
    var url = safeUrl(it.url);
    var host = url ? hostOf(url) : '';
    return '' +
      '<article class="dcard" data-id="' + it.id + '" style="animation-delay:' + Math.min(i * 35, 320) + 'ms">' +
      '  <div class="dcard__top">' +
      '    <span class="dcard__code">' + esc(it.code || '—') + '</span>' +
      '    <span class="dcard__tag">' + esc(cat ? cat.name : '未分类') + '</span>' +
      '  </div>' +
      '  <h3 class="dcard__title">' + esc(it.title) + '</h3>' +
      '  <p class="dcard__desc">' + esc(it.note || '') + '</p>' +
      '  <div class="dcard__foot">' +
      (url
        ? '    <a class="dcard__link" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer"><em>' + esc(host) + '</em><span>↗</span></a>'
        : '    <span class="dcard__link"><em>无链接</em></span>') +
      '    <span class="dcard__acts">' +
      '      <button type="button" data-act="edit-item" data-id="' + it.id + '">编辑</button>' +
      '      <button type="button" class="danger" data-act="del-item" data-id="' + it.id + '">删除</button>' +
      '    </span>' +
      '  </div>' +
      '</article>';
  }

  function emptyHTML() {
    var none = S.items.length === 0;
    return '' +
      '<div class="empty">' +
      '  <span class="empty__k">// ' + (none ? 'no records' : 'no match') + '</span>' +
      '  <span class="empty__t">' + (none ? '档案柜还是空的' : '没有符合条件的项目') + '</span>' +
      '  <span class="empty__h">' + (none ? '点击右上方「新建项目」收录第一个条目；也可以先在左侧建立自己的分类。' : '换个关键词，或切回「全部」分类。') + '</span>' +
      (none ? '  <button type="button" class="btn btn--primary" data-act="new-item">＋ 新建项目</button>' : '') +
      '</div>';
  }

  function archiveMetaHTML() {
    return '<span>RECORDS <b id="mItems">' + S.items.length + '</b></span>' +
      '<span>CATEGORIES <b id="mCats">' + S.categories.length + '</b></span>' +
      '<span>FILTER <b id="mFilter">' + (filter.cat === 'all' ? 'ALL' : catName(filter.cat)) + '</b></span>';
  }

  function catName(id) {
    var c = S.categories.filter(function (x) { return x.id === id; })[0];
    return c ? c.name : 'ALL';
  }

  function renderArchive() {
    var cats = S.categories.map(function (c) {
      return '' +
        '<div class="cat' + (filter.cat === c.id ? ' is-on' : '') + '" role="button" tabindex="0" data-act="cat-select" data-cat="' + c.id + '">' +
        '  <span class="cat__name">' + esc(c.name) + '</span>' +
        '  <span class="cat__n">' + catCount(c.id) + '</span>' +
        '  <button type="button" class="cat__x" data-act="del-cat" data-cat="' + c.id + '" aria-label="删除分类">✕</button>' +
        '</div>';
    }).join('');

    return '' +
      '<section class="page page--archive">' +
      pheadHTML('01', '项目收集', 'Collection / Archive', archiveMetaHTML()) +
      '<div class="archive">' +

      '  <aside class="side">' +
      '    <div class="side__h"><span>分类 / Categories</span><span id="catTotal">' + S.categories.length + '</span></div>' +
      '    <div class="cats">' +
      '      <div class="cat' + (filter.cat === 'all' ? ' is-on' : '') + '" role="button" tabindex="0" data-act="cat-select" data-cat="all">' +
      '        <span class="cat__name">全部项目</span><span class="cat__n">' + S.items.length + '</span>' +
      '      </div>' +
      cats +
      '    </div>' +
      '    <div class="side__add">' +
      '      <button type="button" class="side__new" data-act="show-cat-form">＋ 新建分类</button>' +
      '      <form class="side__form" id="catForm" hidden>' +
      '        <input class="mini" name="name" placeholder="分类名称" maxlength="24" autocomplete="off">' +
      '        <div class="side__acts">' +
      '          <button type="submit" class="btn btn--primary">建立</button>' +
      '          <button type="button" class="btn" data-act="hide-cat-form">取消</button>' +
      '        </div>' +
      '      </form>' +
      '    </div>' +
      '  </aside>' +

      '  <div class="content">' +
      '    <div class="toolbar">' +
      '      <label class="search">' +
      '        <span class="search__ico">⌕</span>' +
      '        <input id="q" type="search" placeholder="检索编号 / 名称 / 备注 / 域名" value="' + esc(filter.q) + '" autocomplete="off">' +
      '      </label>' +
      '      <button type="button" class="btn btn--primary" data-act="new-item">＋ 新建项目</button>' +
      '    </div>' +
      '    <div class="cards" id="cards"></div>' +
      '  </div>' +
      '</div>' +
      '</section>';
  }

  function paintCards() {
    var wrap = document.getElementById('cards');
    if (!wrap) return;
    var list = filteredItems();
    wrap.innerHTML = list.length ? list.map(cardHTML).join('') : emptyHTML();
  }

  function refreshArchiveMeta() {
    var mi = document.getElementById('mItems'), mc = document.getElementById('mCats'), mf = document.getElementById('mFilter');
    if (mi) mi.textContent = S.items.length;
    if (mc) mc.textContent = S.categories.length;
    if (mf) mf.textContent = filter.cat === 'all' ? 'ALL' : catName(filter.cat);
    var ct = document.getElementById('catTotal');
    if (ct) ct.textContent = S.categories.length;
  }

  /* ---------------- writing ---------------- */
  function noteHTML(n, i) {
    return '' +
      '<article class="note" data-id="' + n.id + '" data-accent="' + esc(n.accent || 'bone') + '"' +
      '  style="left:' + (n.x || 24) + 'px;top:' + (n.y || 24) + 'px;width:' + (n.w || 310) + 'px;z-index:' + (n.z || 1) + ';--d:-' + (i * 1.7).toFixed(1) + 's">' +
      '  <header class="note__bar">' +
      '    <span class="note__dot"></span>' +
      '    <span class="note__idx">NOTE ' + pad(i + 1) + '</span>' +
      '    <button type="button" class="note__del" data-act="del-note" data-id="' + n.id + '" aria-label="删除笔记">✕</button>' +
      '  </header>' +
      '  <div class="note__title" contenteditable="true" spellcheck="false" data-field="title" data-ph="未命名笔记">' + esc(n.title) + '</div>' +
      '  <div class="note__body" contenteditable="true" spellcheck="false" data-field="body" data-ph="在这里写下灵感……">' + esc(n.body) + '</div>' +
      '  <footer class="note__foot"><span data-updated>' + relTime(n.updatedAt) + '</span><span>' + (n.body || '').length + ' 字</span></footer>' +
      '</article>';
  }

  function renderWriting() {
    return '' +
      '<section class="page page--writing">' +
      pheadHTML('02', '灵感写作', 'Notes / Inspiration',
        '<span>NOTES <b>' + S.notes.length + '</b></span><span>MODE <b>FREE FLOAT</b></span><span>AUTOSAVE <b>ON</b></span>') +
      '<div class="boardbar">' +
      '  <span class="boardbar__hint">拖动标题栏移动便签 · 点击文字直接编辑 · 修改自动保存</span>' +
      '  <span class="boardbar__count"><b>' + S.notes.length + '</b> 张便签</span>' +
      '  <button type="button" class="btn btn--primary" data-act="new-note">＋ 新建笔记</button>' +
      '</div>' +
      '<div class="board" id="board">' +
      S.notes.map(noteHTML).join('') +
      '<p class="board__hint" aria-hidden="true">双击空白处 · 新建便签</p>' +
      '</div>' +
      '</section>';
  }

  function addNote(px, py) {
    var board = document.getElementById('board');
    var bw = board ? board.clientWidth : 960;
    var bh = board ? board.clientHeight : 560;
    var w = Math.min(330, Math.max(240, bw - 110));
    var i = S.notes.length;
    var x, y;
    if (typeof px === 'number' && typeof py === 'number') {
      x = Math.max(8, Math.min(px - w / 2, bw - w - 12));
      y = Math.max(8, Math.min(py - 24, bh - 150));
    } else {
      x = Math.min(28 + (i % 5) * 34, Math.max(8, bw - w - 12));
      y = Math.min(30 + (i % 5) * 30, Math.max(8, bh - 170));
    }
    var note = {
      id: uid(), title: '', body: '',
      x: Math.round(x), y: Math.round(y), w: Math.round(w), z: ++zTop,
      accent: ['amber', 'bone', 'red'][i % 3],
      createdAt: now(), updatedAt: now()
    };
    S.notes.push(note);
    save();
    render('writing');
    setTimeout(function () {
      var el = document.querySelector('.note[data-id="' + note.id + '"] .note__title');
      if (el) el.focus();
    }, 80);
  }

  function bringFront(el) {
    if (!el) return;
    var z = parseInt(el.style.zIndex, 10) || 1;
    if (z >= zTop) return;
    el.style.zIndex = ++zTop;
    var n = S.notes.filter(function (v) { return v.id === el.dataset.id; })[0];
    if (n) { n.z = zTop; save(); }
  }

  function startDrag(bar, e) {
    var note = bar.closest('.note');
    var board = note && note.parentElement;
    if (!board || !board.classList.contains('board')) return;
    if (window.matchMedia('(max-width: 720px)').matches) return;

    var nr = note.getBoundingClientRect();
    var br = board.getBoundingClientRect();
    var dx = e.clientX - nr.left;
    var dy = e.clientY - nr.top;

    note.classList.add('is-dragging');
    if (bar.setPointerCapture) { try { bar.setPointerCapture(e.pointerId); } catch (err) {} }

    function move(ev) {
      var x = ev.clientX - br.left - dx;
      var y = ev.clientY - br.top - dy;
      x = Math.max(4, Math.min(x, br.width - nr.width - 4));
      y = Math.max(4, Math.min(y, br.height - nr.height - 4));
      note.style.left = x + 'px';
      note.style.top = y + 'px';
    }
    function end() {
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', end);
      bar.removeEventListener('pointercancel', end);
      note.classList.remove('is-dragging');
      var n = S.notes.filter(function (v) { return v.id === note.dataset.id; })[0];
      if (n) {
        n.x = Math.round(parseFloat(note.style.left) || 0);
        n.y = Math.round(parseFloat(note.style.top) || 0);
        n.z = parseInt(note.style.zIndex, 10) || 1;
        n.updatedAt = now();
        save();
      }
    }
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
  }

  /* ---------------- other ---------------- */
  function renderOther() {
    var ghosts = ['模块 A', '模块 B', '模块 C'].map(function (t, i) {
      return '' +
        '<div class="ghost">' +
        '  <span class="ghost__k">SLOT 0' + (i + 1) + ' / UNASSIGNED</span>' +
        '  <span class="ghost__t">' + t + '</span>' +
        '  <span class="ghost__lock">⌗</span>' +
        '  <span class="ghost__num">0' + (i + 1) + '</span>' +
        '  <span class="ghost__line"></span>' +
        '  <span class="ghost__s">// 内容暂未确定<br>等待归档指令</span>' +
        '</div>';
    }).join('');

    return '' +
      '<section class="page page--other">' +
      pheadHTML('03', '其他', 'Miscellaneous / Reserved',
        '<span>STATUS <b>预留</b></span><span>SLOTS <b>3</b></span><span>CONTENT <b>待定</b></span>') +
      '<div class="ghost-grid">' + ghosts + '</div>' +
      '<div class="reserve"><span>// 三个槽位保留给后续内容</span><span>点击下方备注可临时记录想法</span></div>' +
      '<div class="slot">' +
      '  <div class="slot__h"><span>预留备注 / Notes for later</span><span>可编辑 · 自动保存</span></div>' +
      '  <div class="slot__body" contenteditable="true" spellcheck="false" data-slot="remark" data-ph="这个板块之后想放什么？随手记在这里，会自动保存。">' + esc(S.other.remark || '') + '</div>' +
      '</div>' +
      '</section>';
  }

  /* ---------------- modal ---------------- */
  var editingId = null;

  function openItemModal(id) {
    editingId = id || null;
    var it = id ? S.items.filter(function (v) { return v.id === id; })[0] : null;

    document.getElementById('modalTitle').textContent = it ? '编辑记录' : '新建项目';
    document.getElementById('modalKicker').textContent = it ? 'Edit Record' : 'New Record';

    var sel = document.getElementById('f-cat');
    if (S.categories.length) {
      sel.innerHTML = S.categories.map(function (c) {
        return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>';
      }).join('') + '<option value="">未分类</option>';
    } else {
      sel.innerHTML = '<option value="">未分类</option>';
    }

    document.getElementById('f-code').value = it ? (it.code || '') : '';
    document.getElementById('f-title').value = it ? (it.title || '') : '';
    document.getElementById('f-url').value = it ? (it.url || '') : '';
    document.getElementById('f-note').value = it ? (it.note || '') : '';

    if (it) {
      sel.value = it.catId || '';
    } else {
      sel.value = (filter.cat !== 'all' ? filter.cat : (S.categories[0] ? S.categories[0].id : '')) || '';
    }

    modal.hidden = false;
    setTimeout(function () { document.getElementById('f-title').focus(); }, 60);
  }

  function closeModal() {
    modal.hidden = true;
    editingId = null;
    form.reset();
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var title = document.getElementById('f-title').value.trim();
    if (!title) {
      document.getElementById('f-title').focus();
      toast('请填写名称');
      return;
    }
    var payload = {
      code: document.getElementById('f-code').value.trim() || '—',
      title: title,
      url: document.getElementById('f-url').value.trim(),
      catId: document.getElementById('f-cat').value || null,
      note: document.getElementById('f-note').value.trim()
    };

    if (editingId) {
      var it = S.items.filter(function (v) { return v.id === editingId; })[0];
      if (it) {
        it.code = payload.code; it.title = payload.title;
        it.url = payload.url; it.catId = payload.catId; it.note = payload.note;
        it.updatedAt = now();
      }
      toast('记录已更新');
    } else {
      payload.id = uid();
      payload.createdAt = now();
      payload.updatedAt = now();
      S.items.unshift(payload);
      toast('记录已归档');
    }
    save(true);
    closeModal();
    paintCards();
    refreshArchiveMeta();
  });

  /* ---------------- events ---------------- */
  document.addEventListener('click', function (e) {
    var exp = e.target.closest('[data-act="export"]');
    if (exp) { exportData(); return; }
    var home = e.target.closest('[data-act="home"]');
    if (home) { e.preventDefault(); navigate('', false); return; }
  });

  app.addEventListener('click', function (e) {
    var routeEl = e.target.closest('[data-route]');
    if (routeEl) {
      e.preventDefault();
      navigate(routeEl.getAttribute('data-route'), false);
      return;
    }

    var el = e.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act');
    var id = el.getAttribute('data-id');
    var cat = el.getAttribute('data-cat');

    if (act === 'home') { e.preventDefault(); navigate('', false); return; }

    if (act === 'new-item') { openItemModal(null); return; }

    if (act === 'edit-item') {
      e.stopPropagation();
      openItemModal(id);
      return;
    }

    if (act === 'del-item') {
      e.stopPropagation();
      var it = S.items.filter(function (v) { return v.id === id; })[0];
      if (!it) return;
      if (!confirm('删除记录「' + it.title + '」？此操作不可撤销。')) return;
      S.items = S.items.filter(function (v) { return v.id !== id; });
      save(true); paintCards(); refreshArchiveMeta();
      toast('记录已删除');
      return;
    }

    if (act === 'cat-select') {
      filter.cat = cat;
      $$('.cat', app).forEach(function (n) {
        n.classList.toggle('is-on', n.getAttribute('data-cat') === cat);
      });
      paintCards(); refreshArchiveMeta();
      return;
    }

    if (act === 'del-cat') {
      e.stopPropagation();
      var c = S.categories.filter(function (v) { return v.id === cat; })[0];
      if (!c) return;
      var n = catCount(cat);
      if (!confirm('删除分类「' + c.name + '」？' + (n ? '其中 ' + n + ' 个项目将移入「未分类」。' : ''))) return;
      S.categories = S.categories.filter(function (v) { return v.id !== cat; });
      S.items.forEach(function (i) { if (i.catId === cat) i.catId = null; });
      if (filter.cat === cat) filter.cat = 'all';
      save(true);
      render('archive');
      paintCards();
      toast('分类已删除');
      return;
    }

    if (act === 'show-cat-form') {
      var f = document.getElementById('catForm');
      if (f) { f.hidden = false; f.querySelector('input').focus(); }
      return;
    }

    if (act === 'hide-cat-form') {
      var f2 = document.getElementById('catForm');
      if (f2) { f2.hidden = true; f2.reset(); }
      return;
    }

    if (act === 'new-note') { addNote(); return; }

    if (act === 'del-note') {
      var nt = S.notes.filter(function (v) { return v.id === id; })[0];
      if (!nt) return;
      if (!confirm('删除这张便签？')) return;
      S.notes = S.notes.filter(function (v) { return v.id !== id; });
      save(true);
      render('writing');
      toast('便签已删除');
      return;
    }

    if (act === 'modal-close') { closeModal(); return; }
  });

  app.addEventListener('submit', function (e) {
    if (e.target.id !== 'catForm') return;
    e.preventDefault();
    var input = e.target.querySelector('input');
    var name = (input.value || '').trim();
    if (!name) { input.focus(); return; }
    if (S.categories.some(function (c) { return c.name === name; })) {
      toast('分类已存在');
      input.select();
      return;
    }
    S.categories.push({ id: uid(), name: name, createdAt: now() });
    save(true);
    render('archive');
    paintCards();
    toast('分类已建立');
  });

  app.addEventListener('input', function (e) {
    var q = e.target.closest('#q');
    if (q) {
      filter.q = q.value;
      paintCards();
      return;
    }

    var field = e.target.closest('[data-field]');
    if (field) {
      var noteEl = field.closest('.note');
      if (!noteEl) return;
      var n = S.notes.filter(function (v) { return v.id === noteEl.dataset.id; })[0];
      if (!n) return;
      n[field.dataset.field] = field.innerText.replace(/\u00a0/g, ' ');
      n.updatedAt = now();
      save();
      var foot = noteEl.querySelector('[data-updated]');
      if (foot) foot.textContent = '刚刚';
      var cnt = noteEl.querySelector('.note__foot span:last-child');
      if (cnt) cnt.textContent = (n.body || '').length + ' 字';
      return;
    }

    var slot = e.target.closest('[data-slot]');
    if (slot) {
      S.other.remark = slot.innerText.replace(/\u00a0/g, ' ');
      save();
    }
  });

  app.addEventListener('pointerdown', function (e) {
    var note = e.target.closest('.note');
    if (note && !e.target.closest('.note__del')) bringFront(note);
    var bar = e.target.closest('.note__bar');
    if (!bar) return;
    e.preventDefault();
    startDrag(bar, e);
  });

  app.addEventListener('dblclick', function (e) {
    var board = e.target.closest('.board');
    if (!board || e.target.closest('.note')) return;
    var r = board.getBoundingClientRect();
    addNote(e.clientX - r.left, e.clientY - r.top);
  });

  app.addEventListener('keydown', function (e) {
    var cat = e.target.closest('.cat');
    if (cat && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      cat.click();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (!modal.hidden) { closeModal(); return; }
      var f = document.getElementById('catForm');
      if (f && !f.hidden) { f.hidden = true; f.reset(); }
    }
  });

  /* ---------------- import / export ---------------- */
  function exportData() {
    var blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'scp-terminal-' + dateStr().replace(/\./g, '') + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast('档案已导出');
  }

  document.getElementById('importInput').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var d = JSON.parse(String(reader.result));
        if (!d || !Array.isArray(d.items) || !Array.isArray(d.notes)) throw new Error('bad');
        S = {
          categories: Array.isArray(d.categories) ? d.categories : [],
          items: d.items,
          notes: d.notes,
          other: { remark: (d.other && d.other.remark) || '' },
          meta: d.meta || {}
        };
        zTop = S.notes.reduce(function (m, n) { return Math.max(m, n.z || 1); }, 1);
        save(true);
        render(rendered || '');
        toast('档案已导入');
      } catch (err) {
        toast('文件格式不正确');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  /* ---------------- clock ---------------- */
  var clockEl = document.getElementById('clock');
  var dateEl = document.getElementById('clockDate');
  if (dateEl) dateEl.textContent = dateStr();
  function tick() { if (clockEl) clockEl.textContent = clockStr(); }
  tick();
  setInterval(tick, 1000);

  /* ---------------- boot ---------------- */
  if (!storageOK) toast('本地存储不可用，修改不会保留');
  render(currentRoute());
})();
