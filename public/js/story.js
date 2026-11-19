// Вертикальная картинка для сторис 1080×1920: иллюстрация, авторство и два ответа. Длинные ответы уменьшаются по размеру,
// чтобы поместиться целиком (до 300 знаков каждый). Рисуется в браузере, на сервер ничего не уходит.
import { tt } from './util.js';

function lines(ctx, text, maxW) {
  const words = String(text).split(/\s+/); const out = []; let cur = '';
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (ctx.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t; }
  if (cur) out.push(cur); return out;
}
/** Подбирает размер шрифта, чтобы текст поместился в blockH. */
function fit(ctx, text, maxW, blockH, family) {
  for (let size = 42; size >= 24; size -= 2) {
    ctx.font = `400 ${size}px ${family}`; const ls = lines(ctx, text, maxW);
    if (ls.length * size * 1.28 <= blockH) return { size, ls };
  }
  ctx.font = `400 24px ${family}`; return { size: 24, ls: lines(ctx, text, maxW).slice(0, Math.floor(blockH / 31)) };
}
export async function storyCanvas({ card, author, aName, aText, bName, bText }) {
  const W = 1080; const H = 1920; const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#060c1e'; x.fillRect(0, 0, W, H);
  try { await document.fonts.load('800 60px Rubik'); await document.fonts.load('400 40px Onest'); await document.fonts.load('600 34px Onest'); } catch { /* системный шрифт */ }
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = card.full || card.thumb; });
  const ch = 900; const cw = Math.round(ch * img.width / img.height); const cx = (W - cw) / 2; const cy = 200;
  x.save(); x.beginPath(); (x.roundRect ? x.roundRect(cx, cy, cw, ch, 34) : x.rect(cx, cy, cw, ch)); x.clip(); x.drawImage(img, cx, cy, cw, ch); x.restore();
  x.fillStyle = '#f1e6c8'; x.font = '800 62px Rubik, sans-serif'; x.textAlign = 'center';
  x.fillText(tt('Что ты здесь видишь?', 'What do you see here?'), W / 2, 138);
  const fam = 'Onest, sans-serif';
  const col = (name, text, left) => {
    const bx = left ? 60 : W / 2 + 12; const bw = W / 2 - 72; const by = 1140; const bh = 480;
    x.fillStyle = 'rgba(241,230,200,.08)'; x.beginPath(); (x.roundRect ? x.roundRect(bx, by, bw, bh, 28) : x.rect(bx, by, bw, bh)); x.fill();
    x.textAlign = 'left'; x.fillStyle = '#f6c23c'; x.font = `600 32px ${fam}`; x.fillText(String(name || tt('Друг', 'Friend')).toUpperCase().slice(0, 22), bx + 28, by + 58);
    x.fillStyle = '#f1e6c8'; const { size, ls } = fit(x, text, bw - 56, bh - 100, fam);
    let y = by + 100 + size * 0.4; for (const l of ls) { x.fillText(l, bx + 28, y); y += size * 1.28; }
  };
  col(aName, aText, true); col(bName, bText, false);
  x.textAlign = 'center'; x.fillStyle = 'rgba(241,230,200,.72)'; x.font = `400 32px ${fam}`;
  x.fillText(`${card.code}${author ? ` · ${tt('художник', 'artist')}: ${author}` : ''}`, W / 2, 1700);
  // короткий публичный адрес этой карты и приглашение ответить (адрес в картинке не нажимается — ссылку для стикера копируют отдельно)
  x.fillStyle = '#f6c23c'; x.font = '800 46px Rubik, sans-serif'; x.fillText(tt('Ответь, что видишь ты', 'Answer what you see'), W / 2, 1790);
  x.fillStyle = 'rgba(241,230,200,.78)'; x.font = `400 30px ${fam}`; x.fillText(`harekrishna.info/dialogue-cards/play/${card.code}`, W / 2, 1846);
  return c;
}
