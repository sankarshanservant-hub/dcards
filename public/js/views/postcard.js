// «Создание открытки» (19.11.2026; 21.11.2026 — две вкладки, ручка размера, «Мои открытки», надёжное сохранение картинки).
// «Макет» — расположение иллюстрации и цвет фона; «Текст» — надпись, шрифт, начертание, размер, цвет и положение.
// Текст — свободный элемент: тап выделяет, перетаскивание пальцем, масштаб двумя пальцами или за круглую ручку; тап мимо снимает
// выделение. Рамка и ручка — отдельный слой, в картинку не попадают. Предпросмотр, «Мои открытки» и экспорт рисует одна функция.
// Открытка не меняет число «Выбрали для разговора». Без регистрации.
import { esc, tt, u, api } from '../util.js';
import { loading, failed } from '../ui.js';
import { sendButton, saveImage, sendImage, postcardCaption } from '../share.js';
import * as personal from '../personal.js';
import { FONTS, weightOf, DEFAULT_DESIGN, cleanDesign, loadFonts, loadImage, geo, drawPostcard, postcardFileName } from '../postcard-render.js';

const WEIGHTS = [['light', 'Тонкий', 'Light'], ['mid', 'Обычный', 'Regular'], ['bold', 'Жирный', 'Bold']];
const TEXT_COLORS = ['#ffffff', '#f5ecd7', '#f6c23c', '#f0a35e', '#e9775f', '#d9486b', '#b58ad6', '#7aa6e8', '#5cc0b5', '#8fbf6a', '#2f6b4f', '#1f3a8a', '#6b3f2a', '#5a5a5a', '#10142a', '#000000'];
const PAPERS = [['#ffffff', 'Белая', 'White'], ['#f4ecdc', 'Кремовая', 'Cream'], ['#f6c23c', 'Жёлтая', 'Yellow'], ['#e7d3d0', 'Пудровая', 'Powder'], ['#cfdccb', 'Шалфей', 'Sage'], ['#cfdbe8', 'Небесная', 'Sky'], ['#1b2140', 'Тёмная', 'Dark'], ['#000000', 'Чёрная', 'Black']];
const LAYOUTS = [{ key: 'full', ru: 'На всю карту', en: 'Full card' }, { key: 'frame', ru: 'В рамке', en: 'Framed' }, { key: 'poster', ru: 'Плакат', en: 'Poster' }];
const isDark = (hex) => { const n = parseInt(String(hex).slice(1), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < 140; };
// ручка размера: только две головки стрелок по диагонали (вправо-вверх и влево-вниз), без стержней
const HANDLE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 3.5h3v3M6.5 12.5h-3v-3"/></svg>';

export async function postcard(ctx, code) {
  if (!code) { ctx.navigate('/library?play=postcard', { replace: true }); return; }
  loading(ctx.main);
  let card; let saved = null;
  const pid = ctx.query.get('p');
  try {
    card = await api(`/api/cards/${encodeURIComponent(code)}`);
    if (pid) saved = ((await personal.load()).postcards || []).find((p) => p.id === pid) || null;
  } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  const img = await loadImage(card.full || card.thumb);
  await loadFonts();
  if (!ctx.alive()) return;
  if (!img) { ctx.main.innerHTML = `<div class="wrap page narrow"><p class="error-box">${esc(tt('Иллюстрация не загрузилась. Обновите страницу.', 'The illustration did not load. Reload the page.'))}</p></div>`; return; }
  const W = img.naturalWidth; const H = img.naturalHeight;
  const st = { ...DEFAULT_DESIGN, ...(saved ? cleanDesign(saved.design) : {}) };
  const ui = { tab: 'layout', overflow: false, box: null, sel: false, touched: !!saved, savedId: saved ? saved.id : null, savedMsg: '', hint: '', blob: null, blobFor: '' };

  function layoutDefaults() {
    const g = geo(st, W, H);
    if (st.layout === 'full') { st.color = '#ffffff'; st.bg = 'grad'; st.cy = 0.15; }
    else if (st.layout === 'frame') { st.color = isDark(st.paper) ? '#ffffff' : '#10142a'; st.bg = 'none'; st.cy = (g.band[0] + g.band[1] / 2) / g.CH; }
    else { st.color = isDark(st.paper) ? '#ffffff' : '#10142a'; st.bg = 'none'; st.cy = (g.iy / 2) / g.CH; }
    st.cx = 0.5;
  }
  const design = () => cleanDesign(st);
  const hasText = () => !!st.text.trim();

  const chip = (attr, val, cur, label) => `<button type="button" class="chip ${String(val) === String(cur) ? 'on' : ''}" ${attr}="${esc(String(val))}" aria-pressed="${String(val) === String(cur)}">${label}</button>`;
  const sample = () => (st.text.trim().split('\n')[0] || tt('Привет!', 'Hello!')).slice(0, 22);
  const swatches = (list, cur, attr, custom, label) => `<div class="pc-swatches">${list.map(([c, ru, en]) => `<button type="button" class="pc-color ${c === cur ? 'on' : ''}" ${attr}="${esc(c)}" style="--c:${esc(c)}" aria-label="${esc(ru ? tt(ru, en) : c)}" aria-pressed="${c === cur}"></button>`).join('')}
    <label class="pc-color pc-custom" title="${esc(tt('Свой цвет', 'Custom colour'))}"><input type="color" ${custom} value="${esc(cur)}" aria-label="${esc(label)}"><span aria-hidden="true">+</span></label></div>`;
  function panel() {
    if (ui.tab === 'layout') {
      return `<div class="pc-group"><b>${esc(tt('Расположение иллюстрации', 'Illustration layout'))}</b>
        <div class="pc-layouts">${LAYOUTS.map((l) => `<button type="button" class="pc-layout ${l.key === st.layout ? 'on' : ''}" data-layout="${l.key}" aria-pressed="${l.key === st.layout}"><span class="pc-lmini ${l.key}" aria-hidden="true"><i></i><s></s></span>${esc(tt(l.ru, l.en))}</button>`).join('')}</div></div>
        ${st.layout !== 'full' ? `<div class="pc-group"><b>${esc(tt('Цвет фона', 'Background colour'))}</b>${swatches(PAPERS, st.paper, 'data-paper', 'data-paper-custom', tt('Свой цвет фона', 'Custom background colour'))}</div>` : ''}`;
    }
    return `<div class="pc-group"><label for="pct"><b>${esc(tt('Надпись', 'Text'))}</b></label>
        <textarea id="pct" rows="3" maxlength="240" placeholder="${esc(tt('Пожелание, наблюдение или привет — можно без надписи', 'A wish, an observation or a hello — or no text at all'))}">${esc(st.text)}</textarea>
        ${hasText() ? `<p class="vb-note" style="margin:0">${esc(tt('Надпись можно двигать пальцем. Размер — за круглую ручку или двумя пальцами.', 'Drag the text with your finger. Resize it by the round handle or with two fingers.'))}</p>` : ''}
        ${ui.overflow ? `<p class="field-error" role="alert">${esc(tt('Текст не помещается: уменьшите размер или сократите текст.', 'The text does not fit: make it smaller or shorter.'))}</p>` : ''}</div>
      ${hasText() ? `
      <div class="pc-group"><b>${esc(tt('Шрифт', 'Font'))}</b><div class="pc-fonts">${FONTS.map((f) => `<button type="button" class="pc-font ${f.key === st.font ? 'on' : ''}" data-font="${f.key}" aria-pressed="${f.key === st.font}"><span class="pc-font-name">${esc(tt(f.ru, f.en))}</span><span class="pc-font-sample" style="font-family:${f.family};font-weight:${weightOf(f, st.weight)}">${esc(sample())}</span></button>`).join('')}</div></div>
      <div class="pc-group"><b>${esc(tt('Начертание', 'Weight'))}</b><div class="pc-row">${WEIGHTS.map(([w, ru, en]) => chip('data-weight', w, st.weight, esc(tt(ru, en)))).join('')}</div></div>
      <div class="pc-group"><b>${esc(tt('Размер', 'Size'))}</b><input type="range" data-size min="0.02" max="0.16" step="0.002" value="${st.k}" aria-label="${esc(tt('Размер текста', 'Text size'))}"></div>
      <div class="pc-group"><b>${esc(tt('Цвет', 'Colour'))}</b>${swatches(TEXT_COLORS.map((c) => [c]), st.color, 'data-color', 'data-color-custom', tt('Свой цвет текста', 'Custom text colour'))}</div>
      <div class="pc-group"><b>${esc(tt('Положение', 'Position'))}</b><div class="pc-row">${[['left', 'По левому краю', 'Left'], ['center', 'По центру', 'Centre'], ['right', 'По правому краю', 'Right']].map(([k, ru, en]) => chip('data-align', k, st.align, esc(tt(ru, en)))).join('')}</div>
        <div class="pc-row">${chip('data-bg', 'none', st.bg, esc(tt('Без подложки', 'No backing')))}${st.layout === 'full' ? chip('data-bg', 'grad', st.bg, esc(tt('Затемнение', 'Shade'))) : ''}${chip('data-bg', 'plate', st.bg, esc(tt('Плашка', 'Plate')))}</div>
        ${st.bg !== 'none' ? `<div class="pc-row">${chip('data-tone', 'dark', st.tone, esc(tt('Тёмная', 'Dark')))}${chip('data-tone', 'light', st.tone, esc(tt('Светлая', 'Light')))}</div>` : ''}</div>
      <button class="link-btn" type="button" data-notext style="justify-self:start">${esc(tt('Убрать надпись', 'Remove the text'))}</button>` : ''}`;
  }
  function render() {
    const focusId = document.activeElement && document.activeElement.id;
    const sel = focusId === 'pct' ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    ctx.main.innerHTML = `<div class="wrap page narrow stack pc-page editing">
      <h1 class="pc-title">${esc(tt('Создание открытки', 'Create a postcard'))}</h1>
      <div class="pc-stage"><div class="pc-wrap"><canvas id="pc" role="img" aria-label="${esc(tt('Предпросмотр открытки', 'Postcard preview'))}"></canvas><div class="pc-sel" hidden><span class="pc-handle" aria-hidden="true">${HANDLE}</span></div></div></div>
      <div class="pc-tabs two" role="tablist">${[['layout', 'Макет', 'Layout'], ['text', 'Текст', 'Text']].map(([k, ru, en]) => `<button type="button" role="tab" class="${k === ui.tab ? 'on' : ''}" aria-selected="${k === ui.tab}" data-tab="${k}">${esc(tt(ru, en))}</button>`).join('')}</div>
      <div class="pc-panel" role="tabpanel">${panel()}</div>
      <div class="pc-send">
        ${sendButton(`data-send ${ui.overflow ? 'disabled' : ''}`, tt('Отправить открытку', 'Send the postcard'))}
        <div class="row pc-acts"><button class="btn light" type="button" data-keep ${ui.overflow ? 'disabled' : ''}>${esc(ui.savedId ? tt('Сохранить изменения', 'Save changes') : tt('Сохранить в мои открытки', 'Save to my postcards'))}</button>
          <button class="btn light" type="button" data-save ${ui.overflow ? 'disabled' : ''}>${esc(tt('Сохранить изображение', 'Save image'))}</button></div>
        <div class="pc-status" role="status">${ui.savedMsg ? `<b>${esc(ui.savedMsg)}</b> <a href="${u('/me/postcards')}">${esc(tt('Открыть мои открытки', 'Open my postcards'))}</a>${ui.savedId ? ` · <button class="link-btn" type="button" data-asnew>${esc(tt('Сохранить как новую', 'Save as new'))}</button>` : ''}` : ''}${ui.hint ? `<p class="vb-note" style="margin:4px 0 0">${esc(ui.hint)}</p>` : ''}</div>
      </div></div>`;
    const cv = ctx.main.querySelector('#pc'); paint(cv);
    wire(cv);
    if (focusId === 'pct') { const t = ctx.main.querySelector('#pct'); if (t) { t.focus(); if (sel) t.setSelectionRange(sel[0], sel[1]); } }
  }
  /** Рисует открытку и рамку выделения поверх (рамка — DOM, в картинку не попадает). */
  function paint(cv) {
    const r = drawPostcard(cv, st, img); ui.box = r.box; ui.overflow = r.overflow;
    cv.style.touchAction = hasText() ? 'none' : 'auto';
    const s = ctx.main.querySelector('.pc-sel'); if (!s) return;
    if (!ui.box || !ui.sel) { s.hidden = true; return; }
    const kx = cv.clientWidth / ui.box.CW; const ky = cv.clientHeight / ui.box.CH; const m = 6;
    s.hidden = false;
    Object.assign(s.style, { left: `${ui.box.x * kx - m}px`, top: `${ui.box.y * ky - m}px`, width: `${ui.box.w * kx + m * 2}px`, height: `${ui.box.h * ky + m * 2}px` });
    prepare();
  }
  // готовая картинка заранее: на iPhone системное меню открывается только сразу после нажатия, без долгого ожидания
  let prepT = null;
  function prepare() {
    clearTimeout(prepT);
    prepT = setTimeout(() => { const key = JSON.stringify(design()); if (key === ui.blobFor) return; const c = document.createElement('canvas'); drawPostcard(c, { ...st }, img); c.toBlob((b) => { ui.blob = b; ui.blobFor = key; }, 'image/png'); }, 250);
  }
  const getBlob = () => new Promise((res) => { const key = JSON.stringify(design()); if (ui.blob && ui.blobFor === key) return res(ui.blob); const c = document.createElement('canvas'); drawPostcard(c, { ...st }, img); c.toBlob((b) => { ui.blob = b; ui.blobFor = key; res(b); }, 'image/png'); });
  function redrawOnly() { const cv = ctx.main.querySelector('#pc'); const before = ui.overflow; paint(cv); prepare(); if (before !== ui.overflow) render(); }
  function wire(cv) {
    const $ = (q) => ctx.main.querySelector(q);
    const all = (q, fn) => ctx.main.querySelectorAll(q).forEach((b) => { b.onclick = () => { fn(b); ui.savedMsg = ''; render(); }; });
    all('[data-tab]', (b) => { ui.tab = b.dataset.tab; if (ui.tab === 'text' && hasText()) ui.sel = true; });
    all('[data-layout]', (b) => { st.layout = b.dataset.layout; if (!ui.touched) layoutDefaults(); if (st.bg === 'grad' && st.layout !== 'full') st.bg = 'none'; });
    all('[data-paper]', (b) => { st.paper = b.dataset.paper; if (!ui.touched) layoutDefaults(); });
    all('[data-font]', (b) => { st.font = b.dataset.font; });
    all('[data-weight]', (b) => { st.weight = b.dataset.weight; });
    all('[data-color]', (b) => { st.color = b.dataset.color; ui.touched = true; });
    all('[data-align]', (b) => { st.align = b.dataset.align; });
    all('[data-bg]', (b) => { st.bg = b.dataset.bg; });
    all('[data-tone]', (b) => { st.tone = b.dataset.tone; });
    const pcu = $('[data-paper-custom]'); if (pcu) { pcu.oninput = () => { st.paper = pcu.value; redrawOnly(); }; pcu.onchange = () => { if (!ui.touched) layoutDefaults(); render(); }; }
    const ccu = $('[data-color-custom]'); if (ccu) { ccu.oninput = () => { st.color = ccu.value; ui.touched = true; redrawOnly(); }; ccu.onchange = () => render(); }
    const sz = $('[data-size]'); if (sz) sz.oninput = () => { st.k = Number(sz.value); ui.sel = true; redrawOnly(); };
    const nt = $('[data-notext]'); if (nt) nt.onclick = () => { st.text = ''; ui.sel = false; render(); };
    const ta = $('#pct'); if (ta) ta.addEventListener('input', () => { const had = hasText(); st.text = ta.value; ui.sel = hasText(); ui.savedMsg = ''; if (had !== hasText()) render(); else redrawOnly(); });
    // текст на открытке: тап выделяет; перетаскивание одним пальцем, масштаб — двумя пальцами или за ручку; тап мимо снимает выделение
    const pts = new Map(); let drag = null; let pinch = null; let resize = null;
    const pt = (e) => { const r = cv.getBoundingClientRect(); const g = geo(st, W, H); return [(e.clientX - r.left) * (g.CW / r.width), (e.clientY - r.top) * (g.CH / r.height)]; };
    const onText = (px, py) => { const b = ui.box; if (!b) return false; const m = b.CW * 0.04; return px > b.x - m && px < b.x + b.w + m && py > b.y - m && py < b.y + b.h + m; };
    const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); };
    cv.onpointerdown = (e) => {
      if (!hasText()) return; const p = pt(e);
      if (!pts.size && !onText(p[0], p[1])) { if (ui.sel) { ui.sel = false; paint(cv); } return; }
      pts.set(e.pointerId, p); try { cv.setPointerCapture(e.pointerId); } catch { /* */ } e.preventDefault();
      ui.sel = true; const g = geo(st, W, H);
      if (pts.size === 2) { drag = null; pinch = { d: dist() || 1, k: st.k }; } else drag = { dx: p[0] - st.cx * g.CW, dy: p[1] - st.cy * g.CH };
      paint(cv);
    };
    cv.onpointermove = (e) => {
      if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, pt(e)); const g = geo(st, W, H);
      if (pinch && pts.size === 2) st.k = Math.min(0.16, Math.max(0.02, pinch.k * dist() / pinch.d));
      else if (drag) { const p = pts.get(e.pointerId); st.cx = (p[0] - drag.dx) / g.CW; st.cy = (p[1] - drag.dy) / g.CH; }
      ui.touched = true; ui.savedMsg = ''; paint(cv);
    };
    cv.onpointerup = cv.onpointercancel = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) { drag = null; syncSize(); } };
    const h = $('.pc-handle');
    if (h) {
      h.onpointerdown = (e) => { e.preventDefault(); e.stopPropagation(); const g = geo(st, W, H); const p = pt(e); resize = { d: Math.hypot(p[0] - st.cx * g.CW, p[1] - st.cy * g.CH) || 1, k: st.k }; try { h.setPointerCapture(e.pointerId); } catch { /* */ } };
      h.onpointermove = (e) => { if (!resize) return; const g = geo(st, W, H); const p = pt(e); st.k = Math.min(0.16, Math.max(0.02, resize.k * Math.hypot(p[0] - st.cx * g.CW, p[1] - st.cy * g.CH) / resize.d)); ui.touched = true; paint(cv); };
      h.onpointerup = h.onpointercancel = () => { resize = null; syncSize(); };
    }
    function syncSize() { const s = $('[data-size]'); if (s) s.value = st.k; const was = !!$('.field-error'); if (was !== ui.overflow) render(); }
    const setHint = (t) => { ui.hint = t; const box = $('.pc-status'); if (box) { let p = box.querySelector('.vb-note'); if (!p) { p = document.createElement('p'); p.className = 'vb-note'; p.style.margin = '4px 0 0'; box.appendChild(p); } p.textContent = t; } };
    $('[data-save]').onclick = async () => { const b = await getBlob(); await saveImage(b, postcardFileName(card.code), setHint); };
    $('[data-send]').onclick = async () => {
      const b = await getBlob();
      const r = await sendImage(b, postcardFileName(card.code), postcardCaption());
      if (r === null) { setHint(tt('Этот браузер не умеет отправлять картинки напрямую. Сохрани изображение и отправь его в мессенджере.', 'This browser cannot send images directly. Save the image and send it in your messenger.')); await saveImage(b, postcardFileName(card.code), setHint); }
    };
    const keep = async (asNew) => {
      const id = asNew || !ui.savedId ? personal.newPostcardId() : ui.savedId;
      try { await personal.savePostcard({ id, code: card.code, design: design() }); ui.savedId = id; ui.savedMsg = tt('Открытка сохранена', 'Postcard saved'); ui.hint = ''; }
      catch { ui.savedMsg = ''; ui.hint = tt('Не удалось сохранить — проверьте соединение и попробуйте ещё раз.', 'Could not save — check the connection and try again.'); }
      render();
      // адрес открытки — чтобы «Назад» и перезагрузка открывали её же
      const q = new URL(location.href); q.searchParams.set('p', id); history.replaceState(history.state, '', q.pathname + q.search);
    };
    $('[data-keep]').onclick = () => keep(false);
    const an = $('[data-asnew]'); if (an) an.onclick = () => keep(true);
  }
  const onResize = () => { const cv = ctx.main.querySelector('#pc'); if (cv && ctx.alive()) paint(cv); else removeEventListener('resize', onResize); };
  addEventListener('resize', onResize);
  render();
}

// ---------- «Мои открытки» (внутри «Избранного») ----------
export async function myPostcards(ctx) {
  loading(ctx.main);
  let s; let cards;
  try { [s, { cards }] = await Promise.all([personal.load(true), api('/api/cards')]); await loadFonts(); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  const by = new Map(cards.map((c) => [c.code, c]));
  const list = (s.postcards || []).filter((p) => by.has(p.code));
  const blobs = new Map(); const imgs = new Map();
  ctx.main.innerHTML = `<div class="wrap page stack">
    <a class="small" href="${u('/me/collections')}">← ${esc(tt('Мои подборки', 'My collections'))}</a>
    <h1 style="margin:0">${esc(tt('Мои открытки', 'My postcards'))}</h1>
    ${s.server ? '' : `<p class="vb-note">${esc(tt('Сохранено в этом браузере. Войдите, чтобы видеть на других устройствах.', 'Saved in this browser. Sign in to see them on other devices.'))}</p>`}
    ${list.length ? `<div class="pc-list">${list.map((p) => `<div class="pc-item" data-id="${esc(p.id)}">
        <a class="pc-thumb" href="${u('/postcard/' + p.code + '?p=' + encodeURIComponent(p.id))}" aria-label="${esc(tt('Открыть открытку', 'Open the postcard'))}"><canvas></canvas></a>
        ${sendButton('data-psend', tt('Отправить открытку', 'Send the postcard'))}
        <button class="btn light sm" type="button" data-psave>${esc(tt('Сохранить изображение', 'Save image'))}</button>
        <button class="link-btn small" type="button" data-pdel>${esc(tt('Удалить', 'Delete'))}</button>
        <p class="vb-note pc-hint" style="margin:0"></p></div>`).join('')}</div>`
      : `<p class="empty">${esc(tt('Пока нет сохранённых открыток. Выбери карту и создай открытку.', 'No saved postcards yet. Choose a card and create one.'))}</p><a class="btn yellow" href="${u('/library?play=postcard')}" style="justify-self:start">${esc(tt('Создать открытку', 'Create a postcard'))}</a>`}
  </div>`;
  for (const p of list) {
    const el = ctx.main.querySelector(`.pc-item[data-id="${CSS.escape(p.id)}"]`);
    const c = by.get(p.code); const img = await loadImage(c.full || c.thumb); if (!ctx.alive()) return;
    if (!img) continue; imgs.set(p.id, img);
    const cv = el.querySelector('canvas'); const d = { ...DEFAULT_DESIGN, ...cleanDesign(p.design) }; drawPostcard(cv, d, img);
    cv.toBlob((b) => blobs.set(p.id, b), 'image/png'); // готово заранее — меню отправки откроется сразу после нажатия
    const hint = (t) => { el.querySelector('.pc-hint').textContent = t; };
    const blob = () => new Promise((res) => (blobs.get(p.id) ? res(blobs.get(p.id)) : cv.toBlob(res, 'image/png')));
    el.querySelector('[data-psend]').onclick = async () => { const b = await blob(); const r = await sendImage(b, postcardFileName(p.code), postcardCaption()); if (r === null) { hint(tt('Этот браузер не умеет отправлять картинки напрямую. Сохрани изображение и отправь его в мессенджере.', 'This browser cannot send images directly. Save the image and send it in your messenger.')); await saveImage(b, postcardFileName(p.code), hint); } };
    el.querySelector('[data-psave]').onclick = async () => saveImage(await blob(), postcardFileName(p.code), hint);
    el.querySelector('[data-pdel]').onclick = async () => { if (!confirm(tt('Удалить открытку?', 'Delete the postcard?'))) return; await personal.deletePostcard(p.id).catch(() => {}); el.remove(); };
  }
}
