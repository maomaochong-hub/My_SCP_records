import { config } from './config.js';
import { fail, hashPassword, randomToken, sha256, verifyPassword } from './util.js';

const DAY = 24 * 60 * 60 * 1000;
export const SESSION_TTL = 7 * DAY;
export const SESSION_ABS_TTL = 30 * DAY;
const TOUCH_AFTER = 12 * 60 * 60 * 1000;

/* 固定 dummy hash：邮箱不存在时也跑一次 scrypt，消除时序差异 */
let dummyHash = null;
function getDummy() {
  if (!dummyHash) dummyHash = hashPassword('dummy-password-for-timing-equalisation');
  return dummyHash;
}

export function getOwner(store) {
  return store.single('owner');
}

export function createSession(store, ownerId, ipHash, uaHash) {
  const token = randomToken(32);
  const now = Date.now();
  store.insert('sessions', {
    _id: sha256(token),
    ownerId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + SESSION_TTL,
    absoluteExpiresAt: now + SESSION_ABS_TTL,
    ipHash,
    uaHash,
    revokedAt: null,
  });
  return token;
}

export function readSession(store, token) {
  if (!token) return null;
  const id = sha256(token);
  const doc = store.get('sessions', id);
  if (!doc || doc.revokedAt) return null;
  const now = Date.now();
  if (doc.expiresAt <= now || doc.absoluteExpiresAt <= now) {
    store.remove('sessions', id);
    return null;
  }
  if (now - (doc.lastSeenAt || 0) > TOUCH_AFTER) {
    store.update('sessions', id, {
      lastSeenAt: now,
      expiresAt: Math.min(now + SESSION_TTL, doc.absoluteExpiresAt),
    });
  }
  return doc;
}

export function destroySession(store, token) {
  if (!token) return;
  store.remove('sessions', sha256(token));
}

export function destroyAllSessions(store, ownerId) {
  store.removeWhere('sessions', (s) => s.ownerId === ownerId);
}

export function purgeExpiredSessions(store) {
  const now = Date.now();
  store.removeWhere('sessions', (s) => s.expiresAt <= now || s.absoluteExpiresAt <= now || !!s.revokedAt);
}

export async function login(store, { email, password, ipHash, uaHash }) {
  const started = Date.now();
  const owner = getOwner(store);
  const okEmail = !!owner && String(email || '').trim().toLowerCase() === owner.email;
  const okPass = verifyPassword(String(password || ''), okEmail ? owner.passwordHash : getDummy());
  const ok = okEmail && okPass;

  // 失败响应补足 250ms，避免用响应时间判断邮箱是否存在
  const elapsed = Date.now() - started;
  if (elapsed < 250) await new Promise((r) => setTimeout(r, 250 - elapsed));

  if (!ok) fail(401, 'E_BAD_CREDENTIALS', '邮箱或密码不正确');

  store.update('owner', owner._id, { lastLoginAt: Date.now() });
  const token = createSession(store, owner._id, ipHash, uaHash);
  return { token, owner: { email: owner.email } };
}

export function changePassword(store, ownerId, current, next) {
  const owner = getOwner(store);
  if (!owner || owner._id !== ownerId) fail(401, 'E_AUTH_REQUIRED', '请先登录');
  if (!verifyPassword(String(current || ''), owner.passwordHash)) {
    fail(400, 'E_VALIDATION', '当前密码不正确', { field: 'currentPassword' });
  }
  if (String(next || '').length < 10) {
    fail(400, 'E_VALIDATION', '新密码至少 10 位', { field: 'newPassword' });
  }
  store.update('owner', ownerId, {
    passwordHash: hashPassword(String(next)),
    passwordChangedAt: Date.now(),
  });
  destroyAllSessions(store, ownerId);
}

export function sessionCookie(token) {
  return {
    name: config.cookieName,
    value: token,
    opts: {
      path: '/',
      maxAge: Math.floor(SESSION_TTL / 1000),
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: 'Lax',
    },
  };
}

export function clearedCookie() {
  return {
    name: config.cookieName,
    value: '',
    opts: { path: '/', maxAge: 0, httpOnly: true, secure: config.cookieSecure, sameSite: 'Lax' },
  };
}
