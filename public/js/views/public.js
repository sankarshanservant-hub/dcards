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
export async function home(ctx) {
  const roles = [
    ['/library', ic.cards, 'Посетителям', 'Visitors', 'Смотрите всю библиотеку карт, открывайте карту крупно, читайте обсуждения.', 'Browse the whole card library, open a card up close, read the discussions.'],
    ['/meetings', ic.calendar, 'Участникам встреч', 'Meeting participants', 'Найдите встречу Dialogue Flow по стране и городу и запишитесь без аккаунта. На встрече откройте подборку по QR-коду.', 'Find a Dialogue Flow meeting by country and city and sign up without an account. At the meeting, open the selection via QR code.'],
    ['/artist', ic.brush, 'Художникам', 'Artists', 'Подайте свои работы: кураторы рассмотрят каждую отдельно, по понятным критериям.', 'Submit your works: curators review each one separately against clear criteria.'],
    ['/facilitator/apply', ic.people, 'Фасилитаторам', 'Facilitators', 'Пройдите вводный курс и подайте заявку. После одобрения — подборки карт и публикация своих встреч.', 'Take the intro course and apply. Once approved — card selections and publishing your own meetings.'],
  ];
  ctx.main.innerHTML = `
    <section class="hero"><div class="wrap">
      <div>
        <img class="hero-logo" src="${u('/img/logo-white.webp')}" alt="Dialogue Cards" width="900" height="434">
        <h1>${esc(tt('Иллюстрации для живого разговора', 'Illustrations for real conversation'))}</h1>
        <p class="lead">${esc(tt('Карты помогают замечать собственные ассоциации и говорить о жизненном опыте. Разные люди могут увидеть в одной иллюстрации похожие или совсем разные смыслы.', 'The cards help people notice their own associations and talk about life experience. Different people may see similar or entirely different meanings in the same illustration.'))}</p>
        <div class="row"><a class="btn yellow" href="${u('/library')}">${esc(tt('Смотреть карты', 'Browse the cards'))}</a><a class="btn light" href="${u('/meetings')}">${esc(tt('Найти встречу', 'Find a meeting'))}</a></div>
      </div>
      <div class="fan" id="fan" aria-hidden="true"><div class="sun"></div></div>
    </div></section>
    <section class="wrap band">
      <p class="eyebrow">${esc(tt('Кто участвует', 'Who takes part'))}</p>
      <h2>${esc(tt('Найдите свой путь', 'Find your way in'))}</h2>
      <div class="roles">${roles.map(([href, icon, ru, en, dru, den]) => `<a class="role" href="${u(href)}"><span class="ic">${icon}</span><b>${esc(tt(ru, en))}</b><p>${esc(tt(dru, den))}</p><span class="go">${esc(tt('Перейти', 'Open'))} →</span></a>`).join('')}</div>
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
    <div class="row between"><div><h1>${esc(tt('Библиотека карт', 'Card library'))}</h1>
      <p class="muted">${esc(tt(`${cards.length} карт · новые сверху · нажмите на карту, чтобы рассмотреть её`, `${cards.length} cards · newest first · tap a card to see it up close`))}</p></div>
      <button class="btn dark sm" type="button" id="rnd">${ic.dice} ${esc(tt('Случайная карта', 'Random card'))}</button></div>
    ${cards.length ? groups.map((g) => `<h2 class="month-title">${esc(g.label)}</h2><div class="grid">${g.items.map(([c, i]) => tileHtml(c, i)).join('')}</div>`).join('') : `<p class="empty">${esc(tt('В библиотеке пока нет карт.', 'No cards yet.'))}</p>`}
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
        <a href="${u('/library')}" class="small">← ${esc(tt('Библиотека', 'Library'))}</a>
        <h1 style="font-size:clamp(2rem,5vw,3rem)">${esc(card.code)} ${card.isDemo ? '<span class="pill demo">демо</span>' : ''}</h1>
        <div class="card-ui flat"><dl class="sheet-list" style="margin:0">
          <div><dt>${esc(tt('Автор', 'Artist'))}</dt><dd>${esc(card.author || tt('будет указан', 'to be added'))}</dd></div>
          <div><dt>${esc(tt('В библиотеке с', 'In the library since'))}</dt><dd>${esc(fmtDate(card.publishedAt))}</dd></div>
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

// ---------- участвовать ----------
export function join(ctx) {
  ctx.main.innerHTML = `<section class="hero"><div class="wrap" style="grid-template-columns:1fr">
      <div><p class="eyebrow">${esc(tt('Участвовать', 'Take part'))}</p><h1>${esc(tt('Художникам и фасилитаторам', 'For artists and facilitators'))}</h1>
      <p class="lead">${esc(tt('Dialogue Cards объединяет художников, кураторов, фасилитаторов и участников встреч. Выберите свой путь.', 'Dialogue Cards brings together artists, curators, facilitators and meeting participants. Choose your path.'))}</p></div></div></section>
    <div class="wrap page"><div class="cols-2">
      <div class="card-ui stack"><span class="pill yellow" style="justify-self:start">${esc(tt('Художникам', 'Artists'))}</span>
        <h2>${esc(tt('Ваши работы — в библиотеке', 'Your works in the library'))}</h2>
        ${timelineBlock([
          [tt('Вход по email', 'Sign in with email'), tt('Имя и email, без пароля', 'Name and email, no password')],
          [tt('Согласие с условиями', 'Accept the terms'), tt('Галочка перед отправкой, ссылка на условия', 'A checkbox before sending, with a link to the terms')],
          [tt('Подача одной или нескольких работ', 'Submit one or more works'), tt('Каждая получает свой статус', 'Each gets its own status')],
          [tt('Решение куратора', 'Curator’s decision'), tt('Опубликовано — или причины по критериям', 'Published — or reasons by criteria')],
        ])}
        <a class="btn dark" href="${u('/artist/submit')}">${esc(tt('Подать работы', 'Submit works'))}</a></div>
      <div class="card-ui navy stack"><span class="pill yellow" style="justify-self:start">${esc(tt('Фасилитаторам', 'Facilitators'))}</span>
        <h2>${esc(tt('Проводите встречи Dialogue Flow', 'Host Dialogue Flow meetings'))}</h2>
        ${timelineBlock([
          [tt('Вход по email', 'Sign in with email'), ''],
          [tt('Вводный курс', 'Intro course'), tt('Главы руководства фасилитатора', 'Chapters of the facilitator guide')],
          [tt('Проверка знаний и заявка', 'Quiz and application'), ''],
          [tt('Одобрение администратором', 'Approval by an administrator'), tt('Открываются подборки карт и публикация встреч', 'Card selections and meeting publishing open up')],
        ])}
        <a class="btn yellow" href="${u('/facilitator/apply')}">${esc(tt('Начать путь фасилитатора', 'Start the facilitator path'))}</a></div>
    </div>
    <div class="card-ui flat" style="margin-top:16px"><h3>${esc(tt('Кураторы и администраторы', 'Curators and administrators'))}</h3>
      <p class="muted" style="margin:0">${esc(tt('Роль куратора и администратора выдаёт администратор проекта. Как именно выдаются роли и что входит в курс — ещё уточняется с владельцем проекта.', 'Curator and administrator roles are granted by the project administrator. How roles are granted and what the course includes is still being agreed with the project owner.'))}</p></div>
  </div>`;
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
      <p>${esc(tt('Я принимаю условия публикации и разрешаю бесплатно показывать эту работу в библиотеке Dialogue Cards и в подборках для встреч Dialogue Flow. Использование работы в печатной колоде согласуется со мной отдельно.', 'I accept the publication terms and allow this work to be shown free of charge in the Dialogue Cards library and in selections for Dialogue Flow meetings. Use of the work in a printed deck will be agreed with me separately.'))}</p>
      <h3>${esc(tt('Направление (предложение, не утверждено)', 'Direction (proposal, not approved)'))}</h3>
      <ul><li>${esc(tt('Безвозмездная неисключительная лицензия на показ на сайте и на встречах.', 'A free non-exclusive licence to show the work on the site and at meetings.'))}</li>
        <li>${esc(tt('Права на работу остаются у автора.', 'The author keeps the rights to the work.'))}</li>
        <li>${esc(tt('Печать — только по отдельному согласованию с автором.', 'Printing only by separate agreement with the author.'))}</li>
        <li>${esc(tt('Автор может сам убрать свою работу с сайта.', 'The author can remove their work from the site themselves.'))}</li>
        <li>${esc(tt('Согласие не означает отказа от выплат за будущие способы использования.', 'Consent does not waive payment for future ways of use.'))}</li></ul>
      <p class="small muted">${esc(tt('Сайт записывает версию условий и время согласия к каждой отправке работ.', 'The site records the terms version and the time of consent for every submission.'))}</p>
    </div></div>`;
}
