// Встречи Dialogue Flow для посетителя: страна → город → встречи, страница даты, запись без аккаунта, отмена.
import { lang } from '../i18n.js';
import { esc, tt, u, api, errorText, fmtTz, toast } from '../util.js';
import { session, loading, failed, demoPill, ic } from '../ui.js';

export const LANG_NAMES = { ru: ['Русский', 'Russian'], en: ['Английский', 'English'], zh: ['Китайский', 'Chinese'], th: ['Тайский', 'Thai'], de: ['Немецкий', 'German'], fr: ['Французский', 'French'], es: ['Испанский', 'Spanish'], it: ['Итальянский', 'Italian'], uk: ['Украинский', 'Ukrainian'], kk: ['Казахский', 'Kazakh'], other: ['Другой', 'Other'] };
export const langName = (code) => { const n = LANG_NAMES[code] || [code, code]; return lang === 'en' ? n[1] : n[0]; };
const myTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function eventRow(d) {
  const m = d.meeting;
  const day = fmtTz(d.startsAt, m.timezone, { day: 'numeric' });
  const mon = fmtTz(d.startsAt, m.timezone, { month: 'short' });
  const time = fmtTz(d.startsAt, m.timezone, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  return `<a class="event" href="${u('/m/' + d.id)}"><div class="cal"><b>${esc(day)}</b><span>${esc(mon)}</span></div>
    <div class="stack" style="gap:4px"><b style="font:700 1.1rem var(--font-head)">${esc(m.title)} ${demoPill(m.isDemo)}</b>
      <span class="small muted">${esc(m.city)}, ${esc(m.country)} · ${esc(time)} (${esc(m.timezone)})</span>
      <div class="row" style="gap:6px"><span class="pill">${esc(langName(m.language))}</span>
        <span class="pill">${esc(m.priceType === 'paid' ? tt('Платная', 'Paid') : tt('Бесплатная', 'Free'))}</span>
        <span class="pill ${d.left ? 'mint' : 'red'}">${esc(d.left ? tt(`Свободно мест: ${d.left}`, `Seats left: ${d.left}`) : tt('Мест нет', 'Full'))}</span></div>
      <span class="small muted">${esc(tt('Фасилитатор', 'Facilitator'))}: ${esc(m.facilitator)}</span></div></a>`;
}

export async function search(ctx, country, city) {
  loading(ctx.main);
  let places; let dates = [];
  try {
    ({ places } = await api('/api/meetings/places'));
    if (country) ({ dates } = await api(`/api/meetings?country=${encodeURIComponent(country)}${city ? `&city=${encodeURIComponent(city)}` : ''}`));
  } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  const cur = places.find((p) => p.country === country);
  const crumbs = `<div class="row small"><a href="${u('/meetings')}">${esc(tt('Все страны', 'All countries'))}</a>${country ? ` › <a href="${u('/meetings/' + encodeURIComponent(country))}">${esc(country)}</a>` : ''}${city ? ` › <b>${esc(city)}</b>` : ''}</div>`;
  ctx.main.innerHTML = `<section class="hero"><div class="wrap" style="grid-template-columns:1fr;padding-block:34px 30px">
      <div><p class="eyebrow">Dialogue Flow</p><h1>${esc(city || country || tt('Найти встречу', 'Find a meeting'))}</h1>
      <p class="lead">${esc(tt('Встреча — возможность для содержательного человеческого общения. Выберите страну и город. Время показано в часовом поясе встречи.', 'A meeting is a chance for meaningful human conversation. Pick a country and city. Times are shown in the meeting’s time zone.'))}</p>
      <div class="chips" style="margin-top:8px">${places.map((p) => `<a class="chip ${p.country === country ? 'on' : ''}" href="${u('/meetings/' + encodeURIComponent(p.country))}">${esc(p.country)} · ${p.count}</a>`).join('') || `<span class="muted">${esc(tt('Пока нет опубликованных встреч.', 'No published meetings yet.'))}</span>`}</div>
      ${cur ? `<div class="chips" style="margin-top:10px">${cur.cities.map((c) => `<a class="chip ${c.city === city ? 'on' : ''}" href="${u('/meetings/' + encodeURIComponent(country) + '/' + encodeURIComponent(c.city))}">${esc(c.city)} · ${c.count}</a>`).join('')}</div>` : ''}
      </div></div></section>
    <div class="wrap page stack">${crumbs}
      ${country ? (dates.length ? `<div class="list">${dates.map(eventRow).join('')}</div>` : `<p class="empty">${esc(tt('Ближайших встреч здесь нет.', 'No upcoming meetings here.'))}</p>`)
        : `<p class="muted">${esc(tt('Выберите страну выше.', 'Choose a country above.'))}</p>`}
      ${session.user && session.user.roles.includes('facilitator') ? `<a class="btn dark" href="${u('/facilitator/m/new')}" style="justify-self:start">${esc(tt('Опубликовать свою встречу', 'Publish your meeting'))}</a>` : ''}
    </div>`;
}

export async function datePage(ctx, id) {
  loading(ctx.main);
  let d;
  try { d = await api(`/api/meetings/dates/${id}`); } catch (e) {
    if (!ctx.alive()) return;
    if (e.status === 404) { ctx.main.innerHTML = `<div class="wrap page narrow"><p class="empty">${esc(tt('Встреча не найдена.', 'Meeting not found.'))}</p></div>`; return; }
    return failed(ctx.main, e, ctx.rerender);
  }
  if (!ctx.alive()) return;
  const m = d.meeting;
  const local = fmtTz(d.startsAt, m.timezone, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const mine = myTz() !== m.timezone ? fmtTz(d.startsAt, myTz(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  let state = d.open ? (d.left ? 'open' : 'full') : 'closed';
  let done = null;
  const draw = () => {
    ctx.main.innerHTML = `<section class="hero"><div class="wrap" style="padding-block:30px 34px">
      <div><a class="small" href="${u('/meetings/' + encodeURIComponent(m.country) + '/' + encodeURIComponent(m.city))}" style="color:var(--on-navy-muted)">← ${esc(m.city)}</a>
        <p class="eyebrow" style="margin-top:12px">${esc(local)}</p>
        <h1>${esc(m.title)} ${demoPill(m.isDemo)}</h1>
        <p class="lead">${esc(m.city)}, ${esc(m.country)}${m.venue ? ' · ' + esc(m.venue) : ''}</p>
        <div class="row"><span class="pill yellow">${esc(langName(m.language))}</span><span class="pill">${esc(m.timezone)}</span>
          <span class="pill">${esc(m.priceType === 'paid' ? tt('Платная', 'Paid') : tt('Бесплатная', 'Free'))}</span>
          <span class="pill ${d.left ? 'mint' : 'red'}">${esc(tt(`Мест: ${d.left} из ${d.capacity}`, `Seats: ${d.left} of ${d.capacity}`))}</span></div>
        ${mine ? `<p class="small" style="color:var(--on-navy-muted);margin-top:10px">${esc(tt('По вашему времени:', 'Your local time:'))} ${esc(mine)} (${esc(myTz())})</p>` : ''}
      </div>
      <div class="card-ui" id="reg"></div></div></section>
    <div class="wrap page narrow stack">
      ${m.status === 'removed' ? `<div class="notice red">${esc(tt('Встреча снята с публикации администратором.', 'The meeting was taken down by an administrator.'))}</div>` : ''}
      ${m.description ? `<div class="card-ui flat"><h3>${esc(tt('О встрече', 'About'))}</h3><p style="white-space:pre-wrap;margin:0">${esc(m.description)}</p></div>` : ''}
      <div class="card-ui flat"><dl class="sheet-list" style="margin:0">
        <div><dt>${esc(tt('Фасилитатор', 'Facilitator'))}</dt><dd>${esc(m.facilitator)}</dd></div>
        <div><dt>${esc(tt('Язык встречи', 'Meeting language'))}</dt><dd>${esc(langName(m.language))}</dd></div>
        <div><dt>${esc(tt('Оплата', 'Payment'))}</dt><dd>${esc(m.priceType === 'paid' ? (m.priceNote || tt('Оплату организует фасилитатор', 'Arranged by the facilitator')) : tt('Бесплатно', 'Free'))}</dd></div>
      </dl><p class="small muted" style="margin:8px 0 0">${esc(tt('Сайт не принимает оплату: её организует фасилитатор.', 'The site does not take payments: the facilitator arranges them.'))}</p></div>
      ${d.otherDates.length ? `<h3>${esc(tt('Другие даты этой встречи', 'Other dates of this meeting'))}</h3><div class="chips">${d.otherDates.map((o) => `<a class="chip" href="${u('/m/' + o.id)}">${esc(fmtTz(o.startsAt, m.timezone, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))} · ${o.left}</a>`).join('')}</div>` : ''}
    </div>`;
    const reg = ctx.main.querySelector('#reg');
    if (done) {
      reg.innerHTML = `<h3>${esc(tt('Вы записаны', 'You are registered'))}</h3>
        ${confirmHtml(d, m, done.token)}
        <p class="muted small" style="margin:12px 0 0">${esc(done.isDemo ? tt('Это демо-встреча: письмо не отправляется. Чтобы отменить запись, откройте «Моя запись и отмена».', 'This is a demo meeting: no email is sent. To cancel, open “My registration and cancel”.') : done.letter.sent ? tt('Письмо с этими данными и ссылкой для отмены отправлено на вашу почту.', 'An email with these details and a cancel link has been sent to you.')
          : tt('Почта пока не подключена: письмо не отправлено. Сохраните ссылку «Моя запись и отмена» — по ней можно отменить запись.', 'Email is not connected yet: no letter was sent. Keep the “My registration” link — you can cancel there.'))}</p>
        ${done.letter.body && !done.letter.sent ? `<details class="small" style="margin-top:8px"><summary>${esc(tt('Текст письма (демо)', 'Letter text (demo)'))}</summary><div class="letter">${esc(done.letter.body)}</div></details>` : ''}`;
      return;
    }
    if (state !== 'open') {
      reg.innerHTML = `<h3>${esc(state === 'full' ? tt('Мест нет', 'Fully booked') : tt('Запись закрыта', 'Registration closed'))}</h3>
        <p class="muted" style="margin:0">${esc(state === 'full' ? tt('Все места на эту дату заняты. Лист ожидания пока не предусмотрен — посмотрите другие даты.', 'All seats for this date are taken. There is no waiting list yet — check other dates.') : tt('На эту дату записаться нельзя.', 'You cannot sign up for this date.'))}</p>`;
      return;
    }
    reg.innerHTML = `<h3>${esc(tt('Записаться', 'Sign up'))}</h3><p class="small muted">${esc(tt('Аккаунт не нужен.', 'No account needed.'))}</p>
      <form class="form" id="rf">
        <label class="field">${esc(tt('Имя', 'Name'))} *<input type="text" name="name" required maxlength="100" value="${esc(session.user ? session.user.publicName : '')}"></label>
        <label class="field">Email *<input type="email" name="email" required maxlength="200" value="${esc(session.user && session.user.email ? session.user.email : '')}"></label>
        ${m.askContact ? `<label class="field">${esc(tt('Телефон или мессенджер', 'Phone or messenger'))} <span class="hint">${esc(tt('по желанию — для связи с фасилитатором', 'optional — for the facilitator to reach you'))}</span><input type="text" name="contact" maxlength="200"></label>` : ''}
        <p class="form-error" id="rerr" role="alert"></p>
        <button class="btn dark wide" type="submit">${esc(tt('Записаться', 'Sign up'))}</button></form>`;
    reg.querySelector('#rf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        done = await api(`/api/meetings/dates/${id}/register`, { method: 'POST', body: { name: f.name.value, email: f.email.value, contact: f.contact ? f.contact.value : '', lang } });
        d.left -= 1; draw(); toast(tt('Вы записаны', 'You are registered'));
      } catch (err) {
        if (err.code === 'full') { state = 'full'; d.left = 0; draw(); return; }
        reg.querySelector('#rerr').textContent = errorText(err);
      }
    });
  };
  draw();
}

/** Подтверждение записи: дата, местное время встречи, пояс, место, календарь, ссылка на отмену. */
function confirmHtml(d, m, token) {
  const when = fmtTz(d.startsAt, m.timezone, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const mine = myTz() !== m.timezone ? fmtTz(d.startsAt, myTz(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const place = [m.venue, m.city, m.country].filter(Boolean).join(', ');
  const start = new Date(d.startsAt).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const gcal = 'https://calendar.google.com/calendar/render?' + new URLSearchParams({ action: 'TEMPLATE', text: m.title, dates: `${start}/${start}`, location: place, details: `${location.origin}${u('/r/' + token)}` });
  return `<dl class="sheet-list confirm-list" style="margin:0">
      <div><dt>${esc(tt('Когда', 'When'))}</dt><dd><b>${esc(when)}</b><br><span class="small muted">${esc(tt('местное время встречи', 'meeting local time'))} · ${esc(m.timezone)}</span>${mine ? `<br><span class="small muted">${esc(tt('По вашему времени:', 'Your local time:'))} ${esc(mine)} (${esc(myTz())})</span>` : ''}</dd></div>
      <div><dt>${esc(tt('Где', 'Where'))}</dt><dd>${esc(place)}</dd></div>
    </dl>
    <div class="row" style="margin-top:12px">
      <a class="btn yellow" href="${u('/api/registrations/' + token + '/ics?lang=' + lang)}" download="dialogue-flow.ics">${ic.calendar} ${esc(tt('Добавить в календарь', 'Add to calendar'))}</a>
      <a class="btn light sm" href="${esc(gcal)}" target="_blank" rel="noopener">Google ${esc(tt('Календарь', 'Calendar'))}</a>
      <a class="btn dark sm" href="${u('/r/' + token)}">${esc(tt('Моя запись и отмена', 'My registration and cancel'))}</a></div>`;
}

export async function registration(ctx, token) {
  loading(ctx.main);
  let x;
  try { x = await api(`/api/registrations/${token}`); } catch (e) {
    if (!ctx.alive()) return;
    if (e.status === 404) { ctx.main.innerHTML = `<div class="wrap page narrow"><p class="empty">${esc(tt('Запись не найдена. Проверьте ссылку из письма.', 'Registration not found. Check the link from the email.'))}</p></div>`; return; }
    return failed(ctx.main, e, ctx.rerender);
  }
  if (!ctx.alive()) return;
  const draw = () => {
    const m = x.meeting;
    const active = x.status === 'active';
    ctx.main.innerHTML = `<div class="wrap page narrow stack">
      <p class="eyebrow">${esc(tt('Моя запись', 'My registration'))}</p><h1>${esc(m.title)}</h1>
      <p class="lead">${esc(fmtTz(x.date.startsAt, m.timezone, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }))} (${esc(m.timezone)}) · ${esc(m.city)}</p>
      <div class="card-ui stack">
        <div class="row between"><b>${esc(x.name)}</b>${active ? `<span class="pill mint">${esc(tt('Запись активна', 'Active'))}</span>` : `<span class="pill red">${esc(tt('Запись отменена', 'Cancelled'))}</span>`}</div>
        <span class="small muted">${esc(x.email)}</span>
        ${active ? `<a class="btn yellow" href="${u('/api/registrations/' + token + '/ics?lang=' + lang)}" download="dialogue-flow.ics">${ic.calendar} ${esc(tt('Добавить в календарь', 'Add to calendar'))}</a>
          <button class="btn danger" type="button" id="cancel">${esc(tt('Отменить запись и освободить место', 'Cancel and free my seat'))}</button>`
          : `<p class="muted" style="margin:0">${esc(tt('Место освобождено. Спасибо, что предупредили.', 'Your seat has been freed. Thank you for letting us know.'))}</p>`}
        <a class="btn" href="${u('/m/' + x.date.id)}">${esc(tt('Страница встречи', 'Meeting page'))}</a>
      </div></div>`;
    const c = ctx.main.querySelector('#cancel');
    if (c) c.addEventListener('click', async () => {
      try { await api(`/api/registrations/${token}/cancel`, { method: 'POST' }); x.status = 'cancelled'; draw(); toast(tt('Запись отменена', 'Registration cancelled')); } catch (e) { toast(errorText(e)); }
    });
  };
  draw();
}
