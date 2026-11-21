// «Играть одному» (19.11.2026): четыре игры для одного человека, без регистрации. Карты — из галереи (случайная выдача).
// Выборы, замены и раскрытия карт здесь не увеличивают «Выбрали для разговора»: на сервер ничего не отправляется.
// Очков, таймеров, рейтингов и автоматической оценки ответов нет — игрок отвечает про себя.
import { lang } from '../i18n.js';
import { esc, tt, u, api } from '../util.js';
import { ic, loading, failed, session } from '../ui.js';
import { openViewer } from '../viewer.js';
import { EAGLE_BANK } from '../content.js';
import * as personal from '../personal.js';

export const SOLO_GAMES = [
  { key: 'story', path: '/group/solo/story', ru: 'История из трёх карт', en: 'A story from three cards', dru: 'Три карты по очереди: первая начинает историю, вторая меняет её ход, третья помогает закончить.', den: 'Three cards in turn: the first starts a story, the second changes its course, the third helps end it.' },
  { key: 'connect', path: '/group/solo/connect', ru: 'Что их связывает?', en: 'What connects them?', dru: 'Две карты рядом. Найди между ними связь — а потом ещё одну.', den: 'Two cards side by side. Find a connection between them — and then another one.' },
  { key: 'eagle', path: '/group/solo/eagle', ru: 'Глаз-алмаз', en: 'Eagle Eye', dru: 'Рассмотри карту. Когда она скроется, ответь на вопрос и проверь свою наблюдательность.', den: 'Look at the card. When it disappears, answer the question and test how observant you are.' },
  { key: 'imagine', path: '/group/solo/imagine', ru: 'Придумай ассоциации', en: 'Find associations', dru: 'Найди на карте две детали, придумай к ним ассоциации и соедини по одной в новый образ.', den: 'Find two details on the card, come up with associations and combine one from each into a new image.' },
];
const G = (k) => SOLO_GAMES.find((g) => g.key === k);
const T = (g) => (lang === 'en' ? g.en : g.ru);
const D = (g) => (lang === 'en' ? g.den : g.dru);

/** Раздел «Играть одному»: список из четырёх игр. */
export function hub(ctx) {
  ctx.main.innerHTML = `<div class="wrap page narrow stack">
    <div class="page-head"><p class="eyebrow">Dialogue Cards</p><h1>${esc(tt('Играть одному', 'Play solo'))}</h1>
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
function zoomer(ctx, cards) { ctx.main.addEventListener('click', (e) => { const z = e.target.closest('[data-zoom]'); if (z) { const c = cards.find((x) => x.code === z.dataset.zoom); if (c) openViewer({ cards: [c], index: 0, mode: 'admin', simple: true }); } }); }
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
      <p class="vb-note" style="margin:0">${esc(tt('Понравилась одна карта — оставь её и замени вторую.', 'Like one card? Keep it and replace the other.'))}</p>
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
// Вопросы (21.11.2026). Основной источник — банк проверенных вопросов к конкретным картам (EAGLE_BANK в content.js):
// когда в нём есть записи, в игре выпадают только эти карты, а вопрос берётся из набора показанной карты, с ответом.
// Пока банк пуст, используются общие вопросы о цвете, свете и размере — без вопросов про углы и края,
// которые на многих картах пустые. Содержание вопросов по картам не сочиняем: банк наполняют авторы.
const EAGLE = () => [
  tt('Какого цвета была самая маленькая деталь, которую ты запомнил?', 'What colour was the smallest detail you remember?'),
  tt('Какой цвет на карте был самым ярким?', 'What was the brightest colour on the card?'),
  tt('Где на карте было самое светлое место?', 'Where was the lightest spot on the card?'),
  tt('Какая деталь была самой крупной?', 'What was the largest detail?'),
  tt('Сколько разных цветов ты можешь вспомнить?', 'How many different colours can you recall?'),
];
export async function eagle(ctx) {
  loading(ctx.main);
  let cards; try { cards = await loadCards(ctx); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  // с банком — только карты с проверенными вопросами
  const banked = cards.filter((c) => Array.isArray(EAGLE_BANK[c.code]) && EAGLE_BANK[c.code].length);
  if (banked.length) cards = banked;
  const qsOf = (code) => (banked.length ? EAGLE_BANK[code].map((x) => ({ q: lang === 'en' ? x.q.en : x.q.ru, a: lang === 'en' ? x.a.en : x.a.ru })) : EAGLE().map((q) => ({ q, a: '' })));
  let st = restore('dc_solo_eagle');
  const by = (c) => cards.find((x) => x.code === c);
  if (!st || !by(st.code)) st = { code: pickOther(cards, []).code, phase: 'look', q: Math.floor(Math.random() * 50), seen: [] };
  const draw = () => {
    keep('dc_solo_eagle', st);
    const c = by(st.code); const set = qsOf(st.code); const item = set[st.q % set.length]; const q = item.q;
    let inner;
    if (st.phase === 'look') inner = `<p class="lead" style="margin:0">${esc(tt('Рассмотри карту. Когда она скроется, ответь на вопрос и проверь свою наблюдательность.', 'Look at the card. When it disappears, answer the question and test how observant you are.'))}</p>${cardImg(c)}<div class="row"><button class="btn yellow" type="button" data-remember>${esc(tt('Запомнил', 'Got it'))}</button></div>`;
    else if (st.phase === 'ask') inner = `<div class="eagle-hidden" role="img" aria-label="${esc(tt('Карта скрыта', 'The card is hidden'))}">${ic.lock || ''}<span>${esc(tt('Карта скрыта', 'The card is hidden'))}</span></div>
      <p class="lead" style="margin:0" aria-live="polite"><b>${esc(q)}</b></p><p class="vb-note" style="margin:0">${esc(tt('Ответь про себя — потом сверься с картой.', 'Answer to yourself — then check against the card.'))}</p>
      <div class="row"><button class="btn yellow" type="button" data-check>${esc(tt('Проверить', 'Check'))}</button></div>`;
    else inner = `<p class="lead" style="margin:0"><b>${esc(q)}</b></p>${item.a ? `<p class="eagle-answer">${esc(tt('Ответ', 'Answer'))}: ${esc(item.a)}</p>` : ''}${cardImg(c)}
      <div class="row"><button class="btn yellow" type="button" data-next>${esc(tt('Другая карта', 'Another card'))}</button></div>`;
    ctx.main.innerHTML = frame(G('eagle'), inner);
  };
  ctx.main.addEventListener('click', (e) => {
    if (e.target.closest('[data-remember]')) { st.phase = 'ask'; draw(); ctx.main.querySelector('[data-check]').focus(); }
    else if (e.target.closest('[data-check]')) { st.phase = 'check'; draw(); ctx.main.querySelector('[data-next]').focus(); }
    else if (e.target.closest('[data-next]')) { st.seen = [...st.seen, st.code].slice(-20); st.code = pickOther(cards, st.seen).code; st.q = Math.floor(Math.random() * 50); st.phase = 'look'; draw(); window.scrollTo(0, 0); }
  });
  zoomer(ctx, cards); draw();
}

// ---------- «Придумай ассоциации» ----------
// Две ветки ассоциаций от двух деталей, которые игрок сам заметил; затем пара — по одному слову из каждой ветки —
// и вопрос, как они могли бы встретиться на одной картинке. Всё хранится только в этой вкладке.
let nid = 1;
const node = (word, parent = null) => ({ id: `n${Date.now().toString(36)}${nid++}`, word, parent });
// «Придумай ассоциации» (21.11.2026; 22.11.2026 — две ветки рядом, выбор пары, «Сохранить образ»).
// Шаги: карта (стрелки и свайп по порядку галереи) → две детали → ветки ассоциаций (тап по любому слову добавляет к нему) →
// пара (по одному слову из каждой ветки, вручную или случайно) → новый образ (по желанию — записать и сохранить в «Мои образы»).
// Пример — свёрнутый, со своей миниатюрой, поля игрока не заполняет.
const EXAMPLE_CODE = 'DC-0038'; // море и облачный корабль
export async function imagine(ctx) {
  loading(ctx.main);
  let cards; try { cards = await loadCards(ctx); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  if (!cards.length) { ctx.main.innerHTML = frame(G('imagine'), `<p class="empty">${esc(tt('В галерее пока нет карт.', 'No cards yet.'))}</p>`); return; }
  const blank = (code) => ({ v: 3, code, roots: ['', ''], nodes: [], adding: null, pair: [null, null], stage: 'build', note: '', saved: '', ex: false });
  let st = restore('dc_solo_imagine');
  if (!st || st.v !== 3 || !cards.some((c) => c.code === st.code)) st = blank(cards[0].code);
  const ex = cards.find((c) => c.code === EXAMPLE_CODE);
  const idx = () => Math.max(0, cards.findIndex((c) => c.code === st.code));
  const save = () => keep('dc_solo_imagine', st);
  let seq = st.nodes.reduce((m, n) => Math.max(m, Number(String(n.id).slice(1)) || 0), 0);
  const nid = () => `n${++seq}`;
  const rootOf = (i) => st.nodes.find((n) => n.parent === null && n.branch === i);
  const words = (i) => st.nodes.filter((n) => n.branch === i && n.parent !== null);
  const ready = () => words(0).length > 0 && words(1).length > 0;
  // ветка: исходное слово — крупно, ассоциации — ниже, тонкие линии ветвления; тап по слову — поле добавления под ним
  // поле добавления — на всю ширину под ветками (в узкой колонке не видно вводимого текста); без длинного placeholder
  const addForm = (n) => `<form class="assoc-add wide" data-addto="${n.id}"><label class="assoc-add-l" for="as-${n.id}">${esc(tt(`Ассоциация к слову «${n.word}»`, `Association for “${n.word}”`))}</label><div class="row"><input id="as-${n.id}" maxlength="40" autocomplete="off"><button class="btn sm" type="submit" aria-label="${esc(tt('Добавить', 'Add'))}">+</button></div></form>`;
  const sub = (id) => { const kids = st.nodes.filter((n) => n.parent === id); return kids.length ? `<ul>${kids.map((n) => `<li><button type="button" class="assoc-w ${st.adding === n.id ? 'on' : ''}" data-node="${n.id}">${esc(n.word)}</button>${sub(n.id)}</li>`).join('')}</ul>` : ''; };
  const branchHtml = (i) => { const r = rootOf(i); if (!r) return ''; return `<div class="branch"><button type="button" class="assoc-root ${st.adding === r.id ? 'on' : ''}" data-node="${r.id}">${esc(r.word)}</button>${sub(r.id)}</div>`; };
  const pairCol = (i) => { const r = rootOf(i); return `<div class="branch pick"><span class="assoc-root static">${esc(r ? r.word : '')}</span><div class="pick-words">${words(i).map((n) => `<button type="button" class="chip ${st.pair[i] === n.id ? 'on' : ''}" data-pick="${i}:${n.id}" aria-pressed="${st.pair[i] === n.id}">${esc(n.word)}</button>`).join('')}</div></div>`; };
  const wordOf = (id) => (st.nodes.find((n) => n.id === id) || {}).word || '';
  // пример к шагу — своя свёрнутая строка; маленькое превью показывает, что пример относится к другой карте
  const exThumb = () => (ex ? `<img class="ex-thumb" src="${esc(ex.thumb)}" alt="${esc(tt('Карта для примера: корабль и море', 'Example card: a ship and the sea'))}" width="52">` : '');
  const example = (n, body) => `<details class="imag-ex" ${(st.exOpen || {})[n] ? 'open' : ''} data-ex="${n}"><summary>${esc(tt('Показать пример', 'Show an example'))}</summary><div class="imag-ex-in">${exThumb()}<div>${body}</div></div></details>`;
  const exBranches = () => `<div class="branches ex"><div class="branch"><span class="assoc-root static">${esc(tt('море', 'sea'))}</span><ul><li><span class="assoc-w">${esc(tt('глубина', 'depth'))}</span></li><li><span class="assoc-w">${esc(tt('свобода', 'freedom'))}</span></li></ul></div><div class="branch"><span class="assoc-root static">${esc(tt('корабль', 'ship'))}</span><ul><li><span class="assoc-w">${esc(tt('путешествие', 'journey'))}</span></li><li><span class="assoc-w">${esc(tt('парус', 'sail'))}</span></li></ul></div></div>`;
  const activeNode = () => st.nodes.find((n) => n.id === st.adding);
  const draw = (focus) => {
    save();
    const c = cards[idx()];
    const hasRoots = st.nodes.length > 0;
    let tail = '';
    if (hasRoots) {
      tail += `<section class="imag-step"><h2><span class="n">3</span>${esc(tt('Придумай ассоциации', 'Find associations'))}</h2>
        <p style="margin:0">${esc(tt('Нажми на любое слово и добавь к нему ассоциацию, которая приходит в голову', 'Tap any word and add an association that comes to mind'))}</p>
        <div class="branches">${branchHtml(0)}${branchHtml(1)}</div>
        ${activeNode() ? addForm(activeNode()) : ''}
        ${example(3, `<p>${esc(tt('Море → глубина, свобода', 'Sea → depth, freedom'))}</p><p>${esc(tt('Корабль → путешествие, парус', 'Ship → journey, sail'))}</p>`)}
        ${ready() ? '' : `<p class="vb-note" style="margin:0">${esc(tt('Добавь хотя бы по одной ассоциации в каждую ветку', 'Add at least one association to each branch'))}</p>`}</section>`;
      if (ready()) {
        tail += `<section class="imag-step" id="pairstep"><h2><span class="n">4</span>${esc(tt('Выбери пару', 'Choose a pair'))}</h2>
          <p style="margin:0">${esc(tt('Выбери по одному слову из каждой ветки', 'Choose one word from each branch'))}</p>
          <div class="branches">${pairCol(0)}${pairCol(1)}</div>
          <div class="row"><button class="btn light" type="button" data-random>${esc(tt('Случайная пара', 'Random pair'))}</button></div>
          ${example(4, `${exBranches()}<p>${esc(tt('Выбор: глубина + парус', 'Choice: depth + sail'))}</p>`)}
          ${st.stage === 'build' ? `<div class="row"><button class="btn yellow" type="button" data-toimg ${st.pair[0] && st.pair[1] ? '' : 'disabled'}>${esc(tt('Дальше', 'Next'))}</button></div>` : ''}</section>`;
      }
      if (st.stage === 'image' && st.pair[0] && st.pair[1]) {
        tail += `<section class="imag-step" id="imgstep"><h2><span class="n">5</span>${esc(tt('Представь новый образ', 'Imagine a new image'))}</h2>
          <div class="imag-pair"><span>${esc(wordOf(st.pair[0]))}</span><b>+</b><span>${esc(wordOf(st.pair[1]))}</span></div>
          <p style="margin:0">${esc(tt('Как бы эти два слова встретились на одной картинке?', 'How would these two words meet in one picture?'))}</p>
          <label class="sr-only" for="imn">${esc(tt('Мой образ', 'My image'))}</label><textarea id="imn" rows="2" maxlength="300">${esc(st.note)}</textarea>
          ${example(5, `<p>${esc(tt('Глубина + парус → корабль под водой с парусами из света', 'Depth + sail → a ship under water with sails of light'))}</p>`)}
          <div class="row"><button class="btn yellow" type="button" data-saveimg ${st.note.trim() ? '' : 'disabled'}>${esc(tt('Сохранить образ', 'Save the image'))}</button>
            <span class="imag-saved" role="status">${st.saved && st.saved === st.note.trim() ? `${esc(tt('Образ сохранён', 'Image saved'))} · <a href="${u('/me/images')}">${esc(tt('Мои образы', 'My images'))}</a>` : ''}</span></div>
          <div class="row"><button class="btn light" type="button" data-otherpair>${esc(tt('Другая пара', 'Another pair'))}</button><button class="btn light" type="button" data-restart>${esc(tt('Новая карта', 'New card'))}</button></div></section>`;
      }
    }
    ctx.main.innerHTML = frame(G('imagine'), `
      <section class="imag-step"><h2><span class="n">1</span>${esc(tt('Выбери карту', 'Choose a card'))}</h2>
        <div class="imag-carousel"><button class="icon-btn" type="button" data-step="-1" aria-label="${esc(tt('Предыдущая карта', 'Previous card'))}">${ic.chevronLeft}</button>
          <div class="imag-card" id="imcard">${cardImg(c, 'live-card sm-card')}</div>
          <button class="icon-btn" type="button" data-step="1" aria-label="${esc(tt('Следующая карта', 'Next card'))}">${ic.chevronRight}</button></div>
        <p class="small muted" style="margin:0;text-align:center">${idx() + 1} / ${cards.length}</p></section>
      <section class="imag-step"><h2><span class="n">2</span>${esc(tt('Найди на карте две детали', 'Find two details on the card'))}</h2>
        <form class="stack" id="roots" style="gap:8px"><div class="row"><label class="field small" style="flex:1">${esc(tt('Первая деталь', 'First detail'))}<input name="r0" maxlength="30" value="${esc(st.roots[0])}" autocomplete="off"></label>
          <label class="field small" style="flex:1">${esc(tt('Вторая деталь', 'Second detail'))}<input name="r1" maxlength="30" value="${esc(st.roots[1])}" autocomplete="off"></label></div>
          ${example(2, `<p>${esc(tt('Первая деталь — корабль. Вторая деталь — море.', 'First detail — the ship. Second detail — the sea.'))}</p>`)}
          ${hasRoots ? '' : `<div><button class="btn yellow" type="submit">${esc(tt('Дальше', 'Next'))}</button></div>`}</form></section>
      ${tail}`);
    wireSwipe();
    const f = focus && ctx.main.querySelector(focus); if (f) { f.focus({ preventScroll: false }); }
  };
  const go = (d) => { const n = cards.length; st.code = cards[(idx() + d + n) % n].code; draw(); };
  function wireSwipe() {
    const el = ctx.main.querySelector('#imcard'); if (!el) return; let x0 = null; let y0 = 0;
    el.addEventListener('pointerdown', (e) => { x0 = e.clientX; y0 = e.clientY; });
    el.addEventListener('pointerup', (e) => { if (x0 == null) return; const dx = e.clientX - x0; const dy = e.clientY - y0; x0 = null; if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3) { el.dataset.swiped = '1'; go(dx < 0 ? 1 : -1); } });
    el.addEventListener('click', (e) => { if (el.dataset.swiped) { e.stopPropagation(); e.preventDefault(); delete el.dataset.swiped; } }, true);
  }
  // детали: «Дальше» создаёт две ветки; изменение детали потом — переименовывает исходное слово ветки
  ctx.main.addEventListener('input', (e) => {
    const r = e.target.closest('#roots input');
    if (r) { const i = r.name === 'r0' ? 0 : 1; st.roots[i] = r.value; const root = rootOf(i); if (root && r.value.trim()) { root.word = r.value.trim(); const b = ctx.main.querySelector(`[data-node="${root.id}"]`); if (b) b.textContent = root.word; } save(); return; }
    if (e.target.id === 'imn') { st.note = e.target.value; const b = ctx.main.querySelector('[data-saveimg]'); if (b) b.disabled = !st.note.trim(); const s = ctx.main.querySelector('.imag-saved'); if (s && st.saved !== st.note.trim()) s.textContent = ''; save(); }
  });
  ctx.main.addEventListener('submit', (e) => {
    e.preventDefault();
    if (e.target.id === 'roots') {
      const r0 = e.target.r0.value.trim(); const r1 = e.target.r1.value.trim();
      if (!r0 || !r1) { (r0 ? e.target.r1 : e.target.r0).focus(); return; }
      st.roots = [r0, r1]; const a = { id: nid(), word: r0, parent: null, branch: 0 }; const b = { id: nid(), word: r1, parent: null, branch: 1 };
      st.nodes = [a, b]; st.adding = a.id; st.pair = [null, null]; st.stage = 'build'; draw(`#as-${a.id}`); return;
    }
    const add = e.target.closest('[data-addto]'); if (!add) return;
    const inp = add.querySelector('input'); const list = inp.value.split(/[,;]/).map((w) => w.trim()).filter(Boolean); if (!list.length) return;
    const parent = st.nodes.find((n) => n.id === add.dataset.addto); if (!parent) return;
    for (const w of list) if (st.nodes.length < 80) st.nodes.push({ id: nid(), word: w, parent: parent.id, branch: parent.branch });
    draw(`#as-${parent.id}`); // можно сразу добавить ещё к тому же слову
  });
  ctx.main.addEventListener('toggle', (e) => { const d = e.target.closest && e.target.closest('[data-ex]'); if (d && e.target === d) { st.exOpen = { ...(st.exOpen || {}), [d.dataset.ex]: d.open }; save(); } }, true);
  ctx.main.addEventListener('click', async (e) => {
    const sb = e.target.closest('[data-step]'); if (sb) { go(Number(sb.dataset.step)); return; }
    const nb = e.target.closest('[data-node]'); if (nb) { st.adding = st.adding === nb.dataset.node ? null : nb.dataset.node; draw(st.adding ? `#as-${st.adding}` : null); return; }
    const pk = e.target.closest('[data-pick]'); if (pk) { const [i, id] = pk.dataset.pick.split(':'); st.pair[Number(i)] = id; if (st.stage === 'image') { st.note = ''; st.saved = ''; } draw(); return; }
    if (e.target.closest('[data-random]')) {
      // по одному слову из каждой ветки; по возможности не то же самое, что было
      for (const i of [0, 1]) { const ws = words(i); if (!ws.length) continue; const pool = ws.length > 1 ? ws.filter((n) => n.id !== st.pair[i]) : ws; st.pair[i] = pool[Math.floor(Math.random() * pool.length)].id; }
      if (st.stage === 'image') { st.note = ''; st.saved = ''; } draw(); return;
    }
    if (e.target.closest('[data-toimg]')) { st.stage = 'image'; st.adding = null; draw('#imn'); const s = ctx.main.querySelector('#imgstep'); if (s) s.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    if (e.target.closest('[data-saveimg]')) {
      const text = st.note.trim(); if (!text) return;
      const b = e.target.closest('[data-saveimg]'); b.disabled = true;
      try {
        st.imgId = st.imgId && st.saved ? st.imgId : personal.newPostcardId();
        await personal.saveImageNote({ id: st.imgId, code: st.code, words: [wordOf(st.pair[0]), wordOf(st.pair[1])], text });
        st.saved = text; draw();
      } catch { b.disabled = false; const s = ctx.main.querySelector('.imag-saved'); if (s) s.textContent = tt('Не удалось сохранить — попробуйте ещё раз.', 'Could not save — try again.'); }
      return;
    }
    if (e.target.closest('[data-otherpair]')) { st.stage = 'build'; st.pair = [null, null]; st.note = ''; st.saved = ''; st.imgId = null; draw(); const p = ctx.main.querySelector('#pairstep'); if (p) p.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    if (e.target.closest('[data-restart]')) { st = blank(cards[(idx() + 1) % cards.length].code); draw(); window.scrollTo(0, 0); }
  });
  zoomer(ctx, cards); draw();
}

// ---------- «Мои образы» (внутри «Моих подборок») ----------
export async function myImages(ctx) {
  loading(ctx.main);
  let s; let cards;
  try { [s, cards] = await Promise.all([personal.load(true), loadCards(ctx)]); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  const by = new Map(cards.map((c) => [c.code, c]));
  const list = (s.images || []).filter((x) => by.has(x.code));
  const open = ctx.query.get('i');
  const cur = open && list.find((x) => x.id === open);
  if (cur) {
    const c = by.get(cur.code);
    ctx.main.innerHTML = `<div class="wrap page narrow stack"><a class="small" href="${u('/me/images')}">← ${esc(tt('Мои образы', 'My images'))}</a>
      <p class="img-text">${esc(cur.text)}</p>
      <div class="imag-pair small-pair"><span>${esc(cur.words[0])}</span><b>+</b><span>${esc(cur.words[1])}</span></div>
      <div class="img-src"><button type="button" class="live-card-btn" data-zoom="${esc(c.code)}" aria-label="${esc(tt('Открыть исходную карту', 'Open the source card'))}"><img src="${esc(c.thumb)}" alt="" width="60"></button><span class="small muted">${esc(tt('Исходная карта', 'Source card'))}</span></div>
      <p class="small muted" style="margin:0">${esc(new Date(cur.createdAt).toLocaleDateString(lang === 'en' ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }))}</p>
      <div class="row"><a class="btn light" href="${u('/group/solo/imagine')}">${esc(tt('Играть ещё', 'Play again'))}</a><button class="link-btn" type="button" data-del>${esc(tt('Удалить', 'Delete'))}</button></div></div>`;
    zoomer(ctx, cards);
    ctx.main.querySelector('[data-del]').onclick = async () => { if (!confirm(tt('Удалить образ?', 'Delete the image?'))) return; await personal.deleteImageNote(cur.id).catch(() => {}); ctx.navigate('/me/images', { replace: true }); };
    return;
  }
  ctx.main.innerHTML = `<div class="wrap page narrow stack"><a class="small" href="${u('/me/collections')}">← ${esc(tt('Мои подборки', 'My collections'))}</a>
    <h1 style="margin:0">${esc(tt('Мои образы', 'My images'))}</h1>
    ${s.server ? '' : `<p class="vb-note">${esc(tt('Сохранено в этом браузере. Войдите, чтобы видеть на других устройствах.', 'Saved in this browser. Sign in to see them on other devices.'))}</p>`}
    ${list.length ? `<div class="list">${list.map((x) => `<a class="item img-item" href="${u('/me/images?i=' + encodeURIComponent(x.id))}"><span class="body"><b class="img-text-s">${esc(x.text)}</b><span class="small">${esc(x.words[0])} + ${esc(x.words[1])}</span></span><span class="img-src-s"><img src="${esc(by.get(x.code).thumb)}" alt="" width="30"><span class="small muted">${esc(tt('Исходная карта', 'Source card'))}</span></span></a>`).join('')}</div>`
      : `<p class="empty">${esc(tt('Здесь появятся образы из игры «Придумай ассоциации».', 'Images from the “Find associations” game will appear here.'))}</p><a class="btn yellow" href="${u('/group/solo/imagine')}" style="justify-self:start">${esc(tt('Придумай ассоциации', 'Find associations'))}</a>`}
  </div>`;
}

