// «Играть одному» (19.11.2026): четыре игры для одного человека, без регистрации. Карты — из галереи (случайная выдача).
// Выборы, замены и раскрытия карт здесь не увеличивают «Выбрали для разговора»: на сервер ничего не отправляется.
// Очков, таймеров, рейтингов и автоматической оценки ответов нет — игрок отвечает про себя.
import { lang } from '../i18n.js';
import { esc, tt, u, api, shareLink, storage, toast, errorText } from '../util.js';
import { ic, loading, failed, session } from '../ui.js';
import { openViewer } from '../viewer.js';
import * as personal from '../personal.js';

export const SOLO_GAMES = [
  { key: 'story', path: '/group/solo/story', ru: 'История из трёх карт', en: 'A story from three cards', dru: 'Открой три разные карты одну за другой и сочини по ним историю.', den: 'Open three different cards one after another and make up a story from them.' },
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
const frame = (g, inner) => `<div class="wrap page narrow stack solo-page"><p class="eyebrow" style="margin:0">${esc(tt('Играть одному', 'Play solo'))}</p><h1 style="margin:0">${esc(T(g))}</h1>${inner}</div>`;
function zoomer(ctx, cards) { ctx.main.addEventListener('click', (e) => { const z = e.target.closest('[data-zoom]'); if (z) { const c = cards.find((x) => x.code === z.dataset.zoom); if (c) openViewer({ cards: [c], index: 0, mode: 'admin', simple: true }); } }); }
const keep = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } };
const restore = (k) => { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch { return null; } };

// ---------- «Что их связывает?» ----------
// Первая фраза — исходная; «А что ещё?» по кругу предлагает разные углы зрения на ту же пару (аудит 28.11.2026, п. 21).
const MORE = () => [tt('Найди связь между этими картами.', 'Find a connection between these cards.'),
  tt('Что общего в настроении?', 'What do they share in mood?'),
  tt('Какая деталь могла бы перейти из одной сцены в другую?', 'Which detail could move from one scene into the other?'),
  tt('Что могло случиться между первой и второй картой?', 'What could have happened between the first card and the second?'),
  tt('Если это два героя, о чём бы они поговорили?', 'If these were two characters, what would they talk about?'),
  tt('Какое одно слово подходит обеим картам?', 'Which single word fits both cards?'),
  tt('Чем они отличаются — и что из этого следует?', 'How are they different — and what follows from that?'),
  tt('Какая история могла бы связать эти две карты?', 'What story could connect these two cards?'),
  tt('Попробуй найти связь, которая не видна сразу.', 'Try to find a connection that is not obvious at first.')];
// номер подсказки: 0 — исходная, дальше по кругу без возврата к исходной
const moreText = (n) => { const m = MORE(); return n === 0 ? m[0] : m[1 + ((n - 1) % (m.length - 1))]; };
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
      <p class="lead" aria-live="polite" style="margin:0">${esc(moreText(st.n))}</p>
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

// ---------- «Глаз-алмаз» (22.11.2026: согласованная механика и банк автора) ----------
// Карта без вопроса → «Запомнил» → карта скрыта, вопрос → ответ обязательно записывается → «Проверить»:
// карта, вопрос, свой ответ и правильный ответ из банка — сравнение самостоятельное, без оценки.
// Банк — на сервере (server/data/eagle-bank.txt): три пары к каждой карте, по коду DC-XXXX. Раунд хранит снимок вопроса и ответа,
// поэтому переживает обновление банка. «Предложить другу» — то же задание другу (/e/<ссылка>).
const EAGLE_KEY = 'dc_solo_eagle2';
const EAGLE_RU_ONLY = () => (lang === 'en' ? `<p class="small muted" style="margin:0">${esc('The questions are in Russian for now.')}</p>` : '');
export const eagleInvite = (url) => `${tt('Проверим нашу наблюдательность?', 'Shall we test how observant we are?')}\n${tt('Рассмотри карту, запомни детали и ответь на вопрос. Потом сравним наши ответы.', 'Look at the card, remember the details and answer the question. Then we’ll compare our answers.')}\n${url}`;
const newToken = () => { const a = new Uint8Array(18); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const hiddenCard = () => `<div class="eagle-hidden" role="img" aria-label="${esc(tt('Карта скрыта', 'The card is hidden'))}">${ic.lock || ''}<span>${esc(tt('Карта скрыта', 'The card is hidden'))}</span></div>`;
const answerForm = (id, label) => `<form class="stack eagle-form" data-eform><label class="field" for="${id}">${esc(label)}</label><textarea id="${id}" rows="3" maxlength="300" required></textarea>
  <button class="btn yellow" type="submit" disabled data-check>${esc(tt('Проверить', 'Check'))}</button></form>`;
/** Кнопка «Проверить» доступна, только когда в поле есть текст (пробелы не считаются). */
function guardCheck(root) {
  const f = root.querySelector('[data-eform]'); if (!f) return;
  const t = f.querySelector('textarea'); const b = f.querySelector('[data-check]');
  const upd = () => { b.disabled = !t.value.trim(); }; t.addEventListener('input', upd); upd();
}
const answersHtml = (list) => `<ul class="eagle-answers">${list.map((x) => `<li><span class="small muted">${esc(x.name)}${x.me ? ` · ${esc(tt('вы', 'you'))}` : ''}</span><p>${esc(x.text)}</p></li>`).join('')}</ul>`;

export async function eagle(ctx) {
  loading(ctx.main);
  let cards; let bank;
  try { [cards, bank] = await Promise.all([loadCards(ctx), api('/api/eagle/bank')]); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  cards = cards.filter((c) => Array.isArray(bank.items[c.code]) && bank.items[c.code].length);
  if (!cards.length) { ctx.main.innerHTML = frame(G('eagle'), `<p class="empty">${esc(tt('Заданий пока нет.', 'No tasks yet.'))}</p>`); return; }
  const by = (code) => cards.find((x) => x.code === code);
  const pickTask = (seen = []) => {
    const c = pickOther(cards, seen); const list = bank.items[c.code]; const it = list[Math.floor(Math.random() * list.length)];
    return { v: 2, code: c.code, qid: it.id, ver: it.v, q: it.q, a: it.a, phase: 'look', answer: '', seen: [...seen, c.code].slice(-20), sent: null };
  };
  let st = restore(EAGLE_KEY);
  // начатый раунд сохраняется со своим вопросом и ответом, даже если банк с тех пор обновили; карта должна оставаться в галерее
  if (!st || st.v !== 2 || !by(st.code) || !st.q) st = pickTask([]);
  // «Новое задание» / «Предложить своё задание» из обмена — всегда новое задание, а не прежний раунд из этой вкладки
  if (ctx.query.get('new')) { st = pickTask([...(st.seen || []), st.code]); history.replaceState(history.state, '', u('/group/solo/eagle')); }
  const name0 = () => storage.get('dc_live_name') || (session.user && (session.user.publicName || session.user.name)) || '';
  const draw = () => {
    keep(EAGLE_KEY, st);
    const c = by(st.code);
    let inner;
    if (st.phase === 'look') inner = `<p class="lead" style="margin:0">${esc(tt('Рассмотри карту и запомни детали.', 'Look at the card and remember the details.'))}<br>${esc(tt('Когда нажмёшь «Запомнил», карта скроется и появится вопрос.', 'When you tap “Got it”, the card will hide and a question will appear.'))}</p>${cardImg(c)}<div class="row"><button class="btn yellow" type="button" data-remember>${esc(tt('Запомнил', 'Got it'))}</button></div>`;
    else if (st.phase === 'ask') inner = `${hiddenCard()}<p class="lead" style="margin:0" aria-live="polite"><b>${esc(st.q)}</b></p>${EAGLE_RU_ONLY()}${answerForm('eans', tt('Твой ответ', 'Your answer'))}`;
    else inner = `${cardImg(c)}<p class="lead" style="margin:0"><b>${esc(st.q)}</b></p>
      ${answersHtml([{ name: tt('Твой ответ', 'Your answer'), text: st.answer }])}
      <p class="eagle-answer">${esc(tt('Правильный ответ', 'Correct answer'))}: ${esc(st.a)}</p>
      ${st.sendOpen ? `<div class="card-ui flat stack eagle-send" id="esend"><p class="small" style="margin:0">${esc(tt('Друг получит эту карту и этот вопрос.', 'Your friend gets this card and this question.'))}<br>${esc(tt('Твой ответ он увидит, когда напишет свой.', 'They will see your answer once they have written theirs.'))}</p>
        <label class="field" for="ename">${esc(tt('Твоё имя', 'Your name'))}</label><input id="ename" maxlength="40" value="${esc(name0())}" autocomplete="given-name" aria-describedby="ename-h"><span class="small muted" id="ename-h">${esc(tt('Его увидит друг', 'Your friend will see it'))}</span>
        <button class="btn yellow" type="button" data-send>${ic.share}<span>${esc(tt('Предложить другу', 'Suggest to a friend'))}</span></button>
        ${st.sent ? `<a class="small" href="${u('/e/' + st.sent)}">${esc(tt('Открыть результат друга', 'Open your friend’s result'))}</a>` : ''}</div>`
      : `<div class="row"><button class="btn yellow" type="button" data-sendopen aria-expanded="false" aria-controls="esend">${esc(tt('Предложить другу', 'Suggest to a friend'))}</button></div>`}
      <div class="row"><button class="btn eagle-next" type="button" data-next>${esc(tt('Другое задание', 'Another task'))}</button></div>
      <a class="text-link" href="${u('/group/solo')}">${esc(tt('Выбрать другую игру', 'Choose another game'))}</a>`;
    ctx.main.innerHTML = frame(G('eagle'), inner);
    guardCheck(ctx.main);
  };
  ctx.main.addEventListener('submit', (e) => {
    if (!e.target.closest('[data-eform]')) return; e.preventDefault();
    const v = ctx.main.querySelector('#eans').value.trim(); if (!v || st.phase !== 'ask') return;
    st.answer = v; st.phase = 'check'; draw(); const q = ctx.main.querySelector('.lead b'); if (q) q.closest('p').scrollIntoView({ block: 'center' }); const n = ctx.main.querySelector('[data-sendopen]'); if (n) n.focus({ preventScroll: true });
  });
  ctx.main.addEventListener('click', async (e) => {
    if (e.target.closest('[data-remember]')) { st.phase = 'ask'; draw(); ctx.main.querySelector('#eans').focus(); }
    else if (e.target.closest('[data-next]')) { st = pickTask(st.seen); draw(); window.scrollTo(0, 0); }
    else if (e.target.closest('[data-sendopen]')) { st.sendOpen = true; draw(); const n = ctx.main.querySelector('#ename'); if (n) { n.focus({ preventScroll: true }); ctx.main.querySelector('#esend').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } }
    else if (e.target.closest('[data-send]')) {
      const b = e.target.closest('[data-send]'); const nm = ctx.main.querySelector('#ename').value.trim();
      if (!nm) { toast(tt('Напишите имя — его увидит друг.', 'Enter your name — your friend will see it.')); ctx.main.querySelector('#ename').focus(); return; }
      storage.set('dc_live_name', nm);
      const tok = st.pendingTok || newToken(); st.pendingTok = tok; keep(EAGLE_KEY, st);
      const url = shareLink('/e/' + tok); b.disabled = true;
      // запрос уходит сразу, меню отправки открывается в том же нажатии
      const saved = api('/api/eagle/x', { method: 'POST', body: { token: tok, qid: st.qid, ver: st.ver, name: nm, answer: st.answer } });
      const sent = sendText(eagleInvite(url));
      try { await saved; st.sent = tok; st.pendingTok = null; } catch (x) { toast(errorText(x)); }
      await sent; b.disabled = false; draw();
    }
  });
  zoomer(ctx, cards); draw();
}
/** Отправка текста: на телефоне — системное меню; на компьютере — копирование. */
async function sendText(text) {
  if (navigator.share && matchMedia('(pointer: coarse)').matches) { try { await navigator.share({ text }); return true; } catch { return false; } }
  try { await navigator.clipboard.writeText(text); toast(tt('Приглашение скопировано', 'Invitation copied')); } catch { prompt(tt('Скопируйте приглашение:', 'Copy the invitation:'), text); }
  return true;
}

/** Задание от друга (/e/<ссылка>): рассмотреть карту → «Запомнил» → вопрос → ответ → результат с обоими ответами. */
export async function eagleX(ctx, token) {
  const key = 'dc_eagle_' + token;
  const local = (() => { try { return JSON.parse(localStorage.getItem(key) || 'null') || {}; } catch { return {}; } })();
  const remember = (v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* */ } };
  loading(ctx.main);
  let d;
  const load = async (look) => { d = await api(`/api/eagle/x/${encodeURIComponent(token)}${look ? '?look=1' : ''}`); };
  try { await load(local.phase === 'ask'); } catch (e) {
    if (e.status === 404) { ctx.main.innerHTML = frame(G('eagle'), `<p class="empty">${esc(tt('Задание не найдено. Проверьте ссылку.', 'Task not found. Check the link.'))}</p><a class="btn" href="${u('/group/solo/eagle')}">${esc(tt('Сыграть самому', 'Play yourself'))}</a>`); return; }
    return failed(ctx.main, e, ctx.rerender);
  }
  if (!ctx.alive()) return;
  const c = d.card;
  const draw = () => {
    let inner = '';
    if (d.mine) {
      inner = `<p class="lead" style="margin:0">${esc(tt('Твоё задание другу', 'Your task for a friend'))}</p>${c ? cardImg(c) : ''}<p class="lead" style="margin:0"><b>${esc(d.question)}</b></p>
        ${answersHtml(d.answers)}<p class="eagle-answer">${esc(tt('Правильный ответ', 'Correct answer'))}: ${esc(d.answer)}</p>
        ${d.replies ? '' : `<p class="small muted" style="margin:0">${esc(tt('Друг ещё не ответил. Когда ответит, здесь появится его ответ.', 'Your friend has not answered yet. Their answer will appear here.'))}</p>
          <button class="btn light" type="button" data-resend>${ic.share}<span>${esc(tt('Отправить ссылку ещё раз', 'Send the link again'))}</span></button>`}
        <div class="row"><a class="btn yellow" href="${u('/group/solo/eagle?new=1')}">${esc(tt('Новое задание', 'A new task'))}</a></div>`;
    } else if (d.phase === 'look') {
      inner = `<h2 class="eagle-invite-h">${esc(tt('Проверим нашу наблюдательность?', 'Shall we test how observant we are?'))}</h2><p class="lead" style="margin:0">${esc(tt(`${d.fromName} предлагает рассмотреть карту и запомнить детали.`, `${d.fromName} invites you to look at the card and remember the details.`))}<br>${esc(tt('Когда нажмёшь «Запомнил», карта скроется и появится вопрос.', 'When you tap “Got it”, the card will hide and a question will appear.'))}</p>
        ${c ? cardImg(c) : ''}<div class="row"><button class="btn yellow" type="button" data-remember>${esc(tt('Запомнил', 'Got it'))}</button></div>`;
    } else if (d.phase === 'ask') {
      inner = `${hiddenCard()}<p class="lead" style="margin:0" aria-live="polite"><b>${esc(d.question)}</b></p>${EAGLE_RU_ONLY()}
        <form class="stack eagle-form" data-eform><label class="field" for="ename">${esc(tt('Твоё имя', 'Your name'))}</label><input id="ename" maxlength="40" required value="${esc(storage.get('dc_live_name') || '')}" autocomplete="given-name">
        <label class="field" for="eans">${esc(tt('Твой ответ', 'Your answer'))}</label><textarea id="eans" rows="3" maxlength="300" required>${esc(local.draft || '')}</textarea>
        <button class="btn yellow" type="submit" disabled data-check>${esc(tt('Проверить', 'Check'))}</button></form>`;
    } else {
      inner = `${c ? cardImg(c) : ''}<p class="lead" style="margin:0"><b>${esc(d.question)}</b></p>
        ${answersHtml(d.answers)}<p class="eagle-answer">${esc(tt('Правильный ответ', 'Correct answer'))}: ${esc(d.answer)}</p>
        <div class="row"><a class="btn yellow" href="${u('/group/solo/eagle?new=1')}">${esc(tt('Предложить своё задание', 'Send your own task'))}</a></div>`;
    }
    ctx.main.innerHTML = frame(G('eagle'), inner);
    const f = ctx.main.querySelector('[data-eform]');
    if (f) {
      const t = f.querySelector('#eans'); const n = f.querySelector('#ename'); const b = f.querySelector('[data-check]');
      const upd = () => { b.disabled = !t.value.trim() || !n.value.trim(); local.draft = t.value; remember(local); };
      t.addEventListener('input', upd); n.addEventListener('input', upd); upd();
    }
  };
  ctx.main.addEventListener('click', async (e) => {
    if (e.target.closest('[data-remember]')) { local.phase = 'ask'; remember(local); try { await load(true); } catch (x) { toast(errorText(x)); return; } draw(); const t = ctx.main.querySelector('#eans'); if (t) t.focus(); }
    if (e.target.closest('[data-resend]')) sendText(eagleInvite(shareLink('/e/' + token)));
  });
  ctx.main.addEventListener('submit', async (e) => {
    if (!e.target.closest('[data-eform]')) return; e.preventDefault();
    const name = ctx.main.querySelector('#ename').value.trim(); const answer = ctx.main.querySelector('#eans').value.trim();
    if (!name || !answer) return;
    const b = ctx.main.querySelector('[data-check]'); b.disabled = true; storage.set('dc_live_name', name);
    try { d = await api(`/api/eagle/x/${encodeURIComponent(token)}/answer`, { method: 'POST', body: { name, answer } }); local.phase = 'result'; local.draft = ''; remember(local); draw(); window.scrollTo(0, 0); }
    catch (x) { b.disabled = false; toast(errorText(x)); }
  });
  zoomer(ctx, c ? [c] : []); draw();
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
  // новый запуск — случайная карта; начатая игра (в этой вкладке) продолжается с той же карты и прогресса (23.11.2026)
  if (!st || st.v !== 3 || !cards.some((c) => c.code === st.code)) st = blank(cards[Math.floor(Math.random() * cards.length)].code);
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
  const addForm = (n) => `<form class="assoc-add wide" data-addto="${n.id}"><label class="assoc-add-l" for="as-${n.id}">${esc(tt(`Ассоциация к слову «${n.word}»`, `Association for “${n.word}”`))}</label><div class="row"><input id="as-${n.id}" maxlength="40" autocomplete="off" value="${esc(st.addText && st.addText.id === n.id ? st.addText.text : '')}"><button class="btn sm" type="submit" aria-label="${esc(tt('Добавить', 'Add'))}">+</button></div></form>`;
  const sub = (id) => { const kids = st.nodes.filter((n) => n.parent === id); return kids.length ? `<ul>${kids.map((n) => `<li><button type="button" class="assoc-w ${st.adding === n.id ? 'on' : ''}" data-node="${n.id}">${esc(n.word)}</button>${sub(n.id)}</li>`).join('')}</ul>` : ''; };
  const branchHtml = (i) => { const r = rootOf(i); if (!r) return ''; return `<div class="branch"><button type="button" class="assoc-root ${st.adding === r.id ? 'on' : ''}" data-node="${r.id}">${esc(r.word)}</button>${sub(r.id)}</div>`; };
  const pairCol = (i) => { const r = rootOf(i); return `<div class="branch pick"><span class="assoc-root static">${esc(r ? r.word : '')}</span><div class="pick-words">${words(i).map((n) => `<button type="button" class="chip ${st.pair[i] === n.id ? 'on' : ''}" data-pick="${i}:${n.id}" aria-pressed="${st.pair[i] === n.id}">${esc(n.word)}</button>`).join('')}</div></div>`; };
  const wordOf = (id) => (st.nodes.find((n) => n.id === id) || {}).word || '';
  // пример к шагу — своя свёрнутая строка; маленькое превью показывает, что пример относится к другой карте
  const exThumb = () => (ex ? `<img class="ex-thumb" src="${esc(ex.thumb)}" alt="${esc(tt('Карта для примера: корабль и море', 'Example card: a ship and the sea'))}" width="52">` : '');
  const example = (n, body) => `<details class="imag-ex" ${(st.exOpen || {})[n] ? 'open' : ''} data-ex="${n}"><summary>${esc(tt('Пример', 'Example'))}</summary><div class="imag-ex-in">${exThumb()}<div>${body}</div></div></details>`;
  const activeNode = () => st.nodes.find((n) => n.id === st.adding);
  // согласованный пример (23.11.2026): детали → ассоциации → пара → новый образ, каждая деталь — своим блоком
  const EX_LINE = (k, v) => `<p class="ex-line"><span class="ex-k">${esc(k)} —</span> ${esc(v)}</p>`;
  const EX_ASSOC = () => `<div class="ex-block">${EX_LINE(tt('Первая деталь', 'First detail'), tt('корабль', 'a ship'))}${EX_LINE(tt('Ассоциации', 'Associations'), tt('путешествие, парус, ветер', 'journey, sail, wind'))}</div>
    <div class="ex-block">${EX_LINE(tt('Вторая деталь', 'Second detail'), tt('море', 'the sea'))}${EX_LINE(tt('Ассоциации', 'Associations'), tt('волна, глубина, простор', 'wave, depth, open space'))}</div>`;
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
        ${example(3, EX_ASSOC())}
        ${ready() ? '' : `<p class="vb-note" style="margin:0">${esc(tt('Добавь хотя бы по одной ассоциации в каждую ветку', 'Add at least one association to each branch'))}</p>`}</section>`;
      if (ready()) {
        tail += `<section class="imag-step" id="pairstep"><h2><span class="n">4</span>${esc(tt('Выбери пару', 'Choose a pair'))}</h2>
          <p style="margin:0">${esc(tt('Выбери по одному слову из каждой ветки', 'Choose one word from each branch'))}</p>
          <div class="branches">${pairCol(0)}${pairCol(1)}</div>
          <div class="row"><button class="btn light" type="button" data-random>${esc(tt('Случайная пара', 'Random pair'))}</button></div>
          ${example(4, `${EX_ASSOC()}${EX_LINE(tt('Выбранная пара', 'Chosen pair'), tt('парус + волна', 'sail + wave'))}`)}
          ${st.stage === 'build' ? `<div class="row"><button class="btn yellow" type="button" data-toimg ${st.pair[0] && st.pair[1] ? '' : 'disabled'}>${esc(tt('Дальше', 'Next'))}</button></div>` : ''}</section>`;
      }
      if (st.stage === 'image' && st.pair[0] && st.pair[1]) {
        tail += `<section class="imag-step" id="imgstep"><h2><span class="n">5</span>${esc(tt('Представь новый образ', 'Imagine a new image'))}</h2>
          <div class="imag-pair"><span>${esc(wordOf(st.pair[0]))}</span><b>+</b><span>${esc(wordOf(st.pair[1]))}</span></div>
          <p style="margin:0">${esc(tt('Как бы эти два слова встретились на одной картинке?', 'How would these two words meet in one picture?'))}</p>
          <label class="sr-only" for="imn">${esc(tt('Мой образ', 'My image'))}</label><textarea id="imn" rows="2" maxlength="300">${esc(st.note)}</textarea>
          ${example(5, `${EX_ASSOC()}${EX_LINE(tt('Выбранная пара', 'Chosen pair'), tt('парус + волна', 'sail + wave'))}${EX_LINE(tt('Новый образ', 'New image'), tt('корабль с парусом в форме волны', 'a ship with a sail shaped like a wave'))}`)}
          <div class="imag-acts">
            <div class="row"><button class="btn yellow" type="button" data-saveimg ${st.note.trim() ? '' : 'disabled'}>${esc(tt('Сохранить образ', 'Save the image'))}</button><button class="btn imag-other" type="button" data-otherpair>${esc(tt('Другая пара', 'Another pair'))}</button></div>
            <span class="imag-saved" role="status">${st.saved && st.saved === st.note.trim() ? `${esc(tt('Образ сохранён', 'Image saved'))} · <a href="${u('/me/images')}">${esc(tt('Мои образы', 'My images'))}</a>` : ''}</span>
            <div class="row"><button class="btn imag-new" type="button" data-restart>${esc(tt('Новая карта', 'New card'))}</button></div>
            <a class="text-link" href="${u('/group/solo')}">${esc(tt('Выбрать другую игру', 'Choose another game'))}</a></div></section>`;
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
          ${example(2, `${EX_LINE(tt('Первая деталь', 'First detail'), tt('корабль', 'a ship'))}${EX_LINE(tt('Вторая деталь', 'Second detail'), tt('море', 'the sea'))}`)}
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
    const ad = e.target.closest('[data-addto] input'); if (ad) { st.addText = { id: ad.closest('[data-addto]').dataset.addto, text: ad.value }; save(); return; } // недописанная ассоциация
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
    st.addText = null;
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
    if (e.target.closest('[data-restart]')) { const pool = cards.filter((c) => c.code !== st.code); st = blank((pool.length ? pool : cards)[Math.floor(Math.random() * (pool.length || cards.length))].code); draw(); window.scrollTo(0, 0); }
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

