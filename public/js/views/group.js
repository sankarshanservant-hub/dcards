// «Играть компанией»: форматы для друзей без фасилитатора. Комната по QR/коду, каждый — со своего телефона.
import { lang } from '../i18n.js';
import { esc, tt, u, api, errorText, toast, visitorId, storage } from '../util.js';
import { ic, loading, failed } from '../ui.js';
import { openViewer } from '../viewer.js';
import { subscribe, signHtml, unlockSound, soundsReady, play, clock, left, mmss, bellsFor, keepAwake } from '../live-common.js';
import { QUESTION_FORMATS } from '../content.js';

export const GROUP_FORMATS = [
  { key: 'one', ru: 'Одна карта на всех', en: 'One card for everyone', dru: 'Все смотрят на одну карту и по кругу говорят, что заметили и о чём она напоминает. Самый простой формат.', den: 'Everyone looks at one card and takes turns saying what they notice and what it reminds them of. The simplest format.' },
  { key: 'own', ru: 'Каждому своя карта', en: 'A card for each', dru: 'Каждый тайно выбирает карту, которая откликается ему сейчас. Потом карты открываются, и все по очереди рассказывают, почему выбрали свою.', den: 'Everyone secretly picks a card that speaks to them now. Then the cards are revealed and each person says why they chose theirs.' },
  { key: 'guess', ru: 'Угадай, кто выбрал', en: 'Guess who chose it', dru: 'Все тайно выбирают карты, приложение показывает их по одной. Угадайте, чья это карта, — а потом хозяин расскажет, почему выбрал её.', den: 'Everyone secretly picks a card; the app shows them one by one. Guess whose card it is — then its owner tells why they chose it.' },
  { key: 'friend', ru: 'Карта для друга', en: 'A card for a friend', dru: 'Для близких друзей: каждому достаётся имя одного из компании — выберите карту, которая, по-вашему, подходит этому человеку.', den: 'For close friends: each person gets someone’s name — choose a card that you feel suits that person.' },
  { key: 'story', ru: 'История по кругу', en: 'A story in turns', dru: 'Открывается карта — первый начинает историю одной фразой. Следующая карта — следующий продолжает, вплетая то, что на ней.', den: 'A card is revealed — the first person starts a story in one sentence. Next card — the next person continues, weaving it in.' },
  { key: 'pairs', ru: 'Разговор в парах', en: 'Conversations in pairs', dru: 'Как на встрече Dialogue Flow: половина компании выбирает карты, остальные — из уже выбранных, так складываются пары. Поговорите минут 15, потом роли меняются. Ведущий — один из вас.', den: 'Like a Dialogue Flow meeting: half the group picks cards, the others choose from those — that is how pairs form. Talk for about 15 minutes, then swap roles. The host is one of you.' },
  { key: 'question', ru: 'Вопрос от карты', en: 'A question from the card', dru: 'Каждый пишет вопрос, который «задала бы эта карта». Вопросы перемешиваются — каждому достаётся чужой, на него можно ответить или сказать «пас».', den: 'Everyone writes a question “this card would ask”. Questions are shuffled — each gets someone else’s; answer it or say “pass”.' },
];
const F = (k) => GROUP_FORMATS.find((f) => f.key === k) || GROUP_FORMATS[0];
const fTitle = (f) => (lang === 'en' ? f.en : f.ru);
const fDesc = (f) => (lang === 'en' ? f.den : f.dru);
const RULES = () => [tt('Говорим по очереди и не перебиваем.', 'We speak in turns and do not interrupt.'), tt('Советы — только если о них просят.', 'Advice only if asked.'), tt('Можно сказать «пас» — объяснять не нужно.', 'You can say “pass” — no explanation needed.'), tt('Сказанное остаётся между нами.', 'What is said stays between us.')];
const CIRCLE = () => [tt('Что на карте первым привлекло ваше внимание?', 'What caught your attention first?'), tt('О чём она вам напоминает?', 'What does it remind you of?'), tt('Что из сказанного другими вас удивило?', 'What surprised you in what others said?'), tt('Что вы забираете с собой из этого разговора?', 'What are you taking away from this conversation?')];
const circleHtml = () => `<details class="about-df card-ui flat"><summary><span class="grow">${esc(tt('Подсказки для круга', 'Prompts for the circle'))}</span><span class="chev" aria-hidden="true">▾</span></summary><div class="about-body"><ul class="qlist">${CIRCLE().map((q) => `<li>${esc(q)}</li>`).join('')}</ul></div></details>`;

// ---------- выбор формата ----------
export function choose(ctx) {
  const name = storage.get('dc_live_name') || '';
  ctx.main.innerHTML = `<div class="wrap page narrow stack">
    <div class="page-head"><p class="eyebrow">Dialogue Cards</p><h1>${esc(tt('Играть компанией', 'Play with friends'))}</h1>
      <p class="sub">${esc(tt('Для друзей и семьи, от 2 до 20 человек. Один открывает игру и показывает QR, остальные заходят со своих телефонов. Регистрация не нужна.', 'For friends and family, 2 to 20 people. One person opens a game and shows the QR code; the others join from their phones. No sign-up needed.'))}</p></div>
    <label class="field" for="gname">${esc(tt('Ваше имя', 'Your name'))}</label><input id="gname" maxlength="40" value="${esc(name)}" autocomplete="given-name">
    <p class="form-error" id="gerr" role="alert"></p>
    <div class="list">${GROUP_FORMATS.map((f) => `<button class="item group-format" type="button" data-f="${f.key}"><span class="body"><b>${esc(fTitle(f))}</b><span class="small">${esc(fDesc(f))}</span></span><span aria-hidden="true">→</span></button>`).join('')}</div>
  </div>`;
  ctx.main.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', async () => {
    const n = ctx.main.querySelector('#gname').value.trim();
    if (!n) { ctx.main.querySelector('#gerr').textContent = tt('Напишите имя — его увидят друзья.', 'Enter your name — your friends will see it.'); ctx.main.querySelector('#gname').focus(); return; }
    storage.set('dc_live_name', n); b.disabled = true;
    try { const r = await api('/api/group', { method: 'POST', body: { format: b.dataset.f, deviceId: visitorId(), name: n } }); ctx.navigate('/g/' + r.code); }
    catch (x) { b.disabled = false; ctx.main.querySelector('#gerr').textContent = errorText(x); }
  }));
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
  const ui = { preview: null, slot: null, busy: false, text: '', found: {}, showSign: false, list: null };
  let tick = null; const fired = new Set(); let lastRecall = s.recallAt || null;
  const f = F(s.format);
  const url = `${location.origin}${u('/g/' + s.code)}`;
  const refresh = async () => { try { await load(); if (ctx.alive()) draw(); } catch { /* */ } };
  subscribe(`/api/group/${s.code}/events`, refresh, ctx.alive);
  const act = async (action, body = {}) => {
    ui.busy = true; draw();
    try { await api(`/api/group/${s.code}/act`, { method: 'POST', body: { deviceId: dev, action, ...body } }); } catch (x) { toast(errorText(x)); }
    ui.busy = false; await refresh();
  };
  const hostBtn = (action, label, cls = 'yellow') => (s.host ? `<button class="btn ${cls}" type="button" data-act="${action}" ${ui.busy ? 'disabled' : ''}>${esc(label)}</button>` : '');
  const waitHost = (what) => (s.host ? '' : `<p class="small muted" style="margin:0">${esc(tt(`${what} — ведущий: ${s.hostName}`, `${what} — host: ${s.hostName}`))}</p>`);
  const bigCard = (c) => (c ? `<button type="button" class="live-card-btn" data-zoom="${esc(c.code)}"><img class="live-card" src="${esc(c.thumb)}" alt="${esc(c.code)}"></button>` : '');
  const cardsBy = new Map();
  const remember = (c) => { if (c) cardsBy.set(c.code, c); return c; };
  const invite = (open = false) => `<details class="card-ui flat" ${open ? 'open' : ''}><summary><b>${esc(tt('Пригласить друзей', 'Invite friends'))}</b> · ${esc(tt('код', 'code'))} <span class="g-code">${esc(s.code)}</span></summary>
      <div class="stack" style="justify-items:center;margin-top:10px"><img class="g-qr" src="${u('/api/group/' + s.code + '/qr.png?size=500')}" alt="${esc(tt('QR-код для входа', 'QR code to join'))}" width="240" height="240">
      <input type="text" readonly value="${esc(url)}" id="gurl" aria-label="${esc(tt('Ссылка для друзей', 'Link for friends'))}" style="width:100%"></div></details>`;
  const people = () => `<p class="small muted" style="margin:0">${esc(tt('В игре', 'Playing'))}: ${s.members.map((m) => esc(m.name)).join(', ')}</p>`;

  function body() {
    if (s.status === 'ended') return `<h1>${esc(tt('Игра закончена', 'The game is over'))}</h1><p class="lead">${esc(tt('Спасибо за разговор!', 'Thank you for the conversation!'))}</p>
      <div class="list"><a class="item" href="${u('/group')}"><span class="body"><b>${esc(tt('Сыграть ещё', 'Play again'))}</b></span><span>→</span></a><a class="item" href="${u('/library')}"><span class="body"><b>${esc(tt('Галерея карт', 'Card gallery'))}</b></span><span>→</span></a><a class="item" href="${u('/meetings')}"><span class="body"><b>${esc(tt('Найти встречу Dialogue Flow', 'Find a Dialogue Flow meeting'))}</b></span><span>→</span></a></div>`;
    if (!s.me) return `<p class="lead">${esc(fDesc(f))}</p><form class="form" id="gj"><label class="field" for="gjn">${esc(tt('Ваше имя', 'Your name'))}</label><input id="gjn" maxlength="40" required value="${esc(storage.get('dc_live_name') || '')}"><p class="form-error" id="gjerr" role="alert"></p><button class="btn yellow wide big" type="submit">${esc(tt('Войти в игру', 'Join the game'))}</button></form>${people()}`;
    if (s.status === 'lobby') return `<p class="lead">${esc(fDesc(f))}</p>${invite(s.host)}${people()}
      <div class="card-ui flat"><b>${esc(tt('Договорённости', 'Agreements'))}</b><ul class="g-rules">${RULES().map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>
      ${hostBtn('start', s.format === 'friend' && s.members.length < 2 ? tt('Нужно хотя бы двое', 'At least two needed') : tt('Все здесь — начать', 'Everyone is here — start'))}${waitHost(tt('Ждём начала', 'Waiting to start'))}`;
    const fmt = s.format;
    if (fmt === 'pairs') return pairsBody();
    if (fmt === 'one') { remember(s.card); return `${bigCard(s.card)}<p class="lead">${esc(tt('По кругу: что вы заметили первым? О чём она вам напоминает?', 'In turns: what did you notice first? What does it remind you of?'))}</p>${circleHtml()}${hostBtn('next_card', tt('Другая карта', 'Another card'), 'light')}`; }
    if (fmt === 'story') {
      const cs = s.cards || []; cs.forEach(remember); const last = cs[cs.length - 1];
      return `${cs.length > 1 ? `<div class="g-strip">${cs.slice(0, -1).map((c) => `<img src="${esc(c.thumb)}" alt="">`).join('')}</div>` : ''}${bigCard(last)}
        <p class="lead">${esc(cs.length === 1 ? tt('Начните историю одной-двумя фразами — с того, что на карте.', 'Start the story in a sentence or two — from what is on the card.') : tt(`Карта ${cs.length}. Следующий продолжает историю, вплетая то, что на этой карте.`, `Card ${cs.length}. The next person continues the story, weaving in this card.`))}</p>
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
      return `<h2 class="g-h">${esc(head)}</h2><p class="small muted" style="margin:0">${esc(tt('Никому не показывайте — карты откроются, когда выберут все.', 'Do not show anyone — the cards open when everyone has chosen.'))}</p>
        ${s.myCard ? `<div class="live-chosen"><img src="${esc(s.myCard.thumb)}" alt=""><span>${ic.check} ${esc(tt('Выбрано — можно поменять', 'Chosen — you can change it'))}</span></div>` : ''}
        <p class="live-count" aria-live="polite">${esc(tt(`Выбрали: ${s.picked} из ${s.members.length}`, `Chosen: ${s.picked} of ${s.members.length}`))}</p>
        <div class="live-grid">${(s.gallery || []).map((c) => `<button type="button" class="live-tile" data-pick="${esc(c.code)}" aria-label="${esc(c.code)}"><img src="${esc(c.thumb)}" alt="" loading="lazy">${s.myCard && s.myCard.code === c.code ? `<span class="lt-mark">${ic.check}</span>` : ''}</button>`).join('')}</div>
        ${hostBtn('reveal', tt('Открыть, не дожидаясь остальных', 'Reveal without waiting'), 'light')}${previewHtml()}`;
    }
    if (s.phase === 'show') {
      (s.shown || []).forEach((x) => remember(x.card));
      return `<h2 class="g-h">${esc(fmt === 'friend' ? tt('Карты друг для друга', 'Cards for each other') : tt('Карты открыты', 'The cards are open'))}</h2>
        <p class="lead">${esc(fmt === 'friend' ? tt('По очереди: «Я выбрал для тебя эту, потому что…». Тот, кому карта, отвечает — совпало ли. Можно сказать «мне не откликается».', 'In turns: “I chose this one for you because…”. The person it is for answers whether it fits. “It doesn’t speak to me” is fine too.') : tt('По очереди расскажите, почему выбрали свою карту. Остальные задают по одному вопросу — без советов.', 'In turns, say why you chose your card. The others ask one question each — no advice.'))}</p>
        <div class="g-shown">${(s.shown || []).map((x) => `<figure>${bigCard(x.card)}<figcaption>${fmt === 'friend' ? `${esc(tt('Для', 'For'))} <b>${esc(x.for)}</b> · ${esc(tt('от', 'from'))} ${esc(x.name)}` : `<b>${esc(x.name)}</b>`}</figcaption></figure>`).join('')}</div>
        ${fmt === 'own' ? circleHtml() : ''}${hostBtn('again', tt('Ещё круг', 'Another round'))}`;
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
  function draw() {
    if (s.recallAt && s.recallAt !== lastRecall) { lastRecall = s.recallAt; play('gather'); }
    ctx.main.innerHTML = `<div class="live"><div class="live-in">
      <p class="eyebrow">${esc(tt('Играть компанией', 'Play with friends'))} · ${esc(fTitle(f))}</p>
      ${body()}
      ${s.me && s.status !== 'ended' && s.status !== 'lobby' ? invite() : ''}
      ${s.me && s.status !== 'ended' ? `<div class="row between">${s.host ? `<button class="linkbtn" type="button" data-end>${esc(tt('Завершить игру', 'End the game'))}</button>` : `<button class="linkbtn" type="button" data-leave>${esc(tt('Выйти', 'Leave'))}</button>`}</div>` : ''}
    </div></div>`;
    wire(); runTimer();
  }
  function wire() {
    const $ = (q) => ctx.main.querySelector(q);
    ctx.main.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => { unlockSound(); const a = b.dataset.act; act(a, a === 'talk' ? { minutes: Number(($('#gmin') || {}).value) || s.minutes } : {}); }));
    const gj = $('#gj');
    if (gj) gj.onsubmit = async (e) => { e.preventDefault(); unlockSound(); keepAwake(true); const n = $('#gjn').value.trim(); if (!n) return; storage.set('dc_live_name', n); try { await api(`/api/group/${s.code}/join`, { method: 'POST', body: { deviceId: dev, name: n } }); await refresh(); } catch (x) { $('#gjerr').textContent = errorText(x); } };
    const gq = $('#gq');
    if (gq) { gq.gqt.addEventListener('input', () => { ui.text = gq.gqt.value; }); gq.onsubmit = async (e) => { e.preventDefault(); const t = gq.gqt.value.trim(); if (!t) return; await act('write', { text: t }); ui.text = ''; toast(tt('Вопрос принят', 'Question saved')); }; }
    ctx.main.querySelectorAll('[data-pick]').forEach((b) => b.onclick = () => { ui.preview = b.dataset.pick; draw(); });
    const pc = $('[data-pv-close]'); if (pc) { pc.onclick = () => { ui.preview = null; draw(); }; pc.focus(); }
    const po = $('[data-pv-ok]'); if (po) po.onclick = async () => { const code0 = ui.preview; const slot = ui.slot; ui.preview = null; ui.slot = null; if (slot) await act('partner', { slotId: slot }); else await act('pick', { code: code0 }); };
    ctx.main.querySelectorAll('[data-slot]:not([disabled])').forEach((b) => b.onclick = () => { unlockSound(); ui.preview = b.dataset.code; ui.slot = Number(b.dataset.slot); draw(); });
    const fd = $('[data-found]'); if (fd) fd.onclick = () => { ui.found[s.step] = true; ui.showSign = false; draw(); window.scrollTo(0, 0); };
    const sg = $('[data-sign]'); if (sg) sg.onclick = () => { ui.showSign = true; draw(); };
    ctx.main.querySelectorAll('[data-list]').forEach((b) => b.onclick = () => { ui.list = b.dataset.list; draw(); });
    const sd = $('[data-sound]'); if (sd) sd.onclick = () => { unlockSound(); setTimeout(draw, 300); };
    ctx.main.querySelectorAll('[data-zoom]').forEach((b) => b.onclick = () => { const c = cardsBy.get(b.dataset.zoom); if (c) openViewer({ cards: [c], index: 0, mode: 'admin' }); });
    const gu = $('#gurl'); if (gu) gu.addEventListener('focus', () => gu.select());
    const en = $('[data-end]'); if (en) en.onclick = () => { if (confirm(tt('Завершить игру для всех?', 'End the game for everyone?'))) act('end'); };
    const lv = $('[data-leave]'); if (lv) lv.onclick = async () => { await api(`/api/group/${s.code}/leave`, { method: 'POST', body: { deviceId: dev } }).catch(() => {}); ctx.navigate('/group'); };
  }
  draw();
}
