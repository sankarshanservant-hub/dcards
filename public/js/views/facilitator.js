// Фасилитатор: кабинет (подборки, встречи, записи), редактор подборки, редактор встречи, путь получения роли.
import { esc, tt, u, api, errorText, toast, fmtTz, fmtDate } from '../util.js';
import { openViewer, icons } from '../viewer.js';
import { session, hasRole, needLogin, noRole, loading, failed, demoPill, timeline, stepsBar, ic, showQr, refreshSession } from '../ui.js';
import { langName, LANG_NAMES } from './meetings.js';

const MSTATUS = { published: ['Опубликована', 'Published', 'mint'], unpublished: ['Скрыта', 'Hidden', ''], removed: ['Снята администратором', 'Taken down by admin', 'red'] };
const mPill = (s) => { const x = MSTATUS[s] || [s, s, '']; return `<span class="pill ${x[2]}">${esc(tt(x[0], x[1]))}</span>`; };

export async function cabinet(ctx) {
  if (!session.user) return needLogin(ctx.main, tt('Кабинет фасилитатора.', 'Facilitator space.'));
  if (!hasRole('facilitator')) { ctx.navigate('/facilitator/apply', { replace: true }); return; }
  loading(ctx.main);
  let cols; let mts;
  try { [cols, mts] = await Promise.all([api('/api/collections'), api('/api/fac/meetings')]); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  const nowIso = new Date().toISOString();
  const upcomingRegs = mts.meetings.reduce((n, m) => n + m.dates.filter((d) => d.startsAt >= nowIso).reduce((k, d) => k + d.taken, 0), 0);
  ctx.main.innerHTML = `<section class="hero"><div class="wrap" style="padding-block:30px"><div>
      <p class="eyebrow">${esc(tt('Кабинет фасилитатора', 'Facilitator space'))}</p><h1>${esc(session.user.publicName)}</h1>
      <div class="row"><a class="btn yellow" href="${u('/facilitator/m/new')}">${ic.plus} ${esc(tt('Новая встреча', 'New meeting'))}</a>
        <a class="btn light" href="${u('/team/facilitators')}">${esc(tt('Чат фасилитаторов', 'Facilitators’ chat'))}</a>
        <a class="btn light" href="${u('/print')}">${esc(tt('Печатная колода', 'Printed deck'))}</a></div></div>
      <div class="kpis"><div class="kpi"><b>${cols.collections.length}</b><span>${esc(tt('подборок', 'selections'))}</span></div>
        <div class="kpi"><b>${mts.meetings.length}</b><span>${esc(tt('встреч', 'meetings'))}</span></div>
        <div class="kpi"><b>${upcomingRegs}</b><span>${esc(tt('записей на будущие даты', 'sign-ups for upcoming dates'))}</span></div></div></div></section>
    <div class="wrap page stack">
      <div class="row between"><h2 style="margin:0">${esc(tt('Подборки карт для встреч', 'Card selections for meetings'))}</h2></div>
      <p class="muted" style="margin:0">${esc(tt('До 40 карт из общей библиотеки. Участники открывают подборку по ссылке или QR-коду без регистрации. Ссылка всегда показывает текущий состав.', 'Up to 40 cards from the library. Participants open the selection via link or QR code without signing up. The link always shows the current cards.'))}</p>
      <form class="row" id="newcol"><input type="text" name="title" class="grow" maxlength="120" placeholder="${esc(tt('Название, например «Встреча 20 ноября»', 'Title, e.g. “Meeting on 20 November”'))}" style="flex:1 1 240px"><button class="btn dark" type="submit">${esc(tt('Создать подборку', 'Create selection'))}</button></form>
      <div class="list">${cols.collections.map((c) => `<a class="item" href="${u('/facilitator/c/' + c.id)}"><span class="ic">${ic.qr}</span><span class="body"><b>${esc(c.title)} ${demoPill(c.isDemo)}</b>
          <span class="small">${esc(tt(`карт: ${c.cardCount} · открывали: ${c.visitors} · выборов: ${c.selections}`, `cards: ${c.cardCount} · opened: ${c.visitors} · choices: ${c.selections}`))}${c.unavailableCount ? ` · <span class="warn">${esc(tt('недоступно: ', 'unavailable: '))}${c.unavailableCount}</span>` : ''}${hasRole('admin') && c.ownerName ? ' · ' + esc(c.ownerName) : ''}</span></span>→</a>`).join('') || `<p class="empty">${esc(tt('Подборок пока нет.', 'No selections yet.'))}</p>`}</div>
      <h2 style="margin-top:20px">${esc(tt('Мои встречи', 'My meetings'))}</h2>
      <div class="list">${mts.meetings.map((m) => `<a class="item" href="${u('/facilitator/m/' + m.id)}"><span class="ic">${ic.calendar}</span><span class="body"><b>${esc(m.title)} ${demoPill(m.isDemo)}</b>
          <span class="small">${esc(m.city)}, ${esc(m.country)} · ${esc(langName(m.language))} · ${esc(tt(`дат: ${m.dates.length}`, `dates: ${m.dates.length}`))} · ${esc(tt(`записей: ${m.dates.reduce((k, d) => k + d.taken, 0)}`, `sign-ups: ${m.dates.reduce((k, d) => k + d.taken, 0)}`))}</span></span>${mPill(m.status)}</a>`).join('') || `<p class="empty">${esc(tt('Встреч пока нет.', 'No meetings yet.'))}</p>`}</div>
    </div>`;
  ctx.main.querySelector('#newcol').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const { id } = await api('/api/collections', { method: 'POST', body: { title: e.target.title.value } }); ctx.navigate('/facilitator/c/' + id); } catch (x) { toast(errorText(x)); }
  });
}

// ---------- редактор подборки ----------
export async function collectionEditor(ctx, id) {
  if (!session.user) return needLogin(ctx.main, '');
  if (!hasRole('facilitator')) return noRole(ctx.main, tt('фасилитатор', 'facilitator'));
  loading(ctx.main);
  let detail; let library;
  try { [detail, { cards: library }] = await Promise.all([api(`/api/collections/${id}`), api('/api/cards')]); } catch (e) {
    if (!ctx.alive()) return;
    if (e.status === 404) { ctx.main.innerHTML = `<div class="wrap page narrow"><p class="empty">${esc(tt('Подборка не найдена или принадлежит другому фасилитатору.', 'Selection not found or belongs to another facilitator.'))}</p></div>`; return; }
    return failed(ctx.main, e, ctx.rerender);
  }
  if (!ctx.alive()) return;
  const MAX = 40;
  const known = new Map(detail.cards.map((c) => [c.code, c]));
  for (const c of library) if (!known.has(c.code)) known.set(c.code, { ...c, status: 'published', selections: 0 });
  let codes = detail.cards.map((c) => c.code);
  const isAvailable = (code) => known.get(code)?.status === 'published';
  ctx.main.innerHTML = `<div class="wrap page stack" id="ed">
    <a class="small" href="${u('/facilitator')}">← ${esc(tt('Кабинет', 'Back'))}</a>
    <div class="row between"><input type="text" id="ed-title" value="${esc(detail.title)}" maxlength="120" style="font:800 1.6rem var(--font-head);max-width:640px" aria-label="${esc(tt('Название', 'Title'))}">
      <span class="small muted" id="st" aria-live="polite"></span></div>
    <div class="card-ui navy stack">
      <span class="small muted">${esc(tt('Ссылка для участников', 'Link for participants'))}</span>
      <input type="text" id="ed-url" readonly value="${esc(detail.url)}" style="font-family:ui-monospace,monospace">
      <div class="row"><button class="btn yellow sm" type="button" id="qr">${ic.qr} ${esc(tt('QR на весь экран', 'Full-screen QR'))}</button>
        <button class="btn light sm" type="button" id="copy">${esc(tt('Копировать', 'Copy'))}</button>
        <a class="btn light sm" href="${u('/api/c/' + detail.slug + '/qr.png?size=1600&download=1')}" download>${esc(tt('Скачать QR', 'Download QR'))}</a>
        <a class="btn light sm" href="${u('/s/' + detail.slug)}" target="_blank" rel="noopener">${esc(tt('Открыть как участник', 'Open as participant'))}</a></div>
      <p class="small muted" style="margin:0">${esc(tt('Ссылка всегда показывает текущий состав подборки. Срок действия у QR нет.', 'The link always shows the current cards. The QR code does not expire.'))} ${esc(tt(`Открывали на ${detail.visitors} устройствах.`, `Opened on ${detail.visitors} devices.`))}</p>
    </div>
    <label class="check"><input type="checkbox" id="ed-test" ${detail.isTest ? 'checked' : ''}><span><b>${esc(tt('Тестовая подборка', 'Test selection'))}</b> — ${esc(tt('выборы не попадают в общую статистику карт', 'choices do not count in card statistics'))}</span></label>
    <h2 id="cnt"></h2><div id="unav"></div><div class="cells" id="sel"></div>
    <h2>${esc(tt('Библиотека', 'Library'))}</h2><p class="small muted" id="hint"></p><div class="cells" id="lib"></div>
    <div id="delwrap"><button class="btn danger" type="button" id="del">${esc(tt('Удалить подборку', 'Delete selection'))}</button></div>
  </div>`;
  const $ = (s) => ctx.main.querySelector(s);
  const st = $('#st');
  let timer; let saving = Promise.resolve();
  const status = (txt, cls = '') => { st.textContent = txt; st.className = 'small ' + cls; };
  function draw() {
    const av = codes.filter(isAvailable); const un = codes.filter((c) => !isAvailable(c));
    $('#cnt').textContent = tt(`В подборке ${av.length} из ${MAX}`, `${av.length} of ${MAX} cards`);
    $('#unav').innerHTML = un.length ? `<div class="notice red stack"><b>${esc(tt('Недоступные карты:', 'Unavailable cards:'))} ${un.map(esc).join(', ')}</b><span>${esc(tt('Карты сняты с публикации, участники их не видят.', 'These cards were removed; participants do not see them.'))}</span><button class="btn sm" type="button" id="dropun" style="justify-self:start">${esc(tt('Убрать недоступные', 'Remove unavailable'))}</button></div>` : '';
    $('#sel').innerHTML = av.length ? av.map((code) => { const c = known.get(code); return `<div class="cell"><button class="tile" type="button" data-view="${esc(code)}" data-from="sel"><img src="${esc(c.thumb)}" alt="" loading="lazy"></button>
      <button class="mini-btn r" type="button" data-remove="${esc(code)}" aria-label="${esc(tt('Убрать', 'Remove'))}">${ic.x}</button><small>${esc(code)}${c.selections ? ' · ' + esc(tt('выбрали ', 'chosen ')) + c.selections : ''}</small></div>`; }).join('') : `<p class="empty">${esc(tt('Добавьте карты из библиотеки ниже.', 'Add cards from the library below.'))}</p>`;
    const full = codes.length >= MAX;
    $('#hint').textContent = full ? tt('Уже 40 карт — уберите одну, чтобы добавить другую.', 'Already 40 cards — remove one to add another.') : tt('Нажмите на карту, чтобы добавить или убрать. Значок ⤢ — рассмотреть.', 'Tap a card to add or remove it. ⤢ — view.');
    $('#lib').innerHTML = library.map((c) => { const inC = codes.includes(c.code); return `<div class="cell ${inC ? 'in' : ''} ${!inC && full ? 'off' : ''}">
      <button class="tile" type="button" data-toggle="${esc(c.code)}" aria-pressed="${inC}" ${!inC && full ? 'disabled' : ''}><img src="${esc(c.thumb)}" alt="" loading="lazy">${inC ? `<span class="tile-check">${icons.check}</span>` : ''}</button>
      <button class="mini-btn l" type="button" data-view="${esc(c.code)}">${ic.expand}</button><small>${esc(c.code)}</small></div>`; }).join('');
    const d = $('#dropun'); if (d) d.onclick = () => { codes = codes.filter(isAvailable); draw(); save(); };
  }
  function save() {
    status(tt('Сохранение…', 'Saving…')); clearTimeout(timer);
    timer = setTimeout(() => {
      const body = { codes: [...codes] };
      saving = saving.then(() => api(`/api/collections/${id}/cards`, { method: 'PUT', body })).then(() => status(tt('Сохранено', 'Saved'), 'ok')).catch((x) => status(errorText(x), 'warn'));
    }, 300);
  }
  $('#ed').addEventListener('click', (e) => {
    const tg = e.target.closest('[data-toggle]'); const rm = e.target.closest('[data-remove]'); const vw = e.target.closest('[data-view]');
    if (tg) { const c = tg.dataset.toggle; if (codes.includes(c)) codes = codes.filter((x) => x !== c); else if (codes.length < MAX) codes.push(c); draw(); save(); }
    else if (rm) { codes = codes.filter((x) => x !== rm.dataset.remove); draw(); save(); }
    else if (vw) { const list = vw.dataset.from === 'sel' ? codes.filter(isAvailable).map((c) => known.get(c)) : library; openViewer({ cards: list, index: Math.max(0, list.findIndex((c) => c.code === vw.dataset.view)), mode: 'admin' }); }
  });
  $('#ed-title').addEventListener('change', async (e) => { try { await api(`/api/collections/${id}`, { method: 'PATCH', body: { title: e.target.value } }); status(tt('Сохранено', 'Saved'), 'ok'); } catch (x) { status(errorText(x), 'warn'); } });
  $('#ed-test').addEventListener('change', async (e) => { try { await api(`/api/collections/${id}`, { method: 'PATCH', body: { isTest: e.target.checked } }); status(tt('Сохранено', 'Saved'), 'ok'); } catch (x) { status(errorText(x), 'warn'); } });
  $('#copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(detail.url); } catch { $('#ed-url').select(); document.execCommand('copy'); } toast(tt('Ссылка скопирована', 'Link copied')); });
  $('#qr').addEventListener('click', () => showQr(detail.slug, $('#ed-title').value, detail.url));
  $('#del').addEventListener('click', () => {
    $('#delwrap').innerHTML = `<div class="notice red row"><span class="grow">${esc(tt('Удалить подборку? Ссылка и QR перестанут работать, статистика этой подборки удалится.', 'Delete the selection? Its link and QR stop working and its statistics are deleted.'))}</span>
      <button class="btn danger sm" type="button" id="yes">${esc(tt('Удалить', 'Delete'))}</button></div>`;
    $('#yes').onclick = async () => { try { await api(`/api/collections/${id}`, { method: 'DELETE' }); ctx.navigate('/facilitator'); } catch (x) { toast(errorText(x)); } };
  });
  draw();
}

// ---------- редактор встречи ----------
export async function meetingEditor(ctx, id) {
  if (!session.user) return needLogin(ctx.main, '');
  if (!hasRole('facilitator')) return noRole(ctx.main, tt('фасилитатор', 'facilitator'));
  loading(ctx.main);
  let m = null; let tzs = [];
  try {
    const list = await api('/api/fac/meetings'); tzs = list.timezones;
    if (id) m = await api(`/api/fac/meetings/${id}`);
  } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  const myTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const v = m || { title: '', description: '', country: '', city: '', venue: '', language: 'ru', timezone: myTz, priceType: 'free', priceNote: '', capacity: 12, askContact: false };
  const form = `<form class="card-ui form" id="mf">
    <label class="field">${esc(tt('Название встречи', 'Meeting title'))} *<input type="text" name="title" required maxlength="140" value="${esc(v.title)}"></label>
    <label class="field">${esc(tt('Описание', 'Description'))}<textarea name="description" maxlength="3000">${esc(v.description)}</textarea></label>
    <div class="cols-2"><label class="field">${esc(tt('Страна', 'Country'))} *<input type="text" name="country" required maxlength="80" value="${esc(v.country)}"></label>
      <label class="field">${esc(tt('Город', 'City'))} *<input type="text" name="city" required maxlength="80" value="${esc(v.city)}"></label></div>
    <label class="field">${esc(tt('Место', 'Venue'))}<input type="text" name="venue" maxlength="300" value="${esc(v.venue)}"></label>
    <div class="cols-2"><label class="field">${esc(tt('Язык встречи', 'Meeting language'))}<select name="language">${Object.keys(LANG_NAMES).map((k) => `<option value="${k}" ${k === v.language ? 'selected' : ''}>${esc(langName(k))}</option>`).join('')}</select></label>
      <label class="field">${esc(tt('Часовой пояс встречи', 'Meeting time zone'))}<select name="timezone">${tzs.map((z) => `<option ${z === v.timezone ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></label></div>
    <div class="cols-2"><label class="field">${esc(tt('Формат', 'Format'))}<select name="priceType"><option value="free" ${v.priceType === 'free' ? 'selected' : ''}>${esc(tt('Бесплатная', 'Free'))}</option><option value="paid" ${v.priceType === 'paid' ? 'selected' : ''}>${esc(tt('Платная', 'Paid'))}</option></select></label>
      <label class="field">${esc(tt('Мест на каждую дату', 'Seats per date'))} *<input type="number" name="capacity" min="1" max="500" required value="${v.capacity}"></label></div>
    <label class="field">${esc(tt('Об оплате', 'About payment'))} <span class="hint">${esc(tt('Сайт не принимает оплату — её организует фасилитатор', 'The site does not take payments — the facilitator arranges them'))}</span><input type="text" name="priceNote" maxlength="300" value="${esc(v.priceNote)}"></label>
    <label class="check"><input type="checkbox" name="askContact" ${v.askContact ? 'checked' : ''}><span>${esc(tt('Добавить в запись необязательное поле «телефон или мессенджер»', 'Add an optional “phone or messenger” field to sign-up'))}</span></label>
    ${m ? '' : `<div class="cols-2"><label class="field">${esc(tt('Первая дата и время (по поясу встречи)', 'First date and time (meeting time zone)'))} *<input type="datetime-local" name="firstDate" required></label>
      <label class="field">${esc(tt('Повторять каждую неделю', 'Repeat weekly'))} <span class="hint">${esc(tt('число дат, 1 — без повтора', 'number of dates, 1 — no repeat'))}</span><input type="number" name="repeatWeekly" min="1" max="52" value="1"></label></div>`}
    <p class="form-error" id="err" role="alert"></p>
    <button class="btn dark" type="submit">${esc(m ? tt('Сохранить', 'Save') : tt('Опубликовать встречу', 'Publish meeting'))}</button></form>`;
  const nowIso = new Date().toISOString();
  ctx.main.innerHTML = `<div class="wrap page stack">
    <a class="small" href="${u('/facilitator')}">← ${esc(tt('Кабинет', 'Back'))}</a>
    <div class="row between"><h1 style="margin:0">${esc(m ? m.title : tt('Новая встреча', 'New meeting'))}</h1>${m ? mPill(m.status) : ''}</div>
    ${m && m.status === 'removed' ? `<div class="notice red">${esc(tt('Администратор снял встречу с публикации:', 'An administrator took the meeting down:'))} ${esc(m.removedReason || '—')}</div>` : ''}
    ${m ? `<div class="row">${m.status !== 'removed' ? `<button class="btn sm" type="button" id="pub">${esc(m.status === 'published' ? tt('Скрыть встречу', 'Hide meeting') : tt('Опубликовать снова', 'Publish again'))}</button>` : ''}
      ${m.dates[0] ? `<a class="btn sm" href="${u('/m/' + (m.dates.find((d) => !d.past) || m.dates[0]).id)}" target="_blank">${esc(tt('Публичная страница', 'Public page'))}</a>` : ''}</div>` : ''}
    <div class="cols-2" style="align-items:start">${form}
      ${m ? `<div class="stack"><h2>${esc(tt('Даты и записи', 'Dates and sign-ups'))}</h2>
        ${m.dates.map((d) => `<div class="card-ui flat stack" style="gap:8px"><div class="row between"><b>${esc(fmtTz(d.startsAt, m.timezone, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</b>
            <span class="pill ${d.status === 'cancelled' ? 'red' : d.left ? 'mint' : 'red'}">${esc(d.status === 'cancelled' ? tt('Отменена', 'Cancelled') : tt(`${d.taken} из ${d.capacity}`, `${d.taken} of ${d.capacity}`))}</span></div>
          ${d.registrations.length ? `<div class="scroll-x"><table class="tbl"><tr><th>${esc(tt('Имя', 'Name'))}</th><th>Email</th><th>${esc(tt('Контакт', 'Contact'))}</th><th></th></tr>${d.registrations.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.email)}</td><td>${esc(r.contact || '—')}</td><td>${r.status === 'active' ? '' : `<span class="pill red">${esc(tt('отменил', 'cancelled'))}</span>`}</td></tr>`).join('')}</table></div>` : `<span class="small muted">${esc(tt('Записей пока нет', 'No sign-ups yet'))}</span>`}
          ${d.startsAt >= nowIso ? `<div class="row"><button class="linkbtn ${d.status === 'cancelled' ? '' : 'danger'}" type="button" data-date="${d.id}" data-set="${d.status === 'cancelled' ? 'active' : 'cancelled'}">${esc(d.status === 'cancelled' ? tt('Вернуть дату', 'Restore date') : tt('Отменить эту дату', 'Cancel this date'))}</button></div>` : ''}
          </div>`).join('')}
        <form class="card-ui flat form" id="addd"><b>${esc(tt('Добавить даты', 'Add dates'))}</b><input type="datetime-local" name="firstDate" required>
          <label class="field">${esc(tt('Повторять каждую неделю (число дат)', 'Repeat weekly (number of dates)'))}<input type="number" name="repeatWeekly" min="1" max="52" value="1"></label>
          <button class="btn sm dark" type="submit">${esc(tt('Добавить', 'Add'))}</button></form>
        <p class="small muted">${esc(tt('Уведомления участникам при отмене или переносе и лист ожидания ещё не согласованы.', 'Notifications on cancel/reschedule and a waiting list are not agreed yet.'))}</p></div>` : ''}</div>
  </div>`;
  const mf = ctx.main.querySelector('#mf');
  mf.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(mf).entries());
    const body = { ...fd, askContact: mf.askContact.checked, capacity: Number(fd.capacity), repeatWeekly: Number(fd.repeatWeekly || 1) };
    try {
      if (m) { await api(`/api/fac/meetings/${id}`, { method: 'PUT', body }); toast(tt('Сохранено', 'Saved')); ctx.rerender(); }
      else { const r = await api('/api/fac/meetings', { method: 'POST', body }); toast(tt('Встреча опубликована', 'Meeting published')); ctx.navigate('/facilitator/m/' + r.id); }
    } catch (x) { ctx.main.querySelector('#err').textContent = errorText(x); }
  });
  const pub = ctx.main.querySelector('#pub');
  if (pub) pub.addEventListener('click', async () => { try { await api(`/api/fac/meetings/${id}/publish`, { method: 'POST', body: { published: m.status !== 'published' } }); ctx.rerender(); } catch (x) { toast(errorText(x)); } });
  ctx.main.querySelectorAll('[data-date]').forEach((b) => b.addEventListener('click', async () => { try { await api(`/api/fac/dates/${b.dataset.date}`, { method: 'PATCH', body: { status: b.dataset.set } }); ctx.rerender(); } catch (x) { toast(errorText(x)); } }));
  const addd = ctx.main.querySelector('#addd');
  if (addd) addd.addEventListener('submit', async (e) => { e.preventDefault(); try { await api(`/api/fac/meetings/${id}/dates`, { method: 'POST', body: { firstDate: addd.firstDate.value, repeatWeekly: Number(addd.repeatWeekly.value) } }); ctx.rerender(); } catch (x) { toast(errorText(x)); } });
}

// ---------- путь к роли фасилитатора ----------
export async function apply(ctx) {
  if (!session.user) return needLogin(ctx.main, tt('Чтобы стать фасилитатором, войдите по email.', 'Sign in with email to become a facilitator.'));
  loading(ctx.main);
  let d;
  try { d = await api('/api/fac/application'); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  if (d.isFacilitator && !d.application) {
    ctx.main.innerHTML = `<div class="wrap page narrow"><div class="card-ui stack"><h2>${esc(tt('Вы уже фасилитатор', 'You are already a facilitator'))}</h2><a class="btn dark" href="${u('/facilitator')}">${esc(tt('В кабинет', 'Open the space'))}</a></div></div>`;
    return;
  }
  const a = d.application;
  const save = async (patch) => { try { await api('/api/fac/application', { method: 'PUT', body: patch }); } catch (x) { toast(errorText(x)); throw x; } };
  const statusLine = (state) => timeline([
    { title: tt('Заявка начата', 'Application started'), note: a ? esc(fmtDate(a.createdAt)) : '', state: a ? 'done' : 'now' },
    { title: tt('Вводный курс', 'Intro course'), note: esc(tt(`глав пройдено: ${a ? a.courseDone.length : 0} из ${d.course.length}`, `chapters done: ${a ? a.courseDone.length : 0} of ${d.course.length}`)), state: a && a.courseDone.length === d.course.length ? 'done' : a ? 'now' : 'todo' },
    { title: tt('Проверка знаний и о себе', 'Quiz and about you'), state: ['submitted', 'approved'].includes(state) ? 'done' : a && a.courseDone.length === d.course.length ? 'now' : 'todo' },
    { title: tt('Решение администратора', 'Administrator’s decision'), note: state === 'approved' ? esc(tt('Одобрено — роль фасилитатора выдана', 'Approved — facilitator role granted')) : state === 'rejected' ? esc(tt('Не одобрено: ', 'Not approved: ') + (a.decisionNote || '')) : state === 'submitted' ? esc(tt('Заявка на рассмотрении', 'Under review')) : '', state: state === 'approved' ? 'done' : state === 'rejected' ? 'bad' : state === 'submitted' ? 'now' : 'todo' },
  ]);
  const heroSide = `<div class="card-ui navy">${statusLine(a ? a.status : 'none')}</div>`;
  let body = '';
  if (!a) {
    body = `<div class="card-ui stack"><h2>${esc(tt('Как стать фасилитатором', 'How to become a facilitator'))}</h2>
      <p>${esc(tt('Фасилитатор знакомит участников с форматом, создаёт условия для разговора и проводит завершающий круг. Путь: вводный курс по руководству фасилитатора, короткая проверка знаний, заявка; роль выдаёт администратор.', 'A facilitator introduces the format, creates the conditions for conversation and leads the closing circle. Path: an intro course based on the facilitator guide, a short quiz, an application; an administrator grants the role.'))}</p>
      <div class="notice demo small">${esc(tt('Материалы курса и условия одобрения уточняются с владельцем проекта. Главы — из черновика «Руководства фасилитатора Dialogue Flow», вопросы проверки временные.', 'Course materials and approval conditions are being agreed with the project owner. Chapters come from the draft “Dialogue Flow facilitator guide”; quiz questions are placeholders.'))}</div>
      <button class="btn dark" type="button" id="start">${esc(tt('Начать', 'Start'))}</button></div>`;
  } else if (a.status === 'in_progress' || a.status === 'rejected') {
    const courseOk = a.courseDone.length === d.course.length;
    body = `<div class="card-ui stack">${stepsBar(courseOk ? 2 : 1, 3)}
      <h2>${esc(tt('Вводный курс', 'Intro course'))}</h2><p class="small muted" style="margin:0">${esc(tt('Отметьте главы руководства, которые вы прочитали.', 'Mark the guide chapters you have read.'))}</p>
      <div class="crit">${d.course.map((c, i) => `<label><input type="checkbox" data-ch="${i}" ${a.courseDone.includes(i) ? 'checked' : ''}><span class="num">${i + 1}</span><span>${esc(c)}</span></label>`).join('')}</div>
      <h2 style="margin-top:10px">${esc(tt('Проверка знаний', 'Quiz'))} <span class="pill demo">${esc(tt('временные вопросы', 'placeholder questions'))}</span></h2>
      ${d.questions.map((q) => `<fieldset style="border:0;padding:0;margin:0" class="stack"><b>${esc(q.text)}</b><div class="chips">${q.options.map((o, i) => `<label class="chip ${String(a.answers[q.id]) === String(i) ? 'on' : ''}"><input type="radio" name="${q.id}" value="${i}" hidden ${String(a.answers[q.id]) === String(i) ? 'checked' : ''}>${esc(o)}</label>`).join('')}</div></fieldset>`).join('')}
      <label class="field">${esc(tt('Город', 'City'))}<input type="text" id="city" maxlength="100" value="${esc(a.city)}"></label>
      <label class="field">${esc(tt('О себе и опыте встреч', 'About you and your meeting experience'))}<textarea id="about" maxlength="2000">${esc(a.about)}</textarea></label>
      <p class="form-error" id="err" role="alert"></p>
      <button class="btn dark" type="button" id="submit">${esc(tt('Отправить заявку', 'Send application'))}</button></div>`;
  } else if (a.status === 'submitted') {
    body = `<div class="card-ui stack"><h2>${esc(tt('Заявка на рассмотрении', 'Application under review'))}</h2><p class="muted" style="margin:0">${esc(tt('Администратор проверит заявку и выдаст доступ. Вы можете пользоваться сайтом как участник.', 'An administrator will review it and grant access. Meanwhile you can use the site as a member.'))}</p></div>`;
  } else {
    body = `<div class="card-ui stack"><h2>${esc(tt('Роль выдана', 'Role granted'))}</h2><a class="btn dark" href="${u('/facilitator')}">${esc(tt('Открыть кабинет фасилитатора', 'Open the facilitator space'))}</a></div>`;
  }
  ctx.main.innerHTML = `<section class="hero"><div class="wrap" style="padding-block:30px"><div><p class="eyebrow">${esc(tt('Путь фасилитатора', 'Facilitator path'))}</p>
      <h1>${esc(a && a.status === 'submitted' ? tt('Мы проверяем заявку', 'We are checking your application') : tt('Стать фасилитатором Dialogue Flow', 'Become a Dialogue Flow facilitator'))}</h1></div>${heroSide}</div></section>
    <div class="wrap page narrow">${body}</div>`;
  const st = ctx.main.querySelector('#start');
  if (st) st.addEventListener('click', async () => { await api('/api/fac/application', { method: 'POST' }); ctx.rerender(); });
  ctx.main.querySelectorAll('[data-ch]').forEach((cb) => cb.addEventListener('change', async () => {
    const done = [...ctx.main.querySelectorAll('[data-ch]:checked')].map((x) => Number(x.dataset.ch));
    await save({ courseDone: done }); a.courseDone = done; ctx.main.querySelector('.hero .card-ui').innerHTML = statusLine(a.status);
  }));
  ctx.main.querySelectorAll('fieldset input[type=radio]').forEach((r) => r.addEventListener('change', async () => {
    r.closest('.chips').querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.querySelector('input').checked));
    a.answers[r.name] = Number(r.value); await save({ answers: a.answers });
  }));
  const sb = ctx.main.querySelector('#submit');
  if (sb) sb.addEventListener('click', async () => {
    try {
      await save({ about: ctx.main.querySelector('#about').value, city: ctx.main.querySelector('#city').value, answers: a.answers });
      await api('/api/fac/application/submit', { method: 'POST' }); await refreshSession(); toast(tt('Заявка отправлена', 'Application sent')); ctx.rerender();
    } catch (x) { ctx.main.querySelector('#err').textContent = errorText(x); }
  });
}
