/* 写入队列：同资源合并防抖，失败重试，状态灯 */

import { api } from './api.js';
import { clockStr } from './ui.js';

const jobs = new Map();
let pendingCount = 0;

function setLight(state, text) {
  const el = document.getElementById('saveState');
  const txt = document.getElementById('saveText');
  if (!el || !txt) return;
  el.dataset.state = state;
  txt.textContent = text;
}

function refreshLight() {
  const el = document.getElementById('saveState');
  if (!el) return;
  if (document.body.classList.contains('is-owner')) {
    if (pendingCount > 0) setLight('saving', '保存中');
    else if (el.dataset.state !== 'err') setLight('ok', '已保存 ' + clockStr());
  }
}

export function setIdle() {
  if (document.body.classList.contains('is-owner')) setLight('ok', '已保存 ' + clockStr());
  else setLight('readonly', '只读');
}

/**
 * 排队一次写入。同一 key 的多次调用只保留最后一次载荷。
 */
export function queue(key, { path, method = 'PATCH', payload, delay = 350 }) {
  let job = jobs.get(key);
  if (!job) {
    job = { timer: null, inflight: false, pending: null };
    jobs.set(key, job);
  }
  job.pending = { path, method, payload };
  clearTimeout(job.timer);
  job.timer = setTimeout(() => flush(key), delay);
  if (!job.inflight) {
    pendingCount++;
    setLight('saving', '保存中');
  }
}

async function flush(key) {
  const job = jobs.get(key);
  if (!job || !job.pending) return;
  if (job.inflight) {
    job.timer = setTimeout(() => flush(key), 220);
    return;
  }
  const { path, method, payload } = job.pending;
  job.pending = null;
  job.inflight = true;
  job.timer = null;
  try {
    const data = await api[method === 'PATCH' ? 'patch' : method === 'PUT' ? 'put' : 'post'](path, payload);
    job.inflight = false;
    pendingCount = Math.max(0, pendingCount - 1);
    if (!job.pending) refreshLight();
    return data;
  } catch (err) {
    job.inflight = false;
    job.pending = { path, method, payload };
    setLight('err', err.status === 401 ? '需要重新登录' : '保存失败，重试中');
    job.timer = setTimeout(() => flush(key), 2600);
    return null;
  }
}

/** 立即冲掉所有挂起写入（离开页面前） */
export function flushAll() {
  for (const key of jobs.keys()) {
    const job = jobs.get(key);
    if (job.timer) {
      clearTimeout(job.timer);
      flush(key);
    }
  }
}

window.addEventListener('online', () => {
  for (const [key, job] of jobs) {
    if (job.pending) flush(key);
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushAll();
});
