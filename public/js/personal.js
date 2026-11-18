// Личное участника: заметки к картам, «Избранное», свои подборки (18.11.2026).
// Гость — в этом браузере (localStorage, ключ dc_personal); вошедший — на сервере, видно на всех его устройствах.
// После входа: обмены и колокольчик этого браузера переходят в аккаунт сами (/api/me/claim), а личные заметки и подборки —
// по согласию человека (/api/me/merge: без дублей и без перезаписи разных заметок). После выхода личное гостя стирается.
import { api, tt, toast, storage, resetVisitor } from './util.js';
import { session } from './ui.js';

const KEY = 'dc_personal';
const MAX = 40;
const empty = () => ({ notes: {}, favorites: [], collections: [] });
let cache = null; let cacheUser = undefined;

function local() { try { const v = JSON.parse(storage.get(KEY) || 'null'); return v && typeof v === 'object' ? { ...empty(), ...v } : empty(); } catch { return empty(); } }
function saveLocal(v) { storage.set(KEY, JSON.stringify(v)); }
export const hasLocal = () => { const v = local(); return Object.keys(v.notes).length || v.favorites.length || v.collections.some((c) => c.codes.length); };

/** Текущее состояние в одном виде: { notes: {code: {text}}, collections: [{id, title, favorites, codes}] }. */
export async function load(force = false) {
  const uid = session.user ? session.user.id : null;
  if (cache && cacheUser === uid && !force) return cache;
  if (uid) {
    try { const s = await api('/api/me/personal'); cache = { notes: s.notes, collections: s.collections, server: true }; }
    catch { cache = { notes: {}, collections: [{ id: 'favorites', title: tt('Избранное', 'Favourites'), favorites: true, codes: [] }], server: true }; }
  } else {
    const v = local();
    cache = { notes: v.notes, collections: [{ id: 'favorites', title: tt('Избранное', 'Favourites'), favorites: true, codes: v.favorites }, ...v.collections.map((c) => ({ ...c, favorites: false }))], server: false };
  }
  cacheUser = uid;
  return cache;
}
const fav = (s) => s.collections.find((c) => c.favorites);
export const isFav = (s, code) => !!(fav(s) && fav(s).codes.includes(code));

let hinted = false;
/** Первое сохранение у гостя: где хранится и что даёт вход. */
function guestHint() {
  if (session.user || hinted || storage.get('dc_saved_hint')) return;
  hinted = true; storage.set('dc_saved_hint', '1');
  toast(tt('Сохранено в этом браузере. Войдите, чтобы видеть на других устройствах.', 'Saved in this browser. Sign in to see it on other devices.'));
}

export async function setNote(code, text) {
  const s = await load(); const t = String(text || '').trim().slice(0, 2000);
  if (s.server) await api(`/api/me/notes/${encodeURIComponent(code)}`, { method: 'PUT', body: { text: t } });
  else { const v = local(); if (t) v.notes[code] = { text: t, updatedAt: new Date().toISOString() }; else delete v.notes[code]; saveLocal(v); guestHint(); }
  if (t) s.notes[code] = { text: t }; else delete s.notes[code];
}
/** Добавить/убрать карту в подборке ('favorites' — «Избранное»). */
export async function toggle(id, code, on) {
  const s = await load();
  const c = s.collections.find((x) => String(x.id) === String(id)); if (!c) return;
  if (on && !c.codes.includes(code) && c.codes.length >= MAX) throw Object.assign(new Error('collection_full'), { code: 'collection_full' });
  if (s.server) await api(`/api/me/collections/${id}/cards`, { method: 'POST', body: { code, on } });
  else {
    const v = local();
    const list = id === 'favorites' ? v.favorites : (v.collections.find((x) => x.id === id) || {}).codes;
    if (list) { const i = list.indexOf(code); if (on && i < 0) list.push(code); if (!on && i >= 0) list.splice(i, 1); }
    saveLocal(v); if (on) guestHint();
  }
  const i = c.codes.indexOf(code); if (on && i < 0) c.codes.push(code); if (!on && i >= 0) c.codes.splice(i, 1);
}
export async function createCollection(title) {
  const s = await load(); const t = String(title || '').trim().slice(0, 80); if (!t) return null;
  let id;
  if (s.server) id = (await api('/api/me/collections', { method: 'POST', body: { title: t } })).id;
  else { const v = local(); id = 'l' + Date.now().toString(36); v.collections.push({ id, title: t, codes: [] }); saveLocal(v); guestHint(); }
  s.collections.push({ id, title: t, favorites: false, codes: [] });
  return id;
}
export async function renameCollection(id, title) {
  const s = await load(); const t = String(title || '').trim().slice(0, 80); if (!t) return;
  if (s.server) await api(`/api/me/collections/${id}`, { method: 'PATCH', body: { title: t } });
  else { const v = local(); const c = v.collections.find((x) => x.id === id); if (c) c.title = t; saveLocal(v); }
  const c = s.collections.find((x) => String(x.id) === String(id)); if (c) c.title = t;
}
export async function deleteCollection(id) {
  const s = await load();
  if (s.server) await api(`/api/me/collections/${id}`, { method: 'DELETE' });
  else { const v = local(); v.collections = v.collections.filter((x) => x.id !== id); saveLocal(v); }
  s.collections = s.collections.filter((x) => String(x.id) !== String(id));
}

/** После входа: обмены и колокольчик браузера — в аккаунт; личные данные — спросить и перенести. */
export async function afterLogin() {
  cache = null;
  try { await api('/api/me/claim', { method: 'POST' }); } catch { /* не страшно */ }
  if (!hasLocal()) return;
  const v = local();
  const n = Object.keys(v.notes).length; const f = v.favorites.length; const c = v.collections.length;
  const ok = confirm(tt(`В этом браузере сохранено: заметок — ${n}, в избранном — ${f}, подборок — ${c}. Перенести в аккаунт, чтобы видеть их на других устройствах? Ничего не перезапишется.`,
    `This browser has ${n} notes, ${f} favourites and ${c} collections. Move them to your account to see them on other devices? Nothing will be overwritten.`));
  if (!ok) return;
  try {
    await api('/api/me/merge', { method: 'POST', body: { notes: v.notes, favorites: v.favorites, collections: v.collections.map((x) => ({ title: x.title, codes: x.codes })) } });
    storage.set(KEY, ''); toast(tt('Перенесено в аккаунт', 'Moved to your account'));
  } catch { toast(tt('Не удалось перенести — данные остались в браузере.', 'Could not move — the data stays in this browser.')); }
}
/** Выход: на общем устройстве следующий человек не видит личного предыдущего (новый идентификатор браузера). */
export function afterLogout() { cache = null; resetVisitor(); try { sessionStorage.clear(); } catch { /* */ } }
export const MAX_CARDS = MAX;
