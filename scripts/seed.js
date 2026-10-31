/**
 * 初始化：创建所有者账号 + 首次示例内容。
 *   node scripts/seed.js                 使用 .env 里的 OWNER_EMAIL / OWNER_PASSWORD
 *   node scripts/seed.js --reset-password 只重置口令（保留内容）
 */
import { config } from '../server/config.js';
import { createStore } from '../server/storage.js';
import { hashPassword } from '../server/util.js';

const store = await createStore();
const resetOnly = process.argv.includes('--reset-password');

const email = (process.env.OWNER_EMAIL || config.ownerEmail || '').trim().toLowerCase();
const password = process.env.OWNER_PASSWORD || '';

if (!email) {
  console.error('缺少 OWNER_EMAIL，请在 .env 里设置后重试。');
  process.exit(1);
}

let owner = store.single('owner');

if (owner && !resetOnly) {
  console.log(`所有者已存在：${owner.email}（如需重置口令：node scripts/seed.js --reset-password）`);
} else {
  if (password.length < 10) {
    console.error('OWNER_PASSWORD 至少 10 位，请在 .env 里设置后重试。');
    process.exit(1);
  }
  const passwordHash = hashPassword(password);
  if (owner) {
    store.update('owner', owner._id, { email, passwordHash, passwordChangedAt: Date.now() });
    store.removeWhere('sessions', () => true);
    console.log(`口令已重置：${email}（已吊销全部会话）`);
  } else {
    store.insert('owner', {
      _id: 'owner',
      email,
      passwordHash,
      pepperVersion: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastLoginAt: null,
    });
    console.log(`所有者已创建：${email}`);
  }
}

if (!resetOnly && store.count('items') === 0 && store.count('categories') === 0) {
  const now = Date.now();
  const c1 = store.insert('categories', { _id: 'cat_classic', name: '经典条目', sort: 10, createdAt: now, updatedAt: now });
  const c2 = store.insert('categories', { _id: 'cat_sites', name: '站点与工具', sort: 20, createdAt: now, updatedAt: now });
  // 归档分类：固定沉底、不可删除，存放被修改前的旧条目
  store.insert('categories', {
    _id: 'cat_6183a', name: 'SCP-6183-A', sort: 1e9, locked: true, createdAt: now, updatedAt: now,
  });

  const seedItem = (id, catId, code, title, url, note, ts) => store.insert('items', {
    _id: id, catId, catIds: [catId], displayCatId: catId, code, title, url, note, image: '',
    snapshotOf: null, createdAt: ts, updatedAt: ts,
  });

  seedItem('it_scp_wiki', c2._id, '—', 'SCP 基金会中文维基',
    'https://scp-wiki-cn.wikidot.com/', '主站入口，所有条目的源头。', now - 3000);
  seedItem('it_scp_6183', c1._id, 'SCP-6183', '本终端的视觉参考',
    'https://scp-wiki-cn.wikidot.com/scp-6183', '配色、字体与版式均由此页面取意。', now - 2000);
  seedItem('it_scp_173', c1._id, 'SCP-173', '雕像',
    'https://scp-wiki-cn.wikidot.com/scp-173', '第一条被写下的项目，值得反复重读。', now - 1000);

  store.insert('notes', {
    _id: 'nt_welcome', title: '欢迎 · 在这里记录灵感',
    body: '直接点击这段文字就可以编辑。\n\n拖动上方的标题栏可以把这张便签移到任意位置。\n\n所有修改都会自动写入服务器，换设备打开也是同一份内容。',
    x: 46, y: 44, w: 326, z: 3, accent: 'amber', createdAt: now, updatedAt: now,
  });
  store.insert('notes', {
    _id: 'nt_clue', title: '待展开的线索',
    body: '· 一个从不重复的收容编号\n· 一段被删除的访谈记录\n· 档案员自己的名字',
    x: 412, y: 108, w: 288, z: 2, accent: 'bone', createdAt: now - 60000, updatedAt: now - 60000,
  });

  if (!store.get('settings', 'site')) {
    store.insert('settings', {
      _id: 'site', other: { remark: '' }, contentVersion: 1, schemaVersion: 2, updatedAt: now,
    });
  }
  console.log('已写入示例分类 / 条目 / 便签（可登录后删除）。');
}

await store.close();
console.log('完成。现在可以 npm start');
