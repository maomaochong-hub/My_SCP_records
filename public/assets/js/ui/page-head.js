/* 子页面标题区 */

export function pheadHTML(num, title, en, meta = '') {
  return `
    <header class="phead">
      <a class="phead__back" href="/" data-veil="RETURNING / INDEX">← <span>返回索引</span></a>
      <div class="phead__row">
        <span class="phead__num">${num}</span>
        <h1 class="phead__title">${title}</h1>
        <span class="phead__en">${en}</span>
      </div>
      ${meta ? `<div class="phead__meta" id="pheadMeta">${meta}</div>` : ''}
    </header>`;
}
