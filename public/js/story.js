// Вертикальная картинка для Instagram Stories 1080×1920 (21.11.2026): крупная иллюстрация, под ней «Автор: …», ответы —
// готовым текстом, высота блока зависит от длины ответа (без пустых полей). Внизу «Что видишь ты?» и @dialogue.cards.
// Номера карты нет. Вариант без ответов — только карта (для публикации без согласий). Рисуется в браузере.
import { tt } from './util.js';

function lines(ctx, text, maxW) {
  const words = String(text).split(/\s+/).filter(Boolean); const out = []; let cur = '';
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (ctx.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t; }
  if (cur) out.push(cur); return out;
}
const rr = (x, a, b, w, h, r) => { x.beginPath(); (x.roundRect ? x.roundRect(a, b, w, h, r) : x.rect(a, b, w, h)); };

export async function storyCanvas({ card, author, aName, aText, bName, bText }) {
  const W = 1080; const H = 1920; const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#060c1e'; x.fillRect(0, 0, W, H);
  try { await Promise.all([document.fonts.load('800 60px Rubik'), document.fonts.load('400 40px Onest'), document.fonts.load('600 34px Onest')]); } catch { /* системный шрифт */ }
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = card.full || card.thumb; });
  const fam = 'Onest, sans-serif'; const pad = 70; const textW = W - pad * 2 - 64;
  // ответы: имя и текст; размер шрифта уменьшается, только если ответы не помещаются при крупной карте
  const answers = [[aName, aText], [bName, bText]].filter(([, t]) => t && String(t).trim());
  let size = 40; let blocks = [];
  const BOTTOM = 230; const TOP = 90; const AUTHOR = author ? 64 : 20; const GAP = 22;
  const measure = (sz) => {
    x.font = `400 ${sz}px ${fam}`;
    return answers.map(([n, t]) => { const ls = lines(x, t, textW); return { name: n, ls, h: 58 + ls.length * sz * 1.3 + 28 }; });
  };
  const total = (bs) => bs.reduce((s, b) => s + b.h, 0) + Math.max(0, bs.length - 1) * GAP;
  const maxCard = answers.length ? 1180 : 1480; const minCard = 760; // без ответов — карта крупнее
  for (size = 40; size >= 30; size -= 2) { blocks = measure(size); if (H - TOP - AUTHOR - BOTTOM - total(blocks) - (blocks.length ? 36 : 0) >= minCard) break; }
  const ch = Math.max(minCard - 120, Math.min(maxCard, H - TOP - AUTHOR - BOTTOM - total(blocks) - (blocks.length ? 36 : 0)));
  const cw = Math.round(ch * img.width / img.height); const cx = (W - cw) / 2;
  // всё по вертикали — по центру свободного места между верхом и подписью внизу
  const content = ch + AUTHOR + (blocks.length ? 36 + total(blocks) : 0);
  let y = TOP + Math.max(0, (H - TOP - BOTTOM - content) / 2);
  x.save(); x.shadowColor = 'rgba(0,0,0,.45)'; x.shadowBlur = 40; x.shadowOffsetY = 14; rr(x, cx, y, cw, ch, 30); x.fillStyle = '#000'; x.fill(); x.restore();
  x.save(); rr(x, cx, y, cw, ch, 30); x.clip(); x.drawImage(img, cx, y, cw, ch); x.restore();
  y += ch;
  if (author) { x.textAlign = 'center'; x.fillStyle = 'rgba(241,230,200,.72)'; x.font = `400 30px ${fam}`; x.fillText(`${tt('Автор', 'Artist')}: ${author}`, W / 2, y + 46); }
  y += AUTHOR;
  if (blocks.length) y += 36;
  for (const b of blocks) {
    x.fillStyle = 'rgba(241,230,200,.09)'; rr(x, pad, y, W - pad * 2, b.h, 26); x.fill();
    x.textAlign = 'left'; x.fillStyle = '#f6c23c'; x.font = `600 30px ${fam}`; x.fillText(String(b.name || tt('Друг', 'Friend')).toUpperCase().slice(0, 26), pad + 32, y + 50);
    x.fillStyle = '#f1e6c8'; x.font = `400 ${size}px ${fam}`;
    let ty = y + 58 + size * 0.95; for (const l of b.ls) { x.fillText(l, pad + 32, ty); ty += size * 1.3; }
    y += b.h + GAP;
  }
  x.textAlign = 'center'; x.fillStyle = '#f6c23c'; x.font = '800 58px Rubik, sans-serif'; x.fillText(tt('Что видишь ты?', 'What do you see?'), W / 2, H - 130);
  x.fillStyle = 'rgba(241,230,200,.75)'; x.font = `400 30px ${fam}`; x.fillText('@dialogue.cards', W / 2, H - 76);
  return c;
}
