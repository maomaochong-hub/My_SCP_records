import { hmac, dayKey, monthKey, prevMonthKey } from './util.js';
import { config } from './config.js';

const BOT_RE = /bot|crawl|spider|slurp|headless|curl|wget|python-requests|axios|scrapy|phantom/i;

export function isBot(ua) {
  return !ua || BOT_RE.test(String(ua));
}

/** 把客户端 vid 变成不可逆的去重键 */
export function visitorKey(vid, ip, ua) {
  const raw = vid && String(vid).length >= 8 ? `v1:${vid}` : `ipua:${ip}|${ua}`;
  return hmac(raw).slice(0, 22);
}

function totalDoc(store) {
  let t = store.get('stats_total', 'global');
  if (!t) {
    t = store.insert('stats_total', {
      _id: 'global', uv: 0, pv: 0, archivedThrough: prevMonthKey(monthKey()), updatedAt: Date.now(),
    });
  }
  return t;
}

/**
 * 惰性归档：把所有早于当前月的月度文档标记为已归档（幂等），
 * 并补齐缺失月份的 0 记录。月度计数天然按 key 归零，无需事务。
 */
export function ensureMonthArchived(store, ts = Date.now()) {
  const current = monthKey(ts);
  let changed = false;
  for (const m of store.all('stats_monthly')) {
    if (m.month < current && !m.archived) {
      store.update('stats_monthly', m._id, { archived: true, archivedAt: ts });
      changed = true;
    }
  }
  const t = totalDoc(store);
  const through = prevMonthKey(current);
  if (t.archivedThrough !== through) {
    store.update('stats_total', 'global', { archivedThrough: through, updatedAt: ts });
  }
  return changed;
}

export function track(store, { vid, ip, ua, isOwner, path }) {
  const now = Date.now();
  const day = dayKey(now);
  const month = monthKey(now);
  ensureMonthArchived(store, now);

  const excludeOwner = isOwner && config.excludeOwnerFromStats;
  const key = visitorKey(vid, ip, ua);

  if (!excludeOwner) {
    const existing = store.get('visitors', key);
    if (existing) {
      store.update('visitors', key, { lastSeenAt: now, visits: (existing.visits || 1) + 1 });
    } else {
      store.insert('visitors', {
        _id: key,
        firstSeenAt: now,
        lastSeenAt: now,
        ipHash: hmac(`ip:${ip}`).slice(0, 16),
        uaHash: hmac(`ua:${ua}`).slice(0, 16),
        visits: 1,
      });
    }
  }

  const dayClaim = excludeOwner
    ? { created: false }
    : store.insertUnique('uv_day_claims', {
        _id: `d:${day}:${key}`, day, month, vid: key, at: now,
      });
  const monthClaim = excludeOwner
    ? { created: false }
    : store.insertUnique('uv_month_claims', {
        _id: `m:${month}:${key}`, month, vid: key, at: now,
      });

  // PV 始终计数（含所有者，便于观察真实访问量）
  const dayDoc = store.inc('stats_daily', day, { pv: 1, uv: dayClaim.created ? 1 : 0 }, {
    day, uv: 0, pv: 0, updatedAt: now,
  });
  store.inc('stats_monthly', month, { pv: 1, uv: monthClaim.created ? 1 : 0 }, {
    month, uv: 0, pv: 0, archived: false, archivedAt: null, updatedAt: now,
  });
  store.inc('stats_total', 'global', { pv: 1, uv: dayClaim.created ? 0 : 0 }, {
    uv: 0, pv: 0, archivedThrough: prevMonthKey(month), updatedAt: now,
  });
  if (dayClaim.created) {
    const t = store.get('stats_total', 'global');
    store.update('stats_total', 'global', { uv: (t.uv || 0) + 1 });
  }

  return { day, uv: dayDoc.uv, counted: dayClaim.created };
}

export function overview(store) {
  const now = Date.now();
  ensureMonthArchived(store, now);
  const day = dayKey(now);
  const month = monthKey(now);
  const d = store.get('stats_daily', day) || { uv: 0, pv: 0 };
  const m = store.get('stats_monthly', month) || { uv: 0, pv: 0, archived: false };
  const t = totalDoc(store);
  return {
    today: { day, uv: d.uv || 0, pv: d.pv || 0 },
    month: { month, uv: m.uv || 0, pv: m.pv || 0, archived: !!m.archived },
    total: { uv: t.uv || 0, pv: t.pv || 0 },
    updatedAt: now,
  };
}

export function dailySeries(store, { days = 30, month = '' } = {}) {
  ensureMonthArchived(store);
  const out = [];
  if (month) {
    const [y, mo] = month.split('-').map(Number);
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    for (let i = 1; i <= last; i++) {
      const key = `${month}-${String(i).padStart(2, '0')}`;
      const d = store.get('stats_daily', key);
      out.push({ day: key, uv: d?.uv || 0, pv: d?.pv || 0 });
    }
    return out;
  }
  const count = Math.min(Math.max(days, 1), 180);
  const now = Date.now();
  for (let i = count - 1; i >= 0; i--) {
    const key = dayKey(now - i * 86400000);
    const d = store.get('stats_daily', key);
    out.push({ day: key, uv: d?.uv || 0, pv: d?.pv || 0 });
  }
  return out;
}

export function monthSeries(store, { limit = 24 } = {}) {
  ensureMonthArchived(store);
  const current = monthKey();
  const map = new Map();
  for (const m of store.all('stats_monthly')) map.set(m.month, m);

  // 从最早一条记录补到上个月，缺失月份填 0，列表连续
  const keys = [...map.keys()].sort();
  const first = keys[0];
  if (first) {
    let cursor = first;
    while (cursor < current) {
      if (!map.has(cursor)) {
        map.set(cursor, { month: cursor, uv: 0, pv: 0, archived: true, archivedAt: null, synthetic: true });
      }
      cursor = nextMonth(cursor);
    }
  }

  return [...map.values()]
    .filter((m) => m.archived || m.month === current)
    .sort((a, b) => (a.month < b.month ? 1 : -1))
    .slice(0, Math.min(limit, 60))
    .map((m) => ({
      month: m.month,
      uv: m.uv || 0,
      pv: m.pv || 0,
      archived: !!m.archived,
      archivedAt: m.archivedAt || null,
      synthetic: !!m.synthetic,
      current: m.month === current,
    }));
}

function nextMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

export function archiveNow(store, month) {
  const target = month || prevMonthKey(monthKey());
  const m = store.get('stats_monthly', target);
  if (!m) return { month: target, archived: false, reason: 'no-data' };
  store.update('stats_monthly', target, { archived: true, archivedAt: Date.now() });
  return { month: target, archived: true, uv: m.uv || 0, pv: m.pv || 0 };
}

/** 按 claim 表重算，用于校准 */
export function reconcile(store) {
  const dayCounts = new Map();
  for (const c of store.all('uv_day_claims')) dayCounts.set(c.day, (dayCounts.get(c.day) || 0) + 1);
  const monthCounts = new Map();
  for (const c of store.all('uv_month_claims')) monthCounts.set(c.month, (monthCounts.get(c.month) || 0) + 1);

  for (const d of store.all('stats_daily')) {
    const uv = dayCounts.get(d._id) || 0;
    if (d.uv !== uv) store.update('stats_daily', d._id, { uv });
  }
  for (const m of store.all('stats_monthly')) {
    const uv = monthCounts.get(m._id) || 0;
    if (m.uv !== uv) store.update('stats_monthly', m._id, { uv });
  }
  const totalUv = store.count('visitors');
  store.update('stats_total', 'global', { uv: totalUv, updatedAt: Date.now() });
  return { days: dayCounts.size, months: monthCounts.size, totalUv };
}
