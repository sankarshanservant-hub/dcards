// Просмотр карты: целиком, с сохранением пропорций, увеличение щипком / двойным касанием, листание свайпом и стрелками.
// «Карта / Вопросы» (переключатель и свайп), «На весь экран» (в том числе без Fullscreen API), экран разговора после выбора. Кнопка «Назад» в браузере закрывает просмотр и возвращает к тому же месту в сетке.
import { t, dateLabel, lang } from './i18n.js';
import { esc, api, u, tt, toast, visitorId, errorText } from './util.js';
import { QUESTION_FORMATS, START_GUIDES } from './content.js';

let current = null; // открытый просмотр

export function isViewerOpen() { return !!current; }

/** Вызывается из общего обработчика popstate. */
export function handleViewerPopState() {
  if (!current) return;
  if (!(history.state && history.state.viewer)) teardown();
  else if (!history.state.q && current.onCardState) current.onCardState(); // «назад» из вопросов (кнопка или жест iPhone) — к карте
}
/** Закрыть просмотр: шаг назад по истории (из вопросов — сразу два, мимо карты). */
export function closeViewer() {
  if (!current) return;
  history.go(history.state && history.state.q ? -2 : -1);
}

/** Почему выбор сохранён, но не идёт в общий счёт. */
export const demoSavedText = () => tt('Выбор сохранён. В демо он не влияет на общую статистику.', 'Choice saved. In the demo it does not affect the overall statistics.');
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
  const withQ = opts.mode !== 'admin'; // вопросы — у карт галереи и подборки встречи
  el.className = `viewer viewer--${opts.mode}`;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', tt('Просмотр карты', 'Card view'));
  el.innerHTML = `
    <div class="viewer-stage" data-stage><img class="viewer-img" alt="" draggable="false" data-img></div>
    <div class="viewer-top">
      <button class="icon-btn" type="button" data-close aria-label="${esc(t('viewer.close'))}">${icons.close}</button>
      <button class="icon-btn" type="button" data-unfull hidden aria-label="${esc(tt('Выйти из полноэкранного режима', 'Exit full screen'))}">${icons.collapse}</button>
      ${withQ ? `<div class="vt-seg" role="tablist" aria-label="${esc(tt('Что показать', 'What to show'))}">
        <button type="button" role="tab" data-view="card" aria-selected="true">${esc(tt('Карта', 'Card'))}</button>
        <button type="button" role="tab" data-view="questions" aria-selected="false">${esc(tt('Вопросы', 'Questions'))}</button></div>` : '<span class="viewer-counter" data-counter></span>'}
      <span class="vt-end">
        <button class="icon-btn vt-nav" type="button" data-prev aria-label="${esc(t('viewer.prev'))}">${icons.prev}</button>
        <button class="icon-btn vt-nav" type="button" data-next aria-label="${esc(t('viewer.next'))}">${icons.next}</button>
        <button class="icon-btn full-btn" type="button" data-full aria-label="${esc(tt('На весь экран', 'Full screen'))}" title="${esc(tt('На весь экран', 'Full screen'))}">${icons.expand}</button>
        ${withQ ? '' : `<button class="icon-btn" type="button" data-info aria-label="${esc(t('viewer.info'))}" aria-expanded="false">${icons.info}</button>`}
      </span>
    </div>
    ${withQ ? '<div class="viewer-bottom chrome" data-bottom></div>' : ''}
    <div class="viewer-sheet" data-sheet hidden></div>
    ${withQ ? `<section class="qpanel" data-qpanel hidden aria-labelledby="qp-title" tabindex="-1"></section>` : ''}`;
  root.appendChild(el);
  document.body.classList.add('no-scroll');

  const $ = (s) => el.querySelector(s);
  const stage = $('[data-stage]');
  const img = $('[data-img]');
  const sheet = $('[data-sheet]');
  const bottom = $('[data-bottom]');
  const qpanel = $('[data-qpanel]');

  const z = { s: 1, x: 0, y: 0, fitW: 0, fitH: 0 };
  let index = opts.index;
  const detailsCache = new Map();
  // Сведения о карте с общим числом «Выбрали для разговора» (и выбрана ли уже карта этим браузером/аккаунтом в галерее).
  const fetchDetails = (code) => api(`/api/cards/${encodeURIComponent(code)}?visitor=${encodeURIComponent(visitorId())}`)
    .then((d) => { detailsCache.set(code, d); return d; });

  // Режимы: view — 'card' | 'questions'; full — на весь экран; talk — экран выбранной карты (карты не листаются).
  const mode = { view: 'card', full: false, nativeFull: false, talk: false };
  const state = {
    el, opts, opener,
    get code() { return opts.cards[index].code; },
    refreshBottom: renderBottom,
    onCardState: () => { if (mode.view === 'questions') setView('card', true, true); },
  };
  current = state;

  // ---------- история браузера ----------
  if (new URL(location.href).searchParams.has('card')) history.replaceState({}, '', cardUrl(null));
  history.pushState({ viewer: true }, '', cardUrl(opts.cards[index].code));

  // ---------- раскладка и увеличение ----------
  function layout() {
    const c = opts.cards[index];
    const W = stage.clientWidth; const H = stage.clientHeight;
    if (!W || !H) return;
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
  function zoomTo(s, px, py, animate) {
    const ns = Math.min(5, Math.max(1, s));
    z.x = px - (px - z.x) * (ns / z.s); z.y = py - (py - z.y) * (ns / z.s); z.s = ns;
    if (ns === 1) { z.x = 0; z.y = 0; }
    clamp(); apply(animate);
  }
  const rel = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2]; };
  // 17.11.2026: свайп «карта ↔ вопросы» убран — на iPhone он путался с системным жестом «назад» от края экрана и закрывал
  // просмотр. Переключение — кнопками «Карта / Вопросы»; системный «назад» из вопросов возвращает к карте (своя запись в истории).
  // Горизонтальный свайп по карте листает галерею, только если начат не у края экрана (у края — жест браузера).
  // В экране разговора карта одна и не листается.
  const canFlip = () => opts.cards.length > 1 && !mode.talk;
  const swipeToQuestions = () => false;
  const EDGE = 28;

  const pointers = new Map();
  let gesture = null; let lastTap = 0; let tapTimer = null;
  stage.addEventListener('pointerdown', (e) => {
    try { stage.setPointerCapture(e.pointerId); } catch { /* указатель уже отпущен */ }
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = { type: 'pinch', d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: z.s };
    } else if (pointers.size === 1) {
      gesture = { type: 'pan', sx: e.clientX, sy: e.clientY, x: z.x, y: z.y, moved: false, edge: e.clientX < EDGE || e.clientX > window.innerWidth - EDGE };
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
      else if (canFlip() && !gesture.edge) { z.x = dx * 0.5; apply(false); } // лёгкий отклик на свайп
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
      const horiz = Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.2;
      if (horiz && canFlip() && !g.edge) { go(dx < 0 ? 1 : -1); return; }
      z.x = 0; apply(true); return;
    }
    if (g.moved || e.type === 'pointercancel') return;
    // касание: двойное — увеличить/уменьшить; одиночное — на весь экран (в полноэкранном — спрятать/показать кнопки)
    const now = Date.now();
    if (now - lastTap < 300) {
      clearTimeout(tapTimer); lastTap = 0;
      const [px, py] = rel(e);
      zoomTo(z.s > 1.01 ? 1 : 2.5, px, py, true);
    } else {
      lastTap = now;
      tapTimer = setTimeout(() => { if (z.s > 1.01) return; if (!mode.full) setFull(true); else el.classList.toggle('chrome-hidden'); }, 280);
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
    const counter = $('[data-counter]'); if (counter) counter.textContent = opts.cards.length > 1 ? `${index + 1} / ${opts.cards.length}` : '';
    syncNav();
    img.src = c.thumb; // уже в кэше — показываем сразу, затем подменяем на полное изображение
    img.alt = c.code;
    const full = new Image();
    full.onload = () => { if (opts.cards[index] === c) img.src = c.full; };
    full.src = c.full;
    for (const d of [1, -1]) { const n = opts.cards[(index + d + opts.cards.length) % opts.cards.length]; if (n) new Image().src = n.full; }
    layout();
    renderBottom();
    if (!sheet.hidden) renderSheet();
    if (opts.onChange) opts.onChange(c.code);
  }
  function syncNav() { $('[data-prev]').hidden = $('[data-next]').hidden = !canFlip() || (mode.view === 'questions' && !el.classList.contains('q-side')); }
  function go(d) {
    if (!canFlip()) return;
    index = (index + d + opts.cards.length) % opts.cards.length;
    history.replaceState({ viewer: true }, '', cardUrl(opts.cards[index].code));
    show();
  }

  // ---------- режимы: «Карта / Вопросы», на весь экран, разговор ----------
  const wide = () => window.matchMedia('(min-width: 980px)').matches;
  function setView(v, focus = true, fromHistory = false) {
    if (!withQ) return;
    // вопросы — своя запись в истории: «назад» (кнопка браузера, жест iPhone) возвращает к карте, а не закрывает просмотр
    if (!fromHistory) {
      if (v === 'questions' && !(history.state && history.state.q)) history.pushState({ viewer: true, q: true }, '', location.href);
      else if (v === 'card' && history.state && history.state.q) { history.back(); return; }
    }
    if (v === 'questions' && !qpanel.innerHTML) renderQ();
    mode.view = v;
    el.classList.toggle('view-questions', v === 'questions');
    el.classList.toggle('q-side', v === 'questions' && wide());
    qpanel.hidden = v !== 'questions';
    el.querySelectorAll('.vt-seg [data-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === v)));
    if (v === 'questions') {
      restoreScroll();
      if (focus) qpanel.focus({ preventScroll: true });
    } else if (focus) { const b = el.querySelector('.vt-seg [data-view="card"]'); if (b) b.focus({ preventScroll: true }); }
    syncNav();
    requestAnimationFrame(syncBottom);
  }
  async function setFull(on) {
    mode.full = on;
    el.classList.toggle('is-full', on);
    el.classList.remove('chrome-hidden');
    $('[data-full]').hidden = on; $('[data-unfull]').hidden = !on; $('[data-close]').hidden = false;
    // Системный полноэкранный режим, где он есть; без него (iPhone) — тот же вид внутри приложения.
    if (on && !document.fullscreenElement && el.requestFullscreen && document.fullscreenEnabled) {
      try { await el.requestFullscreen({ navigationUI: 'hide' }); mode.nativeFull = true; } catch { mode.nativeFull = false; }
    } else if (!on && document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch { /* уже вышли */ }
      mode.nativeFull = false;
    }
    syncNav();
    requestAnimationFrame(syncBottom);
    (on ? $('[data-unfull]') : $('[data-full]')).focus({ preventScroll: true });
  }
  const onFsChange = () => { if (!document.fullscreenElement && mode.full && mode.nativeFull) { mode.nativeFull = false; setFull(false); } };
  document.addEventListener('fullscreenchange', onFsChange);
  function setTalk(on) {
    mode.talk = on;
    el.classList.toggle('is-talk', on);
    syncNav(); renderBottom();
  }

  // Блок под картой: подборка встречи — выбор и вопросы; общая галерея — «С чего начать?», вопросы, комментарии.
  const ui = { guide: false, guideKey: null, saving: false, err: '', share: '', note: '' };
  const L = (o) => (o && (o[lang] || o.ru)) || '';
  const chev = (open) => `<span class="chev ${open ? 'open' : ''}" aria-hidden="true">▾</span>`;
  const countLine = (info) => (info && typeof info.selectedCount === 'number'
    ? `<p class="choose-count">${esc(info.selectedCount ? t('viewer.selectedCount', { n: info.selectedCount }) : t('viewer.selectedNone'))}</p>` : '');
  const shareField = () => (ui.share ? `<label class="field small">${esc(tt('Скопируйте ссылку:', 'Copy the link:'))}<input type="text" readonly value="${esc(ui.share)}" data-share-url></label>` : '');
  const linkBtn = (attr, ru, en) => `<button class="link-btn" type="button" ${attr}>${esc(tt(ru, en))}</button>`;
  const questionsBtn = (primary) => `<button class="btn ${primary ? 'yellow wide' : 'light sm'}" type="button" data-questions>${icons.questions}<span>${esc(primary && opts.mode === 'collection' ? tt('Вопросы для собеседника', 'Questions for your partner') : tt('Вопросы', 'Questions'))}</span></button>`;
  const talkBadge = () => `<div class="talk-badge">${icons.check}<span>${esc(tt('Ваша карта для разговора', 'Your card for the conversation'))}</span></div>`;
  // «вопросов» в инструкции сценария — ссылка на вопросы этого сценария.
  const guideText = (g) => esc(L(g.text)).replace(/\{([^}]+)\}/g, (m, w) => `<a href="#questions" class="q-link" data-q-open="${g.key}">${w}</a>`);
  function renderBottom() {
    if (!bottom) return;
    const c = opts.cards[index];
    const info = detailsCache.get(c.code);
    if (!info) fetchDetails(c.code).then(() => { if (opts.cards[index].code === c.code) renderBottom(); }).catch(() => {});
    if (opts.mode === 'collection' && opts.collection) {
      const { choice } = opts.collection.state();
      const chosen = choice === c.code;
      if (!chosen && mode.talk) { mode.talk = false; el.classList.remove('is-talk'); syncNav(); }
      const nc = opts.collection.notCountedFor ? opts.collection.notCountedFor(c.code) : null;
      const note = chosen ? (opts.collection.isTest ? (opts.collection.isDemo ? demoSavedText() : t('viewer.testNoCount')) : nc ? notCountedText(nc) : '') : '';
      bottom.innerHTML = chosen && mode.talk ? `
        ${talkBadge()}
        ${questionsBtn(true)}
        <div class="vb-row">${linkBtn('data-other', 'Выбрать другую', 'Choose another')}${linkBtn('data-cancel', t('viewer.cancel'), t('viewer.cancel'))}${linkBtn('data-copy', 'Поделиться картой', 'Share card')}</div>
        ${shareField()}${note ? `<p class="viewer-count">${esc(note)}</p>` : ''}`
      : chosen ? `
        <div class="vb-row"><div class="chosen-pill">${icons.check}<span>${esc(t('viewer.chosen'))}</span></div>${linkBtn('data-talk', 'Открыть экран разговора', 'Open conversation view')}</div>
        ${questionsBtn(true)}
        <div class="vb-row">${linkBtn('data-cancel', t('viewer.cancel'), t('viewer.cancel'))}${linkBtn('data-copy', 'Поделиться картой', 'Share card')}${linkBtn('data-info', 'О карте', 'About the card')}</div>
        ${shareField()}${note ? `<p class="viewer-count">${esc(note)}</p>` : ''}${countLine(info)}`
      : `
        <button class="btn yellow wide" type="button" data-choose ${ui.saving ? 'disabled aria-busy="true"' : ''}>${esc(ui.saving ? tt('Сохраняем…', 'Saving…') : t(choice ? 'viewer.chooseInstead' : 'viewer.choose'))}</button>
        ${ui.err ? `<p class="field-error" role="alert">${esc(ui.err)}</p>` : choice ? `<p class="viewer-count">${esc(t('viewer.chooseInsteadHint'))}</p>` : ''}
        <div class="vb-row">${questionsBtn(false)}${linkBtn('data-copy', 'Поделиться картой', 'Share card')}${linkBtn('data-info', 'О карте', 'About the card')}</div>
        ${shareField()}${countLine(info)}`;
    } else if (opts.mode === 'library') {
      if (mode.talk && info && !info.chosenByMe) { mode.talk = false; el.classList.remove('is-talk'); syncNav(); }
      if (mode.talk) {
        bottom.innerHTML = `${talkBadge()}${questionsBtn(true)}
          <div class="vb-row">${linkBtn('data-other', 'Выбрать другую', 'Choose another')}${linkBtn('data-lib-unchoose', t('viewer.cancel'), t('viewer.cancel'))}</div>
          ${ui.note ? `<p class="vb-note">${esc(ui.note)}</p>` : ''}`;
      } else {
        const g = START_GUIDES.find((x) => x.key === ui.guideKey);
        bottom.innerHTML = `
          <div class="vb-panel">
            <button class="vb-toggle" type="button" data-guide aria-expanded="${ui.guide}"><span>${esc(tt('С чего начать?', 'Where to start?'))}</span>${chev(ui.guide)}</button>
            ${ui.guide ? `<div class="vb-body"><div class="seg" role="radiogroup" aria-label="${esc(tt('Как смотреть карту', 'How to use the card'))}">${START_GUIDES.map((x) => `<button type="button" role="radio" data-g="${x.key}" aria-checked="${x.key === ui.guideKey}" tabindex="${x.key === (ui.guideKey || START_GUIDES[0].key) ? 0 : -1}">${esc(L(x.title))}</button>`).join('')}</div>
              ${g ? `<div class="vb-guide"><p>${guideText(g)}</p>${g.hints ? `<ul>${(g.hints[lang] || g.hints.ru).map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
                ${g.choose ? libChoiceHtml(info) : ''}</div>` : ''}</div>` : ''}
          </div>
          <div class="vb-actions">${questionsBtn(false)}<a class="btn light sm" href="${u('/cards/' + c.code)}" data-discuss>${esc(tt('Комментарии', 'Comments'))}${info && typeof info.comments === 'number' ? ` · ${info.comments}` : ''}</a></div>
          <div class="vb-row">${linkBtn('data-copy', 'Поделиться картой', 'Share card')}${linkBtn('data-info', 'О карте', 'About the card')}${countLine(info).replace('<p class="choose-count">', '<p class="choose-count" style="text-align:right">')}</div>
          ${shareField()}`;
      }
    }
    syncBottom();
  }
  // Необязательный выбор для обсуждения в галерее (внутри «Для двоих» и «Для группы»).
  function libChoiceHtml(info) {
    if (!info) return '';
    if (info.chosenByMe) return `<div class="vb-choice"><div class="chosen-pill">${icons.check}<span>${esc(t('viewer.chosen'))}</span></div>${linkBtn('data-talk', 'Открыть экран разговора', 'Open conversation view')}<button class="link-btn" type="button" data-lib-unchoose>${esc(t('viewer.cancel'))}</button></div>${ui.note ? `<p class="vb-note">${esc(ui.note)}</p>` : ''}`;
    return `<div class="vb-choice"><button class="btn yellow sm" type="button" data-lib-choose ${ui.saving ? 'disabled aria-busy="true"' : ''}>${esc(ui.saving ? tt('Сохраняем…', 'Saving…') : t('viewer.choose'))}</button><span class="vb-note">${esc(tt('по желанию', 'optional'))}</span></div>${ui.err ? `<p class="field-error" role="alert">${esc(ui.err)}</p>` : ''}`;
  }

  // ---------- «Вопросы»: три сценария, у «Для двоих» два списка; выбор, списки и прокрутка сохраняются ----------
  const QKEY = 'dc_questions';
  const saved = (() => { try { return JSON.parse(sessionStorage.getItem(QKEY) || '{}'); } catch { return {}; } })();
  const qs = {
    format: QUESTION_FORMATS.some((f) => f.key === saved.format) ? saved.format : (opts.mode === 'collection' ? 'pair' : null),
    list: saved.list || 'partner',
    scroll: {},
  };
  const persistQ = () => { try { sessionStorage.setItem(QKEY, JSON.stringify({ format: qs.format, list: qs.list })); } catch { /* без сохранения */ } };
  const FORMAT_ICON = { self: icons.user, pair: icons.pair, group: icons.group };
  const scrollKey = () => `${qs.format}:${qs.list}`;
  const qBody = () => qpanel && qpanel.querySelector('.qpanel-body');
  function saveScroll() { const b = qBody(); if (b && qs.format && !qpanel.hidden) qs.scroll[scrollKey()] = b.scrollTop; }
  function restoreScroll() { const b = qBody(); if (b) b.scrollTop = qs.scroll[scrollKey()] || 0; }
  function renderQ() {
    if (!qpanel) return;
    const f = QUESTION_FORMATS.find((x) => x.key === qs.format);
    let body;
    if (!f) body = `<p class="vb-note">${esc(tt('Выберите, как вы разговариваете: для себя, вдвоём или в группе.', 'Choose how you are talking: on your own, as two or in a group.'))}</p>`;
    else if (!f.lists || !f.lists.length) body = `<p class="q-pending">${esc(L(f.pending) || tt('Вопросы готовятся.', 'Questions are being prepared.'))}${f.link ? ` <a href="${u(f.link)}" data-q-go>${esc(tt('Играть компанией →', 'Play with friends →'))}</a>` : ''}</p>`;
    else {
      const cur = f.lists.find((x) => x.key === qs.list) || f.lists[0];
      qs.list = cur.key;
      body = `<div class="qtabs" role="tablist" aria-label="${esc(tt('Кто задаёт вопросы', 'Who asks'))}">${f.lists.map((x) => `<button type="button" role="tab" id="qt-${x.key}" aria-controls="ql" aria-selected="${x.key === cur.key}" tabindex="${x.key === cur.key ? 0 : -1}" data-q-list="${x.key}">${x.key === 'partner' ? icons.user : icons.cardHand}<span>${esc(L(x.title))}</span></button>`).join('')}</div>
        <ul class="qlist" id="ql" role="tabpanel" aria-labelledby="qt-${cur.key}">${(cur.items[lang] || cur.items.ru).map((q) => `<li>${esc(q)}</li>`).join('')}</ul>`;
    }
    qpanel.innerHTML = `<div class="qpanel-head"><h2 id="qp-title">${esc(tt('Вопросы', 'Questions'))}</h2>
        <button class="btn light sm q-back" type="button" data-q-card>${icons.prev}<span>${esc(tt('К карте', 'Back to card'))}</span></button></div>
      <div class="qpanel-body">
        <div class="seg qfmt" role="radiogroup" aria-label="${esc(tt('Сценарий', 'Scenario'))}">${QUESTION_FORMATS.map((x) => `<button type="button" role="radio" data-q-format="${x.key}" aria-checked="${x.key === qs.format}" tabindex="${x.key === (qs.format || 'pair') ? 0 : -1}"><span class="ic">${FORMAT_ICON[x.key] || ''}</span>${esc(L(x.title))}</button>`).join('')}</div>
        ${body}
      </div>`;
  }
  function openQ(format) {
    if (!withQ) return;
    saveScroll();
    if (format && format !== qs.format) { qs.format = format; persistQ(); renderQ(); }
    else if (!qpanel.innerHTML) renderQ();
    setView('questions');
  }
  if (qpanel) {
    qpanel.addEventListener('click', (e) => {
      const go = e.target.closest('a[data-q-go]');
      if (go) { e.preventDefault(); const href = go.getAttribute('href'); teardown(); history.replaceState({}, '', href); window.dispatchEvent(new PopStateEvent('popstate')); return; }
      const b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-q-card')) return setView('card');
      if (b.dataset.qFormat) { saveScroll(); qs.format = b.dataset.qFormat; persistQ(); renderQ(); restoreScroll(); qpanel.querySelector(`[data-q-format="${qs.format}"]`).focus(); return; }
      if (b.dataset.qList) { saveScroll(); qs.list = b.dataset.qList; persistQ(); renderQ(); restoreScroll(); qpanel.querySelector(`#qt-${qs.list}`).focus(); }
    });
    qpanel.addEventListener('keydown', (e) => {
      const tab = e.target.closest('[role="tab"], [role="radio"]');
      if (tab && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault(); e.stopPropagation();
        const group = [...tab.parentElement.querySelectorAll('button')]; const i = group.indexOf(tab);
        group[(i + (e.key === 'ArrowRight' ? 1 : -1) + group.length) % group.length].click();
      }
    });
    qpanel.addEventListener('scroll', () => saveScroll(), true);
  }
  el.querySelectorAll('.vt-seg [data-view]').forEach((b) => b.addEventListener('click', () => (b.dataset.view === 'questions' ? openQ() : setView('card'))));
  const seg = el.querySelector('.vt-seg');
  if (seg) seg.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault(); e.stopPropagation();
    const v = mode.view === 'card' ? 'questions' : 'card';
    if (v === 'questions') openQ(); else setView('card', false);
    seg.querySelector(`[data-view="${v}"]`).focus();
  });

  // Высота панели снизу → место для картинки (картинка всегда целиком и не под панелью).
  function syncBottom() {
    const hideBottom = !bottom || mode.full || (mode.view === 'questions' && !el.classList.contains('q-side'));
    el.style.setProperty('--bottom', hideBottom ? '0px' : `${bottom.offsetHeight + 4}px`);
    layout();
  }
  // «Поделиться картой»: системное меню, где оно есть; иначе копирование. Отмена — без сообщений; не вышло — показываем ссылку.
  async function copyLink() {
    const url = location.href;
    if (navigator.share) {
      try { await navigator.share({ title: 'Dialogue Cards', url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); toast(tt('Ссылка скопирована', 'Link copied')); }
    catch { ui.share = url; renderBottom(); const inp = bottom.querySelector('[data-share-url]'); if (inp) { inp.focus(); inp.select(); } }
  }
  const focusIn = (sel) => { const n = bottom && bottom.querySelector(sel); if (n) n.focus({ preventScroll: true }); };
  if (bottom) {
    bottom.addEventListener('click', async (e) => {
      const ql = e.target.closest('a[data-q-open]');
      if (ql) { e.preventDefault(); openQ(ql.dataset.qOpen); return; }
      const a = e.target.closest('a[data-discuss]');
      if (a) { e.preventDefault(); const href = a.getAttribute('href'); teardown(); history.replaceState({}, '', href); window.dispatchEvent(new PopStateEvent('popstate')); return; }
      const btn = e.target.closest('button'); if (!btn) return;
      if (btn.hasAttribute('data-questions')) { openQ(opts.mode === 'collection' ? (qs.format || 'pair') : (ui.guideKey || qs.format)); return; }
      if (btn.hasAttribute('data-guide')) { ui.guide = !ui.guide; renderBottom(); focusIn('[data-guide]'); return; }
      if (btn.dataset.g) { ui.guideKey = btn.dataset.g; ui.err = ''; renderBottom(); focusIn(`[data-g="${ui.guideKey}"]`); return; }
      if (btn.hasAttribute('data-copy')) { copyLink(); return; }
      if (btn.hasAttribute('data-info')) { toggleSheet(); return; }
      if (btn.hasAttribute('data-other')) { setTalk(false); focusIn('[data-choose], [data-guide]'); return; }
      if (btn.hasAttribute('data-talk')) { setTalk(true); focusIn('[data-questions]'); return; }
      if (btn.hasAttribute('data-lib-choose') || btn.hasAttribute('data-lib-unchoose')) {
        const code = opts.cards[index].code; const on = btn.hasAttribute('data-lib-choose');
        if (ui.saving) return;
        ui.saving = on; ui.err = ''; ui.note = ''; renderBottom();
        let ok = false;
        try {
          const r = await api(`/api/cards/${encodeURIComponent(code)}/${on ? 'choose' : 'unchoose'}`, { method: 'POST', body: { visitorId: visitorId() } });
          detailsCache.set(code, { ...(detailsCache.get(code) || {}), chosenByMe: r.chosen, selectedCount: r.selectedCount });
          ui.note = on && r.notCounted ? (r.notCounted === 'demo' ? demoSavedText() : notCountedText(r.notCounted)) : '';
          if (!on) toast(t('col.cancelled'));
          ok = true;
        } catch (x) { ui.err = `${errorText(x)} ${tt('Попробуйте ещё раз.', 'Please try again.')}`; }
        ui.saving = false;
        if (ok && on) setTalk(true); else if (ok) setTalk(false); else renderBottom();
        if (!sheet.hidden) renderSheet();
        focusIn(ok && on ? '[data-questions]' : '[data-lib-choose], [data-guide]');
        return;
      }
      if (btn.hasAttribute('data-choose')) { if (ui.saving) return; ui.saving = true; ui.err = ''; renderBottom(); }
      btn.disabled = true;
      let ok = false;
      try {
        if (btn.hasAttribute('data-choose')) await opts.collection.choose(opts.cards[index].code);
        if (btn.hasAttribute('data-cancel')) await opts.collection.cancel();
        detailsCache.delete(opts.cards[index].code); // общее число изменилось — сведения перечитаем
        ok = true;
      } catch (x) { ui.err = `${errorText(x)} ${tt('Выбор не сохранён — попробуйте ещё раз.', 'The choice was not saved — please try again.')}`; }
      ui.saving = false;
      // Успех выбора — экран разговора; отмена — обычный просмотр.
      if (ok && btn.hasAttribute('data-choose')) setTalk(true);
      else if (ok) setTalk(false); else renderBottom();
      if (!sheet.hidden) renderSheet();
      focusIn(ok && btn.hasAttribute('data-choose') ? '[data-questions]' : '[data-choose]');
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
        ${opts.mode === 'library' && info && typeof info.comments === 'number' ? `<a class="sheet-link" href="${u('/cards/' + code)}">${esc(tt('Комментарии', 'Comments'))} · ${info.comments} →</a>` : ''}
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
    const ib = $('[data-info]'); if (ib && ib.closest('.viewer-top')) ib.setAttribute('aria-expanded', String(open));
    el.classList.toggle('sheet-open', open);
    if (open) renderSheet();
  }

  // ---------- кнопки и клавиатура ----------
  $('[data-close]').addEventListener('click', () => closeViewer());
  $('[data-full]').addEventListener('click', () => setFull(true));
  $('[data-unfull]').addEventListener('click', () => setFull(false));
  const topInfo = el.querySelector('.viewer-top [data-info]'); if (topInfo) topInfo.addEventListener('click', () => toggleSheet());
  $('[data-prev]').addEventListener('click', () => go(-1));
  $('[data-next]').addEventListener('click', () => go(1));
  sheet.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (a) { e.preventDefault(); const href = a.getAttribute('href'); teardown(); history.replaceState({}, '', href); window.dispatchEvent(new PopStateEvent('popstate')); return; }
    toggleSheet(false);
  });
  const onKey = (e) => {
    const inQ = mode.view === 'questions' && qpanel && qpanel.contains(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!sheet.hidden) toggleSheet(false);
      else if (mode.view === 'questions') setView('card');
      else if (mode.full) setFull(false);
      else closeViewer();
      return;
    }
    if (inQ || e.target.closest('.vt-seg') || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'i') toggleSheet();
    else if (e.key === 'f') setFull(!mode.full);
  };
  const onResize = () => { if (mode.view === 'questions') el.classList.toggle('q-side', wide()); syncBottom(); };
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  state.cleanup = () => {
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('fullscreenchange', onFsChange);
    window.removeEventListener('resize', onResize);
    clearTimeout(tapTimer);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };

  // Открыли выбранную карту подборки («К выбранной карте») — сразу экран разговора.
  if (opts.mode === 'collection' && opts.collection && opts.collection.state().choice === opts.cards[index].code) { mode.talk = true; el.classList.add('is-talk'); }
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
  questions: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M9.3 9.4a2.8 2.8 0 1 1 3.9 2.6c-.8.3-1.2.9-1.2 1.7v.6"/><path d="M12 17.1v.01"/></svg>',
  collapse: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10h6V4M20 14h-6v6M10 10L4 4M14 14l6 6"/></svg>',
  user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
  pair: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="8" r="3"/><circle cx="16.5" cy="9" r="2.6"/><path d="M2.5 20c0-3 2.6-5 5.5-5s5.5 2 5.5 5M13.5 15.3c.9-.4 1.9-.6 3-.6 2.6 0 5 1.8 5 4.6"/></svg>',
  group: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="3"/><circle cx="5" cy="10" r="2.3"/><circle cx="19" cy="10" r="2.3"/><path d="M7 20c0-3 2.2-5 5-5s5 2 5 5M1.5 19c0-2.2 1.6-3.8 3.6-3.8M22.5 19c0-2.2-1.6-3.8-3.6-3.8"/></svg>',
  cardHand: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="10" height="14" rx="2"/><path d="M15 9l4 1.2-3.2 10.8-6.6-2"/></svg>',
};
