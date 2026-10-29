/* 流星：斜落的星辰
   - 小流星：缓斜、慢速、星核微闪
   - 大流星：更快更陡，自带光晕，经过文字时按距离提亮
   - 大流星沿路撞到小流星，小流星当场消失（留一瞬闪光） */

import { reduceMotion } from '../core/ui.js';

const BIG_RATE = 0.16;      // 每次生成时成为大流星的概率
const BIG_COOLDOWN = 20000; // 两颗大流星之间的最小间隔
const EAT_RADIUS = 52;      // 吞噬判定半径
const MAX_SMALL = 3;
const LIGHT_R = 380;        // 照亮半径（像素）

export function mountMeteors(root) {
  if (reduceMotion()) return null;
  const field = root.querySelector('.meteor-field');
  const glare = root.querySelector('.glare');
  if (!field || !glare) return null;

  seedStars(root.querySelector('.starfield'));

  const active = [];
  let raf = null;
  let timer = null;
  let stopped = false;
  let lastBig = 0;
  let glareEnv = 0;
  let textBox = null;

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  function schedule() {
    clearTimeout(timer);
    if (stopped) return;
    timer = setTimeout(spawn, rand(2600, 6200));
  }

  function spawn() {
    if (stopped || document.hidden) return schedule();

    const w = field.clientWidth;
    const h = field.clientHeight;
    if (!w || !h) return schedule();

    const now = performance.now();
    const bigs = active.reduce((n, m) => n + (m.big ? 1 : 0), 0);
    const smalls = active.length - bigs;

    if (Math.random() < BIG_RATE && bigs === 0 && now - lastBig > BIG_COOLDOWN) {
      create(true, w, h, now);
      lastBig = now;
    } else if (smalls < MAX_SMALL) {
      create(false, w, h, now);
    }

    schedule();
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function create(big, w, h, now) {
    // 方向：默认左上←右下（与水平线 10°–34° ），少量反向
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

    const len = big ? rand(215, 320) : rand(95, 190);
    const hh = big ? 13 : 9;
    const speed = big ? rand(1150, 1650) : rand(520, 820);
    const y0 = -14;

    // 起点：贴着视口上缘之外
    let x0;
    const aim = big && Math.random() < 0.62 ? textCenter(w, h) : null;
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
      const base = clamp01(env) * (m.big ? 1 : 0.78);
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

  timer = setTimeout(spawn, 2200);
  return { stop() { stopped = true; clearTimeout(timer); reset(); } };
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
