// «Играть одному» (19.11.2026): четыре игры для одного человека, без регистрации. Карты — из галереи (случайная выдача).
// Выборы, замены и раскрытия карт здесь не увеличивают «Выбрали для разговора»: на сервер ничего не отправляется.
// Очков, таймеров, рейтингов и автоматической оценки ответов нет — игрок отвечает про себя.
import { lang } from '../i18n.js';
import { esc, tt, u, api } from '../util.js';
import { ic, loading, failed, session } from '../ui.js';
import { openViewer } from '../viewer.js';

export const SOLO_GAMES = [
  { key: 'story', path: '/group/solo/story', ru: 'История из трёх карт', en: 'A story from three cards', dru: 'Три карты по очереди: первая начинает историю, вторая меняет её ход, третья помогает закончить.', den: 'Three cards in turn: the first starts a story, the second changes its course, the third helps end it.' },
  { key: 'connect', path: '/group/solo/connect', ru: 'Что их связывает?', en: 'What connects them?', dru: 'Две карты рядом. Найди между ними связь — а потом ещё одну.', den: 'Two cards side by side. Find a connection between them — and then another one.' },
  { key: 'eagle', path: '/group/solo/eagle', ru: 'Глаз-алмаз', en: 'Eagle Eye', dru: 'Рассмотри карту, сколько хочешь. Потом она скроется — и будет один вопрос на наблюдательность.', den: 'Look at the card as long as you like. Then it hides — and you get one question about what you noticed.' },
  { key: 'imagine', path: '/group/solo/imagine', ru: 'Придумай ассоциации', en: 'Find associations', dru: 'Найди на карте две детали, придумай к ним ассоциации и соедини по одной в новый образ.', den: 'Find two details on the card, come up with associations and combine one from each into a new image.' },
];
const G = (k) => SOLO_GAMES.find((g) => g.key === k);
const T = (g) => (lang === 'en' ? g.en : g.ru);
const D = (g) => (lang === 'en' ? g.den : g.dru);

/** Раздел «Играть одному»: список из четырёх игр. */
export function hub(ctx) {
  ctx.main.innerHTML = `<div class="wrap page narrow stack">
    <div class="page-head"><p class="eyebrow">Dialogue Cards</p><h1>${esc(tt('Играть одному', 'Play solo'))}</h1>
      <p class="sub">${esc(tt('Игры для одного — без регистрации. Отвечай про себя.', 'Games for one — no sign-up. Answer to yourself.'))}</p></div>
    <div class="list">${SOLO_GAMES.map((g) => `<a class="item" href="${u(g.path)}"><span class="body"><b>${esc(T(g))}</b><span class="small">${esc(D(g))}</span></span><span aria-hidden="true">→</span></a>`).join('')}</div>
    <p class="small muted">${esc(tt('Играть вдвоём или компанией:', 'Play with others:'))} <a href="${u('/group')}">${esc(tt('Играть компанией', 'Play with friends'))}</a> · <a href="${u('/library?play=friend')}">${esc(tt('Отправить другу с вопросом', 'Send to a friend with a question'))}</a></p>
  </div>`;
}

async function loadCards(ctx) {
  const { cards } = await api('/api/cards');
  return cards.filter((c) => !c.isDemo || session.showDemo);
}
const pickOther = (cards, avoid) => { const pool = cards.filter((c) => !avoid.includes(c.code)); const from = pool.length ? pool : cards; return from[Math.floor(Math.random() * from.length)]; };
const cardImg = (c, cls = 'live-card') => `<button type="button" class="live-card-btn" data-zoom="${esc(c.code)}" aria-label="${esc(tt('Рассмотреть карту', 'View card'))} ${esc(c.code)}"><img class="${cls}" src="${esc(c.full || c.thumb)}" alt="${esc(c.code)}" width="${c.width || 910}" height="${c.height || 1560}"></button>`;
const frame = (g, inner) => `<div class="wrap page narrow stack solo-page"><p class="eyebrow" style="margin:0"><a href="${u('/group/solo')}">${esc(tt('Играть одному', 'Play solo'))}</a></p><h1 style="margin:0">${esc(T(g))}</h1>${inner}</div>`;
function zoomer(ctx, cards) { ctx.main.addEventListener('click', (e) => { const z = e.target.closest('[data-zoom]'); if (z) { const c = cards.find((x) => x.code === z.dataset.zoom); if (c) openViewer({ cards: [c], index: 0, mode: 'admin' }); } }); }
const keep = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } };
const restore = (k) => { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch { return null; } };

// ---------- «Что их связывает?» ----------
const MORE = () => [tt('Найди связь между этими картами.', 'Find a connection between these cards.'), tt('А что ещё их связывает?', 'What else connects them?'), tt('Попробуй найти связь, которая не видна сразу.', 'Try to find a connection that is not obvious at first.'), tt('Что объединяет их по настроению?', 'What do they share in mood?'), tt('Какая история могла бы связать эти две карты?', 'What story could connect these two cards?')];
export async function connect(ctx) {
  loading(ctx.main);
  let cards; try { cards = await loadCards(ctx); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  if (cards.length < 2) { ctx.main.innerHTML = frame(G('connect'), `<p class="empty">${esc(tt('Для игры нужно хотя бы две карты.', 'The game needs at least two cards.'))}</p>`); return; }
  const by = (c) => cards.find((x) => x.code === c);
  let st = restore('dc_solo_connect');
  if (!st || !by(st.a) || !by(st.b)) { const a = pickOther(cards, []); st = { a: a.code, b: pickOther(cards, [a.code]).code, n: 0 }; }
  const draw = (changed) => {
    keep('dc_solo_connect', st);
    const A = by(st.a); const B = by(st.b);
    ctx.main.innerHTML = frame(G('connect'), `
      <div class="pair-cards">
        <figure class="${changed === 'a' ? 'changed' : ''}">${cardImg(A)}<figcaption><button class="btn sm light" type="button" data-swap="a" aria-label="${esc(tt('Заменить левую карту', 'Replace the left card'))}">${esc(tt('Заменить эту', 'Replace this one'))}</button></figcaption></figure>
        <figure class="${changed === 'b' ? 'changed' : ''}">${cardImg(B)}<figcaption><button class="btn sm light" type="button" data-swap="b" aria-label="${esc(tt('Заменить правую карту', 'Replace the right card'))}">${esc(tt('Заменить эту', 'Replace this one'))}</button></figcaption></figure>
      </div>
      <p class="lead" aria-live="polite" style="margin:0">${esc(MORE()[st.n % MORE().length])}</p>
      <p class="vb-note" style="margin:0">${esc(tt('Отвечай про себя. Понравилась одна карта — оставь её и замени вторую.', 'Answer to yourself. Like one card? Keep it and replace the other.'))}</p>
      <div class="row"><button class="btn yellow" type="button" data-more>${esc(tt('А что ещё?', 'What else?'))}</button></div>`);
  };
  ctx.main.addEventListener('click', (e) => {
    const sw = e.target.closest('[data-swap]');
    if (sw) { const k = sw.dataset.swap; st[k] = pickOther(cards, [st.a, st.b]).code; st.n = 0; draw(k); ctx.main.querySelector(`[data-swap="${k}"]`).focus(); return; }
    if (e.target.closest('[data-more]')) { st.n += 1; draw(); ctx.main.querySelector('[data-more]').focus(); }
  });
  zoomer(ctx, cards); draw();
}

// ---------- «Глаз-алмаз» ----------
// Вопросы подходят к любой иллюстрации без разметки: о краях, цветах, свете, размерах — не о конкретных предметах.
const EAGLE = () => [
  tt('Что находилось ближе всего к левому краю?', 'What was closest to the left edge?'),
  tt('Какого цвета была самая маленькая деталь, которую ты запомнил?', 'What colour was the smallest detail you remember?'),
  tt('Какой цвет на карте был самым ярким?', 'What was the brightest colour on the card?'),
  tt('Что было в правом нижнем углу?', 'What was in the bottom right corner?'),
  tt('Где на карте было самое светлое место?', 'Where was the lightest spot on the card?'),
  tt('Что находилось в самом центре карты?', 'What was right in the centre of the card?'),
  tt('Что было у верхнего края?', 'What was at the top edge?'),
  tt('Какая деталь была самой крупной?', 'What was the largest detail?'),
  tt('Сколько разных цветов ты можешь вспомнить?', 'How many different colours can you recall?'),
  tt('Что было в левом верхнем углу?', 'What was in the top left corner?'),
];
export async function eagle(ctx) {
  loading(ctx.main);
  let cards; try { cards = await loadCards(ctx); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  let st = restore('dc_solo_eagle');
  const by = (c) => cards.find((x) => x.code === c);
  if (!st || !by(st.code)) st = { code: pickOther(cards, []).code, phase: 'look', q: Math.floor(Math.random() * EAGLE().length), seen: [] };
  const draw = () => {
    keep('dc_solo_eagle', st);
    const c = by(st.code); const q = EAGLE()[st.q % EAGLE().length];
    let inner;
    if (st.phase === 'look') inner = `<p class="vb-note" style="margin:0">${esc(tt('Рассматривай карту столько, сколько хочешь. Когда будешь готов — нажми «Запомнил».', 'Look at the card as long as you like. When ready, press “Got it”.'))}</p>${cardImg(c)}<div class="row"><button class="btn yellow" type="button" data-remember>${esc(tt('Запомнил', 'Got it'))}</button></div>`;
    else if (st.phase === 'ask') inner = `<div class="eagle-hidden" role="img" aria-label="${esc(tt('Карта скрыта', 'The card is hidden'))}">${ic.lock || ''}<span>${esc(tt('Карта скрыта', 'The card is hidden'))}</span></div>
      <p class="lead" style="margin:0" aria-live="polite"><b>${esc(q)}</b></p><p class="vb-note" style="margin:0">${esc(tt('Ответь про себя — потом сверься с картой.', 'Answer to yourself — then check against the card.'))}</p>
      <div class="row"><button class="btn yellow" type="button" data-check>${esc(tt('Проверить', 'Check'))}</button></div>`;
    else inner = `<p class="lead" style="margin:0"><b>${esc(q)}</b></p>${cardImg(c)}
      <div class="row"><button class="btn yellow" type="button" data-next>${esc(tt('Другая карта', 'Another card'))}</button></div>`;
    ctx.main.innerHTML = frame(G('eagle'), inner);
  };
  ctx.main.addEventListener('click', (e) => {
    if (e.target.closest('[data-remember]')) { st.phase = 'ask'; draw(); ctx.main.querySelector('[data-check]').focus(); }
    else if (e.target.closest('[data-check]')) { st.phase = 'check'; draw(); ctx.main.querySelector('[data-next]').focus(); }
    else if (e.target.closest('[data-next]')) { st.seen = [...st.seen, st.code].slice(-20); st.code = pickOther(cards, st.seen).code; st.q = (st.q + 1 + Math.floor(Math.random() * 3)) % EAGLE().length; st.phase = 'look'; draw(); window.scrollTo(0, 0); }
  });
  zoomer(ctx, cards); draw();
}

// ---------- «Придумай ассоциации» ----------
// Две ветки ассоциаций от двух деталей, которые игрок сам заметил; затем пара — по одному слову из каждой ветки —
// и вопрос, как они могли бы встретиться на одной картинке. Всё хранится только в этой вкладке.
let nid = 1;
const node = (word, parent = null) => ({ id: `n${Date.now().toString(36)}${nid++}`, word, parent });
// «Придумай ассоциации» (21.11.2026): четыре шага на одном экране, у каждого заголовок рядом со своим действием.
// Карту листают стрелками и свайпом в порядке галереи. Пример — свёрнутый, со своей миниатюрой, поля игрока не заполняет.
const EXAMPLE_CODE = 'DC-0038'; // море и облачный корабль
export async function imagine(ctx) {
  loading(ctx.main);
  let cards; try { cards = await loadCards(ctx); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  if (!cards.length) { ctx.main.innerHTML = frame(G('imagine'), `<p class="empty">${esc(tt('В галерее пока нет карт.', 'No cards yet.'))}</p>`); return; }
  const blank = (code) => ({ v: 2, code, roots: ['', ''], assoc: [[], []], pair: [null, null], hold: [false, false], note: '', ex: false });
  let st = restore('dc_solo_imagine');
  if (!st || st.v !== 2 || !cards.some((c) => c.code === st.code)) st = blank(cards[0].code);
  const ex = cards.find((c) => c.code === EXAMPLE_CODE);
  const idx = () => Math.max(0, cards.findIndex((c) => c.code === st.code));
  const save = () => keep('dc_solo_imagine', st);
  const chipsOf = (i) => st.assoc[i].map((w, k) => `<span class="assoc-chip">${esc(w)}<button type="button" data-rm="${i}:${k}" aria-label="${esc(tt(`Убрать «${w}»`, `Remove “${w}”`))}">×</button></span>`).join('');
  const groupHtml = (i) => st.roots[i].trim() ? `<div class="assoc-group" data-g="${i}"><b>${esc(st.roots[i].trim())}</b><div class="assoc-chips" id="ac-${i}">${chipsOf(i)}</div>
      <form class="assoc-add" data-addto="${i}"><label class="sr-only" for="as-${i}">${esc(tt(`Ассоциации к детали «${st.roots[i].trim()}»`, `Associations for “${st.roots[i].trim()}”`))}</label><input id="as-${i}" maxlength="60" placeholder="${esc(tt('Что приходит в голову?', 'What comes to mind?'))}" autocomplete="off"><button class="btn sm" type="submit">${esc(tt('Добавить', 'Add'))}</button></form></div>` : '';
  const pairHtml = () => {
    const ready = st.assoc[0].length && st.assoc[1].length;
    if (!ready) return `<p class="vb-note" style="margin:0">${esc(tt('Сначала добавь хотя бы по одной ассоциации к каждой детали.', 'First add at least one association to each detail.'))}</p>`;
    const w = [0, 1].map((i) => (st.pair[i] != null ? st.assoc[i][st.pair[i]] : null));
    return `${[0, 1].map((i) => `<fieldset class="pair-pick"><legend>${esc(st.roots[i].trim())}</legend><div class="pc-row">${st.assoc[i].map((x, k) => `<button type="button" class="chip ${st.pair[i] === k ? 'on' : ''}" data-pick="${i}:${k}" aria-pressed="${st.pair[i] === k}">${esc(x)}</button>`).join('')}</div>
        ${st.pair[i] != null ? `<label class="check small"><input type="checkbox" data-hold="${i}" ${st.hold[i] ? 'checked' : ''}> <span>${esc(tt('Оставить это слово', 'Keep this word'))}</span></label>` : ''}</fieldset>`).join('')}
      <div class="row"><button class="btn light" type="button" data-random>${esc(tt('Случайная пара', 'Random pair'))}</button></div>
      ${w[0] && w[1] ? `<div class="imag-pair" aria-live="polite"><span>${esc(w[0])}</span><b>+</b><span>${esc(w[1])}</span></div>
        <label class="sr-only" for="imn">${esc(tt('Мой образ', 'My image'))}</label><textarea id="imn" rows="2" maxlength="300" placeholder="${esc(tt('Какой образ получается?', 'What image do you get?'))}">${esc(st.note)}</textarea>` : ''}`;
  };
  const draw = (focus) => {
    save();
    const c = cards[idx()];
    ctx.main.innerHTML = frame(G('imagine'), `
      <section class="imag-step"><h2><span class="n">1</span>${esc(tt('Выбери карту', 'Choose a card'))}</h2>
        <div class="imag-carousel"><button class="icon-btn" type="button" data-step="-1" aria-label="${esc(tt('Предыдущая карта', 'Previous card'))}">${ic.chevronLeft || '‹'}</button>
          <div class="imag-card" id="imcard">${cardImg(c, 'live-card sm-card')}</div>
          <button class="icon-btn" type="button" data-step="1" aria-label="${esc(tt('Следующая карта', 'Next card'))}">${ic.chevronRight || '›'}</button></div>
        <p class="small muted" style="margin:0;text-align:center">${idx() + 1} / ${cards.length}</p></section>
      <section class="imag-step"><h2><span class="n">2</span>${esc(tt('Найди на карте две детали', 'Find two details on the card'))}</h2>
        <div class="row"><label class="field small" style="flex:1">${esc(tt('Первая деталь', 'First detail'))}<input data-root="0" maxlength="30" value="${esc(st.roots[0])}" autocomplete="off"></label>
          <label class="field small" style="flex:1">${esc(tt('Вторая деталь', 'Second detail'))}<input data-root="1" maxlength="30" value="${esc(st.roots[1])}" autocomplete="off"></label></div></section>
      <section class="imag-step"><h2><span class="n">3</span>${esc(tt('Придумай ассоциации', 'Find associations'))}</h2>
        <div class="assoc-groups" id="groups">${groupHtml(0)}${groupHtml(1)}${!st.roots[0].trim() && !st.roots[1].trim() ? `<p class="vb-note" style="margin:0">${esc(tt('Здесь появятся детали, которые ты назовёшь.', 'The details you name will appear here.'))}</p>` : ''}</div></section>
      <section class="imag-step"><h2><span class="n">4</span>${esc(tt('Представь новый образ', 'Imagine a new image'))}</h2>
        <p style="margin:0">${esc(tt('Возьми по одной ассоциации из каждого списка и соедини их. Какой образ получается?', 'Take one association from each list and combine them. What image do you get?'))}</p>
        <div id="pairs" class="stack" style="gap:10px">${pairHtml()}</div></section>
      <details class="imag-example" ${st.ex ? 'open' : ''}><summary>${esc(tt('Показать пример', 'Show an example'))}</summary>
        <div class="imag-ex-body">${ex ? `<img src="${esc(ex.thumb)}" alt="${esc(tt('Пример: карта с морем и облачным кораблём', 'Example: a card with the sea and a cloud ship'))}" width="90">` : ''}
          <div><p><b>${esc(tt('море', 'sea'))}</b> → ${esc(tt('глубина, свобода', 'depth, freedom'))}</p><p><b>${esc(tt('облачный корабль', 'cloud ship'))}</b> → ${esc(tt('парус, путешествие', 'sail, journey'))}</p>
          <p>«${esc(tt('глубина', 'depth'))}» + «${esc(tt('парус', 'sail'))}» → ${esc(tt('корабль под водой с парусами из света', 'a ship under water with sails of light'))}</p></div></div></details>
      <div class="row"><button class="link-btn" type="button" data-restart>${esc(tt('Начать заново', 'Start over'))}</button></div>`);
    wireSwipe();
    const f = focus && ctx.main.querySelector(focus); if (f) { f.focus(); if (f.setSelectionRange && f.value) f.setSelectionRange(f.value.length, f.value.length); }
  };
  const go = (d) => { const n = cards.length; st.code = cards[(idx() + d + n) % n].code; draw(); };
  // свайп по иллюстрации листает карты (короткий тап — рассмотреть)
  function wireSwipe() {
    const el = ctx.main.querySelector('#imcard'); if (!el) return; let x0 = null; let y0 = 0;
    el.addEventListener('pointerdown', (e) => { x0 = e.clientX; y0 = e.clientY; });
    el.addEventListener('pointerup', (e) => { if (x0 == null) return; const dx = e.clientX - x0; const dy = e.clientY - y0; x0 = null; if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3) { el.dataset.swiped = '1'; go(dx < 0 ? 1 : -1); } });
    el.addEventListener('click', (e) => { if (el.dataset.swiped) { e.stopPropagation(); e.preventDefault(); delete el.dataset.swiped; } }, true);
    el.style.touchAction = 'pan-y';
  }
  const refresh = (part) => { // перерисовать только шаги 3–4, не теряя фокус в полях деталей
    if (part !== 'pairs') ctx.main.querySelector('#groups').innerHTML = `${groupHtml(0)}${groupHtml(1)}${!st.roots[0].trim() && !st.roots[1].trim() ? `<p class="vb-note" style="margin:0">${esc(tt('Здесь появятся детали, которые ты назовёшь.', 'The details you name will appear here.'))}</p>` : ''}`;
    ctx.main.querySelector('#pairs').innerHTML = pairHtml(); save();
  };
  ctx.main.addEventListener('submit', (e) => {
    const add = e.target.closest('[data-addto]'); if (!add) return; e.preventDefault();
    const i = Number(add.dataset.addto); const inp = add.querySelector('input');
    const words = inp.value.split(/[,;]/).map((w) => w.trim()).filter(Boolean); if (!words.length) return;
    for (const w of words) if (!st.assoc[i].includes(w) && st.assoc[i].length < 30) st.assoc[i].push(w);
    refresh(); const n = ctx.main.querySelector(`#as-${i}`); if (n) n.focus(); // можно сразу добавить ещё
  });
  ctx.main.addEventListener('input', (e) => {
    const r = e.target.closest('[data-root]');
    if (r) { const i = Number(r.dataset.root); const had = !!st.roots[i].trim(); st.roots[i] = r.value; if (had !== !!r.value.trim()) { if (!r.value.trim()) { st.assoc[i] = []; st.pair[i] = null; } refresh(); } else { const b = ctx.main.querySelector(`.assoc-group[data-g="${i}"] > b`); if (b) b.textContent = r.value.trim(); save(); } return; }
    if (e.target.id === 'imn') { st.note = e.target.value; save(); }
  });
  ctx.main.addEventListener('change', (e) => { const h = e.target.closest('[data-hold]'); if (h) { st.hold[Number(h.dataset.hold)] = h.checked; save(); } });
  ctx.main.addEventListener('toggle', (e) => { if (e.target.classList && e.target.classList.contains('imag-example')) { st.ex = e.target.open; save(); } }, true);
  ctx.main.addEventListener('click', (e) => {
    const sb = e.target.closest('[data-step]'); if (sb) { go(Number(sb.dataset.step)); return; }
    const rm = e.target.closest('[data-rm]'); if (rm) { const [i, k] = rm.dataset.rm.split(':').map(Number); st.assoc[i].splice(k, 1); if (st.pair[i] === k) st.pair[i] = null; else if (st.pair[i] > k) st.pair[i]--; refresh(); return; }
    const pk = e.target.closest('[data-pick]'); if (pk) { const [i, k] = pk.dataset.pick.split(':').map(Number); st.pair[i] = k; st.note = ''; refresh('pairs'); return; }
    if (e.target.closest('[data-random]')) {
      // случайная пара — по одной ассоциации из двух списков; удержанное слово остаётся
      for (const i of [0, 1]) {
        if (st.hold[i] && st.pair[i] != null) continue;
        const n = st.assoc[i].length; if (!n) continue;
        const pool = [...Array(n).keys()].filter((k) => n === 1 || k !== st.pair[i]);
        st.pair[i] = pool[Math.floor(Math.random() * pool.length)];
      }
      st.note = ''; refresh('pairs'); return;
    }
    if (e.target.closest('[data-restart]')) { st = blank(st.code); draw(); window.scrollTo(0, 0); }
  });
  zoomer(ctx, cards); draw();
}
