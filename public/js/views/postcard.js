// «Создание открытки» (19.11.2026, переделано по отзыву Ананды Майи): карта с пожеланием, наблюдением или приветом.
// Макет — на всю карту, в рамке или плакатом; текст — свободный элемент: перетаскивается пальцем, растягивается
// за уголок или двумя пальцами. Предпросмотр и экспорт рисуются одной функцией draw(), поэтому сохранённая
// картинка совпадает с экраном (рамка выделения — отдельный слой, в картинку не попадает). Технических подписей
// (художник, номер, название) на открытке нет — ссылка на карту идёт в подписи сообщения.
// Открытка не меняет число «Выбрали для разговора». Без регистрации.
import { esc, tt, u, api, toast } from '../util.js';
import { loading, failed } from '../ui.js';
import { shareInvite, SLOGAN, sendButton } from '../share.js';

// три заметно разных шрифта, у каждого — понятное название
const FONTS = [
  { key: 'onest', ru: 'Простой', en: 'Simple', file: 'onest', family: 'DCOnest', weights: [300, 500, 700] },
  { key: 'serif', ru: 'Классический', en: 'Classic', file: 'noto-serif', family: 'DCSerif', weights: [300, 500, 700] },
  { key: 'hand', ru: 'Рукописный', en: 'Handwritten', file: 'caveat', family: 'DCHand', weights: [400, 500, 700], scale: 1.3 },
];
const WEIGHTS = [['light', 'Тонкий', 'Light'], ['mid', 'Обычный', 'Regular'], ['bold', 'Жирный', 'Bold']];
const weightOf = (f, w) => f.weights[{ light: 0, mid: 1, bold: 2 }[w]];
const TEXT_COLORS = ['#ffffff', '#f5ecd7', '#f6c23c', '#f0a35e', '#e9775f', '#d9486b', '#b58ad6', '#7aa6e8', '#5cc0b5', '#8fbf6a', '#2f6b4f', '#1f3a8a', '#6b3f2a', '#5a5a5a', '#10142a', '#000000'];
const PAPERS = [['#ffffff', 'Белая', 'White'], ['#f4ecdc', 'Кремовая', 'Cream'], ['#f6c23c', 'Жёлтая', 'Yellow'], ['#e7d3d0', 'Пудровая', 'Powder'], ['#cfdccb', 'Шалфей', 'Sage'], ['#cfdbe8', 'Небесная', 'Sky'], ['#1b2140', 'Тёмная', 'Dark'], ['#000000', 'Чёрная', 'Black']];
const LAYOUTS = [
  { key: 'full', ru: 'На всю карту', en: 'Full card' },
  { key: 'frame', ru: 'В рамке', en: 'Framed' },
  { key: 'poster', ru: 'Плакат', en: 'Poster' },
];
const CYR = 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116';
const LAT = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
let fontsReady = null;
/** Шрифты открытки подгружаются только здесь (не на всём сайте). */
function loadFonts() {
  if (fontsReady) return fontsReady;
  const faces = [];
  for (const f of FONTS) for (const w of f.weights) for (const [sub, range] of [['cyrillic', CYR], ['latin', LAT]]) {
    const ff = new FontFace(f.family, `url(${u(`/fonts/card/${f.file}-${sub}-${w}-normal.woff2`)}) format('woff2')`, { weight: String(w), unicodeRange: range });
    document.fonts.add(ff); faces.push(ff.load().catch(() => null));
  }
  fontsReady = Promise.all(faces);
  return fontsReady;
}
const isDark = (hex) => { const n = parseInt(hex.slice(1), 16); const r = n >> 16; const g = (n >> 8) & 255; const b = n & 255; return 0.299 * r + 0.587 * g + 0.114 * b < 140; };

export async function postcard(ctx, code) {
  if (!code) { ctx.navigate('/library?play=postcard', { replace: true }); return; }
  loading(ctx.main);
  let card;
  try { card = await api(`/api/cards/${encodeURIComponent(code)}`); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = card.full || card.thumb; });
  await loadFonts();
  if (!ctx.alive()) return;
  if (!img) { ctx.main.innerHTML = `<div class="wrap page narrow"><p class="error-box">${esc(tt('Иллюстрация не загрузилась. Обновите страницу.', 'The illustration did not load. Reload the page.'))}</p></div>`; return; }
  const W = img.naturalWidth; const H = img.naturalHeight;
  const link = `${location.origin}${u('/play/' + card.code)}`;
  // k — размер текста от ширины открытки; cx/cy — центр текста в долях открытки
  const st = { layout: 'full', paper: '#ffffff', text: '', font: 'onest', weight: 'mid', color: '#ffffff', k: 0.064, align: 'center', cx: 0.5, cy: 0.15, bg: 'grad', tone: 'dark', tab: 'layout', overflow: false, box: null, touched: false };

  /** Геометрия макета: размер открытки и место иллюстрации. */
  function geo() {
    if (st.layout === 'frame') { const m = Math.round(W * 0.06); const band = Math.round(H * 0.24); return { CW: W + m * 2, CH: H + m + band, ix: m, iy: m, iw: W, ih: H, r: 0, band: [H + m, band] }; }
    if (st.layout === 'poster') { const iw = Math.round(W * 0.8); const ih = Math.round(H * 0.8); const CW = W; const CH = Math.round(H * 1.12); return { CW, CH, ix: (CW - iw) / 2, iy: (CH - ih) / 2, iw, ih, r: W * 0.04 }; }
    return { CW: W, CH: H, ix: 0, iy: 0, iw: W, ih: H, r: 0 };
  }
  /** Подходящие значения при смене макета — пока человек сам не двигал текст. */
  function layoutDefaults() {
    const g = geo();
    if (st.layout === 'full') { st.color = '#ffffff'; st.bg = 'grad'; st.cy = 0.15; }
    else if (st.layout === 'frame') { st.color = isDark(st.paper) ? '#ffffff' : '#10142a'; st.bg = 'none'; st.cy = (g.band[0] + g.band[1] / 2) / g.CH; }
    else { st.color = isDark(st.paper) ? '#ffffff' : '#10142a'; st.bg = 'none'; st.cy = (g.iy / 2) / g.CH; }
    st.cx = 0.5;
  }

  function layout(x, g) {
    const f = FONTS.find((y) => y.key === st.font);
    const size = Math.round(g.CW * st.k * (f.scale || 1));
    x.font = `${weightOf(f, st.weight)} ${size}px ${f.family}, sans-serif`;
    const pad = g.CW * 0.05; const maxW = g.CW - pad * 2; const lines = [];
    for (const para of st.text.split('\n')) {
      const words = para.split(/\s+/).filter(Boolean); let cur = '';
      if (!words.length) { lines.push(''); continue; }
      for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (x.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
      lines.push(cur);
    }
    const lh = size * 1.22; const bh = lines.length * lh; const bw = Math.min(maxW, Math.max(...lines.map((l) => x.measureText(l).width), size));
    st.overflow = bh > g.CH - pad * 2 || lines.some((l) => x.measureText(l).width > maxW + 1);
    // текст не уходит за край открытки
    let cy = st.cy * g.CH; cy = Math.min(g.CH - pad - bh / 2, Math.max(pad + bh / 2, cy));
    let cx = st.cx * g.CW; cx = Math.min(g.CW - pad - bw / 2, Math.max(pad + bw / 2, cx));
    st.cy = cy / g.CH; st.cx = cx / g.CW;
    return { f, size, lines, lh, bh, bw, cx, cy };
  }
  function draw(c) {
    const g = geo(); const x = c.getContext('2d'); c.width = g.CW; c.height = g.CH;
    if (st.layout !== 'full') { x.fillStyle = st.paper; x.fillRect(0, 0, g.CW, g.CH); }
    x.save();
    if (st.layout === 'poster') { x.shadowColor = 'rgba(0,0,0,.28)'; x.shadowBlur = W * 0.04; x.shadowOffsetY = W * 0.012; }
    if (g.r) { x.beginPath(); (x.roundRect ? x.roundRect(g.ix, g.iy, g.iw, g.ih, g.r) : x.rect(g.ix, g.iy, g.iw, g.ih)); x.fillStyle = '#000'; x.fill(); x.shadowColor = 'transparent'; x.clip(); }
    x.drawImage(img, g.ix, g.iy, g.iw, g.ih);
    x.restore();
    st.box = null;
    if (!st.text.trim()) return;
    const L = layout(x, g);
    if (st.bg === 'grad' && st.layout === 'full') {
      const a = st.tone === 'dark' ? 'rgba(6,12,30,' : 'rgba(255,255,255,';
      const top = L.cy < g.CH / 2; const g2 = x.createLinearGradient(0, top ? 0 : g.CH, 0, top ? Math.min(g.CH, L.cy + L.bh) : Math.max(0, L.cy - L.bh));
      g2.addColorStop(0, `${a}.7)`); g2.addColorStop(1, `${a}0)`);
      x.fillStyle = g2; x.fillRect(0, 0, g.CW, g.CH);
    } else if (st.bg === 'plate') {
      const p = L.size * 0.45; const rx = L.cx - L.bw / 2 - p; const ry = L.cy - L.bh / 2 - p * 0.7; const rw = L.bw + p * 2; const rh = L.bh + p * 1.4;
      x.fillStyle = st.tone === 'dark' ? 'rgba(6,12,30,.62)' : 'rgba(255,255,255,.82)';
      x.beginPath(); (x.roundRect ? x.roundRect(rx, ry, rw, rh, p) : x.rect(rx, ry, rw, rh)); x.fill();
    }
    x.font = `${weightOf(L.f, st.weight)} ${L.size}px ${L.f.family}, sans-serif`;
    x.fillStyle = st.color; x.textBaseline = 'middle'; x.textAlign = st.align;
    const ax = st.align === 'left' ? L.cx - L.bw / 2 : st.align === 'right' ? L.cx + L.bw / 2 : L.cx;
    L.lines.forEach((l, i) => x.fillText(l, ax, L.cy - L.bh / 2 + L.lh * (i + 0.5)));
    st.box = { x: L.cx - L.bw / 2, y: L.cy - L.bh / 2, w: L.bw, h: L.bh, CW: g.CW, CH: g.CH };
  }

  const chip = (attr, val, cur, label, extra = '') => `<button type="button" class="chip ${String(val) === String(cur) ? 'on' : ''}" ${attr}="${esc(String(val))}" aria-pressed="${String(val) === String(cur)}" ${extra}>${label}</button>`;
  const TABS = [['layout', 'Макет', 'Layout'], ['text', 'Текст', 'Text'], ['font', 'Шрифт', 'Font'], ['color', 'Цвет', 'Colour']];
  const sample = () => (st.text.trim().split('\n')[0] || tt('Привет!', 'Hello!')).slice(0, 22);
  function panel() {
    const hasText = !!st.text.trim();
    if (st.tab === 'layout') {
      return `<div class="pc-group"><b>${esc(tt('Макет открытки', 'Postcard layout'))}</b>
        <div class="pc-layouts">${LAYOUTS.map((l) => `<button type="button" class="pc-layout ${l.key === st.layout ? 'on' : ''}" data-layout="${l.key}" aria-pressed="${l.key === st.layout}"><span class="pc-lmini ${l.key}" aria-hidden="true"><i></i><s></s></span>${esc(tt(l.ru, l.en))}</button>`).join('')}</div></div>
        ${st.layout !== 'full' ? `<div class="pc-group"><b>${esc(tt('Цвет фона', 'Background colour'))}</b><div class="pc-swatches">${PAPERS.map(([c, ru, en]) => `<button type="button" class="pc-color ${c === st.paper ? 'on' : ''}" data-paper="${c}" style="--c:${c}" aria-label="${esc(tt(ru, en))}" aria-pressed="${c === st.paper}"></button>`).join('')}
          <label class="pc-color pc-custom" title="${esc(tt('Свой цвет', 'Custom colour'))}"><input type="color" data-paper-custom value="${st.paper}" aria-label="${esc(tt('Свой цвет фона', 'Custom background colour'))}"><span aria-hidden="true">+</span></label></div></div>` : ''}`;
    }
    if (st.tab === 'text') {
      return `<div class="pc-group"><label for="pct"><b>${esc(tt('Текст открытки', 'Postcard text'))}</b></label>
        <textarea id="pct" rows="3" maxlength="240" placeholder="${esc(tt('Пожелание, наблюдение или привет…', 'A wish, an observation or a hello…'))}">${esc(st.text)}</textarea>
        ${hasText ? `<p class="vb-note" style="margin:0">${esc(tt('Текст на открытке можно двигать пальцем, а размер менять уголком рамки или двумя пальцами.', 'Drag the text on the postcard with your finger; resize it by the frame corner or with two fingers.'))}</p>` : ''}
        ${st.overflow ? `<p class="field-error" role="alert">${esc(tt('Текст не помещается: уменьшите размер или сократите текст.', 'The text does not fit: make it smaller or shorter.'))}</p>` : ''}</div>
        ${hasText ? `<div class="pc-group"><b>${esc(tt('Размер', 'Size'))}</b><input type="range" data-size min="0.03" max="0.16" step="0.002" value="${st.k}" aria-label="${esc(tt('Размер текста', 'Text size'))}"></div>
        <div class="pc-group"><b>${esc(tt('Выравнивание', 'Alignment'))}</b><div class="pc-row">${[['left', 'По левому краю', 'Left'], ['center', 'По центру', 'Centre'], ['right', 'По правому краю', 'Right']].map(([k, ru, en]) => chip('data-align', k, st.align, esc(tt(ru, en)))).join('')}</div></div>
        <div class="pc-group"><b>${esc(tt('Подложка под текстом', 'Behind the text'))}</b><div class="pc-row">${chip('data-bg', 'none', st.bg, esc(tt('Нет', 'None')))}${st.layout === 'full' ? chip('data-bg', 'grad', st.bg, esc(tt('Затемнение', 'Shade'))) : ''}${chip('data-bg', 'plate', st.bg, esc(tt('Плашка', 'Plate')))}</div>
          ${st.bg !== 'none' ? `<div class="pc-row">${chip('data-tone', 'dark', st.tone, esc(tt('Тёмная', 'Dark')))}${chip('data-tone', 'light', st.tone, esc(tt('Светлая', 'Light')))}</div>` : ''}</div>
        <button class="link-btn" type="button" data-notext style="justify-self:start">${esc(tt('Убрать текст', 'Remove the text'))}</button>` : ''}`;
    }
    if (st.tab === 'font') {
      return `<div class="pc-group"><b>${esc(tt('Шрифт', 'Font'))}</b><div class="pc-fonts">${FONTS.map((f) => `<button type="button" class="pc-font ${f.key === st.font ? 'on' : ''}" data-font="${f.key}" aria-pressed="${f.key === st.font}"><span class="pc-font-name">${esc(tt(f.ru, f.en))}</span><span class="pc-font-sample" style="font-family:${f.family};font-weight:${weightOf(f, st.weight)}">${esc(sample())}</span></button>`).join('')}</div></div>
        <div class="pc-group"><b>${esc(tt('Толщина букв', 'Weight'))}</b><div class="pc-row">${WEIGHTS.map(([w, ru, en]) => chip('data-weight', w, st.weight, esc(tt(ru, en)))).join('')}</div></div>`;
    }
    return `<div class="pc-group"><b>${esc(tt('Цвет текста', 'Text colour'))}</b><div class="pc-swatches">${TEXT_COLORS.map((c) => `<button type="button" class="pc-color ${c === st.color ? 'on' : ''}" data-color="${c}" style="--c:${c}" aria-label="${c}" aria-pressed="${c === st.color}"></button>`).join('')}
      <label class="pc-color pc-custom" title="${esc(tt('Свой цвет', 'Custom colour'))}"><input type="color" data-color-custom value="${st.color}" aria-label="${esc(tt('Свой цвет текста', 'Custom text colour'))}"><span aria-hidden="true">+</span></label></div></div>`;
  }
  function render() {
    const focusId = document.activeElement && document.activeElement.id;
    const sel = focusId === 'pct' ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    ctx.main.innerHTML = `<div class="wrap page narrow stack pc-page editing">
      <h1 style="margin:0">${esc(tt('Создание открытки', 'Create a postcard'))}</h1>
      <div class="pc-stage"><div class="pc-wrap"><canvas id="pc" role="img" aria-label="${esc(tt('Предпросмотр открытки', 'Postcard preview'))}"></canvas><div class="pc-sel" hidden><span class="pc-handle" aria-hidden="true"></span></div></div></div>
      <div class="pc-tabs" role="tablist">${TABS.map(([k, ru, en]) => `<button type="button" role="tab" class="${k === st.tab ? 'on' : ''}" aria-selected="${k === st.tab}" data-tab="${k}">${esc(tt(ru, en))}</button>`).join('')}</div>
      <div class="pc-panel" role="tabpanel">${panel()}</div>
      <div class="pc-send">
        ${sendButton(`data-send ${st.overflow ? 'disabled' : ''}`, tt('Отправить открытку', 'Send the postcard'))}
        <div class="row" style="justify-content:center"><button class="btn sm light" type="button" data-save ${st.overflow ? 'disabled' : ''}>${esc(tt('Сохранить картинку', 'Save the image'))}</button>
          <button class="btn sm light" type="button" data-copytext>${esc(tt('Скопировать текст и ссылку', 'Copy text and link'))}</button></div>
        <p class="vb-note" style="margin:0">${esc(tt('Если мессенджер принимает картинку и подпись отдельно: сохраните открытку и вставьте скопированный текст. По ссылке человек увидит эту карту без вашего пожелания и сможет начать свой обмен.', 'If your messenger takes the image and the caption separately: save the postcard and paste the copied text. The link shows this card without your wish, and the person can start their own exchange.'))}</p>
      </div></div>`;
    const cv = ctx.main.querySelector('#pc'); paint(cv);
    wire(cv);
    if (focusId === 'pct') { const t = ctx.main.querySelector('#pct'); if (t) { t.focus(); if (sel) t.setSelectionRange(sel[0], sel[1]); } }
  }
  /** Рисует открытку и рамку выделения поверх (рамка — DOM, в картинку не попадает). */
  function paint(cv) {
    draw(cv);
    cv.style.touchAction = st.text.trim() ? 'none' : 'auto';
    const s = ctx.main.querySelector('.pc-sel'); if (!s) return;
    if (!st.box) { s.hidden = true; return; }
    const kx = cv.clientWidth / st.box.CW; const ky = cv.clientHeight / st.box.CH; const m = 6;
    s.hidden = false;
    Object.assign(s.style, { left: `${st.box.x * kx - m}px`, top: `${st.box.y * ky - m}px`, width: `${st.box.w * kx + m * 2}px`, height: `${st.box.h * ky + m * 2}px` });
  }
  function redrawOnly() { const cv = ctx.main.querySelector('#pc'); const before = st.overflow; paint(cv); if (before !== st.overflow) render(); }
  const exportBlob = () => new Promise((res) => { const c = document.createElement('canvas'); draw(c); c.toBlob(res, 'image/png'); });
  const fileName = () => `d-cards-${card.code}-otkrytka.png`;
  const captionText = () => `${st.text.trim() ? st.text.trim() + '\n\n' : ''}${SLOGAN()}\n${link}`;
  function wire(cv) {
    const $ = (q) => ctx.main.querySelector(q);
    const all = (q, fn) => ctx.main.querySelectorAll(q).forEach((b) => { b.onclick = () => { fn(b); render(); }; });
    all('[data-tab]', (b) => { st.tab = b.dataset.tab; });
    all('[data-layout]', (b) => { st.layout = b.dataset.layout; if (!st.touched) layoutDefaults(); if (st.bg === 'grad' && st.layout !== 'full') st.bg = 'none'; });
    all('[data-paper]', (b) => { st.paper = b.dataset.paper; if (!st.touched) layoutDefaults(); });
    all('[data-font]', (b) => { st.font = b.dataset.font; });
    all('[data-weight]', (b) => { st.weight = b.dataset.weight; });
    all('[data-color]', (b) => { st.color = b.dataset.color; st.touched = true; });
    all('[data-align]', (b) => { st.align = b.dataset.align; });
    all('[data-bg]', (b) => { st.bg = b.dataset.bg; });
    all('[data-tone]', (b) => { st.tone = b.dataset.tone; });
    const pcu = $('[data-paper-custom]'); if (pcu) { pcu.oninput = () => { st.paper = pcu.value; redrawOnly(); }; pcu.onchange = () => { if (!st.touched) layoutDefaults(); render(); }; }
    const ccu = $('[data-color-custom]'); if (ccu) { ccu.oninput = () => { st.color = ccu.value; st.touched = true; redrawOnly(); }; ccu.onchange = () => render(); }
    const sz = $('[data-size]'); if (sz) sz.oninput = () => { st.k = Number(sz.value); redrawOnly(); };
    const nt = $('[data-notext]'); if (nt) nt.onclick = () => { st.text = ''; render(); };
    const ta = $('#pct'); if (ta) ta.addEventListener('input', () => { const had = !!st.text.trim(); st.text = ta.value; if (had !== !!st.text.trim()) render(); else redrawOnly(); });
    // текст на открытке: перетаскивание одним пальцем, масштаб — двумя пальцами или за уголок рамки
    const pts = new Map(); let drag = null; let pinch = null; let resize = null;
    const pt = (e) => { const r = cv.getBoundingClientRect(); const g = geo(); return [(e.clientX - r.left) * (g.CW / r.width), (e.clientY - r.top) * (g.CH / r.height)]; };
    const onText = (px, py) => { const b = st.box; if (!b) return false; const m = b.CW * 0.05; return px > b.x - m && px < b.x + b.w + m && py > b.y - m && py < b.y + b.h + m; };
    const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); };
    cv.onpointerdown = (e) => {
      if (!st.text.trim()) return; const p = pt(e);
      if (!pts.size && !onText(p[0], p[1])) return;
      pts.set(e.pointerId, p); try { cv.setPointerCapture(e.pointerId); } catch { /* */ } e.preventDefault();
      const g = geo();
      if (pts.size === 2) { drag = null; pinch = { d: dist(), k: st.k }; } else drag = { dx: p[0] - st.cx * g.CW, dy: p[1] - st.cy * g.CH };
    };
    cv.onpointermove = (e) => {
      if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, pt(e)); const g = geo();
      if (pinch && pts.size === 2) { st.k = Math.min(0.16, Math.max(0.03, pinch.k * dist() / pinch.d)); }
      else if (drag) { const p = pts.get(e.pointerId); st.cx = (p[0] - drag.dx) / g.CW; st.cy = (p[1] - drag.dy) / g.CH; }
      st.touched = true; paint(cv);
    };
    cv.onpointerup = cv.onpointercancel = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) { drag = null; syncSize(); } };
    const h = $('.pc-handle');
    if (h) {
      h.onpointerdown = (e) => { e.preventDefault(); e.stopPropagation(); const g = geo(); const p = pt(e); resize = { d: Math.hypot(p[0] - st.cx * g.CW, p[1] - st.cy * g.CH) || 1, k: st.k }; try { h.setPointerCapture(e.pointerId); } catch { /* */ } };
      h.onpointermove = (e) => { if (!resize) return; const g = geo(); const p = pt(e); st.k = Math.min(0.16, Math.max(0.03, resize.k * Math.hypot(p[0] - st.cx * g.CW, p[1] - st.cy * g.CH) / resize.d)); st.touched = true; paint(cv); };
      h.onpointerup = h.onpointercancel = () => { resize = null; syncSize(); };
    }
    function syncSize() { const s = $('[data-size]'); if (s) s.value = st.k; const was = !!$('.field-error'); if (was !== st.overflow) render(); }
    $('[data-save]').onclick = async () => {
      const blob = await exportBlob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName(); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000); toast(tt('Открытка сохранена', 'Postcard saved'));
    };
    $('[data-copytext]').onclick = () => shareInvite('copy', link, `${st.text.trim() ? st.text.trim() + '\n\n' : ''}${SLOGAN()}`, tt('Текст и ссылка скопированы', 'Text and link copied'));
    $('[data-send]').onclick = async () => {
      const blob = await exportBlob(); const file = new File([blob], fileName(), { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], text: captionText() }); return; } catch (x) { if (x && x.name === 'AbortError') return; }
      }
      // нет отправки файлов в этом браузере — сохраняем картинку и копируем текст со ссылкой
      $('[data-save]').click(); await shareInvite('copy', link, `${st.text.trim() ? st.text.trim() + '\n\n' : ''}${SLOGAN()}`, tt('Открытка сохранена, текст и ссылка скопированы', 'Postcard saved, text and link copied'));
    };
  }
  addEventListener('resize', () => { const cv = ctx.main.querySelector('#pc'); if (cv && ctx.alive()) paint(cv); });
  render();
}
