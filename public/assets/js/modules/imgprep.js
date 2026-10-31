/**
 * 条目配图：全部在浏览器本地完成，不上传原图。
 *
 *   选图 → 缩到 480 以内 → 从四边泛洪「吃掉」背景色 → 边缘羽化
 *        → 裁掉透明边 → 摆进正方形画布 → PNG dataURL
 *
 * 之所以从四边泛洪而不是全图统一阈值：主体内部的白色/浅色区域（比如雕塑的白眼球）
 * 不会被误删，因为它们不与画布边缘连通。遇到抠不动的图（背景是渐变、照片实景）
 * 也不会毁图——删除比例异常时会自动回退成「仅淡化」。
 */

const MAX_SIDE = 480;
const MAX_INPUT = 12 * 1024 * 1024;

function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file).catch(() => loadViaImg(file));
  }
  return loadViaImg(file);
}

function loadViaImg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片无法解码')); };
    img.src = url;
  });
}

/** 边界主色 + 自适应容差 */
function borderProfile(data, w, h) {
  const buckets = new Map();
  const push = (i) => {
    const o = i * 4;
    if (data[o + 3] < 8) return;
    const key = ((data[o] >> 4) << 8) | ((data[o + 1] >> 4) << 4) | (data[o + 2] >> 4);
    buckets.set(key, (buckets.get(key) || 0) + 1);
  };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }

  let bestKey = 0;
  let bestN = -1;
  for (const [k, n] of buckets) if (n > bestN) { bestN = n; bestKey = k; }
  if (bestN <= 0) return null;

  let r = 0; let g = 0; let b = 0; let n = 0;
  const border = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
  for (const i of border) {
    const o = i * 4;
    if (data[o + 3] < 8) continue;
    const key = ((data[o] >> 4) << 8) | ((data[o + 1] >> 4) << 4) | (data[o + 2] >> 4);
    if (key !== bestKey) continue;
    r += data[o]; g += data[o + 1]; b += data[o + 2]; n++;
  }
  if (!n) return null;
  r /= n; g /= n; b /= n;

  // 用边界像素到主色的距离分布推容差：取 88 分位，避免被少量异物拉偏
  const dists = [];
  for (const i of border) {
    const o = i * 4;
    if (data[o + 3] < 8) continue;
    const dr = data[o] - r; const dg = data[o + 1] - g; const db = data[o + 2] - b;
    dists.push(Math.sqrt(dr * dr + dg * dg + db * db));
  }
  dists.sort((a, z) => a - z);
  const p88 = dists[Math.min(dists.length - 1, Math.floor(dists.length * 0.88))] || 24;
  const tol = Math.min(72, Math.max(16, p88 * 1.25));
  return { r, g, b, tol };
}

/** 返回被抠掉的像素占比；0 表示按不动 */
function knockOut(data, w, h) {
  const profile = borderProfile(data, w, h);
  if (!profile) return 0;
  const { r, g, b } = profile;
  const tol2 = profile.tol * profile.tol;
  const N = w * h;
  const dist2 = (i) => {
    const o = i * 4;
    const dr = data[o] - r; const dg = data[o + 1] - g; const db = data[o + 2] - b;
    return dr * dr + dg * dg + db * db;
  };

  const origin = new Uint8ClampedArray(N);
  for (let i = 0; i < N; i++) origin[i] = data[i * 4 + 3];

  const seen = new Uint8Array(N);
  const queue = new Int32Array(N);
  let head = 0;
  let tail = 0;
  const seed = (i) => {
    if (seen[i]) return;
    if (data[i * 4 + 3] < 8 || dist2(i) <= tol2) { seen[i] = 1; queue[tail++] = i; }
  };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }

  let cleared = 0;
  while (head < tail) {
    const i = queue[head++];
    data[i * 4 + 3] = 0;
    cleared++;
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) { const j = i - 1; if (!seen[j] && dist2(j) <= tol2) { seen[j] = 1; queue[tail++] = j; } }
    if (x < w - 1) { const j = i + 1; if (!seen[j] && dist2(j) <= tol2) { seen[j] = 1; queue[tail++] = j; } }
    if (y > 0) { const j = i - w; if (!seen[j] && dist2(j) <= tol2) { seen[j] = 1; queue[tail++] = j; } }
    if (y < h - 1) { const j = i + w; if (!seen[j] && dist2(j) <= tol2) { seen[j] = 1; queue[tail++] = j; } }
  }

  const ratio = cleared / N;
  // 几乎全被吃掉 = 判断失误（纯色图 / 背景即主体），整体回退
  if (ratio > 0.96) {
    for (let i = 0; i < N; i++) data[i * 4 + 3] = origin[i];
    return 0;
  }

  // 羽化：紧贴被抠区域的那一圈按颜色距离给半透明，边缘不生硬
  const soft = profile.tol * 0.85;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (data[i * 4 + 3] === 0) continue;
      const near =
        (x > 0 && data[(i - 1) * 4 + 3] === 0) ||
        (x < w - 1 && data[(i + 1) * 4 + 3] === 0) ||
        (y > 0 && data[(i - w) * 4 + 3] === 0) ||
        (y < h - 1 && data[(i + w) * 4 + 3] === 0);
      if (!near) continue;
      const d = Math.sqrt(dist2(i)) - profile.tol;
      const f = Math.max(0, Math.min(1, d / soft));
      if (f < 1) data[i * 4 + 3] = Math.round(data[i * 4 + 3] * f);
    }
  }
  return ratio;
}

/** 裁掉全透明边，再居中摆进正方形画布 —— 所有条目配图视觉大小才一致 */
function normalizeToSquare(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h);
  const { data } = img;
  let x0 = w; let y0 = h; let x1 = -1; let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] < 10) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < x0 || y1 < y0) return null;

  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const side = Math.round(Math.max(bw, bh) * 1.04);
  const out = document.createElement('canvas');
  out.width = side;
  out.height = side;
  const octx = out.getContext('2d');
  octx.imageSmoothingQuality = 'high';
  const src = document.createElement('canvas');
  src.width = bw;
  src.height = bh;
  src.getContext('2d').putImageData(img, -x0, -y0);
  octx.drawImage(src, Math.round((side - bw) / 2), Math.round((side - bh) / 2));
  return out;
}

/**
 * @returns {Promise<{dataUrl:string, removed:number, side:number}>}
 */
export async function prepareItemImage(file) {
  if (!file) throw new Error('没有选择文件');
  if (!/^image\//.test(file.type || '')) throw new Error('请选择图片文件');
  if (file.size > MAX_INPUT) throw new Error('图片过大（上限 12MB）');

  const bitmap = await loadBitmap(file);
  const bw = bitmap.width || bitmap.naturalWidth;
  const bh = bitmap.height || bitmap.naturalHeight;
  if (!bw || !bh) throw new Error('图片尺寸异常');

  const scale = Math.min(1, MAX_SIDE / Math.max(bw, bh));
  const w = Math.max(1, Math.round(bw * scale));
  const h = Math.max(1, Math.round(bh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  if (bitmap.close) bitmap.close();

  const img = ctx.getImageData(0, 0, w, h);
  const removed = knockOut(img.data, w, h);
  ctx.putImageData(img, 0, 0);

  const square = normalizeToSquare(ctx, w, h) || canvas;
  return {
    dataUrl: square.toDataURL('image/png'),
    removed,
    side: square.width,
  };
}
