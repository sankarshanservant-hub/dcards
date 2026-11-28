// Общие части интерфейса: сессия, значки, статусы, шаги, ленты, сетка карт, меню.
import { esc, tt, u, api, toast } from './util.js';

export const session = { user: null, config: {}, showDemo: false };
export const hasRole = (...roles) => !!session.user && (session.user.roles.includes('admin') || roles.some((r) => session.user.roles.includes(r)));

const P = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
export const ic = {
  mic: P('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>'),
  video: P('<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>'),
  bell: P('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>'),
  lock: P('<rect x="5" y="11" width="14" height="9.5" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  reply: P('<path d="M10 7L4 12l6 5"/><path d="M4 12h10a6 6 0 0 1 6 6v1"/>'),
  clock: P('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>'),
  pin: P('<path d="M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.3"/>'),
  ticket: P('<path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z"/><path d="M14 7v10" stroke-dasharray="1.6 2"/>'),
  question: P('<circle cx="12" cy="12" r="9.5"/><path d="M9.3 9.4a2.8 2.8 0 1 1 3.9 2.6c-.8.3-1.2.9-1.2 1.7v.6"/><circle cx="12" cy="17" r=".6"/>'),
  cards: P('<rect x="4" y="3" width="11" height="16" rx="2"/><path d="M17 6l3 1-4 14-7-2"/>'),
  calendar: P('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  brush: P('<path d="M14 4l6 6-8 8H6v-6z"/><path d="M4 20h4"/>'),
  people: P('<circle cx="7" cy="7" r="3.2"/><circle cx="17" cy="7" r="3.2"/><path d="M1.5 20.5c0-3.4 2.4-6 5.5-6s5.5 2.6 5.5 6"/><path d="M11.5 20.5c0-3.4 2.4-6 5.5-6s5.5 2.6 5.5 6"/>'),
  check: P('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  shield: P('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>'),
  chat: P('<path d="M4 5h16v11H9l-5 4z"/>'),
  user: P('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>'),
  qr: P('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14v7M14 20h3"/>'),
  print: P('<path d="M7 8V3h10v5"/><rect x="3" y="8" width="18" height="9" rx="2"/><path d="M7 14h10v7H7z"/>'),
  settings: P('<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-5l-.4 2.6a7 7 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 2.4h5l.4-2.6a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6c.1-.3.1-.7.1-1z"/>'),
  menu: P('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  home: P('<path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.5V20h12V9.5"/>'),
  mail: P('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5 12 13l8.5-6.5"/>'),
  arrowLeft: P('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  share: P('<path d="M12 3.5v11M8 7.5l4-4 4 4"/><path d="M6.5 11H5v9h14v-9h-1.5"/>'),
  // простой контурный куб — общие входы в игры (у «Случайной карты» свой подробный кубик)
  cube: P('<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>'),
  chevronLeft: P('<path d="M15 5l-7 7 7 7"/>'),
  chevronRight: P('<path d="M9 5l7 7-7 7"/>'),
  close: P('<path d="M6 6l12 12M18 6L6 18"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  dice: '<svg viewBox="0 0 32 32" aria-hidden="true" class="die3d"><path class="f-top" d="M16 3.2 L27.6 9.6 L16 16 L4.4 9.6 Z"/><path class="f-left" d="M4.4 9.6 L16 16 L16 28.8 L4.4 22.4 Z"/><path class="f-right" d="M27.6 9.6 L16 16 L16 28.8 L27.6 22.4 Z"/><ellipse class="pip" cx="16" cy="9.6" rx="2.2" ry="1.25"/><ellipse class="pip" cx="7.6" cy="14.3" rx="1.25" ry="1.7" transform="rotate(-28 7.6 14.3)"/><ellipse class="pip" cx="12.8" cy="23.4" rx="1.25" ry="1.7" transform="rotate(-28 12.8 23.4)"/><ellipse class="pip" cx="24.6" cy="13.6" rx="1.25" ry="1.7" transform="rotate(28 24.6 13.6)"/><ellipse class="pip" cx="21.8" cy="18.6" rx="1.25" ry="1.7" transform="rotate(28 21.8 18.6)"/><ellipse class="pip" cx="19" cy="23.6" rx="1.25" ry="1.7" transform="rotate(28 19 23.6)"/></svg>',
  expand: P('<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>'),
  x: P('<path d="M7 7l10 10M17 7L7 17"/>'),
  sun: P('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>'),
  globe: P('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>'),
  book: P('<path d="M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-6M20 4v14h-6"/>'),
  picPlus: P('<rect x="1.5" y="8" width="11" height="13.5" rx="2"/><path d="M1.5 18.5l3-3 2.6 2.6 1.8-1.8 3.6 3.6"/><circle cx="8.4" cy="12.3" r="1.3"/><path d="M18.8 1.6v9.4M14.1 6.3h9.4"/>'),
  picCheck: P('<rect x="1.5" y="8" width="11" height="13.5" rx="2"/><path d="M1.5 18.5l3-3 2.6 2.6 1.8-1.8 3.6 3.6"/><circle cx="8.4" cy="12.3" r="1.3"/><path d="M14.6 6.4l3 3.1 5.6-6.6"/>'),
  chats: P('<path d="M3 4h12v8H8l-4 3z"/><path d="M9 15v1h8l4 3v-11h-3"/>'),
  arrow: P('<path d="M5 12h14M13 6l6 6-6 6"/>'),
};

export const ROLE_LABEL = {
  artist: () => tt('Автор', 'Author'), curator: () => tt('Куратор', 'Curator'),
  facilitator: () => tt('Фасилитатор', 'Facilitator'), admin: () => tt('Администратор', 'Administrator'),
};
// Подпись ролей (26.11.2026): администратору — только «Администратор»; остальным — полученные роли; без ролей — «Участник».
export const rolesText = (roles) => (roles && roles.includes('admin') ? ROLE_LABEL.admin() : roles && roles.length ? roles.filter((r) => ROLE_LABEL[r]).map((r) => ROLE_LABEL[r]()).join(' · ') : tt('Участник', 'Member'));

export const WORK_STATUS = {
  submitted: () => [tt('На рассмотрении', 'In review'), 'yellow'],
  discussion: () => [tt('На обсуждении кураторов', 'Curators are discussing'), 'yellow'],
  recommended: () => [tt('Рекомендована кураторами — ждёт решения администратора', 'Recommended by curators — awaiting the administrator'), 'yellow'],
  needs_changes: () => [tt('Возвращена на доработку', 'Returned for changes'), 'red'],
  rejected: () => [tt('Отклонена', 'Declined'), 'red'],
  published: () => [tt('Опубликована', 'Published'), 'mint'],
  withdrawn: () => [tt('Отозвана', 'Withdrawn'), ''],
};
export const statusPill = (map, s) => { const [label, cls] = (map[s] || (() => [s, '']))(); return `<span class="pill ${cls} status-tag">${esc(label)}</span>`; };
export const demoPill = (on) => (on ? `<span class="pill demo">${esc(tt('демо', 'demo'))}</span>` : '');

/** Лента статусов: [{title, note, href, state: done|now|todo|bad}]. note — обычный текст (экранируется здесь), href — ссылка на всю подпись. */
export function timeline(items) {
  const note = (i) => (i.href ? `<a href="${esc(i.href)}">${esc(i.note)}</a>` : esc(i.note));
  return `<ol class="timeline">${items.map((i) => `<li class="${esc(i.state || 'todo')}"><span class="dot">${i.state === 'done' ? ic.check : i.state === 'now' ? ic.sun : ''}</span>
    <b>${esc(i.title)}</b>${i.note ? `<div class="small">${note(i)}</div>` : ''}</li>`).join('')}</ol>`;
}
export const stepsBar = (n, of) => `<div class="steps-bar" aria-label="${n} / ${of}">${Array.from({ length: of }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</div>`;

export function tileHtml(c, i, { extraClass = '', badge = '', label = '' } = {}) {
  return `<button class="tile ${extraClass}" type="button" data-i="${i}" aria-label="${esc(label || c.code)}">
      <img src="${esc(c.thumb)}" alt="" loading="lazy" decoding="async" width="${c.width}" height="${c.height}">
      ${badge}${c.isDemo ? `<span class="tile-demo">${esc(tt('демо', 'demo'))}</span>` : ''}
    </button>`;
}

export function loading(main) { main.innerHTML = `<div class="wrap page"><p class="muted">${esc(tt('Загрузка…', 'Loading…'))}</p></div>`; }
export function needLogin(main, why) {
  main.innerHTML = `<div class="wrap page narrow"><div class="card-ui stack">
    <h2>${esc(tt('Нужно войти', 'Please sign in'))}</h2><p class="muted">${esc(why || '')}</p>
    <div class="row"><a class="btn dark" href="${u('/login?next=' + encodeURIComponent((location.pathname.slice((u('') || '').length) || '/') + location.search))}">${esc(tt('Войти по email', 'Sign in with email'))}</a></div>
  </div></div>`;
}
export function noRole(main, roleText) {
  main.innerHTML = `<div class="wrap page narrow"><div class="card-ui stack">
    <h2>${esc(tt('Нет доступа', 'No access'))}</h2>
    <p class="muted">${esc(tt('Этот раздел доступен роли:', 'This section is for the role:'))} <b>${esc(roleText)}</b>. ${esc(tt('Роли выдаёт администратор.', 'Roles are granted by an administrator.'))}</p>
    <div class="row"><a class="btn" href="${u('/join')}">${esc(tt('Как получить роль', 'How to get a role'))}</a></div>
  </div></div>`;
}
export function failed(main, e, retry) {
  main.innerHTML = `<div class="wrap page narrow"><p class="error-box">${esc(e && e.message === 'network' ? tt('Нет связи с сервером.', 'No connection to the server.') : tt('Не удалось загрузить страницу.', 'Could not load the page.'))}</p>
    <button class="btn" type="button" id="retry">${esc(tt('Повторить', 'Retry'))}</button></div>`;
  main.querySelector('#retry').addEventListener('click', retry);
}

// Общий аккаунт сайта (harekrishna.info): его сессия лежит в localStorage этого же домена (ключи amSession/amProfile).
const lsGet = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } };
export const siteSession = () => lsGet('amSession');
export const siteProfileName = () => { try { const p = JSON.parse(lsGet('amProfile') || 'null'); return p ? (p.displayName || p.name || '') : ''; } catch { return ''; } };
/** Войти по сессии сайта. После выхода из Dialogue Cards та же сессия сайта сама больше не входит. */
export async function loginWithSite({ force = false } = {}) {
  const s = siteSession();
  if (!s || !session.config.siteLogin) return false;
  if (!force && lsGet('dc_site_skip') === s) return false;
  try { await api('/api/auth/site', { method: 'POST', body: { session: s } }); lsSet('dc_site_skip', ''); return true; } catch { return false; }
}
export const skipSiteAutoLogin = () => lsSet('dc_site_skip', siteSession());

// Миниатюры: при ошибке загрузки — подпись «Не загрузилось · нажмите, чтобы повторить».
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.closest('.tile')) return;
  const tile = img.closest('.tile');
  if (tile.querySelector('.tile-err')) return;
  tile.classList.add('broken');
  tile.insertAdjacentHTML('beforeend', `<span class="tile-err">${esc(tt('Не загрузилось · нажмите, чтобы повторить', 'Did not load · tap to retry'))}</span>`);
}, true);
document.addEventListener('click', (e) => {
  const tile = e.target.closest('.tile.broken');
  if (!tile) return;
  e.preventDefault(); e.stopPropagation();
  const img = tile.querySelector('img');
  tile.classList.remove('broken'); tile.querySelector('.tile-err')?.remove();
  const src = img.getAttribute('src').replace(/[?&]r=\d+$/, '');
  img.src = `${src}${src.includes('?') ? '&' : '?'}r=${Date.now()}`;
}, true);

export async function refreshSession() {
  const before = session.user ? session.user.id : null;
  try {
    const [me, cfg] = await Promise.all([api('/api/me'), api('/api/config')]);
    session.user = me.user; session.showDemo = me.showDemo; session.config = cfg;
    if (!session.user && await loginWithSite()) {
      const again = await api('/api/me');
      session.user = again.user; session.showDemo = again.showDemo;
    }
  } catch { /* сайт работает и без этого */ }
  const after = session.user ? session.user.id : null;
  // вход или выход в этой вкладке — app.js переносит данные гостя или очищает личное (personal.js)
  if (before !== after && session.loaded) window.dispatchEvent(new CustomEvent('dc-auth', { detail: { before, after } }));
  session.loaded = true;
}

export function showQr(slug, title, url) {
  const el = document.createElement('div');
  el.className = 'qr-overlay';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
  el.innerHTML = `<button class="icon-btn qr-close" type="button" aria-label="${esc(tt('Закрыть', 'Close'))}">${ic.close}</button>
    <img class="qr-logo em-dark" src="${u('/img/emblem-white.webp')}" alt=""><img class="qr-logo em-light" src="${u('/img/emblem-black.webp')}" alt="">
    <h2>${esc(title)}</h2>
    <img class="qr-img" src="${u('/api/c/' + slug + '/qr.svg')}" alt="QR">
    <p class="qr-url">${esc(url.replace(/^https?:\/\//, ''))}</p>
    <div class="row" style="justify-content:center"><button class="btn yellow" type="button" data-copy>${esc(tt('Скопировать ссылку', 'Copy link'))}</button></div>
    <p class="muted">${esc(tt('Наведите камеру телефона на QR-код. Ссылку можно отправить в чат Zoom.', 'Point your phone camera at the QR code. You can send the link in the Zoom chat.'))}</p>`;
  document.body.appendChild(el); document.body.classList.add('no-scroll');
  const opener = document.activeElement;
  const close = () => { el.remove(); document.body.classList.remove('no-scroll'); document.removeEventListener('keydown', onKey); if (opener && document.contains(opener)) opener.focus({ preventScroll: true }); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  el.querySelector('.qr-close').addEventListener('click', close);
  el.querySelector('[data-copy]').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url); toast(tt('Ссылка скопирована', 'Link copied')); } catch { prompt(tt('Скопируйте ссылку:', 'Copy the link:'), url); }
  });
  el.querySelector('.qr-close').focus();
}

// «Случайная карта»: одна кнопка с жёлтым кубиком. Кубик коротко поворачивается только по нажатию (без вращения в ожидании),
// затем вызывается fn. Повторные нажатия во время поворота игнорируются; при reduced motion — сразу.
export const diceButtonHtml = (id = 'rnd') => `<button class="btn dark sm dice-btn" type="button" id="${id}"><span class="die">${ic.dice}</span>${esc(tt('Случайная карта', 'Random card'))}</button>`;
export function wireDice(btn, fn, alive = () => true) {
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (btn.dataset.rolling) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { fn(); return; }
    btn.dataset.rolling = '1'; btn.classList.add('rolling');
    setTimeout(() => { btn.classList.remove('rolling'); delete btn.dataset.rolling; if (alive()) fn(); }, 500);
  });
}
