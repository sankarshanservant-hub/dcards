// Полноэкранный просмотр карты: целиком, с сохранением пропорций, увеличение щипком / двойным касанием,
// листание свайпом и стрелками. Кнопка «Назад» в браузере закрывает просмотр и возвращает к тому же месту в сетке.
import { t, dateLabel, lang } from './i18n.js';
import { esc, api, u, tt, toast, visitorId, errorText } from './util.js';
import { QUESTION_FORMATS, START_GUIDES } from './content.js';

let current = null; // открытый просмотр

export function isViewerOpen() { return !!current; }

/** Вызывается из общего обработчика popstate. */
export function handleViewerPopState() {
  if (current && !(history.state && history.state.viewer)) teardown();
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
    <div class="viewer-sheet" data-sheet hidden></div>
    <section class="qpanel" data-qpanel hidden role="dialog" aria-modal="false" aria-labelledby="qp-title"></section>`;
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
  const ui = { guide: false, guideKey: null, saving: false, err: '', share: '', note: '' };
  const L = (o) => (o && (o[lang] || o.ru)) || '';
  const chev = (open) => `<span class="chev ${open ? 'open' : ''}" aria-hidden="true">▾</span>`;
  const countLine = (info) => (info && typeof info.selectedCount === 'number'
    ? `<p class="choose-count">${esc(info.selectedCount ? t('viewer.selectedCount', { n: info.selectedCount }) : t('viewer.selectedNone'))}</p>` : '');
  const shareRow = () => `<div class="vb-row"><button class="link-btn" type="button" data-copy>${esc(tt('Поделиться картой', 'Share card'))}</button>
      ${ui.share ? '' : ''}</div>${ui.share ? `<label class="field small">${esc(tt('Скопируйте ссылку:', 'Copy the link:'))}<input type="text" readonly value="${esc(ui.share)}" data-share-url></label>` : ''}`;
  const questionsBtn = (primary) => `<button class="btn ${primary ? 'yellow wide' : 'light sm'}" type="button" data-questions aria-haspopup="dialog">${icons.questions} ${esc(primary ? tt('Вопросы для собеседника', 'Questions for your partner') : tt('Вопросы', 'Questions'))}</button>`;
  function renderBottom() {
    if (!bottom) return;
    const c = opts.cards[index];
    const info = detailsCache.get(c.code);
    if (!info) fetchDetails(c.code).then(() => { if (opts.cards[index].code === c.code) renderBottom(); }).catch(() => {});
    if (opts.mode === 'collection' && opts.collection) {
      const { choice } = opts.collection.state();
      const chosen = choice === c.code;
      const nc = opts.collection.notCountedFor ? opts.collection.notCountedFor(c.code) : null;
      bottom.innerHTML = chosen ? `
        <div class="vb-row"><div class="chosen-pill">${icons.check}<span>${esc(t('viewer.chosen'))}</span></div>
          <button class="link-btn" type="button" data-cancel>${esc(t('viewer.cancel'))}</button></div>
        ${opts.collection.isTest ? `<p class="viewer-count">${esc(opts.collection.isDemo ? demoSavedText() : t('viewer.testNoCount'))}</p>` : nc ? `<p class="viewer-count">${esc(notCountedText(nc))}</p>` : ''}
        ${questionsBtn(true)}
        ${shareRow()}${countLine(info)}`
      : `
        <button class="btn yellow wide" type="button" data-choose ${ui.saving ? 'disabled aria-busy="true"' : ''}>${esc(ui.saving ? tt('Сохраняем…', 'Saving…') : t(choice ? 'viewer.chooseInstead' : 'viewer.choose'))}</button>
        ${ui.err ? `<p class="field-error" role="alert">${esc(ui.err)}</p>` : choice ? `<p class="viewer-count">${esc(t('viewer.chooseInsteadHint'))}</p>` : ''}
        <div class="vb-row">${questionsBtn(false)}<button class="link-btn" type="button" data-copy>${esc(tt('Поделиться картой', 'Share card'))}</button></div>
        ${ui.share ? `<label class="field small">${esc(tt('Скопируйте ссылку:', 'Copy the link:'))}<input type="text" readonly value="${esc(ui.share)}" data-share-url></label>` : ''}
        ${countLine(info)}`;
    } else if (opts.mode === 'library') {
      const g = START_GUIDES.find((x) => x.key === ui.guideKey);
      bottom.innerHTML = `
        <div class="vb-panel">
          <button class="vb-toggle" type="button" data-guide aria-expanded="${ui.guide}"><span>${esc(tt('С чего начать?', 'Where to start?'))}<small>${esc(tt('Для себя, вдвоём или в группе — выберите подходящий вариант', 'On your own, with someone or in a group — pick what suits you'))}</small></span>${chev(ui.guide)}</button>
          ${ui.guide ? `<div class="vb-body"><div class="seg" role="radiogroup" aria-label="${esc(tt('Как смотреть карту', 'How to use the card'))}">${START_GUIDES.map((x) => `<button type="button" role="radio" data-g="${x.key}" aria-checked="${x.key === ui.guideKey}" tabindex="${x.key === (ui.guideKey || START_GUIDES[0].key) ? 0 : -1}">${esc(L(x.title))}</button>`).join('')}</div>
            ${g ? `<div class="vb-guide"><p>${esc(L(g.text))}</p>${g.hints ? `<ul>${(g.hints[lang] || g.hints.ru).map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
              ${g.choose ? libChoiceHtml(info) : ''}</div>` : ''}</div>` : ''}
        </div>
        <div class="vb-actions">${questionsBtn(false).replace('light sm', 'light sm')}<a class="btn light sm" href="${u('/cards/' + c.code)}" data-discuss>${esc(tt('Комментарии', 'Comments'))}${info && typeof info.comments === 'number' ? ` · ${info.comments}` : ''}</a></div>
        <div class="vb-row"><button class="link-btn" type="button" data-copy>${esc(tt('Поделиться картой', 'Share card'))}</button>${countLine(info).replace('<p class="choose-count">', '<p class="choose-count" style="text-align:right">')}</div>
        ${ui.share ? `<label class="field small">${esc(tt('Скопируйте ссылку:', 'Copy the link:'))}<input type="text" readonly value="${esc(ui.share)}" data-share-url></label>` : ''}`;
    }
    syncBottom();
  }
  // Необязательный выбор для обсуждения в галерее (внутри «Вдвоём» и «В группе»): сохранение → «Выбрано для обсуждения».
  function libChoiceHtml(info) {
    if (!info) return '';
    if (info.chosenByMe) return `<div class="vb-choice"><div class="chosen-pill">${icons.check}<span>${esc(t('viewer.chosen'))}</span></div><button class="link-btn" type="button" data-lib-unchoose>${esc(t('viewer.cancel'))}</button></div>${ui.note ? `<p class="vb-note">${esc(ui.note)}</p>` : ''}`;
    return `<div class="vb-choice"><button class="btn yellow sm" type="button" data-lib-choose ${ui.saving ? 'disabled aria-busy="true"' : ''}>${esc(ui.saving ? tt('Сохраняем…', 'Saving…') : t('viewer.choose'))}</button><span class="vb-note">${esc(tt('по желанию', 'optional'))}</span></div>${ui.err ? `<p class="field-error" role="alert">${esc(ui.err)}</p>` : ''}`;
  }

  // ---------- панель «Вопросы»: формат → (в паре) два списка с переключателем ----------
  const qs = { open: false, format: null, list: 'partner', returnTo: null };
  const formats = () => QUESTION_FORMATS.filter((f) => f.lists && f.lists.length);
  const FORMAT_ICON = { self: icons.user, pair: icons.pair, group: icons.group };
  function renderQ() {
    const f = formats().find((x) => x.key === qs.format);
    const head = (title, back) => `<div class="qpanel-head">${back ? `<button class="btn light sm" type="button" data-q-back>${icons.prev} ${esc(tt('Назад', 'Back'))}</button>` : ''}
        <h2 id="qp-title">${esc(title)}</h2><button class="icon-btn" type="button" data-q-close aria-label="${esc(tt('Закрыть вопросы', 'Close questions'))}">${icons.close}</button></div>`;
    if (!f) {
      qpanel.innerHTML = head(tt('Вопросы', 'Questions'), false) + `<div class="qpanel-body"><p class="vb-note" style="margin:0">${esc(tt('Выберите формат разговора', 'Choose how you are talking'))}</p>
        <div class="qformats">${formats().map((x) => `<button class="qformat" type="button" data-q-format="${x.key}"><span class="ic">${FORMAT_ICON[x.key] || ''}</span>${esc(L(x.title))}</button>`).join('')}</div></div>`;
      return;
    }
    const cur = f.lists.find((x) => x.key === qs.list) || f.lists[0];
    qpanel.innerHTML = head(L(f.title), true) + `<div class="qpanel-body">
      <div class="qtabs" role="tablist" aria-label="${esc(tt('Кто задаёт вопросы', 'Who asks'))}">${f.lists.map((x) => `<button type="button" role="tab" id="qt-${x.key}" aria-controls="ql" aria-selected="${x.key === cur.key}" tabindex="${x.key === cur.key ? 0 : -1}" data-q-list="${x.key}">${x.key === 'partner' ? icons.user : icons.cardHand}<span>${esc(L(x.title))}</span></button>`).join('')}</div>
      <ul class="qlist" id="ql" role="tabpanel" aria-labelledby="qt-${cur.key}">${(cur.items[lang] || cur.items.ru).map((q) => `<li>${esc(q)}</li>`).join('')}</ul></div>`;
  }
  function openQ(format = null, from = null) {
    qs.open = true; qs.format = format; qs.returnTo = from;
    if (format && !formats().some((x) => x.key === format)) qs.format = null;
    if (!qs.list) qs.list = 'partner';
    qpanel.hidden = false; renderQ();
    (qpanel.querySelector('[data-q-format], [role="tab"][aria-selected="true"], [data-q-close]') || qpanel).focus();
  }
  function closeQ() {
    qs.open = false; qpanel.hidden = true; qpanel.innerHTML = '';
    const back = qs.returnTo && document.contains(qs.returnTo) ? qs.returnTo : bottom && bottom.querySelector('[data-questions]');
    if (back) back.focus({ preventScroll: true });
  }
  qpanel.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-q-close')) return closeQ();
    if (b.hasAttribute('data-q-back')) { qs.format = null; renderQ(); (qpanel.querySelector('[data-q-format]') || qpanel).focus(); return; }
    if (b.dataset.qFormat) { qs.format = b.dataset.qFormat; qs.list = 'partner'; renderQ(); (qpanel.querySelector('[role="tab"][aria-selected="true"]') || qpanel).focus(); return; }
    if (b.dataset.qList) { qs.list = b.dataset.qList; renderQ(); qpanel.querySelector(`#qt-${qs.list}`).focus(); }
  });
  qpanel.addEventListener('keydown', (e) => {
    const tab = e.target.closest('[role="tab"]');
    if (tab && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault(); e.stopPropagation();
      const tabs = [...qpanel.querySelectorAll('[role="tab"]')]; const i = tabs.indexOf(tab);
      const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
      qs.list = n.dataset.qList; renderQ(); qpanel.querySelector(`#qt-${qs.list}`).focus();
    }
  });
  // Высота панели снизу → место для картинки (картинка всегда целиком и не под панелью).
  function syncBottom() {
    if (!bottom) return;
    el.style.setProperty('--bottom', `${bottom.offsetHeight + 4}px`);
    layout();
  }
  // «Поделиться картой»: системное меню, где оно есть; иначе копирование. Отмена — без сообщений; не вышло — показываем саму ссылку.
  async function copyLink() {
    const url = location.href;
    if (navigator.share) {
      try { await navigator.share({ title: 'Dialogue Cards', url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); toast(tt('Ссылка скопирована', 'Link copied')); }
    catch { ui.share = url; renderBottom(); const inp = bottom.querySelector('[data-share-url]'); if (inp) { inp.focus(); inp.select(); } }
  }
  if (bottom) {
    bottom.addEventListener('click', async (e) => {
      const a = e.target.closest('a[data-discuss]');
      if (a) { e.preventDefault(); const href = a.getAttribute('href'); teardown(); history.replaceState({}, '', href); window.dispatchEvent(new PopStateEvent('popstate')); return; }
      const btn = e.target.closest('button'); if (!btn) return;
      if (btn.hasAttribute('data-questions')) { const chosenHere = opts.mode === 'collection' && opts.collection && opts.collection.state().choice === opts.cards[index].code; openQ(chosenHere ? 'pair' : null, btn); return; }
      if (btn.hasAttribute('data-guide')) { ui.guide = !ui.guide; renderBottom(); return; }
      if (btn.dataset.g) { ui.guideKey = btn.dataset.g; ui.err = ''; renderBottom(); const r = bottom.querySelector(`[data-g="${ui.guideKey}"]`); if (r) r.focus(); return; }
      if (btn.hasAttribute('data-copy')) { copyLink(); return; }
      if (btn.hasAttribute('data-lib-choose') || btn.hasAttribute('data-lib-unchoose')) {
        const code = opts.cards[index].code; const on = btn.hasAttribute('data-lib-choose');
        ui.saving = on; ui.err = ''; ui.note = ''; renderBottom();
        try {
          const r = await api(`/api/cards/${encodeURIComponent(code)}/${on ? 'choose' : 'unchoose'}`, { method: 'POST', body: { visitorId: visitorId() } });
          detailsCache.set(code, { ...(detailsCache.get(code) || {}), chosenByMe: r.chosen, selectedCount: r.selectedCount });
          ui.note = on && r.notCounted ? (r.notCounted === 'demo' ? demoSavedText() : notCountedText(r.notCounted)) : '';
          if (!on) toast(t('col.cancelled'));
        } catch (x) { ui.err = `${errorText(x)} ${tt('Попробуйте ещё раз.', 'Please try again.')}`; }
        ui.saving = false; renderBottom(); if (!sheet.hidden) renderSheet();
        return;
      }
      if (btn.hasAttribute('data-choose')) { ui.saving = true; ui.err = ''; renderBottom(); }
      btn.disabled = true;
      try {
        if (btn.hasAttribute('data-choose')) await opts.collection.choose(opts.cards[index].code);
        if (btn.hasAttribute('data-cancel')) await opts.collection.cancel();
        detailsCache.delete(opts.cards[index].code); // общее число изменилось — сведения перечитаем
      } catch (x) { ui.err = `${errorText(x)} ${tt('Выбор не сохранён — попробуйте ещё раз.', 'The choice was not saved — please try again.')}`; }
      finally { ui.saving = false; renderBottom(); if (!sheet.hidden) renderSheet(); }
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
    if (qs.open) { if (e.key === 'Escape') { e.preventDefault(); closeQ(); } return; }
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
  questions: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/><path d="M9.8 8.6a2.3 2.3 0 1 1 3 2.2c-.6.2-.8.6-.8 1.2M12 13.9v.01"/></svg>',
  user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
  pair: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="8" r="3"/><circle cx="16.5" cy="9" r="2.6"/><path d="M2.5 20c0-3 2.6-5 5.5-5s5.5 2 5.5 5M13.5 15.3c.9-.4 1.9-.6 3-.6 2.6 0 5 1.8 5 4.6"/></svg>',
  group: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="3"/><circle cx="5" cy="10" r="2.3"/><circle cx="19" cy="10" r="2.3"/><path d="M7 20c0-3 2.2-5 5-5s5 2 5 5M1.5 19c0-2.2 1.6-3.8 3.6-3.8M22.5 19c0-2.2-1.6-3.8-3.6-3.8"/></svg>',
  cardHand: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="10" height="14" rx="2"/><path d="M15 9l4 1.2-3.2 10.8-6.6-2"/></svg>',
};
