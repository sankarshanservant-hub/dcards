import { t, lang } from '../i18n.js';
import { esc, tt, u, api, toast, errorText, fmtDate, ruPlural } from '../util.js';
import { openViewer } from '../viewer.js';
import { SLOGAN, TAGLINE } from '../share.js';
import { ABOUT_CARDS, ABOUT_FLOW, ABOUT_CLOSING } from '../content.js';
import { scanButton, wireScan } from '../qr-scan.js';
import { loadTerms, fullHtml } from '../author-terms.js';
import { session, ic, tileHtml, loading, failed, diceButtonHtml, wireDice } from '../ui.js';

const openFromQuery = (cards, openAt) => {
  const code = new URL(location.href).searchParams.get('card');
  if (!code) return;
  const i = cards.findIndex((c) => c.code === code);
  // вернулись из игр («Поиграем?») — та же карта и открытые вопросы того же сценария
  let back = null; try { back = JSON.parse(sessionStorage.getItem('dc_q_return') || 'null'); } catch { /* */ }
  const resume = back && back.code === code && Date.now() - back.at < 6 * 3600e3 ? back.format : null;
  if (resume) try { sessionStorage.removeItem('dc_q_return'); } catch { /* */ }
  if (i >= 0) openAt(i, resume); else history.replaceState({}, '', location.pathname);
};

// ---------- главная (20.11.2026) ----------
// По общей центральной оси: вопрос, три карты, «Все карты», две кнопки отправки. Ниже — два самостоятельных входа
// и «Участвовать в проекте». Карточка направления целиком — ссылка; пиктограмма рядом с заголовком.
const ENTRIES = [
  ['/meetings', 'chat', 'Найти встречу', 'Find a meeting', 'Приходите на Dialogue Flow, чтобы познакомиться и пообщаться с другими участниками.', 'Come to Dialogue Flow to meet and talk with other participants.'],
  ['/chats', 'chats', 'Общаться с участниками', 'Talk with participants', 'Чаты участников, фасилитаторов и кураторов проекта.', 'Chats for participants, facilitators and curators of the project.'],
];
const JOIN = [
  ['/facilitator/about', 'people', 'Провести встречу', 'Host a meeting', 'Узнайте, как стать фасилитатором и провести Dialogue Flow в своём городе.', 'Find out how to become a facilitator and host Dialogue Flow in your city.'],
  ['/artist/about', 'picPlus', 'Предложить иллюстрацию', 'Suggest an illustration', 'Есть работа, с которой может начаться разговор? Покажите её кураторам.', 'Have a work that could start a conversation? Show it to the curators.'],
  ['/curator/apply', 'picCheck', 'Стать куратором', 'Become a curator', 'Помогайте отбирать иллюстрации для коллекции Dialogue Cards.', 'Help choose illustrations for the Dialogue Cards collection.'],
];
const roleCard = ([href, icon, ru, en, dru, den]) => `<a class="role" href="${u(href)}"><span class="role-head"><span class="ic">${ic[icon]}</span><b>${esc(tt(ru, en))}</b></span><p>${esc(tt(dru, den))}</p></a>`;
export async function home(ctx) {
  ctx.main.innerHTML = `
    <section class="hero home"><div class="wrap home-wrap">
      <div class="home-title"><h1>Dialogue Cards</h1>
        <p class="greet">${esc(TAGLINE())}</p></div>
      <div class="home-axis">
        <h2 class="home-q">${esc(tt('Что ты здесь видишь?', 'What do you see here?'))}</h2>
        <p class="home-hint">${esc(tt('Открой любую карту', 'Open any card'))}</p>
        <div class="trio" id="trio" aria-busy="true"><span class="slot"></span><span class="slot"></span><span class="slot"></span></div>
        <div class="home-acts"><a class="btn yellow home-ask" href="${u('/library?play=friend')}">${esc(tt('Спроси друга', 'Ask a friend'))}</a><a class="btn home-play" href="${u('/games')}">${ic.cube}<span>${esc(tt('Играть', 'Play'))}</span></a></div>
        <a class="btn home-all" href="${u('/library')}" id="all-cards">${esc(tt('Все карты', 'All cards'))}</a>
      </div>
    </div></section>
    <section class="wrap band">
      <div class="roles">${ENTRIES.map(roleCard).join('')}</div>
      <h2 class="home-join-h" id="join">${esc(tt('Участвовать в проекте', 'Take part in the project'))}</h2>
      <div class="roles">${JOIN.map(roleCard).join('')}</div>
    </section>`;
  // Три вертикальные иллюстрации в ровном ряду с небольшим перекрытием; при новом заходе — другие работы.
  try {
    const { cards } = await api('/api/cards');
    if (!ctx.alive()) return;
    const pool = cards.filter((c) => !c.isDemo); const picks = [];
    while (picks.length < 3 && pool.length) picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    const trio = ctx.main.querySelector('#trio');
    // Каждая из трёх карт открывает именно себя (галерея с открытой картой).
    trio.removeAttribute('aria-busy');
    if (!picks.length) { trio.innerHTML = ''; return; }
    trio.innerHTML = picks.map((c) => `<a href="${u('/library?card=' + encodeURIComponent(c.code))}" aria-label="${esc(tt('Открыть карту', 'Open card'))} ${esc(c.code)}"><img src="${esc(c.thumb)}" alt="" width="${c.width}" height="${c.height}" loading="eager"></a>`).join('');
    trio.querySelectorAll('img').forEach((im) => im.addEventListener('error', () => im.closest('a').remove()));
  } catch { const t = ctx.main.querySelector('#trio'); if (t) t.innerHTML = ''; /* украшение: без карт блок просто пустой */ }
}


// абзацы текста о проекте: строки абзаца — с новой строки; **Dialogue Cards** — выделение
const paras = (T) => (lang === 'en' ? T.en : T.ru).map((p) => `<p>${p.map((l) => esc(l).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')).join('<br>')}</p>`).join('');


// ---------- «Поиграем?» из открытой карты: игры для себя или для компании (20.11.2026) ----------
export function games(ctx) {
  ctx.main.innerHTML = `<div class="wrap page narrow stack">
    <div class="page-head head-with-tool"><h1>${esc(tt('Поиграем?', 'Shall we play?'))}</h1>${scanButton(ic.qr)}</div>
    <div class="list">
      <a class="item" href="${u('/group/solo')}"><span class="ic">${ic.user}</span><span class="grow"><b>${esc(tt('Играть одному', 'Play solo'))}</b></span></a>
      <a class="item" href="${u('/group')}"><span class="ic">${ic.people}</span><span class="grow"><b>${esc(tt('Играть компанией на встрече', 'Play together at a meeting'))}</b><span class="game-sub2">${esc(tt('2–20 участников · каждый со своего телефона', '2–20 players · everyone on their own phone'))}</span></span></a>
      <a class="item" href="${u('/group/online')}"><span class="ic">${ic.globe}</span><span class="grow"><b>${esc(tt('Играть компанией онлайн', 'Play with friends online'))}</b><span class="game-sub2">${esc(tt('На расстоянии · друзья подключаются по ссылке', 'At a distance · friends join by link'))}</span></span></a>
    </div></div>`;
  wireScan(ctx.main, ctx.navigate);
}

// ---------- библиотека ----------
export async function library(ctx) {
  // «Попробовать» с главной: намерение «Сыграть с другом» сохраняется — у выбранной карты сразу форма для друга
  // Режимы выбора (20.11.2026): «Отправить другу с вопросом» и «Отправить открытку» с главной открывают всю галерею;
  // тап по карте — сразу подготовка обмена или редактор. Крестик выключает режим: та же галерея, та же позиция.
  let intent = ['friend', 'postcard'].includes(ctx.query.get('play')) ? ctx.query.get('play') : null;
  loading(ctx.main);
  let cards;
  try { ({ cards } = await api('/api/cards')); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  // Порядок (21.11.2026): «Сначала новые» — по дате публикации в галерее (при равной дате — по номеру карты, порядок с сервера);
  // «Вперемешку» — вся выборка, перемешанная один раз и запомненная на время сессии: после просмотра карты и возврата
  // порядок и место в сетке те же. Заголовков по месяцам больше нет.
  const byDate = cards.slice();
  const ss = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* */ } } };
  let order = ss.get('dc_gal_order') === 'mix' ? 'mix' : 'new';
  const mixed = () => {
    const codes = byDate.map((c) => c.code); let saved = null; try { saved = JSON.parse(ss.get('dc_gal_mix') || 'null'); } catch { /* */ }
    if (!Array.isArray(saved) || saved.length !== codes.length || !codes.every((c) => saved.includes(c))) {
      saved = codes.slice(); for (let i = saved.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [saved[i], saved[j]] = [saved[j], saved[i]]; }
      ss.set('dc_gal_mix', JSON.stringify(saved));
    }
    const by = new Map(byDate.map((c) => [c.code, c])); return saved.map((c) => by.get(c));
  };
  cards = order === 'mix' ? mixed() : byDate;
  const hintText = () => (order === 'mix' ? tt(`${cards.length} карт · вперемешку · нажми на карту, чтобы рассмотреть её`, `${cards.length} cards · shuffled · tap a card to see it up close`)
    : tt(`${cards.length} карт · новые сверху · нажми на карту, чтобы рассмотреть её`, `${cards.length} cards · newest first · tap a card to see it up close`));
  const X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const pickHtml = () => !intent ? '' : `<div class="pick-mode" role="region" aria-label="${esc(intent === 'postcard' ? tt('Открытка', 'Postcard') : tt('Вопрос другу', 'Question to a friend'))}">
      ${intent === 'postcard' ? (ic.mail || ic.cards) : ic.people}<b>${esc(intent === 'postcard' ? tt('Открытка', 'Postcard') : tt('Вопрос другу', 'Question to a friend'))}</b>
      <button class="pick-x" type="button" data-pick-close aria-label="${esc(intent === 'postcard' ? tt('Закрыть выбор карты для открытки', 'Close card choice for the postcard') : tt('Закрыть выбор карты для друга', 'Close card choice for a friend'))}">${X}</button>
      <p>${esc(intent === 'postcard' ? tt('Выбери любую карту для открытки', 'Choose any card for the postcard') : tt('Выбери карту и напиши свою версию. Друг увидит её, когда ответит сам.', 'Choose a card and write your own take. Your friend will see it once they have answered.'))}</p></div>`;
  ctx.main.innerHTML = `<div class="wrap page">
    <div id="pick">${pickHtml()}</div>
    <div class="row between"><div><h1>${esc(tt('Галерея карт', 'Card gallery'))}</h1>
      <p class="muted gal-hint" ${intent ? 'hidden' : ''}>${esc(hintText())}</p></div>
      <div class="play-rows gal-acts" id="play">${diceButtonHtml()}<a class="btn light gal-play" href="${u('/games')}" ${intent ? 'hidden' : ''}><span>${esc(tt('Играть', 'Play'))}</span></a></div></div>
    ${cards.length ? `<div class="seg gal-order" role="radiogroup" aria-label="${esc(tt('Порядок карт', 'Card order'))}"><button type="button" role="radio" data-order="new" aria-checked="${order === 'new'}">${esc(tt('Сначала новые', 'Newest first'))}</button><button type="button" role="radio" data-order="mix" aria-checked="${order === 'mix'}">${esc(tt('Вперемешку', 'Shuffled'))}</button></div>
      <div class="grid" id="gal">${cards.map((c, i) => tileHtml(c, i)).join('')}</div>` : `<p class="empty">${esc(tt('В галерее пока нет карт.', 'No cards in the gallery yet.'))}</p>`}
    <div class="gallery-end"><a class="btn yellow big" href="${u('/start#join')}">${ic.people} ${esc(tt('Участвовать в проекте', 'Take part in the project'))}</a>
      <p class="muted small">${esc(tt('Предложить иллюстрацию, провести встречу, стать куратором', 'Suggest an illustration, host a meeting, become a curator'))}</p></div>
  </div>`;
  const openAt = (i, startQuestions = null) => openViewer({ cards, index: i, mode: 'library', startQuestions });
  const pc = ctx.main.querySelector('[data-pick-close]');
  if (pc) pc.addEventListener('click', () => {
    // подсказка исчезает без скачка: если она уже выше экрана, сдвигаем прокрутку на её высоту
    // (по первой видимой карте; в браузерах без привязки прокрутки, например Safari, — поправкой вручную)
    const anchor = [...ctx.main.querySelectorAll('.tile')].find((t) => t.getBoundingClientRect().bottom > 0);
    const y0 = anchor ? anchor.getBoundingClientRect().top : 0;
    intent = null; ctx.main.querySelector('#pick').innerHTML = '';
    ctx.main.querySelectorAll('.gal-hint, .play-two').forEach((x) => { x.hidden = false; }); // обычный вид: подсказка и игры возвращаются
    if (anchor) { const d = anchor.getBoundingClientRect().top - y0; if (Math.abs(d) > 1) window.scrollBy(0, d); }
    const q = new URL(location.href); q.searchParams.delete('play'); q.searchParams.delete('reply');
    history.replaceState(history.state, '', q.pathname + q.search + q.hash); // остаёмся в той же галерее, без перезагрузки
    const first = ctx.main.querySelector('.tile'); if (first) first.focus({ preventScroll: true });
  });
  // тап и кубик подчиняются одному активному режиму: просмотр, открытка или вопрос другу
  const choose = (i) => (intent ? ctx.navigate((intent === 'postcard' ? '/postcard/' : '/play/') + cards[i].code + (intent === 'friend' && ctx.query.get('reply') ? '?reply=' + encodeURIComponent(ctx.query.get('reply')) : '')) : openAt(i));
  const gal = ctx.main.querySelector('#gal');
  if (gal) gal.addEventListener('click', (e) => { const b = e.target.closest('.tile'); if (b) choose(Number(b.dataset.i)); });
  ctx.main.querySelectorAll('[data-order]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.order === order) return;
    order = b.dataset.order; ss.set('dc_gal_order', order); if (order === 'mix') ss.set('dc_gal_mix', ''); // «Вперемешку» — каждый раз новое перемешивание
    cards = order === 'mix' ? mixed() : byDate;
    gal.innerHTML = cards.map((c, i) => tileHtml(c, i)).join('');
    ctx.main.querySelectorAll('[data-order]').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.order === order)));
    const h = ctx.main.querySelector('.gal-hint'); if (h) h.textContent = hintText();
  }));
  // Случайное открытие — только просмотр (или выбор в режиме): счётчик выборов не меняется.
  wireDice(ctx.main.querySelector('#rnd'), () => cards.length && choose(Math.floor(Math.random() * cards.length)), ctx.alive);
  openFromQuery(cards, openAt);
}

// ---------- страница карты и обсуждение ----------
export async function cardPage(ctx, code) {
  loading(ctx.main);
  let card; let comments;
  try { [card, { comments }] = await Promise.all([api(`/api/cards/${code}`), api(`/api/cards/${code}/comments`)]); } catch (e) {
    if (!ctx.alive()) return;
    if (e.status === 404) { ctx.main.innerHTML = `<div class="wrap page narrow"><div class="empty">${esc(tt('Карта не найдена или снята с публикации. Её комментарии недоступны.', 'Card not found or removed. Its discussion is not available.'))}</div></div>`; return; }
    return failed(ctx.main, e, ctx.rerender);
  }
  if (!ctx.alive()) return;
  const draw = () => {
    ctx.main.innerHTML = `<div class="wrap page"><div class="card-page">
      <div><button class="art" type="button" id="art" aria-label="${esc(tt('Рассмотреть', 'View'))}"><img src="${esc(card.full)}" alt="${esc(card.code)}" width="${card.width}" height="${card.height}"></button></div>
      <div class="stack">
        <a href="${u('/library')}" class="small">← ${esc(tt('Галерея', 'Gallery'))}</a>
        <h1>${esc(card.code)} ${card.isDemo ? '<span class="pill demo">демо</span>' : ''}</h1>
        <div class="card-ui flat"><dl class="sheet-list" style="margin:0">
          <div><dt>${esc(tt('Автор', 'Author'))}</dt><dd>${esc(card.author || tt('будет указан', 'to be added'))}</dd></div>
          <div><dt>${esc(tt('В галерее с', 'In the gallery since'))}</dt><dd>${esc(fmtDate(card.publishedAt))}</dd></div>
          <div><dt>${esc(tt('Выбрали для разговора', 'Chosen for a conversation'))}</dt><dd>${esc(tt(`${card.selectedCount} ${ruPlural(card.selectedCount, 'раз', 'раза', 'раз')}`, `${card.selectedCount} ${card.selectedCount === 1 ? 'time' : 'times'}`))}</dd></div>
        </dl></div>
        <h2>${esc(tt('Комментарии', 'Comments'))} <span class="muted" style="font-size:1rem">(${comments.length})</span></h2>
        <p class="small muted">${esc(tt('Читать может каждый. Писать — после входа, под выбранным именем.', 'Anyone can read. Sign in to write, under the name you choose.'))}
          ${esc(tt('Встроенный перевод сообщений пока не подключён — кнопка «Перевести» открывает внешний переводчик.', 'Built-in translation is not connected yet — “Translate” opens an external translator.'))}</p>
        <div class="list" id="comments">${comments.length ? comments.map((c) => `<article class="comment"><header><b>${esc(c.author)}</b><span>${esc(fmtDate(c.createdAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</span>${c.isDemo ? '<span class="pill demo">демо</span>' : ''}
            <a class="linkbtn" target="_blank" rel="noopener" href="https://translate.google.com/?sl=auto&tl=${tt('ru', 'en')}&text=${encodeURIComponent(c.text)}&op=translate">${esc(tt('Перевести', 'Translate'))}</a>
            ${c.mine || (session.user && session.user.roles.includes('admin')) ? `<button class="linkbtn danger" type="button" data-del="${c.id}">${esc(tt('Удалить', 'Delete'))}</button>` : ''}</header>
            <p>${esc(c.text)}</p></article>`).join('') : `<p class="empty">${esc(tt('Пока никто не написал. Можно начать первым.', 'Nobody has written yet. You can be the first.'))}</p>`}</div>
        ${session.user ? `<form class="form" id="cform"><label class="field">${esc(tt('Ваше сообщение', 'Your message'))} <span class="hint">${esc(tt('Подпись:', 'Signed as:'))} ${esc(session.user.publicName)}</span>
            <textarea name="text" maxlength="2000" required></textarea></label><div><button class="btn dark" type="submit">${esc(tt('Отправить', 'Post'))}</button></div></form>`
          : `<a class="btn dark" href="${u('/login?next=' + encodeURIComponent('/cards/' + card.code))}">${esc(tt('Войти, чтобы написать', 'Sign in to write'))}</a>`}
      </div></div></div>`;
    ctx.main.querySelector('#art').addEventListener('click', () => openViewer({ cards: [card], index: 0, mode: 'admin', simple: true }));
    const f = ctx.main.querySelector('#cform');
    if (f) f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api(`/api/cards/${code}/comments`, { method: 'POST', body: { text: f.text.value } }); ({ comments } = await api(`/api/cards/${code}/comments`)); draw(); toast(tt('Сообщение опубликовано', 'Message posted')); }
      catch (err) { toast(errorText(err)); }
    });
    ctx.main.querySelector('#comments').addEventListener('click', async (e) => {
      const d = e.target.closest('[data-del]'); if (!d) return;
      try { await api(`/api/comments/${d.dataset.del}`, { method: 'DELETE' }); ({ comments } = await api(`/api/cards/${code}/comments`)); draw(); } catch (err) { toast(errorText(err)); }
    });
  };
  draw();
}

// ---------- «Знакомство с Dialogue Cards» (21.11.2026): единая страница о проекте ----------
// Раскрывающиеся «Что такое Dialogue Cards?» и «Что такое Dialogue Flow?», завершающая подпись и блоки участия.
// Входы: /start — с начала, /start#join — сразу у «Хотите присоединиться…», /start#flow — открыт блок о Dialogue Flow.
// Прежние адреса /about и /about/flow ведут сюда же.
export async function start(ctx) {
  const more = [
    ['/artist/about', ic.picPlus, 'Предложить иллюстрацию', 'Suggest an illustration', 'Отправьте свою работу кураторам', 'Send your work to the curators'],
    ['/facilitator/about', ic.people, 'Провести встречу', 'Host a meeting', 'Узнайте, как проводить встречи Dialogue Flow', 'Find out how to host Dialogue Flow meetings'],
    ['/curator/apply', ic.picCheck, 'Стать куратором', 'Become a curator', 'Подайте заявку, чтобы помогать отбирать работы для галереи', 'Apply to help choose works for the gallery'],
  ];
  const hash = location.hash.slice(1);
  let assets = { pdf: false };
  try { assets = await api('/api/guides/project/assets'); } catch { /* без документа */ }
  if (!ctx.alive()) return;
  ctx.main.innerHTML = `<div class="wrap page stack about-page">
    <div><p class="eyebrow">Dialogue Cards</p><h1>${esc(tt('Знакомство с Dialogue Cards', 'Discover Dialogue Cards'))}</h1></div>
    <div class="about-blocks">
      <details class="about-big yellow" id="cards" ${hash === 'cards' ? 'open' : ''}><summary><span class="ic">${ic.cards}</span><b>${esc(tt('Что такое Dialogue Cards?', 'What are Dialogue Cards?'))}</b><span class="chev" aria-hidden="true">▾</span></summary>
        <div class="about-intro">${paras(ABOUT_CARDS)}</div></details>
      <details class="about-big navy" id="flow" ${hash === 'flow' ? 'open' : ''}><summary><span class="ic">${ic.calendar}</span><b>${esc(tt('Что такое Dialogue Flow?', 'What is Dialogue Flow?'))}</b><span class="chev" aria-hidden="true">▾</span></summary>
        <div class="about-intro">${paras(ABOUT_FLOW)}
          <h3>${esc(tt('Как проходит встреча', 'How a meeting goes'))}</h3>
          <ol class="steps">
            <li>${esc(tt('Фасилитатор знакомит участников с форматом.', 'The facilitator introduces the format.'))}</li>
            <li>${esc(tt('Участники выбирают карты и общаются в парах. Карта помогает начать диалог, а дальше он продолжается в естественном потоке.', 'Participants choose cards and talk in pairs. The card helps start the dialogue, and then it carries on in a natural flow.'))}</li>
            <li>${esc(tt('В конце участники по желанию делятся впечатлениями.', 'At the end, participants share their impressions if they wish.'))}</li>
          </ol></div></details>
    </div>
    <p class="about-closing">${esc(tt(ABOUT_CLOSING.ru, ABOUT_CLOSING.en))}</p>
    ${assets.pdf ? `<a class="small" href="${u('/guides/project/guide.pdf')}" download>${esc(tt('Полный документ о проекте (PDF)', 'The full project document (PDF)'))}</a>` : ''}
    <section class="join-block" id="join">
      <h2>${esc(tt('Хотите присоединиться к проекту?', 'Would you like to join the project?'))}</h2>
      <div class="list">${more.map(([href, icon, ru, en, dru, den]) => `<a class="item" href="${u(href)}"><span class="ic">${icon}</span><span class="body"><b>${esc(tt(ru, en))}</b><span class="small">${esc(tt(dru, den))}</span></span><span>→</span></a>`).join('')}</div>
    </section>
  </div>`;
  // переход к нужной части: заголовок не прячется под закреплённой верхней панелью (scroll-margin)
  if (hash === 'join' || hash === 'flow' || hash === 'cards') requestAnimationFrame(() => { const t = ctx.main.querySelector('#' + hash); if (t) t.scrollIntoView({ block: 'start' }); });
  else window.scrollTo(0, 0);
}
// прежние адреса страницы о проекте
export function about(ctx) { ctx.navigate('/start', { replace: true }); }
export function aboutFlow(ctx) { ctx.navigate('/start#flow', { replace: true }); }

// ---------- «Провести встречу»: что нужно будущему фасилитатору ----------
export function facilitatorAbout(ctx) {
  const steps = [
    [tt('Войдите по email', 'Sign in with email'), tt('Простой вход без пароля.', 'A simple sign-in, no password.')],
    [tt('Прочитайте руководство фасилитатора', 'Read the facilitator guide'), tt('Формат встреч, роль фасилитатора и подготовка встречи.', 'The meeting format, the facilitator’s role and preparing a meeting.')],
    [tt('Пройдите проверку знаний', 'Take the knowledge check'), tt('Несколько вопросов по руководству.', 'A few questions on the guide.')],
    [tt('Подайте заявку', 'Apply'), tt('Пара слов о себе и о городе, где хотите проводить встречи.', 'A few words about yourself and the city where you want to host meetings.')],
    [tt('Дождитесь одобрения заявки', 'Wait for approval'), tt('После одобрения вы сможете создавать встречи и подборки карт для них.', 'Once approved, you can create meetings and card selections for them.')],
  ];
  ctx.main.innerHTML = `<div class="wrap page narrow stack">
    <div class="page-head"><h1>${esc(tt('Проводите встречи Dialogue Flow в своём городе', 'Host Dialogue Flow meetings in your city'))}</h1></div>
    <p class="lead" style="margin:0">${esc(tt('Соберите людей для живого диалога. Участники выбирают карты и беседуют в парах. Карты помогают начать разговор, а дальше он развивается свободно.', 'Bring people together for a living dialogue. Participants choose cards and talk in pairs. The cards help start the conversation, and then it develops freely.'))}</p>
    <p class="callout">${esc(tt('Опыт проведения встреч не нужен', 'No experience of hosting meetings is needed'))}</p>
    <section class="become card-ui stack" aria-labelledby="bf">
      <h2 id="bf" style="margin:0">${esc(tt('Как стать фасилитатором?', 'How to become a facilitator?'))}</h2>
      <p class="muted" style="margin:0">${esc(tt('Фасилитатор — человек, который проводит встречи и помогает участникам начать диалог.', 'A facilitator is a person who hosts meetings and helps participants start a dialogue.'))}</p>
      <ol class="path">${steps.map(([t1, t2]) => `<li><b>${esc(t1)}</b><span>${esc(t2)}</span></li>`).join('')}</ol>
      <div><a class="btn yellow big" href="${u('/facilitator/apply')}">${esc(tt('Начать путь фасилитатора', 'Start the facilitator path'))}</a></div>
    </section>
    <p class="already">${esc(tt('Уже фасилитатор?', 'Already a facilitator?'))} <a href="${u('/facilitator')}">${esc(tt('Перейти в кабинет', 'Go to your space'))}</a></p>
  </div>`;
}

// ---------- «Стать куратором»: описание роли и заявка ----------
export async function curatorApply(ctx) {
  loading(ctx.main);
  let info = null;
  if (session.user) { try { info = await api('/api/curator/application'); } catch (e) { return failed(ctx.main, e, ctx.rerender); } }
  if (!ctx.alive()) return;
  const app = info && info.application;
  const intro = `
    <div class="page-head"><h1>${esc(tt('Стать куратором', 'Become a curator'))}</h1></div>
    <p class="lead" style="margin:0">${esc(tt('Кураторы помогают отбирать иллюстрации для коллекции Dialogue Cards.', 'Curators help choose illustrations for the Dialogue Cards collection.'))}</p>
    <ul class="icon-lines">
      <li>${ic.picCheck}<span>${esc(tt('Куратор рекомендует работу к публикации или возвращает её автору и объясняет причину. Окончательно работу публикует администратор.', 'A curator recommends a work for publication or returns it to the author and explains why. The administrator makes the final publishing decision.'))}</span></li>
      <li>${ic.chat}<span>${esc(tt('Спорные работы можно обсудить с коллегами в чате кураторов.', 'Difficult works can be discussed with colleagues in the curators’ chat.'))}</span></li>
    </ul>`;
  let body;
  if (!session.user) {
    body = `<div class="card-ui stack"><h2>${esc(tt('Подайте заявку', 'Apply'))}</h2><p class="muted" style="margin:0">${esc(tt('Чтобы отправить заявку, войдите: так администратор сможет связаться с вами и выдать роль.', 'Sign in to apply: that is how the administrator can reach you and grant the role.'))}</p>
      <div class="row"><a class="btn dark" href="${u('/login?next=' + encodeURIComponent('/curator/apply'))}">${esc(tt('Войти', 'Sign in'))}</a></div></div>`;
  } else if (info.isCurator) {
    body = `<div class="card-ui stack"><h2>${esc(tt('Вы уже куратор', 'You are already a curator'))}</h2><a class="btn dark" href="${u('/curator')}">${esc(tt('К работам на рассмотрении', 'To works under review'))}</a></div>`;
  } else if (app && app.status === 'submitted') {
    body = `<div class="card-ui stack"><span class="pill mint" style="justify-self:start">${esc(tt('Заявка отправлена', 'Application sent'))}</span><h2>${esc(tt('Спасибо! Заявка у администратора', 'Thank you! The administrator has your application'))}</h2>
      <p class="muted" style="margin:0">${esc(tt('Когда её рассмотрят и выдадут роль, здесь и в меню появится кабинет куратора.', 'Once it is reviewed and the role is granted, the curator space will appear here and in the menu.'))}</p></div>`;
  } else {
    const v = app || { name: session.user.name, contact: session.user.email || '', motivation: '' };
    body = `<form class="card-ui form" id="cf"><h2 style="margin:0">${esc(tt('Заявка', 'Application'))}</h2>
      ${app && app.status === 'rejected' ? `<div class="notice"><b>${esc(tt('Прошлая заявка не одобрена.', 'The previous application was not approved.'))}</b> ${esc(app.decisionNote || '')} ${esc(tt('Можно отправить новую.', 'You can send a new one.'))}</div>` : ''}
      <label class="field">${esc(tt('Имя', 'Name'))} *<input type="text" name="name" required maxlength="100" value="${esc(v.name)}"></label>
      <label class="field">${esc(tt('Контакт', 'Contact'))} * <span class="hint">${esc(tt('email, Telegram или телефон — как с вами связаться', 'email, Telegram or phone — how to reach you'))}</span><input type="text" name="contact" required maxlength="200" value="${esc(v.contact)}"></label>
      <label class="field">${esc(tt('Почему вы хотите участвовать?', 'Why do you want to take part?'))} *<textarea name="motivation" required maxlength="2000" rows="5">${esc(v.motivation)}</textarea></label>
      <p class="form-error" id="err" role="alert"></p>
      <div><button class="btn yellow" type="submit">${esc(tt('Отправить заявку', 'Send application'))}</button></div></form>`;
  }
  ctx.main.innerHTML = `<div class="wrap page narrow stack">${intro}${body}</div>`;
  const f = ctx.main.querySelector('#cf');
  if (f) f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/curator/application', { method: 'POST', body: { name: f.name.value, contact: f.contact.value, motivation: f.motivation.value } }); toast(tt('Заявка отправлена', 'Application sent')); ctx.rerender(); }
    catch (x) { ctx.main.querySelector('#err').textContent = errorText(x); }
  });
}
function timelineBlock(items) {
  return `<ol class="timeline">${items.map(([t1, t2], i) => `<li class="${i === 0 ? 'now' : 'todo'}"><span class="dot"></span><b>${esc(t1)}</b>${t2 ? `<div class="small">${esc(t2)}</div>` : ''}</li>`).join('')}</ol>`;
}

// ---------- условия публикации (демо-текст) ----------
export function terms(ctx) {
  ctx.main.innerHTML = `<div class="wrap page narrow stack">
    <p class="eyebrow">${esc(tt('Условия публикации', 'Publication terms'))} · ${esc(session.config.termsVersion || '')}</p>
    <h1>${esc(tt('Условия публикации работ', 'Terms for publishing works'))}</h1>
    <div class="notice demo"><b>${esc(tt('Черновик, не юридический документ.', 'Draft, not a legal document.'))}</b> ${esc(tt('Окончательный текст готовится: в нём будут указаны получатель разрешения, способы использования, срок, территория и порядок прекращения показа, работы с использованием AI и права на исходные материалы.', 'The final text is being prepared: it will name the recipient of the permission, the ways of use, term, territory and how to stop the online display, AI-assisted works and rights to source materials.'))}</div>
    <div class="card-ui stack">
      <h3>${esc(tt('Коротко (текст галочки при подаче)', 'In short (the checkbox text)'))}</h3>
      <p>${esc(tt('Я принимаю условия публикации и разрешаю бесплатно показывать эту работу в галерее Dialogue Cards и в подборках для встреч Dialogue Flow. Использование работы в печатной колоде согласуется со мной отдельно.', 'I accept the publication terms and allow this work to be shown free of charge in the Dialogue Cards gallery and in selections for Dialogue Flow meetings. Use of the work in a printed deck will be agreed with me separately.'))}</p>
      <h3>${esc(tt('Направление (предложение, не утверждено)', 'Direction (proposal, not approved)'))}</h3>
      <ul><li>${esc(tt('Безвозмездная неисключительная лицензия на показ на сайте и на встречах.', 'A free non-exclusive licence to show the work on the site and at meetings.'))}</li>
        <li>${esc(tt('Права на работу остаются у автора.', 'The author keeps the rights to the work.'))}</li>
        <li>${esc(tt('Печать — только по отдельному согласованию с автором.', 'Printing only by separate agreement with the author.'))}</li>
        <li>${esc(tt('Автор может сам убрать свою работу с сайта.', 'The author can remove their work from the site themselves.'))}</li>
        <li>${esc(tt('Согласие не означает отказа от выплат за будущие способы использования.', 'Consent does not waive payment for future ways of use.'))}</li></ul>
      <p class="small muted">${esc(tt('Сайт записывает версию условий и время согласия к каждой отправке работ.', 'The site records the terms version and the time of consent for every submission.'))}</p>
    </div></div>`;
}

// ---------- полный текст соглашения с авторами (25.11.2026): действующая редакция или конкретная, принятая автором ----------
export async function termsAuthors(ctx, id) {
  loading(ctx.main);
  let ed = null;
  try { ed = id ? (await api(`/api/terms/editions/${encodeURIComponent(id)}`)).edition : (await loadTerms()).edition; }
  catch (e) { if (e.status !== 404) return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  if (!ed) { ctx.main.innerHTML = `<div class="wrap page narrow"><p class="empty">${esc(tt('Новая редакция условий для авторов ещё не опубликована.', 'The new version of the terms for authors has not been published yet.'))}</p><a href="${u('/terms')}">${esc(tt('Действующие условия публикации', 'Current publication terms'))}</a></div>`; return; }
  const cur = (await loadTerms().catch(() => ({}))).edition;
  ctx.main.innerHTML = `<div class="wrap page narrow stack">
    ${ed.status !== 'published' ? `<p class="notice demo small">${esc(tt('Черновик для администрации — не опубликован.', 'Draft for the administration — not published.'))}</p>` : ''}
    ${cur && cur.id !== ed.id && ed.status === 'published' ? `<p class="notice small">${esc(tt('Это прежняя редакция — та, которую вы приняли.', 'This is an earlier version — the one you accepted.'))} <a href="${u('/terms/authors')}">${esc(tt('Действующая редакция', 'Current version'))}</a></p>` : ''}
    ${ed.translationPending ? `<p class="notice small">${esc('The English translation is under review. The original Russian text is shown.')}</p>` : ''}
    <article class="at-doc">${fullHtml(ed.body)}</article></div>`;
}
