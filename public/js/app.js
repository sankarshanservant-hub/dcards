import { lang, setLang } from './i18n.js';
import { esc, tt, u, api, BASE, toast, errorText } from './util.js';
import { isViewerOpen, handleViewerPopState, closeViewer } from './viewer.js';
import { session, hasRole, ic, rolesText, refreshSession, skipSiteAutoLogin } from './ui.js';
import * as pub from './views/public.js';
import * as tool from './views/meeting-tool.js';
import * as notif from './views/notify.js';
import * as livePanel from './views/live-panel.js';
import * as grp from './views/group.js';
import { syncPush } from './push.js';
import * as meet from './views/meetings.js';
import * as acc from './views/account.js';
import * as artist from './views/artist.js';
import * as cur from './views/curator.js';
import * as fac from './views/facilitator.js';
import * as coll from './views/fac-collections.js';
import * as team from './views/team.js';
import * as adm from './views/admin.js';
import * as xch from './views/exchange.js';
import * as personal from './personal.js';
import * as pc from './views/postcard.js';

const main = document.getElementById('app');
let renderToken = 0;
let renderedPath = null;

// ---------- маршруты ----------
const routes = [
  [/^\/$/, pub.home],
  [/^\/library\/?$/, pub.library],
  [/^\/x\/([A-Za-z0-9_-]{16,40})\/?$/, xch.page],
  [/^\/play\/?$/, (ctx) => xch.playPage(ctx, null)],
  [/^\/postcard\/?$/, (ctx) => pc.postcard(ctx, null)],
  [/^\/postcard\/(DC-\d{4,6})\/?$/, pc.postcard],
  [/^\/play\/(DC-\d{4,6})\/?$/, xch.playPage],
  [/^\/bell\/?$/, xch.bellPage],
  [/^\/me\/exchanges\/?$/, xch.myExchanges],
  [/^\/me\/collections\/?$/, xch.myCollections],
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
  [/^\/facilitator\/quiz\/?$/, fac.quiz],
  [/^\/facilitator\/collections\/?$/, coll.list],
  [/^\/facilitator\/meetings\/?$/, fac.meetingsList],
  [/^\/facilitator\/c\/(\d+)\/?$/, coll.editor],
  [/^\/facilitator\/live\/(\d+)\/?$/, livePanel.panel],
  [/^\/facilitator\/m\/new\/?$/, fac.meetingEditor],
  [/^\/facilitator\/m\/(\d+)\/?$/, fac.meetingEditor],
  [/^\/group\/?$/, grp.choose],
  [/^\/group\/solo\/?$/, grp.solo],
  [/^\/g\/([A-Za-z0-9]{4,8})\/?$/, grp.room],
  [/^\/chats\/?$/, team.rooms],
  [/^\/chat\/?$/, (ctx) => ctx.navigate('/team/general', { replace: true })], // короткая ссылка для участников Zoom
  [/^\/me\/notifications\/?$/, notif.settings],
  [/^\/team\/(general|curators|facilitators)\/?$/, team.chat],
  [/^\/print\/?$/, team.print],
  [/^\/admin\/?$/, adm.overview],
  [/^\/admin\/(users|works|applications|meetings|cards|comments|criteria|guide|letters)\/?$/, adm.section],
];

const appPath = () => location.pathname.slice(BASE.length) || '/';

// Вверху внутренних страниц (19.11.2026) — слева домик (всегда на главную) и рядом стрелка «Назад», когда в приложении
// есть предыдущий экран: она возвращает туда, откуда пришли, с прежней прокруткой. Без текста — с доступными названиями.
// Если пришли извне, «Назад» ведёт к родительскому экрану (К играм, К чатам…), если он есть. Главная и встреча — без полосы.
const depth = () => (history.state && history.state.depth) || 0;
const PARENTS = [
  [/^\/g\//, '/group', 'К играм', 'To games'],
  [/^\/group\/solo/, '/library#play', 'К играм', 'To games'],
  [/^\/team\//, '/chats', 'К чатам', 'To chats'],
  [/^\/me\/notifications/, '/me', 'Профиль', 'Profile'],
  [/^\/me\/(exchanges|collections)/, '/me', 'Профиль', 'Profile'],
  [/^\/cards\//, '/library', 'Галерея', 'Gallery'],
  [/^\/m\/\d/, '/meetings', 'Ко встречам', 'To meetings'],
  [/^\/admin\/./, '/admin', 'Администрирование', 'Administration'],
  [/^\/facilitator\/apply/, '/facilitator/about', 'Провести встречу', 'Host a meeting'],
];
function addBackLink(path, ctx) {
  if (!ctx.alive() || path === '/' || document.body.classList.contains('live-mode') || main.querySelector('[data-back], [data-home]')) return;
  // у страницы своя ссылка «← …» наверху — её не дублируем стрелкой, остаётся домик
  const own = [...main.querySelectorAll('a, button')].slice(0, 4).some((x) => x.textContent.trim().startsWith('←'));
  const par = PARENTS.find(([re]) => re.test(path));
  let back = '';
  if (!own && depth() > 0) back = `<a class="nav-ic" data-back href="${u(par ? par[1] : '/')}" aria-label="${esc(tt('Назад', 'Back'))}" title="${esc(tt('Назад', 'Back'))}">${ic.arrowLeft}</a>`;
  else if (!own && par) back = `<a class="nav-ic" data-local href="${u(par[1])}" aria-label="${esc(tt(par[2], par[3]))}" title="${esc(tt(par[2], par[3]))}">${ic.arrowLeft}</a>`;
  main.insertAdjacentHTML('afterbegin', `<div class="wrap back-bar"><a class="nav-ic" data-home href="${u('/')}" aria-label="${esc(tt('На главную', 'Home'))}" title="${esc(tt('На главную', 'Home'))}">${ic.home}</a>${back}</div>`);
}
main.addEventListener('click', (e) => {
  const a = e.target.closest('[data-back]');
  if (a && depth() > 0) { e.preventDefault(); e.stopPropagation(); history.back(); }
}, true);

async function render() {
  const token = ++renderToken;
  renderedPath = location.pathname;
  document.body.classList.remove('has-choice-bar');
  renderChrome();
  const path = appPath();
  const ctx = {
    main, token, alive: () => token === renderToken, rerender: render, navigate,
    query: new URL(location.href).searchParams,
  };
  for (const [re, view] of routes) {
    const m = path.match(re);
    if (m) {
      try { await view(ctx, ...m.slice(1).map(decodeURIComponent)); addBackLink(path, ctx); if (location.hash && ctx.alive()) { const t = document.getElementById(decodeURIComponent(location.hash.slice(1))); if (t) t.scrollIntoView({ block: 'start' }); } } catch (e) { console.error(e); if (ctx.alive()) main.innerHTML = `<div class="wrap page"><p class="error-box">${esc(errorText(e))}</p></div>`; }
      return;
    }
  }
  main.innerHTML = `<div class="wrap page narrow"><h1>${esc(tt('Страница не найдена', 'Page not found'))}</h1><p><a href="${u('/')}">Dialogue Cards</a></p></div>`;
}

export function navigate(path, { replace = false } = {}) {
  const url = path.startsWith('http') ? path : u(path);
  if (!replace) try { history.replaceState({ ...(history.state || {}), scroll: window.scrollY }, ''); } catch { /* */ } // «Назад» вернёт на это место
  if (replace) history.replaceState({ depth: depth() }, '', url); else history.pushState({ depth: depth() + 1 }, '', url);
  render();
  window.scrollTo(0, 0);
}
window.dcNavigate = navigate;

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (e.defaultPrevented || !a || a.target || a.hasAttribute('download') || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
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
  if (location.pathname !== renderedPath) {
    const sy = history.state && history.state.scroll;
    render().then(() => { if (typeof sy === 'number') requestAnimationFrame(() => window.scrollTo(0, sy)); });
  }
});

// ---------- шапка, меню, подвал ----------
// Одна первая буква отображаемого имени: пробелы, скобки и знаки пропускаются («G(» → «G»). Нет имени — значок профиля.
function initial(name) { const m = String(name || '').match(/[\p{L}\p{N}]/u); return m ? m[0].toLocaleUpperCase() : ''; }
const avatar = (name) => initial(name) || ic.user;

// Непрочитанные в «Общении» (без push: считаются на сервере по последнему прочитанному сообщению).
let unreadAt = 0;
export async function refreshUnread(force = false) {
  const draw = () => document.querySelectorAll('[data-unread]').forEach((b) => { b.hidden = !session.unread; b.textContent = session.unread > 99 ? '99+' : String(session.unread || ''); b.setAttribute('aria-label', tt(`непрочитанных: ${session.unread}`, `unread: ${session.unread}`)); });
  if (!session.user) { session.unread = 0; draw(); return; }
  draw();
  if (!force && Date.now() - unreadAt < 30000) return;
  if (navigator.onLine === false) return;
  unreadAt = Date.now();
  try { const d = await api('/api/chats'); session.unread = d.rooms.reduce((n, r) => n + (r.unread || 0), 0); } catch { /* без счётчика */ }
  draw();
}
window.dcRefreshUnread = refreshUnread;

// ---------- колокольчик: отметка непрочитанного; обновление приложения ----------
let bellAt = 0; let loadedBuild = null; session.bellUnread = 0; session.update = false;
export async function refreshBell(force = false) {
  const bl = document.getElementById('bell'); const dot = bl && bl.querySelector('.bell-dot');
  const draw = () => { if (!dot) return; const n = session.bellUnread + (session.update ? 1 : 0); dot.hidden = !n; dot.textContent = n > 9 ? '9+' : String(n || '');
    bl.setAttribute('aria-label', n ? tt(`Уведомления, непрочитанных: ${n}`, `Notifications, unread: ${n}`) : tt('Уведомления', 'Notifications')); };
  draw();
  if (!force && Date.now() - bellAt < 20000) return;
  if (navigator.onLine === false) return; // без сети не опрашиваем — иначе в консоли копятся ERR_INTERNET_DISCONNECTED
  bellAt = Date.now();
  try { session.bellUnread = (await api('/api/bell')).unread; } catch { /* без отметки */ }
  try { const v = await api('/api/version'); if (!loadedBuild) loadedBuild = v.build; else if (v.build !== loadedBuild) session.update = true; } catch { /* */ }
  draw();
}
window.dcRefreshBell = refreshBell;
setInterval(() => document.visibilityState === 'visible' && refreshBell(), 60000);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refreshBell(true));
window.addEventListener('online', () => { refreshBell(true); refreshUnread(true); }); // сеть вернулась — обновляем сразу
// вход/выход в этой вкладке: данные гостя — в аккаунт (по согласию), после выхода — новый идентификатор браузера
window.addEventListener('dc-auth', async (e) => {
  if (e.detail.after) await personal.afterLogin(); else personal.afterLogout();
  refreshBell(true);
});

function renderChrome() {
  const p = appPath();
  const link = (href, ru, en, on) => `<a href="${u(href)}" class="${on ? 'on' : ''}">${esc(tt(ru, en))}</a>`;
  document.getElementById('nav').innerHTML =
    link('/library', 'Карты', 'Cards', p.startsWith('/library') || p.startsWith('/cards'))
    + link('/meetings', 'Встречи', 'Meetings', p.startsWith('/meetings') || p.startsWith('/m/'))
    + link('/start#join', 'Участвовать', 'Take part', p.startsWith('/start') || p.startsWith('/facilitator/about') || p.startsWith('/curator/apply'))
    + `<a href="${u('/chats')}" class="${p.startsWith('/chats') || p.startsWith('/team') ? 'on' : ''}">${esc(tt('Общение', 'Community'))}<span class="nav-badge" data-unread hidden></span></a>`;
  refreshUnread();
  const acct = document.getElementById('acct');
  // Одна круглая кнопка открывает полное меню — и с инициалом, и у гостя (там же «Войти»).
  acct.innerHTML = session.user
    ? `<button class="acct" type="button" data-menu aria-label="${esc(tt('Меню: ', 'Menu: ') + session.user.publicName)}" title="${esc(session.user.publicName)}"><span class="ava">${avatar(session.user.publicName)}</span></button>`
    : `<button class="signin-btn" type="button" data-menu aria-label="${esc(tt('Войти и меню', 'Sign in and menu'))}">${esc(tt('Войти', 'Sign in'))}</button>`;
  const bl = document.getElementById('bell');
  bl.setAttribute('aria-label', tt('Уведомления', 'Notifications')); bl.title = tt('Уведомления', 'Notifications');
  bl.classList.toggle('on', p.startsWith('/bell'));
  refreshBell();
  drawThemeBtn();
  const ls = document.getElementById('lang');
  ls.textContent = lang === 'ru' ? 'EN' : 'RU';
  ls.setAttribute('aria-label', lang === 'ru' ? 'Switch to English' : 'Переключить на русский');
  document.getElementById('foot').innerHTML = `<span>© Dialogue Cards · Dialogue Flow</span>
    <a href="${u('/start#join')}">${esc(tt('Участвовать в проекте', 'Take part in the project'))}</a>
    <a href="${u('/terms')}">${esc(tt('Условия публикации', 'Publication terms'))}</a>
    ${session.config.demoMode ? `<span>${esc(tt('Прототип в демо-режиме', 'Prototype in demo mode'))}</span>` : ''}`;
  const pill = document.getElementById('demo-pill');
  const demoOn = session.config.demoMode && (session.showDemo || (session.user && session.user.isDemo));
  pill.hidden = !demoOn;
  if (demoOn) pill.textContent = `${tt('ДЕМО', 'DEMO')} · ${session.user ? rolesText(session.user.roles) : tt('гость', 'guest')}`;
}
// ---------- тема: две глобальные, переключатель в шапке ----------
const THEME_ICON = {
  light: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
};
const currentTheme = () => document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
function drawThemeBtn() {
  const b = document.getElementById('theme'); const next = currentTheme() === 'dark' ? 'light' : 'dark';
  const label = next === 'light' ? tt('Включить светлую тему', 'Switch to light theme') : tt('Включить тёмную тему', 'Switch to dark theme');
  b.innerHTML = THEME_ICON[next]; b.setAttribute('aria-label', label); b.title = label;
}
document.getElementById('theme').addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('dc_theme', next); } catch { /* без сохранения — тема до перезагрузки */ }
  const tc = document.querySelector('meta[name="theme-color"]'); if (tc) tc.setAttribute('content', next === 'light' ? '#f5f5f2' : '#060c1e');
  drawThemeBtn();
});
document.getElementById('lang').addEventListener('click', () => { setLang(lang === 'ru' ? 'en' : 'ru'); if (isViewerOpen()) closeViewer(); render(); });
document.getElementById('demo-pill').addEventListener('click', openMenu);
document.getElementById('acct').addEventListener('click', (e) => { if (e.target.closest('[data-menu]')) openMenu(); });

function mi(href, icon, ru, en, noteRu = '', noteEn = '', hl = false, badge = '') {
  return `<a class="mi ${hl ? 'hl' : ''}" href="${u(href)}"><span class="ic">${icon}</span><span><b>${esc(tt(ru, en))}</b>${noteRu ? `<small>${esc(tt(noteRu, noteEn))}</small>` : ''}</span>${badge ? `<span class="badge">${esc(badge)}</span>` : ''}</a>`;
}
function openMenu() {
  const opener = document.activeElement;
  closeMenu();
  const s = session.user;
  const el = document.createElement('div');
  el.className = 'sheet-menu'; el.id = 'sheet-menu';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
  // Рабочие кабинеты — только те, что доступны этому человеку. Администратор входит через обычный вход; в демо его кнопка — на экране «Демо-роли».
  const cabinets = [];
  if (s) {
    if (hasRole('artist')) cabinets.push(mi('/artist', ic.brush, 'Кабинет художника', 'Artist space'));
    if (hasRole('facilitator')) cabinets.push(mi('/facilitator', ic.qr, 'Кабинет фасилитатора', 'Facilitator space'));
    if (hasRole('curator')) cabinets.push(mi('/curator', ic.check, 'Кабинет куратора', 'Curator space'));
  }
  const demoRoles = [['guest', 'Участник', 'Participant'], ['artist', 'Художник', 'Artist'], ['curator', 'Куратор', 'Curator'], ['facilitator', 'Фасилитатор', 'Facilitator']];
  el.innerHTML = `<div class="panel" aria-label="${esc(tt('Меню', 'Menu'))}">
    <div class="head">
      ${s ? `<span class="ava">${avatar(s.publicName)}</span><div class="who"><b>${esc(s.publicName)}</b><span>${esc(rolesText(s.roles))}${s.isDemo ? ' · ' + esc(tt('демо', 'demo')) : ''}</span></div>`
        : `<div class="who"><b>Dialogue Cards</b><span>${esc(tt('Иллюстрации для живого разговора', 'Illustrations for real conversation'))}</span></div>`}
      <button class="icon-btn" type="button" data-close aria-label="${esc(tt('Закрыть', 'Close'))}">${ic.close}</button>
    </div>
    ${mi('/library', ic.cards, 'Галерея карт', 'Card gallery')}
    ${mi('/library#play', ic.dice, 'Играть', 'Play')}
    ${mi('/meetings', ic.calendar, 'Встречи Dialogue Flow', 'Dialogue Flow meetings')}
    ${mi('/start#join', ic.people, 'Участвовать', 'Take part')}
    ${mi('/chats', ic.chats, 'Общение в чатах', 'Chats', '', '', false, session.unread ? String(session.unread) : '')}
    ${s ? `${cabinets.length ? `<div class="sec">${esc(tt('Мои кабинеты', 'My spaces'))}</div>${cabinets.join('')}` : ''}
      <div class="sec">${esc(tt('Аккаунт', 'Account'))}</div>
      ${mi('/me', ic.user, 'Профиль', 'Profile')}
      ${mi('/me/exchanges', ic.chats, 'Мои обмены', 'My exchanges')}
      ${mi('/me/collections', ic.cards, 'Мои подборки', 'My collections')}
      ${mi('/me/notifications', ic.bell, 'Уведомления', 'Notifications')}
      ${hasRole('admin') ? mi('/admin', ic.shield, 'Администрирование', 'Administration', '', '', true) : ''}`
    : `<div class="sec">${esc(tt('Этот браузер', 'This browser'))}</div>${mi('/me/exchanges', ic.chats, 'Мои обмены', 'My exchanges')}${mi('/me/collections', ic.cards, 'Мои подборки', 'My collections')}
      <div class="sec">${esc(tt('Вход', 'Sign in'))}</div>${mi('/login', ic.user, 'Войти', 'Sign in', '', '', true)}`}
    ${session.config.demoMode ? `<div class="demo-box">
      <p>${esc(tt('Демо-режим прототипа: войдите под тестовой ролью, чтобы пройти её путь. Права проверяются на сервере. Демо-данные помечены и не смешиваются с настоящими.', 'Prototype demo mode: sign in as a test role to walk through its path. Permissions are checked on the server. Demo data is labelled and kept apart from real data.'))}</p>
      <div class="chips">${demoRoles.map(([k, ru, en]) => `<button class="chip" type="button" data-demo="${k}">${esc(tt(ru, en))}</button>`).join('')}</div>
      <a class="small" href="${u('/demo')}">${esc(tt('Все демо-роли →', 'All demo roles →'))}</a>
    </div>` : ''}
    ${s ? `<button class="btn light sm" type="button" data-logout style="margin-top:14px">${esc(tt('Выйти', 'Sign out'))}</button>` : ''}
  </div>`;
  document.body.appendChild(el); document.body.classList.add('no-scroll');
  menuFeel(el);
  el.addEventListener('click', async (e) => {
    if (e.target === el || e.target.closest('[data-close]')) { closeMenu(); return; }
    const d = e.target.closest('[data-demo]');
    if (d) {
      try { await api('/api/demo/login', { method: 'POST', body: { as: d.dataset.demo } }); await refreshSession(); closeMenu(); toast(tt('Вы вошли как: ', 'Signed in as: ') + session.user.publicName); navigate(homeFor()); }
      catch (err) { toast(errorText(err)); }
    }
    if (e.target.closest('[data-logout]')) { skipSiteAutoLogin(); await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); await refreshSession(); closeMenu(); navigate('/'); refreshBell(); }
  });
  // Escape закрывает; Tab не уходит из меню на страницу под ним; после закрытия фокус возвращается к кнопке.
  const onKey = (e) => {
    if (e.key === 'Escape') { closeMenu(); return; }
    if (e.key !== 'Tab') return;
    const f = [...el.querySelectorAll('a[href], button:not([disabled])')]; if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  };
  document.addEventListener('keydown', onKey);
  el._off = () => document.removeEventListener('keydown', onKey);
  el._opener = opener;
  el.querySelector('[data-close]').focus();
}
// новое поведение (скилл apple-design, vendor/hk-feel; прежнее — html[data-feel="old"]): меню выезжает справа на пружине,
// затемнение идёт вместе с ним, смахивание вправо закрывает (бросок по скорости), уходит тем же путём вправо
function menuFeel(el) {
  const F = window.HKFeel;
  if (!F || !F.on() || F.reduced()) return;
  const panel = el.querySelector('.panel');
  let x = 0, anim = null, drag = null;
  const W = () => panel.getBoundingClientRect().width || 360;
  const paint = (v) => { x = v; panel.style.transform = `translate3d(${v.toFixed(1)}px,0,0)`; el.style.setProperty('--menu-a', String(Math.max(0, 1 - v / W()))); };
  const to = (target, vel, done) => { if (anim) anim.stop(); anim = F.spring({ from: x, to: target, velocity: vel || 0, response: vel ? 0.3 : 0.36, damping: 1, onUpdate: paint, onDone: () => { anim = null; if (done) done(); } }); };
  el.classList.add('menu-feel');
  paint(W()); to(0);
  panel.style.touchAction = 'pan-y';
  panel.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') return; drag = { x0: e.clientX, y0: e.clientY, base: x, on: false, h: [[e.clientX, e.timeStamp]] }; if (anim) { anim.stop(); anim = null; } });
  panel.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.on) { if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { drag = null; return; } if (dx < 10) return; drag.on = true; drag.x0 = e.clientX; panel.setPointerCapture(e.pointerId); }
    const raw = drag.base + (e.clientX - drag.x0);
    paint(raw < 0 ? -F.rubber(-raw, W()) : raw);
    drag.h.push([e.clientX, e.timeStamp]); while (drag.h.length > 2 && e.timeStamp - drag.h[0][1] > 100) drag.h.shift();
  });
  const up = (e) => {
    const d = drag; drag = null; if (!d || !d.on) return;
    const h = d.h; let v = 0;
    if (h.length > 1 && e.timeStamp - h[h.length - 1][1] < 80 && h[h.length - 1][1] > h[0][1]) v = (h[h.length - 1][0] - h[0][0]) / (h[h.length - 1][1] - h[0][1]) * 1000;
    if (x + F.project(v) > W() * 0.4) closeMenu(v); else to(0, v);
  };
  panel.addEventListener('pointerup', up); panel.addEventListener('pointercancel', up);
  el._feelClose = (vel, done) => to(W(), vel, done);
}
function closeMenu(vel) {
  const el = document.getElementById('sheet-menu');
  if (el && el._feelClose && !el._closing && window.HKFeel && window.HKFeel.on()) {
    el._closing = true; el.style.pointerEvents = 'none'; el.removeAttribute('id');
    el._off && el._off(); document.body.classList.remove('no-scroll');
    el._feelClose(typeof vel === 'number' ? vel : 0, () => el.remove());
    const back = el._opener && document.contains(el._opener) ? el._opener : document.querySelector('#acct [data-menu]');
    if (back && getComputedStyle(back).display !== 'none') back.focus({ preventScroll: true });
    return;
  }
  if (el) {
    el._off && el._off(); el.remove(); document.body.classList.remove('no-scroll');
    const back = el._opener && document.contains(el._opener) ? el._opener : document.querySelector('#acct [data-menu]');
    if (back && getComputedStyle(back).display !== 'none') back.focus({ preventScroll: true });
  }
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

(async () => { await refreshSession(); render(); if (session.user) setTimeout(syncPush, 1500); })();
