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
  { key: 'imagine', path: '/group/solo/imagine', ru: 'Дай волю воображению', en: 'Let your imagination play', dru: 'Выбери две детали на карте. Придумай ассоциации и соедини две из них в новом образе.', den: 'Pick two details on the card. Come up with associations and combine two of them into a new image.' },
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
    <p class="small muted">${esc(tt('Играть вдвоём или компанией:', 'Play with others:'))} <a href="${u('/group')}">${esc(tt('Играть с компанией', 'Play with friends'))}</a> · <a href="${u('/play')}">${esc(tt('Отправить другу с вопросом', 'Send to a friend with a question'))}</a></p>
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

// ---------- «Дай волю воображению» ----------
// Две ветки ассоциаций от двух деталей, которые игрок сам заметил; затем пара — по одному слову из каждой ветки —
// и вопрос, как они могли бы встретиться на одной картинке. Всё хранится только в этой вкладке.
let nid = 1;
const node = (word, parent = null) => ({ id: `n${Date.now().toString(36)}${nid++}`, word, parent });
export async function imagine(ctx) {
  loading(ctx.main);
  let cards; try { cards = await loadCards(ctx); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  const by = (c) => cards.find((x) => x.code === c);
  let st = restore('dc_solo_imagine');
  if (!st || !by(st.code)) st = { code: pickOther(cards, []).code, step: 1, roots: ['', ''], nodes: [], adding: null, pair: [null, null], hold: [false, false], note: '' };
  const branch = (i) => { const root = st.nodes.find((n) => n.parent === null && n.branch === i); if (!root) return []; const out = []; const walk = (id) => st.nodes.filter((n) => n.parent === id).forEach((n) => { out.push(n); walk(n.id); }); walk(root.id); return out; };
  const tree = (parentId, depth = 0) => st.nodes.filter((n) => n.parent === parentId).map((n) => `<li><button type="button" class="assoc ${st.adding === n.id ? 'on' : ''}" data-node="${n.id}" aria-label="${esc(tt(`Добавить ассоциацию к слову «${n.word}»`, `Add an association to “${n.word}”`))}">${esc(n.word)}</button>
      ${st.adding === n.id ? `<form class="assoc-add" data-addto="${n.id}"><label class="sr-only" for="as-${n.id}">${esc(tt(`Ассоциация к слову «${n.word}»`, `Association for “${n.word}”`))}</label><input id="as-${n.id}" maxlength="30" placeholder="${esc(tt('ассоциация…', 'association…'))}" autocomplete="off"><button class="btn sm" type="submit">${esc(tt('Добавить', 'Add'))}</button></form>` : ''}
      ${st.nodes.some((x) => x.parent === n.id) ? `<ul>${tree(n.id, depth + 1)}</ul>` : ''}</li>`).join('');
  const draw = (focus) => {
    keep('dc_solo_imagine', st);
    const c = by(st.code); let inner;
    const steps = `<ol class="imag-steps" aria-label="${esc(tt('Шаги', 'Steps'))}">${[tt('Выбери две детали', 'Pick two details'), tt('Придумай ассоциации', 'Make associations'), tt('Выбери пару', 'Choose a pair'), tt('Представь новый образ', 'Imagine a new image')].map((x, i) => `<li class="${i + 1 === st.step ? 'on' : i + 1 < st.step ? 'done' : ''}">${esc(x)}</li>`).join('')}</ol>`;
    if (st.step === 1) {
      inner = `${steps}<p class="vb-note" style="margin:0">${esc(tt('Выбери две детали на карте. Придумай ассоциации и соедини две из них в новом образе.', 'Pick two details on the card. Come up with associations and combine two of them into a new image.'))}</p>
        ${cardImg(c, 'live-card sm-card')}
        <form class="form" id="roots"><p style="margin:0"><b>${esc(tt('Выбери две детали', 'Pick two details'))}</b> — ${esc(tt('два символа, предмета или образа, которые ты заметил. Назови каждую коротко.', 'two symbols, objects or images you noticed. Name each briefly.'))}</p>
          <div class="row"><label class="field small" style="flex:1">${esc(tt('Деталь 1', 'Detail 1'))}<input name="r0" maxlength="30" value="${esc(st.roots[0])}" placeholder="${esc(tt('например, солнце', 'e.g. sun'))}" autocomplete="off"></label>
          <label class="field small" style="flex:1">${esc(tt('Деталь 2', 'Detail 2'))}<input name="r1" maxlength="30" value="${esc(st.roots[1])}" placeholder="${esc(tt('например, кактус', 'e.g. cactus'))}" autocomplete="off"></label></div>
          <div class="row"><button class="btn yellow" type="submit">${esc(tt('Дальше', 'Next'))}</button><button class="btn light" type="button" data-newcard>${esc(tt('Другая карта', 'Another card'))}</button></div></form>`;
    } else if (st.step === 2) {
      const ok = [0, 1].every((i) => branch(i).length);
      inner = `${steps}<p style="margin:0"><b>${esc(tt('Придумай ассоциации', 'Make associations'))}</b> — ${esc(tt('нажми на любое слово и добавь к нему ассоциацию. К одному слову можно добавить несколько, можно уходить вглубь цепочки.', 'tap any word and add an association to it. One word can have several; you can go deeper along a chain.'))}</p>
        <div class="assoc-trees">${[0, 1].map((i) => `<ul class="assoc-tree" aria-label="${esc(tt(`Ветка ${i + 1}`, `Branch ${i + 1}`))}">${treeRoot(i)}</ul>`).join('')}</div>
        <div class="row"><button class="btn yellow" type="button" data-topair ${ok ? '' : 'disabled'}>${esc(tt('Выбрать пару', 'Choose a pair'))}</button><button class="btn light" type="button" data-back1>${esc(tt('Назад', 'Back'))}</button></div>
        ${ok ? '' : `<p class="vb-note" style="margin:0">${esc(tt('Добавь хотя бы по одной ассоциации в каждую ветку.', 'Add at least one association to each branch.'))}</p>`}`;
    } else if (st.step === 3) {
      const words = [0, 1].map((i) => branch(i));
      inner = `${steps}<p style="margin:0"><b>${esc(tt('Выбери пару', 'Choose a pair'))}</b> — ${esc(tt('по одному слову из каждой ветки, сам или случайно.', 'one word from each branch, yourself or at random.'))}</p>
        ${[0, 1].map((i) => `<fieldset class="pair-pick"><legend>${esc(st.roots[i])}</legend><div class="pc-row">${words[i].map((n) => `<button type="button" class="chip ${st.pair[i] === n.id ? 'on' : ''}" data-pick="${i}:${n.id}" aria-pressed="${st.pair[i] === n.id}">${esc(n.word)}</button>`).join('')}</div>
          ${st.pair[i] ? `<label class="check small"><input type="checkbox" data-hold="${i}" ${st.hold[i] ? 'checked' : ''}> <span>${esc(tt('Оставить это слово', 'Keep this word'))}</span></label>` : ''}</fieldset>`).join('')}
        <div class="row"><button class="btn light" type="button" data-random>${esc(tt('Случайная пара', 'Random pair'))}</button><button class="btn yellow" type="button" data-toimg ${st.pair[0] && st.pair[1] ? '' : 'disabled'}>${esc(tt('Дальше', 'Next'))}</button>
          <button class="link-btn" type="button" data-back2>${esc(tt('Добавить ассоциации', 'Add associations'))}</button></div>
        ${words.some((w) => w.length < 2) ? `<p class="vb-note" style="margin:0">${esc(tt('Вариантов пока мало — можно добавить ассоциации.', 'Not many options yet — you can add associations.'))}</p>` : ''}`;
    } else {
      const w = st.pair.map((id) => (st.nodes.find((n) => n.id === id) || {}).word || '');
      inner = `${steps}<div class="imag-pair"><span>${esc(w[0])}</span><b>+</b><span>${esc(w[1])}</span></div>
        <p class="lead" style="margin:0"><b>${esc(tt('Как эти две находки могли бы встретиться на одной картинке?', 'How could these two finds meet in one picture?'))}</b></p>
        <p class="vb-note" style="margin:0">${esc(tt('Можно оставить образ в воображении или коротко записать — по желанию.', 'You can keep the image in your imagination or jot it down — if you like.'))}</p>
        <label class="sr-only" for="imn">${esc(tt('Мой образ', 'My image'))}</label><textarea id="imn" rows="2" maxlength="300" placeholder="${esc(tt('по желанию…', 'optional…'))}">${esc(st.note)}</textarea>
        <div class="row"><button class="btn yellow" type="button" data-otherpair>${esc(tt('Другая пара', 'Another pair'))}</button><button class="btn light" type="button" data-restart>${esc(tt('Новая карта', 'New card'))}</button></div>`;
    }
    ctx.main.innerHTML = frame(G('imagine'), inner);
    const f = focus && ctx.main.querySelector(focus); if (f) f.focus();
  };
  // корень ветки и её дерево: исходная деталь — кнопка, к которой добавляются ассоциации
  function treeRoot(i) {
    const r = st.nodes.find((n) => n.parent === null && n.branch === i); if (!r) return '';
    return `<li><button type="button" class="assoc root ${st.adding === r.id ? 'on' : ''}" data-node="${r.id}" aria-label="${esc(tt(`Добавить ассоциацию к слову «${r.word}»`, `Add an association to “${r.word}”`))}">${esc(r.word)}</button>
      ${st.adding === r.id ? `<form class="assoc-add" data-addto="${r.id}"><label class="sr-only" for="as-${r.id}">${esc(tt(`Ассоциация к слову «${r.word}»`, `Association for “${r.word}”`))}</label><input id="as-${r.id}" maxlength="30" placeholder="${esc(tt('ассоциация…', 'association…'))}" autocomplete="off"><button class="btn sm" type="submit">${esc(tt('Добавить', 'Add'))}</button></form>` : ''}
      ${st.nodes.some((x) => x.parent === r.id) ? `<ul>${tree(r.id)}</ul>` : ''}</li>`;
  }
  ctx.main.addEventListener('submit', (e) => {
    e.preventDefault();
    if (e.target.id === 'roots') {
      const r0 = e.target.r0.value.trim(); const r1 = e.target.r1.value.trim();
      if (!r0 || !r1) { (r0 ? e.target.r1 : e.target.r0).focus(); return; }
      if (r0 !== st.roots[0] || r1 !== st.roots[1] || !st.nodes.length) {
        st.roots = [r0, r1]; st.nodes = [{ ...node(r0), branch: 0 }, { ...node(r1), branch: 1 }]; st.pair = [null, null]; st.hold = [false, false];
      }
      st.step = 2; st.adding = st.nodes[0].id; draw(`#as-${st.nodes[0].id}`); return;
    }
    const add = e.target.closest('[data-addto]');
    if (add) {
      const word = add.querySelector('input').value.trim(); if (!word) return;
      const parent = st.nodes.find((n) => n.id === add.dataset.addto);
      st.nodes.push({ ...node(word, parent.id), branch: parent.branch });
      draw(`#as-${parent.id}`); // можно сразу добавить к тому же слову ещё одну ассоциацию
    }
  });
  ctx.main.addEventListener('click', (e) => {
    const nb = e.target.closest('[data-node]'); if (nb) { st.adding = st.adding === nb.dataset.node ? null : nb.dataset.node; draw(st.adding ? `#as-${st.adding}` : null); return; }
    if (e.target.closest('[data-newcard]')) { st.code = pickOther(cards, [st.code]).code; draw(); return; }
    if (e.target.closest('[data-back1]')) { st.step = 1; draw(); return; }
    if (e.target.closest('[data-topair]')) { st.step = 3; st.adding = null; draw(); return; }
    if (e.target.closest('[data-back2]')) { st.step = 2; draw(); return; }
    const pk = e.target.closest('[data-pick]'); if (pk) { const [i, id] = pk.dataset.pick.split(':'); st.pair[Number(i)] = id; draw(); return; }
    if (e.target.closest('[data-random]')) {
      // случайная пара — из слов самого игрока; удержанное слово остаётся, меняется только второе
      for (const i of [0, 1]) {
        if (st.hold[i] && st.pair[i]) continue;
        const ws = branch(i); if (!ws.length) continue;
        const pool = ws.length > 1 ? ws.filter((n) => n.id !== st.pair[i]) : ws;
        st.pair[i] = pool[Math.floor(Math.random() * pool.length)].id;
      }
      draw(); return;
    }
    if (e.target.closest('[data-toimg]')) { st.step = 4; draw(); return; }
    if (e.target.closest('[data-otherpair]')) { st.step = 3; st.note = ''; draw(); return; }
    if (e.target.closest('[data-restart]')) { st = { code: pickOther(cards, [st.code]).code, step: 1, roots: ['', ''], nodes: [], adding: null, pair: [null, null], hold: [false, false], note: '' }; draw(); window.scrollTo(0, 0); }
  });
  ctx.main.addEventListener('change', (e) => { const h = e.target.closest('[data-hold]'); if (h) { st.hold[Number(h.dataset.hold)] = h.checked; keep('dc_solo_imagine', st); } });
  ctx.main.addEventListener('input', (e) => { if (e.target.id === 'imn') { st.note = e.target.value; keep('dc_solo_imagine', st); } });
  zoomer(ctx, cards); draw();
}
