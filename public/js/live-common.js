// Общее для встречи по телефонам: знак пары (две цветные фигуры и номер), мягкие сигналы, таймер, экран не гаснет.
import { esc, tt, u } from './util.js';
import { lang } from './i18n.js';

const SHAPE = {
  circle: '<circle cx="50" cy="50" r="44"/>',
  square: '<rect x="8" y="8" width="84" height="84" rx="10"/>',
  triangle: '<path d="M50 6 L95 90 L5 90 Z" stroke-linejoin="round"/>',
  star: '<path d="M50 4 L61.8 36.6 L96 37.6 L69 58.6 L78.6 92 L50 72.4 L21.4 92 L31 58.6 L4 37.6 L38.2 36.6 Z"/>',
  diamond: '<path d="M50 3 L95 50 L50 97 L5 50 Z"/>',
};
const shapeSvg = (p, cls = '') => `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true"><g fill="${esc(p.color)}">${SHAPE[p.shape] || SHAPE.circle}</g></svg>`;
export const signWords = (s) => `${lang === 'en' ? s.top.en : s.top.ru} · ${lang === 'en' ? s.bottom.en : s.bottom.ru}`;

/** Большой знак во весь экран: верхняя фигура, номер пары, нижняя фигура. */
export function signHtml(s, { big = true } = {}) {
  return `<div class="pair-sign ${big ? 'big' : 'mini'}" role="img" aria-label="${esc(tt(`Знак пары №${s.n}: ${signWords(s)}`, `Pair sign #${s.n}: ${signWords(s)}`))}">
    ${shapeSvg(s.top, 'ps-top')}<span class="ps-n">${s.n}</span>${shapeSvg(s.bottom, 'ps-bottom')}</div>`;
}

// ---------- звуки: колокол (FluidR3 GM, MIT) — 1 удар за 3 минуты, 2 — за минуту, 3 — конец; «соберёмся» — напоминание ----------
const SOUND = { b1: 'bell-1.mp3', b2: 'bell-2.mp3', b3: 'bell-3.mp3', gather: 'gather.mp3' };
const audio = {};
let unlocked = false;
export function soundsReady() { return unlocked; }
/** Вызывается по нажатию (браузеры разрешают звук только после действия человека). */
export function unlockSound() {
  for (const [k, f] of Object.entries(SOUND)) {
    if (!audio[k]) { audio[k] = new Audio(u('/sounds/' + f)); audio[k].preload = 'auto'; }
  }
  if (unlocked) return;
  const a = audio.b1; const v = a.volume;
  a.volume = 0; a.play().then(() => { a.pause(); a.currentTime = 0; a.volume = v; unlocked = true; }).catch(() => { a.volume = v; });
}
export function play(kind) {
  const a = audio[kind]; if (!a) return;
  try { a.currentTime = 0; a.play().catch(() => {}); } catch { /* без звука */ }
  if (navigator.vibrate) navigator.vibrate(kind === 'b3' ? [200, 150, 200, 150, 200] : kind === 'b2' ? [200, 150, 200] : [250]);
}

// ---------- таймер раунда по часам сервера ----------
export function clock(serverNow) { return Date.parse(serverNow) - Date.now(); } // поправка к часам устройства
export const left = (endsAt, skew) => Math.max(0, Date.parse(endsAt) - (Date.now() + skew));
export const mmss = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** Сигналы по оставшемуся времени — каждый один раз за раунд. */
export function bellsFor(sessionId, round, ms, fired) {
  const key = (k) => `${sessionId}:${round}:${k}`;
  const fire = (k) => { if (!fired.has(key(k))) { fired.add(key(k)); play(k); } };
  if (ms <= 0) { fired.add(key('b1')); fired.add(key('b2')); fire('b3'); }
  else if (ms <= 60e3) { fired.add(key('b1')); fire('b2'); }
  else if (ms <= 180e3) fire('b1');
}

// ---------- экран не гаснет во время встречи (где поддерживается) ----------
let lock = null;
export async function keepAwake(on = true) {
  try {
    if (on && 'wakeLock' in navigator && document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen');
    else if (!on && lock) { await lock.release(); lock = null; }
  } catch { /* не поддерживается — не страшно */ }
}

/** Подписка на изменения встречи: поток событий, а если он не работает — опрос раз в 4 секунды. */
export function subscribe(path, onChange, alive) {
  let es = null; let poll = null; let closed = false;
  const stop = () => { closed = true; if (es) es.close(); clearInterval(poll); clearInterval(guard); document.removeEventListener('visibilitychange', vis); };
  const startPoll = () => { if (!poll) poll = setInterval(() => !closed && onChange(), 4000); };
  try {
    es = new EventSource(u(path));
    es.onmessage = () => !closed && onChange();
    es.onerror = () => { startPoll(); };
  } catch { startPoll(); }
  const safety = setInterval(() => !closed && onChange(), 20000); // на случай тихого обрыва соединения
  const guard = setInterval(() => { if (!alive()) { stop(); clearInterval(safety); keepAwake(false); } }, 1000);
  const vis = () => { if (document.visibilityState === 'visible' && !closed) { onChange(); keepAwake(true); } };
  document.addEventListener('visibilitychange', vis);
  return () => { stop(); clearInterval(safety); };
}
