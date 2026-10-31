/* 子页面标题区 */

/**
 * 「返回索引」只回上一页（浏览器后退），回首页走左上角的站标。
 * extra 会插在标题左侧，比如项目收集页的「随机页面」。
 */
export function pheadHTML(num, title, en, meta = '', extra = '') {
  return `
    <header class="phead">
      <button class="phead__back" type="button" data-back>← <span>返回索引</span></button>
      <div class="phead__row">
        <span class="phead__num">${num}</span>
        ${extra}
        <h1 class="phead__title">${title}</h1>
        <span class="phead__en">${en}</span>
      </div>
      ${meta ? `<div class="phead__meta" id="pheadMeta">${meta}</div>` : ''}
    </header>`;
}
