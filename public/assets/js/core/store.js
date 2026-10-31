/* 内容快照：一次拉取全站数据，写操作后本地增量更新 */

import { api } from './api.js';

export const store = {
  data: { version: 0, categories: [], items: [], notes: [], other: { remark: '' } },
  loaded: false,
  error: null,

  async load() {
    try {
      const data = await api.get('/api/content');
      this.data = data;
      this.loaded = true;
      this.error = null;
      return data;
    } catch (err) {
      this.loaded = false;
      this.error = err;
      if (!this.data.items.length) {
        this.data = { version: 0, categories: [], items: [], notes: [], other: { remark: '' } };
      }
      return this.data;
    }
  },

  get categories() { return this.data.categories; },
  get items() { return this.data.items; },
  get notes() { return this.data.notes; },
  get other() { return this.data.other || { remark: '' }; },

  categoryName(id) {
    const c = this.data.categories.find((x) => x.id === id);
    return c ? c.name : '未分类';
  },

  addCategory(cat) { this.data.categories.push(cat); },
  removeCategory(id) {
    this.data.categories = this.data.categories.filter((c) => c.id !== id);
    this.data.items.forEach((i) => {
      if (Array.isArray(i.catIds)) i.catIds = i.catIds.filter((x) => x !== id);
      if (i.catId === id) i.catId = (i.catIds && i.catIds[0]) || null;
      if (i.displayCatId === id) i.displayCatId = (i.catIds && i.catIds[0]) || null;
    });
  },
  addItem(item) { this.data.items.unshift(item); },
  replaceItem(item) {
    const i = this.data.items.findIndex((x) => x.id === item.id);
    if (i >= 0) this.data.items[i] = item; else this.data.items.unshift(item);
  },
  removeItem(id) { this.data.items = this.data.items.filter((x) => x.id !== id); },
  addNote(note) { this.data.notes.push(note); },
  removeNote(id) { this.data.notes = this.data.notes.filter((n) => n.id !== id); },
  note(id) { return this.data.notes.find((n) => n.id === id); },
  topZ() { return this.data.notes.reduce((m, n) => Math.max(m, n.z || 1), 1); },
};
