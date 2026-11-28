// «Играть компанией онлайн» (22.11.2026): игры на расстоянии. Один создаёт комнату и отправляет приглашение,
// остальные заходят со своих телефонов. Разговор — в любом созвоне или переписке; очков и победителей нет.
// Комната, вход и обновления — те же, что у игр компанией (/api/group, /g/<код>); экраны игр — здесь.
import { lang } from '../i18n.js';
import { morph, listen, esc, tt, u, shareLink, api, errorText, toast, visitorId, storage } from '../util.js';
import { ic, loading, failed } from '../ui.js';
import { openViewer } from '../viewer.js';
import { subscribe } from '../live-common.js';
import { joinButton, wireScan } from '../qr-scan.js';
import { sendRoomInvite, saveImage } from '../share.js';
import * as personal from '../personal.js';

export const ONLINE_GAMES = [
  { key: 'see', ru: 'Что видишь ты?', en: 'What do you see?',
    dru: 'Всем открывается одна карта с вопросом. Каждый пишет свой ответ, не видя чужих. Когда ответили все, ответы открываются одновременно — и можно поговорить, почему мы увидели такое разное.',
    den: 'Everyone sees the same card and a question. Each person writes an answer without seeing the others. When everyone has answered, all answers open at once — and you can talk about why you saw such different things.' },
  { key: 'whose', ru: 'Чья это карта?', en: 'Whose card is it?', min: 2,
    dru: 'Ведущий выбирает тему. Каждому приходят свои 4 карты: тайно выберите одну и одной строкой напишите почему. Потом все карты показываются без имён — отметьте, чья какая, и авторы откроются.',
    den: 'The host picks a theme. Everyone gets four cards: secretly choose one and write in one line why. Then all the chosen cards are shown without names — mark whose is whose, and the authors are revealed.' },
  { key: 'chain', ru: 'История по кругу', en: 'A story in turns',
    dru: 'Ходят по очереди: тот, чей ход, выбирает одну из трёх карт и дописывает к общей истории одну-две фразы. Через несколько ходов история готова — её можно сохранить картинкой.',
    den: 'Take turns: whoever’s turn it is picks one of three cards and adds a sentence or two to the shared story. After a few turns the story is ready — you can save it as an image.' },
  { key: 'gift', ru: 'Карта для соседа', en: 'A card for your neighbour', min: 2,
    dru: 'Каждый тайно получает имя одного из участников: выберите для него карту и напишите к ней свой вопрос. Потом все одновременно получают свою карту и отвечают. Ответы видны всей комнате.',
    den: 'Everyone secretly gets the name of another player: choose a card for them and write your own question for it. Then everyone receives their card at the same time and answers. The answers are visible to the whole room.' },
  { key: 'bridge', ru: 'Мост между картами', en: 'A bridge between cards',
    dru: 'Всем открываются две карты рядом. Каждый пишет, что их связывает: слово, образ или короткую историю. Ответы открываются вместе, и можно отметить тот, что удивил.',
    den: 'Two cards open side by side. Each person writes what connects them: a word, an image or a short story. The answers open together, and you can mark the one that surprised you.' },
  { key: 'eagle', ru: 'Глаз-алмаз', en: 'Eagle Eye',
    dru: 'Всем открывается одна карта. Каждый рассматривает её в своём темпе и нажимает «Запомнил» — карта скрывается, появляется вопрос. Когда ответят все, откроются карта, правильный ответ и ответы участников.',
    den: 'Everyone sees the same card. Each person looks at it at their own pace and taps “Got it” — the card disappears and a question appears. When everyone has answered, the card, the correct answer and everyone’s answers open.' },
];
// Ограничения (сверено с сервером, 23.11.2026): в комнате до 20 человек (server/group.js, MAX); «Чья это карта?» и
// «Карта для соседа» начинаются, когда в комнате хотя бы двое; остальные игры можно начать и одному.
export const ROOM_MAX = 20;
const limitText = (g) => (g.min ? tt(`${g.min}–${ROOM_MAX} участников`, `${g.min}–${ROOM_MAX} players`) : tt(`До ${ROOM_MAX} участников`, `Up to ${ROOM_MAX} players`));
export const ONLINE_KEYS = ONLINE_GAMES.map((g) => g.key);
// Приглашение — по игре (22.11.2026)
const PITCH = {
  see: ['Давайте сыграем в «Что видишь ты?». Посмотрим на одну карту и сравним, что каждый в ней увидел.', 'Let’s play “What do you see?”. We’ll look at one card and compare what each of us saw in it.'],
  whose: ['Давайте сыграем в «Чья это карта?». Каждый тайно выберет карту, а остальные попробуют угадать, чья она.', 'Let’s play “Whose card is it?”. Everyone secretly picks a card, and the others try to guess whose it is.'],
  chain: ['Давайте сыграем в «Историю по кругу». По очереди сочиним общую историю по картам.', 'Let’s play “A story in turns”. We’ll take turns writing a shared story from the cards.'],
  gift: ['Давайте сыграем в «Карту для соседа». Каждый выберет карту и вопрос для другого участника.', 'Let’s play “A card for your neighbour”. Everyone picks a card and a question for another player.'],
  bridge: ['Давайте сыграем в «Мост между картами». Посмотрим на две карты и поищем, что их связывает.', 'Let’s play “A bridge between cards”. We’ll look at two cards and look for what connects them.'],
  eagle: ['Давайте сыграем в «Глаз-алмаз». Рассмотрим одну карту, запомним детали и сравним ответы.', 'Let’s play “Eagle Eye”. We’ll look at one card, remember the details and compare our answers.'],
};
export const pitchOf = (key) => { const p = PITCH[key]; return p ? tt(p[0], p[1]) : ''; };
/** Предложение продолжить: участник сам решает, присоединиться ли (22.11.2026). */
export function offerHtml(s, titleOf) {
  const n = s && s.next; if (!n || n.joined) return '';
  return `<div class="card-ui on-offer" role="region" aria-label="${esc(tt('Предложение продолжить', 'Suggestion to continue'))}"><b>${esc(tt(`${n.byName} предлагает продолжить: «${titleOf(n.format)}»`, `${n.byName} suggests continuing: “${titleOf(n.format)}”`))}</b>
    <div class="row wrap"><button class="btn yellow" type="button" data-offer-join="${esc(n.code)}">${esc(tt('Присоединиться', 'Join'))}</button><button class="btn light" type="button" data-offer-no>${esc(tt('Не сейчас', 'Not now'))}</button></div></div>`;
}
export function wireOffer(root, s, navigate, hide) {
  root.querySelectorAll('[data-offer-join]').forEach((b) => b.onclick = async () => {
    b.disabled = true;
    try { await api(`/api/group/${b.dataset.offerJoin}/join`, { method: 'POST', body: { deviceId: visitorId(), name: (s.me && s.me.name) || storage.get('dc_live_name') || '' } }); navigate('/g/' + b.dataset.offerJoin); }
    catch (x) { b.disabled = false; toast(errorText(x)); }
  });
  root.querySelectorAll('[data-offer-no]').forEach((b) => b.onclick = hide);
}
export const gameTitle = (k) => { const g = ONLINE_GAMES.find((x) => x.key === k); return g ? title(g) : k; };
const G = (k) => ONLINE_GAMES.find((g) => g.key === k) || ONLINE_GAMES[0];
const title = (g) => (lang === 'en' ? g.en : g.ru);
const desc = (g) => (lang === 'en' ? g.den : g.dru);
// Темы для «Чья это карта?» — подсказки ведущему, он может написать свою
const THEMES = () => [tt('Какая карта похожа на твоё утро?', 'Which card is like your morning?'), tt('Какая карта — про то, что тебя сейчас радует?', 'Which card is about what makes you happy right now?'),
  tt('Какая карта похожа на место, где тебе спокойно?', 'Which card is like a place where you feel calm?'), tt('Какая карта — про то, о чём ты давно думаешь?', 'Which card is about something you have been thinking about for a while?')];

// ---------- выбор игры (22.11.2026: сначала игра, затем имя и создание комнаты) ----------
export async function choose(ctx) {
  let cols = []; try { cols = (await personal.load()).collections.filter((c) => c.codes.length >= 2); } catch { /* только галерея */ }
  if (!ctx.alive()) return;
  const picked = ONLINE_GAMES.find((g) => g.key === ctx.query.get('g'));
  const from = ctx.query.get('from'); // «Продолжить этой компанией»: код прежней комнаты
  if (!picked) {
    ctx.main.innerHTML = `<div class="wrap page narrow stack">
      <div class="page-head"><p class="eyebrow">Dialogue Cards</p><h1>${esc(tt('Играть компанией онлайн', 'Play with friends online'))}</h1>
        <p class="game-lead">${esc(tt(`На расстоянии · до ${ROOM_MAX} участников · друзья подключаются по ссылке`, `At a distance · up to ${ROOM_MAX} players · friends join by link`))}</p>
        <div class="game-how"><p>${esc(tt('Выберите игру, затем создайте комнату и отправьте приглашение. Говорить можно в любом созвоне или переписке — ответы видны прямо в игре. Регистрация не нужна.', 'Choose a game, then create a room and send an invitation. Talk on any call or chat — the answers are shown right in the game. No sign-up needed.'))}</p></div></div>
      ${from ? await crewBox(from) : ''}
      <div class="join-row">${joinButton(ic.qr)}</div>
      <div class="list">${ONLINE_GAMES.map((g) => `<a class="item group-format" href="${u('/group/online?g=' + g.key + (from ? '&from=' + encodeURIComponent(from) : ''))}"><span class="body"><b>${esc(title(g))}</b><span class="small">${esc(desc(g))}</span><span class="small muted">${esc(limitText(g))}</span></span><span aria-hidden="true">→</span></a>`).join('')}</div>
    </div>`;
    wireScan(ctx.main, ctx.navigate);
    return;
  }
  const name = storage.get('dc_live_name') || '';
  ctx.main.innerHTML = `<div class="wrap page narrow stack">
    <div class="page-head"><p class="eyebrow">${esc(tt('Играть компанией онлайн', 'Play with friends online'))}</p><h1>${esc(title(picked))}</h1><p class="lead">${esc(desc(picked))}</p></div>
    ${from ? await crewBox(from) : ''}
    <form class="stack" id="ocreate">
      <label class="field" for="oname">${esc(tt('Ваше имя', 'Your name'))}</label><input id="oname" maxlength="40" value="${esc(name)}" autocomplete="given-name" aria-describedby="oname-h">
      <p class="small muted" id="oname-h" style="margin:-6px 0 0">${esc(tt('Это имя увидят другие игроки.', 'Other players will see this name.'))}</p>
      ${cols.length ? `<label class="field" for="osrc">${esc(tt('Какие карты', 'Which cards'))}</label><select id="osrc"><option value="">${esc(tt('Вся галерея', 'The whole gallery'))}</option>${cols.map((c) => `<option value="${esc(String(c.id))}">${esc(c.favorites ? tt('Избранное', 'Favourites') : c.title)} · ${c.codes.length}</option>`).join('')}</select>` : ''}
      <p class="form-error" id="oerr" role="alert"></p>
      <button class="btn yellow big" type="submit">${esc(from ? tt('Предложить участникам', 'Suggest to the players') : tt('Создать комнату', 'Create a room'))}</button>
      ${from ? `<p class="small muted" style="margin:0">${esc(tt('Участники прежней комнаты увидят предложение и сами решат, присоединиться ли.', 'Players in the previous room will see the suggestion and decide for themselves whether to join.'))}</p>` : ''}
      <a class="small" href="${u('/group/online' + (from ? '?from=' + encodeURIComponent(from) : ''))}">${esc(tt('Выбрать другую игру', 'Choose another game'))}</a>
    </form></div>`;
  ctx.main.querySelector('#ocreate').addEventListener('submit', async (e) => {
    e.preventDefault(); const b = e.target.querySelector('[type=submit]');
    const n = ctx.main.querySelector('#oname').value.trim();
    if (!n) { ctx.main.querySelector('#oerr').textContent = tt('Напишите имя — его увидят друзья.', 'Enter your name — your friends will see it.'); ctx.main.querySelector('#oname').focus(); return; }
    storage.set('dc_live_name', n); b.disabled = true;
    const src = ctx.main.querySelector('#osrc'); const col = src && src.value ? cols.find((c) => String(c.id) === src.value) : null;
    try {
      const r = await api('/api/group', { method: 'POST', body: { format: picked.key, deviceId: visitorId(), name: n, codes: col ? col.codes : undefined, from: from || undefined } });
      if (from && r.offerError) toast(errorText({ code: r.offerError }));
      ctx.navigate('/g/' + r.code);
    } catch (x) { b.disabled = false; ctx.main.querySelector('#oerr').textContent = errorText(x); }
  });
}
/** Состав прежней комнаты для «Продолжить этой компанией». */
export async function crewBox(code) {
  try {
    const s = await api(`/api/group/${encodeURIComponent(code)}/state?device=${encodeURIComponent(visitorId())}`);
    if (!s.me) return '';
    const others = s.members.filter((m) => !s.me || m.id !== s.me.id);
    return `<div class="card-ui flat on-crew"><b>${esc(tt('Эта компания', 'This group'))}</b><ul class="on-people">${s.members.map((m) => `<li><span>${esc(m.name)}${s.me && m.id === s.me.id ? ` (${esc(tt('вы', 'you'))})` : ''}</span></li>`).join('')}</ul>
      ${others.length ? '' : `<p class="small muted" style="margin:0">${esc(tt('В прежней комнате больше никого нет — предложение некому показать. Можно собрать новую компанию.', 'Nobody else is left in the previous room — there is no one to show the suggestion to. You can gather a new group.'))}</p>`}</div>`;
  } catch { return `<p class="small muted">${esc(tt('Прежняя комната недоступна — предложение не доставить. Создайте комнату и отправьте приглашение.', 'The previous room is not available — the suggestion cannot be delivered. Create a room and send an invitation.'))}</p>`; }
}

// ---------- комната ----------
export async function room(ctx, code, first) {
  const dev = visitorId();
  let s = first;
  const load = async () => { s = await api(`/api/group/${encodeURIComponent(code)}/state?device=${encodeURIComponent(dev)}`); };
  const g = G(s.format);
  const url = shareLink('/g/' + s.code);
  // черновики и выбор — на этом телефоне; переживают обновления комнаты
  const ui = { busy: false, draft: {}, sel: {}, edit: {}, step: s.step, phase: s.phase };
  const cards = new Map();
  const keep = (c) => { if (c) cards.set(c.code, c); return c; };
  let root = null; let lastHtml = '';
  const refresh = async () => { try { await load(); if (ctx.alive()) draw(); } catch { /* */ } };
  subscribe(`/api/group/${s.code}/events`, refresh, ctx.alive);
  const act = async (action, body = {}) => {
    ui.busy = true; draw();
    let okk = true;
    try { await api(`/api/group/${s.code}/act`, { method: 'POST', body: { deviceId: dev, action, ...body } }); } catch (x) { okk = false; toast(errorText(x)); }
    ui.busy = false; await refresh(); return okk;
  };
  const dis = () => (ui.busy ? 'disabled' : '');
  const nameOf = (id) => (s.members.find((m) => m.id === id) || {}).name || '';
  const img = (c, cls = '') => (c ? `<button type="button" class="live-card-btn ${cls}" data-zoom="${esc(keep(c).code)}" aria-label="${esc(tt('Рассмотреть карту', 'View card'))} ${esc(c.code)}"><img class="live-card" src="${esc(c.thumb)}" alt="${esc(c.code)}" width="${c.width || 910}" height="${c.height || 1560}"></button>` : '');
  const ta = (k, label, ph = '', rows = 3, max = 500) => `<label class="field" for="ot-${k}">${esc(label)}</label><textarea id="ot-${k}" data-draft="${k}" rows="${rows}" maxlength="${max}" placeholder="${esc(ph)}">${esc(ui.draft[k] || '')}</textarea>`;
  const people = () => `<ul class="on-people" aria-label="${esc(tt('Участники', 'Players'))}">${s.members.map((m) => {
    const done = (s.ready || []).includes(m.id) && ['write', 'pick'].includes(s.phase) || (s.phase === 'guess' && (s.guessed || []).includes(m.id)) || (s.phase === 'answer' && (s.answered || []).includes(m.id));
    return `<li class="${done ? 'done' : ''}">${done ? ic.check : ''}<span>${esc(m.name)}${s.me && m.id === s.me.id ? ` (${esc(tt('вы', 'you'))})` : ''}</span></li>`; }).join('')}</ul>`;
  const progress = (n, total, what) => `<p class="small muted on-prog" aria-live="polite">${esc(tt(`${what}: ${n} из ${total}`, `${what}: ${n} of ${total}`))}</p>`;
  const waitHost = (what) => (s.host ? '' : `<p class="small muted" style="margin:0">${esc(what)} · ${esc(tt('ведущий', 'host'))}: ${esc(s.hostName)}</p>`);
  const hostBtn = (action, label, cls = 'yellow') => (s.host ? `<button class="btn ${cls}" type="button" data-act="${action}" ${dis()}>${esc(label)}</button>` : '');
  const inviteBox = (big) => `<div class="card-ui flat on-invite"><div class="row between wrap"><b>${esc(tt('Пригласить друзей', 'Invite friends'))}</b><span class="small muted">${esc(tt('код', 'code'))} <span class="g-code">${esc(s.code)}</span></span></div>
      <button class="btn ${big ? 'yellow wide big' : 'light'}" type="button" data-invite>${ic.share}<span>${esc(tt('Отправить приглашение', 'Send an invitation'))}</span></button>
      <input type="text" readonly value="${esc(url)}" aria-label="${esc(tt('Ссылка на комнату', 'Room link'))}" class="on-url"></div>`;

  // параметры следующего раунда у ведущего: свой вопрос (see) или тема (whose)
  function roundOpts() {
    if (!s.host) return '';
    if (s.format === 'see') return ta('q', tt('Свой вопрос к карте — необязательно', 'Your own question for the card — optional'), tt('Что ты здесь видишь?', 'What do you see here?'), 2, 200);
    if (s.format === 'whose') return `${ta('theme', tt('Тема раунда', 'Theme for the round'), THEMES()[0], 2, 200)}<div class="chips on-themes">${THEMES().map((t, i) => `<button type="button" class="chip" data-theme="${i}">${esc(t)}</button>`).join('')}</div>`;
    return '';
  }
  const roundBody = () => (s.format === 'see' ? { question: (ui.draft.q || '').trim() } : s.format === 'whose' ? { theme: (ui.draft.theme || '').trim() || THEMES()[0] } : {});
  const startBtn = (again) => {
    if (!s.host) return '';
    if (g.min && s.members.length < g.min) return `<button class="btn yellow" type="button" disabled>${esc(tt('Нужно хотя бы двое — пригласите друзей', 'At least two needed — invite friends'))}</button>`;
    const label = again ? ({ see: tt('Следующая карта', 'Next card'), bridge: tt('Новая пара карт', 'A new pair of cards'), chain: tt('Новая история', 'A new story') }[s.format] || tt('Новый раунд', 'New round')) : tt('Все здесь — начать', 'Everyone is here — start');
    return `<button class="btn yellow" type="button" data-round="${again ? 'again' : 'start'}" ${dis()}>${esc(label)}</button>`;
  };

  // ---------- экраны игр ----------
  function see() {
    const q = s.question || (s.defaultQuestion ? (lang === 'en' ? s.defaultQuestion.en : s.defaultQuestion.ru) : '');
    const head = `<div class="on-cardbox">${img(s.card)}</div><p class="on-q">${esc(q)}</p>`;
    if (s.phase === 'write') return head + writeOrWait(tt('Твой ответ', 'Your answer'), tt('Что ты здесь видишь?', 'What do you see here?'));
    return head + answersList(false) + `${roundOpts()}<div class="row">${startBtn(true)}</div>${waitHost(tt('Ждём следующую карту', 'Waiting for the next card'))}`;
  }
  function bridge() {
    const head = `<div class="on-two">${(s.cards || []).map((c) => img(c)).join(`<span class="on-plus" aria-hidden="true">+</span>`)}</div><p class="on-q">${esc(tt('Что их связывает?', 'What connects them?'))}</p>`;
    if (s.phase === 'write') return head + writeOrWait(tt('Слово, образ или короткая история', 'A word, an image or a short story'), '');
    return head + answersList(true) + `<div class="row">${startBtn(true)}</div>${waitHost(tt('Ждём новую пару карт', 'Waiting for a new pair of cards'))}`;
  }
  function writeOrWait(label, ph) {
    const total = s.members.length; const n = (s.ready || []).length;
    const mine = s.myText && !ui.edit.w
      ? `<div class="card-ui flat on-mine"><span class="small muted">${esc(tt('Твой ответ', 'Your answer'))}</span><p>${esc(s.myText)}</p><button class="link-btn" type="button" data-edit="w">${esc(tt('Изменить', 'Edit'))}</button></div>
         <p class="small muted" style="margin:0">${esc(tt('Ответы откроются, когда ответят все.', 'The answers open when everyone has answered.'))}</p>`
      : `<form class="stack on-form" data-form="write">${ta('w', label, ph)}<button class="btn yellow" type="submit" ${dis()}>${esc(tt('Отправить ответ', 'Send answer'))}</button></form>`;
    return mine + progress(n, total, tt('Ответили', 'Answered')) + (s.host && n > 0 && n < total ? hostBtn('reveal', tt('Открыть ответы, не дожидаясь всех', 'Open the answers without waiting'), 'light') : '');
  }
  function answersList(hearts) {
    return `<ul class="on-answers">${(s.answers || []).map((a) => `<li><b>${esc(a.name)}</b><p>${esc(a.text)}</p>${hearts ? `<div class="row on-heart">${s.me && a.id !== s.me.id ? `<button type="button" class="chip ${a.mine ? 'on' : ''}" aria-pressed="${a.mine}" data-heart="${a.id}">♡ ${esc(tt('Удивило', 'Surprised me'))}</button>` : ''}${a.hearts.length ? `<span class="small muted">${esc(tt('Удивило', 'Surprised'))}: ${a.hearts.map(esc).join(', ')}</span>` : ''}</div>` : ''}</li>`).join('')}</ul>`;
  }
  function pickGrid(list, key, labelFn) {
    return `<div class="on-grid" role="radiogroup" aria-label="${esc(labelFn)}">${list.map((c) => `<button type="button" role="radio" aria-checked="${ui.sel[key] === c.code}" class="on-pick ${ui.sel[key] === c.code ? 'on' : ''}" data-sel="${key}" data-code="${esc(keep(c).code)}"><img src="${esc(c.thumb)}" alt="${esc(c.code)}" width="${c.width || 910}" height="${c.height || 1560}" loading="lazy"></button>`).join('')}</div>`;
  }
  function whose() {
    const theme = `<p class="on-q">${esc(s.theme || THEMES()[0])}</p>`;
    if (s.phase === 'pick') {
      const total = s.members.length; const n = (s.ready || []).length;
      const body = s.myCard && !ui.edit.p
        ? `<div class="card-ui flat on-mine"><span class="small muted">${esc(tt('Ты выбрал(а)', 'You chose'))}</span><div class="on-cardbox sm">${img(s.myCard)}</div><p>${esc(s.myText || '')}</p><button class="link-btn" type="button" data-edit="p">${esc(tt('Изменить', 'Edit'))}</button></div>`
        : `<p class="small muted" style="margin:0">${esc(tt('Твои карты — их видишь только ты. Выбери одну.', 'Your cards — only you can see them. Choose one.'))}</p>${pickGrid(s.hand || [], 'p', tt('Твои карты', 'Your cards'))}
           <form class="stack on-form" data-form="pick">${ta('why', tt('Почему эта карта? Одной строкой', 'Why this card? In one line'), '', 2, 300)}<button class="btn yellow" type="submit" ${ui.sel.p ? '' : 'disabled'} ${dis()}>${esc(tt('Выбрать эту карту', 'Choose this card'))}</button></form>`;
      return theme + body + progress(n, total, tt('Выбрали', 'Chosen')) + (s.host && n >= 2 && n < total ? hostBtn('reveal', tt('Показать карты, не дожидаясь всех', 'Show the cards without waiting'), 'light') : '');
    }
    if (s.phase === 'guess') {
      const others = (s.choices || []).filter((m) => !s.me || m.id !== s.me.id);
      return theme + `<p class="small muted" style="margin:0">${esc(tt('Карты без имён. Отметь, кто, по-твоему, выбрал каждую.', 'The cards have no names. Mark who you think chose each one.'))}</p>
        <ul class="on-slots">${(s.slots || []).map((x) => `<li>${img(x.card)}<div class="stack">${x.mine ? `<span class="small muted">${esc(tt('Твоя карта', 'Your card'))}</span>` : `<span class="small muted">${esc(tt('Чья это карта?', 'Whose card is it?'))}</span><div class="chips">${others.map((m) => `<button type="button" class="chip ${x.myGuess === m.id ? 'on' : ''}" aria-pressed="${x.myGuess === m.id}" data-guess="${x.slot}" data-who="${m.id}" ${dis()}>${esc(m.name)}</button>`).join('')}</div>`}</div></li>`).join('')}</ul>`
        + progress((s.guessed || []).length, s.members.length, tt('Отметили догадки', 'Guesses marked')) + (s.host ? hostBtn('reveal', tt('Открыть авторов', 'Reveal the authors'), (s.guessed || []).length >= s.members.length ? 'yellow' : 'light') : '');
    }
    return theme + `<ul class="on-slots">${(s.slots || []).map((x) => `<li>${img(x.card)}<div class="stack"><b>${esc(x.author)}</b><p style="margin:0">${esc(x.why || '')}</p>${x.guesses.length ? `<ul class="small muted on-guesses">${x.guesses.map((y) => `<li>${esc(y.who)}: ${esc(y.said)}</li>`).join('')}</ul>` : ''}</div></li>`).join('')}</ul>
      <p class="small muted">${esc(tt('Расскажите друг другу, почему выбрали свою карту.', 'Tell each other why you chose your card.'))}</p>${roundOpts()}<div class="row">${startBtn(true)}</div>${waitHost(tt('Ждём новую тему', 'Waiting for a new theme'))}`;
  }
  function storyHtml() {
    return (s.story || []).length ? `<ol class="on-story">${s.story.map((x) => `<li>${img(x.card, 'sm')}<div><p>${esc(x.text)}</p><span class="small muted">${esc(x.name)}</span></div></li>`).join('')}</ol>` : '';
  }
  function chain() {
    const n = (s.story || []).length;
    if (s.phase === 'done') return `<h2>${esc(tt('История готова', 'The story is ready'))}</h2>${storyHtml()}<div class="row wrap"><button class="btn light" type="button" data-save>${esc(tt('Сохранить картинку', 'Save as an image'))}</button>${startBtn(true)}</div>${waitHost(tt('Можно начать новую историю', 'You can start a new story'))}`;
    const head = `<p class="small muted on-prog">${esc(tt(`Ход ${n + 1} из ${s.max}`, `Turn ${n + 1} of ${s.max}`))}</p>${n ? storyHtml() : `<p class="small muted">${esc(tt('История начинается с первого хода.', 'The story begins with the first turn.'))}</p>`}`;
    const mine = s.myTurn ? `<div class="card-ui flat stack"><b>${esc(tt('Твой ход', 'Your turn'))}</b><p class="small muted" style="margin:0">${esc(n ? tt('Выбери одну из трёх карт и продолжи историю одной-двумя фразами.', 'Choose one of three cards and continue the story in a sentence or two.') : tt('Выбери одну из трёх карт и начни историю одной-двумя фразами.', 'Choose one of three cards and start the story in a sentence or two.'))}</p>
        ${pickGrid(s.offer || [], 'c', tt('Карты для хода', 'Cards for your turn'))}<form class="stack on-form" data-form="add">${ta('c', tt('Твоё продолжение', 'Your part'), '', 3, 300)}<button class="btn yellow" type="submit" ${ui.sel.c ? '' : 'disabled'} ${dis()}>${esc(tt('Добавить в историю', 'Add to the story'))}</button></form></div>`
      : `<p class="on-turn" aria-live="polite">${esc(tt(`Сейчас пишет ${s.turnName}…`, `${s.turnName} is writing…`))}</p>`;
    const host = s.host ? `<div class="row wrap">${!s.myTurn ? hostBtn('skip', tt('Передать ход дальше', 'Pass the turn on'), 'light') : ''}${n >= 2 ? hostBtn('finish', tt('Закончить историю', 'Finish the story'), 'light') : ''}</div>` : '';
    return head + mine + host;
  }
  function gift() {
    if (s.phase === 'pick') {
      const total = s.members.length; const n = (s.ready || []).length;
      if (!s.target) return `<p>${esc(tt('Ты зашёл(а) после начала раунда — подожди следующего.', 'You joined after the round started — wait for the next one.'))}</p>` + progress(n, total, tt('Готово', 'Ready'));
      const body = s.myCard && !ui.edit.g
        ? `<div class="card-ui flat on-mine"><span class="small muted">${esc(tt(`Твоя карта · для: ${s.target}`, `Your card · for: ${s.target}`))}</span><div class="on-cardbox sm">${img(s.myCard)}</div><p>${esc(s.myText || '')}</p><button class="link-btn" type="button" data-edit="g">${esc(tt('Изменить', 'Edit'))}</button></div>`
        : `<p class="on-q">${esc(tt(`Ты выбираешь карту для: ${s.target}`, `You are choosing a card for: ${s.target}`))}</p><p class="small muted" style="margin:0">${esc(tt('Это видишь только ты. Выбери карту и напиши к ней свой вопрос.', 'Only you can see this. Choose a card and write your own question for it.'))}</p>
           ${pickGrid(s.gallery || [], 'g', tt('Карты', 'Cards'))}<form class="stack on-form" data-form="gift">${ta('g', tt(`Твой вопрос (для: ${s.target})`, `Your question (for: ${s.target})`), '', 2, 300)}<button class="btn yellow" type="submit" ${ui.sel.g ? '' : 'disabled'} ${dis()}>${esc(tt('Отправить карту', 'Send the card'))}</button></form>`;
      return body + progress(n, total, tt('Готово', 'Ready')) + (s.host && n > 0 && n < total ? hostBtn('reveal', tt('Раздать карты, не дожидаясь всех', 'Hand out the cards without waiting'), 'light') : '');
    }
    if (s.phase === 'answer') {
      const f = s.forMe;
      const body = !f ? `<p>${esc(tt('Для тебя в этом раунде карты нет — посмотри ответы других, когда они откроются.', 'There is no card for you this round — see the others’ answers when they open.'))}</p>`
        : `<p class="on-q">${esc(tt(`${f.from} — карта для тебя`, `${f.from} — a card for you`))}</p><div class="on-cardbox">${img(f.card)}</div><p class="on-ask">${esc(f.question)}</p>
          ${f.answer && !ui.edit.a ? `<div class="card-ui flat on-mine"><span class="small muted">${esc(tt('Твой ответ', 'Your answer'))}</span><p>${esc(f.answer)}</p><button class="link-btn" type="button" data-edit="a">${esc(tt('Изменить', 'Edit'))}</button></div>`
          : `<form class="stack on-form" data-form="answer">${ta('a', tt('Твой ответ', 'Your answer'))}<button class="btn yellow" type="submit" ${dis()}>${esc(tt('Ответить', 'Answer'))}</button></form>`}`;
      const total = (s.waitingFor || []).length;
      return body + progress((s.answered || []).length, total, tt('Ответили', 'Answered')) + (s.host ? hostBtn('reveal', tt('Показать все ответы', 'Show all answers'), (s.answered || []).length >= total ? 'yellow' : 'light') : '');
    }
    return `<ul class="on-feed">${(s.feed || []).map((x) => `<li>${img(x.card, 'sm')}<div class="stack"><span class="small muted">${esc(x.from)} → ${esc(x.to)}</span><p class="on-ask">${esc(x.question)}</p><p>${x.answer ? esc(x.answer) : `<span class="muted">${esc(tt('Без ответа', 'No answer'))}</span>`}</p></div></li>`).join('')}</ul><div class="row">${startBtn(true)}</div>${waitHost(tt('Ждём новый раунд', 'Waiting for a new round'))}`;
  }

  // «Глаз-алмаз» в компании (23.11.2026): карта сверху, вопрос и ответы — под ней на протяжении всего раунда
  const STAGE = { look: ['смотрит карту', 'looking at the card'], ask: ['отвечает', 'answering'], answered: ['ответил(а)', 'answered'], skipped: ['пропустил(а)', 'skipped'] };
  function eaglePeople() {
    if (s.phase === 'open') return '';
    return `<ul class="on-people on-stages" aria-label="${esc(tt('Участники', 'Players'))}">${s.members.map((m) => { const st = (s.stages || {})[m.id] || 'look'; const done = st === 'answered' || st === 'skipped';
      return `<li class="${done ? 'done' : ''}">${done ? ic.check : ''}<span>${esc(m.name)}${s.me && m.id === s.me.id ? ` (${esc(tt('вы', 'you'))})` : ''} · <span class="muted">${esc(tt(STAGE[st][0], STAGE[st][1]))}</span></span></li>`; }).join('')}</ul>`;
  }
  const hiddenCard = () => `<div class="eagle-hidden on-eagle-hidden" role="img" aria-label="${esc(tt('Карта скрыта', 'The card is hidden'))}">${ic.lock || ''}<span>${esc(tt('Карта скрыта', 'The card is hidden'))}</span></div>`;
  function eagle() {
    const total = s.members.length; const n = s.answeredCount || 0;
    if (s.phase === 'open') {
      return `<div class="on-cardbox">${img(s.card)}</div><p class="on-q">${esc(s.question || '')}</p>
        <p class="eagle-answer">${esc(tt('Правильный ответ', 'Correct answer'))}: ${esc(s.answer || '')}</p>
        <ul class="on-answers on-eagle-answers">${(s.answers || []).map((a) => `<li><b>${esc(a.name)}${s.me && a.id === s.me.id ? ` (${esc(tt('вы', 'you'))})` : ''}</b>${a.skipped ? `<p class="muted">${esc(tt('пропустил(а) задание', 'skipped the task'))}</p>` : `<p>${esc(a.text)}</p>`}</li>`).join('')}</ul>
        <div class="row">${s.host ? `<button class="btn yellow" type="button" data-round="again" ${dis()}>${esc(tt('Следующее задание', 'Next task'))}</button>` : ''}</div>${waitHost(tt('Следующее задание запускает ведущий', 'The host starts the next task'))}`;
    }
    const st = s.myStage || 'look';
    const reveal = s.host && n > 0 && n < total ? hostBtn('reveal', tt('Открыть ответы, не дожидаясь всех', 'Open the answers without waiting'), 'light') : '';
    const skip = `<button class="linkbtn" type="button" data-act="skip" ${dis()}>${esc(tt('Пропустить это задание', 'Skip this task'))}</button>`;
    if (st === 'look') return `<p class="small muted" style="margin:0">${esc(tt('Рассмотри карту и запомни детали.', 'Look at the card and remember the details.'))}<br>${esc(tt('Когда нажмёшь «Запомнил», карта скроется и появится вопрос.', 'When you tap “Got it”, the card disappears and a question appears.'))}</p>
      <div class="on-cardbox">${img(s.card)}</div><div class="row wrap"><button class="btn yellow" type="button" data-act="look" ${dis()}>${esc(tt('Запомнил', 'Got it'))}</button>${skip}</div>${progress(n, total, tt('Ответили', 'Answered'))}${reveal}`;
    if (st === 'ask') {
      const has = !!(ui.draft.e || '').trim();
      return `${hiddenCard()}<p class="on-q">${esc(s.question || '')}</p>${lang === 'en' ? `<p class="small muted" style="margin:0">${esc('The questions are in Russian for now.')}</p>` : ''}
        <form class="stack on-form" data-form="eagle">${ta('e', tt('Твой ответ', 'Your answer'), '', 3, 300)}<button class="btn yellow" type="submit" data-esend ${has && !ui.busy ? '' : 'disabled'}>${esc(tt('Отправить ответ', 'Send answer'))}</button></form>
        <div class="row">${skip}</div>${progress(n, total, tt('Ответили', 'Answered'))}${reveal}`;
    }
    const mine = st === 'answered' ? `<div class="card-ui flat on-mine"><span class="small muted">${esc(tt('Твой ответ', 'Your answer'))}</span><p>${esc(s.myText || '')}</p></div>` : `<p class="muted" style="margin:0">${esc(tt('Ты пропустил(а) это задание.', 'You skipped this task.'))}</p>`;
    return `${hiddenCard()}${s.question ? `<p class="on-q">${esc(s.question)}</p>` : ''}${mine}
      <p class="on-turn" aria-live="polite">${esc(tt(`Ждём остальных: ответили ${n} из ${total}`, `Waiting for the others: ${n} of ${total} answered`))}</p>${reveal}`;
  }

  function body() {
    if (s.status === 'ended') return `<h1>${esc(tt('Игра закончена', 'The game is over'))}</h1><p class="lead">${esc(tt('Спасибо за разговор!', 'Thank you for the conversation!'))}</p>
      ${offerHtml(ui.offerHidden ? null : s, gameTitle)}
      ${s.me ? `<div class="on-next"><a class="btn on-calm" href="${u('/group/online?from=' + s.code)}">${esc(tt('Продолжить этой компанией', 'Continue with this group'))}</a><a class="btn on-calm" href="${u('/group/online')}">${esc(tt('Собрать новую компанию', 'Gather a new group'))}</a></div>` : `<div class="on-next"><a class="btn on-calm" href="${u('/group/online')}">${esc(tt('Собрать новую компанию', 'Gather a new group'))}</a></div>`}`;
    const h = `<h1 class="on-title">${esc(title(g))}</h1>`;
    if (!s.me) return `${h}<p class="lead">${esc(desc(g))}</p><form class="form" id="oj"><label class="field" for="ojn">${esc(tt('Ваше имя', 'Your name'))}</label><input id="ojn" maxlength="40" required value="${esc(storage.get('dc_live_name') || '')}" autocomplete="given-name"><p class="small muted" style="margin:0">${esc(tt('Это имя увидят другие игроки.', 'Other players will see this name.'))}</p><p class="form-error" id="ojerr" role="alert"></p><button class="btn yellow wide big" type="submit">${esc(tt('Войти в игру', 'Join the game'))}</button></form>${people()}`;
    if (s.status === 'lobby') return `${h}<p class="lead">${esc(desc(g))}</p>${s.host ? inviteBox(true) : ''}${people()}
      <p class="small muted" style="margin:0">${esc(tt('Говорить можно в любом созвоне или переписке. Можно сказать «пас» — объяснять не нужно.', 'Talk on any call or chat. You can say “pass” — no explanation needed.'))}</p>
      ${roundOpts()}<div class="row">${startBtn(false)}</div>${waitHost(tt('Ждём начала', 'Waiting to start'))}`;
    const game = { see, bridge, whose, chain, gift, eagle }[s.format];
    return h + offerHtml(ui.offerHidden ? null : s, gameTitle) + game() + (s.format === 'eagle' ? eaglePeople() : people());
  }

  function draw() {
    if (ui.step !== s.step) { ui.step = s.step; ui.sel = {}; ui.edit = {}; for (const k of ['w', 'why', 'c', 'g', 'a', 'e']) delete ui.draft[k]; }
    if (ui.phase !== s.phase) { ui.phase = s.phase; ui.edit = {}; }
    if (!root || !ctx.main.contains(root)) { ctx.main.innerHTML = '<div class="live" id="oroot"></div>'; root = ctx.main.querySelector('#oroot'); lastHtml = ''; }
    const html = `<div class="live-in on-room">
      <p class="eyebrow">${esc(tt('Играть компанией онлайн', 'Play with friends online'))}</p>
      ${body()}
      ${s.me && s.status === 'play' ? inviteBox(false) : ''}
      ${s.me && s.status !== 'ended' ? `<div class="row between">${s.host ? `<button class="linkbtn" type="button" data-end>${esc(tt('Завершить игру', 'End the game'))}</button>` : `<button class="linkbtn" type="button" data-leave>${esc(tt('Выйти', 'Leave'))}</button>`}</div>` : ''}
    </div>`;
    if (html === lastHtml) return;
    // обновление комнаты не сбивает набор текста: фокус и курсор возвращаются на место
    const a = document.activeElement; const fk = a && a.dataset && a.dataset.draft; const sel = fk ? [a.selectionStart, a.selectionEnd] : null;
    morph(root, html); lastHtml = html; wire();
    if (fk) { const t = root.querySelector(`[data-draft="${fk}"]`); if (t) { t.focus({ preventScroll: true }); try { t.setSelectionRange(sel[0], sel[1]); } catch { /* */ } } }
  }
  const $ = (q) => root.querySelector(q);
  function wire() {
    wireOffer(root, s, ctx.navigate, () => { ui.offerHidden = true; lastHtml = ''; draw(); });
    root.querySelectorAll('[data-draft]').forEach((t) => listen(t, 'input', () => { ui.draft[t.dataset.draft] = t.value; const b = t.dataset.draft === 'e' && root.querySelector('[data-esend]'); if (b) b.disabled = !t.value.trim() || ui.busy; }));
    root.querySelectorAll('[data-invite]').forEach((b) => b.onclick = () => sendRoomInvite(url, pitchOf(g.key)));
    root.querySelectorAll('[data-round]').forEach((b) => b.onclick = () => act(b.dataset.round, roundBody()));
    root.querySelectorAll('[data-act]').forEach((b) => b.onclick = () => act(b.dataset.act));
    root.querySelectorAll('[data-theme]').forEach((b) => b.onclick = () => { ui.draft.theme = THEMES()[Number(b.dataset.theme)]; lastHtml = ''; draw(); });
    root.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => {
      const k = b.dataset.edit; ui.edit[k] = true;
      if (k === 'w') ui.draft.w = s.myText || ''; if (k === 'p') { ui.draft.why = s.myText || ''; ui.sel.p = s.myCard && s.myCard.code; }
      if (k === 'g') { ui.draft.g = s.myText || ''; ui.sel.g = s.myCard && s.myCard.code; } if (k === 'a') ui.draft.a = (s.forMe || {}).answer || '';
      lastHtml = ''; draw(); const t = root.querySelector('textarea'); if (t) t.focus();
    });
    root.querySelectorAll('[data-sel]').forEach((b) => b.onclick = () => { ui.sel[b.dataset.sel] = b.dataset.code; lastHtml = ''; draw(); });
    root.querySelectorAll('[data-guess]').forEach((b) => b.onclick = () => act('guess', { slot: Number(b.dataset.guess), who: Number(b.dataset.who) }));
    root.querySelectorAll('[data-heart]').forEach((b) => b.onclick = () => act('heart', { to: Number(b.dataset.heart) }));
    root.querySelectorAll('[data-zoom]').forEach((b) => b.onclick = () => { const c = cards.get(b.dataset.zoom); if (c) openViewer({ cards: [c], index: 0, mode: 'admin', simple: true }); });
    root.querySelectorAll('[data-form]').forEach((f) => listen(f, 'submit', async (e) => {
      e.preventDefault(); const kind = f.dataset.form; const t = f.querySelector('textarea'); const text = (t ? t.value : '').trim();
      if (!text) { toast(kind === 'gift' ? tt('Напишите вопрос к карте.', 'Write a question for the card.') : kind === 'pick' ? tt('Напишите одной строкой, почему эта карта.', 'Write in one line why this card.') : tt('Напишите ответ.', 'Write your answer.')); if (t) t.focus(); return; }
      const map = { write: ['write', {}], pick: ['pick', { code: ui.sel.p }], add: ['add', { code: ui.sel.c }], gift: ['pick', { code: ui.sel.g }], answer: ['answer', {}], eagle: ['answer', {}] };
      const [action, extra] = map[kind];
      if (await act(action, { ...extra, text })) { const k = t && t.dataset.draft; if (k) delete ui.draft[k]; ui.edit = {}; lastHtml = ''; draw(); }
    }));
    const save = $('[data-save]'); if (save) save.onclick = async () => { save.disabled = true; try { const blob = await storyImage(s.story || []); await saveImage(blob, 'dialogue-cards-story.png'); } catch { toast(tt('Не получилось сделать картинку', 'Could not make the image')); } save.disabled = false; };
    const end = $('[data-end]'); if (end) end.onclick = () => { if (confirm(tt('Завершить игру для всех?', 'End the game for everyone?'))) act('end'); };
    const lv = $('[data-leave]'); if (lv) lv.onclick = async () => { try { await api(`/api/group/${s.code}/leave`, { method: 'POST', body: { deviceId: dev } }); } catch { /* */ } ctx.navigate('/group/online'); };
    const oj = $('#oj'); if (oj) listen(oj, 'submit', async (e) => {
      e.preventDefault(); const n = $('#ojn').value.trim(); if (!n) return;
      storage.set('dc_live_name', n);
      try { await api(`/api/group/${s.code}/join`, { method: 'POST', body: { deviceId: dev, name: n } }); await refresh(); } catch (x) { $('#ojerr').textContent = errorText(x); }
    });
  }
  draw();
}

// ---------- «История по кругу»: картинка с картами и текстом ----------
async function storyImage(story) {
  const W = 1080; const pad = 64; const thumbW = 240; const gap = 36;
  const loadImg = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  const imgs = await Promise.all(story.map((x) => loadImg(x.card.thumb)));
  const c = document.createElement('canvas'); const g = c.getContext('2d');
  const font = (sz, w = 400) => `${w} ${sz}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const wrap = (text, maxW, sz) => { g.font = font(sz); const words = String(text).split(/\s+/); const lines = []; let line = '';
    for (const w of words) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; } if (line) lines.push(line); return lines; };
  const textW = W - pad * 2 - thumbW - gap;
  const blocks = story.map((x, i) => { const im = imgs[i]; const h = im ? Math.round(thumbW * im.height / im.width) : Math.round(thumbW * 1.71); const lines = wrap(x.text, textW, 34); return { h: Math.max(h, lines.length * 46 + 60), ih: h, lines, name: x.name, im }; });
  const H = pad + 90 + blocks.reduce((n, b) => n + b.h + 40, 0) + 90;
  c.width = W; c.height = H;
  g.fillStyle = '#0c122a'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#f6c23c'; g.font = font(48, 700); g.fillText(tt('История по кругу', 'A story in turns'), pad, pad + 40);
  let y = pad + 100;
  for (const b of blocks) {
    if (b.im) { g.save(); g.beginPath(); g.roundRect ? g.roundRect(pad, y, thumbW, b.ih, 18) : g.rect(pad, y, thumbW, b.ih); g.clip(); g.drawImage(b.im, pad, y, thumbW, b.ih); g.restore(); }
    g.fillStyle = '#f1e6c8'; g.font = font(34);
    b.lines.forEach((l, i) => g.fillText(l, pad + thumbW + gap, y + 40 + i * 46));
    g.fillStyle = '#a9aecb'; g.font = font(26); g.fillText(b.name, pad + thumbW + gap, y + 40 + b.lines.length * 46 + 10);
    y += b.h + 40;
  }
  g.fillStyle = '#a9aecb'; g.font = font(28); g.fillText('Dialogue Cards', pad, H - pad + 10);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('blob'))), 'image/png'));
}
