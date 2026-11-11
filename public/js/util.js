import { t } from './i18n.js';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export class ApiError extends Error {
  constructor(status, code, data) { super(code); this.status = status; this.code = code; this.data = data; }
}

export async function api(path, { method = 'GET', body, form } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: form || (body ? JSON.stringify(body) : undefined),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  let data = null;
  try { data = await res.json(); } catch { /* пустой ответ */ }
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || 'server_error', data);
  return data;
}

export function errorText(e) {
  if (e && e.code === 'network') return t('err.network');
  return t('err.generic');
}

export const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } },
};

/** Случайный идентификатор браузера участника. Не содержит личных данных. */
export function visitorId() {
  let v = storage.get('dc_visitor');
  if (!v || !/^[A-Za-z0-9-]{16,64}$/.test(v)) {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    v = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    storage.set('dc_visitor', v);
  }
  return v;
}

let toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2600);
}
