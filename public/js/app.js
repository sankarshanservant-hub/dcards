import { lang, setLang } from './i18n.js';
import { esc, tt, u, api, BASE, toast, errorText } from './util.js';
import { isViewerOpen, handleViewerPopState } from './viewer.js';
import { session, hasRole, ic, rolesText, refreshSession, skipSiteAutoLogin } from './ui.js';
import * as pub from './views/public.js';
import * as tool from './views/meeting-tool.js';
import * as meet from './views/meetings.js';
import * as acc from './views/account.js';
import * as artist from './views/artist.js';
import * as cur from './views/curator.js';
import * as fac from './views/facilitator.js';
import * as team from './views/team.js';
import * as adm from './views/admin.js';

const main = document.getElementById('app');
let renderToken = 0;
let renderedPath = null;

// ---------- маршруты ----------
const routes = [
  [/^\/$/, pub.home],
  [/^\/library\/?$/, pub.library],
  [/^\/cards\/(DC-\d{4,6})\/?$/, pub.cardPage],
  [/^\/start\/?$/, pub.start],
  [/^\/join\/?$/, (ctx) => ctx.navigate('/start#join', { replace: true })],
  [/^\/facilitator\/about\/?$/, pub.facilitatorAbout],
  [/^\/curator\/apply\/?$/, pub.curatorApply],
  [/^\/demo\/?$/, acc.demoRoles],
  [/^\/terms\/?$/, pub.terms],
  [/^\/s\/([a-z0-9]{4,32})\/?$/, tool.collection],
  [/^\/meetings\/?$/, meet.search],
  [/^\/meetings\/([^/]+)\/?$/, meet.search],
  [/^\/meetings\/([^/]+)\/([^/]+)\/?$/, meet.search],
  [/^\/m\/(\d+)\/?$/, meet.datePage],
  [/^\/r\/([A-Za-z0-9_-]{10,})\/?$/, meet.registration],
  [/^\/login\/?$/, acc.login],
  [/^\/me\/?$/, acc.profile],
  [/^\/artist\/?$/, artist.cabinet],
  [/^\/artist\/submit\/?$/, artist.submit],
  [/^\/artist\/works\/(\d+)\/?$/, artist.work],
  [/^\/curator\/?$/, cur.queue],
  [/^\/curator\/works\/(\d+)\/?$/, cur.review],
  [/^\/facilitator\/?$/, fac.cabinet],
  [/^\/facilitator\/apply\/?$/, fac.apply],
  [/^\/facilitator\/c\/(\d+)\/?$/, fac.collectionEditor],
  [/^\/facilitator\/m\/new\/?$/, fac.meetingEditor],
  [/^\/facilitator\/m\/(\d+)\/?$/, fac.meetingEditor],
  [/^\/team\/(curators|facilitators)\/?$/, team.chat],
  [/^\/print\/?$/, team.print],
  [/^\/admin\/?$/, adm.overview],
  [/^\/admin\/(users|applications|meetings|cards|comments|criteria|letters)\/?$/, adm.section],
];

const appPath = () => location.pathname.slice(BASE.length) || '/';

// Поверхности: yellow — творческое (главная, знакомство, галерея, подборка), light — серьёзное (условия, критерии, подача и проверка работ, курс и заявки), иначе тёмная.
const YELLOW = [/^\/$/, /^\/start\/?$/, /^\/library\/?$/, /^\/s\/[a-z0-9]+\/?$/];
const LIGHT = [/^\/terms\/?$/, /^\/artist(\/|$)/, /^\/curator(\/|$)/, /^\/facilitator\/apply\/?$/, /^\/admin\/criteria\/?$/];
const surfaceOf = (path) => (YELLOW.some((r) => r.test(path)) ? 'yellow' : LIGHT.some((r) => r.test(path)) ? 'light' : 'dark');

async function render() {
  const token = ++renderToken;
  renderedPath = location.pathname;
  document.body.classList.remove('has-choice-bar');
  renderChrome();
  const path = appPath();
  main.dataset.surface = surfaceOf(path);
  const ctx = {
    main, token, alive: () => token === renderToken, rerender: render, navigate,
    query: new URL(location.href).searchParams,
  };
  for (const [re, view] of routes) {
    const m = path.match(re);
    if (m) {
      try { await view(ctx, ...m.slice(1).map(decodeURIComponent)); if (location.hash && ctx.alive()) { const t = document.getElementById(decodeURIComponent(location.hash.slice(1))); if (t) t.scrollIntoView({ block: 'start' }); } } catch (e) { console.error(e); if (ctx.alive()) main.innerHTML = `<div class="wrap page"><p class="error-box">${esc(errorText(e))}</p></div>`; }
      return;
    }
  }
  main.innerHTML = `<div class="wrap page narrow"><h1>${esc(tt('Страница не найдена', 'Page not found'))}</h1><p><a href="${u('/')}">Dialogue Cards</a></p></div>`;
}

export function navigate(path, { replace = false } = {}) {
  const url = path.startsWith('http') ? path : u(path);
  if (replace) history.replaceState({}, '', url); else history.pushState({}, '', url);
  render();
  window.scrollTo(0, 0);
}
window.dcNavigate = navigate;

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || a.target || a.hasAttribute('download') || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith(BASE + '/') && url.pathname !== BASE) return;
  const p = url.pathname.slice(BASE.length);
  if (p.startsWith('/api/') || p.startsWith('/media/')) return;
  e.preventDefault();
  closeMenu();
  if (url.pathname === location.pathname && url.search === location.search && url.hash) { location.hash = url.hash; return; }
  navigate(p + url.search + url.hash);
});
window.addEventListener('popstate', () => {
  handleViewerPopState();
  if (location.pathname !== renderedPath) render();
});

// ---------- шапка, меню, подвал ----------
// Одна первая буква отображаемого имени: пробелы, скобки и знаки пропускаются («G(» → «G»). Нет имени — значок профиля.
function initial(name) { const m = String(name || '').match(/[\p{L}\p{N}]/u); return m ? m[0].toLocaleUpperCase() : ''; }
const avatar = (name) => initial(name) || ic.user;

function renderChrome() {
  const p = appPath();
  const link = (href, ru, en, on) => `<a href="${u(href)}" class="${on ? 'on' : ''}">${esc(tt(ru, en))}</a>`;
  document.getElementById('nav').innerHTML =
    link('/library', 'Карты', 'Cards', p.startsWith('/library') || p.startsWith('/cards'))
    + link('/meetings', 'Встречи', 'Meetings', p.startsWith('/meetings') || p.startsWith('/m/'))
    + link('/start#join', 'Участвовать', 'Take part', p.startsWith('/start') || p.startsWith('/facilitator/about') || p.startsWith('/curator/apply'));
  const acct = document.getElementById('acct');
  acct.innerHTML = session.user
    ? `<button class="acct" type="button" data-menu><span class="ava">${avatar(session.user.publicName)}</span><span class="nm">${esc(session.user.publicName)}</span></button>`
    : `<a class="signin" href="${u('/login')}">${esc(tt('Войти', 'Sign in'))}</a>`;
  const ls = document.getElementById('lang');
  ls.textContent = lang === 'ru' ? 'EN' : 'RU';
  ls.setAttribute('aria-label', lang === 'ru' ? 'Switch to English' : 'Переключить на русский');
  document.getElementById('foot').innerHTML = `<span>© Dialogue Cards · Dialogue Flow</span>
    <a href="${u('/start#join')}">${esc(tt('Участвовать', 'Take part'))}</a>
    <a href="${u('/terms')}">${esc(tt('Условия публикации', 'Publication terms'))}</a>
    ${session.config.demoMode ? `<span>${esc(tt('Прототип в демо-режиме', 'Prototype in demo mode'))}</span>` : ''}`;
  const pill = document.getElementById('demo-pill');
  const demoOn = session.config.demoMode && (session.showDemo || (session.user && session.user.isDemo));
  pill.hidden = !demoOn;
  if (demoOn) pill.textContent = `${tt('ДЕМО', 'DEMO')} · ${session.user ? rolesText(session.user.roles) : tt('гость', 'guest')}`;
}
document.getElementById('lang').addEventListener('click', () => { setLang(lang === 'ru' ? 'en' : 'ru'); if (isViewerOpen()) history.back(); render(); });
document.getElementById('burger').addEventListener('click', openMenu);
document.getElementById('demo-pill').addEventListener('click', openMenu);
document.getElementById('acct').addEventListener('click', (e) => { if (e.target.closest('[data-menu]')) openMenu(); });

function mi(href, icon, ru, en, noteRu = '', noteEn = '', hl = false, badge = '') {
  return `<a class="mi ${hl ? 'hl' : ''}" href="${u(href)}"><span class="ic">${icon}</span><span><b>${esc(tt(ru, en))}</b>${noteRu ? `<small>${esc(tt(noteRu, noteEn))}</small>` : ''}</span>${badge ? `<span class="badge">${esc(badge)}</span>` : ''}</a>`;
}
function openMenu() {
  closeMenu();
  const s = session.user;
  const el = document.createElement('div');
  el.className = 'sheet-menu'; el.id = 'sheet-menu';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
  // Рабочие кабинеты — только те, что доступны этому человеку. Администратор входит через обычный вход; в демо его кнопка — на экране «Демо-роли».
  const cabinets = [];
  if (s) {
    if (hasRole('artist')) cabinets.push(mi('/artist', ic.brush, 'Кабинет художника', 'Artist space', 'Мои работы и карты', 'My works and cards'));
    if (hasRole('facilitator')) cabinets.push(mi('/facilitator', ic.qr, 'Кабинет фасилитатора', 'Facilitator space', 'Подборки и встречи', 'Selections and meetings'), mi('/team/facilitators', ic.chat, 'Чат фасилитаторов', 'Facilitators’ chat'));
    if (hasRole('curator')) cabinets.push(mi('/curator', ic.check, 'Кабинет куратора', 'Curator space', 'Работы на рассмотрении', 'Works under review'), mi('/team/curators', ic.chat, 'Чат кураторов', 'Curators’ chat'));
    if (hasRole('curator', 'artist')) cabinets.push(mi('/print', ic.print, 'Печатная колода', 'Printed deck', 'Будущий этап', 'Future stage'));
  }
  const demoRoles = [['guest', 'Участник', 'Participant'], ['artist', 'Художник', 'Artist'], ['curator', 'Куратор', 'Curator'], ['facilitator', 'Фасилитатор', 'Facilitator']];
  el.innerHTML = `<div class="panel">
    <div class="head">
      ${s ? `<span class="ava">${avatar(s.publicName)}</span><div class="who"><b>${esc(s.publicName)}</b><span>${esc(rolesText(s.roles))}${s.isDemo ? ' · ' + esc(tt('демо', 'demo')) : ''}</span></div>`
        : `<div class="who"><b>Dialogue Cards</b><span>${esc(tt('Иллюстрации для живого разговора', 'Illustrations for real conversation'))}</span></div>`}
      <button class="icon-btn" type="button" data-close aria-label="${esc(tt('Закрыть', 'Close'))}">${ic.close}</button>
    </div>
    <div class="sec">${esc(tt('Обзор', 'Explore'))}</div>
    ${mi('/library', ic.cards, 'Галерея карт', 'Card gallery')}
    ${mi('/meetings', ic.calendar, 'Встречи Dialogue Flow', 'Dialogue Flow meetings')}
    ${mi('/start#join', ic.people, 'Участвовать', 'Take part')}
    ${s ? `${cabinets.length ? `<div class="sec">${esc(tt('Мои кабинеты', 'My spaces'))}</div>${cabinets.join('')}` : ''}
      <div class="sec">${esc(tt('Аккаунт', 'Account'))}</div>
      ${mi('/me', ic.user, 'Профиль', 'Profile', 'Имя и публичное имя', 'Name and public name')}
      ${hasRole('admin') ? mi('/admin', ic.shield, 'Администрирование', 'Administration', 'Роли, встречи, заявки, модерация', 'Roles, meetings, applications, moderation', true) : ''}`
    : `<div class="sec">${esc(tt('Вход', 'Sign in'))}</div>${mi('/login', ic.user, 'Войти', 'Sign in', 'Без пароля — код в письме или аккаунт сайта', 'No password — an emailed code or the site account', true)}`}
    ${session.config.demoMode ? `<div class="demo-box">
      <p>${esc(tt('Демо-режим прототипа: войдите под тестовой ролью, чтобы пройти её путь. Права проверяются на сервере. Демо-данные помечены и не смешиваются с настоящими.', 'Prototype demo mode: sign in as a test role to walk through its path. Permissions are checked on the server. Demo data is labelled and kept apart from real data.'))}</p>
      <div class="chips">${demoRoles.map(([k, ru, en]) => `<button class="chip" type="button" data-demo="${k}">${esc(tt(ru, en))}</button>`).join('')}</div>
      <a class="small" href="${u('/demo')}">${esc(tt('Все демо-роли →', 'All demo roles →'))}</a>
    </div>` : ''}
    ${s ? `<button class="btn light sm" type="button" data-logout style="margin-top:14px">${esc(tt('Выйти', 'Sign out'))}</button>` : ''}
  </div>`;
  document.body.appendChild(el); document.body.classList.add('no-scroll');
  el.addEventListener('click', async (e) => {
    if (e.target === el || e.target.closest('[data-close]')) { closeMenu(); return; }
    const d = e.target.closest('[data-demo]');
    if (d) {
      try { await api('/api/demo/login', { method: 'POST', body: { as: d.dataset.demo } }); await refreshSession(); closeMenu(); toast(tt('Вы вошли как: ', 'Signed in as: ') + session.user.publicName); navigate(homeFor()); }
      catch (err) { toast(errorText(err)); }
    }
    if (e.target.closest('[data-logout]')) { skipSiteAutoLogin(); await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); await refreshSession(); closeMenu(); navigate('/'); }
  });
  const onKey = (e) => { if (e.key === 'Escape') closeMenu(); };
  document.addEventListener('keydown', onKey);
  el._off = () => document.removeEventListener('keydown', onKey);
  el.querySelector('[data-close]').focus();
}
function closeMenu() {
  const el = document.getElementById('sheet-menu');
  if (el) { el._off && el._off(); el.remove(); document.body.classList.remove('no-scroll'); }
}
/** Куда вести после входа: в основной кабинет роли. */
export function homeFor() {
  if (hasRole('admin') && session.user.roles.includes('admin')) return '/admin';
  if (session.user?.roles.includes('curator')) return '/curator';
  if (session.user?.roles.includes('facilitator')) return '/facilitator';
  if (session.user?.roles.includes('artist')) return '/artist';
  return '/start';
}
window.dcHomeFor = homeFor;
window.dcRenderChrome = renderChrome;

(async () => { await refreshSession(); render(); })();
