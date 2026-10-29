/* 接口封装：同源 Cookie + CSRF 头 + 统一错误 */

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const opts = {
    method,
    credentials: 'same-origin',
    headers: { ...headers },
    cache: 'no-store',
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  if (method !== 'GET' && method !== 'HEAD') opts.headers['X-CSRF'] = '1';

  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw new ApiError('E_NETWORK', '网络不可用，请检查连接', 0);
  }
  if (res.status === 204) return null;

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }

  if (!res.ok) {
    const err = json && json.error ? json.error : {};
    throw new ApiError(err.code || 'E_INTERNAL', err.message || `请求失败 (${res.status})`, res.status);
  }
  return json ? json.data : null;
}

export const api = {
  get: (p) => request(p),
  post: (p, body) => request(p, { method: 'POST', body: body || {} }),
  put: (p, body) => request(p, { method: 'PUT', body: body || {} }),
  patch: (p, body) => request(p, { method: 'PATCH', body: body || {} }),
  del: (p) => request(p, { method: 'DELETE' }),
};

export async function getSession() {
  try {
    return await api.get('/api/auth/session');
  } catch {
    return { authenticated: false, owner: null };
  }
}

export async function login(email, password) {
  return api.post('/api/auth/login', { email, password });
}

export async function logout() {
  try { await api.post('/api/auth/logout'); } catch { /* ignore */ }
}
