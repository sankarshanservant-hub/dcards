// «Играть компанией»: форматы для друзей без фасилитатора. Комната по QR/коду, каждый — со своего телефона.
import { lang } from '../i18n.js';
import { morph, listen, esc, tt, u, shareLink, api, errorText, toast, visitorId, storage } from '../util.js';
import { ic, loading, failed } from '../ui.js';
import { openViewer } from '../viewer.js';
import { subscribe, signHtml, unlockSound, soundsReady, play, clock, left, mmss, bellsFor, keepAwake } from '../live-common.js';
import { QUESTION_FORMATS } from '../content.js';
import * as personal from '../personal.js';
import { ONLINE_KEYS, room as onlineRoom, offerHtml, wireOffer, crewBox } from './online.js';
import { scanButton, wireScan } from '../qr-scan.js';

export const GROUP_FORMATS = [
  { key: 'one', ru: 'Одна карта на всех', en: 'One card for everyone', dru: 'Все смотрят на одну карту и по кругу говорят, что заметили и о чём она напоминает. Самый простой формат.', den: 'Everyone looks at one card and takes turns saying what they notice and what it reminds them of. The simplest format.' },
  { key: 'own', ru: 'Каждому своя карта', en: 'A card for each', dru: 'Каждый тайно выбирает карту, которая откликается ему сейчас. Потом карты открываются, и все по очереди рассказывают, почему выбрали свою.', den: 'Everyone secretly picks a card that speaks to them now. Then the cards are revealed and each person says why they chose theirs.' },
  { key: 'guess', ru: 'Угадай, кто выбрал', en: 'Guess who chose it', dru: 'Каждый тайно выбирает карту. Потом приложение показывает карты по одной и не говорит, чья она. Угадайте вслух, кто её выбрал, — затем ведущий откроет ответ, и автор расскажет о своём выборе.', den: 'Everyone secretly picks a card. Then the app shows the cards one at a time without saying whose it is. Guess out loud who chose it — then the host reveals the answer and its owner talks about the choice.' },
  { key: 'friend', ru: 'Карта для друга', en: 'A card for a friend', dru: 'Для друзей: каждому достаётся имя одного из компании — выберите карту, которая, по-вашему, подходит этому человеку. Нужно хотя бы двое.', den: 'For friends: each person gets the name of someone in the group — choose a card that you feel suits that person. At least two players.' },
  { key: 'story', ru: 'История по кругу', en: 'A story in turns', dru: 'Открывается карта — первый начинает историю одной фразой. Следующая карта — следующий продолжает, вплетая то, что на ней.', den: 'A card is revealed — the first person starts a story in one sentence. Next card — the next person continues, weaving it in.' },
  { key: 'pairs', ru: 'Разговор в парах', en: 'Conversations in pairs', dru: 'Как на встрече Dialogue Flow: половина компании выбирает карты, остальные — из уже выбранных, так складываются пары. Поговорите минут 15, потом роли меняются. Ведущий — один из вас.', den: 'Like a Dialogue Flow meeting: half the group picks cards, the others choose from those — that is how pairs form. Talk for about 15 minutes, then swap roles. The host is one of you.' },
  { key: 'question', ru: 'Вопрос от карты', en: 'A question from the card', dru: 'Каждый пишет вопрос, который «задала бы эта карта». Вопросы перемешиваются — каждому достаётся чужой, на него можно ответить или сказать «пас».', den: 'Everyone writes a question “this card would ask”. Questions are shuffled — each gets someone else’s; answer it or say “pass”.' },
];
const F = (k) => GROUP_FORMATS.find((f) => f.key === k) || GROUP_FORMATS[0];
const fTitle = (f) => (lang === 'en' ? f.en : f.ru);
const fDesc = (f) => (lang === 'en' ? f.den : f.dru);
const RULES = () => [tt('Говорим по очереди и не перебиваем.', 'We speak in turns and do not interrupt.'), tt('Советы — только если о них просят.', 'Advice only if asked.'), tt('Можно сказать «пас» — объяснять не нужно.', 'You can say “pass” — no explanation needed.'), tt('Сказанное остаётся между нами.', 'What is said stays between us.')];
// Дополнительные вопросы — без повтора того, что уже написано под картой («что заметили первым», «о чём напоминает»).
const CIRCLE = () => [tt('Что из сказанного другими вас удивило?', 'What surprised you in what others said?'), tt('Что вы забираете с собой из этого разговора?', 'What are you taking away from this conversation?')];
// Блок открывается и закрывается только по нажатию: при обновлении состояния игры его положение сохраняется (ui.open).
const circleHtml = (open) => `<details class="about-df card-ui flat" data-k="circle" ${open ? 'open' : ''}><summary><span class="grow">${esc(tt('Дополнительные вопросы', 'More questions'))}</span><span class="chev" aria-hidden="true">▾</span></summary><div class="about-body"><ul class="qlist">${CIRCLE().map((q) => `<li>${esc(q)}</li>`).join('')}</ul></div></details>`;

// ---------- выбор формата (22.11.2026: сначала игра, затем имя и создание комнаты) ----------
export async function choose(ctx) {
  let cols = []; try { cols = (await personal.load()).collections.filter((c) => c.codes.length >= 2); } catch { /* только галерея */ }
  if (!ctx.alive()) return;
  const pre = ctx.query.get('collection');
  const from = ctx.query.get('from'); // «Выбрать следующую игру»: код прежней комнаты
  const fromQ = from ? '&from=' + encodeURIComponent(from) : '';
  const crew = from ? await crewBox(from) : '';
  if (!ctx.alive()) return;
  const picked = GROUP_FORMATS.find((f) => f.key === ctx.query.get('f'));
  if (!picked) {
    ctx.main.innerHTML = `<div class="wrap page narrow stack">
      <div class="page-head"><div class="head-with-tool"><h1>${esc(tt('Играть компанией на встрече', 'Play together at a meeting'))}</h1>${scanButton(ic.qr)}</div>
        <p class="game-lead">${esc(tt('2–20 участников · каждый со своего телефона', '2–20 players · everyone on their own phone'))}</p>
        <div class="game-how"><p>${esc(tt('Выберите игру. Один участник создаёт комнату и показывает QR-код — остальные заходят по нему. Регистрация не нужна.', 'Choose a game. One player creates a room and shows the QR code — the others join with it. No sign-up needed.'))}</p></div></div>
      ${crew}
      <div class="list">${GROUP_FORMATS.map((f) => `<a class="item group-format" href="${u('/group?f=' + f.key + (pre ? '&collection=' + encodeURIComponent(pre) : '') + fromQ)}"><span class="body"><b>${esc(fTitle(f))}</b><span class="small">${esc(fDesc(f))}</span></span><span aria-hidden="true">→</span></a>`).join('')}</div>
      <p class="small"><a href="${u('/library')}">${esc(tt('Один телефон на всех? Откройте карту и вопросы', 'One phone for everyone? Open a card and its questions'))}</a></p>
    </div>`;
    wireScan(ctx.main, ctx.navigate);
    return;
  }
  const name = storage.get('dc_live_name') || '';
  ctx.main.innerHTML = `<div class="wrap page narrow stack">
    <div class="page-head"><p class="eyebrow">${esc(tt('Играть компанией на встрече', 'Play together at a meeting'))}</p><h1>${esc(fTitle(picked))}</h1><p class="lead">${esc(fDesc(picked))}</p></div>
    ${crew}
    <form class="stack" id="gcreate">
      <label class="field" for="gname">${esc(tt('Ваше имя', 'Your name'))}</label><input id="gname" maxlength="40" value="${esc(name)}" autocomplete="given-name" aria-describedby="gname-h">
      <p class="small muted" id="gname-h" style="margin:-6px 0 0">${esc(tt('Это имя увидят другие игроки.', 'Other players will see this name.'))}</p>
      ${cols.length ? `<label class="field" for="gsrc">${esc(tt('Какие карты', 'Which cards'))}</label><select id="gsrc"><option value="">${esc(tt('Вся галерея', 'The whole gallery'))}</option>${cols.map((c) => `<option value="${esc(String(c.id))}" ${pre === String(c.id) ? 'selected' : ''}>${esc(c.favorites ? tt('Избранное', 'Favourites') : c.title)} · ${c.codes.length}</option>`).join('')}</select>` : ''}
      <p class="form-error" id="gerr" role="alert"></p>
      <button class="btn yellow big" type="submit">${esc(from ? tt('Предложить участникам', 'Suggest to the players') : tt('Создать комнату', 'Create a room'))}</button>
      <a class="small" href="${u('/group' + (from ? '?from=' + encodeURIComponent(from) : ''))}">${esc(tt('Выбрать другую игру', 'Choose another game'))}</a>
    </form></div>`;
  ctx.main.querySelector('#gcreate').addEventListener('submit', async (e) => {
    e.preventDefault(); const b = e.target.querySelector('[type=submit]');
    const n = ctx.main.querySelector('#gname').value.trim();
    if (!n) { ctx.main.querySelector('#gerr').textContent = tt('Напишите имя — его увидят друзья.', 'Enter your name — your friends will see it.'); ctx.main.querySelector('#gname').focus(); return; }
    storage.set('dc_live_name', n); b.disabled = true;
    const src = ctx.main.querySelector('#gsrc'); const col = src && src.value ? cols.find((c) => String(c.id) === src.value) : null;
    try { const r = await api('/api/group', { method: 'POST', body: { format: picked.key, deviceId: visitorId(), name: n, codes: col ? col.codes : undefined, from: from || undefined } }); if (from && r.offerError) toast(errorText({ code: r.offerError })); ctx.navigate('/g/' + r.code); }
    catch (x) { b.disabled = false; ctx.main.querySelector('#gerr').textContent = errorText(x); }
  });
}

// ---------- комната ----------
export async function room(ctx, code) {
  const dev = visitorId();
  loading(ctx.main);
  let s; let skew = 0;
  const load = async () => { s = await api(`/api/group/${encodeURIComponent(code)}/state?device=${encodeURIComponent(dev)}`); skew = clock(s.serverNow); };
  try { await load(); } catch (e) {
    if (e.status === 404) { ctx.main.innerHTML = `<div class="wrap page narrow"><p class="empty">${esc(tt('Игра не найдена. Проверьте код или откройте новую.', 'Game not found. Check the code or open a new one.'))}</p><a class="btn" href="${u('/group')}">${esc(tt('Играть компанией', 'Play with friends'))}</a></div>`; return; }
    return failed(ctx.main, e, ctx.rerender);
  }
  if (!ctx.alive()) return;
  if (ONLINE_KEYS.includes(s.format)) return onlineRoom(ctx, code, s); // онлайн-игры — свои экраны
  const ui = { preview: null, slot: null, busy: false, text: '', found: {}, showSign: false, list: null, open: {}, change: false, step: null };
  let tick = null; const fired = new Set(); let lastRecall = s.recallAt || null;
  const f = F(s.format);
  const url = shareLink('/g/' + s.code);
  const refresh = async () => { try { await load(); if (ctx.alive()) draw(); } catch { /* */ } };
  subscribe(`/api/group/${s.code}/events`, refresh, ctx.alive);
  const act = async (action, body = {}) => {
    ui.busy = true; draw();
    try { await api(`/api/group/${s.code}/act`, { method: 'POST', body: { deviceId: dev, action, ...body } }); } catch (x) { toast(errorText(x)); }
    ui.busy = false; await refresh();
  };
  const hostBtn = (action, label, cls = 'yellow') => (s.host ? `<button class="btn ${cls}" type="button" data-act="${action}" ${ui.busy ? 'disabled' : ''}>${esc(label)}</button>` : '');
  const waitHost = (what) => (s.host ? '' : `<p class="small muted" style="margin:0">${esc(tt(`${what} — ведущий: ${s.hostName}`, `${what} — host: ${s.hostName}`))}</p>`);
  // Нажатие на карту — свой просмотр на этом телефоне (общую карту у других не меняет). Размеры заданы — карта не прыгает при загрузке.
  const bigCard = (c, big = false) => (c ? `<button type="button" class="live-card-btn" data-zoom="${esc(c.code)}" aria-label="${esc(tt('Рассмотреть карту', 'View card'))} ${esc(c.code)}"><img class="live-card${big ? ' xl' : ''}" src="${esc(big ? (c.full || c.thumb) : c.thumb)}" alt="${esc(c.code)}" width="${c.width || 910}" height="${c.height || 1560}"></button>` : '');
  const cardsBy = new Map();
  const remember = (c) => { if (c) cardsBy.set(c.code, c); return c; };
  const invite = (open = false) => `<details class="card-ui flat" ${open ? 'open' : ''}><summary><b>${esc(tt('Пригласить друзей', 'Invite friends'))}</b> · ${esc(tt('код', 'code'))} <span class="g-code">${esc(s.code)}</span></summary>
      <div class="stack" style="justify-items:center;margin-top:10px"><img class="g-qr" src="${u('/api/group/' + s.code + '/qr.png?size=500')}" alt="${esc(tt('QR-код для входа', 'QR code to join'))}" width="240" height="240">
      <input type="text" readonly value="${esc(url)}" id="gurl" aria-label="${esc(tt('Ссылка для друзей', 'Link for friends'))}" style="width:100%"></div></details>`;
  const people = () => `<p class="small muted" style="margin:0">${esc(tt('В игре', 'Playing'))}: ${s.members.map((m) => esc(m.name)).join(', ')}</p>`;

  function body() {
    if (s.status === 'ended') return `<h1>${esc(tt('Игра закончена', 'The game is over'))}</h1><p class="lead">${esc(tt('Спасибо за разговор!', 'Thank you for the conversation!'))}</p>
      ${offerHtml(ui.offerHidden ? null : s, (k) => fTitle(F(k)))}
      <div class="on-next"><a class="btn on-calm" href="${u('/group' + (s.me ? '?from=' + s.code : ''))}">${esc(tt('Выбрать следующую игру', 'Choose the next game'))}</a></div>
      ${s.me ? `<p class="small muted" style="margin:0">${esc(tt('Участники этой игры увидят предложение и сами решат, присоединиться ли.', 'Players of this game will see the suggestion and decide for themselves whether to join.'))}</p>` : ''}`;
    if (!s.me) return `<p class="lead">${esc(fDesc(f))}</p><form class="form" id="gj"><label class="field" for="gjn">${esc(tt('Ваше имя', 'Your name'))}</label><input id="gjn" maxlength="40" required value="${esc(storage.get('dc_live_name') || '')}" aria-describedby="gjn-h"><p class="small muted" id="gjn-h" style="margin:0">${esc(tt('Это имя увидят другие игроки.', 'Other players will see this name.'))}</p><p class="form-error" id="gjerr" role="alert"></p><button class="btn yellow wide big" type="submit">${esc(tt('Войти в игру', 'Join the game'))}</button></form>${people()}`;
    if (s.status === 'lobby') return `<p class="lead">${esc(fDesc(f))}</p>${invite(s.host)}${people()}
      <div class="card-ui flat"><b>${esc(tt('Договорённости', 'Agreements'))}</b><ul class="g-rules">${RULES().map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>
      ${(s.format === 'friend' && s.members.length < 2 ? (s.host ? `<button class="btn yellow" type="button" disabled>${esc(tt('Нужно хотя бы двое — пригласите друзей', 'At least two needed — invite friends'))}</button>` : '') : hostBtn('start', tt('Все здесь — начать', 'Everyone is here — start')))}${waitHost(tt('Ждём начала', 'Waiting to start'))}`;
    const fmt = s.format;
    if (fmt === 'pairs') return pairsBody();
    if (fmt === 'one') { remember(s.card); return `${bigCard(s.card)}<p class="lead">${esc(tt('По очереди расскажите, что вы заметили первым и о чём вам напоминает карта.', 'In turns, tell what you noticed first and what the card reminds you of.'))}</p>${circleHtml(ui.open.circle)}${hostBtn('next_card', tt('Другая карта', 'Another card'), 'light')}`; }
    if (fmt === 'story') {
      const cs = s.cards || []; cs.forEach(remember); const last = cs[cs.length - 1];
      return `${cs.length > 1 ? `<div class="g-strip">${cs.slice(0, -1).map((c) => `<button type="button" class="live-card-btn" data-zoom="${esc(c.code)}" aria-label="${esc(tt('Рассмотреть карту', 'View card'))} ${esc(c.code)}"><img src="${esc(c.thumb)}" alt="" width="54" height="93"></button>`).join('')}</div>` : ''}${bigCard(last)}
        <p class="lead">${esc(cs.length === 1 ? tt('Начните историю одной-двумя фразами — с того, что на карте.', 'Start the story in a sentence or two — from what is on the card.') : tt('Продолжите историю, глядя на новую карту.', 'Continue the story, looking at the new card.'))}</p>
        <div class="row">${hostBtn('next_card', tt('Следующая карта', 'Next card'))}${hostBtn('again', tt('Новая история', 'New story'), 'light')}</div>`;
    }
    if (fmt === 'question') {
      remember(s.card);
      if (s.phase === 'deal') return `${bigCard(s.card)}<div class="card-ui"><p class="small muted" style="margin:0">${esc(tt('Ваш вопрос', 'Your question'))}</p><p class="g-question">${esc(s.question || tt('Вам вопрос не достался — послушайте других.', 'No question for you this time — listen to the others.'))}</p></div>
        <p class="small muted">${esc(tt('Ответьте, если хотите, — или скажите «пас».', 'Answer if you wish — or say “pass”.'))}</p>${hostBtn('again', tt('Новая карта', 'New card'))}`;
      return `${bigCard(s.card)}<p class="lead">${esc(tt('Какой вопрос задала бы эта карта? Напишите его — потом вопросы перемешаются.', 'What question would this card ask? Write it — then the questions are shuffled.'))}</p>
        <form class="form" id="gq"><label class="sr-only" for="gqt">${esc(tt('Вопрос', 'Question'))}</label><textarea id="gqt" maxlength="300" placeholder="${esc(tt('Вопрос от карты…', 'A question from the card…'))}">${esc(ui.text || s.myText || '')}</textarea><button class="btn light" type="submit">${esc(s.myText ? tt('Изменить вопрос', 'Change question') : tt('Готово', 'Done'))}</button></form>
        <p class="live-count">${esc(tt(`Написали: ${s.written} из ${s.members.length}`, `Written: ${s.written} of ${s.members.length}`))}</p>${hostBtn('reveal', tt('Раздать вопросы', 'Deal the questions'))}${waitHost(tt('Вопросы раздаст', 'Questions will be dealt by'))}`;
    }
    // own / guess / friend
    if (s.phase === 'pick') {
      if (s.gallery) s.gallery.forEach(remember);
      const head = fmt === 'friend' ? tt(`Выберите карту для: ${s.target}`, `Choose a card for: ${s.target}`) : tt('Выберите карту, которая откликается вам сейчас', 'Choose a card that speaks to you now');
      const all = s.members.length && s.members.every((m) => (s.ready || []).includes(m.id));
      // ведущий видит, кто уже выбрал (без самих карт), и открывает набор, когда выбрали все
      const ready = `<ul class="g-ready" aria-live="polite">${s.members.map((m) => { const ok = (s.ready || []).includes(m.id); return `<li class="${ok ? 'ok' : ''}">${ok ? ic.check : '<span class="dot" aria-hidden="true"></span>'}<span>${esc(m.name)}</span><span class="sr-only">${esc(ok ? tt('выбрал(а)', 'has chosen') : tt('выбирает', 'choosing'))}</span></li>`; }).join('')}</ul>`;
      const hostCtl = s.host ? `${all ? hostBtn('reveal', tt('Все выбрали — открыть карты', 'Everyone has chosen — reveal the cards')) : `<button class="btn light" type="button" disabled data-act-wait>${esc(tt(`Ждём выбора: ${s.picked} из ${s.members.length}`, `Waiting: ${s.picked} of ${s.members.length}`))}</button>`}
        ${!all && s.picked ? `<button class="linkbtn small" type="button" data-force>${esc(tt('Кто-то не может выбрать? Открыть уже выбранные', 'Someone cannot choose? Reveal the chosen ones'))}</button>` : ''}` : '';
      if (s.myCard && !ui.change) {
        return `<h2 class="g-h">${esc(tt('Ваш выбор принят', 'Your choice is saved'))}</h2>
          <div class="live-chosen"><img src="${esc(s.myCard.thumb)}" alt="" width="54" height="93"><span>${ic.check} ${esc(tt('Карта выбрана. Никому её не показывайте — карты откроются для всех вместе.', 'Card chosen. Do not show it to anyone — the cards open for everyone together.'))}</span></div>
          <button class="linkbtn small" type="button" data-change>${esc(tt('Поменять выбор', 'Change my choice'))}</button>
          <p class="live-count">${esc(all ? tt('Все выбрали — ведущий сейчас откроет карты.', 'Everyone has chosen — the host will reveal the cards.') : tt(`Ждём остальных: выбрали ${s.picked} из ${s.members.length}`, `Waiting for the others: ${s.picked} of ${s.members.length} have chosen`))}</p>
          ${ready}${hostCtl}${waitHost(tt('Карты откроет', 'The cards will be revealed by'))}`;
      }
      return `<h2 class="g-h">${esc(head)}</h2><p class="small muted" style="margin:0">${esc(tt('Никому не показывайте — карты откроются, когда ведущий откроет их для всех.', 'Do not show anyone — the cards open when the host reveals them for everyone.'))}</p>
        <p class="live-count" aria-live="polite">${esc(tt(`Выбрали: ${s.picked} из ${s.members.length}`, `Chosen: ${s.picked} of ${s.members.length}`))}</p>
        <div class="live-grid">${(s.gallery || []).map((c) => `<button type="button" class="live-tile" data-pick="${esc(c.code)}" aria-label="${esc(c.code)}"><img src="${esc(c.thumb)}" alt="" loading="lazy" width="${c.width || 910}" height="${c.height || 1560}">${s.myCard && s.myCard.code === c.code ? `<span class="lt-mark">${ic.check}</span>` : ''}</button>`).join('')}</div>
        ${s.host ? ready + hostCtl : ''}${previewHtml()}`;
    }
    if (s.phase === 'show') {
      (s.shown || []).forEach((x) => remember(x.card));
      const mineShown = s.me && (s.shown || []).find((x) => x.id === s.me.id);
      const spot = fmt === 'own' && s.spot;
      const spotHtml = spot ? `<div class="g-spot" role="region" aria-label="${esc(tt('Общий показ', 'Shared view'))}"><p class="eyebrow">${esc(tt('Показывает всем', 'Showing to everyone'))}: <b>${esc(spot.name)}</b></p>${bigCard(spot.card, true)}
        ${s.me && (spot.id === s.me.id || s.host) ? `<button class="btn light sm" type="button" data-unspot>${esc(spot.id === s.me.id ? tt('Закончить показ', 'Stop showing') : tt('Снять показ', 'Clear the view'))}</button>` : ''}</div>` : '';
      const spotBtn = fmt === 'own' && mineShown && !spot ? `<button class="btn yellow" type="button" data-spot ${ui.busy ? 'disabled' : ''}>${esc(tt('Показать мою работу всем', 'Show my card to everyone'))}</button>` : '';
      return `<h2 class="g-h">${esc(fmt === 'friend' ? tt('Карты друг для друга', 'Cards for each other') : tt('Карты открыты', 'The cards are open'))}</h2>
        <p class="lead">${esc(fmt === 'friend' ? tt('По очереди: «Я выбрал для тебя эту, потому что…». Тот, кому карта, отвечает — совпало ли. Можно сказать «мне не откликается».', 'In turns: “I chose this one for you because…”. The person it is for answers whether it fits. “It doesn’t speak to me” is fine too.') : tt('По очереди расскажите о своём выборе. Остальные могут задать по одному вопросу — без советов.', 'In turns, talk about your choice. The others may ask one question each — no advice.'))}</p>
        ${spotHtml}${spotBtn}
        <div class="g-shown">${(s.shown || []).map((x) => `<figure>${bigCard(x.card)}<figcaption>${fmt === 'friend' ? `${esc(tt('Для', 'For'))} <b>${esc(x.for)}</b> · ${esc(tt('от', 'from'))} ${esc(x.name)}` : `<b>${esc(x.name)}</b>`}</figcaption></figure>`).join('')}</div>
        ${fmt === 'own' ? circleHtml(ui.open.circle) : ''}${hostBtn('again', tt('Ещё круг', 'Another round'))}`;
    }
    if (s.phase === 'guess') {
      remember(s.current);
      return `<p class="eyebrow">${esc(tt(`Карта ${s.index + 1} из ${s.total}`, `Card ${s.index + 1} of ${s.total}`))}</p>${bigCard(s.current)}
        <h2 class="g-h">${s.revealed ? `${esc(tt('Это карта', 'This is the card of'))}: <span class="g-author">${esc(s.author)}</span>` : esc(tt('Чья это карта?', 'Whose card is it?'))}</h2>
        <p class="small muted" style="margin:0">${esc(s.revealed ? tt('Расскажите, почему выбрали её.', 'Tell us why you chose it.') : tt('Угадайте вслух — потом ведущий откроет ответ.', 'Guess out loud — then the host reveals the answer.'))}</p>
        ${s.revealed ? hostBtn('next', s.index + 1 >= s.total ? tt('Показать все карты', 'Show all cards') : tt('Следующая карта', 'Next card')) : hostBtn('reveal', tt('Открыть, кто выбрал', 'Reveal who chose it'))}`;
    }
    if (s.phase === 'done') {
      (s.shown || []).forEach((x) => remember(x.card));
      return `<h2 class="g-h">${esc(tt('Все карты', 'All cards'))}</h2><div class="g-shown">${(s.shown || []).map((x) => `<figure>${bigCard(x.card)}<figcaption><b>${esc(x.name)}</b></figcaption></figure>`).join('')}</div>${hostBtn('again', tt('Ещё круг', 'Another round'))}`;
    }
    return '<p class="muted">…</p>';
  }

  // ---------- «Разговор в парах» ----------
  const pairLists = () => (QUESTION_FORMATS.find((x) => x.key === 'pair') || {}).lists || [];
  const qItems = (k) => { const l = pairLists().find((x) => x.key === k); return l ? (l.items[lang] || l.items.ru) : []; };
  const qTitle = (k) => { const l = pairLists().find((x) => x.key === k); return l ? (l.title[lang] || l.title.ru) : ''; };
  function hostBar() {
    if (!s.host) return '';
    const p = s.progress || {};
    let inner = '';
    if (s.phase === 'holders') inner = `<span>${esc(tt(`Выбрали карты: ${p.holdersDone} из ${p.holders}`, `Cards chosen: ${p.holdersDone} of ${p.holders}`))}</span>${hostBtn('advance', tt('Дальше, не дожидаясь', 'Continue without waiting'), 'light sm')}`;
    else if (s.phase === 'listeners') inner = `<span>${esc(tt(`Собеседники: ${p.listenersDone} из ${p.listeners}`, `Partners: ${p.listenersDone} of ${p.listeners}`))}</span>${hostBtn('advance', tt('Распределить оставшихся', 'Assign the rest'), 'light sm')}`;
    else if (s.phase === 'pairs') inner = `<label class="small">${esc(tt('минут', 'minutes'))} <input type="number" id="gmin" min="1" max="90" value="${s.minutes}" style="width:4.5em"></label>${hostBtn('talk', tt('Все нашлись — начать разговор', 'Everyone found — start talking'), 'yellow sm')}`;
    else if (s.phase === 'talk') inner = `${hostBtn('add_time', tt('+5 минут', '+5 minutes'), 'light sm')}${hostBtn('end_round', tt('Завершить раунд', 'End the round'), 'light sm')}`;
    else if (s.phase === 'break') inner = `${hostBtn('recall', tt('Позвать всех', 'Call everyone'), 'light sm')}${hostBtn('again', tt('Следующий раунд', 'Next round'), 'yellow sm')}`;
    return `<div class="g-hostbar"><b>${esc(tt('Вы ведущий', 'You are the host'))}</b>${inner}</div>`;
  }
  function pairsBody() {
    const recall = s.recallAt && s.phase === 'break' ? `<div class="live-recall" role="alert">${ic.bell}<span>${esc(tt('Через минуту начинаем следующий раунд — соберёмся вместе.', 'The next round starts in a minute — let’s gather.'))}</span></div>` : '';
    const snd = soundsReady() ? '' : `<button class="btn light sm" type="button" data-sound>${ic.bell} ${esc(tt('Включить звуковые сигналы', 'Turn on sound signals'))}</button>`;
    const round = `<p class="eyebrow">${esc(tt(`Раунд ${s.step}`, `Round ${s.step}`))}</p>`;
    if (!s.role) return `${hostBar()}${round}<p class="lead">${esc(tt('Вы присоединитесь со следующего раунда.', 'You will join from the next round.'))}</p>`;
    if (s.phase === 'holders') {
      if (s.role !== 'holder') return `${hostBar()}${round}<h2 class="g-h">${esc(tt('Вы — собеседник', 'You are the partner'))}</h2><p class="lead">${esc(tt('Сейчас карты выбирают держатели. Потом вы выберете одну из их карт — так сложится пара.', 'The holders are choosing cards. Then you pick one of their cards — that forms your pair.'))}</p>${snd}`;
      (s.gallery || []).forEach(remember);
      return `${hostBar()}${round}<h2 class="g-h">${esc(tt('Вы выбираете карту', 'You choose a card'))}</h2><p class="small muted" style="margin:0">${esc(tt('Выберите ту, что откликается вам, и никому её не показывайте.', 'Pick the one that speaks to you and do not show anyone.'))}</p>
        ${s.myCard ? `<div class="live-chosen"><img src="${esc(s.myCard.thumb)}" alt=""><span>${ic.check} ${esc(tt('Выбрано — можно поменять', 'Chosen — you can change it'))}</span></div>` : ''}
        <div class="live-grid">${(s.gallery || []).map((c) => `<button type="button" class="live-tile" data-pick="${esc(c.code)}" aria-label="${esc(c.code)}"><img src="${esc(c.thumb)}" alt="" loading="lazy">${s.myCard && s.myCard.code === c.code ? `<span class="lt-mark">${ic.check}</span>` : ''}</button>`).join('')}</div>${previewHtml()}${snd}`;
    }
    if (s.phase === 'listeners') {
      if (s.role !== 'listener') return `${hostBar()}${round}<h2 class="g-h">${esc(tt('Ваша карта выбрана', 'Your card is chosen'))}</h2>${s.myCard ? `<img class="live-card" src="${esc(s.myCard.thumb)}" alt="">` : ''}<p class="lead">${esc(tt('Собеседники выбирают карты — скоро вы увидите знак своей пары.', 'Partners are choosing — you will see your pair sign soon.'))}</p>`;
      if (s.myCard) return `${hostBar()}${round}<h2 class="g-h">${esc(tt('Карта выбрана', 'Card chosen'))}</h2><p class="lead">${esc(tt('Ждём остальных — сейчас появится знак пары.', 'Waiting for the others — your pair sign will appear.'))}</p>`;
      (s.slots || []).forEach((x) => remember(x.card));
      return `${hostBar()}${round}<h2 class="g-h">${esc(tt('Выберите карту', 'Choose a card'))}</h2><p class="small muted" style="margin:0">${esc(tt('Это карты, которые выбрали держатели. Кто выбрал карту — ваш собеседник. Занятые карты недоступны.', 'These are the holders’ cards. Whoever chose it is your partner. Taken cards are unavailable.'))}</p>
        <div class="live-grid">${(s.slots || []).map((x) => `<button type="button" class="live-tile" data-slot="${x.id}" data-code="${esc(x.card.code)}" ${x.taken ? 'disabled aria-disabled="true"' : ''}><img src="${esc(x.card.thumb)}" alt="">${x.taken ? `<span class="lt-taken">${esc(tt('занята', 'taken'))}</span>` : ''}</button>`).join('')}</div>${previewHtml()}`;
    }
    // пары, разговор, перерыв
    if (!s.pair) return `${hostBar()}${recall}<p class="lead">${esc(tt('В этом раунде у вас нет пары — присоединитесь к любой паре третьим.', 'You have no pair this round — join any pair as a third.'))}</p>`;
    const names = s.pair.partners.join(tt(' и ', ' and '));
    if (s.phase !== 'break' && (!ui.found[s.step] || ui.showSign)) {
      return `<div class="live-sign">${signHtml(s.pair.sign)}<div class="ls-text"><b>${esc(tt('Найдите человека с таким же знаком', 'Find the person with the same sign'))}</b><span>${esc(s.pair.partners.length > 1 ? tt('Ваши собеседники', 'Your partners') : tt('Ваш собеседник', 'Your partner'))}: ${esc(names)}</span></div>
        <button class="btn yellow big wide" type="button" data-found>${esc(ui.found[s.step] ? tt('К вопросам', 'To the questions') : tt('Мы нашли друг друга', 'We found each other'))}</button></div>`;
    }
    remember(s.myCard);
    const holder = s.role === 'holder'; const mk = holder ? 'holder' : 'partner'; const cur = ui.list || mk;
    const time = s.phase === 'talk' ? `<div class="live-timer" data-timer>${esc(mmss(left(s.talkEndsAt, skew)))}</div>` : s.phase === 'break' ? `<div class="live-timer done">${esc(tt('Раунд закончен', 'Round over'))}</div>` : `<div class="live-timer wait">${esc(tt('Ведущий скоро запустит время', 'The host will start the timer soon'))}</div>`;
    return `${hostBar()}${recall}<div class="live-talk-head">${time}<button class="sign-btn" type="button" data-sign aria-label="${esc(tt('Показать знак пары', 'Show pair sign'))}">${signHtml(s.pair.sign, { big: false })}</button></div>
      <p class="small muted" style="margin:0">${esc(s.pair.partners.length > 1 ? tt('Собеседники', 'Partners') : tt('Собеседник', 'Partner'))}: <b>${esc(names)}</b></p>
      ${bigCard(s.myCard)}
      <p class="lead live-role">${esc(holder ? tt('Вы выбрали эту карту первым. Расскажите, почему она привлекла ваше внимание, потом спросите собеседника.', 'You chose this card first. Tell why it caught your attention, then ask your partner.') : tt('Сначала послушайте, почему собеседника привлекла эта карта, и задавайте вопросы.', 'First listen to why the card caught your partner’s attention, and ask questions.'))}</p>
      <div class="qtabs" role="tablist">${['partner', 'holder'].map((k) => `<button type="button" role="tab" aria-selected="${k === cur}" data-list="${k}">${esc(qTitle(k))}${k === mk ? ` · ${esc(tt('вы', 'you'))}` : ''}</button>`).join('')}</div>
      <ul class="qlist">${qItems(cur).map((q) => `<li>${esc(q)}</li>`).join('')}</ul>${snd}`;
  }
  function runTimer() {
    clearInterval(tick);
    if (s.format !== 'pairs' || s.phase !== 'talk' || !s.talkEndsAt) return;
    const step = () => { if (!ctx.alive()) { clearInterval(tick); return; } const ms = left(s.talkEndsAt, skew); const el = ctx.main.querySelector('[data-timer]'); if (el) el.textContent = mmss(ms); bellsFor(s.id, s.step, ms, fired); if (ms <= 0) { clearInterval(tick); setTimeout(refresh, 1500); } };
    step(); tick = setInterval(step, 1000);
  }
  function previewHtml() {
    const c = ui.preview && cardsBy.get(ui.preview); if (!c) return '';
    return `<div class="live-preview" role="dialog" aria-modal="true" aria-label="${esc(tt('Карта', 'Card'))}"><div class="lp-in"><img src="${esc(c.full || c.thumb)}" alt="${esc(c.code)}">
      <div class="lp-acts"><button class="btn light" type="button" data-pv-close>${esc(tt('Назад', 'Back'))}</button><button class="btn yellow" type="button" data-pv-ok ${ui.busy ? 'disabled' : ''}>${esc(tt('Выбрать эту карту', 'Choose this card'))}</button></div></div></div>`;
  }
  let root = null; let lastHtml = '';
  function draw() {
    if (s.recallAt && s.recallAt !== lastRecall) { lastRecall = s.recallAt; play('gather'); }
    if (ui.step !== s.step) { ui.step = s.step; ui.change = false; } // новый круг — новый выбор
    if (s.phase !== 'pick') ui.change = false;
    if (!root || !ctx.main.contains(root)) { ctx.main.innerHTML = '<div class="live" id="groot"></div>'; root = ctx.main.querySelector('#groot'); lastHtml = ''; }
    const html = `<div class="live-in">
      <p class="eyebrow">${esc(tt('Играть компанией', 'Play with friends'))} · ${esc(fTitle(f))}</p>
      ${s.status !== 'ended' ? offerHtml(ui.offerHidden ? null : s, (k) => fTitle(F(k))) : ''}${body()}
      ${s.me && s.status !== 'ended' && s.status !== 'lobby' ? invite() : ''}
      ${s.me && s.status !== 'ended' ? `<div class="row between">${s.host ? `<button class="linkbtn" type="button" data-end>${esc(tt('Завершить игру', 'End the game'))}</button>` : `<button class="linkbtn" type="button" data-leave>${esc(tt('Выйти', 'Leave'))}</button>`}</div>` : ''}
    </div>`;
    // перерисовываем только то, что изменилось: без мигания при каждом обновлении и при новом круге
    if (html !== lastHtml) { morph(root, html); lastHtml = html; wire(); }
    runTimer();
  }
  function wire() {
    const $ = (q) => ctx.main.querySelector(q);
    wireOffer(root, s, ctx.navigate, () => { ui.offerHidden = true; lastHtml = ''; draw(); });
    root.querySelectorAll('details[data-k]').forEach((d) => listen(d, 'toggle', () => { ui.open[d.dataset.k] = d.open; lastHtml = ''; }));
    const ch = $('[data-change]'); if (ch) ch.onclick = () => { ui.change = true; draw(); };
    const fo = $('[data-force]'); if (fo) fo.onclick = () => { if (confirm(tt('Открыть карты тех, кто уже выбрал? Остальные увидят их без своей.', 'Reveal the cards of those who have chosen? The others will see them without theirs.'))) act('reveal', { force: true }); };
    const sp = $('[data-spot]'); if (sp) sp.onclick = () => act('spot', { on: true });
    const us = $('[data-unspot]'); if (us) us.onclick = () => act('spot', { on: false });
    ctx.main.querySelectorAll('[data-act]').forEach((b) => listen(b, 'click', () => { if (s.format === 'pairs') unlockSound(); const a = b.dataset.act; act(a, a === 'talk' ? { minutes: Number(($('#gmin') || {}).value) || s.minutes } : {}); }));
    const gj = $('#gj');
    if (gj) gj.onsubmit = async (e) => { e.preventDefault(); if (s.format === 'pairs') unlockSound(); keepAwake(true); const n = $('#gjn').value.trim(); if (!n) return; storage.set('dc_live_name', n); try { await api(`/api/group/${s.code}/join`, { method: 'POST', body: { deviceId: dev, name: n } }); await refresh(); } catch (x) { $('#gjerr').textContent = errorText(x); } };
    const gq = $('#gq');
    if (gq) { listen(gq.gqt, 'input', () => { ui.text = gq.gqt.value; }); gq.onsubmit = async (e) => { e.preventDefault(); const t = gq.gqt.value.trim(); if (!t) return; await act('write', { text: t }); ui.text = ''; toast(tt('Вопрос принят', 'Question saved')); }; }
    ctx.main.querySelectorAll('[data-pick]').forEach((b) => b.onclick = () => { ui.preview = b.dataset.pick; draw(); });
    const pc = $('[data-pv-close]'); if (pc) { pc.onclick = () => { ui.preview = null; draw(); }; pc.focus(); }
    const po = $('[data-pv-ok]'); if (po) po.onclick = async () => { const code0 = ui.preview; const slot = ui.slot; ui.preview = null; ui.slot = null; ui.change = false; if (slot) await act('partner', { slotId: slot }); else await act('pick', { code: code0 }); };
    ctx.main.querySelectorAll('[data-slot]:not([disabled])').forEach((b) => b.onclick = () => { unlockSound(); ui.preview = b.dataset.code; ui.slot = Number(b.dataset.slot); draw(); });
    const fd = $('[data-found]'); if (fd) fd.onclick = () => { ui.found[s.step] = true; ui.showSign = false; draw(); window.scrollTo(0, 0); };
    const sg = $('[data-sign]'); if (sg) sg.onclick = () => { ui.showSign = true; draw(); };
    ctx.main.querySelectorAll('[data-list]').forEach((b) => b.onclick = () => { ui.list = b.dataset.list; draw(); });
    const sd = $('[data-sound]'); if (sd) sd.onclick = () => { unlockSound(); setTimeout(draw, 300); };
    ctx.main.querySelectorAll('[data-zoom]').forEach((b) => b.onclick = () => { const c = cardsBy.get(b.dataset.zoom); if (c) openViewer({ cards: [c], index: 0, mode: 'admin', simple: true }); });
    const gu = $('#gurl'); if (gu) listen(gu, 'focus', () => gu.select());
    const en = $('[data-end]'); if (en) en.onclick = () => { if (confirm(tt('Завершить игру для всех?', 'End the game for everyone?'))) act('end'); };
    const lv = $('[data-leave]'); if (lv) lv.onclick = async () => { await api(`/api/group/${s.code}/leave`, { method: 'POST', body: { deviceId: dev } }).catch(() => {}); ctx.navigate('/group'); };
  }
  draw();
}

// ---------- «Играть одному»: История из трёх карт ----------
// Без регистрации, комнаты и QR (21.11.2026 — по тестированию). На каждом шаге: карта (стрелки и свайп листают галерею
// внутри шага), вопрос и поле для своего фрагмента истории. Записи и карты хранятся в sessionStorage — переходы между
// шагами, просмотр карты и перезагрузка их не теряют; к прежним шагам можно вернуться и поправить. В финале — три карты
// и три фрагмента по порядку, «Поделиться» (картинка с картами и текстом + подпись и ссылка) и «Сыграть ещё».
const SOLO_KEY = 'dc_solo_story3';
const SOLO_STEPS = () => [
  tt('Первая карта помогает начать историю. Кто здесь? Где это происходит? С чего всё началось?', 'The first card helps start the story. Who is here? Where is it happening? How did it begin?'),
  tt('Вторая карта меняет ход истории. Что случилось неожиданно? Что изменилось?', 'The second card changes the course of the story. What happened unexpectedly? What changed?'),
  tt('Третья карта помогает закончить историю. Чем всё завершилось? С чем остался герой?', 'The third card helps end the story. How did it all end? What is the hero left with?'),
];
function growArea(t) {
  const fit = () => { t.style.height = 'auto'; const cs = getComputedStyle(t); const bd = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth); t.style.height = `${Math.ceil(t.scrollHeight + bd)}px`; };
  t.addEventListener('input', fit); requestAnimationFrame(fit);
}
/** Картинка для отправки: три карты рядом и три фрагмента целиком (высота — по тексту). */
async function storyImage(cs, texts) {
  const W = 1080; const pad = 60; const gap = 24; const cw = Math.floor((W - pad * 2 - gap * 2) / 3); const ch = Math.round(cw * 1560 / 910);
  const imgs = await Promise.all(cs.map((c) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = c.full || c.thumb; })));
  try { await Promise.all([document.fonts.load('800 50px Rubik'), document.fonts.load('400 36px Onest')]); } catch { /* */ }
  const m = document.createElement('canvas').getContext('2d'); m.font = '400 36px Onest, sans-serif';
  const wrap = (s) => { const out = []; for (const para of String(s || '').split('\n')) { let cur = ''; for (const w of para.split(/\s+/).filter(Boolean)) { const t2 = cur ? `${cur} ${w}` : w; if (m.measureText(t2).width > W - pad * 2 - 60 && cur) { out.push(cur); cur = w; } else cur = t2; } out.push(cur); } return out; };
  const blocks = texts.map((t2) => wrap(t2.trim() || '—'));
  const H = pad + 70 + ch + 50 + blocks.reduce((s, b) => s + 60 + b.length * 48 + 20, 0) + 140;
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  x.fillStyle = '#060c1e'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#f1e6c8'; x.font = '800 50px Rubik, sans-serif'; x.textAlign = 'center'; x.fillText(tt('История из трёх карт', 'A story from three cards'), W / 2, pad + 46);
  let y = pad + 70;
  imgs.forEach((im, i) => { const cx = pad + i * (cw + gap); x.save(); x.beginPath(); (x.roundRect ? x.roundRect(cx, y, cw, ch, 18) : x.rect(cx, y, cw, ch)); x.clip(); if (im) x.drawImage(im, cx, y, cw, ch); x.restore(); });
  y += ch + 50; x.textAlign = 'left';
  blocks.forEach((b, i) => {
    x.fillStyle = '#f6c23c'; x.font = '600 30px Onest, sans-serif'; x.fillText(String(i + 1), pad, y + 34);
    x.fillStyle = '#f1e6c8'; x.font = '400 36px Onest, sans-serif'; let ty = y + 34; for (const l of b) { x.fillText(l, pad + 60, ty); ty += 48; }
    y += 60 + b.length * 48 + 20 - 26;
  });
  x.textAlign = 'center'; x.fillStyle = 'rgba(241,230,200,.75)'; x.font = '400 30px Onest, sans-serif'; x.fillText(tt('Dialogue Cards — повод для интересного разговора', 'Dialogue Cards — a reason for an interesting conversation'), W / 2, H - 70);
  return c;
}
export async function solo(ctx) { // «История из трёх карт» (/group/solo/story)
  loading(ctx.main);
  let cards;
  try { ({ cards } = await api('/api/cards')); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  const byCode = new Map(cards.map((c) => [c.code, c]));
  let st = null;
  try { st = JSON.parse(sessionStorage.getItem(SOLO_KEY) || 'null'); } catch { st = null; }
  if (!st || !Array.isArray(st.codes) || st.codes.some((c) => c && !byCode.has(c))) st = null;
  const save = () => { try { sessionStorage.setItem(SOLO_KEY, JSON.stringify(st)); } catch { /* без сохранения */ } };
  const deal = () => {
    const pool = cards.slice(); const codes = [];
    while (codes.length < 3 && pool.length) codes.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0].code);
    st = { codes, texts: ['', '', ''], step: 0, reached: 0 }; save();
  };
  if (!st) deal();
  const img = (c, cls = 'live-card') => `<button type="button" class="live-card-btn" data-zoom="${esc(c.code)}" aria-label="${esc(tt('Рассмотреть карту', 'View card'))} ${esc(c.code)}"><img class="${cls}" src="${esc(c.full || c.thumb)}" alt="${esc(c.code)}" width="${c.width || 910}" height="${c.height || 1560}"></button>`;
  let shareBlob = null;
  const draw = () => {
    let html;
    if (cards.length < 3) html = `<p class="empty">${esc(tt('Для игры нужно хотя бы три карты в галерее.', 'The game needs at least three cards in the gallery.'))}</p>`;
    else if (!st.step) {
      html = `<p class="lead">${esc(tt('Ты откроешь три разные карты, одну за другой, и сочинишь по ним историю.', 'You will open three different cards, one after another, and make up a story from them.'))}</p>
        <ol class="solo-steps">${SOLO_STEPS().map((t2) => `<li>${esc(t2)}</li>`).join('')}</ol>
        <button class="btn yellow big" type="button" data-go="1">${esc(tt('Открыть первую карту', 'Open the first card'))}</button>`;
    } else if (st.step <= 3) {
      const k = st.step - 1; const c = byCode.get(st.codes[k]);
      html = `<nav class="s3-steps" aria-label="${esc(tt('Шаги истории', 'Story steps'))}">${[1, 2, 3].map((n) => `<button type="button" class="${n === st.step ? 'on' : ''}" data-go="${n}" ${n > st.reached ? 'disabled' : ''} aria-current="${n === st.step ? 'step' : 'false'}">${n}</button>`).join('')}</nav>
        <div class="imag-carousel"><button class="icon-btn" type="button" data-flip="-1" aria-label="${esc(tt('Другая карта: предыдущая', 'Another card: previous'))}">${ic.chevronLeft}</button>
          <div class="imag-card" id="s3card">${img(c)}</div>
          <button class="icon-btn" type="button" data-flip="1" aria-label="${esc(tt('Другая карта: следующая', 'Another card: next'))}">${ic.chevronRight}</button></div>
        <p class="lead">${esc(SOLO_STEPS()[k])}</p>
        <label class="sr-only" for="s3t">${esc(tt(`Фрагмент истории ${st.step}`, `Story part ${st.step}`))}</label>
        <textarea id="s3t" class="s3-text" rows="2" maxlength="1200" placeholder="${esc(tt('Запиши свой фрагмент истории', 'Write your part of the story'))}">${esc(st.texts[k])}</textarea>
        <button class="btn yellow big" type="button" data-go="${st.step + 1}">${esc(st.step === 1 ? tt('Открыть вторую карту', 'Open the second card') : st.step === 2 ? tt('Открыть третью карту', 'Open the third card') : tt('Посмотреть историю', 'See the story'))}</button>`;
    } else {
      html = `<div class="s3-final">${st.codes.map((code, i) => `<div class="s3-part">${img(byCode.get(code), 'live-card s3-thumb')}<div><b>${i + 1}</b><p>${esc(st.texts[i] || '—')}</p><button class="link-btn small" type="button" data-go="${i + 1}">${esc(tt('Изменить', 'Edit'))}</button></div></div>`).join('')}</div>
        <button class="btn yellow big send-btn" type="button" data-share>${esc(tt('Поделиться', 'Share'))}</button>
        <p class="vb-note s3-hint" role="status"></p>
        <button class="btn light" type="button" data-again>${esc(tt('Сыграть ещё', 'Play again'))}</button>
        <a class="btn on-calm" href="${u('/group/solo')}">${esc(tt('Выбрать другую игру', 'Choose another game'))}</a>`;
    }
    ctx.main.querySelector('#solo').innerHTML = html;
    const ta = ctx.main.querySelector('#s3t');
    if (ta) { growArea(ta); ta.addEventListener('input', () => { st.texts[st.step - 1] = ta.value; save(); }); }
    const sc = ctx.main.querySelector('#s3card');
    if (sc) { let x0 = null; let y0 = 0; sc.style.touchAction = 'pan-y';
      sc.addEventListener('pointerdown', (e) => { x0 = e.clientX; y0 = e.clientY; });
      sc.addEventListener('pointerup', (e) => { if (x0 == null) return; const dx = e.clientX - x0; const dy = e.clientY - y0; x0 = null; if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3) { sc.dataset.swiped = '1'; flip(dx < 0 ? 1 : -1); } });
      sc.addEventListener('click', (e) => { if (sc.dataset.swiped) { e.stopPropagation(); e.preventDefault(); delete sc.dataset.swiped; } }, true); }
    if (st.step === 4) { shareBlob = null; storyImage(st.codes.map((c) => byCode.get(c)), st.texts).then((cv) => cv.toBlob((b) => { shareBlob = b; }, 'image/png')); }
  };
  // смена карты на текущем шаге — по порядку галереи, без повтора карт других шагов; текст фрагмента остаётся
  const flip = (d) => {
    const k = st.step - 1; const others = st.codes.filter((_, i) => i !== k); let i = cards.findIndex((c) => c.code === st.codes[k]);
    for (let n = 0; n < cards.length; n++) { i = (i + d + cards.length) % cards.length; if (!others.includes(cards[i].code)) break; }
    st.codes[k] = cards[i].code; save();
    const box = ctx.main.querySelector('#s3card'); if (box) box.innerHTML = img(cards[i]);
  };
  const shareText = () => `${tt('История из трёх карт', 'A story from three cards')}\n\n${st.texts.map((t2, i) => `${i + 1}. ${t2.trim() || '—'}`).join('\n')}\n\n${tt('Dialogue Cards — повод для интересного разговора', 'Dialogue Cards — a reason for an interesting conversation')}\n${shareLink('/group/solo/story')}`; // ссылка для других — на нейтральный dialogue.cards (CLAUDE.md п.5), не на адрес входа
  ctx.main.innerHTML = `<div class="live"><div class="live-in"><p class="eyebrow">${esc(tt('Играть одному', 'Play solo'))}</p><h1 style="margin:0">${esc(tt('История из трёх карт', 'A story from three cards'))}</h1><div class="live-in" id="solo" style="max-width:none"></div></div></div>`;
  ctx.main.querySelector('#solo').addEventListener('click', async (e) => {
    const go = e.target.closest('[data-go]'); if (go && !go.disabled) { st.step = Number(go.dataset.go); st.reached = Math.max(st.reached || 0, Math.min(3, st.step)); save(); draw(); window.scrollTo({ top: 0 }); return; }
    const fl = e.target.closest('[data-flip]'); if (fl) { flip(Number(fl.dataset.flip)); return; }
    if (e.target.closest('[data-again]')) { if (!confirm(tt('Начать новую историю? Эта история не сохранится.', 'Start a new story? This one will not be kept.'))) return; deal(); st.step = 1; st.reached = 1; save(); draw(); window.scrollTo({ top: 0 }); return; }
    if (e.target.closest('[data-share]')) {
      const hint = ctx.main.querySelector('.s3-hint');
      const blob = shareBlob || await new Promise((res) => storyImage(st.codes.map((c) => byCode.get(c)), st.texts).then((cv) => cv.toBlob(res, 'image/png')));
      const file = new File([blob], 'dialogue-cards-story.png', { type: 'image/png' });
      if (navigator.share) {
        try { if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], text: shareText() }); else await navigator.share({ text: shareText() }); return; }
        catch (x) { if (x && x.name === 'AbortError') return; }
      }
      // системной отправки нет — сохраняем картинку и копируем текст целиком
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
      let copied = false; try { await navigator.clipboard.writeText(shareText()); copied = true; } catch { /* */ }
      if (hint) hint.textContent = copied ? tt('Картинка скачана, текст истории скопирован — вставь его в сообщение.', 'The image was downloaded and the story text copied — paste it into your message.') : tt('Картинка скачана.', 'The image was downloaded.');
      return;
    }
    const z = e.target.closest('[data-zoom]');
    if (z) { const c = byCode.get(z.dataset.zoom); if (c) openViewer({ cards: [c], index: 0, mode: 'admin', simple: true }); }
  });
  draw();
}
