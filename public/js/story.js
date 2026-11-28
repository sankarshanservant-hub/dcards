// Картинка для Instagram Stories 1080×1920 (26.11.2026 — новая композиция сохраняемой картинки, не только превью):
// сверху заданный вопрос; крупная иллюстрация — главный элемент; два ответа с именами (короткие — в две колонки, длинные —
// друг под другом); компактное авторство; внизу Dialogue Cards, профиль проекта и «Повод для интересного разговора».
// Пустоты — только необходимые: верхняя и нижняя зоны, которые перекрывает интерфейс Stories (полоса и профиль сверху,
// поле ответа снизу). Пропорции карты не искажаются, карта не обрезается. Язык макета задаёт предложивший (L) — у обоих
// участников и в файле картинка одинаковая. Отдельного «Что видишь ты?» больше нет: он спорил с настоящим вопросом.
const T = {
  ru: { author: 'Автор', friend: 'Друг', tagline: 'Повод для интересного разговора' },
  en: { author: 'Author', friend: 'Friend', tagline: 'A reason for an interesting conversation' },
};
const DEFAULT_QS = { 'Что ты здесь видишь?': 'What do you see here?', 'Что тебе откликается в этой карте?': 'What resonates with you in this card?' };
// профиль проекта — тот же, что в «Передать привет создателям» (STICKER_HANDLE в views/exchange.js) и на рубашке карты
const HANDLE = '@dialogue.cards';

/** Строки по ширине; слово длиннее строки переносится по буквам (ссылки, длинные слова) — текст не выходит за край. */
function lines(ctx, text, maxW) {
  const out = []; let cur = '';
  const push = (w) => {
    if (ctx.measureText(w).width <= maxW) return [w];
    const parts = []; let p = '';
    for (const ch of w) { if (ctx.measureText(p + ch).width > maxW && p) { parts.push(p); p = ch; } else p += ch; }
    if (p) parts.push(p); return parts;
  };
  for (const w0 of String(text).split(/\s+/).filter(Boolean)) {
    for (const w of push(w0)) { const t = cur ? `${cur} ${w}` : w; if (ctx.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t; }
  }
  if (cur) out.push(cur); return out;
}
const rr = (x, a, b, w, h, r) => { x.beginPath(); (x.roundRect ? x.roundRect(a, b, w, h, r) : x.rect(a, b, w, h)); };
const clip = (s, n) => { const t = String(s || ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

export async function storyCanvas({ card, author, question, aName, aText, bName, bText, L = 'ru' }) {
  const t = T[L] || T.ru;
  const W = 1080; const H = 1920; const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#060c1e'; x.fillRect(0, 0, W, H);
  try { await Promise.all([document.fonts.load('800 60px Rubik'), document.fonts.load('400 40px Onest'), document.fonts.load('600 34px Onest')]); } catch { /* системный шрифт */ }
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = card.full || card.thumb; });
  const fam = 'Onest, sans-serif'; const head = 'Rubik, sans-serif';
  const pad = 60; const innerW = W - pad * 2;
  const SAFE_TOP = 210; const SAFE_BOTTOM = 230; // зоны интерфейса Stories
  const FOOT = 96; // Dialogue Cards · профиль + слоган
  const answers = [[aName, aText], [bName, bText]].filter(([, s]) => s && String(s).trim()).map(([n, s]) => [clip(String(n || t.friend).toUpperCase(), 24), String(s).trim()]);
  const q = answers.length && question ? (L === 'en' ? (DEFAULT_QS[question] || question) : question) : '';
  const avail = H - SAFE_TOP - SAFE_BOTTOM - FOOT - 28; // 28 — отступ до подписи проекта
  const AUTHOR = author ? 50 : 0;
  const ratio = img.height / img.width;
  const maxCardH = Math.round(innerW * ratio);
  const GAP = 26;

  // вопрос: крупно, до трёх строк; длинный — мельче
  let qSize = 58; let qLines = [];
  const qMeasure = () => { if (!q) return 0; x.font = `800 ${qSize}px ${head}`; qLines = lines(x, q, innerW); return qLines.length * qSize * 1.16; };
  let qh = qMeasure();
  while (q && qLines.length > 3 && qSize > 40) { qSize -= 4; qh = qMeasure(); }

  // ответы: короткие — две колонки, длинные — блоки друг под другом; размер шрифта подбирается, чтобы карта оставалась крупной
  const NAME = 30; const PADX = 26; const PADY = 22;
  let aSize = 38; let layout = null;
  const measureAnswers = (sz) => {
    x.font = `400 ${sz}px ${fam}`;
    if (answers.length === 2) {
      const colW = (innerW - 18) / 2 - PADX * 2;
      const cols = answers.map(([n, s]) => ({ name: n, ls: lines(x, s, colW) }));
      if (Math.max(...cols.map((b) => b.ls.length)) <= 4) {
        const hh = PADY * 2 + NAME + 10 + Math.max(...cols.map((b) => b.ls.length)) * sz * 1.28;
        return { cols: true, blocks: cols, h: hh, blockH: hh };
      }
    }
    const blocks = answers.map(([n, s]) => { const ls = lines(x, s, innerW - PADX * 2); return { name: n, ls, h: PADY * 2 + NAME + 10 + ls.length * sz * 1.28 }; });
    return { cols: false, blocks, h: blocks.reduce((a, b) => a + b.h, 0) + Math.max(0, blocks.length - 1) * 14 };
  };
  const cardFor = (ah) => avail - (q ? qh + GAP : 0) - AUTHOR - (answers.length ? ah + GAP : 0);
  const MIN_CARD = answers.length ? 820 : 1200;
  for (aSize = 38; aSize >= 28; aSize -= 2) { layout = answers.length ? measureAnswers(aSize) : { h: 0, blocks: [] }; if (cardFor(layout.h) >= MIN_CARD) break; }
  if (aSize < 28) aSize = 28;
  const ah = layout.h;
  const ch = Math.max(640, Math.min(maxCardH, cardFor(ah)));
  const cw = Math.round(ch / ratio); const cx = (W - cw) / 2;
  // если карта упёрлась в ширину, остаток делится поровну между блоками — без огромных пустот сверху и снизу
  const used = (q ? qh : 0) + ch + AUTHOR + (answers.length ? ah : 0);
  const nGaps = (q ? 1 : 0) + (answers.length ? 1 : 0);
  const spare = Math.max(0, avail - used - nGaps * GAP);
  const gap = GAP + (nGaps ? Math.min(spare / (nGaps + 2), 60) : 0);
  const top = SAFE_TOP + Math.max(0, (avail - used - nGaps * gap) / 2);
  let y = top;

  if (q) {
    x.textAlign = 'center'; x.fillStyle = '#f1e6c8'; x.font = `800 ${qSize}px ${head}`; x.textBaseline = 'alphabetic';
    let qy = y + qSize * 0.92; for (const l of qLines) { x.fillText(l, W / 2, qy); qy += qSize * 1.16; }
    y += qh + gap;
  }
  x.save(); x.shadowColor = 'rgba(0,0,0,.45)'; x.shadowBlur = 36; x.shadowOffsetY = 12; rr(x, cx, y, cw, ch, 26); x.fillStyle = '#000'; x.fill(); x.restore();
  x.save(); rr(x, cx, y, cw, ch, 26); x.clip(); x.drawImage(img, cx, y, cw, ch); x.restore();
  y += ch;
  if (author) { x.textAlign = 'center'; x.fillStyle = 'rgba(241,230,200,.66)'; x.font = `400 26px ${fam}`; x.fillText(clip(`${t.author} · ${author}`, 60), W / 2, y + 36); y += AUTHOR; }
  if (answers.length) {
    y += gap;
    const drawBlock = (b, bx, by, bw, bh) => {
      x.fillStyle = 'rgba(241,230,200,.09)'; rr(x, bx, by, bw, bh, 24); x.fill();
      x.textAlign = 'left'; x.fillStyle = '#f6c23c'; x.font = `600 ${NAME - 4}px ${fam}`; x.fillText(b.name, bx + PADX, by + PADY + NAME - 6);
      x.fillStyle = '#f1e6c8'; x.font = `400 ${aSize}px ${fam}`;
      let ty = by + PADY + NAME + 10 + aSize * 0.95; for (const l of b.ls) { x.fillText(l, bx + PADX, ty); ty += aSize * 1.28; }
    };
    if (layout.cols) {
      const bw = (innerW - 18) / 2;
      layout.blocks.forEach((b, i) => drawBlock(b, pad + i * (bw + 18), y, bw, layout.blockH));
    } else {
      for (const b of layout.blocks) { drawBlock(b, pad, y, innerW, b.h); y += b.h + 14; }
    }
  }
  // подпись проекта — над нижней зоной интерфейса
  const fy = H - SAFE_BOTTOM - FOOT;
  x.textAlign = 'center';
  x.fillStyle = '#f6c23c'; x.font = `800 34px ${head}`; x.fillText(`Dialogue Cards · ${HANDLE}`, W / 2, fy + 44);
  x.fillStyle = 'rgba(241,230,200,.75)'; x.font = `400 28px ${fam}`; x.fillText(t.tagline, W / 2, fy + 86);
  return c;
}
