// Общие части интерфейса: сессия, значки, статусы, шаги, ленты, сетка карт, меню.
import { esc, tt, u, api } from './util.js';

export const session = { user: null, config: {}, showDemo: false };
export const hasRole = (...roles) => !!session.user && (session.user.roles.includes('admin') || roles.some((r) => session.user.roles.includes(r)));

const P = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
export const ic = {
  cards: P('<rect x="4" y="3" width="11" height="16" rx="2"/><path d="M17 6l3 1-4 14-7-2"/>'),
  calendar: P('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  brush: P('<path d="M14 4l6 6-8 8H6v-6z"/><path d="M4 20h4"/>'),
  people: P('<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><circle cx="17" cy="9" r="2.5"/><path d="M15 15c3 0 6 1.5 6 4"/>'),
  check: P('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  shield: P('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>'),
  chat: P('<path d="M4 5h16v11H9l-5 4z"/>'),
  user: P('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>'),
  qr: P('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14v7M14 20h3"/>'),
  print: P('<path d="M7 8V3h10v5"/><rect x="3" y="8" width="18" height="9" rx="2"/><path d="M7 14h10v7H7z"/>'),
  settings: P('<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-5l-.4 2.6a7 7 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 2.4h5l.4-2.6a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6c.1-.3.1-.7.1-1z"/>'),
  menu: P('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  close: P('<path d="M6 6l12 12M18 6L6 18"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  dice: P('<rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9" cy="9" r="1.2"/><circle cx="15" cy="15" r="1.2"/><circle cx="15" cy="9" r="1.2"/><circle cx="9" cy="15" r="1.2"/>'),
  expand: P('<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>'),
  x: P('<path d="M7 7l10 10M17 7L7 17"/>'),
  sun: P('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>'),
  globe: P('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>'),
  book: P('<path d="M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-6M20 4v14h-6"/>'),
  arrow: P('<path d="M5 12h14M13 6l6 6-6 6"/>'),
};

export const ROLE_LABEL = {
  artist: () => tt('Художник', 'Artist'), curator: () => tt('Куратор', 'Curator'),
  facilitator: () => tt('Фасилитатор', 'Facilitator'), admin: () => tt('Администратор', 'Administrator'),
};
export const rolesText = (roles) => (roles && roles.length ? roles.map((r) => ROLE_LABEL[r]()).join(' · ') : tt('Участник', 'Member'));

export const WORK_STATUS = {
  submitted: () => [tt('На рассмотрении', 'In review'), 'yellow'],
  discussion: () => [tt('На обсуждении кураторов', 'Curators are discussing'), 'yellow'],
  needs_changes: () => [tt('Возвращена на доработку', 'Returned for changes'), 'red'],
  rejected: () => [tt('Отклонена', 'Declined'), 'red'],
  published: () => [tt('Опубликована', 'Published'), 'mint'],
  withdrawn: () => [tt('Отозвана', 'Withdrawn'), ''],
};
export const statusPill = (map, s) => { const [label, cls] = (map[s] || (() => [s, '']))(); return `<span class="pill ${cls} status-tag">${esc(label)}</span>`; };
export const demoPill = (on) => (on ? `<span class="pill demo">${esc(tt('демо', 'demo'))}</span>` : '');

/** Лента статусов: [{title, note, state: done|now|todo|bad}] */
export function timeline(items) {
  return `<ol class="timeline">${items.map((i) => `<li class="${i.state || 'todo'}"><span class="dot">${i.state === 'done' ? ic.check : i.state === 'now' ? ic.sun : ''}</span>
    <b>${esc(i.title)}</b>${i.note ? `<div class="small">${i.note}</div>` : ''}</li>`).join('')}</ol>`;
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
    <div class="row"><a class="btn dark" href="${u('/login?next=' + encodeURIComponent(location.pathname.slice((u('') || '').length) || '/'))}">${esc(tt('Войти по email', 'Sign in with email'))}</a></div>
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

export async function refreshSession() {
  try {
    const [me, cfg] = await Promise.all([api('/api/me'), api('/api/config')]);
    session.user = me.user; session.showDemo = me.showDemo; session.config = cfg;
  } catch { /* сайт работает и без этого */ }
}

export function showQr(slug, title, url) {
  const el = document.createElement('div');
  el.className = 'qr-overlay';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
  el.innerHTML = `<button class="icon-btn qr-close" type="button" aria-label="${esc(tt('Закрыть', 'Close'))}">${ic.close}</button>
    <img class="qr-logo" src="${u('/img/emblem-white.webp')}" alt="">
    <h2>${esc(title)}</h2>
    <img class="qr-img" src="${u('/api/c/' + slug + '/qr.svg')}" alt="QR">
    <p class="qr-url">${esc(url.replace(/^https?:\/\//, ''))}</p>
    <p class="muted">${esc(tt('Наведите камеру телефона на QR-код', 'Point your phone camera at the QR code'))}</p>`;
  document.body.appendChild(el); document.body.classList.add('no-scroll');
  const close = () => { el.remove(); document.body.classList.remove('no-scroll'); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  el.querySelector('.qr-close').addEventListener('click', close);
  el.querySelector('.qr-close').focus();
}
