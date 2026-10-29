/* 访客统计（仅所有者） */

import { $, esc } from '../core/ui.js';
import { api } from '../core/api.js';
import { pheadHTML } from '../ui/page-head.js';

const num = (n) => (n || 0).toLocaleString('zh-CN');

function statCard(kicker, value, unit, sub) {
  return `
    <div class="stat">
      <div class="stat__k"><span>${kicker}</span>${sub.tag ? `<em>${sub.tag}</em>` : ''}</div>
      <div class="stat__v">${num(value)}<span class="stat__u">${unit}</span></div>
      <div class="stat__sub"><span>${sub.left}</span><span>${sub.right}</span></div>
    </div>`;
}

function barsHTML(series) {
  const max = Math.max(1, ...series.map((d) => d.uv));
  const today = series[series.length - 1]?.day;
  const bars = series.map((d) => {
    const h = Math.max(1, Math.round((d.uv / max) * 100));
    const cls = d.day === today ? 'is-today' : d.uv === 0 ? 'is-zero' : '';
    return `<div class="bar ${cls}" title="${d.day} · ${d.uv} 位访客">
      <span>${d.day.slice(5)} · ${d.uv}</span>
      <i style="height:${h}%"></i>
    </div>`;
  }).join('');
  return `
    <div class="bars">${bars}</div>
    <div class="bars__axis"><span>${series[0]?.day.slice(5) || ''}</span><span>近 ${series.length} 天 · 峰值 ${max} UV</span><span>今日</span></div>`;
}

function monthsHTML(months) {
  if (!months.length) {
    return '<div class="stats-empty">// 还没有月度记录<br>当月结束后会自动归档并重置当月计数</div>';
  }
  const max = Math.max(1, ...months.map((m) => m.uv));
  return months.map((m) => `
    <div class="month${m.current ? ' is-current' : ''}${m.synthetic ? ' is-synthetic' : ''}">
      <span class="month__k">${esc(m.month)}${m.current ? '<span class="month__tag">进行中</span>' : ''}</span>
      <span class="month__bar"><i style="width:${Math.round((m.uv / max) * 100)}%"></i></span>
      <span class="month__uv">${num(m.uv)} UV</span>
      <span class="month__pv">${num(m.pv)} PV</span>
    </div>`).join('');
}

export async function mount({ isOwner }) {
  if (!isOwner) return;
  const app = $('#app');

  let ov; let daily; let months;
  try {
    [ov, daily, months] = await Promise.all([
      api.get('/api/stats/overview'),
      api.get('/api/stats/daily?days=30'),
      api.get('/api/stats/months?limit=24'),
    ]);
  } catch (err) {
    app.innerHTML = `<section class="page"><div class="stats-empty">// 统计读取失败<br>${esc(err.message)}</div></section>`;
    return;
  }

  app.innerHTML = `
    <section class="page page--stats">
      ${pheadHTML('04', '访客统计', 'Visitor Statistics',
        `<span>TODAY <b>${esc(ov.today.day)}</b></span><span>MONTH <b>${esc(ov.month.month)}</b></span><span>MODE <b>UV / 唯一访客</b></span>`)}
      <div class="stats-grid">
        ${statCard('今日访客 / Today', ov.today.uv, 'UV', {
          left: `${num(ov.today.pv)} PV`, right: '当日去重',
        })}
        ${statCard('本月访客 / This month', ov.month.uv, 'UV', {
          left: `${num(ov.month.pv)} PV`, right: ov.month.archived ? '已归档' : '进行中',
          tag: ov.month.archived ? '' : 'LIVE',
        })}
        ${statCard('总访客 / All time', ov.total.uv, 'UV', {
          left: `${num(ov.total.pv)} PV`, right: `自 ${(months[months.length - 1]?.month || ov.month.month).replace('-', '.')}`,
        })}
      </div>

      <div class="panel">
        <div class="panel__h"><span>近 30 天访问 / Daily</span><b>${num(daily.reduce((s, d) => s + d.uv, 0))} UV · ${num(daily.reduce((s, d) => s + d.pv, 0))} PV</b></div>
        <div class="panel__b">${barsHTML(daily)}</div>
      </div>

      <div class="panel">
        <div class="panel__h">
          <span>历史月度记录 / Monthly archive</span>
          <b>每月归档后当月计数归零</b>
        </div>
        <div class="months">${monthsHTML(months)}</div>
      </div>

      <p class="reserve"><span>// 统计口径：同一浏览器一天只计 1 次（UV），所有页面浏览都计 PV</span><span>所有者自身访问不计 UV</span></p>
    </section>`;
}
