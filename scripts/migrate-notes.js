/**
 * 一次性迁移：把旧版的浮动便签搬进一块「灵感板」。
 *
 * 旧版的便签（notes 集合）是固定在灵感页上的浮动卡片；现在灵感页展示的是
 * 压缩条目，便签成了画板里的一种节点。这个脚本把现存便签原样摊成一块板，
 * 板本身会作为一张卡出现在灵感页上，双击就能看到全部便签。
 *
 *   node scripts/migrate-notes.js          执行迁移（便签不会删除）
 *   node scripts/migrate-notes.js --check  只报告，不改数据
 *
 * 幂等：settings.notesMigrated 打过标记，或已有同名板，就不再执行。
 */
import { createStore } from '../server/storage.js';
import { newId } from '../server/util.js';

const checkOnly = process.argv.includes('--check');
const store = await createStore();

const notes = store.all('notes');
const site = store.get('settings', 'site') || {};

if (!notes.length) {
  console.log('没有需要迁移的便签。');
  await store.close();
  process.exit(0);
}

if (site.notesMigrated) {
  console.log(`已迁移过（settings.notesMigrated=${site.notesMigrated}），跳过。`);
  await store.close();
  process.exit(0);
}

const exists = store.all('boards').some((b) => b.title === '旧便签');
if (exists) {
  console.log('已存在名为「旧便签」的板，跳过（如需重建请先删掉那块板）。');
  await store.close();
  process.exit(0);
}

console.log(`找到 ${notes.length} 条便签：`);
for (const n of notes) console.log(`  · ${n.title || '(无标题)'}`);

if (checkOnly) {
  console.log('（--check：不改数据）');
  await store.close();
  process.exit(0);
}

const sorted = notes.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
const now = Date.now();

// 便签原本按固定坐标摆放，这里原样保留相对位置
const nodes = sorted.map((n, i) => {
  const title = (n.title || '').trim();
  const body = (n.body || '').trim();
  const text = title && body ? `${title}\n\n${body}` : (title || body || '（空便签）');
  return {
    id: n._id || newId('nd'),
    type: 'note',
    text,
    x: Number.isFinite(n.x) ? n.x : 48 + (i % 3) * 300,
    y: Number.isFinite(n.y) ? n.y : 44 + Math.floor(i / 3) * 200,
    w: Number.isFinite(n.w) ? Math.max(180, n.w) : 260,
    h: 150,
    z: i + 1,
    size: 13,
    color: '#e6e3dc',
  };
});

const board = store.insert('boards', {
  _id: newId('bd'),
  kind: 'idea',
  title: '旧便签',
  note: `从旧版浮动便签迁移而来，共 ${nodes.length} 条。原件仍保留在 notes 集合里。`,
  cats: [],
  x: 60, y: 60, w: 320, h: 200, color: '#8d9188',
  nodes,
  edges: [],
  createdAt: now,
  updatedAt: now,
});

if (site && site._id) {
  store.update('settings', 'site', {
    notesMigrated: now,
    contentVersion: (site.contentVersion || 1) + 1,
    updatedAt: now,
  });
} else {
  store.insert('settings', {
    _id: 'site', other: { remark: '' }, contentVersion: 2, schemaVersion: 2,
    notesMigrated: now, updatedAt: now,
  });
}

console.log(`已生成灵感板「${board.title}」（${nodes.length} 个便签节点）。`);
console.log('便签原始数据未删除，导出 JSON 时仍然完整。');
await store.close();
