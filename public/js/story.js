// Картинка для Instagram Stories 1080×1920 (21.11.2026, по тестированию): вопрос — до ответов, карта крупно, блоки ответов
// по высоте текста. Подпись «Автор · Имя» короткая, без номера карты. Всё содержимое — вне зон, которые перекрывает
// интерфейс Stories (верх ~220 px: полоса и профиль; низ ~260 px: поле ответа). Внизу «Что видишь ты?», Dialogue Cards
// и @dialogue.cards. Язык макета задаёт предложивший (L) — у обоих участников и в файле картинка одинаковая.
const T = {
  ru: { author: 'Автор', friend: 'Друг', ask: 'Что видишь ты?', q: 'Что ты здесь видишь?' },
  en: { author: 'Author', friend: 'Friend', ask: 'What do you see?', q: 'What do you see here?' },
};
const DEFAULT_QS = { 'Что ты здесь видишь?': 'What do you see here?', 'Что тебе откликается в этой карте?': 'What resonates with you in this card?' };

function lines(ctx, text, maxW) {
  const words = String(text).split(/\s+/).filter(Boolean); const out = []; let cur = '';
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (ctx.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t; }
  if (cur) out.push(cur); return out;
}
const rr = (x, a, b, w, h, r) => { x.beginPath(); (x.roundRect ? x.roundRect(a, b, w, h, r) : x.rect(a, b, w, h)); };

export async function storyCanvas({ card, author, question, aName, aText, bName, bText, L = 'ru' }) {
  const t = T[L] || T.ru;
  const W = 1080; const H = 1920; const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#060c1e'; x.fillRect(0, 0, W, H);
  try { await Promise.all([document.fonts.load('800 60px Rubik'), document.fonts.load('400 40px Onest'), document.fonts.load('600 34px Onest')]); } catch { /* системный шрифт */ }
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = card.full || card.thumb; });
  const fam = 'Onest, sans-serif'; const pad = 70; const textW = W - pad * 2 - 64;
  const SAFE_TOP = 230; const SAFE_BOTTOM = 270; const FOOT = 150; // подпись проекта над нижней зоной интерфейса
  const answers = [[aName, aText], [bName, bText]].filter(([, s]) => s && String(s).trim());
  const q = answers.length && question ? (L === 'en' ? (DEFAULT_QS[question] || question) : question) : '';
  let size = 40; let blocks = []; let qLines = []; let qSize = 46;
  const GAP = 20; const AUTHOR = author ? 60 : 16;
  const measure = (sz) => {
    x.font = `400 ${sz}px ${fam}`;
    return answers.map(([n, s]) => { const ls = lines(x, s, textW); return { name: n, ls, h: 56 + ls.length * sz * 1.3 + 26 }; });
  };
  const total = (bs) => bs.reduce((s, b) => s + b.h, 0) + Math.max(0, bs.length - 1) * GAP;
  const qHeight = () => { if (!q) return 0; x.font = `800 ${qSize}px Rubik, sans-serif`; qLines = lines(x, q, W - pad * 2); return qLines.length * qSize * 1.2 + 26; };
  const avail = H - SAFE_TOP - SAFE_BOTTOM - FOOT;
  const minCard = 700; const maxCard = answers.length ? 1000 : 1240;
  for (size = 40; size >= 30; size -= 2) { blocks = measure(size); qSize = size >= 36 ? 46 : 40; if (avail - AUTHOR - qHeight() - total(blocks) - (blocks.length ? 30 : 0) >= minCard) break; }
  const qh = qHeight();
  const ch = Math.max(560, Math.min(maxCard, avail - AUTHOR - qh - total(blocks) - (blocks.length ? 30 : 0)));
  const cw = Math.round(ch * img.width / img.height); const cx = (W - cw) / 2;
  const content = ch + AUTHOR + qh + (blocks.length ? 30 + total(blocks) : 0);
  let y = SAFE_TOP + Math.max(0, (avail - content) / 2);
  x.save(); x.shadowColor = 'rgba(0,0,0,.45)'; x.shadowBlur = 40; x.shadowOffsetY = 14; rr(x, cx, y, cw, ch, 30); x.fillStyle = '#000'; x.fill(); x.restore();
  x.save(); rr(x, cx, y, cw, ch, 30); x.clip(); x.drawImage(img, cx, y, cw, ch); x.restore();
  y += ch;
  if (author) { x.textAlign = 'center'; x.fillStyle = 'rgba(241,230,200,.7)'; x.font = `400 28px ${fam}`; x.fillText(`${t.author} · ${author}`, W / 2, y + 42); }
  y += AUTHOR;
  if (q) { x.textAlign = 'center'; x.fillStyle = '#f1e6c8'; x.font = `800 ${qSize}px Rubik, sans-serif`; let qy = y + qSize; for (const l of qLines) { x.fillText(l, W / 2, qy); qy += qSize * 1.2; } y += qh; }
  if (blocks.length) y += 30;
  for (const b of blocks) {
    x.fillStyle = 'rgba(241,230,200,.09)'; rr(x, pad, y, W - pad * 2, b.h, 26); x.fill();
    x.textAlign = 'left'; x.fillStyle = '#f6c23c'; x.font = `600 30px ${fam}`; x.fillText(String(b.name || t.friend).toUpperCase().slice(0, 26), pad + 32, y + 48);
    x.fillStyle = '#f1e6c8'; x.font = `400 ${size}px ${fam}`;
    let ty = y + 56 + size * 0.95; for (const l of b.ls) { x.fillText(l, pad + 32, ty); ty += size * 1.3; }
    y += b.h + GAP;
  }
  const fy = H - SAFE_BOTTOM - FOOT;
  x.textAlign = 'center'; x.fillStyle = '#f6c23c'; x.font = '800 54px Rubik, sans-serif'; x.fillText(t.ask, W / 2, fy + 62);
  x.fillStyle = 'rgba(241,230,200,.75)'; x.font = `400 30px ${fam}`; x.fillText('Dialogue Cards · @dialogue.cards', W / 2, fy + 112);
  return c;
}
