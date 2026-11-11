import { t, lang, setLang, monthLabel } from './i18n.js';
import { esc, api, errorText, storage, visitorId, toast } from './util.js';
import { openViewer, isViewerOpen, handleViewerPopState, refreshViewer, icons } from './viewer.js';

const main = document.getElementById('app');
const session = { admin: false, devPassword: false };
let renderToken = 0;
let renderedPath = null;

// ---------- маршрутизация ----------
const routes = [
  [/^\/$/, viewHome],
  [/^\/library\/?$/, viewLibrary],
  [/^\/s\/([a-z0-9]{4,32})\/?$/, viewCollection],
  [/^\/meetings\/?$/, viewMeetings],
  [/^\/admin\/?$/, (tok) => adminGate(tok, viewAdminCollections)],
  [/^\/admin\/cards\/?$/, (tok) => adminGate(tok, viewAdminCards)],
  [/^\/admin\/c\/(\d+)\/?$/, (tok, id) => adminGate(tok, (tk) => viewAdminEditor(tk, id))],
];

function render() {
  const token = ++renderToken;
  renderedPath = location.pathname;
  renderChrome();
  const path = location.pathname;
  for (const [re, view] of routes) {
    const m = path.match(re);
    if (m) { view(token, ...m.slice(1)); return; }
  }
  main.innerHTML = `<section class="page narrow"><h1>${esc(t('err.notFound'))}</h1><p><a href="/" data-link>Dialogue Cards</a></p></section>`;
}
const alive = (token) => token === renderToken;

export function navigate(url, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', url); else history.pushState({}, '', url);
  render();
  window.scrollTo(0, 0);
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || a.target || a.hasAttribute('download') || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) return;
  e.preventDefault();
  navigate(url.pathname + url.search);
});

window.addEventListener('popstate', () => {
  handleViewerPopState();
  if (location.pathname !== renderedPath) render();
});

function renderChrome() {
  const nav = document.getElementById('main-nav');
  const p = location.pathname;
  const link = (href, key, active) => `<a href="${href}" data-link class="${active ? 'is-active' : ''}">${esc(t(key))}</a>`;
  nav.innerHTML = link('/library', 'nav.library', p.startsWith('/library'))
    + link('/meetings', 'nav.meetings', p.startsWith('/meetings'))
    + (session.admin ? link('/admin', 'nav.admin', p.startsWith('/admin')) : '');
  const sw = document.getElementById('lang-switch');
  sw.textContent = t('lang.switch');
  sw.setAttribute('aria-label', t('lang.switchLabel'));
  document.getElementById('site-footer').innerHTML = `
    <span>© Dialogue Cards</span>
    ${session.admin ? '' : `<a href="/admin" data-link>${esc(t('admin.signIn'))}</a>`}`;
}
document.getElementById('lang-switch').addEventListener('click', () => {
  setLang(lang === 'ru' ? 'en' : 'ru');
  if (isViewerOpen()) history.back();
  render();
});

function loading() { main.innerHTML = `<p class="page loading">${esc(t('common.loading'))}</p>`; }
function failed(token, e, retry) {
  if (!alive(token)) return;
  main.innerHTML = `<section class="page narrow"><p class="error-box">${esc(errorText(e))}</p>
    <button class="btn" type="button" id="retry">${esc(t('common.retry'))}</button></section>`;
  document.getElementById('retry').addEventListener('click', retry);
}

// ---------- сетка карт ----------
function tileHtml(c, i, { extraClass = '', badge = '', label = '' } = {}) {
  return `<button class="tile ${extraClass}" type="button" data-i="${i}" aria-label="${esc(label || c.code)}">
      <img src="${esc(c.thumb)}" alt="" loading="lazy" decoding="async" width="${c.width}" height="${c.height}" style="aspect-ratio:${c.width}/${c.height}">
      ${badge}
    </button>`;
}
function openFromQuery(cards, openAt) {
  const code = new URL(location.href).searchParams.get('card');
  if (!code) return;
  const i = cards.findIndex((c) => c.code === code);
  if (i >= 0) openAt(i); else history.replaceState({}, '', location.pathname);
}

// ---------- главная ----------
async function viewHome(token) {
  main.innerHTML = `
    <section class="hero">
      <div class="hero-text">
        <img class="hero-logo" src="/img/logo-gold.webp" alt="Dialogue Cards" width="900" height="393">
        ${session.admin ? `<p class="draft-note">${esc(t('home.draft'))}</p>` : ''}
        <h1>${esc(t('home.title'))}</h1>
        <p class="lead">${esc(t('home.lead'))}</p>
        <div class="actions">
          <a class="btn btn--gold" href="/library" data-link>${esc(t('home.ctaLibrary'))}</a>
          <a class="btn" href="/meetings" data-link>${esc(t('home.ctaMeetings'))}</a>
        </div>
      </div>
      <div class="hero-fan" id="hero-fan" aria-hidden="true"></div>
    </section>
    <section class="page how">
      <h2>${esc(t('home.howTitle'))}</h2>
      <ol class="steps">
        <li><span>1</span><p>${esc(t('home.how1'))}</p></li>
        <li><span>2</span><p>${esc(t('home.how2'))}</p></li>
        <li><span>3</span><p>${esc(t('home.how3'))}</p></li>
      </ol>
    </section>
    <section class="page flow">
      <div class="flow-card">
        <img class="flow-logo" src="/img/logo-white.webp" alt="" width="900" height="434">
        <h2>${esc(t('home.flowTitle'))}</h2>
        <p>${esc(t('home.flowText'))}</p>
        <p class="muted">${esc(t('home.platform'))}</p>
      </div>
    </section>`;
  try {
    const { cards } = await api('/api/cards');
    if (!alive(token) || !cards.length) return;
    const picks = [];
    const pool = [...cards];
    while (picks.length < 3 && pool.length) picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    document.getElementById('hero-fan').innerHTML = picks.map((c, i) =>
      `<img class="fan-card fan-card--${i}" src="${esc(c.thumb)}" alt="" width="${c.width}" height="${c.height}">`).join('');
  } catch { /* веер карт — украшение, без него страница работает */ }
}

// ---------- библиотека ----------
async function viewLibrary(token) {
  loading();
  let cards;
  try { ({ cards } = await api('/api/cards')); } catch (e) { return failed(token, e, render); }
  if (!alive(token)) return;
  const groups = [];
  for (const [i, c] of cards.entries()) {
    const label = monthLabel(c.publishedAt);
    if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, items: [] });
    groups[groups.length - 1].items.push([c, i]);
  }
  main.innerHTML = `
    <section class="page">
      <header class="page-head">
        <h1>${esc(t('library.title'))}</h1>
        <p class="muted">${esc(t('library.count', { n: cards.length }))} · ${esc(t('library.lead'))}</p>
      </header>
      ${cards.length ? groups.map((g) => `
        <section class="month">
          <h2 class="month-title">${esc(g.label)}</h2>
          <div class="grid">${g.items.map(([c, i]) => tileHtml(c, i)).join('')}</div>
        </section>`).join('') : `<p class="muted">${esc(t('library.empty'))}</p>`}
    </section>`;
  const openAt = (i) => openViewer({ cards, index: i, mode: 'library' });
  main.querySelectorAll('.tile').forEach((b) => b.addEventListener('click', () => openAt(Number(b.dataset.i))));
  openFromQuery(cards, openAt);
}

// ---------- подборка для участника ----------
async function viewCollection(token, slug) {
  loading();
  let col;
  try { col = await api(`/api/c/${slug}`); } catch (e) {
    if (!alive(token)) return;
    if (e.status === 404) { main.innerHTML = `<section class="page narrow"><p class="error-box">${esc(t('col.notFound'))}</p></section>`; return; }
    return failed(token, e, render);
  }
  if (!alive(token)) return;
  const vid = visitorId();
  const roundKey = `dc_round_${slug}`;
  const st = { selections: [], counts: {}, round: Math.max(1, Number(storage.get(roundKey)) || 1) };
  const applyState = (s) => {
    st.selections = s.selections || [];
    st.counts = { ...st.counts, ...(s.counts || {}) };
    const maxRound = st.selections.reduce((m, x) => Math.max(m, x.round), 1);
    st.round = Math.max(st.round, maxRound);
    storage.set(roundKey, String(st.round));
  };
  const choiceIn = (round) => (st.selections.find((x) => x.round === round) || {}).code || null;

  try { applyState(await api(`/api/c/${slug}/visit`, { method: 'POST', body: { visitorId: vid } })); } catch { /* выбор можно сделать и без этого */ }
  if (!alive(token)) return;

  const cards = col.cards;
  main.innerHTML = `
    <section class="page collection">
      <header class="page-head">
        <p class="eyebrow">${esc(t('col.badge'))}${col.isTest ? ` · <span class="pill">${esc(t('col.test'))}</span>` : ''}</p>
        <h1>${esc(col.title)}</h1>
        <p class="muted">${esc(t('col.hint'))}</p>
      </header>
      ${cards.length ? '<div class="grid grid--collection" id="col-grid"></div>' : `<p class="muted">${esc(t('col.empty'))}</p>`}
      <p class="save-note">${esc(t('col.saveNote'))}</p>
    </section>
    <div class="choice-bar" id="choice-bar"></div>`;
  const grid = document.getElementById('col-grid');
  const bar = document.getElementById('choice-bar');

  function drawGrid() {
    if (!grid) return;
    const current = choiceIn(st.round);
    grid.innerHTML = cards.map((c, i) => {
      const earlier = st.selections.filter((x) => x.code === c.code && x.round !== st.round).map((x) => x.round);
      let badge = '';
      if (c.code === current) badge = `<span class="tile-check">${icons.check}</span>`;
      else if (earlier.length) badge = `<span class="tile-round">${earlier.join(', ')}</span>`;
      return tileHtml(c, i, { extraClass: c.code === current ? 'is-chosen' : '', badge });
    }).join('');
  }
  function drawBar() {
    const current = choiceIn(st.round);
    const card = cards.find((c) => c.code === current);
    const roundLabel = st.round > 1 || st.selections.length ? `<span class="bar-round">${esc(t('col.round', { n: st.round }))}</span>` : '';
    bar.innerHTML = card ? `
        <button class="bar-thumb" type="button" data-open="${esc(card.code)}"><img src="${esc(card.thumb)}" alt=""></button>
        <div class="bar-text"><strong>${esc(t('col.yourChoice'))}</strong>${roundLabel}</div>
        <button class="btn btn--small" type="button" data-next-round>${esc(t('col.nextRound'))}</button>`
      : `<div class="bar-text"><span class="muted">${esc(t('col.noChoice'))}</span>${roundLabel}</div>`;
    bar.classList.toggle('has-choice', !!card);
  }
  const redraw = () => { drawGrid(); drawBar(); refreshViewer(); };

  const collectionApi = {
    isTest: col.isTest,
    state: () => ({ choice: choiceIn(st.round), round: st.round }),
    countFor: (code) => st.counts[code],
    async choose(code) {
      try {
        applyState(await api(`/api/c/${slug}/select`, { method: 'POST', body: { visitorId: vid, code, round: st.round } }));
        toast(t('col.saved'));
      } catch (e) { toast(errorText(e)); }
      redraw();
    },
    async cancel() {
      try {
        applyState(await api(`/api/c/${slug}/unselect`, { method: 'POST', body: { visitorId: vid, round: st.round } }));
        toast(t('col.cancelled'));
      } catch (e) { toast(errorText(e)); }
      redraw();
    },
  };
  const openAt = (i) => openViewer({ cards, index: i, mode: 'collection', collection: collectionApi });
  if (grid) grid.addEventListener('click', (e) => { const b = e.target.closest('.tile'); if (b) openAt(Number(b.dataset.i)); });
  bar.addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    if (open) openAt(cards.findIndex((c) => c.code === open.dataset.open));
    if (e.target.closest('[data-next-round]') && confirm(t('col.nextRoundConfirm'))) {
      st.round = Math.min(st.round + 1, 20);
      storage.set(roundKey, String(st.round));
      redraw();
      toast(t('col.roundStarted', { n: st.round }));
    }
  });
  redraw();
  openFromQuery(cards, openAt);
}

// ---------- встречи ----------
function viewMeetings() {
  main.innerHTML = `
    <section class="page narrow">
      <h1>${esc(t('meetings.title'))}</h1>
      <p class="lead">${esc(t('meetings.text'))}</p>
    </section>`;
}

// ---------- управление ----------
async function adminGate(token, view) {
  if (!session.admin) {
    try { Object.assign(session, await api('/api/admin/me')); } catch (e) { return failed(token, e, render); }
    if (!alive(token)) return;
    renderChrome();
  }
  if (session.admin) return view(token);
  main.innerHTML = `
    <section class="page narrow">
      <h1>${esc(t('admin.loginTitle'))}</h1>
      <form class="form" id="login">
        <label>${esc(t('admin.password'))}<input type="password" name="password" autocomplete="current-password" required></label>
        <button class="btn btn--gold" type="submit">${esc(t('admin.signIn'))}</button>
        <p class="form-error" id="login-error" role="alert"></p>
        ${session.devPassword ? `<p class="muted small">${esc(t('admin.devHint'))}</p>` : ''}
      </form>
    </section>`;
  document.getElementById('login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = e.target.password.value;
    try {
      await api('/api/admin/login', { method: 'POST', body: { password } });
      session.admin = true;
      render();
    } catch (err) {
      document.getElementById('login-error').textContent = err.code === 'too_many_attempts' ? t('admin.tooMany')
        : err.code === 'wrong_password' ? t('admin.wrongPassword') : errorText(err);
    }
  });
}

function adminTabs(active) {
  return `<nav class="tabs">
      <a href="/admin" data-link class="${active === 'cols' ? 'is-active' : ''}">${esc(t('admin.tabCollections'))}</a>
      <a href="/admin/cards" data-link class="${active === 'cards' ? 'is-active' : ''}">${esc(t('admin.tabCards'))}</a>
      <button class="link-btn" type="button" id="logout">${esc(t('admin.logout'))}</button>
    </nav>`;
}
function bindLogout() {
  document.getElementById('logout').addEventListener('click', async () => {
    try { await api('/api/admin/logout', { method: 'POST' }); } catch { /* всё равно выходим */ }
    session.admin = false;
    navigate('/');
  });
}

async function viewAdminCollections(token) {
  loading();
  let data;
  try { data = await api('/api/admin/collections'); } catch (e) { return failed(token, e, render); }
  if (!alive(token)) return;
  main.innerHTML = `
    <section class="page">
      ${adminTabs('cols')}
      <header class="page-head"><h1>${esc(t('cols.title'))}</h1><p class="muted">${esc(t('cols.lead'))}</p></header>
      <form class="inline-form" id="new-col">
        <input name="title" maxlength="120" placeholder="${esc(t('cols.newPlaceholder'))}" aria-label="${esc(t('ed.titleLabel'))}">
        <button class="btn btn--gold" type="submit">${esc(t('cols.create'))}</button>
      </form>
      ${data.collections.length ? `<ul class="col-list">${data.collections.map((c) => `
        <li><a href="/admin/c/${c.id}" data-link>
          <strong>${esc(c.title)}</strong>
          ${c.isTest ? `<span class="pill">${esc(t('col.test'))}</span>` : ''}
          <span class="muted small">${esc(t('cols.cards', { n: c.cardCount }))} · ${esc(t('cols.visitors', { n: c.visitors }))} · ${esc(t('cols.selections', { n: c.selections }))}${c.unavailableCount ? ` · <span class="warn">${esc(t('cols.unavailable', { n: c.unavailableCount }))}</span>` : ''}</span>
          <span class="muted small mono">/s/${esc(c.slug)}</span>
        </a></li>`).join('')}</ul>` : `<p class="muted">${esc(t('cols.empty'))}</p>`}
    </section>`;
  bindLogout();
  document.getElementById('new-col').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { id } = await api('/api/admin/collections', { method: 'POST', body: { title: e.target.title.value } });
      navigate(`/admin/c/${id}`);
    } catch (err) { toast(errorText(err)); }
  });
}

async function viewAdminEditor(token, id) {
  loading();
  let detail; let library;
  try {
    [detail, { cards: library }] = await Promise.all([api(`/api/admin/collections/${id}`), api('/api/cards')]);
  } catch (e) {
    if (!alive(token)) return;
    if (e.status === 404) { main.innerHTML = `<section class="page narrow"><p class="error-box">${esc(t('ed.notFound'))}</p><a href="/admin" data-link>${esc(t('ed.back'))}</a></section>`; return; }
    return failed(token, e, render);
  }
  if (!alive(token)) return;
  const MAX = 40;
  const known = new Map(detail.cards.map((c) => [c.code, c]));
  for (const c of library) if (!known.has(c.code)) known.set(c.code, { ...c, status: 'published', selections: 0 });
  let codes = detail.cards.map((c) => c.code);
  const isAvailable = (code) => known.get(code)?.status === 'published';

  main.innerHTML = `
    <section class="page editor">
      <a class="back" href="/admin" data-link>${esc(t('ed.back'))}</a>
      <div class="editor-head">
        <label class="title-field"><span class="sr-only">${esc(t('ed.titleLabel'))}</span>
          <input id="ed-title" value="${esc(detail.title)}" maxlength="120"></label>
        <span class="save-status" id="save-status" aria-live="polite"></span>
      </div>
      <div class="share">
        <label class="share-link"><span class="small muted">${esc(t('ed.link'))}</span>
          <input id="ed-url" readonly value="${esc(detail.url)}"></label>
        <div class="share-actions">
          <button class="btn btn--small" type="button" id="ed-copy">${esc(t('ed.copy'))}</button>
          <button class="btn btn--small btn--gold" type="button" id="ed-qr">${esc(t('ed.showQr'))}</button>
          <a class="btn btn--small" href="/api/c/${esc(detail.slug)}/qr.png?size=1600&download=1" download>${esc(t('ed.downloadQr'))}</a>
          <a class="btn btn--small" href="/s/${esc(detail.slug)}" target="_blank" rel="noopener">${esc(t('ed.openAsParticipant'))}</a>
        </div>
        <p class="small muted">${esc(t('ed.liveNote'))}</p>
      </div>
      <label class="check"><input type="checkbox" id="ed-test" ${detail.isTest ? 'checked' : ''}>
        <span><strong>${esc(t('ed.test'))}</strong> — ${esc(t('ed.testHint'))}</span></label>
      <p class="small muted">${esc(t('ed.visitors', { n: detail.visitors }))}</p>

      <h2 id="ed-count"></h2>
      <div id="ed-unavailable"></div>
      <div class="grid grid--editor" id="ed-selected"></div>

      <h2>${esc(t('ed.library'))}</h2>
      <p class="muted small" id="ed-lib-hint"></p>
      <div class="grid grid--editor" id="ed-library"></div>

      <button class="btn btn--danger" type="button" id="ed-delete">${esc(t('ed.delete'))}</button>
    </section>`;
  bindAdminEditor();

  function bindAdminEditor() {
    const $ = (s) => document.getElementById(s);
    const status = $('save-status');
    let saveTimer; let saving = Promise.resolve();
    const setStatus = (key, cls = '') => { status.textContent = key ? t(key) : ''; status.className = `save-status ${cls}`; };

    function draw() {
      const available = codes.filter(isAvailable);
      const unavailable = codes.filter((c) => !isAvailable(c));
      $('ed-count').textContent = t('ed.inCollection', { n: available.length, max: MAX });
      $('ed-unavailable').innerHTML = unavailable.length ? `
        <div class="notice"><strong>${esc(t('ed.unavailableTitle'))}: ${unavailable.map(esc).join(', ')}</strong>
          <p>${esc(t('ed.unavailableText'))}</p>
          <button class="btn btn--small" type="button" id="ed-drop-unavail">${esc(t('ed.removeUnavailable'))}</button></div>` : '';
      $('ed-selected').innerHTML = available.length ? available.map((code) => {
        const c = known.get(code);
        return `<div class="ed-tile">
            <button class="tile" type="button" data-view="${esc(code)}" aria-label="${esc(t('ed.view'))} ${esc(code)}">
              <img src="${esc(c.thumb)}" alt="" loading="lazy" style="aspect-ratio:${c.width}/${c.height}"></button>
            <button class="tile-remove" type="button" data-remove="${esc(code)}" aria-label="${esc(t('ed.remove'))} ${esc(code)}">${icons.x}</button>
            <span class="tile-caption">${esc(code)}${c.selections ? ` · ${esc(t('ed.statSel', { n: c.selections }))}` : ''}</span>
          </div>`;
      }).join('') : `<p class="muted">${esc(t('ed.emptyCollection'))}</p>`;
      const full = codes.length >= MAX;
      $('ed-lib-hint').textContent = full ? t('ed.full', { max: MAX }) : t('ed.libraryHint');
      $('ed-library').innerHTML = library.map((c) => {
        const inCol = codes.includes(c.code);
        return `<div class="ed-tile ${inCol ? 'is-in' : ''} ${!inCol && full ? 'is-disabled' : ''}">
            <button class="tile" type="button" data-toggle="${esc(c.code)}" aria-pressed="${inCol}" ${!inCol && full ? 'disabled' : ''} aria-label="${esc(c.code)}">
              <img src="${esc(c.thumb)}" alt="" loading="lazy" style="aspect-ratio:${c.width}/${c.height}">
              ${inCol ? `<span class="tile-check">${icons.check}</span>` : ''}
            </button>
            <button class="tile-view" type="button" data-view="${esc(c.code)}" aria-label="${esc(t('ed.view'))} ${esc(c.code)}">${icons.expand}</button>
            <span class="tile-caption">${esc(c.code)}</span>
          </div>`;
      }).join('');
      const drop = $('ed-drop-unavail');
      if (drop) drop.addEventListener('click', () => { codes = codes.filter(isAvailable); draw(); scheduleSave(); });
    }

    function scheduleSave() {
      setStatus('ed.saving');
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const body = { codes: [...codes] };
        saving = saving.then(() => api(`/api/admin/collections/${id}/cards`, { method: 'PUT', body }))
          .then(() => setStatus('ed.saved', 'is-ok'))
          .catch(() => { setStatus('ed.saveError', 'is-error'); });
      }, 350);
    }
    status.addEventListener('click', () => { if (status.classList.contains('is-error')) scheduleSave(); });

    const viewCards = (code, fromSelected) => {
      const list = fromSelected ? codes.filter(isAvailable).map((c) => known.get(c)) : library;
      openViewer({ cards: list, index: Math.max(0, list.findIndex((c) => c.code === code)), mode: 'admin' });
    };

    main.querySelector('.editor').addEventListener('click', (e) => {
      const tog = e.target.closest('[data-toggle]');
      const rem = e.target.closest('[data-remove]');
      const view = e.target.closest('[data-view]');
      if (tog) {
        const code = tog.dataset.toggle;
        if (codes.includes(code)) codes = codes.filter((c) => c !== code);
        else if (codes.length < MAX) codes.push(code);
        draw(); scheduleSave();
      } else if (rem) {
        codes = codes.filter((c) => c !== rem.dataset.remove); draw(); scheduleSave();
      } else if (view) viewCards(view.dataset.view, !!view.closest('#ed-selected'));
    });

    $('ed-title').addEventListener('change', async (e) => {
      setStatus('ed.saving');
      try { await api(`/api/admin/collections/${id}`, { method: 'PATCH', body: { title: e.target.value } }); setStatus('ed.saved', 'is-ok'); }
      catch { setStatus('ed.saveError', 'is-error'); }
    });
    $('ed-test').addEventListener('change', async (e) => {
      setStatus('ed.saving');
      try { await api(`/api/admin/collections/${id}`, { method: 'PATCH', body: { isTest: e.target.checked } }); setStatus('ed.saved', 'is-ok'); }
      catch { setStatus('ed.saveError', 'is-error'); }
    });
    $('ed-copy').addEventListener('click', async () => {
      const input = $('ed-url');
      try { await navigator.clipboard.writeText(input.value); } catch { input.select(); document.execCommand('copy'); }
      toast(t('ed.copied'));
    });
    $('ed-qr').addEventListener('click', () => showQr(detail.slug, $('ed-title').value, detail.url));
    $('ed-delete').addEventListener('click', async () => {
      if (!confirm(t('ed.deleteConfirm', { title: $('ed-title').value }))) return;
      try { await api(`/api/admin/collections/${id}`, { method: 'DELETE' }); navigate('/admin'); } catch (err) { toast(errorText(err)); }
    });
    draw();
  }
}

function showQr(slug, title, url) {
  const el = document.createElement('div');
  el.className = 'qr-overlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `
    <button class="icon-btn qr-close" type="button" aria-label="${esc(t('qr.close'))}">${icons.close}</button>
    <img class="qr-logo" src="/img/emblem-black.webp" alt="">
    <h2>${esc(title)}</h2>
    <img class="qr-img" src="/api/c/${esc(slug)}/qr.svg" alt="QR">
    <p class="qr-url">${esc(url.replace(/^https?:\/\//, ''))}</p>
    <p class="muted">${esc(t('qr.hint'))}</p>`;
  document.body.appendChild(el);
  document.body.classList.add('no-scroll');
  const close = () => { el.remove(); document.body.classList.remove('no-scroll'); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  el.querySelector('.qr-close').addEventListener('click', close);
  el.querySelector('.qr-close').focus();
}

async function viewAdminCards(token) {
  loading();
  let cards;
  try { ({ cards } = await api('/api/admin/cards')); } catch (e) { return failed(token, e, render); }
  if (!alive(token)) return;
  const sortKey = storage.get('dc_admin_sort') || 'number';
  main.innerHTML = `
    <section class="page">
      ${adminTabs('cards')}
      <header class="page-head"><h1>${esc(t('cards.title'))}</h1></header>
      <div class="panels">
        <form class="panel form" id="upload">
          <h2>${esc(t('cards.uploadTitle'))}</h2>
          <p class="small muted">${esc(t('cards.uploadHint'))}</p>
          <label>${esc(t('cards.files'))}<input type="file" name="images" accept="image/jpeg,image/png,image/webp,image/tiff" multiple required></label>
          <label>${esc(t('cards.author'))}<input name="author" maxlength="200"></label>
          <button class="btn btn--gold" type="submit">${esc(t('cards.upload'))}</button>
        </form>
        <form class="panel form" id="bulk-author">
          <h2>${esc(t('cards.bulkAuthor'))}</h2>
          <label>${esc(t('cards.author'))}<input name="author" maxlength="200" required></label>
          <button class="btn" type="submit">${esc(t('cards.apply'))}</button>
        </form>
      </div>
      <p class="small muted stats-note">${esc(t('cards.statsNote'))}</p>
      <label class="sort">${esc(t('cards.sort'))}
        <select id="sort">
          <option value="number">${esc(t('cards.sortNumber'))}</option>
          <option value="popular">${esc(t('cards.sortPopular'))}</option>
          <option value="rate">${esc(t('cards.sortRate'))}</option>
        </select></label>
      <ul class="card-rows" id="rows"></ul>
    </section>`;
  bindLogout();
  const sortSel = document.getElementById('sort');
  sortSel.value = sortKey;
  const rate = (c) => (c.offers ? c.selections / c.offers : 0);
  let sorted = [];
  function draw() {
    const k = sortSel.value;
    sorted = [...cards].sort((a, b) => (k === 'popular' ? b.selections - a.selections || a.number - b.number
      : k === 'rate' ? rate(b) - rate(a) || b.selections - a.selections : a.number - b.number));
    document.getElementById('rows').innerHTML = sorted.map((c, i) => `
      <li class="card-row ${c.status === 'removed' ? 'is-removed' : ''}">
        <button class="tile" type="button" data-i="${i}" aria-label="${esc(t('ed.view'))} ${esc(c.code)}">
          <img src="${esc(c.thumb)}" alt="" loading="lazy" style="aspect-ratio:${c.width}/${c.height}"></button>
        <div class="card-row-body">
          <strong class="mono">${esc(c.code)}</strong>
          <input class="author-input" data-author="${esc(c.code)}" value="${esc(c.author)}" placeholder="${esc(t('cards.authorPlaceholder'))}" aria-label="${esc(t('cards.author'))}">
          <span class="small">${esc(t('cards.stats', { sel: c.selections, off: c.offers }))}${c.offers ? ` · ${esc(t('cards.rate', { r: Math.round(rate(c) * 100) }))}` : ''}${c.testSelections ? ` · <span class="muted">${esc(t('cards.testSel', { n: c.testSelections }))}</span>` : ''}</span>
          <span class="small muted">${esc(t('cards.inCollections', { n: c.inCollections }))}</span>
          ${c.status === 'removed'
            ? `<span class="small warn">${esc(t('cards.removed'))}</span><button class="link-btn" type="button" data-restore="${esc(c.code)}">${esc(t('cards.restore'))}</button>`
            : `<button class="link-btn link-btn--danger" type="button" data-remove="${esc(c.code)}">${esc(t('cards.remove'))}</button>`}
        </div>
      </li>`).join('');
  }
  draw();
  sortSel.addEventListener('change', () => { storage.set('dc_admin_sort', sortSel.value); draw(); });
  const rows = document.getElementById('rows');
  rows.addEventListener('click', async (e) => {
    const tile = e.target.closest('.tile');
    if (tile) { openViewer({ cards: sorted, index: Number(tile.dataset.i), mode: 'admin' }); return; }
    const rm = e.target.closest('[data-remove]');
    const rs = e.target.closest('[data-restore]');
    try {
      if (rm && confirm(t('cards.removeConfirm', { code: rm.dataset.remove }))) {
        await api(`/api/admin/cards/${rm.dataset.remove}/remove`, { method: 'POST' }); render();
      } else if (rs) {
        await api(`/api/admin/cards/${rs.dataset.restore}/restore`, { method: 'POST' }); render();
      }
    } catch (err) { toast(errorText(err)); }
  });
  rows.addEventListener('change', async (e) => {
    const input = e.target.closest('[data-author]'); if (!input) return;
    try {
      await api(`/api/admin/cards/${input.dataset.author}`, { method: 'PATCH', body: { author: input.value } });
      const c = cards.find((x) => x.code === input.dataset.author); if (c) c.author = input.value.trim();
      toast(t('cards.savedAuthor'));
    } catch (err) { toast(errorText(err)); }
  });
  document.getElementById('upload').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.textContent = t('cards.uploading');
    try {
      const r = await api('/api/admin/cards', { method: 'POST', form: new FormData(e.target) });
      toast(t('cards.uploaded', { n: r.created.length }) + (r.failed.length ? ` · ${t('cards.failed', { files: r.failed.join(', ') })}` : ''));
      render();
    } catch (err) {
      toast(err.data && err.data.failed ? t('cards.failed', { files: err.data.failed.join(', ') }) : errorText(err));
      btn.disabled = false; btn.textContent = t('cards.upload');
    }
  });
  document.getElementById('bulk-author').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/admin/cards/bulk-author', { method: 'POST', body: { author: e.target.author.value } });
      toast(t('cards.bulkDone', { n: r.updated })); render();
    } catch (err) { toast(errorText(err)); }
  });
}

// ---------- старт ----------
(async () => {
  try { Object.assign(session, await api('/api/admin/me')); } catch { /* сайт работает и без этого */ }
  render();
})();
