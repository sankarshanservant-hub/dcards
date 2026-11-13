import { monthLabel } from '../i18n.js';
import { esc, tt, u, api, toast, errorText, fmtDate } from '../util.js';
import { openViewer } from '../viewer.js';
import { session, ic, tileHtml, loading, failed } from '../ui.js';

const openFromQuery = (cards, openAt) => {
  const code = new URL(location.href).searchParams.get('card');
  if (!code) return;
  const i = cards.findIndex((c) => c.code === code);
  if (i >= 0) openAt(i); else history.replaceState({}, '', location.pathname);
};

// ---------- главная ----------
// Четыре способа присоединиться (главная и страница участника). Карточка целиком — ссылка; пиктограмма статичная.
const JOIN = [
  ['/meetings', 'chat', 'Найти встречу', 'Find a meeting', 'Приходите на Dialogue Flow, чтобы познакомиться и поговорить с другими участниками', 'Come to Dialogue Flow to meet and talk with other participants'],
  ['/facilitator/about', 'people', 'Провести встречу', 'Host a meeting', 'Узнайте, как стать фасилитатором и провести Dialogue Flow в своём городе', 'Find out how to become a facilitator and host Dialogue Flow in your city'],
  ['/artist/submit', 'picPlus', 'Предложить иллюстрацию', 'Suggest an illustration', 'Есть работа, с которой может начаться разговор? Покажите её кураторам', 'Have a piece that could start a conversation? Show it to the curators'],
  ['/curator/apply', 'picCheck', 'Стать куратором', 'Become a curator', 'Помогайте отбирать иллюстрации для коллекции Dialogue Cards', 'Help choose illustrations for the Dialogue Cards collection'],
];
export async function home(ctx) {
  ctx.main.innerHTML = `
    <section class="hero"><div class="wrap">
      <div>
        <h1>Dialogue Cards</h1>
        <p class="lead">${esc(tt('Рады, что вы заглянули. Откройте любую карту и посмотрите, что в ней откликнется вам. Иногда одной иллюстрации достаточно, чтобы начать разговор.', 'Glad you stopped by. Open any card and see what speaks to you. Sometimes a single illustration is enough to start a conversation.'))}</p>
        <div class="row"><a class="btn yellow" href="${u('/library')}">${esc(tt('Смотреть карты', 'View cards'))}</a></div>
      </div>
      <div class="fan" id="fan" aria-hidden="true"><div class="sun"></div></div>
    </div></section>
    <section class="wrap band" id="join">
      <h2>${esc(tt('Присоединяйтесь', 'Join in'))}</h2>
      <div class="roles">${JOIN.map(([href, icon, ru, en, dru, den]) => `<a class="role" href="${u(href)}"><span class="role-head"><span class="ic">${ic[icon]}</span><b>${esc(tt(ru, en))}</b></span><p>${esc(tt(dru, den))}</p></a>`).join('')}</div>
    </section>
    <section class="wrap band" style="padding-top:0">
      <h2>${esc(tt('Как проходит встреча Dialogue Flow', 'How a Dialogue Flow meeting works'))}</h2>
      <ol class="how" style="padding:0;margin:0">
        <li><span class="n">1</span><span>${esc(tt('Фасилитатор знакомит с форматом и создаёт условия для разговора.', 'The facilitator introduces the format and creates the conditions for talking.'))}</span></li>
        <li><span class="n">2</span><span>${esc(tt('Участники открывают подборку карт по QR-коду и выбирают карту для обсуждения. Основной разговор — между участниками, часто в парах.', 'Participants open the card selection via QR code and choose a card to talk about. Most of the conversation is between participants, often in pairs.'))}</span></li>
        <li><span class="n">3</span><span>${esc(tt('Встреча заканчивается завершающим кругом. Это человеческое общение, а не терапия и не обучение.', 'The meeting ends with a closing circle. It is human conversation, not therapy or training.'))}</span></li>
      </ol>
    </section>`;
  try {
    const { cards } = await api('/api/cards');
    if (!ctx.alive()) return;
    const pool = cards.filter((c) => !c.isDemo); const picks = [];
    while (picks.length < 3 && pool.length) picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    ctx.main.querySelector('#fan').insertAdjacentHTML('beforeend', picks.map((c) => `<img src="${esc(c.thumb)}" alt="" width="${c.width}" height="${c.height}">`).join(''));
  } catch { /* украшение */ }
}

// ---------- библиотека ----------
export async function library(ctx) {
  loading(ctx.main);
  let cards;
  try { ({ cards } = await api('/api/cards')); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  const groups = [];
  for (const [i, c] of cards.entries()) {
    const label = monthLabel(c.publishedAt);
    if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, items: [] });
    groups[groups.length - 1].items.push([c, i]);
  }
  ctx.main.innerHTML = `<div class="wrap page">
    <div class="row between"><div><h1>${esc(tt('Галерея карт', 'Card gallery'))}</h1>
      <p class="muted">${esc(tt(`${cards.length} карт · новые сверху · нажмите на карту, чтобы рассмотреть её`, `${cards.length} cards · newest first · tap a card to see it up close`))}</p></div>
      <button class="btn dark sm" type="button" id="rnd">${ic.dice} ${esc(tt('Случайная карта', 'Random card'))}</button></div>
    ${cards.length ? groups.map((g) => `<h2 class="month-title">${esc(g.label)}</h2><div class="grid">${g.items.map(([c, i]) => tileHtml(c, i)).join('')}</div>`).join('') : `<p class="empty">${esc(tt('В галерее пока нет карт.', 'No cards in the gallery yet.'))}</p>`}
  </div>`;
  const openAt = (i) => openViewer({ cards, index: i, mode: 'library' });
  ctx.main.querySelectorAll('.tile').forEach((b) => b.addEventListener('click', () => openAt(Number(b.dataset.i))));
  ctx.main.querySelector('#rnd').addEventListener('click', () => cards.length && openAt(Math.floor(Math.random() * cards.length)));
  openFromQuery(cards, openAt);
}

// ---------- страница карты и обсуждение ----------
export async function cardPage(ctx, code) {
  loading(ctx.main);
  let card; let comments;
  try { [card, { comments }] = await Promise.all([api(`/api/cards/${code}`), api(`/api/cards/${code}/comments`)]); } catch (e) {
    if (!ctx.alive()) return;
    if (e.status === 404) { ctx.main.innerHTML = `<div class="wrap page narrow"><div class="empty">${esc(tt('Карта не найдена или снята с публикации. Её обсуждение недоступно.', 'Card not found or removed. Its discussion is not available.'))}</div></div>`; return; }
    return failed(ctx.main, e, ctx.rerender);
  }
  if (!ctx.alive()) return;
  const draw = () => {
    ctx.main.innerHTML = `<div class="wrap page"><div class="card-page">
      <div><button class="art" type="button" id="art" aria-label="${esc(tt('Рассмотреть', 'View'))}"><img src="${esc(card.full)}" alt="${esc(card.code)}" width="${card.width}" height="${card.height}"></button></div>
      <div class="stack">
        <a href="${u('/library')}" class="small">← ${esc(tt('Галерея', 'Gallery'))}</a>
        <h1 style="font-size:clamp(2rem,5vw,3rem)">${esc(card.code)} ${card.isDemo ? '<span class="pill demo">демо</span>' : ''}</h1>
        <div class="card-ui flat"><dl class="sheet-list" style="margin:0">
          <div><dt>${esc(tt('Автор', 'Artist'))}</dt><dd>${esc(card.author || tt('будет указан', 'to be added'))}</dd></div>
          <div><dt>${esc(tt('В галерее с', 'In the gallery since'))}</dt><dd>${esc(fmtDate(card.publishedAt))}</dd></div>
          <div><dt>${esc(tt('Выбрали для обсуждения', 'Chosen for discussion'))}</dt><dd>${card.selectedCount}</dd></div>
        </dl></div>
        <h2>${esc(tt('Обсуждение', 'Discussion'))} <span class="muted" style="font-size:1rem">(${comments.length})</span></h2>
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
    ctx.main.querySelector('#art').addEventListener('click', () => openViewer({ cards: [card], index: 0, mode: 'admin' }));
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

// ---------- стартовая страница участника ----------
// Просмотр галереи и поиск встреч — без входа и без профиля; имя и email просят только при записи на встречу.
export function start(ctx) {
  const big = [
    ['/library', ic.cards, 'Смотреть карты', 'View cards', 'Откройте галерею и рассмотрите любую карту', 'Open the gallery and look at any card', 'yellow'],
    ['/meetings', ic.calendar, 'Найти встречу', 'Find a meeting', 'Посмотрите, где проходят ближайшие встречи Dialogue Flow', 'See where the next Dialogue Flow meetings are held', 'navy'],
  ];
  const more = [
    ['/artist/submit', ic.picPlus, 'Предложить иллюстрацию', 'Suggest an illustration', 'Отправьте свою работу кураторам', 'Send your work to the curators'],
    ['/facilitator/about', ic.people, 'Стать фасилитатором', 'Become a facilitator', 'Узнайте, как проводить встречи Dialogue Flow', 'Find out how to host Dialogue Flow meetings'],
    ['/curator/apply', ic.picCheck, 'Стать куратором', 'Become a curator', 'Подайте заявку, чтобы помогать отбирать работы для галереи', 'Apply to help choose works for the gallery'],
  ];
  ctx.main.innerHTML = `<div class="wrap page stack">
    <div><p class="eyebrow">Dialogue Cards</p><h1>${esc(tt('Знакомство с Dialogue Cards', 'Getting to know Dialogue Cards'))}</h1></div>
    <div class="big-actions">${big.map(([href, icon, ru, en, dru, den, tone]) => `<a class="big-action ${tone}" href="${u(href)}"><span class="ic">${icon}</span><b>${esc(tt(ru, en))}</b><span>${esc(tt(dru, den))}</span></a>`).join('')}</div>
    <section class="join-block" id="join">
      <h2>${esc(tt('Хотите присоединиться к проекту?', 'Want to join the project?'))}</h2>
      <div class="list">${more.map(([href, icon, ru, en, dru, den]) => `<a class="item" href="${u(href)}"><span class="ic">${icon}</span><span class="body"><b>${esc(tt(ru, en))}</b><span class="small">${esc(tt(dru, den))}</span></span><span>→</span></a>`).join('')}</div>
    </section>
  </div>`;
}

// ---------- «Провести встречу»: что нужно будущему фасилитатору ----------
export function facilitatorAbout(ctx) {
  const isFac = session.user && session.user.roles.some((r) => r === 'facilitator' || r === 'admin');
  ctx.main.innerHTML = `<section class="hero"><div class="wrap" style="grid-template-columns:1fr">
      <div><p class="eyebrow">${esc(tt('Фасилитаторам', 'For facilitators'))}</p><h1>${esc(tt('Проводите встречи Dialogue Flow', 'Host Dialogue Flow meetings'))}</h1>
      <p class="lead">${esc(tt('Фасилитатор создаёт условия для разговора: показывает подборку карт, а дальше говорят сами участники. Встречи можно проводить в своём городе.', 'A facilitator creates the conditions for a conversation: shows a card selection, and then the participants do the talking. You can host meetings in your own city.'))}</p></div></div></section>
    <div class="wrap page narrow stack"><div class="card-ui navy stack">
      <h2>${esc(tt('Как стать фасилитатором', 'How to become a facilitator'))}</h2>
      ${timelineBlock([
        [tt('Вход по email', 'Sign in with email'), tt('Имя и email, без пароля', 'Name and email, no password')],
        [tt('Вводный курс', 'Intro course'), tt('Главы руководства фасилитатора', 'Chapters of the facilitator guide')],
        [tt('Проверка знаний и заявка', 'Quiz and application'), ''],
        [tt('Одобрение администратором', 'Approval by an administrator'), tt('Открываются подборки карт и публикация встреч', 'Card selections and meeting publishing open up')],
      ])}
      <a class="btn yellow" href="${u(isFac ? '/facilitator' : '/facilitator/apply')}">${esc(isFac ? tt('В кабинет фасилитатора', 'Open the facilitator space') : tt('Начать путь фасилитатора', 'Start the facilitator path'))}</a></div></div>`;
}

// ---------- «Стать куратором»: описание роли и заявка ----------
export async function curatorApply(ctx) {
  loading(ctx.main);
  let info = null;
  if (session.user) { try { info = await api('/api/curator/application'); } catch (e) { return failed(ctx.main, e, ctx.rerender); } }
  if (!ctx.alive()) return;
  const app = info && info.application;
  const intro = `<div><p class="eyebrow">${esc(tt('Кураторам', 'For curators'))}</p><h1>${esc(tt('Стать куратором', 'Become a curator'))}</h1>
    <p class="lead">${esc(tt('Кураторы помогают отбирать иллюстрации для коллекции Dialogue Cards. Каждая работа рассматривается отдельно и по понятным критериям: куратор публикует её или возвращает художнику на доработку с объяснением. Спорные работы можно обсудить с коллегами.', 'Curators help choose illustrations for the Dialogue Cards collection. Each work is reviewed separately against clear criteria: a curator publishes it or returns it to the artist with an explanation. Difficult works can be discussed with colleagues.'))}</p></div>`;
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
      <div><button class="btn dark" type="submit">${esc(tt('Отправить заявку', 'Send application'))}</button></div></form>`;
  }
  ctx.main.innerHTML = `<section class="hero"><div class="wrap" style="grid-template-columns:1fr">${intro}</div></section><div class="wrap page narrow">${body}</div>`;
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
