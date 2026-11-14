// Встречи Dialogue Flow для посетителя: ближайшие встречи с фильтрами, страница даты, запись без аккаунта, отмена.
import { lang } from '../i18n.js';
import { esc, tt, u, api, errorText, fmtTz, toast, ruPlural, timeInCity, durationText } from '../util.js';
import { session, loading, failed, demoPill, ic } from '../ui.js';

export const LANG_NAMES = { ru: ['Русский', 'Russian'], en: ['Английский', 'English'], zh: ['Китайский', 'Chinese'], th: ['Тайский', 'Thai'], de: ['Немецкий', 'German'], fr: ['Французский', 'French'], es: ['Испанский', 'Spanish'], it: ['Итальянский', 'Italian'], uk: ['Украинский', 'Ukrainian'], kk: ['Казахский', 'Kazakh'], other: ['Другой', 'Other'] };
const CUR_SIGN = { RUB: '₽', USD: '$', EUR: '€', GBP: '£', INR: '₹', THB: 'THB', KZT: '₸', UAH: '₴', GEL: '₾', TRY: '₺', VND: '₫', JPY: '¥', CNY: '¥' };
const fmtNum = (n) => new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'ru-RU', { maximumFractionDigits: 2 }).format(n);
const money = (amount, cur) => { const s = CUR_SIGN[cur]; return s && s.length === 1 ? (cur === 'USD' || cur === 'GBP' ? `${s}${fmtNum(amount)}` : `${fmtNum(amount)} ${s}`) : `${fmtNum(amount)} ${cur}`; };
/** Цена участия: «500 ₽ за участника» / «Бесплатно»; у старой платной встречи без суммы — «Стоимость уточняется». */
export const priceText = (m) => (m.priceType !== 'paid' ? tt('Бесплатно', 'Free')
  : m.priceAmount && m.currency ? tt(`${money(m.priceAmount, m.currency)} за участника`, `${money(m.priceAmount, m.currency)} per person`)
    : tt('Стоимость уточняется', 'Price to be confirmed'));
/** «Осталось 2 места» / «Мест нет». */
export const seatsText = (left) => (left > 0 ? tt(`Осталось ${left} ${ruPlural(left, 'место', 'места', 'мест')}`, `${left} ${left === 1 ? 'seat' : 'seats'} left`) : tt('Мест нет', 'No seats left'));
export const langName = (code) => { const n = LANG_NAMES[code] || [code, code]; return lang === 'en' ? n[1] : n[0]; };
const myTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const hm = (iso, tz) => fmtTz(iso, tz, { hour: '2-digit', minute: '2-digit' });
/** Время встречи по месту проведения: «18:30–20:00 по времени Чиангмая». */
const timeRange = (d, m) => timeInCity(d.endsAt ? `${hm(d.startsAt, m.timezone)}–${hm(d.endsAt, m.timezone)}` : hm(d.startsAt, m.timezone), m.city);
/** Время человека — только если его пояс отличается, менее заметно. */
const yourTime = (d, m) => (myTz() !== m.timezone ? tt(`У вас в это время: ${fmtTz(d.startsAt, myTz(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`, `Your time: ${fmtTz(d.startsAt, myTz(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`) : '');
const mapLink = (m) => (m.venue ? `https://www.openstreetmap.org/search?query=${encodeURIComponent([m.venue, m.city, m.country].filter(Boolean).join(', '))}` : '');

export function eventRow(d) {
  const m = d.meeting;
  const day = fmtTz(d.startsAt, m.timezone, { day: 'numeric' });
  const mon = fmtTz(d.startsAt, m.timezone, { month: 'short' });
  const wd = fmtTz(d.startsAt, m.timezone, { weekday: 'long' });
  return `<a class="event" href="${u('/m/' + d.id)}"><div class="cal"><b>${esc(day)}</b><span>${esc(mon)}</span></div>
    <div style="min-width:0"><b style="font:700 1.08rem/1.25 var(--font-head);display:block;overflow-wrap:anywhere">${esc(m.title)} ${demoPill(m.isDemo)}</b>
      <dl>
        <div><dt class="sr-only">${esc(tt('Когда', 'When'))}</dt><dd>${esc(wd)}, ${esc(timeRange(d, m))}</dd></div>
        <div><dt class="sr-only">${esc(tt('Где', 'Where'))}</dt><dd>${esc([m.venue, m.city].filter(Boolean).join(', '))}</dd></div>
        <div><dt>${esc(tt('Язык:', 'Language:'))}</dt><dd>${esc(langName(m.language))}</dd> · <dt class="sr-only">${esc(tt('Стоимость', 'Price'))}</dt><dd>${esc(priceText(m))}</dd></div>
        <div><dt class="sr-only">${esc(tt('Места', 'Seats'))}</dt><dd class="${d.left ? '' : 'warn'}"><b>${esc(seatsText(d.left))}</b></dd></div>
        <div><dt>${esc(tt('Фасилитатор:', 'Facilitator:'))}</dt><dd>${esc(m.facilitator)}</dd></div>
      </dl></div></a>`;
}

// Поиск: сразу ближайшие опубликованные встречи по дате; над списком — фильтры страны и города (адреса /meetings/Страна/Город сохранены).
export async function search(ctx, country, city) {
  loading(ctx.main);
  let places; let dates = [];
  try {
    [{ places }, { dates }] = await Promise.all([api('/api/meetings/places'),
      api(`/api/meetings${country ? `?country=${encodeURIComponent(country)}${city ? `&city=${encodeURIComponent(city)}` : ''}` : ''}`)]);
  } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  const cur = places.find((p) => p.country === country);
  const now = new Date().toISOString();
  dates = dates.filter((d) => d.startsAt >= now).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const filtered = !!country;
  ctx.main.innerHTML = `<div class="wrap page stack">
    <div class="page-head"><p class="eyebrow" style="margin:0">Dialogue Flow</p><h1>${esc(tt('Найти встречу', 'Find a meeting'))}</h1>
      <p class="sub">${esc(tt('Ближайшие встречи — сверху. Время указано по месту проведения.', 'Nearest meetings first. Times are local to the venue.'))} <a href="${u('/library')}">${esc(tt('Смотреть карты', 'View cards'))}</a></p></div>
    <form class="filters card-ui flat" id="flt" style="padding:14px">
      <label class="field">${esc(tt('Страна', 'Country'))}<select name="country"><option value="">${esc(tt('Все страны', 'All countries'))}</option>${places.map((p) => `<option ${p.country === country ? 'selected' : ''} value="${esc(p.country)}">${esc(p.country)} (${p.count})</option>`).join('')}</select></label>
      <label class="field">${esc(tt('Город', 'City'))}<select name="city" ${cur ? '' : 'disabled'}><option value="">${esc(cur ? tt('Все города', 'All cities') : tt('Сначала выберите страну', 'Choose a country first'))}</option>${cur ? cur.cities.map((c) => `<option ${c.city === city ? 'selected' : ''} value="${esc(c.city)}">${esc(c.city)} (${c.count})</option>`).join('') : ''}</select></label>
      ${filtered ? `<a class="btn sm light" href="${u('/meetings')}">${esc(tt('Сбросить фильтр', 'Clear filter'))}</a>` : ''}
    </form>
    ${filtered ? `<p class="small muted" style="margin:0">${esc(tt('Показаны встречи:', 'Showing meetings in:'))} <b>${esc([city, country].filter(Boolean).join(', '))}</b></p>` : ''}
    ${dates.length ? `<div class="list">${dates.map(eventRow).join('')}</div>`
      : `<div class="empty stack" style="justify-items:center"><span>${esc(city ? tt('В этом городе пока нет встреч', 'No meetings in this city yet') : country ? tt('В этой стране пока нет встреч', 'No meetings in this country yet') : tt('Пока нет опубликованных встреч', 'No published meetings yet'))}</span>
          ${filtered ? `<a class="btn sm" href="${u('/meetings')}">${esc(tt('Посмотреть все встречи', 'See all meetings'))}</a>` : ''}</div>`}
    ${session.user && session.user.roles.some((r) => r === 'facilitator' || r === 'admin') ? `<a class="btn" href="${u('/facilitator/m/new')}" style="justify-self:start">${esc(tt('Создать свою встречу', 'Create your meeting'))}</a>` : ''}
  </div>`;
  const f = ctx.main.querySelector('#flt');
  f.addEventListener('change', (e) => {
    const c = f.country.value; const ci = e.target.name === 'country' ? '' : f.city.value;
    ctx.navigate(c ? `/meetings/${encodeURIComponent(c)}${ci ? '/' + encodeURIComponent(ci) : ''}` : '/meetings');
  });
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
  const dateStr = fmtTz(d.startsAt, m.timezone, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  let state = d.open ? (d.left ? 'open' : 'full') : 'closed';
  let done = null; let sending = false;
  // Имя: у вошедшего — его настоящее имя (можно исправить); у гостя и демо-ролей — пусто.
  const realName = session.user && !session.user.isDemo ? session.user.name || '' : '';
  const draft = { name: realName, email: session.user && !session.user.isDemo && session.user.email ? session.user.email : '', contact: '' };
  const draw = () => {
    const map = mapLink(m);
    ctx.main.innerHTML = `<div class="wrap page"><div class="cols-2" style="align-items:start;gap:22px">
      <div class="stack">
        <a class="small" href="${u('/meetings/' + encodeURIComponent(m.country) + '/' + encodeURIComponent(m.city))}">← ${esc(tt('Встречи', 'Meetings'))}: ${esc(m.city)}</a>
        <div class="page-head"><h1>${esc(m.title)} ${demoPill(m.isDemo)}</h1></div>
        ${m.status === 'removed' ? `<div class="notice red">${esc(tt('Встреча снята с публикации администратором.', 'The meeting was taken down by an administrator.'))}</div>` : ''}
        <div class="card-ui flat"><dl class="meeting-facts">
          <div><dt>${esc(tt('Дата', 'Date'))}</dt><dd>${esc(dateStr)}</dd></div>
          <div><dt>${esc(tt('Время', 'Time'))}</dt><dd>${esc(timeRange(d, m))}${d.endsAt ? ` <span class="small muted">(${esc(durationText(m.durationMin))})</span>` : ''}${yourTime(d, m) ? `<br><span class="small muted">${esc(yourTime(d, m))}</span>` : ''}</dd></div>
          <div><dt>${esc(tt('Место', 'Place'))}</dt><dd>${esc([m.venue, m.city, m.country].filter(Boolean).join(', '))}
            <br>${map ? `<a class="small" href="${esc(map)}" target="_blank" rel="noopener">${esc(tt('Открыть на карте', 'Open in map'))} ↗</a>` : `<span class="small muted">${esc(tt('Точный адрес уточняется — его сообщит фасилитатор.', 'The exact address is to be confirmed by the facilitator.'))}</span>`}</dd></div>
          <div><dt>${esc(tt('Язык', 'Language'))}</dt><dd>${esc(langName(m.language))}</dd></div>
          <div><dt>${esc(tt('Стоимость', 'Price'))}</dt><dd>${esc(priceText(m))}${m.priceType === 'paid' ? `<br><span class="small muted">${esc(m.priceNote ? m.priceNote + ' · ' : '')}${esc(tt('Сайт не принимает оплату: её организует фасилитатор.', 'The site does not take payments: the facilitator arranges them.'))}</span>` : ''}</dd></div>
          <div><dt>${esc(tt('Места', 'Seats'))}</dt><dd class="${d.left ? '' : 'warn'}">${esc(seatsText(d.left))}</dd></div>
          <div><dt>${esc(tt('Фасилитатор', 'Facilitator'))}</dt><dd>${esc(m.facilitator)}</dd></div>
        </dl></div>
        ${m.description ? `<div class="card-ui flat"><h3>${esc(tt('О встрече', 'About'))}</h3><p style="white-space:pre-wrap;margin:0">${esc(m.description)}</p></div>` : ''}
        ${d.otherDates.length ? `<div><h3>${esc(tt('Другие даты этой встречи', 'Other dates of this meeting'))}</h3><div class="chips">${d.otherDates.map((o) => `<a class="chip" href="${u('/m/' + o.id)}">${esc(fmtTz(o.startsAt, m.timezone, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))} · ${esc(seatsText(o.left))}</a>`).join('')}</div></div>` : ''}
      </div>
      <div class="card-ui" id="reg"></div></div></div>`;
    const reg = ctx.main.querySelector('#reg');
    if (done) {
      const mailLine = done.isDemo ? tt('Это демо-встреча: письмо не отправляется. Отменить запись можно по ссылке «Моя запись и отмена».', 'This is a demo meeting: no email is sent. You can cancel via “My registration and cancel”.')
        : done.letter.sent ? tt('Письмо с этими данными и ссылкой для отмены отправлено на вашу почту.', 'An email with these details and a cancel link has been sent to you.')
          : done.letter.failed ? tt('Запись сохранена, но письмо отправить не удалось. Сохраните ссылку «Моя запись и отмена» — по ней можно отменить запись.', 'You are registered, but the email could not be sent. Keep the “My registration” link — you can cancel there.')
            : tt('Почта пока не подключена: письмо не отправлено. Сохраните ссылку «Моя запись и отмена» — по ней можно отменить запись.', 'Email is not connected yet: no letter was sent. Keep the “My registration” link — you can cancel there.');
      reg.innerHTML = `<span class="pill mint">✓ ${esc(tt('Запись подтверждена', 'Registration confirmed'))}</span><h2 style="margin:10px 0 6px">${esc(m.title)}</h2>
        ${confirmHtml(d, m, done.token)}
        <p class="muted small" style="margin:12px 0 0">${esc(mailLine)}</p>
        ${done.letter.body && !done.letter.sent ? `<details class="small" style="margin-top:8px"><summary>${esc(tt('Текст письма (демо)', 'Letter text (demo)'))}</summary><div class="letter">${esc(done.letter.body)}</div></details>` : ''}`;
      return;
    }
    if (state !== 'open') {
      reg.innerHTML = `<h2 style="margin:0 0 6px">${esc(state === 'full' ? tt('Мест нет', 'No seats left') : tt('Запись закрыта', 'Registration closed'))}</h2>
        <p class="muted" style="margin:0">${esc(state === 'full' ? tt('Все места на эту дату заняты. Лист ожидания пока не предусмотрен — посмотрите другие даты.', 'All seats for this date are taken. There is no waiting list yet — check other dates.') : tt('На эту дату записаться нельзя.', 'You cannot sign up for this date.'))}</p>`;
      return;
    }
    const mailHint = session.config.mailConnected && !m.isDemo
      ? tt('Пришлём подтверждение и ссылку для отмены записи. Адрес видит только фасилитатор.', 'We will send a confirmation and a cancel link. Only the facilitator sees your address.')
      : tt('Нужен фасилитатору, чтобы связаться с вами. Ссылку для отмены вы получите на этой странице.', 'The facilitator needs it to reach you. You will get the cancel link on this page.');
    reg.innerHTML = `<h2 style="margin:0 0 4px">${esc(tt('Записаться', 'Sign up'))}</h2><p class="small muted" style="margin:0 0 12px">${esc(tt('Аккаунт не нужен.', 'No account needed.'))}</p>
      <form class="form" id="rf" novalidate>
        <div class="stack" style="gap:6px"><label class="field" for="rf-name">${esc(tt('Имя', 'Name'))} *</label>
          <input id="rf-name" type="text" name="name" maxlength="100" autocomplete="name" placeholder="${esc(tt('Как к вам обращаться', 'What should we call you'))}" value="${esc(draft.name)}" aria-describedby="e-name"><p class="field-error" id="e-name"></p></div>
        <div class="stack" style="gap:6px"><label class="field" for="rf-email">Email *</label>
          <input id="rf-email" type="email" name="email" maxlength="200" autocomplete="email" inputmode="email" value="${esc(draft.email)}" aria-describedby="h-email e-email"><span class="small muted" id="h-email">${esc(mailHint)}</span><p class="field-error" id="e-email"></p></div>
        ${m.askContact ? `<div class="stack" style="gap:6px"><label class="field" for="rf-contact">${esc(tt('Телефон или мессенджер', 'Phone or messenger'))} <span class="hint">${esc(tt('необязательно', 'optional'))}</span></label><input id="rf-contact" type="text" name="contact" maxlength="200" autocomplete="tel" value="${esc(draft.contact)}"></div>` : ''}
        <p class="form-error" id="rerr" role="alert"></p>
        <button class="btn yellow wide" type="submit" ${sending ? 'disabled aria-busy="true"' : ''}>${esc(sending ? tt('Записываем…', 'Signing you up…') : tt('Записаться', 'Sign up'))}</button></form>`;
    const f = reg.querySelector('#rf');
    f.addEventListener('input', () => { draft.name = f.name.value; draft.email = f.email.value; if (f.contact) draft.contact = f.contact.value; });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (sending) return;
      const setErr = (field, msg) => { const el = reg.querySelector('#e-' + field); if (el) el.textContent = msg; const inp = f[field]; if (inp) inp.setAttribute('aria-invalid', msg ? 'true' : 'false'); };
      setErr('name', ''); setErr('email', '');
      let bad = null;
      if (!f.name.value.trim()) { setErr('name', tt('Укажите имя.', 'Please enter your name.')); bad = bad || f.name; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.value.trim())) { setErr('email', f.email.value.trim() ? tt('Проверьте адрес: в нём должны быть @ и домен.', 'Check the address: it needs @ and a domain.') : tt('Укажите email.', 'Please enter your email.')); bad = bad || f.email; }
      if (bad) { bad.focus(); return; }
      sending = true; const btn = f.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = tt('Записываем…', 'Signing you up…');
      try {
        done = await api(`/api/meetings/dates/${id}/register`, { method: 'POST', body: { name: f.name.value, email: f.email.value, contact: f.contact ? f.contact.value : '', lang } });
        d.left = Math.max(0, d.left - 1); sending = false; draw(); toast(tt('Вы записаны', 'You are registered'));
      } catch (err) {
        sending = false;
        if (err.code === 'full') { state = 'full'; d.left = 0; draw(); return; }
        btn.disabled = false; btn.textContent = tt('Записаться', 'Sign up');
        if (err.code === 'name_required') setErr('name', errorText(err));
        else if (err.code === 'email_required') setErr('email', errorText(err));
        else reg.querySelector('#rerr').textContent = errorText(err);
      }
    });
  };
  draw();
}

/** Подтверждение записи: дата, время по месту проведения, место, статус, календарь, ссылка на отмену. */
function confirmHtml(d, m, token) {
  const dateStr = fmtTz(d.startsAt, m.timezone, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const place = [m.venue, m.city, m.country].filter(Boolean).join(', ');
  const start = new Date(d.startsAt).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const end = d.endsAt ? new Date(d.endsAt).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '') : start;
  const gcal = 'https://calendar.google.com/calendar/render?' + new URLSearchParams({ action: 'TEMPLATE', text: m.title, dates: `${start}/${end}`, location: place, details: `${location.origin}${u('/r/' + token)}` });
  return `<dl class="meeting-facts confirm-list" style="margin:0">
      <div><dt>${esc(tt('Дата', 'Date'))}</dt><dd>${esc(dateStr)}</dd></div>
      <div><dt>${esc(tt('Время', 'Time'))}</dt><dd>${esc(timeRange(d, m))}${yourTime(d, m) ? `<br><span class="small muted">${esc(yourTime(d, m))}</span>` : ''}</dd></div>
      <div><dt>${esc(tt('Место', 'Place'))}</dt><dd>${esc(place)}</dd></div>
      <div><dt>${esc(tt('Статус', 'Status'))}</dt><dd>${esc(tt('Вы записаны', 'You are registered'))}</dd></div>
    </dl>
    <div class="row" style="margin-top:12px">
      <a class="btn yellow" href="${u('/api/registrations/' + token + '/ics?lang=' + lang)}" download="dialogue-flow.ics">${ic.calendar} ${esc(tt('Добавить в календарь', 'Add to calendar'))}</a>
      <a class="btn light sm" href="${esc(gcal)}" target="_blank" rel="noopener">Google ${esc(tt('Календарь', 'Calendar'))}</a>
      <a class="btn sm" href="${u('/r/' + token)}">${esc(tt('Моя запись и отмена', 'My registration and cancel'))}</a></div>`;
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
      <p class="lead">${esc(fmtTz(x.date.startsAt, m.timezone, { weekday: 'long', day: 'numeric', month: 'long' }))}, ${esc(timeRange(x.date, m))} · ${esc([m.venue, m.city].filter(Boolean).join(', '))}</p>
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
