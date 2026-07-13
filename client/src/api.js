let token = localStorage.getItem('grn_token') || null;

export function setToken(t) {
  token = t;
  if (t) localStorage.setItem('grn_token', t);
  else localStorage.removeItem('grn_token');
}
export function getToken() { return token; }

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

export async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { onUnauthorized(); throw new Error('Session expired'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export function toast(html, kind) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast ' + (kind === 'err' ? 'err' : kind === 'info' ? 'info' : '');
  el.innerHTML = html;
  box.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 320);
  }, 2600);
}
