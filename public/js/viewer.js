// Полноэкранный просмотр карты: целиком, с сохранением пропорций, увеличение щипком / двойным касанием,
// листание свайпом и стрелками. Кнопка «Назад» в браузере закрывает просмотр и возвращает к тому же месту в сетке.
import { t, dateLabel, lang } from './i18n.js';
import { esc, api, u, tt, toast, visitorId, errorText } from './util.js';
import { PARTNER_QUESTIONS, START_GUIDES } from './content.js';

let current = null; // открытый просмотр

export function isViewerOpen() { return !!current; }

/** Вызывается из общего обработчика popstate. */
export function handleViewerPopState() {
  if (current && !(history.state && history.state.viewer)) teardown();
}

/** Почему выбор сохранён, но не идёт в общий счёт. */
export function notCountedText(reason) {
  return reason === 'own_card'
    ? tt('Это ваша карта: выбор сохранён, но в общее число не идёт.', 'This is your card: the choice is saved but not added to the total.')
    : tt('Демо: выбор сохранён, но в общую статистику не идёт.', 'Demo: the choice is saved but not added to the statistics.');
}

function cardUrl(code) {
  const u = new URL(location.href);
  if (code) u.searchParams.set('card', code); else u.searchParams.delete('card');
  return u.pathname + u.search + u.hash;
}

/**
 * opts: {
 *   cards: [{code, thumb, full, width, height, author?, publishedAt?}],
 *   index: number,
 *   mode: 'library' | 'collection' | 'admin',
 *   collection?: { isTest, state(): {choice, round}, choose(code), cancel(), countFor(code) }
 *   onChange?: (code) => void
 * }
 */
export function openViewer(opts) {
  if (current) teardown();
  const opener = document.activeElement;
  const root = document.getElementById('overlay-root');
  const el = document.createElement('div');
  el.className = `viewer viewer--${opts.mode}`;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `
    <div class="viewer-stage" data-stage><img class="viewer-img" alt="" draggable="false" data-img></div>
    <div class="viewer-top chrome">
      <button class="icon-btn" type="button" data-close aria-label="${esc(t('viewer.close'))}">${icons.close}</button>
      <span class="viewer-counter" data-counter></span>
      <button class="icon-btn" type="button" data-info aria-label="${esc(t('viewer.info'))}" aria-expanded="false">${icons.info}</button>
    </div>
    <button class="viewer-nav viewer-nav--prev chrome" type="button" data-prev aria-label="${esc(t('viewer.prev'))}">${icons.prev}</button>
    <button class="viewer-nav viewer-nav--next chrome" type="button" data-next aria-label="${esc(t('viewer.next'))}">${icons.next}</button>
    ${opts.mode !== 'admin' ? '<div class="viewer-bottom chrome" data-bottom></div>' : ''}
    <div class="viewer-sheet" data-sheet hidden></div>`;
  root.appendChild(el);
  document.body.classList.add('no-scroll');

  const $ = (s) => el.querySelector(s);
  const stage = $('[data-stage]');
  const img = $('[data-img]');
  const sheet = $('[data-sheet]');
  const bottom = $('[data-bottom]');

  const z = { s: 1, x: 0, y: 0, fitW: 0, fitH: 0 };
  let index = opts.index;
  let detailsCache = new Map();
  // Сведения о карте с общим числом «Выбрали для обсуждения» (и выбран ли уже этот браузер/аккаунт в библиотеке).
  const fetchDetails = (code) => api(`/api/cards/${encodeURIComponent(code)}?visitor=${encodeURIComponent(visitorId())}`)
    .then((d) => { detailsCache.set(code, d); return d; });

  const state = {
    el, opts, opener,
    get code() { return opts.cards[index].code; },
    refreshBottom: renderBottom,
  };
  current = state;

  // ---------- история браузера ----------
  if (new URL(location.href).searchParams.has('card')) history.replaceState({}, '', cardUrl(null));
  history.pushState({ viewer: true }, '', cardUrl(opts.cards[index].code));

  // ---------- раскладка и увеличение ----------
  function layout() {
    const c = opts.cards[index];
    const W = stage.clientWidth; const H = stage.clientHeight;
    const k = Math.min(W / c.width, H / c.height);
    z.fitW = Math.round(c.width * k); z.fitH = Math.round(c.height * k);
    img.style.width = `${z.fitW}px`; img.style.height = `${z.fitH}px`;
    img.style.left = `${Math.round((W - z.fitW) / 2)}px`; img.style.top = `${Math.round((H - z.fitH) / 2)}px`;
    z.s = 1; z.x = 0; z.y = 0; apply(false);
  }
  function clamp() {
    const W = stage.clientWidth; const H = stage.clientHeight;
    const mx = Math.max(0, (z.fitW * z.s - W) / 2); const my = Math.max(0, (z.fitH * z.s - H) / 2);
    z.x = Math.min(mx, Math.max(-mx, z.x)); z.y = Math.min(my, Math.max(-my, z.y));
  }
  function apply(animate) {
    img.style.transition = animate ? 'transform .22s ease' : 'none';
    img.style.transform = `translate(${z.x}px, ${z.y}px) scale(${z.s})`;
    el.classList.toggle('is-zoomed', z.s > 1.01);
  }
  // Увеличение вокруг точки (px, py) относительно центра сцены.
  function zoomTo(s, px, py, animate) {
    const ns = Math.min(5, Math.max(1, s));
    z.x = px - (px - z.x) * (ns / z.s); z.y = py - (py - z.y) * (ns / z.s); z.s = ns;
    if (ns === 1) { z.x = 0; z.y = 0; }
    clamp(); apply(animate);
  }
  const rel = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2]; };

  const pointers = new Map();
  let gesture = null; let lastTap = 0; let tapTimer = null;
  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = { type: 'pinch', d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: z.s };
    } else if (pointers.size === 1) {
      gesture = { type: 'pan', sx: e.clientX, sy: e.clientY, x: z.x, y: z.y, moved: false };
    }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (gesture.type === 'pinch' && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const r = stage.getBoundingClientRect();
      zoomTo(gesture.s * (d / gesture.d), (a[0] + b[0]) / 2 - r.left - r.width / 2, (a[1] + b[1]) / 2 - r.top - r.height / 2, false);
    } else if (gesture.type === 'pan') {
      const dx = e.clientX - gesture.sx; const dy = e.clientY - gesture.sy;
      if (Math.abs(dx) + Math.abs(dy) > 6) gesture.moved = true;
      if (z.s > 1.01) { z.x = gesture.x + dx; z.y = gesture.y + dy; clamp(); apply(false); }
      else if (opts.cards.length > 1) { z.x = dx * 0.6; apply(false); } // лёгкий отклик на свайп
    }
  });
  const end = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (gesture && gesture.type === 'pinch') {
      if (pointers.size === 0) gesture = null;
      else { const [p] = [...pointers.values()]; gesture = { type: 'pan', sx: p[0], sy: p[1], x: z.x, y: z.y, moved: true }; }
      if (z.s < 1.05) zoomTo(1, 0, 0, true);
      return;
    }
    if (!gesture || pointers.size) return;
    const g = gesture; gesture = null;
    const dx = e.clientX - g.sx; const dy = e.clientY - g.sy;
    if (z.s <= 1.01 && g.moved) {
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.2 && opts.cards.length > 1) { go(dx < 0 ? 1 : -1); return; }
      z.x = 0; apply(true); return;
    }
    if (g.moved || e.type === 'pointercancel') return;
    // касание: двойное — увеличить/уменьшить, одиночное — спрятать/показать элементы управления
    const now = Date.now();
    if (now - lastTap < 300) {
      clearTimeout(tapTimer); lastTap = 0;
      const [px, py] = rel(e);
      zoomTo(z.s > 1.01 ? 1 : 2.5, px, py, true);
    } else {
      lastTap = now;
      tapTimer = setTimeout(() => el.classList.toggle('chrome-hidden'), 280);
    }
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [px, py] = rel(e);
    zoomTo(z.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15), px, py, false);
  }, { passive: false });

  // ---------- содержимое ----------
  function show() {
    const c = opts.cards[index];
    $('[data-counter]').textContent = opts.cards.length > 1 ? `${index + 1} / ${opts.cards.length}` : '';
    $('[data-prev]').hidden = $('[data-next]').hidden = opts.cards.length < 2;
    img.src = c.thumb; // уже в кэше — показываем сразу, затем подменяем на полное изображение
    img.alt = c.code;
    const full = new Image();
    full.onload = () => { if (opts.cards[index] === c) img.src = c.full; };
    full.src = c.full;
    // заранее загружаем соседние карты
    for (const d of [1, -1]) { const n = opts.cards[(index + d + opts.cards.length) % opts.cards.length]; if (n) new Image().src = n.full; }
    layout();
    renderBottom();
    if (!sheet.hidden) renderSheet();
    if (opts.onChange) opts.onChange(c.code);
  }
  function go(d) {
    index = (index + d + opts.cards.length) % opts.cards.length;
    history.replaceState({ viewer: true }, '', cardUrl(opts.cards[index].code));
    show();
  }

  // Блок под картой зависит от того, откуда её открыли: подборка встречи — выбор и «Вопросы для собеседника»;
  // общая библиотека — «С чего начать?» и вход в обсуждение. Свёрнутые блоки не перекрывают картинку:
  // высота панели освобождается под ней, и картинка подстраивается.
  const ui = { questions: false, guide: false, guideKey: null };
  const L = (o) => (o && (o[lang] || o.ru)) || '';
  const chev = (open) => `<span class="chev ${open ? 'open' : ''}" aria-hidden="true">▾</span>`;
  function renderBottom() {
    if (!bottom) return;
    const c = opts.cards[index];
    if (opts.mode === 'collection' && opts.collection) {
      const { choice } = opts.collection.state();
      const chosen = choice === c.code;
      const count = opts.collection.countFor(c.code);
      const qs = PARTNER_QUESTIONS[lang] || PARTNER_QUESTIONS.ru;
      bottom.innerHTML = chosen ? `
        <div class="vb-row"><div class="chosen-pill">${icons.check}<span>${esc(t('viewer.chosen'))}</span></div>
          <span class="viewer-count">${opts.collection.isTest ? esc(t('viewer.testNoCount')) : esc(typeof count === 'number' ? t('viewer.selectedCount', { n: count }) : '')}</span></div>
        ${!opts.collection.isTest && opts.collection.notCountedFor && opts.collection.notCountedFor(c.code) ? `<p class="viewer-count">${esc(notCountedText(opts.collection.notCountedFor(c.code)))}</p>` : ''}
        <div class="vb-panel">
          <button class="vb-toggle" type="button" data-q aria-expanded="${ui.questions}">${esc(tt('Вопросы для собеседника', 'Questions for your conversation partner'))}${chev(ui.questions)}</button>
          ${ui.questions ? `<div class="vb-body">${PARTNER_QUESTIONS.placeholder ? `<p class="vb-note">${esc(tt('Временные вопросы для теста — заменятся списком проекта.', 'Temporary test questions — to be replaced by the project’s list.'))}</p>` : ''}
            <ol class="vb-questions">${qs.map((q) => `<li>${esc(q)}</li>`).join('')}</ol>
            <p class="vb-note">${esc(tt('Вопросы — по желанию и в любом порядке. Отвечать письменно не нужно.', 'The questions are optional, in any order. No need to write answers.'))}</p></div>` : ''}
        </div>
        <div class="vb-row"><button class="link-btn" type="button" data-copy>${esc(tt('Ссылка на карту', 'Link to this card'))}</button>
          <button class="link-btn" type="button" data-cancel>${esc(t('viewer.cancel'))}</button></div>`
      : `
        <button class="btn yellow wide" type="button" data-choose>${esc(t(choice ? 'viewer.chooseInstead' : 'viewer.choose'))}</button>
        ${choice ? `<p class="viewer-count">${esc(t('viewer.chooseInsteadHint'))}</p>` : ''}
        <div class="vb-row"><button class="link-btn" type="button" data-copy>${esc(tt('Ссылка на карту', 'Link to this card'))}</button></div>`;
    } else if (opts.mode === 'library') {
      const info = detailsCache.get(c.code);
      const g = START_GUIDES.find((x) => x.key === ui.guideKey);
      bottom.innerHTML = `
        <div class="vb-panel">
          <button class="vb-toggle" type="button" data-guide aria-expanded="${ui.guide}">${esc(tt('С чего начать?', 'Where to start?'))}${chev(ui.guide)}</button>
          ${ui.guide ? `<div class="vb-body"><div class="chips vb-chips">${START_GUIDES.map((x) => `<button class="chip ${x.key === ui.guideKey ? 'on' : ''}" type="button" data-g="${x.key}" aria-pressed="${x.key === ui.guideKey}">${esc(L(x.title))}</button>`).join('')}</div>
            ${g ? `<div class="vb-guide"><p>${esc(L(g.text))}</p>${g.hints ? `<ul>${(g.hints[lang] || g.hints.ru).map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
              ${g.choose ? libChoiceHtml(info) : ''}</div>` : ''}</div>` : ''}
        </div>
        <div class="vb-row"><a class="btn light sm" href="${u('/cards/' + c.code)}" data-discuss>${esc(tt('Обсуждение', 'Discussion'))}${info && typeof info.comments === 'number' ? ` · ${info.comments}` : ''}</a>
          <button class="link-btn" type="button" data-copy>${esc(tt('Ссылка на карту', 'Link to this card'))}</button></div>`;
      if (!info) fetchDetails(c.code).then(() => { if (opts.cards[index].code === c.code) renderBottom(); }).catch(() => {});
    }
    syncBottom();
  }
  // Необязательный выбор для обсуждения в библиотеке (внутри «Вдвоём» и «В группе»).
  function libChoiceHtml(info) {
    if (!info) return '';
    return info.chosenByMe
      ? `<div class="vb-choice"><div class="chosen-pill">${icons.check}<span>${esc(t('viewer.chosen'))}</span></div><button class="link-btn" type="button" data-lib-unchoose>${esc(t('viewer.cancel'))}</button></div>`
      : `<div class="vb-choice"><button class="btn yellow sm" type="button" data-lib-choose>${esc(t('viewer.choose'))}</button><span class="vb-note">${esc(tt('по желанию', 'optional'))}</span></div>`;
  }
  // Высота панели снизу → место для картинки (картинка всегда целиком и не под панелью).
  function syncBottom() {
    if (!bottom) return;
    el.style.setProperty('--bottom', `${bottom.offsetHeight + 4}px`);
    layout();
  }
  async function copyLink() {
    const url = location.href;
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) { await navigator.share({ title: 'Dialogue Cards', url }); return; }
      await navigator.clipboard.writeText(url); toast(tt('Ссылка на карту скопирована', 'Card link copied'));
    } catch (e) { if (e && e.name !== 'AbortError') prompt(tt('Скопируйте ссылку:', 'Copy the link:'), url); }
  }
  if (bottom) {
    bottom.addEventListener('click', async (e) => {
      const a = e.target.closest('a[data-discuss]');
      if (a) { e.preventDefault(); const href = a.getAttribute('href'); teardown(); history.replaceState({}, '', href); window.dispatchEvent(new PopStateEvent('popstate')); return; }
      const btn = e.target.closest('button'); if (!btn) return;
      if (btn.hasAttribute('data-q')) { ui.questions = !ui.questions; renderBottom(); return; }
      if (btn.hasAttribute('data-guide')) { ui.guide = !ui.guide; renderBottom(); return; }
      if (btn.dataset.g) { ui.guideKey = ui.guideKey === btn.dataset.g ? null : btn.dataset.g; renderBottom(); return; }
      if (btn.hasAttribute('data-copy')) { copyLink(); return; }
      if (btn.hasAttribute('data-lib-choose') || btn.hasAttribute('data-lib-unchoose')) {
        const code = opts.cards[index].code; const on = btn.hasAttribute('data-lib-choose');
        btn.disabled = true;
        try {
          const r = await api(`/api/cards/${encodeURIComponent(code)}/${on ? 'choose' : 'unchoose'}`, { method: 'POST', body: { visitorId: visitorId() } });
          detailsCache.set(code, { ...(detailsCache.get(code) || {}), chosenByMe: r.chosen, selectedCount: r.selectedCount });
          toast(on ? (r.notCounted ? notCountedText(r.notCounted) : t('col.saved')) : t('col.cancelled'));
        } catch (x) { toast(errorText(x)); }
        renderBottom(); if (!sheet.hidden) renderSheet();
        return;
      }
      btn.disabled = true;
      try {
        if (btn.hasAttribute('data-choose')) { await opts.collection.choose(opts.cards[index].code); ui.questions = false; }
        if (btn.hasAttribute('data-cancel')) await opts.collection.cancel();
        detailsCache.delete(opts.cards[index].code); // общее число изменилось — сведения перечитаем
      } finally { renderBottom(); if (!sheet.hidden) renderSheet(); }
    });
  }

  async function renderSheet() {
    const c = opts.cards[index];
    const code = c.code;
    let d = detailsCache.get(code);
    const draw = (info) => {
      if (opts.cards[index].code !== code) return;
      const author = info && info.author ? esc(info.author) : `<span class="muted">${esc(t('viewer.authorUnknown'))}</span>`;
      let countLine = '';
      if (opts.mode !== 'admin' && info && typeof info.selectedCount === 'number') {
        countLine = `<p class="sheet-count">${esc(info.selectedCount ? t('viewer.selectedCount', { n: info.selectedCount }) : t('viewer.selectedNone'))}</p>`;
      }
      sheet.innerHTML = `
        <div class="sheet-handle"></div>
        <dl class="sheet-list">
          <div><dt>${esc(t('viewer.code'))}</dt><dd>${esc(code)}</dd></div>
          <div><dt>${esc(t('viewer.author'))}</dt><dd>${author}</dd></div>
          ${info && info.publishedAt ? `<div><dt>${esc(t('viewer.published'))}</dt><dd>${esc(dateLabel(info.publishedAt))}</dd></div>` : ''}
        </dl>
        ${countLine}
        ${opts.mode === 'library' && info && typeof info.comments === 'number' ? `<a class="sheet-link" href="${u('/cards/' + code)}">${esc(tt('Обсуждение карты', 'Card discussion'))} (${info.comments}) →</a>` : ''}
        <p class="sheet-hint">${esc(t('viewer.zoomHint'))}</p>`;
    };
    draw(d || c);
    if (!d && opts.mode !== 'admin') {
      try { d = await fetchDetails(code); draw(d); } catch { /* показываем то, что есть */ }
    }
  }
  function toggleSheet(force) {
    const open = force ?? sheet.hidden;
    sheet.hidden = !open;
    $('[data-info]').setAttribute('aria-expanded', String(open));
    el.classList.toggle('sheet-open', open);
    if (open) renderSheet();
  }

  // ---------- кнопки и клавиатура ----------
  $('[data-close]').addEventListener('click', () => history.back());
  $('[data-info]').addEventListener('click', () => toggleSheet());
  $('[data-prev]').addEventListener('click', () => go(-1));
  $('[data-next]').addEventListener('click', () => go(1));
  sheet.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (a) { e.preventDefault(); const href = a.getAttribute('href'); teardown(); history.replaceState({}, '', href); window.dispatchEvent(new PopStateEvent('popstate')); return; }
    toggleSheet(false);
  });
  const onKey = (e) => {
    if (e.key === 'Escape') { if (!sheet.hidden) toggleSheet(false); else history.back(); }
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'i') toggleSheet();
  };
  const onResize = () => (bottom ? syncBottom() : layout());
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  state.cleanup = () => {
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    clearTimeout(tapTimer);
  };

  requestAnimationFrame(() => { el.classList.add('is-open'); show(); $('[data-close]').focus({ preventScroll: true }); });
  return state;
}

function teardown() {
  if (!current) return;
  const { el, opener, cleanup, opts } = current;
  cleanup && cleanup();
  current = null;
  el.remove();
  document.body.classList.remove('no-scroll');
  if (opener && opener.focus && document.contains(opener)) opener.focus({ preventScroll: true });
  if (opts.onClose) opts.onClose();
}

export function refreshViewer() { if (current) current.refreshBottom(); }

export const icons = {
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  expand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>',
};
