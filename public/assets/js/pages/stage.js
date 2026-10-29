/* 次页：与首页同骨架，中间换成三个板块入口，无流星 */

import { mountWelcome } from '../modules/welcome.js';

export async function mount() {
  mountWelcome('stage');
}
