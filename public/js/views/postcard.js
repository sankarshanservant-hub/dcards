// Открытка (19.11.2026): карта с пожеланием, наблюдением или простым приветом. Получатель сразу видит изображение,
// дальше люди общаются в своём мессенджере. Без регистрации. Предпросмотр и экспорт рисуются одной функцией draw(),
// поэтому сохранённая картинка совпадает с тем, что на экране. Открытка не меняет число «Выбрали для разговора».
import { esc, tt, u, api, toast } from '../util.js';
import { loading, failed } from '../ui.js';
import { shareInvite, SLOGAN } from '../share.js';

const FONTS = [
  { key: 'onest', name: 'Onest', file: 'onest', family: 'DCOnest' },
  { key: 'rubik', name: 'Rubik', file: 'rubik', family: 'DCRubik' },
  { key: 'serif', name: 'Noto Serif', file: 'noto-serif', family: 'DCSerif' },
];
const WEIGHTS = [[300, 'Light'], [500, 'Medium'], [700, 'Bold']];
const COLORS = [['#ffffff', 'Белый', 'White'], ['#10142a', 'Тёмный', 'Dark'], ['#f1e6c8', 'Кремовый', 'Cream'], ['#f6c23c', 'Жёлтый', 'Yellow'], ['#e9775f', 'Коралловый', 'Coral']];
const CYR = 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116';
const LAT = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
let fontsReady = null;
/** Шрифты открытки подгружаются только здесь (не на всём сайте). */
function loadFonts() {
  if (fontsReady) return fontsReady;
  const faces = [];
  for (const f of FONTS) for (const [w] of WEIGHTS) for (const [sub, range] of [['cyrillic', CYR], ['latin', LAT]]) {
    const ff = new FontFace(f.family, `url(${u(`/fonts/card/${f.file}-${sub}-${w}-normal.woff2`)}) format('woff2')`, { weight: String(w), unicodeRange: range });
    document.fonts.add(ff); faces.push(ff.load().catch(() => null));
  }
  fontsReady = Promise.all(faces);
  return fontsReady;
}

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
  // спокойные значения по умолчанию: иллюстрацию видно, текст читается
  const st = { text: '', on: false, font: 'onest', weight: 500, color: '#ffffff', k: 0.068, cx: 0.5, cy: 0.18, bg: 'grad', side: 'top', tone: 'dark', overflow: false, box: null };
  const authorZone = H * 0.075; const pad = W * 0.06;
  const link = `${location.origin}${u('/play/' + card.code)}`;

  function layout(x) {
    const f = FONTS.find((y) => y.key === st.font);
    const size = Math.round(W * st.k);
    x.font = `${st.weight} ${size}px ${f.family}, sans-serif`;
    const maxW = W - pad * 2; const lines = [];
    for (const para of st.text.split('\n')) {
      const words = para.split(/\s+/).filter(Boolean); let cur = '';
      if (!words.length) { lines.push(''); continue; }
      for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (x.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
      lines.push(cur);
    }
    const lh = size * 1.25; const bh = lines.length * lh; const bw = Math.min(maxW, Math.max(...lines.map((l) => x.measureText(l).width), 1));
    const top0 = pad; const bot0 = H - authorZone - pad; // текст не уходит за край и не закрывает подпись автора
    st.overflow = bh > bot0 - top0 || lines.some((l) => x.measureText(l).width > maxW + 1);
    let cy = st.cy * H; cy = Math.min(bot0 - bh / 2, Math.max(top0 + bh / 2, cy));
    let cx = st.cx * W; cx = Math.min(W - pad - bw / 2, Math.max(pad + bw / 2, cx));
    st.cy = cy / H; st.cx = cx / W;
    return { size, lines, lh, bh, bw, cx, cy };
  }
  function draw(c) {
    const x = c.getContext('2d'); c.width = W; c.height = H;
    x.drawImage(img, 0, 0, W, H);
    // подпись автора — всегда читаемая, внизу
    const g0 = x.createLinearGradient(0, H - authorZone * 1.8, 0, H); g0.addColorStop(0, 'rgba(0,0,0,0)'); g0.addColorStop(1, 'rgba(0,0,0,.55)');
    x.fillStyle = g0; x.fillRect(0, H - authorZone * 1.8, W, authorZone * 1.8);
    x.fillStyle = '#ffffff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = `500 ${Math.round(W * 0.03)}px DCOnest, sans-serif`;
    x.fillText(`${card.author ? `${tt('Иллюстрация', 'Illustration')}: ${card.author} · ` : ''}${card.code} · Dialogue Cards`, W / 2, H - authorZone / 2);
    st.box = null;
    if (!st.on || !st.text.trim()) return;
    const L = layout(x);
    if (st.bg === 'grad') {
      const a = st.tone === 'dark' ? 'rgba(6,12,30,' : 'rgba(255,255,255,';
      const sides = { top: [0, 0, 0, H * 0.5], bottom: [0, H, 0, H * 0.5], left: [0, 0, W * 0.6, 0], right: [W, 0, W * 0.4, 0] };
      const [x0, y0, x1, y1] = sides[st.side];
      const g = x.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, `${a}.72)`); g.addColorStop(1, `${a}0)`);
      x.fillStyle = g; x.fillRect(0, 0, W, H);
    } else if (st.bg === 'plate') {
      const p = L.size * 0.45; const rx = L.cx - L.bw / 2 - p; const ry = L.cy - L.bh / 2 - p * 0.7; const rw = L.bw + p * 2; const rh = L.bh + p * 1.4;
      x.fillStyle = st.tone === 'dark' ? 'rgba(6,12,30,.62)' : 'rgba(255,255,255,.8)';
      x.beginPath(); (x.roundRect ? x.roundRect(rx, ry, rw, rh, p) : x.rect(rx, ry, rw, rh)); x.fill();
    }
    x.font = `${st.weight} ${L.size}px ${FONTS.find((y) => y.key === st.font).family}, sans-serif`;
    x.fillStyle = st.color; x.textAlign = 'center'; x.textBaseline = 'middle';
    L.lines.forEach((l, i) => x.fillText(l, L.cx, L.cy - L.bh / 2 + L.lh * (i + 0.5)));
    st.box = { x: L.cx - L.bw / 2, y: L.cy - L.bh / 2, w: L.bw, h: L.bh };
  }

  const chip = (attr, val, cur, label, extra = '') => `<button type="button" class="chip ${String(val) === String(cur) ? 'on' : ''}" ${attr}="${esc(String(val))}" aria-pressed="${String(val) === String(cur)}" ${extra}>${label}</button>`;
  function render() {
    const focusId = document.activeElement && document.activeElement.id;
    const sel = focusId === 'pct' ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    ctx.main.innerHTML = `<div class="wrap page narrow stack pc-page ${st.on ? 'editing' : ''}">
      <h1 style="margin:0">${esc(tt('Открытка', 'Postcard'))}</h1>
      <p class="vb-note" style="margin:0">${esc(tt('Карта с пожеланием, наблюдением или простым приветом. Друг сразу увидит изображение.', 'A card with a wish, an observation or a simple hello. Your friend sees the image right away.'))}</p>
      <div class="pc-stage"><canvas id="pc" role="img" aria-label="${esc(tt('Предпросмотр открытки', 'Postcard preview'))}"></canvas></div>
      ${st.on ? `
        <label class="field" for="pct">${esc(tt('Текст открытки', 'Postcard text'))}</label>
        <textarea id="pct" rows="3" maxlength="240" placeholder="${esc(tt('Пожелание или привет…', 'A wish or a hello…'))}">${esc(st.text)}</textarea>
        ${st.overflow ? `<p class="field-error" role="alert">${esc(tt('Текст не помещается: уменьшите размер или сократите текст.', 'The text does not fit: make it smaller or shorter.'))}</p>` : ''}
        <div class="pc-row" role="group" aria-label="${esc(tt('Шрифт', 'Font'))}">${FONTS.map((f) => chip('data-font', f.key, st.font, `<span style="font-family:${f.family};font-weight:${st.weight}">${esc((st.text.trim().split('\n')[0] || f.name).slice(0, 18))}</span>`, `aria-label="${esc(f.name)}"`)).join('')}</div>
        <div class="pc-row" role="group" aria-label="${esc(tt('Начертание', 'Weight'))}">${WEIGHTS.map(([w, n]) => chip('data-weight', w, st.weight, n)).join('')}</div>
        <div class="pc-row" role="group" aria-label="${esc(tt('Цвет текста', 'Text colour'))}">${COLORS.map(([c, ru, en]) => `<button type="button" class="pc-color ${c === st.color ? 'on' : ''}" data-color="${c}" style="--c:${c}" aria-label="${esc(tt(ru, en))}" aria-pressed="${c === st.color}"></button>`).join('')}
          <span class="pc-size"><button type="button" class="btn sm light" data-size="-1" aria-label="${esc(tt('Меньше', 'Smaller'))}">−</button><button type="button" class="btn sm light" data-size="1" aria-label="${esc(tt('Больше', 'Larger'))}">+</button></span></div>
        <div class="pc-row" role="group" aria-label="${esc(tt('Положение', 'Position'))}">${[['top', 'Сверху', 'Top'], ['center', 'По центру', 'Centre'], ['bottom', 'Снизу', 'Bottom']].map(([k, ru, en]) => chip('data-pos', k, '', esc(tt(ru, en)))).join('')}<span class="small muted">${esc(tt('или перетащите текст', 'or drag the text'))}</span></div>
        <div class="pc-row" role="group" aria-label="${esc(tt('Фон текста', 'Text background'))}"><b class="small">${esc(tt('Фон текста', 'Text background'))}</b>
          ${chip('data-bg', 'none', st.bg, esc(tt('Без фона', 'None')))}${chip('data-bg', 'grad', st.bg, esc(tt('Градиент', 'Gradient')))}${chip('data-bg', 'plate', st.bg, esc(tt('Плашка', 'Plate')))}</div>
        ${st.bg !== 'none' ? `<div class="pc-row">${chip('data-tone', 'dark', st.tone, esc(tt('Тёмный', 'Dark')))}${chip('data-tone', 'light', st.tone, esc(tt('Светлый', 'Light')))}
          ${st.bg === 'grad' ? [['top', 'сверху', 'top'], ['bottom', 'снизу', 'bottom'], ['left', 'слева', 'left'], ['right', 'справа', 'right']].map(([k, ru, en]) => chip('data-side', k, st.side, esc(tt(ru, en)))).join('') : ''}</div>` : ''}
        <button class="link-btn" type="button" data-notext>${esc(tt('Убрать текст', 'Remove the text'))}</button>`
      : `<div class="row"><button class="btn light" type="button" data-addtext>${esc(tt('Добавить текст', 'Add text'))}</button></div>`}
      <div class="pc-send">
        <button class="btn yellow big" type="button" data-send ${st.on && st.overflow ? 'disabled' : ''}>${esc(tt('Отправить', 'Send'))}</button>
        <div class="row"><button class="btn sm light" type="button" data-save ${st.on && st.overflow ? 'disabled' : ''}>${esc(tt('Сохранить открытку', 'Save postcard'))}</button>
          <button class="btn sm light" type="button" data-copytext>${esc(tt('Скопировать текст и ссылку', 'Copy text and link'))}</button></div>
        <p class="vb-note" style="margin:0">${esc(tt('Если мессенджер принимает картинку и подпись отдельно: сохраните открытку и вставьте скопированный текст. По ссылке человек увидит эту карту без вашего пожелания и сможет начать свой обмен.', 'If your messenger takes the image and the caption separately: save the postcard and paste the copied text. The link shows this card without your wish, and the person can start their own exchange.'))}</p>
      </div></div>`;
    const cv = ctx.main.querySelector('#pc'); draw(cv); cv.style.touchAction = st.on ? 'none' : 'auto';
    wire(cv);
    if (focusId === 'pct') { const t = ctx.main.querySelector('#pct'); t.focus(); if (sel) t.setSelectionRange(sel[0], sel[1]); }
  }
  function redrawOnly() { const cv = ctx.main.querySelector('#pc'); const before = st.overflow; draw(cv); if (before !== st.overflow) render(); }
  const exportBlob = () => new Promise((res) => { const c = document.createElement('canvas'); draw(c); c.toBlob(res, 'image/png'); });
  const fileName = () => `d-cards-${card.code}-otkrytka.png`;
  const captionText = () => `${st.on && st.text.trim() ? st.text.trim() + '\n\n' : ''}${SLOGAN()}\n${link}`;
  function wire(cv) {
    const $ = (q) => ctx.main.querySelector(q);
    const at = $('[data-addtext]'); if (at) at.onclick = () => { st.on = true; render(); $('#pct').focus(); };
    const nt = $('[data-notext]'); if (nt) nt.onclick = () => { st.on = false; st.text = ''; render(); };
    const ta = $('#pct'); if (ta) ta.addEventListener('input', () => {
      st.text = ta.value; redrawOnly();
      // выбор шрифта показан на тексте человека
      ctx.main.querySelectorAll('[data-font] span').forEach((sp, i) => { sp.textContent = (st.text.trim().split('\n')[0] || FONTS[i].name).slice(0, 18); });
    });
    ctx.main.querySelectorAll('[data-font]').forEach((b) => b.onclick = () => { st.font = b.dataset.font; render(); });
    ctx.main.querySelectorAll('[data-weight]').forEach((b) => b.onclick = () => { st.weight = Number(b.dataset.weight); render(); });
    ctx.main.querySelectorAll('[data-color]').forEach((b) => b.onclick = () => { st.color = b.dataset.color; render(); });
    ctx.main.querySelectorAll('[data-size]').forEach((b) => b.onclick = () => { st.k = Math.min(0.14, Math.max(0.032, st.k + Number(b.dataset.size) * 0.008)); render(); });
    ctx.main.querySelectorAll('[data-pos]').forEach((b) => b.onclick = () => { st.cy = b.dataset.pos === 'top' ? 0 : b.dataset.pos === 'center' ? 0.47 : 1; st.cx = 0.5; render(); });
    ctx.main.querySelectorAll('[data-bg]').forEach((b) => b.onclick = () => { st.bg = b.dataset.bg; render(); });
    ctx.main.querySelectorAll('[data-tone]').forEach((b) => b.onclick = () => { st.tone = b.dataset.tone; render(); });
    ctx.main.querySelectorAll('[data-side]').forEach((b) => b.onclick = () => { st.side = b.dataset.side; render(); });
    // перетаскивание пальцем или мышью — только за сам текст; за край изображения и на подпись автора не уходит
    let drag = null;
    const pt = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)]; };
    cv.onpointerdown = (e) => {
      if (!st.on || !st.box) return; const [px, py] = pt(e); const b = st.box; const m = W * 0.04;
      if (px < b.x - m || px > b.x + b.w + m || py < b.y - m || py > b.y + b.h + m) return;
      drag = { dx: px - st.cx * W, dy: py - st.cy * H }; try { cv.setPointerCapture(e.pointerId); } catch { /* */ } e.preventDefault();
    };
    cv.onpointermove = (e) => { if (!drag) return; const [px, py] = pt(e); st.cx = (px - drag.dx) / W; st.cy = (py - drag.dy) / H; draw(cv); };
    cv.onpointerup = cv.onpointercancel = () => { drag = null; };
    $('[data-save]').onclick = async () => {
      const blob = await exportBlob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName(); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000); toast(tt('Открытка сохранена', 'Postcard saved'));
    };
    $('[data-copytext]').onclick = () => shareInvite('copy', link, `${st.on && st.text.trim() ? st.text.trim() + '\n\n' : ''}${SLOGAN()}`, tt('Текст и ссылка скопированы', 'Text and link copied'));
    $('[data-send]').onclick = async () => {
      const blob = await exportBlob(); const file = new File([blob], fileName(), { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], text: captionText() }); return; } catch (x) { if (x && x.name === 'AbortError') return; }
      }
      // нет отправки файлов в этом браузере — сохраняем картинку и копируем текст со ссылкой
      $('[data-save]').click(); await shareInvite('copy', link, `${st.on && st.text.trim() ? st.text.trim() + '\n\n' : ''}${SLOGAN()}`, tt('Открытка сохранена, текст и ссылка скопированы', 'Postcard saved, text and link copied'));
    };
  }
  render();
}
