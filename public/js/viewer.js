// Просмотр карты: целиком, с сохранением пропорций, увеличение щипком / двойным касанием, листание свайпом и стрелками.
// «Карта / Вопросы» (переключатель и свайп), «На весь экран» (в том числе без Fullscreen API), экран разговора после выбора. Кнопка «Назад» в браузере закрывает просмотр и возвращает к тому же месту в сетке.
import { t, dateLabel, lang } from './i18n.js';
import { esc, api, u, shareLink, tt, toast, visitorId, errorText, storage } from './util.js';
import { session } from './ui.js';
import { QUESTION_FORMATS, START_GUIDES } from './content.js';
import * as personal from './personal.js';
import { shareInvite, friendText, SLOGAN, sendInvite, copyInvite } from './share.js';

let current = null; // открытый просмотр
// новое поведение (скилл apple-design, vendor/hk-feel): карта листается за пальцем 1:1, бросок по скорости, пружины;
// касание срабатывает сразу; просмотр и лист «О карте» уходят тем же путём, что пришли. Прежнее — html[data-feel="old"].
const FEEL = () => !!(window.HKFeel && window.HKFeel.on());
const REDUCED = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

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
// изображения карт как файлы для системного меню «Поделиться» (общий кэш на сессию)
const cardFiles = new Map();
export function openViewer(opts) {
  if (current) teardown();
  const opener = document.activeElement;
  const root = document.getElementById('overlay-root');
  const el = document.createElement('div');
  const withQ = opts.mode !== 'admin'; // вопросы — у карт галереи и подборки встречи
  el.className = `viewer viewer--${opts.mode}`;
  // экранная клавиатура (23.11.2026): поле ввода в окне карты (название подборки, заметка) остаётся над клавиатурой —
  // нижняя панель поднимается на высоту клавиатуры, поле прокручивается в видимую область; после закрытия всё на месте
  const vv = window.visualViewport;
  const kbFit = () => {
    if (!vv) return; const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    el.style.setProperty('--kb', kb + 'px'); el.classList.toggle('kb-open', kb > 60);
    const f = document.activeElement; if (kb > 60 && f && el.contains(f) && /^(INPUT|TEXTAREA)$/.test(f.tagName)) f.scrollIntoView({ block: 'nearest' });
  };
  el.addEventListener('focusin', (e) => { if (!/^(INPUT|TEXTAREA)$/.test(e.target.tagName) || !vv) return; vv.addEventListener('resize', kbFit); vv.addEventListener('scroll', kbFit); setTimeout(kbFit, 250); setTimeout(kbFit, 600); });
  el.addEventListener('focusout', () => { if (!vv) return; setTimeout(() => { const f = document.activeElement; if (!(f && el.contains(f) && /^(INPUT|TEXTAREA)$/.test(f.tagName))) { vv.removeEventListener('resize', kbFit); vv.removeEventListener('scroll', kbFit); el.style.setProperty('--kb', '0px'); el.classList.remove('kb-open'); } }, 100); });
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', tt('Просмотр карты', 'Card view'));
  el.innerHTML = `
    <div class="viewer-stage" data-stage><img class="viewer-img" alt="" draggable="false" data-img></div>
    <div class="viewer-top">
      <span class="vt-start"><button class="icon-btn plain" type="button" data-close aria-label="${esc(t('viewer.close'))}" title="${esc(t('viewer.close'))}">${icons.close}</button></span>
      ${withQ ? `<div class="vt-seg" role="tablist" aria-label="${esc(tt('Что показать', 'What to show'))}">
        <button type="button" role="tab" data-view="card" aria-selected="true">${esc(tt('Карта', 'Card'))}</button>
        <button type="button" role="tab" data-view="questions" aria-selected="false">${esc(tt('Вопросы', 'Questions'))}</button></div>` : (opts.simple ? '' : '<span class="viewer-counter" data-counter></span>')}
      ${opts.simple ? '' : `<span class="vt-end">
        ${withQ ? '' : `<button class="icon-btn vt-nav" type="button" data-prev aria-label="${esc(t('viewer.prev'))}">${icons.prev}</button>
        <button class="icon-btn vt-nav" type="button" data-next aria-label="${esc(t('viewer.next'))}">${icons.next}</button>`}
        <button class="icon-btn plain full-btn" type="button" data-full aria-label="${esc(tt('На весь экран', 'Full screen'))}" title="${esc(tt('На весь экран', 'Full screen'))}">${icons.expand}</button>
        <button class="icon-btn plain full-btn" type="button" data-unfull hidden aria-label="${esc(tt('Выйти из полноэкранного режима', 'Exit full screen'))}" title="${esc(tt('Выйти из полноэкранного режима', 'Exit full screen'))}">${icons.collapse}</button>
        ${withQ ? '' : `<button class="icon-btn" type="button" data-info aria-label="${esc(t('viewer.info'))}" aria-expanded="false">${icons.info}</button>`}
      </span>`}
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
  // simple (22.11.2026): карта во весь экран с одним крестиком — без «О карте» и повторного раскрытия (форма обмена)
  const mode = { view: 'card', full: !!opts.simple, nativeFull: false, talk: false };
  if (opts.simple) el.classList.add('is-full', 'viewer--simple');
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
      if (slide) { slide.stop(); slide = null; }  // поймали летящую карту
      gesture = { type: 'pan', sx: e.clientX, sy: e.clientY, x: z.x, y: z.y, bx: z.s > 1.01 ? 0 : z.x, h: [[e.clientX, e.timeStamp]], moved: false, edge: e.clientX < EDGE || e.clientX > window.innerWidth - EDGE };
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
      else if (canFlip() && !gesture.edge) {
        if (FEEL()) { z.x = gesture.bx + dx; gesture.h.push([e.clientX, e.timeStamp]); while (gesture.h.length > 2 && e.timeStamp - gesture.h[0][1] > 100) gesture.h.shift(); }
        else z.x = dx * 0.5;  // прежнее: лёгкий отклик на свайп
        apply(false);
      }
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
      if (FEEL() && canFlip() && !g.edge && Math.abs(dx) > Math.abs(dy) && e.type !== 'pointercancel') { flick(g, e); return; }
      const horiz = Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.2;
      if (horiz && canFlip() && !g.edge) { go(dx < 0 ? 1 : -1); return; }
      z.x = 0; apply(true); return;
    }
    if (g.moved || e.type === 'pointercancel') return;
    // касание (22.11.2026): в полноэкранном просмотре двойное нажатие закрывает его и возвращает к прежнему виду
    // (обычная карта — окно с вопросами и действиями; просмотр из игры — сама игра, её поля и шаг не трогаем).
    // Увеличение — разведением пальцев; перемещение увеличенного изображения — одним пальцем (это не касание).
    // Одиночное: в обычном окне — на весь экран; в полноэкранном — спрятать/показать кнопки (после паузы, чтобы отличить от двойного).
    const now = Date.now();
    if (now - lastTap < 300) {
      clearTimeout(tapTimer); lastTap = 0;
      if (mode.full || opts.simple) { if (z.s > 1.01) zoomTo(1, 0, 0, false); if (opts.simple) closeViewer(); else setFull(false); return; }
      const [px, py] = rel(e);
      zoomTo(z.s > 1.01 ? 1 : 2.5, px, py, true);
    } else {
      lastTap = now;
      const act = () => { if (z.s > 1.01) return; if (!mode.full) setFull(true); else el.classList.toggle('chrome-hidden'); };
      if (FEEL() && !mode.full && !opts.simple) { act(); lastTap = 0; } else tapTimer = setTimeout(act, 300);
    }
  };
  // бросок карты: куда «долетит» по скорости — туда и листаем; карта уходит, продолжая движение пальца, новая входит с той же скоростью
  let slide = null;
  function flick(g, e) {
    const F = window.HKFeel, W = stage.clientWidth || window.innerWidth, h = g.h; let v = 0;
    if (h.length > 1 && e.timeStamp - h[h.length - 1][1] < 80 && h[h.length - 1][1] > h[0][1]) v = (h[h.length - 1][0] - h[0][0]) / (h[h.length - 1][1] - h[0][1]) * 1000;
    const proj = z.x + F.project(v);
    const d = Math.abs(proj) > W * 0.3 ? (proj < 0 ? 1 : -1) : 0;
    const move = (x) => { z.x = x; apply(false); };
    if (REDUCED()) { if (d) go(d); else move(0); return; }
    if (!d) { slide = F.spring({ from: z.x, to: 0, velocity: v, response: 0.35, damping: 1, onUpdate: move, onDone: () => { slide = null; } }); return; }
    slide = F.spring({ from: z.x, to: -d * W, velocity: v, response: 0.24, damping: 1, onUpdate: move,
      onDone: () => {
        go(d); move(d * W);
        slide = F.spring({ from: d * W, to: 0, velocity: v, response: 0.34, damping: 1, onUpdate: move, onDone: () => { slide = null; } });
      } });
  }
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
    if (opts.mode === 'library') prepFile(c);
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
  function syncNav() { el.querySelectorAll('[data-prev], [data-next]').forEach((b) => { b.hidden = !canFlip() || (mode.view === 'questions' && !el.classList.contains('q-side')); }); }
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
  const ui = { guide: false, guideKey: null, saving: false, err: '', share: '', note: '', noteOpen: false, friend: !!opts.playFriend, fav: false, how: false, sending: false, sent: null, sendErr: '' };
  // черновики остаются у своей карты при листании: заметка (не сохранённая) и текст для друга — отдельно
  const DKEY = 'dc_drafts';
  const drafts = (() => { try { return JSON.parse(sessionStorage.getItem(DKEY) || '{}'); } catch { return {}; } })();
  const draft = (code) => (drafts[code] = drafts[code] || {});
  const keepDrafts = () => { try { sessionStorage.setItem(DKEY, JSON.stringify(drafts)); } catch { /* */ } };
  let pstate = null; personal.load().then((s) => { pstate = s; renderBottom(); }).catch(() => {});
  const xCache = new Map();
  const loadX = (code) => api(`/api/exchanges?card=${encodeURIComponent(code)}`).then((d) => { xCache.set(code, d.exchanges); if (opts.cards[index].code === code) renderBottom(); }).catch(() => {});
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
      : chosen ? `${navRow()}
        <div class="vb-row"><div class="chosen-pill">${icons.check}<span>${esc(t('viewer.chosen'))}</span></div>${linkBtn('data-talk', 'Открыть экран разговора', 'Open conversation view')}</div>
        ${questionsBtn(true)}
        <div class="vb-row">${linkBtn('data-cancel', t('viewer.cancel'), t('viewer.cancel'))}${linkBtn('data-copy', 'Поделиться картой', 'Share card')}${linkBtn('data-info', 'О карте', 'About the card')}</div>
        ${shareField()}${note ? `<p class="viewer-count">${esc(note)}</p>` : ''}${countLine(info)}`
      : `${navRow()}
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
        const dr = draft(c.code);
        const saved = pstate && pstate.notes[c.code] ? pstate.notes[c.code].text : '';
        const noteVal = dr.note != null ? dr.note : saved;
        const fav = pstate && personal.isFav(pstate, c.code);
        // плашка «Друг ответил» убрана (21.11.2026): ответы — в уведомлениях и «Моих обменах»
        bottom.innerHTML = `
          <div class="vb-nav">
            <button class="icon-btn sm plain" type="button" data-prev aria-label="${esc(t('viewer.prev'))}" title="${esc(t('viewer.prev'))}">${icons.prev}</button>
            <span class="vb-icons">
              <button class="icon-btn sm ${fav ? 'is-on' : ''}" type="button" data-fav aria-pressed="${!!fav}" aria-label="${esc(fav ? tt('В избранном — подборки', 'In favourites — collections') : tt('В избранное', 'Add to favourites'))}" title="${esc(fav ? tt('В избранном', 'In favourites') : tt('В избранное', 'Add to favourites'))}">${fav ? icons.heartFull : icons.heart}</button>
              <button class="icon-btn sm" type="button" data-copy aria-label="${esc(tt('Поделиться картой', 'Share the card'))}" title="${esc(tt('Поделиться картой', 'Share the card'))}">${icons.shareBox}</button>
              <button class="icon-btn sm" type="button" data-info aria-label="${esc(tt('Сведения о карте', 'About the card'))}" title="${esc(tt('Сведения о карте', 'About the card'))}" aria-expanded="${!sheet.hidden}">${icons.info}</button>
            </span>
            <button class="icon-btn sm plain" type="button" data-next aria-label="${esc(t('viewer.next'))}" title="${esc(t('viewer.next'))}">${icons.next}</button>
          </div>
          ${ui.fav ? favPanel(c.code) : ''}
          ${shareField()}
          <div class="card-acts"><a class="btn yellow" href="${u('/play/' + c.code)}" data-xopen>${icons.pair}<span><span class="l1">${esc(tt('Отправить другу', 'Send to a friend'))}</span><span class="l2">${esc(tt('с вопросом', 'with a question'))}</span></span></a>
            <a class="btn pc-outline" href="${u('/postcard/' + c.code)}" data-xopen>${icons.mail}<span>${esc(tt('Отправить как открытку', 'Send as a postcard'))}</span></a></div>
          <div class="card-play"><a class="btn light" href="${u('/games')}" data-xopen>${icons.cube}<span>${esc(tt('Играть', 'Play'))}</span></a></div>`;
      }
    }
    syncNav();
    syncBottom();
  }
  // Сердце: сразу «Избранное», затем — свои подборки (отметки, новая подборка). Убрать из избранного ≠ убрать из подборки.
  function favPanel(code) {
    if (!pstate) return '';
    return `<div class="fav-pop" role="group" aria-label="${esc(tt('Подборки', 'Collections'))}">
      ${pstate.collections.map((col) => `<label class="check"><input type="checkbox" data-col="${esc(String(col.id))}" ${col.codes.includes(code) ? 'checked' : ''}> <span>${esc(col.favorites ? tt('Избранное', 'Favourites') : col.title)} <span class="muted small">· ${col.codes.length}</span></span></label>`).join('')}
      <form class="row" data-newcol><label class="sr-only" for="ncol">${esc(tt('Новая подборка', 'New collection'))}</label><input id="ncol" maxlength="80" placeholder="${esc(tt('Новая подборка…', 'New collection…'))}" style="flex:1;min-width:0"><button class="btn sm light" type="submit">${esc(tt('Создать', 'Create'))}</button></form>
      <div class="row between"><a class="small" href="${u('/me/collections')}" data-xopen>${esc(tt('Мои подборки', 'My collections'))}</a><button class="link-btn" type="button" data-fav-close>${esc(tt('Готово', 'Done'))}</button></div></div>`;
  }
  // «Сыграть с другом»: черновик для друга — отдельный от личной заметки (правка или отправка заметку не меняет).
  function friendForm(c, noteVal) {
    const dr = draft(c.code);
    const text = dr.friend != null ? dr.friend : noteVal;
    if (ui.sent && ui.sent.code === c.code) {
      const s = ui.sent;
      return `<div class="friend-form sent" role="region" aria-label="${esc(tt('Приглашение другу', 'Invitation for a friend'))}">
        <b>${esc(tt('Отправь приглашение другу', 'Send the invitation to your friend'))}</b>
        <p class="vb-note">${esc(tt('Выбери, где отправить, — и подтверди отправку там. Друг увидит твой ответ, когда напишет свой.', 'Choose where to send it and confirm there. Your friend will see your answer once they write theirs.'))}</p>
        <div class="share-row">${shareButtons()}</div>
        <p class="vb-note">${esc(tt('Твоя личная ссылка, чтобы вернуться к обмену (не пересылай её):', 'Your personal link back to the exchange (do not forward it):'))}</p>
        <div class="row"><button class="btn sm light" type="button" data-copy-back>${esc(tt('Скопировать мою ссылку', 'Copy my link'))}</button><a class="btn sm" href="${u('/x/' + s.secret)}" data-xopen>${esc(tt('Открыть обмен', 'Open exchange'))}</a></div>
        <button class="link-btn" type="button" data-friend-close>${esc(tt('Готово', 'Done'))}</button></div>`;
    }
    return `<div class="friend-form" role="region" aria-label="${esc(tt('Сыграть с другом', 'Play with a friend'))}">
      <label for="vf-${c.code}" class="note-q">${esc(tt('Что тебе откликнулось в этой карте?', 'What speaks to you in this card?'))}</label>
      <textarea id="vf-${c.code}" data-friend-text rows="3" maxlength="300" placeholder="${esc(tt('Напиши пару слов', 'Write a few words'))}">${esc(text)}</textarea>
      ${session.user ? '' : `<label class="field small">${esc(tt('Твоё имя для друга', 'Your name for your friend'))}<input data-friend-name maxlength="40" value="${esc(dr.name || storage.get('dc_live_name') || '')}" autocomplete="given-name"></label>`}
      <p class="vb-note">${esc(tt('Друг увидит твой ответ, когда напишет свой.', 'Your friend will see your answer once they write theirs.'))} <button class="link-btn" type="button" data-how aria-expanded="${ui.how}">${esc(tt('Как это работает', 'How it works'))}</button></p>
      ${ui.how ? `<ol class="vb-note" style="margin:0;padding-left:1.2em"><li>${esc(tt('Ты отправляешь карту и свой ответ — ответ пока скрыт.', 'You send the card and your answer — the answer stays hidden.'))}</li><li>${esc(tt('Друг пишет, что видит он.', 'Your friend writes what they see.'))}</li><li>${esc(tt('Вы оба видите два взгляда на одну карту.', 'You both see two views of one card.'))}</li></ol>` : ''}
      ${ui.sendErr ? `<p class="field-error" role="alert">${esc(ui.sendErr)}</p>` : ''}
      <div class="row"><button class="btn yellow" type="button" data-friend-send ${ui.sending || !String(text).trim() ? 'disabled' : ''}>${esc(ui.sending ? tt('Готовим приглашение…', 'Preparing…') : tt('Отправить другу', 'Send to a friend'))}</button>
        <button class="link-btn" type="button" data-friend-close>${esc(tt('Отмена', 'Cancel'))}</button></div></div>`;
  }
  const shareButtons = () => `<button class="btn sm" type="button" data-sh="tg">Telegram</button><button class="btn sm" type="button" data-sh="wa">WhatsApp</button>${navigator.share ? `<button class="btn sm" type="button" data-sh="sys">${esc(tt('Другие приложения', 'Other apps'))}</button>` : ''}<button class="btn sm light" type="button" data-sh="copy">${esc(tt('Скопировать ссылку', 'Copy link'))}</button>`;
  const navRow = () => (opts.cards.length > 1 ? `<div class="vb-nav"><button class="icon-btn sm plain" type="button" data-prev aria-label="${esc(t('viewer.prev'))}" title="${esc(t('viewer.prev'))}">${icons.prev}</button><span class="small muted">${index + 1} / ${opts.cards.length}</span><button class="icon-btn sm plain" type="button" data-next aria-label="${esc(t('viewer.next'))}" title="${esc(t('viewer.next'))}">${icons.next}</button></div>` : '');
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
    if (!QUESTION_FORMATS.some((x) => x.key === qs.format)) qs.format = 'self'; // сразу содержание категории, без пояснения «выберите»
    const f = QUESTION_FORMATS.find((x) => x.key === qs.format);
    let body;
    if (!f.lists || !f.lists.length) body = `<p class="q-pending">${esc(L(f.pending) || tt('Вопросы готовятся.', 'Questions are being prepared.'))}</p>${f.link ? `<a class="btn yellow" href="${u(f.link)}" data-q-go>${icons.group} ${esc(tt('Играть с компанией', 'Play with friends'))}</a>` : ''}`;
    else if (f.lists.length === 1) {
      const cur = f.lists[0]; qs.list = cur.key;
      body = `${f.note ? `<p class="q-note">${esc(L(f.note))}</p>` : ''}<ol class="qlist" id="ql">${(cur.items[lang] || cur.items.ru).map((q) => `<li>${esc(q)}</li>`).join('')}</ol>`;
    }
    else {
      const cur = f.lists.find((x) => x.key === qs.list) || f.lists[0];
      qs.list = cur.key;
      body = `<div class="qtabs" role="tablist" aria-label="${esc(tt('Кто задаёт вопросы', 'Who asks'))}">${f.lists.map((x) => `<button type="button" role="tab" id="qt-${x.key}" aria-controls="ql" aria-selected="${x.key === cur.key}" tabindex="${x.key === cur.key ? 0 : -1}" data-q-list="${x.key}">${x.key === 'partner' ? icons.user : icons.cardHand}<span>${esc(L(x.title))}</span></button>`).join('')}</div>
        <ul class="qlist" id="ql" role="tabpanel" aria-labelledby="qt-${cur.key}">${(cur.items[lang] || cur.items.ru).map((q) => `<li>${esc(q)}</li>`).join('')}</ul>`;
    }
    // «Поиграем?»: для себя — игры для одного, для двоих — игры компанией
    // «Поиграем?»: для себя — игры для одного; для двоих и для группы — игры для компании
    if (f && f.play && f.lists) body += `<a class="btn q-play" href="${u(f.play)}" data-q-go>${esc(tt('Поиграем?', 'Shall we play?'))}</a>`;
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
      // к играм и обратно: «Назад» вернёт к этой же карте с открытыми вопросами того же сценария
      if (go) { e.preventDefault(); const href = go.getAttribute('href'); try { sessionStorage.setItem('dc_q_return', JSON.stringify({ code: opts.cards[index].code, format: qs.format, at: Date.now() })); } catch { /* */ } teardown(); if (window.dcNavigate) window.dcNavigate(href.slice(u('').length) || '/'); else location.href = href; return; }
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
    // во весь экран: карта целиком по центру между верхними кнопками и нижней безопасной зоной
    el.style.setProperty('--bottom', mode.full ? 'calc(12px + var(--safe-b, 0px))' : hideBottom ? '0px' : `${bottom.offsetHeight + 4}px`);
    layout();
  }
  // «Поделиться картой»: системное меню, где оно есть; иначе копирование. Отмена — без сообщений; не вышло — показываем ссылку.
  // изображение текущей карты как файл — заранее, чтобы системное меню открылось сразу по нажатию
  function prepFile(c) {
    if (!navigator.canShare || cardFiles.has(c.code)) return; cardFiles.set(c.code, null);
    fetch(c.full || c.thumb).then((r) => r.blob()).then((b) => { const ext = (b.type.split('/')[1] || 'webp').replace('jpeg', 'jpg'); cardFiles.set(c.code, new File([b], `dialogue-cards-${c.code}.${ext}`, { type: b.type || 'image/webp' })); }).catch(() => cardFiles.delete(c.code));
  }
  async function copyLink() {
    // делимся самой картой с авторством — без личного текста; ссылка ведёт на эту карту в галерее
    const c0 = opts.cards[index]; const inf = detailsCache.get(c0.code);
    const url = shareLink('/play/' + encodeURIComponent(c0.code)); // публичная ссылка карты: получатель начнёт свой обмен
    // 21.11.2026: одно нажатие — сразу системное меню; изображение карты, если меню умеет принимать файлы (подготовлено заранее)
    const text = `${SLOGAN()} ${c0.code}${inf && inf.author ? ' · ' + inf.author : ''}`;
    if (navigator.share) {
      const file = cardFiles.get(c0.code);
      try {
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: 'Dialogue Cards', text: `${text}\n${url}` });
        else await navigator.share({ title: 'Dialogue Cards', text, url });
        return;
      } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); toast(tt('Ссылка на карту скопирована', 'Card link copied')); }
    catch { ui.share = url; renderBottom(); const inp = bottom.querySelector('[data-share-url]'); if (inp) { inp.focus(); inp.select(); } }
  }
  const focusIn = (sel) => { const n = bottom && bottom.querySelector(sel); if (n) n.focus({ preventScroll: true }); };
  if (bottom) {
    // ввод без перерисовки: фокус и курсор остаются на месте
    bottom.addEventListener('focusin', (e) => {
      const ta = e.target.closest('[data-note]');
      if (ta) { ui.noteOpen = true; ta.rows = 3; ta.closest('.note-box').classList.add('open'); requestAnimationFrame(syncBottom); }
    });
    bottom.addEventListener('input', (e) => {
      const code = opts.cards[index].code; const dr = draft(code);
      if (e.target.matches('[data-note]')) {
        dr.note = e.target.value; keepDrafts();
        const saved = pstate && pstate.notes[code] ? pstate.notes[code].text : '';
        const b = bottom.querySelector('[data-note-save]'); if (b) { b.disabled = dr.note === saved; b.textContent = tt('Сохранить заметку', 'Save note'); }
      } else if (e.target.matches('[data-friend-text]')) {
        dr.friend = e.target.value; keepDrafts();
        const b = bottom.querySelector('[data-friend-send]'); if (b) b.disabled = ui.sending || !e.target.value.trim();
      } else if (e.target.matches('[data-friend-name]')) { dr.name = e.target.value; keepDrafts(); }
    });
    bottom.addEventListener('submit', async (e) => {
      const f = e.target.closest('[data-newcol]'); if (!f) return;
      e.preventDefault(); const inp = f.querySelector('input'); const t0 = inp.value.trim(); if (!t0) return;
      try { const id = await personal.createCollection(t0); await personal.toggle(id, opts.cards[index].code, true); pstate = await personal.load(); renderBottom(); focusIn('[data-fav-close]'); }
      catch (x) { toast(errorText(x)); }
    });
    bottom.addEventListener('change', async (e) => {
      const cb = e.target.closest('[data-col]'); if (!cb) return;
      try { await personal.toggle(cb.dataset.col, opts.cards[index].code, cb.checked); pstate = await personal.load(); }
      catch (x) { cb.checked = !cb.checked; toast(x.code === 'collection_full' ? tt('В подборке уже 40 карт', 'The collection already has 40 cards') : errorText(x)); }
      const cur = bottom.querySelector('[data-fav]'); const on = personal.isFav(pstate, opts.cards[index].code);
      if (cur) { cur.classList.toggle('is-on', on); cur.setAttribute('aria-pressed', String(on)); cur.innerHTML = on ? icons.heartFull : icons.heart; }
    });
    bottom.addEventListener('click', async (e) => {
      const xo = e.target.closest('a[data-xopen]');
      // переход из открытой карты (обмен, открытка, игры): новая запись истории — «Назад» вернёт к этой же карте
      if (xo) { e.preventDefault(); const href = xo.getAttribute('href'); teardown(); if (window.dcNavigate) window.dcNavigate(href.slice(u('').length) || '/'); else location.href = href; return; }
      const cb0 = e.target.closest('button'); const code0 = opts.cards[index].code;
      if (cb0 && (cb0.type === 'submit' || cb0.closest('form'))) return; // формы (новая подборка) — своим обработчиком submit
      if (cb0 && cb0.hasAttribute('data-fav')) {
        if (!pstate) pstate = await personal.load();
        // первое нажатие сразу сохраняет в «Избранное» и предлагает подборки; повторное — открывает или закрывает выбор подборок
        if (!personal.isFav(pstate, code0)) { try { await personal.toggle('favorites', code0, true); pstate = await personal.load(); ui.fav = true; } catch (x) { toast(errorText(x)); return; } }
        else ui.fav = !ui.fav;
        renderBottom(); focusIn(ui.fav ? '[data-col]' : '[data-fav]'); return;
      }
      if (cb0 && cb0.hasAttribute('data-fav-close')) { ui.fav = false; renderBottom(); focusIn('[data-fav]'); return; }
      if (cb0 && cb0.hasAttribute('data-note-save')) {
        const dr = draft(code0); const v = dr.note != null ? dr.note : '';
        cb0.disabled = true;
        try { await personal.setNote(code0, v); delete dr.note; keepDrafts(); pstate = await personal.load(); ui.noteOpen = false; renderBottom(); toast(tt('Заметка сохранена', 'Note saved')); }
        catch (x) { cb0.disabled = false; toast(errorText(x)); }
        return;
      }
      if (cb0 && cb0.hasAttribute('data-friend')) { ui.friend = true; ui.sent = null; ui.sendErr = ''; renderBottom(); focusIn('[data-friend-text]'); return; }
      if (cb0 && cb0.hasAttribute('data-friend-close')) { ui.friend = false; ui.sent = null; renderBottom(); focusIn('[data-friend]'); return; }
      if (cb0 && cb0.hasAttribute('data-how')) { ui.how = !ui.how; renderBottom(); focusIn('[data-how]'); return; }
      if (cb0 && cb0.hasAttribute('data-friend-send')) {
        const dr = draft(code0); const saved = pstate && pstate.notes[code0] ? pstate.notes[code0].text : '';
        const text = String(dr.friend != null ? dr.friend : (dr.note != null ? dr.note : saved)).trim(); if (!text) return;
        if (dr.name) storage.set('dc_live_name', dr.name);
        // повтор после обрыва сети — тот же ключ, вторая запись не создаётся
        dr.key = dr.key || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9_-]/g, '');
        keepDrafts(); ui.sending = true; ui.sendErr = ''; renderBottom();
        try {
          const r = await api('/api/exchanges', { method: 'POST', body: { code: code0, text, name: dr.name || '', clientKey: dr.key } });
          ui.sent = { code: code0, secret: r.secret, invite: r.invite, name: dr.name || (session.user && session.user.publicName) || '' };
          delete dr.friend; delete dr.key; keepDrafts(); xCache.delete(code0);
        } catch (x) { ui.sendErr = `${errorText(x)} ${tt('Текст сохранён — попробуйте ещё раз.', 'Your text is kept — try again.')}`; }
        ui.sending = false; renderBottom(); focusIn('[data-sh]'); return;
      }
      if (cb0 && cb0.dataset.sh && ui.sent) { (cb0.dataset.sh === 'copy' ? copyInvite : sendInvite)(shareLink('/x/' + ui.sent.invite)); return; }
      if (cb0 && cb0.hasAttribute('data-copy-back') && ui.sent) { shareInvite('copy', `${location.origin}${u('/x/' + ui.sent.secret)}`, '', tt('Личная ссылка скопирована — сохраните её', 'Personal link copied — keep it')); return; }
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
      if (!btn.hasAttribute('data-choose') && !btn.hasAttribute('data-cancel')) return; // прочие кнопки уже обработаны выше
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
`;
    };
    draw(d || c);
    if (!d && opts.mode !== 'admin') {
      try { d = await fetchDetails(code); draw(d); } catch { /* показываем то, что есть */ }
    }
  }
  let sheetCtl = null;
  function toggleSheet(force) {
    const open = force ?? (sheet.hidden || (sheetCtl && !sheetCtl.open));
    if (FEEL() && !REDUCED()) {
      // лист «О карте» — на пружине: выезжает, тянется за пальцем вниз, закрывается броском и уходит вниз
      sheetCtl = sheetCtl || window.HKFeel.sheet({ el: sheet, scroller: () => sheet, onClosed: () => { if (!sheetCtl.open) { sheet.hidden = true; sheetSync(false); } } });
      if (open) { sheet.hidden = false; sheetSync(true); sheetCtl.show(); } else if (!sheet.hidden && sheetCtl.open) sheetCtl.hide();
      return;
    }
    sheet.hidden = !open;
    sheetSync(open);
  }
  function sheetSync(open) {
    const ib = $('[data-info]'); if (ib && ib.closest('.viewer-top')) ib.setAttribute('aria-expanded', String(open));
    el.classList.toggle('sheet-open', open);
    if (open) renderSheet();
  }

  // ---------- кнопки и клавиатура ----------
  // в раскрытом режиме галереи крестик возвращает к обычному просмотру карты; в простом режиме — закрывает просмотр
  $('[data-close]').addEventListener('click', () => (mode.full && !opts.simple ? setFull(false) : closeViewer()));
  if (!opts.simple) { $('[data-full]').addEventListener('click', () => setFull(true)); $('[data-unfull]').addEventListener('click', () => setFull(false)); }
  const topInfo = el.querySelector('.viewer-top [data-info]'); if (topInfo) topInfo.addEventListener('click', () => toggleSheet());
  el.addEventListener('click', (e) => { if (e.target.closest('[data-prev]')) go(-1); else if (e.target.closest('[data-next]')) go(1); });
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
      else if (mode.full && !opts.simple) setFull(false); // простой просмотр (обмен): Escape закрывает, как крестик
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
  // центрирование держится после загрузки картинки, смены высоты нижней панели (шрифты, раскрытые блоки)
  // и изменения видимой области (панели браузера, поворот, клавиатура) — 23.11.2026
  const ro = 'ResizeObserver' in window && bottom ? new ResizeObserver(() => { if (!el.classList.contains('kb-open')) syncBottom(); }) : null;
  if (ro) ro.observe(bottom);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
  const imgEl = el.querySelector('[data-img]'); if (imgEl) imgEl.addEventListener('load', () => layout());
  state.cleanup = () => {
    if (ro) ro.disconnect(); if (window.visualViewport) window.visualViewport.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('fullscreenchange', onFsChange);
    window.removeEventListener('resize', onResize);
    clearTimeout(tapTimer);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };

  // Открыли выбранную карту подборки («К выбранной карте») — сразу экран разговора.
  if (opts.mode === 'collection' && opts.collection && opts.collection.state().choice === opts.cards[index].code) { mode.talk = true; el.classList.add('is-talk'); }
  requestAnimationFrame(() => { el.classList.add('is-open'); show(); $('[data-close]').focus({ preventScroll: true }); if (opts.startQuestions && withQ) openQ(opts.startQuestions); });
  return state;
}

function teardown() {
  if (!current) return;
  const { el, opener, cleanup, opts } = current;
  cleanup && cleanup();
  current = null;
  if (FEEL() && !REDUCED()) { el.classList.remove('is-open'); el.style.pointerEvents = 'none'; setTimeout(() => el.remove(), 200); }  // гаснет, как появлялся
  else el.remove();
  document.body.classList.remove('no-scroll');
  if (opener && opener.focus && document.contains(opener)) opener.focus({ preventScroll: true });
  if (opts.onClose) opts.onClose();
}

export function refreshViewer() { if (current) current.refreshBottom(); }

export const icons = {
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>',
  cube: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/></svg>',
  mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5 12 13l8.5-6.5"/></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/></svg>',
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.3s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"/></svg>',
  heartFull: '<svg viewBox="0 0 24 24" aria-hidden="true" class="filled"><path d="M12 20.3s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"/></svg>',
  shareBox: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v11M8 7.5l4-4 4 4"/><path d="M6.5 11H5v9h14v-9h-1.5"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  expand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5M10 19H5v-5"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  questions: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M9.3 9.4a2.8 2.8 0 1 1 3.9 2.6c-.8.3-1.2.9-1.2 1.7v.6"/><path d="M12 17.1v.01"/></svg>',
  collapse: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 10h-5V5M5 14h5v5"/></svg>',
  user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
  pair: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="8" r="3"/><circle cx="16.5" cy="9" r="2.6"/><path d="M2.5 20c0-3 2.6-5 5.5-5s5.5 2 5.5 5M13.5 15.3c.9-.4 1.9-.6 3-.6 2.6 0 5 1.8 5 4.6"/></svg>',
  group: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="3"/><circle cx="5" cy="10" r="2.3"/><circle cx="19" cy="10" r="2.3"/><path d="M7 20c0-3 2.2-5 5-5s5 2 5 5M1.5 19c0-2.2 1.6-3.8 3.6-3.8M22.5 19c0-2.2-1.6-3.8-3.6-3.8"/></svg>',
  cardHand: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="10" height="14" rx="2"/><path d="M15 9l4 1.2-3.2 10.8-6.6-2"/></svg>',
};
