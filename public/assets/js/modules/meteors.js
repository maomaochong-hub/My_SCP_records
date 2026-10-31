/* 流星：斜落的星辰
   - 小流星：缓斜、慢速、星核微闪
   - 大流星：更快更陡，自带光晕，经过文字时按距离提亮
   - 大流星沿路撞到小流星，小流星当场消失（留一瞬闪光）

   调试开关（写在地址栏）：
     /?meteors=on    忽略「减少动效」，强制播放
     /?meteors=test  强制播放 + 密集生成，用来确认效果
     /?meteors=off   完全关闭
   控制台：SCP_METEORS.diagnose() / SCP_METEORS.start() / SCP_METEORS.burst(3)
*/

import { reduceMotion } from '../core/ui.js';

const MODE = (new URLSearchParams(location.search).get('meteors') || '').toLowerCase();
const TEST = MODE === 'test';
const FORCED = MODE === 'on' || TEST;

const BIG_RATE = TEST ? 0.5 : 0.18;        // 每次生成时成为大流星的概率
const BIG_COOLDOWN = TEST ? 1200 : 18000;  // 两颗大流星之间的最小间隔
const EAT_RADIUS = 52;                     // 吞噬判定半径
const MAX_SMALL = TEST ? 6 : 3;
const LIGHT_R = 380;                       // 照亮半径（像素）
const GAP = TEST ? [700, 1100] : [1700, 4200];
const FIRST_AT = TEST ? 260 : 1400;        // 打开后第一颗的时间

/** 引擎状态：给诊断用 */
const state = {
  mounted: false,
  reason: '',
  active: null,
  field: null,
  burst: () => 0,
};

export function mountMeteors(root, opts = {}) {
  const field = root && root.querySelector('.meteor-field');
  const glare = root && root.querySelector('.glare');

  if (MODE === 'off') {
    document.documentElement.classList.add('meteor-off');
    state.reason = '地址栏带了 ?meteors=off';
    return null;
  }
  if (!field) {
    state.reason = '页面上没有 .meteor-field（次页本来就没有，只有首页有）';
    return null;
  }
  if (!glare) {
    state.reason = '页面上没有 .glare 照亮层';
    return null;
  }
  if (field.dataset.meteorOn === '1') {
    state.reason = '已经挂载过了，不重复挂载';
    return null;
  }

  // 关键：系统开「减少动效」不等于不画流星，只是画得更慢、更少。
  // （以前这里直接 return，导致很多人完全看不到流星，也没有任何提示。）
  const soft = !opts.force && !FORCED && reduceMotion();
  const maxSmall = soft ? 2 : MAX_SMALL;
  const gap = soft ? [3800, 7200] : GAP;
  const bigRate = soft ? 0.09 : BIG_RATE;
  const bigCooldown = soft ? 26000 : BIG_COOLDOWN;
  const speedScale = soft ? 0.55 : 1;

  field.dataset.meteorOn = '1';
  state.mounted = true;
  state.reason = '';
  state.field = field;

  seedStars(root.querySelector('.starfield'));

  // 带 ?debug 时把关键状态写进 <html data-meteor-diag>，不用开控制台也能查
  if (location.search.includes('debug')) {
    const st = getComputedStyle(field);
    document.documentElement.dataset.meteorDiag = [
      'mounted', field.clientWidth + 'x' + field.clientHeight,
      'pos=' + st.position, 'z=' + st.zIndex,
      'reduce=' + (reduceMotion() ? 1 : 0),
      'forced=' + (FORCED ? 1 : 0),
    ].join(' ');
  }

  const active = [];
  state.active = active;
  let raf = null;
  let timer = null;
  let stopped = false;
  let lastBig = 0;
  let glareEnv = 0;
  let textBox = null;
  let firstSpawn = true;

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  function schedule() {
    clearTimeout(timer);
    if (stopped) return;
    timer = setTimeout(spawn, rand(gap[0], gap[1]));
  }

  function spawn() {
    if (stopped || document.hidden) return schedule();

    const w = field.clientWidth;
    const h = field.clientHeight;
    if (!w || !h) return schedule();

    const now = performance.now();
    const bigs = active.reduce((n, m) => n + (m.big ? 1 : 0), 0);
    const smalls = active.length - bigs;

    // 第一颗一定从画面中央掠过：打开页面 1.4 秒内就能确认「流星是有的」
    const aimFirst = firstSpawn;
    firstSpawn = false;

    if (Math.random() < bigRate && bigs === 0 && now - lastBig > bigCooldown) {
      create(true, w, h, now, aimFirst);
      lastBig = now;
    } else if (smalls < maxSmall) {
      create(false, w, h, now, aimFirst);
    }

    schedule();
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function create(big, w, h, now, aimText) {
    // 方向：默认左上←右下（与水平线 10°–34°），少量反向
    let deg;
    if (big) {
      // 大流星走得陡些，轨迹才可能落进句子所在的画面中段
      deg = rand(151, 162);
    } else {
      deg = Math.random() < 0.18 ? rand(20, 42) : rand(150, 170);
    }
    const rad = (deg * Math.PI) / 180;
    const dirX = Math.cos(rad);
    const dirY = Math.sin(rad);

    const len = big ? rand(215, 320) : rand(120, 230);
    const hh = big ? 14 : 11;
    const speed = (big ? rand(1150, 1650) : rand(520, 820)) * speedScale;
    const y0 = -14;

    // 起点：贴着视口上缘之外
    let x0;
    const aim = aimText || (big && Math.random() < 0.62) ? textCenter(w, h) : null;
    if (aim) {
      // 反推起点，使轨迹正好掠过句子中心——否则大流星大多从句子左侧飞走，照亮效果根本看不到
      x0 = aim.x - (dirX / dirY) * (aim.y - y0);
      if (x0 > w * 1.45 || x0 < -w * 0.2) x0 = dirX < 0 ? w * rand(0.92, 1.18) : w * rand(-0.1, 0.15);
    } else {
      x0 = dirX < 0 ? w * rand(0.52, 1.1) : w * rand(-0.06, 0.55);
    }

    // 横向或纵向任一方向出画即结束，末段淡出才不会拖在画外
    const vExit = (h + 40 - y0) / dirY;
    const hExit = dirX < 0 ? (x0 + len + 40) / -dirX : (w + 40 - x0) / dirX;
    const travel = Math.min(vExit, hExit);
    const dur = (travel / speed) * 1000;

    const el = document.createElement('div');
    el.className = 'meteor' + (big ? ' is-big' : '');
    el.style.setProperty('--len', len.toFixed(0) + 'px');
    el.style.setProperty('--h', hh + 'px');
    el.style.width = len.toFixed(0) + 'px';
    field.appendChild(el);

    // 每颗流星都带一层很淡的环境光，大流星的光晕更大
    const glow = document.createElement('div');
    glow.className = 'meteor__glow';
    glow.style.setProperty('--gs', big ? '420px' : '110px');
    field.appendChild(glow);

    active.push({
      el, glow, big, dead: false, hh,
      x0, y0, dirX, dirY, travel, len, deg, dur,
      t0: now,
      phase: rand(0, Math.PI * 2),
      omega: rand(1.5, 2.7),
      hx: x0, hy: y0,
    });
  }

  function tick(now) {
    const w = field.clientWidth;
    const h = field.clientHeight;
    let bigAlive = false;
    const frame = active.slice();

    for (const m of frame) {
      if (m.dead || !m.el.isConnected) continue;

      const p = (now - m.t0) / m.dur;

      if (p >= 1) {
        m.el.remove();
        if (m.glow) m.glow.remove();
        active.splice(active.indexOf(m), 1);
        continue;
      }

      const x = m.x0 + m.dirX * m.travel * p;
      const y = m.y0 + m.dirY * m.travel * p;
      m.hx = x;
      m.hy = y;

      // 元素中心对齐飞行点，头部恰好落在 (x,y)
      m.el.style.transform = `translate3d(${(x - m.len).toFixed(1)}px,${(y - m.hh / 2).toFixed(1)}px,0) rotate(${m.deg.toFixed(2)}deg)`;

      // 透明度包络：快速淡入、末段淡出
      const env = p < 0.08 ? p / 0.08 : p > 0.82 ? (1 - p) / 0.18 : 1;
      const base = clamp01(env) * (m.big ? 1 : 0.95);
      m.el.style.opacity = base.toFixed(3);

      // 星核呼吸：±12%
      m.el.style.setProperty('--tw', (1 + 0.12 * Math.sin((now / 1000) * m.omega + m.phase)).toFixed(3));

      if (m.glow) {
        m.glow.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
        m.glow.style.opacity = (clamp01(env) * (m.big ? 0.92 : 0.5)).toFixed(3);
      }

      if (m.big) {
        bigAlive = true;
        // 沿途吞噬小流星
        const victims = active.filter((s) => !s.big && !s.dead && s !== m &&
          Math.hypot(s.hx - x, s.hy - y) < EAT_RADIUS);
        victims.forEach((s) => eat(s, x, y));
        illuminate(x, y, w, h);
      }
    }

    if (!bigAlive) {
      glareEnv *= 0.9;
      if (glareEnv < 0.004) glareEnv = 0;
      glare.style.opacity = glareEnv.toFixed(3);
    }

    // 出画后回收
    if (active.length) {
      raf = requestAnimationFrame(tick);
    } else {
      raf = null;
    }
  }

  /** 句子的几何中心（视口坐标），懒计算并缓存 */
  function textCenter(w, h) {
    if (!textBox) {
      const latin = root.querySelector('.latin');
      textBox = latin ? latin.getBoundingClientRect() : { left: w / 2, top: h / 2, width: 0, height: 0 };
    }
    return { x: textBox.left + textBox.width / 2, y: textBox.top + textBox.height / 2 };
  }

  /** 按与文字的距离照亮：近则亮，飞远自然暗下去 */
  function illuminate(x, y, w, h) {
    const c = textCenter(w, h);
    const d = Math.hypot(x - c.x, y - c.y);
    const target = clamp01(1 - d / LIGHT_R) * 0.95;
    glareEnv += (target - glareEnv) * 0.2;
    glare.style.setProperty('--mx', x.toFixed(1) + 'px');
    glare.style.setProperty('--my', y.toFixed(1) + 'px');
    glare.style.opacity = glareEnv.toFixed(3);
  }

  function eat(small, x, y) {
    small.dead = true;
    small.el.classList.add('is-hit');
    if (small.glow) small.glow.remove();
    const idx = active.indexOf(small);
    if (idx >= 0) active.splice(idx, 1);
    setTimeout(() => small.el.remove(), 170);

    const spark = document.createElement('div');
    spark.className = 'meteor__spark';
    spark.style.left = x.toFixed(0) + 'px';
    spark.style.top = y.toFixed(0) + 'px';
    field.appendChild(spark);
    setTimeout(() => spark.remove(), 320);
  }

  function reset() {
    active.forEach((m) => { m.el.remove(); if (m.glow) m.glow.remove(); });
    active.length = 0;
    glareEnv = 0;
    glare.style.opacity = '0';
    textBox = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopped = true;
      clearTimeout(timer);
      reset();
    } else if (stopped) {
      stopped = false;
      lastBig = performance.now();
      schedule();
    }
  });

  window.addEventListener('resize', () => { textBox = null; }, { passive: true });

  state.burst = (n = 3) => {
    const w = field.clientWidth;
    const h = field.clientHeight;
    for (let i = 0; i < n; i++) {
      const now = performance.now();
      setTimeout(() => { if (!stopped) { create(i === 0, w, h, performance.now()); if (!raf) raf = requestAnimationFrame(tick); } }, i * 240);
    }
    return n;
  };

  timer = setTimeout(spawn, FIRST_AT);
  // 首屏多给一颗，避免「打开后很久没东西」的错觉
  setTimeout(() => { if (!stopped && active.length < 1) spawn(); }, FIRST_AT + 1500);

  return { stop() { stopped = true; clearTimeout(timer); reset(); field.dataset.meteorOn = ''; } };
}

/** 常驻星尘：几乎察觉不到的 1px 微星 */
function seedStars(layer) {
  if (!layer) return;
  const n = 16;
  let html = '';
  for (let i = 0; i < n; i++) {
    const left = (Math.random() * 100).toFixed(2);
    const top = (Math.random() * 96).toFixed(2);
    const dur = (6 + Math.random() * 5).toFixed(1);
    const delay = (Math.random() * 6).toFixed(1);
    html += `<i class="star" style="left:${left}%;top:${top}%;animation-duration:${dur}s;animation-delay:-${delay}s"></i>`;
  }
  layer.innerHTML = html;
}

/* =========================================================
   诊断：在浏览器控制台输入 SCP_METEORS.diagnose()
   它会把「为什么看不见」直接说出来，不用猜
   ========================================================= */

function line(label, value, ok) {
  const mark = ok === undefined ? '·' : ok ? '[OK]  ' : '[!!]  ';
  return `${mark}${label}: ${value}`;
}

export function diagnose() {
  const field = document.querySelector('.meteor-field');
  const glare = document.querySelector('.glare');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cs = field ? getComputedStyle(field) : null;
  const count = field ? field.querySelectorAll('.meteor').length : 0;
  const stars = document.querySelectorAll('.star').length;

  const rows = [
    line('页面', location.pathname + location.search),
    line('系统偏好减少动效', reduce ? '是（流星会变慢、变少，但不会消失）' : '否', true),
    line('找到了 .meteor-field', field ? '是' : '否', !!field),
    line('舞台尺寸', field ? `${field.clientWidth} × ${field.clientHeight}` : '—', field ? field.clientWidth > 0 && field.clientHeight > 0 : false),
    line('舞台 position', cs ? cs.position : '—', cs ? cs.position === 'absolute' : false),
    line('舞台 display', cs ? cs.display : '—', cs ? cs.display !== 'none' : false),
    line('找到了 .glare 照亮层', glare ? '是' : '否', !!glare),
    line('引擎已挂载', state.mounted ? '是' : '否', state.mounted),
    line('未挂载原因', state.reason || '（无）', state.mounted ? undefined : false),
    line('当前流星数', String(count)),
    line('常驻星尘数', String(stars)),
    line('地址栏开关', MODE || '（无）'),
  ];

  console.log('%cSCP 流星诊断', 'font:600 13px system-ui;color:#d8443a');
  console.log(rows.join('\n'));

  if (!field) {
    console.log('%c结论：这一页不是首页（次页 /stage/ 设计上就没有流星），回到 / 再看。', 'color:#e0b020');
  } else if (cs && cs.display === 'none') {
    console.log('%c结论：流星层被 CSS 隐藏了（display:none）。检查是否访问了 ?meteors=off。', 'color:#e0b020');
  } else if (!state.mounted) {
    console.log('%c结论：引擎没挂上，原因见上一行「未挂载原因」。可以试 SCP_METEORS.start() 强制启动。', 'color:#e0b020');
  } else if (count === 0) {
    console.log('%c结论：引擎在跑，但这一刻正好没有流星（间隔 2–5 秒）。\n'
      + '  想立刻看到：输入 SCP_METEORS.burst(3)', 'color:#e0b020');
  } else {
    console.log('%c结论：正常，画面里现在有 ' + count + ' 颗流星在飞。', 'color:#4caf50');
  }

  return { reduce, hasField: !!field, hasGlare: !!glare, mounted: state.mounted, reason: state.reason, count, stars };
}

export function start() {
  const app = document.getElementById('app');
  if (!app) return false;
  if (state.mounted) {
    console.log('已经在跑了。想立刻看到流星：SCP_METEORS.burst(3)');
    return true;
  }
  const r = mountMeteors(app, { force: true });
  console.log(r ? '已强制启动流星（忽略系统的减少动效设置）。' : '启动失败：' + (state.reason || '未知原因'));
  return !!r;
}

export function burst(n = 3) {
  if (!state.mounted) {
    console.log('引擎未运行，先输入 SCP_METEORS.start()');
    return 0;
  }
  return state.burst(n);
}

if (typeof window !== 'undefined') {
  window.SCP_METEORS = { diagnose, start, burst };
}
