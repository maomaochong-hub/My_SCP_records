import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { fail } from './util.js';

const COLLECTIONS = [
  'owner', 'sessions', 'categories', 'items', 'notes', 'settings', 'boards',
  'works', 'work_versions',
  'uv_day_claims', 'uv_month_claims', 'visitors',
  'stats_daily', 'stats_monthly', 'stats_total',
];

function emptyState() {
  const state = {};
  for (const c of COLLECTIONS) state[c] = [];
  return state;
}

/**
 * 文件驱动：整库常驻内存，写操作同步改内存 + 80ms 合并落盘（临时文件 + rename 原子替换）。
 * 单进程 Node 下所有 handler 都是同步改内存，天然无并发写竞态。
 */
class FileStore {
  constructor() {
    this.dir = config.dataDir;
    this.file = path.join(this.dir, 'db.json');
    this.state = emptyState();
    this.timer = null;
    this.writing = null;
    this.dirty = false;
  }

  async init() {
    await fsp.mkdir(this.dir, { recursive: true });
    if (fs.existsSync(this.file)) {
      try {
        const raw = JSON.parse(await fsp.readFile(this.file, 'utf8'));
        for (const c of COLLECTIONS) {
          if (Array.isArray(raw[c])) this.state[c] = raw[c];
        }
      } catch (err) {
        console.error('[store] db.json 解析失败，已备份并重建：', err.message);
        await fsp.rename(this.file, `${this.file}.broken-${Date.now()}`);
      }
    } else {
      await this.flush();
    }
    return this;
  }

  /* ---------- 读 ---------- */
  all(col) {
    this.guard(col);
    return this.state[col];
  }
  get(col, id) {
    this.guard(col);
    return this.state[col].find((d) => d._id === id) || null;
  }
  find(col, pred) {
    this.guard(col);
    return this.state[col].filter(pred);
  }
  count(col, pred) {
    this.guard(col);
    return pred ? this.state[col].filter(pred).length : this.state[col].length;
  }
  single(col) {
    this.guard(col);
    return this.state[col][0] || null;
  }

  /* ---------- 写 ---------- */
  insert(col, doc) {
    this.guard(col);
    if (this.state[col].some((d) => d._id === doc._id)) {
      fail(409, 'E_CONFLICT', '记录已存在');
    }
    this.state[col].push(doc);
    this.touch();
    return doc;
  }
  /** 插入或返回已存在（用于唯一键 claim 判定） */
  insertUnique(col, doc) {
    this.guard(col);
    const existing = this.state[col].find((d) => d._id === doc._id);
    if (existing) return { doc: existing, created: false };
    this.state[col].push(doc);
    this.touch();
    return { doc, created: true };
  }
  update(col, id, patch) {
    this.guard(col);
    const doc = this.state[col].find((d) => d._id === id);
    if (!doc) return null;
    Object.assign(doc, patch);
    this.touch();
    return doc;
  }
  upsert(col, id, patch, defaults = {}) {
    this.guard(col);
    let doc = this.state[col].find((d) => d._id === id);
    if (!doc) {
      doc = { _id: id, ...defaults, ...patch };
      this.state[col].push(doc);
    } else {
      Object.assign(doc, patch);
    }
    this.touch();
    return doc;
  }
  remove(col, id) {
    this.guard(col);
    const idx = this.state[col].findIndex((d) => d._id === id);
    if (idx < 0) return false;
    this.state[col].splice(idx, 1);
    this.touch();
    return true;
  }
  removeWhere(col, pred) {
    this.guard(col);
    const before = this.state[col].length;
    this.state[col] = this.state[col].filter((d) => !pred(d));
    if (this.state[col].length !== before) this.touch();
    return before - this.state[col].length;
  }
  /** 原子自增（单进程内存操作，等价于 $inc） */
  inc(col, id, fields, defaults = {}) {
    this.guard(col);
    let doc = this.state[col].find((d) => d._id === id);
    if (!doc) {
      doc = { _id: id, ...defaults };
      for (const [k, v] of Object.entries(fields)) doc[k] = (doc[k] || 0) + v;
      doc.updatedAt = Date.now();
      this.state[col].push(doc);
    } else {
      for (const [k, v] of Object.entries(fields)) doc[k] = (doc[k] || 0) + v;
      doc.updatedAt = Date.now();
    }
    this.touch();
    return doc;
  }

  guard(col) {
    if (!this.state[col]) throw new Error(`unknown collection: ${col}`);
  }

  touch() {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush().catch((e) => console.error('[store] flush failed', e));
    }, 80);
    if (this.timer.unref) this.timer.unref();
  }

  async flush() {
    if (!this.dirty) return;
    this.dirty = false;
    const tmp = `${this.file}.tmp`;
    const payload = JSON.stringify(this.state);
    this.writing = fsp.writeFile(tmp, payload).then(() => fsp.rename(tmp, this.file));
    await this.writing;
  }

  async close() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.flush();
  }
}

export async function createStore() {
  if (config.storageDriver === 'cloudbase') {
    throw new Error(
      'STORAGE_DRIVER=cloudbase 尚未启用：云端驱动在部署阶段接入（需要 CloudBase 环境 ID 与密钥）。'
    );
  }
  return new FileStore().init();
}
