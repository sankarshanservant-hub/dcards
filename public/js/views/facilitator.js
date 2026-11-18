// Фасилитатор: кабинет (подборки, встречи, записи), редактор подборки, редактор встречи, путь получения роли.
import { esc, tt, u, api, errorText, toast, fmtTz, fmtDate, ruPlural, enterTimeHint, durationText } from '../util.js';
import { lang } from '../i18n.js';
import { QUESTION_FORMATS } from '../content.js';
import { openViewer, icons } from '../viewer.js';
import { session, hasRole, needLogin, noRole, loading, failed, demoPill, timeline, stepsBar, ic, showQr, refreshSession } from '../ui.js';
import { langName, LANG_NAMES, priceText } from './meetings.js';

// «Asia/Bangkok» → «Bangkok»: подпись часового пояса в списке похожих городов.
const tzCity = (tz) => String(tz).split('/').pop().replace(/_/g, ' ');
const CURRENCIES = ['RUB', 'USD', 'EUR', 'THB', 'INR', 'UAH', 'BYN', 'KZT', 'GEL', 'AMD', 'TRY', 'AED', 'VND', 'IDR', 'CNY', 'GBP', 'JPY', 'KRW', 'SGD', 'MYR', 'PLN', 'CZK', 'RSD'];
// Валюта страны по умолчанию (подсказка для платной встречи).
const CC_CURRENCY = { RU: 'RUB', US: 'USD', TH: 'THB', IN: 'INR', UA: 'UAH', BY: 'BYN', KZ: 'KZT', GE: 'GEL', AM: 'AMD', TR: 'TRY', AE: 'AED', VN: 'VND', ID: 'IDR', CN: 'CNY', GB: 'GBP', JP: 'JPY', KR: 'KRW', SG: 'SGD', MY: 'MYR', PL: 'PLN', CZ: 'CZK', RS: 'RSD', DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', LV: 'EUR', LT: 'EUR', EE: 'EUR' };
// «Повторять еженедельно»: выключено — одна дата; включено — число встреч, включая первую.
const repeatBlock = (p) => `<div class="stack" style="gap:8px"><label class="switch"><input type="checkbox" name="repeatOn" role="switch"> ${esc(tt('Повторять еженедельно', 'Repeat weekly'))}</label>
  <label class="field" data-repeat-n hidden>${esc(tt('Сколько встреч, включая первую', 'How many meetings, including the first'))}<input type="number" name="repeatN" min="2" max="52" value="4" inputmode="numeric">
  <span class="hint">${esc(tt('Встречи пройдут каждую неделю в тот же день и в то же местное время.', 'Meetings take place every week on the same day at the same local time.'))}</span></label></div>`;
const repeatCount = (f) => (f.repeatOn && f.repeatOn.checked ? Math.max(2, Math.min(52, Number(f.repeatN.value) || 2)) : 1);
function wireRepeat(f, onChange) {
  const box = f.querySelector('[data-repeat-n]');
  f.repeatOn.addEventListener('change', () => { box.hidden = !f.repeatOn.checked; onChange(); });
  f.repeatN.addEventListener('input', onChange);
}
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

const MSTATUS = { published: ['Опубликована', 'Published', 'mint'], unpublished: ['Скрыта', 'Hidden', ''], removed: ['Снята администратором', 'Taken down by admin', 'red'] };
const mPill = (s) => { const x = MSTATUS[s] || [s, s, '']; return `<span class="pill ${x[2]}">${esc(tt(x[0], x[1]))}</span>`; };

/** Строка под названием встречи: место, язык, цена и ближайшая дата с занятыми местами («3 из 12 мест занято»). */
function nextDateLine(m, nowIso) {
  const next = m.dates.find((d) => d.startsAt >= nowIso && d.status === 'active');
  const when = next ? `${fmtTz(next.startsAt, m.timezone, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${tt(`${next.taken} из ${next.capacity} мест занято`, `${next.taken} of ${next.capacity} seats taken`)}` : tt('нет будущих дат', 'no upcoming dates');
  return `<span class="small">${esc(m.city)}, ${esc(m.country)} · ${esc(langName(m.language))} · ${esc(priceText(m))}</span><span class="small">${esc(tt('Ближайшая:', 'Next:'))} ${esc(when)}</span>`;
}

// Проведения (отдельные даты) фасилитатора: предстоящие — будущие действующие даты не снятых встреч (скрытые помечены);
// прошедшие — даты, время которых прошло, без отменённых. Серии встреч отдельно не считаются.
function occurrences(meetings) {
  const now = new Date().toISOString();
  const all = meetings.filter((m) => m.status !== 'removed').flatMap((m) => m.dates.map((d) => ({ ...d, m })));
  return {
    // Прошедшей считается встреча, которая закончилась (по окончанию, если продолжительность указана); идущая — ещё предстоящая.
    upcoming: all.filter((d) => d.status === 'active' && (d.endsAt || d.startsAt) >= now).sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    past: all.filter((d) => (d.endsAt || d.startsAt) < now && d.status !== 'cancelled').sort((a, b) => b.startsAt.localeCompare(a.startsAt)),
  };
}

export async function cabinet(ctx) {
  if (!session.user) return needLogin(ctx.main, tt('Кабинет фасилитатора.', 'Facilitator space.'));
  if (!hasRole('facilitator')) { ctx.navigate('/facilitator/apply', { replace: true }); return; }
  loading(ctx.main);
  let cols; let mts;
  let lv = { sessions: [] };
  try { [cols, mts, lv] = await Promise.all([api('/api/collections'), api('/api/fac/meetings'), api('/api/fac/live').catch(() => ({ sessions: [] }))]); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  const occ = occurrences(mts.meetings);
  const kpi = (href, n, label) => `<a class="kpi kpi-link" href="${u(href)}"><b>${n}</b><span>${esc(label)}</span></a>`;
  ctx.main.innerHTML = `<div class="wrap page stack">
    <div class="page-head"><h1>${esc(tt('Кабинет фасилитатора', 'Facilitator space'))}</h1><p class="sub">${esc(session.user.publicName)}</p></div>
    ${lv.sessions.filter((x) => x.status !== 'ended').map((x) => `<a class="notice live-on" href="${u('/facilitator/live/' + x.id)}">${ic.people} <b>${esc(tt('Идёт встреча по телефонам', 'A phone meeting is on'))}: ${esc(x.title)}</b> · ${esc(tt(`участников: ${x.people}`, `participants: ${x.people}`))} · ${esc(tt('открыть пульт', 'open console'))} →</a>`).join('')}
    <div class="row"><a class="btn yellow" href="${u('/facilitator/m/new')}">${ic.plus} ${esc(tt('Создать встречу', 'Create a meeting'))}</a>
      <a class="btn" href="${u('/facilitator/collections?new=1')}">${ic.plus} ${esc(tt('Создать подборку', 'Create a selection'))}</a></div>
    <div><a class="chat-link" href="${u('/chats')}">${ic.chat}<span>${esc(tt('Написать в чат', 'Write in a chat'))}</span></a></div>
    <div class="kpis three">
      ${kpi('/facilitator/collections', cols.collections.length, tt('Подборки', 'Selections'))}
      ${kpi('/facilitator/meetings?when=upcoming', occ.upcoming.length, tt('Предстоящие встречи', 'Upcoming meetings'))}
      ${kpi('/facilitator/meetings?when=past', occ.past.length, tt('Прошедшие встречи', 'Past meetings'))}</div>
    <div class="card-ui flat stack" id="print-box"><b>${esc(tt('Нужна печатная колода?', 'Need a printed deck?'))}</b>
      <span class="small muted">${esc(tt('Если вам нужна печатная колода для встреч Dialogue Flow, отправьте запрос команде проекта.', 'If you need a printed deck for Dialogue Flow meetings, send a request to the project team.'))}</span>
      <div id="print-ui"><button class="linkbtn" type="button" id="print-open">${esc(tt('Запросить печатную колоду', 'Request a printed deck'))}</button></div></div>
  </div>`;
  ctx.main.querySelector('#print-open').addEventListener('click', () => {
    const box = ctx.main.querySelector('#print-ui');
    box.innerHTML = `<form class="form" id="pf"><label class="field">${esc(tt('Комментарий', 'Note'))} <span class="hint">${esc(tt('по желанию: сколько колод, для какой встречи, как с вами связаться', 'optional: how many decks, for which meeting, how to reach you'))}</span><textarea name="note" maxlength="1000" rows="3"></textarea></label>
      <div class="row"><button class="btn dark sm" type="submit">${esc(tt('Отправить запрос', 'Send request'))}</button><button class="linkbtn" type="button" id="pc">${esc(tt('Отмена', 'Cancel'))}</button></div></form>`;
    box.querySelector('#pc').onclick = () => ctx.rerender();
    box.querySelector('#pf').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { const r = await api('/api/fac/print-request', { method: 'POST', body: { note: e.target.note.value } }); box.innerHTML = `<p class="small" style="margin:0"><b>${esc(r.already ? tt('Ваш запрос уже у команды проекта.', 'Your request is already with the project team.') : tt('Запрос отправлен команде проекта.', 'Request sent to the project team.'))}</b></p>`; } catch (x) { toast(errorText(x)); }
    });
  });
}

// ---------- Мои встречи: предстоящие и прошедшие проведения ----------
export async function meetingsList(ctx) {
  if (!session.user) return needLogin(ctx.main, '');
  if (!hasRole('facilitator')) return noRole(ctx.main, tt('фасилитатор', 'facilitator'));
  loading(ctx.main);
  let mts;
  try { mts = await api('/api/fac/meetings'); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  const when = ctx.query.get('when') === 'past' ? 'past' : 'upcoming';
  const occ = occurrences(mts.meetings);
  const list = occ[when];
  const row = (d) => `<a class="item" href="${u('/facilitator/m/' + d.m.id)}"><span class="cal" style="min-width:58px"><b>${esc(fmtTz(d.startsAt, d.m.timezone, { day: 'numeric' }))}</b><span>${esc(fmtTz(d.startsAt, d.m.timezone, { month: 'short' }))}</span></span>
    <span class="body"><b>${esc(d.m.title)} ${demoPill(d.m.isDemo)}${d.m.status === 'unpublished' ? ` <span class="pill">${esc(tt('Скрыта', 'Hidden'))}</span>` : ''}</b>
      <span class="small">${esc(fmtTz(d.startsAt, d.m.timezone, { weekday: 'long', hour: '2-digit', minute: '2-digit' }))} · ${esc(d.m.city)}</span>
      <span class="small">${esc(tt(`${d.taken} из ${d.capacity} мест занято`, `${d.taken} of ${d.capacity} seats taken`))}</span></span><span aria-hidden="true">→</span></a>`;
  ctx.main.innerHTML = `<div class="wrap page stack">
    <a class="small" href="${u('/facilitator')}">← ${esc(tt('Кабинет фасилитатора', 'Facilitator space'))}</a>
    <div class="page-head"><h1>${esc(tt('Мои встречи', 'My meetings'))}</h1></div>
    <div class="row between"><div class="seg" role="tablist">${[['upcoming', tt(`Предстоящие · ${occ.upcoming.length}`, `Upcoming · ${occ.upcoming.length}`)], ['past', tt(`Прошедшие · ${occ.past.length}`, `Past · ${occ.past.length}`)]].map(([k, lab]) => `<a role="tab" aria-selected="${k === when}" href="${u('/facilitator/meetings?when=' + k)}" style="text-decoration:none;padding:8px 14px;border-radius:999px;font-weight:600;font-size:.9rem;${k === when ? 'background:var(--accent);color:var(--on-accent)' : ''}">${esc(lab)}</a>`).join('')}</div>
      <a class="btn yellow sm" href="${u('/facilitator/m/new')}">${ic.plus} ${esc(tt('Создать встречу', 'Create a meeting'))}</a></div>
    ${list.length ? `<div class="list">${list.map(row).join('')}</div>` : `<div class="empty stack" style="justify-items:center"><span>${esc(when === 'upcoming' ? tt('Предстоящих встреч нет.', 'No upcoming meetings.') : tt('Прошедших встреч пока нет.', 'No past meetings yet.'))}</span>${when === 'upcoming' ? `<a class="btn sm" href="${u('/facilitator/m/new')}">${esc(tt('Создать встречу', 'Create a meeting'))}</a>` : ''}</div>`}
    ${mts.meetings.length ? `<details class="more card-ui flat"><summary>${esc(tt(`Все мои встречи (с датами) · ${mts.meetings.length}`, `All my meetings (with dates) · ${mts.meetings.length}`))}</summary>
      <div class="list" style="margin-top:8px">${mts.meetings.map((m) => `<a class="item" href="${u('/facilitator/m/' + m.id)}"><span class="ic">${ic.calendar}</span><span class="body"><b>${esc(m.title)} ${demoPill(m.isDemo)}</b>${nextDateLine(m, new Date().toISOString())}</span>${mPill(m.status)}</a>`).join('')}</div></details>` : ''}
  </div>`;
}

// ---------- редактор встречи ----------
export async function meetingEditor(ctx, id) {
  if (!session.user) return needLogin(ctx.main, '');
  if (!hasRole('facilitator')) return noRole(ctx.main, tt('фасилитатор', 'facilitator'));
  loading(ctx.main);
  let m = null; let src = null;
  const fromId = !id ? Number(new URL(location.href).searchParams.get('from')) || null : null;
  try {
    if (id) m = await api(`/api/fac/meetings/${id}`);
    else if (fromId) src = await api(`/api/fac/meetings/${fromId}`);
  } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  // Часовой пояс вручную не выбирается: его определяет сервер по городу встречи. Время вводится местное для этого города.
  const blank = { title: '', description: '', country: '', city: '', venue: '', lat: null, lng: null, language: 'ru', timezone: '', priceType: 'free', priceAmount: null, currency: '', priceNote: '', durationMin: null, capacity: 12, askContact: false, format: 'standalone' };
  const v = m || (src ? { ...blank, ...pick(src, Object.keys(blank)) } : blank);
  const whenBlock = `<fieldset class="fs"><legend>${esc(tt('Когда', 'When'))}</legend>
      ${m ? '' : `${datePickerHtml('mf')}<span class="hint small muted" id="datehint"></span>
      ${repeatBlock('mf')}<p class="small muted" style="margin:0">${esc(tt('Нерегулярные даты можно добавить после публикации.', 'Irregular dates can be added after publishing.'))}</p>`}
      <label class="field">${esc(tt('Продолжительность', 'Duration'))} <span class="hint">${esc(tt('участник увидит время окончания', 'participants will see the end time'))}</span><select name="durationMin">${[['', tt('Не указывать', 'Not set')], ...[60, 90, 120, 150, 180, 240].map((n) => [n, durationText(n)])].map(([val, lab]) => `<option value="${val}" ${String(v.durationMin ?? '') === String(val) ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select></label></fieldset>`;
  const form = `<form class="card-ui form" id="mf" novalidate>
    ${m ? `<h2 style="margin:0">${esc(tt('Настройки встречи', 'Meeting settings'))}</h2><p class="small muted" style="margin:0">${esc(tt('Общие для всех дат. Записи и места считаются отдельно на каждой дате.', 'Shared by all dates. Sign-ups and seats are counted per date.'))}</p>` : ''}
    ${whenBlock}
    <fieldset class="fs"><legend>${esc(tt('Формат', 'Format'))}</legend>
      <div class="radio-list">
        <label class="radio"><input type="radio" name="format" value="standalone" ${v.format !== 'part' ? 'checked' : ''}><span>${esc(tt('Встреча Dialogue Flow', 'A Dialogue Flow meeting'))}</span></label>
        <label class="radio"><input type="radio" name="format" value="part" ${v.format === 'part' ? 'checked' : ''}><span>${esc(tt('Dialogue Flow — часть другого события', 'Dialogue Flow as part of another event'))} <span class="small muted">${esc(tt('на странице будет пометка «В программе — Dialogue Flow»', 'the page will say “Dialogue Flow is part of the programme”'))}</span></span></label>
      </div></fieldset>
    <label class="field" for="mf-title">${esc(tt('Название события', 'Event title'))} *</label>
    <input id="mf-title" type="text" name="title" required maxlength="140" value="${esc(v.title)}" aria-describedby="mf-title-hint" style="margin-top:-6px">
    <span class="small muted" id="mf-title-hint" style="margin-top:-6px">${esc(tt('Укажите название вашего события. Если Dialogue Flow — часть программы, расскажите об этом в описании', 'Enter the name of your event. If Dialogue Flow is part of the programme, say so in the description'))}</span>
    <label class="field">${esc(tt('Описание', 'Description'))} <span class="hint">${esc(tt('необязательно', 'optional'))}</span><textarea name="description" maxlength="3000">${esc(v.description)}</textarea></label>
    <fieldset class="fs"><legend>${esc(tt('Где', 'Where'))}</legend>
      <div class="cols-2"><label class="field">${esc(tt('Город встречи', 'Meeting city'))} *<input type="text" name="city" required maxlength="80" autocomplete="off" value="${esc(v.city)}"></label>
        <label class="field">${esc(tt('Страна', 'Country'))} <span class="hint">${esc(tt('подставится по городу', 'filled in from the city'))}</span><input type="text" name="country" maxlength="80" autocomplete="off" value="${esc(v.country)}"></label></div>
      <div class="place-status" id="place" aria-live="polite"></div>
      <label class="field">${esc(tt('Место и адрес', 'Venue and address'))}<input type="text" name="venue" maxlength="300" value="${esc(v.venue)}" placeholder="${esc(tt('например, кафе «Ромашка», ул. Ленина, 5', 'e.g. Café Daisy, 5 Main St'))}"></label>
      <input type="hidden" name="lat" value="${v.lat ?? ''}"><input type="hidden" name="lng" value="${v.lng ?? ''}">
      <div class="stack" style="gap:6px" id="pt"></div>
      <div id="geo" class="stack" style="gap:6px"></div></fieldset>
    <label class="field">${esc(tt('Язык встречи', 'Meeting language'))}<select name="language">${Object.keys(LANG_NAMES).map((k) => `<option value="${k}" ${k === v.language ? 'selected' : ''}>${esc(langName(k))}</option>`).join('')}</select></label>
    <label class="field">${esc(tt('Оплата', 'Payment'))}<select name="priceType"><option value="free" ${v.priceType === 'free' ? 'selected' : ''}>${esc(tt('Бесплатно', 'Free'))}</option><option value="paid" ${v.priceType === 'paid' ? 'selected' : ''}>${esc(tt('Платно', 'Paid'))}</option></select></label>
    <div id="paid-fields" ${v.priceType === 'paid' ? '' : 'hidden'} class="stack" style="gap:10px">
      <div class="cols-2"><label class="field">${esc(tt('Стоимость участия', 'Price per person'))} *<input type="number" name="priceAmount" min="0" step="any" inputmode="decimal" value="${v.priceAmount ?? ''}"></label>
        <label class="field">${esc(tt('Валюта', 'Currency'))} *<select name="currency"><option value="">—</option>${CURRENCIES.map((c) => `<option ${c === v.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label></div>
      <p class="small muted" style="margin:0">${esc(tt('Цена показывается участнику до записи. Сайт не принимает оплату — её принимает фасилитатор вне сайта.', 'The price is shown before sign-up. The site does not take payments — the facilitator collects them outside the site.'))}</p>
      <label class="field">${esc(tt('Как оплатить', 'How to pay'))} <span class="hint">${esc(tt('по желанию: например, наличными на месте', 'optional: e.g. cash on site'))}</span><input type="text" name="priceNote" maxlength="300" value="${esc(v.priceNote)}"></label></div>
    ${m && m.priceType === 'paid' && !m.priceAmount ? `<div class="notice">${esc(tt('Укажите стоимость участия и валюту: сейчас участники видят «Стоимость уточняется».', 'Enter the price and currency: participants currently see “Price to be confirmed”.'))}</div>` : ''}
    <label class="field" style="max-width:220px">${esc(tt('Количество мест', 'Number of seats'))} *<input type="number" name="capacity" min="1" max="500" required value="${v.capacity}" inputmode="numeric"></label>
    <div class="stack" style="gap:2px"><label class="switch"><input type="checkbox" name="askContact" role="switch" ${v.askContact ? 'checked' : ''}> ${esc(tt('Попросить участника указать телефон или мессенджер', 'Ask participants for a phone number or messenger'))}</label>
      <span class="small muted" style="padding-left:58px">${esc(tt('Это поле будет необязательным.', 'This field will be optional.'))}</span></div>
    ${m ? '' : `<div class="tz-preview" id="tzprev" aria-live="polite"></div>`}
    <p class="form-error" id="err" role="alert"></p>
    <button class="btn ${m ? 'dark' : 'yellow'}" type="submit">${esc(m ? tt('Сохранить настройки', 'Save settings') : tt('Опубликовать встречу', 'Publish meeting'))}</button></form>`;
  const nowIso = new Date().toISOString();
  const pubDate = m && (m.dates.find((d) => !d.past && d.status === 'active') || m.dates[0]);
  const dateCard = (d) => `<div class="card-ui flat stack date-card" style="gap:8px" data-dcard="${d.id}"><div class="row between"><b>${esc(fmtTz(d.startsAt, m.timezone, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</b>
      <span class="pill ${d.status === 'cancelled' ? 'red' : d.left ? 'mint' : 'red'}" data-dstate>${esc(d.status === 'cancelled' ? tt('Отменена', 'Cancelled') : tt(`${d.taken} из ${d.capacity} мест занято`, `${d.taken} of ${d.capacity} seats taken`))}</span></div>
    ${d.registrations.length ? `<div class="scroll-x"><table class="tbl"><tr><th>${esc(tt('Имя', 'Name'))}</th><th>Email</th><th>${esc(tt('Контакт', 'Contact'))}</th><th></th></tr>${d.registrations.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.email)}</td><td>${esc(r.contact || '—')}</td><td>${r.status === 'active' ? '' : `<span class="pill red">${esc(tt('отменил', 'cancelled'))}</span>`}</td></tr>`).join('')}</table></div>` : `<span class="small muted">${esc(tt('Записей пока нет', 'No sign-ups yet'))}</span>`}
    ${d.startsAt >= nowIso ? `<div class="row" data-dact><button class="linkbtn ${d.status === 'cancelled' ? '' : 'danger'}" type="button" data-date="${d.id}" data-set="${d.status === 'cancelled' ? 'active' : 'cancelled'}" data-when="${esc(fmtTz(d.startsAt, m.timezone, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }))}">${esc(d.status === 'cancelled' ? tt('Вернуть дату', 'Restore date') : tt('Отменить эту дату', 'Cancel this date'))}</button></div>` : ''}
    </div>`;
  const hidden = m && m.status === 'unpublished';
  ctx.main.innerHTML = `<div class="wrap page stack">
    <a class="small" href="${u(m ? '/facilitator/meetings' : '/facilitator')}">← ${esc(m ? tt('К встречам', 'To meetings') : tt('Кабинет фасилитатора', 'Facilitator space'))}</a>
    <div class="page-head"><h1>${esc(m ? m.title : src ? tt('Повтор встречи', 'Repeat of a meeting') : tt('Новая встреча', 'New meeting'))}</h1>
      ${m ? `<div class="row" style="gap:8px">${mPill(m.status)}${hidden ? `<span class="small muted">${esc(tt('Все даты скрыты от участников', 'All dates are hidden from participants'))}</span>` : ''}
        ${pubDate ? `<a class="small" href="${u('/m/' + pubDate.id)}" target="_blank" rel="noopener">${esc(tt('Посмотреть страницу встречи', 'View the meeting page'))} ↗<span class="sr-only"> ${esc(tt('(откроется в новой вкладке)', '(opens in a new tab)'))}</span></a><span class="tiny muted">${esc(tt('в новой вкладке', 'new tab'))}</span>` : ''}</div>` : ''}</div>
    ${src ? `<div class="notice">${esc(tt(`Скопировано из «${src.title}»: город, место, описание, язык, оплата, число мест и настройка контакта — всё можно изменить. Записи и отмены не переносятся. Задайте дату и время — местное для города встречи.`, `Copied from “${src.title}”: city, venue, description, language, payment, seats and the contact setting — all editable. Sign-ups and cancellations are not copied. Set a date and time — local to the meeting city.`))}</div>` : ''}
    ${m && m.status === 'removed' ? `<div class="notice red">${esc(tt('Администратор снял встречу с публикации:', 'An administrator took the meeting down:'))} ${esc(m.removedReason || '—')}</div>` : ''}
    ${m && m.status !== 'removed' ? `<div class="row">
        <button class="btn yellow" type="button" id="add-date-go">${ic.plus} ${esc(tt('Добавить дату', 'Add a date'))}</button>
        <a class="btn" href="${u('/facilitator/m/new?from=' + m.id)}">${esc(tt('Повторить встречу', 'Repeat meeting'))}</a>
        ${hidden ? `<button class="btn" type="button" id="republish">${esc(tt('Опубликовать снова', 'Publish again'))}</button>` : `<details class="more-menu"><summary class="btn sm light">${esc(tt('Ещё', 'More'))}</summary><div class="menu-pop"><button class="linkbtn danger" type="button" id="hide-ask">${esc(tt('Скрыть встречу', 'Hide meeting'))}</button></div></details>`}</div>
      <div id="hide-slot"></div>
      <form class="card-ui stack" id="addd" hidden novalidate><h2 style="margin:0">${esc(tt('Новая дата', 'New date'))}</h2><span class="small muted">${esc(enterTimeHint(m.city))}</span>
        ${datePickerHtml('ad')}${repeatBlock('ad')}
        <div class="tz-preview" id="addprev" aria-live="polite"></div><p class="form-error" id="aderr" role="alert"></p>
        <div class="row"><button class="btn yellow" type="submit">${esc(tt('Добавить дату', 'Add date'))}</button><button class="linkbtn" type="button" id="addd-cancel">${esc(tt('Отмена', 'Cancel'))}</button></div></form>` : ''}
    ${m ? `<div class="cols-2" style="align-items:start"><section class="stack" aria-labelledby="dz"><h2 id="dz" style="margin:0">${esc(tt('Даты и записи', 'Dates and sign-ups'))}</h2>
        ${m.dates.length ? m.dates.map(dateCard).join('') : `<p class="empty">${esc(tt('Дат пока нет.', 'No dates yet.'))}</p>`}</section>${form}</div>` : form}
  </div>`;
  const mf = ctx.main.querySelector('#mf');
  const placeBox = ctx.main.querySelector('#place'); const dateHint = ctx.main.querySelector('#datehint');
  // Город встречи: { placeId, city, country, timezone } — когда город определён однозначно.
  let place = (m || src) && v.timezone ? { placeId: '', city: v.city, country: v.country, timezone: v.timezone } : null;
  let lastQuery = place ? `${v.city}|${v.country}` : '';
  const optBtn = (o) => `<button class="chip" type="button" data-place='${esc(JSON.stringify(o))}'>${esc(o.city)}, ${esc(o.country)} <span class="muted">· ${esc(tzCity(o.timezone))}</span></button>`;
  const drawPlace = (state, options = []) => {
    if (state === 'ok' && place) {
      placeBox.innerHTML = `<span class="ok">✓ ${esc(place.city)}, ${esc(place.country)}</span> <span class="muted small">· ${esc(tt('сейчас там', 'local time now'))} ${esc(fmtTz(new Date().toISOString(), place.timezone, { hour: '2-digit', minute: '2-digit' }))}</span>`;
    } else if (state === 'ambiguous') {
      placeBox.innerHTML = `<span class="warn">${esc(tt('Городов с таким названием несколько — уточните город и страну:', 'There are several cities with this name — specify the city and country:'))}</span><div class="chips">${options.map(optBtn).join('')}</div>`;
    } else if (state === 'not_found') {
      placeBox.innerHTML = `<span class="warn">${esc(tt('Не удалось определить город. Уточните название и страну или укажите ближайший крупный город.', 'Could not identify the city. Check the name and country, or enter the nearest large city.'))}</span>${options.length ? `<div class="chips">${options.map(optBtn).join('')}</div>` : ''}`;
    } else if (state === 'loading') placeBox.innerHTML = `<span class="muted small">${esc(tt('Определяем город…', 'Looking up the city…'))}</span>`;
    else placeBox.innerHTML = '';
    if (dateHint) dateHint.textContent = place ? enterTimeHint(place.city) : tt('Сначала укажите город — время вводится местное', 'Enter the city first — the time is local to it');
    preview();
  };
  let timer = null; let nfTimer = null; let seq = 0;
  const lookup = () => {
    const q = `${mf.city.value.trim()}|${mf.country.value.trim()}`;
    if (q === lastQuery && place) return;
    place = null; lastQuery = q;
    if (!mf.city.value.trim()) return drawPlace('empty');
    drawPlace('loading');
    clearTimeout(timer); clearTimeout(nfTimer);
    const my = ++seq;
    timer = setTimeout(async () => {
      try {
        const r = await api(`/api/places/resolve?city=${encodeURIComponent(mf.city.value.trim())}&country=${encodeURIComponent(mf.country.value.trim())}`);
        if (my !== seq) return;
        if (r.status === 'ok') {
          place = r.place;
          if (!mf.currency.value && mf.priceType.value === 'paid' && CC_CURRENCY[r.place.cc]) mf.currency.value = CC_CURRENCY[r.place.cc];
          if (!mf.country.value.trim()) { mf.country.value = r.place.country; lastQuery = `${mf.city.value.trim()}|${r.place.country}`; }
        }
        if (r.status === 'not_found') { // пока человек печатает, «не нашли» не показываем: сообщение — только после паузы или ухода из поля
          placeBox.innerHTML = '';
          const showLater = () => { if (my === seq) drawPlace('not_found', r.options || []); };
          clearTimeout(nfTimer); nfTimer = setTimeout(showLater, 1200);
          mf.city.addEventListener('blur', showLater, { once: true });
          return;
        }
        drawPlace(r.status, r.options || []);
      } catch (x) { if (my === seq) placeBox.innerHTML = `<span class="warn">${esc(errorText(x))}</span>`; }
    }, 350);
  };
  placeBox.addEventListener('click', (e) => {
    const b = e.target.closest('[data-place]'); if (!b) return;
    const o = JSON.parse(b.dataset.place);
    place = o; mf.city.value = o.city; mf.country.value = o.country; lastQuery = `${o.city}|${o.country}`;
    drawPlace('ok');
  });
  // Предпросмотр: дата и местное время так, как их увидят участники («Суббота, 21 ноября, 16:30 · Чиангмай»).
  const localLabel = (local, plusWeeks = 0, dur = 0) => {
    const mm = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local || ''); if (!mm) return '';
    const d = new Date(Date.UTC(+mm[1], +mm[2] - 1, +mm[3] + plusWeeks * 7, +mm[4], +mm[5]));
    const sDate = fmtTz(d.toISOString(), 'UTC', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const t1 = fmtTz(d.toISOString(), 'UTC', { hour: '2-digit', minute: '2-digit' });
    const t2 = dur ? fmtTz(new Date(d.getTime() + dur * 60000).toISOString(), 'UTC', { hour: '2-digit', minute: '2-digit' }) : '';
    return sDate.charAt(0).toUpperCase() + sDate.slice(1) + ', ' + t1 + (t2 ? '–' + t2 : '');
  };
  const previewFor = (box, local, city, n) => {
    if (!box) return;
    if (!local) { box.innerHTML = ''; return; }
    if (!city) { box.innerHTML = `<span class="warn">${esc(tt('Укажите город, чтобы опубликовать встречу.', 'Enter the city to publish the meeting.'))}</span>`; return; }
    const dur = Number(mf.durationMin && mf.durationMin.value) || 0;
    box.innerHTML = `<span class="muted small">${esc(tt('Участники увидят:', 'Participants will see:'))}</span><br><b>${esc(localLabel(local, 0, dur))} · ${esc(city)}</b>`
      + (n > 1 ? `<br><span class="small muted">${esc(tt(`Еженедельно, всего встреч: ${n}; последняя — ${localLabel(local, n - 1, dur)}`, `Weekly, ${n} meetings; the last — ${localLabel(local, n - 1, dur)}`))}</span>` : '');
  };
  const preview = () => { if (mf.firstDate) previewFor(ctx.main.querySelector('#tzprev'), mf.firstDate.value, place && place.city, repeatCount(mf)); };
  const paidBox = ctx.main.querySelector('#paid-fields');
  const syncPaid = () => { paidBox.hidden = mf.priceType.value !== 'paid'; };
  mf.priceType.addEventListener('change', () => { syncPaid(); if (!paidBox.hidden && !mf.currency.value && place && CC_CURRENCY[place.cc]) mf.currency.value = CC_CURRENCY[place.cc]; });
  mf.city.addEventListener('input', lookup); mf.country.addEventListener('input', lookup);
  if (mf.firstDate) wireRepeat(mf, preview);
  mf.durationMin.addEventListener('change', preview);
  drawPlace(place ? 'ok' : 'empty');
  if (!place && mf.city.value.trim()) lookup();
  mf.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(mf).entries());
    const errEl = ctx.main.querySelector('#err');
    if (!m && !mf.firstDate.value) { errEl.textContent = tt('Выберите дату и время встречи.', 'Choose the meeting date and time.'); mf.querySelector('[data-pick-date]').focus(); return; }
    if (!mf.title.value.trim()) { errEl.textContent = tt('Укажите название события.', 'Enter the event title.'); mf.title.focus(); return; }
    if (!(Number(mf.capacity.value) >= 1)) { errEl.textContent = tt('Укажите количество мест.', 'Enter the number of seats.'); mf.capacity.focus(); return; }
    if (!place) { ctx.main.querySelector('#err').textContent = tt('Уточните город встречи: по нему определяется местное время.', 'Specify the meeting city: the local time depends on it.'); placeBox.scrollIntoView({ block: 'center' }); return; }
    const body = { ...fd, priceAmount: mf.priceAmount.value, currency: mf.currency.value, city: place.city, country: place.country, placeId: place.placeId || '', sameAs: src ? src.id : undefined, askContact: mf.askContact.checked, capacity: Number(fd.capacity), repeatWeekly: repeatCount(mf) };
    try {
      if (m) { await api(`/api/fac/meetings/${id}`, { method: 'PUT', body }); toast(tt('Сохранено', 'Saved')); ctx.rerender(); }
      else { const r = await api('/api/fac/meetings', { method: 'POST', body }); toast(tt('Встреча опубликована', 'Meeting published')); ctx.navigate('/facilitator/m/' + r.id); }
    } catch (x) {
      if (x.code === 'city_unresolved') { place = null; drawPlace((x.data && x.data.options || []).length ? 'ambiguous' : 'not_found', (x.data && x.data.options) || []); }
      ctx.main.querySelector('#err').textContent = errorText(x);
    }
  });
  // ---------- скрытие всей встречи: подтверждение; скрытие не отменяет дат ----------
  const hideAsk = ctx.main.querySelector('#hide-ask');
  if (hideAsk) hideAsk.addEventListener('click', () => {
    ctx.main.querySelector('.more-menu').open = false;
    const slot = ctx.main.querySelector('#hide-slot');
    slot.innerHTML = `<div class="notice stack" role="alertdialog" aria-labelledby="hide-t"><b id="hide-t">${esc(tt('Скрыть встречу?', 'Hide the meeting?'))}</b>
      <span>${esc(tt('Все даты станут недоступны участникам. Даты и записи сохранятся в вашем кабинете.', 'All dates become unavailable to participants. Dates and sign-ups stay in your space.'))}</span>
      <span class="small">${esc(tt('Скрытие не отменяет встречи.', 'Hiding does not cancel the meetings.'))}</span>
      <div class="row"><button class="btn danger sm" type="button" id="hide-yes">${esc(tt('Скрыть встречу', 'Hide meeting'))}</button><button class="linkbtn" type="button" id="hide-no">${esc(tt('Назад', 'Back'))}</button></div></div>`;
    slot.querySelector('#hide-yes').focus();
    slot.querySelector('#hide-no').onclick = () => { slot.innerHTML = ''; hideAsk.focus(); };
    slot.querySelector('#hide-yes').onclick = async (e) => { e.target.disabled = true; try { await api(`/api/fac/meetings/${id}/publish`, { method: 'POST', body: { published: false } }); toast(tt('Встреча скрыта', 'Meeting hidden')); ctx.rerender(); } catch (x) { e.target.disabled = false; toast(errorText(x)); } };
  });
  const rp = ctx.main.querySelector('#republish');
  if (rp) rp.addEventListener('click', async () => { rp.disabled = true; try { await api(`/api/fac/meetings/${id}/publish`, { method: 'POST', body: { published: true } }); toast(tt('Встреча снова опубликована', 'Meeting published again')); ctx.rerender(); } catch (x) { rp.disabled = false; toast(errorText(x)); } });
  // ---------- отмена одной даты: подтверждение с датой, обновление только этой карточки, без прокрутки наверх ----------
  ctx.main.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-date]'); if (!b) return;
    const card = b.closest('[data-dcard]'); const act = card.querySelector('[data-dact]');
    const doIt = async (btn) => {
      btn.disabled = true;
      try {
        await api(`/api/fac/dates/${b.dataset.date}`, { method: 'PATCH', body: { status: b.dataset.set } });
        const fresh = await api(`/api/fac/meetings/${id}`); const dd = fresh.dates.find((x) => String(x.id) === b.dataset.date);
        card.outerHTML = dateCard(dd);
        const nc = ctx.main.querySelector(`[data-dcard="${b.dataset.date}"]`); nc.querySelector('[data-dstate]').setAttribute('tabindex', '-1'); nc.querySelector('[data-dstate]').focus({ preventScroll: true });
        toast(b.dataset.set === 'cancelled' ? tt('Дата отменена', 'Date cancelled') : tt('Дата восстановлена', 'Date restored'));
      } catch (x) { btn.disabled = false; toast(errorText(x)); }
    };
    if (b.dataset.set !== 'cancelled') return doIt(b);
    act.innerHTML = `<div class="notice stack" style="width:100%"><b>${esc(tt(`Отменить дату ${b.dataset.when}?`, `Cancel the date ${b.dataset.when}?`))}</b><span class="small">${esc(tt('Остальные даты не изменятся. Записи сохранятся.', 'Other dates stay as they are. Sign-ups are kept.'))}</span>
      <div class="row"><button class="btn danger sm" type="button" data-yes>${esc(tt('Отменить эту дату', 'Cancel this date'))}</button><button class="linkbtn" type="button" data-no>${esc(tt('Назад', 'Back'))}</button></div></div>`;
    act.querySelector('[data-no]').onclick = () => { card.outerHTML = dateCard(m.dates.find((x) => String(x.id) === b.dataset.date)); };
    act.querySelector('[data-yes]').onclick = (ev) => doIt(ev.target);
    act.querySelector('[data-yes]').focus();
  });
  // ---------- добавить дату (произвольную; при необходимости — еженедельно) ----------
  const addd = ctx.main.querySelector('#addd'); const addGo = ctx.main.querySelector('#add-date-go');
  if (addd) {
    const pv = () => previewFor(ctx.main.querySelector('#addprev'), addd.firstDate.value, m.city, repeatCount(addd));
    wireDatePicker(addd, pv); wireRepeat(addd, pv);
    addGo.addEventListener('click', () => { addd.hidden = false; addd.scrollIntoView({ block: 'nearest' }); addd.querySelector('[data-pick-date]').focus(); });
    ctx.main.querySelector('#addd-cancel').onclick = () => { addd.hidden = true; addGo.focus(); };
    addd.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = ctx.main.querySelector('#aderr');
      if (!addd.firstDate.value) { err.textContent = tt('Выберите дату и время.', 'Choose a date and time.'); addd.querySelector('[data-pick-date]').focus(); return; }
      const btn = addd.querySelector('button[type=submit]'); btn.disabled = true;
      try { await api(`/api/fac/meetings/${id}/dates`, { method: 'POST', body: { firstDate: addd.firstDate.value, repeatWeekly: repeatCount(addd) } }); toast(tt('Дата добавлена', 'Date added')); ctx.rerender(); }
      catch (x) { btn.disabled = false; err.textContent = errorText(x); }
    });
  }
  if (!m && mf.firstDate) wireDatePicker(mf, preview);
  wirePoint();
  // ---------- место на карте: поиск адреса с подтверждением или точка вручную ----------
  function wirePoint() {
    const ptBox = ctx.main.querySelector('#pt'); const geo = ctx.main.querySelector('#geo');
    const drawPt = () => {
      const has = mf.lat.value && mf.lng.value;
      ptBox.innerHTML = `${has ? `<span class="small"><b>✓ ${esc(tt('Точка на карте указана', 'Map point set'))}</b> <span class="muted">(${esc(Number(mf.lat.value).toFixed(5))}, ${esc(Number(mf.lng.value).toFixed(5))})</span></span>` : `<span class="small muted">${esc(tt('Точка на карте не указана — участники увидят адрес текстом.', 'No map point — participants will see the address as text.'))}</span>`}
        <div class="row"><button class="btn sm" type="button" id="geo-find">${esc(tt('Найти адрес на карте', 'Find the address on the map'))}</button><button class="btn sm light" type="button" id="map-open">${esc(tt('Указать точку на карте', 'Set the point on the map'))}</button>${has ? `<button class="linkbtn" type="button" id="pt-clear">${esc(tt('Убрать точку', 'Remove point'))}</button>` : ''}</div>`;
      ptBox.querySelector('#geo-find').onclick = find;
      ptBox.querySelector('#map-open').onclick = () => openMap();
      const cl = ptBox.querySelector('#pt-clear'); if (cl) cl.onclick = () => { mf.lat.value = ''; mf.lng.value = ''; drawPt(); };
    };
    async function find() {
      const q = [mf.venue.value, mf.city.value, mf.country.value].filter((x) => x.trim()).join(', ');
      if (!mf.venue.value.trim()) { geo.innerHTML = `<span class="small warn">${esc(tt('Сначала напишите место и адрес.', 'Enter the venue and address first.'))}</span>`; mf.venue.focus(); return; }
      geo.innerHTML = `<span class="small muted">${esc(tt('Ищем…', 'Searching…'))}</span>`;
      try {
        const r = await api(`/api/places/geocode?q=${encodeURIComponent(q)}&cc=${encodeURIComponent((place && place.cc) || '')}&lang=${lang}`);
        geo.innerHTML = r.results.length ? `<span class="small">${esc(tt('Выберите подходящий результат — или укажите точку вручную:', 'Pick the matching result — or set the point yourself:'))}</span><div class="list">${r.results.map((x, i) => `<button class="item" type="button" data-geo="${i}" style="text-align:left"><span class="body small">${esc(x.label)}</span></button>`).join('')}</div>`
          : `<span class="small warn">${esc(tt('Ничего не нашли. Укажите точку на карте вручную или уточните адрес.', 'Nothing found. Set the point on the map yourself or refine the address.'))}</span>`;
        geo.querySelectorAll('[data-geo]').forEach((bt) => bt.addEventListener('click', () => { const x = r.results[Number(bt.dataset.geo)]; geo.innerHTML = ''; openMap({ lat: x.lat, lng: x.lng, confirm: true }); }));
      } catch (x) { geo.innerHTML = `<span class="small warn">${esc(errorText(x))}</span>`; }
    }
    async function openMap(start = null) {
      let c = start || (mf.lat.value ? { lat: Number(mf.lat.value), lng: Number(mf.lng.value) } : null);
      if (!c && place && place.lat != null) c = { lat: place.lat, lng: place.lng, zoom: 12 };
      if (!c && mf.city.value.trim()) { try { const r = await api(`/api/places/resolve?city=${encodeURIComponent(mf.city.value.trim())}&country=${encodeURIComponent(mf.country.value.trim())}`); if (r.place && r.place.lat != null) c = { lat: r.place.lat, lng: r.place.lng, zoom: 12 }; } catch { /* без центра города */ } }
      pickPoint(c || { lat: 20, lng: 0, zoom: 2 }, start && start.confirm, (pt) => { mf.lat.value = pt.lat.toFixed(6); mf.lng.value = pt.lng.toFixed(6); drawPt(); });
    }
    drawPt();
  }
}

/** Окно с картой (Leaflet + OpenStreetMap): маркер можно перетащить или поставить нажатием; «Сохранить точку» — явное подтверждение. */
async function pickPoint(c, fromSearch, onSave) {
  const opener = document.activeElement;
  const el = document.createElement('div'); el.className = 'picker-wrap'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', tt('Точка на карте', 'Map point'));
  el.innerHTML = `<div class="picker"><div class="picker-head"><button class="icon-btn" type="button" data-x aria-label="${esc(tt('Отмена', 'Cancel'))}">${ic.close}</button>
    <div class="grow"><h2 style="margin:0;font-size:1.1rem">${esc(tt('Точка на карте', 'Map point'))}</h2><span class="small muted">${esc(fromSearch ? tt('Проверьте найденное место; при необходимости перетащите маркер.', 'Check the found place; drag the marker if needed.') : tt('Нажмите на карту или перетащите маркер.', 'Tap the map or drag the marker.'))}</span></div>
    <button class="btn yellow" type="button" data-ok>${esc(tt('Сохранить точку', 'Save point'))}</button></div>
    <div id="map" class="map-box"></div><p class="small muted" id="map-state" style="margin:0;padding:0 16px 12px" aria-live="polite"></p></div>`;
  document.getElementById('overlay-root').appendChild(el); document.body.classList.add('no-scroll');
  const close = () => { el.remove(); document.body.classList.remove('no-scroll'); document.removeEventListener('keydown', onKey); if (opener && document.contains(opener)) opener.focus({ preventScroll: true }); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  el.querySelector('[data-x]').onclick = close;
  const state = el.querySelector('#map-state');
  let pt = { lat: c.lat, lng: c.lng };
  el.querySelector('[data-ok]').onclick = () => { onSave(pt); close(); };
  try {
    await loadLeaflet();
    const L = window.L;
    const map = L.map(el.querySelector('#map')).setView([c.lat, c.lng], c.zoom || 16);
    let fails = 0;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' })
      .on('tileerror', () => { if (++fails === 3) state.textContent = tt('Карта загружается с ошибками. Описание места сохранится; точку можно сохранить и позже уточнить.', 'The map is not loading well. The place description is kept; you can save the point and refine it later.'); })
      .addTo(map);
    const icon = L.icon({ iconUrl: `${u('/vendor/leaflet/images/marker-icon.png')}`, iconRetinaUrl: `${u('/vendor/leaflet/images/marker-icon-2x.png')}`, shadowUrl: `${u('/vendor/leaflet/images/marker-shadow.png')}`, iconSize: [25, 41], iconAnchor: [12, 41] });
    const mk = L.marker([c.lat, c.lng], { draggable: true, icon, keyboard: true, title: tt('Место встречи', 'Meeting place') }).addTo(map);
    const upd = (ll) => { pt = { lat: ll.lat, lng: ll.lng }; state.textContent = `${tt('Точка:', 'Point:')} ${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`; };
    mk.on('dragend', () => upd(mk.getLatLng()));
    map.on('click', (e) => { mk.setLatLng(e.latlng); upd(e.latlng); });
    upd({ lat: c.lat, lng: c.lng });
    setTimeout(() => map.invalidateSize(), 50);
  } catch {
    state.textContent = tt('Карта сейчас недоступна. Описание места сохранится — точку можно указать позже.', 'The map is unavailable right now. The place description is kept — you can set the point later.');
    el.querySelector('[data-ok]').disabled = !fromSearch; // найденную адресом точку можно сохранить и без карты
  }
}
let leafletLoading = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (leafletLoading) return leafletLoading;
  leafletLoading = new Promise((resolve, reject) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = u('/vendor/leaflet/leaflet.css'); document.head.appendChild(css);
    const js = document.createElement('script'); js.src = u('/vendor/leaflet/leaflet.js'); js.onload = () => resolve(); js.onerror = () => { leafletLoading = null; reject(new Error('leaflet')); };
    document.head.appendChild(js);
  });
  return leafletLoading;
}

/** Выбор даты: заметная кнопка «Выбрать дату» с календарём (системный выбор даты), читаемая дата, время отдельным полем. */
const datePickerHtml = (p) => `<div class="date-pick"><input type="hidden" name="firstDate">
  <div class="row" style="align-items:flex-end">
    <div class="stack" style="gap:6px"><span class="field" style="font-weight:600;font-size:.9rem">${esc(tt('Дата', 'Date'))} *</span>
      <button class="btn date-btn" type="button" data-pick-date>${ic.calendar} <span data-date-label>${esc(tt('Выбрать дату', 'Choose a date'))}</span></button>
      <input type="date" class="date-native" data-date-input tabindex="-1" aria-hidden="true"></div>
    <label class="field">${esc(tt('Время', 'Time'))} *<input type="time" data-time-input step="300" style="min-width:120px"></label></div></div>`;
function wireDatePicker(f, onChange) {
  const di = f.querySelector('[data-date-input]'); const ti = f.querySelector('[data-time-input]'); const lab = f.querySelector('[data-date-label]');
  const sync = () => {
    f.firstDate.value = di.value && ti.value ? `${di.value}T${ti.value}` : '';
    if (di.value) { const [y, mo, d] = di.value.split('-').map(Number); const s2 = fmtTz(new Date(Date.UTC(y, mo - 1, d, 12)).toISOString(), 'UTC', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); lab.textContent = s2.charAt(0).toUpperCase() + s2.slice(1); }
    onChange && onChange();
  };
  f.querySelector('[data-pick-date]').addEventListener('click', () => { try { di.showPicker(); } catch { di.removeAttribute('aria-hidden'); di.classList.add('shown'); di.focus(); } });
  di.addEventListener('change', sync); di.addEventListener('input', sync); ti.addEventListener('input', sync); ti.addEventListener('change', sync);
}

// ---------- путь к роли фасилитатора ----------
// Порядок (17.11.2026): вход по email → руководство → проверка (отдельный экран) и заявка → решение администратора.
async function loadApplication(ctx) {
  let d = await api('/api/fac/application');
  // после входа — сразу руководство: заявка заводится сама, без вступления и кнопки «Начать»
  if (!d.application && !d.isFacilitator) { await api('/api/fac/application', { method: 'POST' }); d = await api('/api/fac/application'); }
  return d;
}
function facPath(d) {
  const a = d.application; const N = d.course.length;
  const stage = !a ? 1 : a.status === 'submitted' ? 3 : a.status === 'approved' ? 4 : a.courseDone.length === N ? 2 : 1;
  return timeline([
    { title: tt('Вход по email', 'Sign in with email'), state: 'done' },
    { title: tt('Руководство фасилитатора', 'Facilitator guide'), note: a ? esc(tt(`прочитано глав: ${a.courseDone.length} из ${N}`, `chapters read: ${a.courseDone.length} of ${N}`)) : '', state: stage > 1 ? 'done' : 'now' },
    { title: tt('Проверка знаний и заявка', 'Quiz and application'), note: a && a.quiz && a.quiz.passed && stage === 2 ? esc(tt('проверка пройдена', 'quiz passed')) : '', state: stage > 2 ? 'done' : stage === 2 ? 'now' : 'todo' },
    { title: tt('Решение администратора', 'Administrator’s decision'), note: a && a.status === 'rejected' ? esc(tt('Не одобрено: ', 'Not approved: ') + (a.decisionNote || '—')) : a && a.status === 'approved' ? esc(tt('Одобрено — роль выдана', 'Approved — role granted')) : '', state: stage === 4 ? 'done' : stage === 3 ? 'now' : a && a.status === 'rejected' ? 'bad' : 'todo' },
  ]);
}
const facHead = (d) => `<div class="page-head"><p class="eyebrow" style="margin:0">${esc(tt('Путь фасилитатора', 'Facilitator path'))}</p><h1>${esc(tt('Стать фасилитатором Dialogue Flow', 'Become a Dialogue Flow facilitator'))}</h1></div>
    <div class="card-ui flat" id="path">${facPath(d)}</div>`;
function facStatusBody(a) {
  if (a.status === 'submitted') return `<div class="card-ui stack"><span class="pill mint" style="justify-self:start">${esc(a.manualReview ? tt('Отправлено на ручную проверку', 'Sent for manual review') : tt('Заявка отправлена', 'Application sent'))}</span><h2 style="margin:0">${esc(tt('Решение администратора', 'Administrator’s decision'))}</h2>
      <p class="muted" style="margin:0">${esc(tt('Администратор рассмотрит заявку. Роль фасилитатора появится только после его одобрения — тогда в меню будет «Кабинет фасилитатора». Руководство остаётся доступным для чтения.', 'An administrator will review it. The facilitator role appears only after approval — then “Facilitator space” shows in the menu. The guide stays available to read.'))}</p></div>`;
  return `<div class="card-ui stack"><h2>${esc(tt('Роль выдана', 'Role granted'))}</h2><a class="btn yellow" href="${u('/facilitator')}">${esc(tt('Открыть кабинет фасилитатора', 'Open the facilitator space'))}</a></div>`;
}
export async function apply(ctx) {
  if (!session.user) return needLogin(ctx.main, tt('Чтобы стать фасилитатором, войдите по email.', 'Sign in with email to become a facilitator.'));
  loading(ctx.main);
  let d; let assets = { pdf: false, audio: {} };
  try { [d, assets] = await Promise.all([loadApplication(ctx), api('/api/guides/facilitator/assets').catch(() => assets)]); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  // аудиоглава — только если автор прислал запись: стандартный плеер (длительность, пауза, продолжение)
  const audioHtml = (i) => (assets.audio[String(i + 1)] ? `<div class="ch-audio"><b class="small">${esc(tt('Прослушать главу', 'Listen to the chapter'))}</b><audio controls preload="metadata" src="${u(`/guides/facilitator/chapter-${i + 1}`)}"></audio></div>` : '');
  if (d.isFacilitator && !d.application) {
    ctx.main.innerHTML = `<div class="wrap page narrow"><div class="card-ui stack"><h2>${esc(tt('Вы уже фасилитатор', 'You are already a facilitator'))}</h2><a class="btn dark" href="${u('/facilitator')}">${esc(tt('В кабинет', 'Open the space'))}</a></div></div>`;
    return;
  }
  const a = d.application;
  const N = d.course.length;
  const save = async (patch) => { await api('/api/fac/application', { method: 'PUT', body: patch }); };
  // Служебные пометки автора «[Ожидает правки…]» читателю не показываем; заглушку карточки с вопросами заменяем
  // утверждёнными вопросами «Для двоих»; место для ссылки на группу иллюстраторов — ссылка «Предложить иллюстрацию».
  const pairQ = () => ((QUESTION_FORMATS.find((f) => f.key === 'pair') || {}).lists || []).map((l) => `<h4>${esc(l.title[lang] || l.title.ru)}</h4><ul>${(l.items[lang] || l.items.ru).map((q) => `<li>${esc(q)}</li>`).join('')}</ul>`).join('');
  const block = (b) => {
    const t = String(b.text || '').trim();
    if (/^\[Ожидает списка вопросов/.test(t)) return pairQ();
    if (/^\[Ссылка на группу иллюстраторов/.test(t)) return `<p><a href="${u('/artist/submit')}">${esc(tt('Предложить иллюстрацию', 'Suggest an illustration'))}</a> · <a href="${u('/team/general')}">${esc(tt('Общий чат сообщества', 'Community chat'))}</a></p>`;
    if (/^\[Ожидает/.test(t)) return '';
    return b.t === 'h' ? `<h4>${esc(t)}</h4>` : b.t === 'li' ? `<ul><li>${esc(t)}</li></ul>` : `<p>${esc(t)}</p>`;
  };
  let body = '';
  if (a.status === 'in_progress' || a.status === 'rejected') {
    const done = new Set(a.courseDone);
    const nextUnread = d.course.findIndex((_, i) => !done.has(i));
    const allRead = done.size === N;
    body = `<section class="stack" aria-labelledby="s1"><h2 id="s1" style="margin:0">${esc(tt('Руководство фасилитатора', 'Facilitator guide'))}</h2>
        <p class="small muted" style="margin:0">${esc(tt('Откройте главу и прочитайте её.', 'Open a chapter and read it.'))}</p>
        <p class="small muted" style="margin:0">${esc(tt('Когда дочитаете, нажмите «Я прочитал(а)» в конце главы — само открытие главы отметку не ставит.', 'When you finish, press “I have read it” at the end of the chapter — opening a chapter does not mark it.'))}</p>
        <p class="small muted" style="margin:0">${esc(tt('Отметки сохраняются в вашем аккаунте: можно закрыть страницу и вернуться позже — на этом или другом устройстве, войдя по тому же email.', 'Marks are saved in your account: you can close the page and come back later — on this or another device, signed in with the same email.'))}</p>
        ${assets.pdf ? `<p style="margin:0"><a class="btn sm light" href="${u('/guides/facilitator/guide.pdf')}" download>${esc(tt('Скачать руководство (PDF) — для чтения или печати', 'Download the guide (PDF) — to read or print'))}</a></p>` : ''}
        <nav class="toc small" aria-label="${esc(tt('Оглавление', 'Contents'))}"><b>${esc(tt('Оглавление', 'Contents'))}</b><ol>${d.course.map((t0, i) => `<li><a href="#ch-${i + 1}" data-toc="${i + 1}">${esc(t0)}</a>${done.has(i) ? ' ✓' : ''}</li>`).join('')}</ol></nav>
        ${d.guideMissing ? `<div class="notice">${esc(tt('Тексты глав ещё не загружены администратором — пока видны только названия.', 'Chapter texts have not been uploaded yet — only titles are shown.'))}</div>` : ''}
        <div class="row between"><b id="prog">${esc(tt(`Прочитано ${done.size} из ${N}`, `Read ${done.size} of ${N}`))}</b>${nextUnread >= 0 && done.size ? `<button class="btn sm" type="button" id="cont">${esc(tt(`Продолжить с главы ${nextUnread + 1}`, `Continue with chapter ${nextUnread + 1}`))}</button>` : ''}</div>
        <div class="stack" style="gap:8px">${d.course.map((title, i) => `<details class="chapter ${done.has(i) ? 'read' : ''}" data-chapter="${i}" id="ch-${i + 1}"><summary><span class="state" aria-hidden="true">${done.has(i) ? icons.check : ''}</span><span class="grow"><b>${esc(title)}</b><br><span class="small muted" data-chstate>${esc(done.has(i) ? tt('Прочитано', 'Read') : tt('Не прочитано', 'Not read'))}</span></span></summary>
          <div class="ch-body">${audioHtml(i)}${d.chapters ? d.chapters[i].map(block).join('') : `<p class="muted">${esc(tt('Текст этой главы пока не загружен.', 'This chapter’s text is not uploaded yet.'))}</p>`}
            <div class="row" style="margin-top:10px"><button class="btn ${done.has(i) ? 'light' : 'yellow'} sm" type="button" data-read="${i}" aria-pressed="${done.has(i)}">${esc(done.has(i) ? tt('Отметить как непрочитанную', 'Mark as unread') : tt('Я прочитал(а)', 'I have read it'))}</button></div></div></details>`).join('')}
          ${d.extra.map((x) => `<details class="chapter optional"><summary><span class="state" aria-hidden="true"></span><span class="grow"><b>${esc(x.title)}</b><br><span class="small muted">${esc(tt('Приложение · необязательно, на проверку не влияет', 'Appendix · optional, not part of the quiz'))}</span></span></summary><div class="ch-body">${x.blocks.map(block).join('')}</div></details>`).join('')}</div></section>
      ${allRead ? `<section class="card-ui stack" aria-labelledby="s2"><h2 id="s2" style="margin:0">${icons.check} ${esc(tt('Всё прочитано', 'All read'))}</h2>
        <p class="muted" style="margin:0">${esc(a.quiz && a.quiz.passed ? tt('Проверка пройдена — осталось отправить заявку.', 'The quiz is passed — now send the application.') : tt('Теперь пройдите короткую проверку знаний по руководству. После неё — заявка.', 'Now take a short quiz on the guide. The application comes after it.'))}</p>
        <div><a class="btn yellow" href="${u('/facilitator/quiz')}">${esc(a.quiz && a.quiz.passed ? tt('К заявке', 'To the application') : tt('Пройти проверку', 'Take the quiz'))}</a></div></section>` : ''}`;
  } else body = facStatusBody(a);
  ctx.main.innerHTML = `<div class="wrap page narrow stack">${facHead(d)}${body}</div>`;
  ctx.main.querySelectorAll('[data-toc]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); const det = ctx.main.querySelector(`#ch-${a.dataset.toc}`); if (det) { det.open = true; det.scrollIntoView({ block: 'start' }); det.querySelector('summary').focus({ preventScroll: true }); } }));
  const hashCh = /^#ch-(\d+)$/.exec(location.hash); if (hashCh) { const det = ctx.main.querySelector(`#ch-${hashCh[1]}`); if (det) det.open = true; }
  const cont = ctx.main.querySelector('#cont');
  if (cont) cont.addEventListener('click', () => { const det = ctx.main.querySelector(`[data-chapter="${d.course.findIndex((_, i) => !a.courseDone.includes(i))}"]`); if (det) { det.open = true; det.scrollIntoView({ behavior: 'smooth', block: 'start' }); det.querySelector('summary').focus({ preventScroll: true }); } });
  ctx.main.querySelectorAll('[data-read]').forEach((b) => b.addEventListener('click', async () => {
    const i = Number(b.dataset.read); const set = new Set(a.courseDone);
    if (set.has(i)) set.delete(i); else set.add(i);
    const next = [...set].sort((x, y) => x - y);
    b.disabled = true;
    const wasAll = a.courseDone.length === N;
    try { await save({ courseDone: next }); } catch (x) { b.disabled = false; toast(errorText(x)); return; }
    a.courseDone = next;
    if ((next.length === N) !== wasAll) { const y = window.scrollY; await ctx.rerender(); window.scrollTo(0, y); if (next.length === N) { const s2 = ctx.main.querySelector('#s2'); if (s2) s2.scrollIntoView({ behavior: 'smooth', block: 'center' }); } return; }
    // Иначе — только эта глава и счётчик, без перерисовки. Прочитанная глава сворачивается; открыть её снова можно.
    const on = set.has(i); const det = b.closest('details.chapter');
    det.classList.toggle('read', on);
    det.querySelector('.state').innerHTML = on ? icons.check : '';
    det.querySelector('[data-chstate]').textContent = on ? tt('Прочитано', 'Read') : tt('Не прочитано', 'Not read');
    b.className = `btn ${on ? 'light' : 'yellow'} sm`; b.setAttribute('aria-pressed', String(on));
    b.textContent = on ? tt('Отметить как непрочитанную', 'Mark as unread') : tt('Я прочитал(а)', 'I have read it');
    b.disabled = false;
    if (on) { det.open = false; det.scrollIntoView({ block: 'nearest' }); det.querySelector('summary').focus({ preventScroll: true }); }
    const pr = ctx.main.querySelector('#prog'); if (pr) pr.textContent = tt(`Прочитано ${next.length} из ${N}`, `Read ${next.length} of ${N}`);
    if (on) toast(tt('Глава отмечена как прочитанная', 'Chapter marked as read'));
  }));
}

// ---------- проверка знаний: отдельный экран, попытки с подсказками, затем заявка ----------
export async function quiz(ctx) {
  if (!session.user) return needLogin(ctx.main, tt('Чтобы стать фасилитатором, войдите по email.', 'Sign in with email to become a facilitator.'));
  loading(ctx.main);
  let d;
  try { d = await loadApplication(ctx); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  const a = d.application;
  if (!a) { ctx.navigate('/facilitator/apply', { replace: true }); return; }
  const N = d.course.length;
  const back = `<a class="small" href="${u('/facilitator/apply')}">← ${esc(tt('К руководству', 'To the guide'))}</a>`;
  if (!['in_progress', 'rejected'].includes(a.status)) { ctx.main.innerHTML = `<div class="wrap page narrow stack">${back}${facHead(d)}${facStatusBody(a)}</div>`; return; }
  if (a.courseDone.length < N) {
    ctx.main.innerHTML = `<div class="wrap page narrow stack">${back}${facHead(d)}<div class="card-ui stack"><p style="margin:0">${esc(tt(`Проверка откроется, когда все главы руководства будут отмечены как прочитанные (сейчас ${a.courseDone.length} из ${N}).`, `The quiz opens once all guide chapters are marked as read (now ${a.courseDone.length} of ${N}).`))}</p><div><a class="btn yellow" href="${u('/facilitator/apply')}">${esc(tt('К руководству', 'To the guide'))}</a></div></div></div>`;
    return;
  }
  const q = a.quiz || { attempts: 0 };
  const order = {};
  const shuffled = (x) => order[x.id] || (order[x.id] = x.options.map((_, i) => i).sort(() => Math.random() - 0.5));
  const save = async (patch) => { await api('/api/fac/application', { method: 'PUT', body: patch }); };
  const appForm = (manual) => `<label class="field">${esc(tt('Город', 'City'))}<input type="text" id="city" maxlength="100" value="${esc(a.city)}"></label>
      <label class="field">${esc(tt('О себе и опыте встреч', 'About you and your meeting experience'))}<textarea id="about" maxlength="2000">${esc(a.about)}</textarea></label>
      <p class="form-error" id="err" role="alert"></p>
      <div><button class="btn ${manual ? 'light' : 'yellow'}" type="button" id="${manual ? 'manual' : 'submit'}">${esc(manual ? tt('Отправить на ручную проверку', 'Send for manual review') : tt('Отправить заявку', 'Send application'))}</button></div>`;
  let body;
  if (q.passed) {
    body = `<section class="card-ui stack" aria-labelledby="qs"><span class="pill mint" style="justify-self:start">${icons.check} ${esc(tt('Проверка пройдена', 'Quiz passed'))}</span>
      <h2 id="qs" style="margin:0">${esc(tt('Заявка', 'Application'))}</h2>
      <p class="muted" style="margin:0">${esc(tt('Расскажите немного о себе. Роль фасилитатора выдаёт администратор после рассмотрения заявки.', 'Tell us a little about yourself. The administrator grants the facilitator role after reviewing the application.'))}</p>
      ${appForm(false)}</section>`;
  } else {
    const wrong = new Set(q.wrongNumbers || []);
    const chName = (i) => d.course[i] || tt(`Глава ${i + 1}`, `Chapter ${i + 1}`);
    let fb = '';
    if (q.attempts) {
      fb = `<div class="notice" role="status" id="qfb"><b>${esc(tt(`Верно ${q.correct} из ${q.total}.`, `${q.correct} of ${q.total} correct.`))}</b>
        ${q.wrongNumbers ? ` ${esc(tt('Ошибки в вопросах:', 'Mistakes in questions:'))} <b>${q.wrongNumbers.join(', ')}</b>.` : ''}
        ${esc(tt(' Ответы сохранены — исправьте и проверьте ещё раз.', ' Your answers are saved — fix them and check again.'))}
        ${q.chapters ? `<ul class="small" style="margin:8px 0 0">${Object.entries(q.chapters).map(([n, chs]) => `<li>${esc(tt(`Вопрос ${n}`, `Question ${n}`))}: ${chs.map((i) => `<a href="${u('/facilitator/apply#ch-' + (i + 1))}">${esc(chName(i))}</a>`).join(', ')}</li>`).join('')}</ul>` : ''}</div>`;
    }
    body = `<section class="stack" aria-labelledby="qs"><h2 id="qs" style="margin:0">${esc(tt('Проверка знаний', 'Quiz'))}</h2>
      <p class="small muted" style="margin:0">${esc(tt(`${d.questions.length} вопросов по руководству. Ответы сохраняются сразу — можно вернуться позже.`, `${d.questions.length} questions on the guide. Answers are saved right away — you can come back later.`))}</p>
      ${fb}
      <ol class="quiz">${d.questions.map((x, n) => `<li class="quiz-item ${wrong.has(n + 1) ? 'wrong' : ''}" id="q-${n + 1}"><p class="quiz-q" id="ql-${x.id}">${esc(x.text)}${wrong.has(n + 1) ? ` <span class="pill bad">${esc(tt('ошибка', 'mistake'))}</span>` : ''}</p>
        <div class="radio-list" role="radiogroup" aria-labelledby="ql-${x.id}">${shuffled(x).map((i) => `<label class="radio"><input type="radio" name="${x.id}" value="${i}" ${String(a.answers[x.id]) === String(i) ? 'checked' : ''}><span>${esc(x.options[i])}</span></label>`).join('')}</div></li>`).join('')}</ol>
      <p class="form-error" id="qerr" role="alert"></p>
      <div><button class="btn yellow big" type="button" id="check">${esc(tt('Проверить ответы', 'Check answers'))}</button></div></section>
      ${q.canManual ? `<section class="card-ui stack" aria-labelledby="mr"><h2 id="mr" style="margin:0">${esc(tt('Ручная проверка', 'Manual review'))}</h2>
        <p class="muted" style="margin:0">${esc(tt('Можно отправить ваши ответы и заявку администратору — он посмотрит их сам. Роль выдаётся только после его решения.', 'You can send your answers and application to the administrator, who will review them. The role is granted only after that decision.'))}</p>${appForm(true)}</section>` : ''}`;
  }
  ctx.main.innerHTML = `<div class="wrap page narrow stack">${back}${facHead(d)}${body}</div>`;
  ctx.main.querySelectorAll('.quiz input[type=radio]').forEach((r) => r.addEventListener('change', async () => {
    a.answers[r.name] = Number(r.value);
    try { await save({ answers: a.answers }); } catch (x) { toast(errorText(x)); }
  }));
  const ck = ctx.main.querySelector('#check');
  if (ck) ck.addEventListener('click', async () => {
    const miss = d.questions.findIndex((x) => a.answers[x.id] === undefined || a.answers[x.id] === null);
    if (miss >= 0) { ctx.main.querySelector('#qerr').textContent = tt(`Ответьте на вопрос ${miss + 1}.`, `Answer question ${miss + 1}.`); ctx.main.querySelector(`#q-${miss + 1}`).scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    ck.disabled = true;
    try {
      const r = await api('/api/fac/application/quiz', { method: 'POST', body: { answers: a.answers } });
      await ctx.rerender();
      const target = ctx.main.querySelector(r.quiz.passed ? '#qs' : '#qfb'); if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (r.quiz.passed) toast(tt('Проверка пройдена', 'Quiz passed'));
    } catch (x) { ck.disabled = false; ctx.main.querySelector('#qerr').textContent = errorText(x); }
  });
  const fields = () => ({ about: ctx.main.querySelector('#about').value, city: ctx.main.querySelector('#city').value });
  const sb = ctx.main.querySelector('#submit');
  if (sb) sb.addEventListener('click', async () => {
    sb.disabled = true;
    try { await save({ ...fields(), answers: a.answers }); await api('/api/fac/application/submit', { method: 'POST' }); await refreshSession(); toast(tt('Заявка отправлена', 'Application sent')); ctx.rerender(); }
    catch (x) { sb.disabled = false; ctx.main.querySelector('#err').textContent = errorText(x); }
  });
  const mb = ctx.main.querySelector('#manual');
  if (mb) mb.addEventListener('click', async () => {
    if (!confirm(tt('Отправить ответы и заявку на ручную проверку администратору?', 'Send your answers and application to the administrator for manual review?'))) return;
    mb.disabled = true;
    try { await api('/api/fac/application/manual', { method: 'POST', body: fields() }); toast(tt('Отправлено на ручную проверку', 'Sent for manual review')); ctx.rerender(); }
    catch (x) { mb.disabled = false; ctx.main.querySelector('#err').textContent = errorText(x); }
  });
}
