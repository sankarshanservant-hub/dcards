// Отрисовка открытки (21.11.2026): одна функция для редактора, «Моих открыток» и экспорта — картинка совпадает с предпросмотром.
// Оформление (design) — простой объект, его и сохраняем в «Мои открытки»; сама картинка каждый раз рисуется заново.
import { u } from './util.js';

export const FONTS = [
  { key: 'onest', ru: 'Простой', en: 'Simple', file: 'onest', family: 'DCOnest', weights: [300, 500, 700] },
  { key: 'serif', ru: 'Классический', en: 'Classic', file: 'noto-serif', family: 'DCSerif', weights: [300, 500, 700] },
  { key: 'hand', ru: 'Рукописный', en: 'Handwritten', file: 'caveat', family: 'DCHand', weights: [400, 500, 700], scale: 1.3 },
];
export const weightOf = (f, w) => f.weights[{ light: 0, mid: 1, bold: 2 }[w] ?? 1];
export const DEFAULT_DESIGN = { layout: 'full', paper: '#ffffff', text: '', font: 'onest', weight: 'mid', color: '#ffffff', k: 0.064, align: 'center', cx: 0.5, cy: 0.15, bg: 'grad', tone: 'dark' };
export const DESIGN_KEYS = Object.keys(DEFAULT_DESIGN);
export const cleanDesign = (d) => { const o = {}; for (const k of DESIGN_KEYS) o[k] = d && d[k] !== undefined ? d[k] : DEFAULT_DESIGN[k]; o.text = String(o.text || '').slice(0, 240); return o; };

const CYR = 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116';
const LAT = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
let fontsReady = null;
/** Шрифты открытки подгружаются только здесь (не на всём сайте). */
export function loadFonts() {
  if (fontsReady) return fontsReady;
  const faces = [];
  for (const f of FONTS) for (const w of f.weights) for (const [sub, range] of [['cyrillic', CYR], ['latin', LAT]]) {
    const ff = new FontFace(f.family, `url(${u(`/fonts/card/${f.file}-${sub}-${w}-normal.woff2`)}) format('woff2')`, { weight: String(w), unicodeRange: range });
    document.fonts.add(ff); faces.push(ff.load().catch(() => null));
  }
  fontsReady = Promise.all(faces);
  return fontsReady;
}
export const loadImage = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

/** Геометрия макета: размер открытки и место иллюстрации. */
export function geo(st, W, H) {
  if (st.layout === 'frame') { const m = Math.round(W * 0.06); const band = Math.round(H * 0.24); return { CW: W + m * 2, CH: H + m + band, ix: m, iy: m, iw: W, ih: H, r: 0, band: [H + m, band] }; }
  if (st.layout === 'poster') { const iw = Math.round(W * 0.8); const ih = Math.round(H * 0.8); const CW = W; const CH = Math.round(H * 1.12); return { CW, CH, ix: (CW - iw) / 2, iy: (CH - ih) / 2, iw, ih, r: W * 0.04 }; }
  return { CW: W, CH: H, ix: 0, iy: 0, iw: W, ih: H, r: 0 };
}

function layoutText(x, st, g) {
  const f = FONTS.find((y) => y.key === st.font) || FONTS[0];
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
  const overflow = bh > g.CH - pad * 2 || lines.some((l) => x.measureText(l).width > maxW + 1);
  // текст не уходит за край открытки
  let cy = st.cy * g.CH; cy = Math.min(g.CH - pad - bh / 2, Math.max(pad + bh / 2, cy));
  let cx = st.cx * g.CW; cx = Math.min(g.CW - pad - bw / 2, Math.max(pad + bw / 2, cx));
  st.cy = cy / g.CH; st.cx = cx / g.CW;
  return { f, size, lines, lh, bh, bw, cx, cy, overflow };
}

/** Рисует открытку на canvas. Возвращает { box, overflow } — рамку текста в координатах открытки (для выделения). */
export function drawPostcard(c, st, img) {
  const W = img.naturalWidth; const H = img.naturalHeight;
  const g = geo(st, W, H); const x = c.getContext('2d'); c.width = g.CW; c.height = g.CH;
  if (st.layout !== 'full') { x.fillStyle = st.paper; x.fillRect(0, 0, g.CW, g.CH); }
  x.save();
  if (st.layout === 'poster') { x.shadowColor = 'rgba(0,0,0,.28)'; x.shadowBlur = W * 0.04; x.shadowOffsetY = W * 0.012; }
  if (g.r) { x.beginPath(); (x.roundRect ? x.roundRect(g.ix, g.iy, g.iw, g.ih, g.r) : x.rect(g.ix, g.iy, g.iw, g.ih)); x.fillStyle = '#000'; x.fill(); x.shadowColor = 'transparent'; x.clip(); }
  x.drawImage(img, g.ix, g.iy, g.iw, g.ih);
  x.restore();
  if (!String(st.text || '').trim()) return { box: null, overflow: false, g };
  const L = layoutText(x, st, g);
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
  return { box: { x: L.cx - L.bw / 2, y: L.cy - L.bh / 2, w: L.bw, h: L.bh, CW: g.CW, CH: g.CH }, overflow: L.overflow, g };
}

/** Готовое изображение PNG (тот же рисунок, без рамки выделения). */
export function postcardBlob(st, img) {
  return new Promise((res) => { const c = document.createElement('canvas'); drawPostcard(c, { ...st }, img); c.toBlob((b) => res(b), 'image/png'); });
}
export const postcardFileName = (code) => `dialogue-cards-${code}-otkrytka.png`;
