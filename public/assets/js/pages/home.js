/* 首页：字标 + 待删除标记 + 中央徽记 + 拉丁句 + 流星 */

import { mountWelcome } from '../modules/welcome.js';

export async function mount() {
  mountWelcome('home');
}
