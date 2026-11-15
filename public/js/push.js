// Push-уведомления в браузере: определение поддержки, подписка по нажатию человека, отписка.
// Системный запрос разрешения показывается только после нажатия «Включить уведомления» — не при открытии сайта.
import { api, u } from './util.js';

export const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

/** 'ios-home' — iPhone/iPad: нужно открыть с экрана «Домой»; 'unsupported'; 'denied'; 'default'; 'granted'. */
export function pushSupport() {
  const has = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (isIOS() && !isStandalone()) return 'ios-home';
  if (!has || !window.isSecureContext) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

const scope = () => u('/');
export async function registration() {
  if (!('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration(scope())) || null;
}
export async function currentSubscription() {
  const reg = await registration();
  return reg && reg.pushManager ? reg.pushManager.getSubscription() : null;
}
function keyBytes(b64) {
  const s = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s); const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
/** → 'on' | 'denied' | 'default' (человек закрыл запрос) */
export async function enablePush(publicKey) {
  const reg = await navigator.serviceWorker.register(u('/sw.js'), { scope: scope() });
  await navigator.serviceWorker.ready;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
  return 'on';
}
export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  try { await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }); } finally { await sub.unsubscribe(); }
}

/**
 * Тихая проверка при открытии сайта (без запроса разрешения): если разрешение уже дано, а подписка сделана
 * на старый ключ сервера или сервер её не знает (ключи или база восстановлены) — переподписываемся сами.
 */
export async function syncPush() {
  try {
    if (pushSupport() !== 'granted') return;
    const reg = await registration(); if (!reg) return;
    let sub = await reg.pushManager.getSubscription(); if (!sub) return;
    const st = await api('/api/push'); if (st.demo) return;
    const want = keyBytes(st.publicKey);
    const have = sub.options && sub.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
    const sameKey = have && have.length === want.length && have.every((b, i) => b === want[i]);
    if (!sameKey) { await sub.unsubscribe(); sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want }); }
    if (!sameKey || !st.subscriptions.some((x) => x.endpoint === sub.endpoint)) await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
  } catch { /* не вышло — человек может включить заново на странице «Уведомления» */ }
}
