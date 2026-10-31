/**
 * 条目配图：前端在浏览器里完成「去背景 + 淡化」，这里只负责落盘与回收。
 * - 只接受 PNG / JPEG / WebP 的 dataURL，且核对文件头，防止伪造扩展名
 * - 文件名随机生成、不可猜测，也不回显原始文件名
 * - 删除条目时顺带回收不再被引用的图片，避免数据目录长草
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { fail } from './util.js';

const MAX_BYTES = 1.6 * 1024 * 1024;
const DATA_URL = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/;
const MEDIA_PATH = /^\/media\/([A-Za-z0-9_-]{4,64}\.(?:png|jpe?g|webp))$/i;

export function isMediaUrl(v) {
  return typeof v === 'string' && MEDIA_PATH.test(v);
}

function sniff(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

export async function saveImageDataUrl(dataUrl) {
  const m = DATA_URL.exec(String(dataUrl || ''));
  if (!m) fail(400, 'E_VALIDATION', '图片格式不支持，请使用 PNG / JPEG / WebP');

  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) fail(400, 'E_VALIDATION', '图片内容为空');
  if (buf.length > MAX_BYTES) fail(413, 'E_TOO_LARGE', '图片过大，请压缩到 1.5MB 以内');

  const kind = sniff(buf);
  if (!kind) fail(400, 'E_VALIDATION', '图片内容与类型不符');

  await fsp.mkdir(config.uploadsDir, { recursive: true });
  const name = `img_${crypto.randomBytes(12).toString('hex')}.${kind === 'jpg' ? 'jpg' : kind}`;
  await fsp.writeFile(path.join(config.uploadsDir, name), buf);
  return { url: `/media/${name}`, bytes: buf.length };
}

/** 图片不再被任何条目引用时删除文件；共享同一张图的多条记录不会被误删 */
export async function removeImageIfUnused(store, url) {
  if (!isMediaUrl(url)) return false;
  if (store.all('items').some((it) => it.image === url)) return false;
  const name = MEDIA_PATH.exec(url)[1];
  try {
    await fsp.unlink(path.join(config.uploadsDir, name));
    return true;
  } catch {
    return false;
  }
}
