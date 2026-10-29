/* 一次页面浏览上报：失败静默 */

const VID_KEY = 'scp_vid';

function visitorId() {
  try {
    let vid = localStorage.getItem(VID_KEY);
    if (!vid || vid.length < 8) {
      vid = (crypto.randomUUID && crypto.randomUUID()) ||
        'v-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(VID_KEY, vid);
    }
    return vid;
  } catch {
    return '';
  }
}

export function track(page) {
  try {
    if (navigator.webdriver) return;
    const payload = JSON.stringify({ vid: visitorId(), path: '/' + (page || '') });
    fetch('/api/track', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF': '1' },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch { /* ignore */ }
}
