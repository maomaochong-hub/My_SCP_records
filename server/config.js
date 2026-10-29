import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 极简 .env 读取：不覆盖已存在的 process.env */
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnvFile(path.join(ROOT, '.env'));

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  root: ROOT,
  publicDir: path.join(ROOT, 'public'),
  dataDir: path.resolve(ROOT, process.env.DATA_DIR || 'data'),
  port: Number(process.env.PORT || 8787),
  isProd,
  storageDriver: process.env.STORAGE_DRIVER || 'file',
  sessionSecret: process.env.SESSION_SECRET || 'dev-session-secret-please-change',
  authPepper: process.env.AUTH_PEPPER || 'dev-pepper-please-change',
  statsSecret: process.env.STATS_SECRET || 'dev-stats-secret-please-change',
  publicOrigin: (process.env.PUBLIC_ORIGIN || '').replace(/\/$/, ''),
  cookieName: process.env.COOKIE_NAME || (isProd ? '__Host-scp_sid' : 'scp_sid'),
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProd,
  trustProxy: process.env.TRUST_PROXY === 'true',
  siteTz: process.env.SITE_TZ || 'Asia/Shanghai',
  excludeOwnerFromStats: process.env.STATS_EXCLUDE_OWNER !== 'false',
  maxVersionsPerWork: Number(process.env.MAX_VERSIONS_PER_WORK || 50),
  ownerEmail: (process.env.OWNER_EMAIL || '').trim().toLowerCase(),
  version: '2.0.0',
};

export function assertConfig() {
  const problems = [];
  if (isProd) {
    if (/please-change|dev-/.test(config.sessionSecret)) problems.push('SESSION_SECRET 仍是默认值');
    if (/please-change|dev-/.test(config.authPepper)) problems.push('AUTH_PEPPER 仍是默认值');
    if (/please-change|dev-/.test(config.statsSecret)) problems.push('STATS_SECRET 仍是默认值');
    if (!config.publicOrigin) problems.push('PUBLIC_ORIGIN 未配置（Origin 校验会失效）');
    if (!config.cookieSecure) problems.push('生产环境 COOKIE_SECURE 必须为 true');
  }
  if (problems.length) {
    console.warn('\n[config] 生产配置不完整：\n  - ' + problems.join('\n  - ') + '\n');
  }
}
