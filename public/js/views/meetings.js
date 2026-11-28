// Встречи Dialogue Flow для посетителя: ближайшие встречи с фильтрами, страница даты, запись без аккаунта, отмена.
import { ABOUT_FLOW } from '../content.js';
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
// Живые и онлайн-встречи (22.11.2026)
const isOnline = (m) => m && m.mode === 'online';
/** Где: живая — площадка и город; онлайн — «Онлайн · Zoom». */
export const whereText = (m) => (isOnline(m) ? tt('Онлайн', 'Online') + (m.platform ? ' · ' + m.platform : '') : [m.venue, m.city, m.country].filter(Boolean).join(', '));
const myTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const hm = (iso, tz) => fmtTz(iso, tz, { hour: '2-digit', minute: '2-digit' });
/** Время встречи по месту проведения: «18:30–20:00 по времени Чиангмая». */
// онлайн: время — в поясе участника, с пометкой; пояс встречи — рядом
const timeRange = (d, m) => {
  if (isOnline(m)) { const z = myTz(); const r = d.endsAt ? `${hm(d.startsAt, z)}–${hm(d.endsAt, z)}` : hm(d.startsAt, z); return tt(`${r} по вашему времени (${z})`, `${r} your time (${z})`); }
  return timeInCity(d.endsAt ? `${hm(d.startsAt, m.timezone)}–${hm(d.endsAt, m.timezone)}` : hm(d.startsAt, m.timezone), m.city);
};
/** Дата: у онлайн-встречи — по поясу участника. */
const dateIn = (d, m, opts) => fmtTz(d.startsAt, isOnline(m) ? myTz() : m.timezone, opts);
/** Время человека — только если его пояс отличается, менее заметно. */
const yourTime = (d, m) => (isOnline(m) ? (myTz() !== m.timezone ? tt(`По времени встречи: ${fmtTz(d.startsAt, m.timezone, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} (${m.timezone})`, `Meeting time: ${fmtTz(d.startsAt, m.timezone, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} (${m.timezone})`) : '') : myTz() !== m.timezone ? tt(`У вас в это время: ${fmtTz(d.startsAt, myTz(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`, `Your time: ${fmtTz(d.startsAt, myTz(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`) : '');
const mapLink = (m) => (m.lat != null && m.lng != null ? `https://www.openstreetmap.org/?mlat=${m.lat}&mlon=${m.lng}#map=17/${m.lat}/${m.lng}` : m.venue ? `https://www.openstreetmap.org/search?query=${encodeURIComponent([m.venue, m.city, m.country].filter(Boolean).join(', '))}` : '');

// Компактное превью: название; дата и время — отдельными строками; площадка и город; внизу язык и цена.
// Фасилитатор, адрес, описание и число мест — на странице события; закрытую запись видно сразу.
const row = (icon, text, cls = '') => `<div class="ev-line ${cls}"><span class="ev-ic">${icon}</span><span>${text}</span></div>`;
export function eventRow(d) {
  const m = d.meeting;
  const date = dateIn(d, m, { weekday: 'long', day: 'numeric', month: 'long' });
  const closed = d.open === false || !d.left;
  return `<a class="event ev" href="${u('/m/' + d.id)}">
    <b class="ev-title">${esc(m.title)} ${demoPill(m.isDemo)}</b>
    ${m.format === 'part' ? `<span class="ev-df">${esc(tt('В программе — Dialogue Flow', 'Dialogue Flow is part of the programme'))}</span>` : ''}
    ${row(ic.calendar, esc(date))}
    ${row(ic.clock, esc(timeRange(d, m)))}
    ${isOnline(m) ? row(ic.video || ic.globe, esc(whereText(m)), 'ev-online') : row(ic.pin, esc([m.venue, m.city].filter(Boolean).join(', ')))}
    <div class="ev-foot"><span>${esc(langName(m.language))}</span><span aria-hidden="true">·</span><span>${esc(priceText(m))}</span>${closed ? `<span class="pill red ev-closed">${esc(tt('Запись закрыта', 'Registration closed'))}</span>` : ''}</div>
  </a>`;
}

/** Пустой результат: приглашение провести встречу. Фасилитатору — сразу форма (с городом), остальным — путь «Провести встречу». */
function hostInvite(country, city) {
  const fac = session.user && session.user.roles.some((r) => r === 'facilitator' || r === 'admin');
  const href = fac ? `/facilitator/m/new${city ? `?city=${encodeURIComponent(city)}&country=${encodeURIComponent(country || '')}` : ''}` : '/facilitator/about';
  // на телефоне — перенос ровно между фразами: «Проведите встречу / в своём городе»
  const [a, b] = city ? [tt('Проведите встречу', 'Host a meeting'), tt('в этом городе', 'in this city')] : [tt('Проведите встречу', 'Host a meeting'), tt('в своём городе', 'in your city')];
  return `<a class="btn yellow host-invite" href="${u(href)}"><span>${esc(a)}</span> <span>${esc(b)}</span></a>`;
}

// Поиск (22.11.2026): «Все / Живые встречи / Онлайн». Живые — страна, город (адреса /meetings/Страна/Город сохранены) и язык;
// онлайн — язык и дата, без города. Время онлайн-встречи — в поясе участника.
// Ничего не нашлось — «Сообщить, когда появится встреча» (подписка с текущими фильтрами) и «Попробовать игру с другом».
const SUB_KEY = 'dc_msub_hint';
/** Загрузка с одним тихим повтором: разовый сбой сети не показывает «Не удалось загрузить страницу». */
async function retryOnce(fn) { try { return await fn(); } catch (e) { if (e && e.status && e.status < 500 && e.status !== 408 && e.status !== 429) throw e; await new Promise((r) => setTimeout(r, 700)); return fn(); } }
const subText = (x) => (x.mode === 'online'
  ? tt(`Онлайн-встречи · ${langName(x.language)}`, `Online meetings · ${langName(x.language)}`)
  : tt(`Живые встречи · ${[x.city, x.country].filter(Boolean).join(', ')}${x.language ? ' · ' + langName(x.language) : ''}`, `Live meetings · ${[x.city, x.country].filter(Boolean).join(', ')}${x.language ? ' · ' + langName(x.language) : ''}`));

export async function search(ctx, country, city) {
  loading(ctx.main);
  const q = ctx.query;
  const mode = q.get('mode') === 'online' ? 'online' : q.get('mode') === 'live' ? 'live' : '';
  const language = q.get('lang') && LANG_NAMES[q.get('lang')] ? q.get('lang') : '';
  const fromDay = /^\d{4}-\d{2}-\d{2}$/.test(q.get('from') || '') ? q.get('from') : '';
  const geo = mode !== 'online';
  const params = new URLSearchParams();
  if (geo && country) { params.set('country', country); if (city) params.set('city', city); }
  if (mode) params.set('mode', mode);
  if (language) params.set('language', language);
  if (mode === 'online' && fromDay) params.set('from', new Date(fromDay + 'T00:00').toISOString());
  let places; let dates = []; let subs = [];
  try {
    [{ places }, { dates }, subs] = await retryOnce(() => Promise.all([api('/api/meetings/places'), api('/api/meetings' + (params.toString() ? '?' + params : '')),
      api('/api/meeting-subs').then((r) => r.subs).catch(() => [])]));
  } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  const cur = places.find((p) => p.country === country);
  const now = new Date().toISOString();
  dates = dates.filter((d) => d.startsAt >= now).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const filtered = !!(country && geo) || !!language || !!(mode === 'online' && fromDay);
  const qs = (patch) => { const p = new URLSearchParams(); const v = { mode, lang: language, from: fromDay, ...patch }; for (const k of ['mode', 'lang', 'from']) if (v[k]) p.set(k, v[k]); const t = p.toString(); return t ? '?' + t : ''; };
  const base = (c = country, ci = city) => (c ? `/meetings/${encodeURIComponent(c)}${ci ? '/' + encodeURIComponent(ci) : ''}` : '/meetings');
  const tab = (k, ru, en) => `<a role="radio" aria-checked="${mode === k}" class="${mode === k ? 'on' : ''}" href="${u((k === 'online' ? '/meetings' : base()) + qs({ mode: k, from: k === 'online' ? fromDay : '' }))}">${esc(tt(ru, en))}</a>`;
  // подписка, которую можно предложить с текущими фильтрами
  const subOffer = mode === 'online' ? (language ? { mode: 'online', language } : null) : city ? { mode: 'live', country, city, language } : null;
  const hasSame = subOffer && subs.some((x) => x.mode === subOffer.mode && (x.mode === 'online' ? x.language === subOffer.language : x.city === subOffer.city && (x.language || '') === (subOffer.language || '')));
  const langOpts = (sel) => `<option value="">${esc(tt('Любой язык', 'Any language'))}</option>${Object.keys(LANG_NAMES).map((k) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(langName(k))}</option>`).join('')}`;
  // Кнопка подписки на выбранный фильтром город (или язык онлайн-встреч).
  const subBtn = () => (subOffer ? (hasSame ? `<span class="pill mint">${esc(tt('Вы подписаны — сообщим о новой встрече', 'Subscribed — we will let you know'))}</span>`
    : `<button class="btn yellow" type="button" data-sub-add>${ic.bell || ''}<span>${esc(tt('Сообщить о новых встречах', 'Notify me about new meetings'))}</span></button>`) : '');
  const emptyActions = () => `<div class="row wrap" style="justify-content:center">${subBtn()}</div>`;
  // «Сообщить о встрече в моём городе» (26.11.2026): любой город из справочника, а не только те, где уже были встречи.
  const cityAlert = (asEmpty) => `<section class="card-ui flat city-alert stack" id="calert">
      ${asEmpty ? '' : `<h2 class="h3" style="margin:0">${esc(tt('Сообщить о встрече в моём городе', 'Tell me about a meeting in my city'))}</h2>`}
      <div class="row wrap" id="cpick-open"><button class="btn ${asEmpty ? 'yellow' : 'light'}" type="button" data-cpick>${esc(tt('Выбрать город', 'Choose a city'))}</button></div>
      <form class="stack" id="cpick" hidden style="gap:8px" novalidate>
        <label class="field" for="cp-city">${esc(tt('Город', 'City'))}</label>
        <div class="row" style="gap:8px;flex-wrap:nowrap"><input id="cp-city" type="text" maxlength="80" autocomplete="address-level2" placeholder="${esc(tt('Например, Казань', 'For example, Lisbon'))}" style="flex:1;min-width:0"><button class="btn light" type="submit">${esc(tt('Найти', 'Find'))}</button></div>
        <div id="cp-res" class="stack" style="gap:6px"></div>
      </form></section>`;
  const subsBlock = () => (subs.length ? `<details class="card-ui flat msubs" ${sessionStorage.getItem(SUB_KEY) ? 'open' : ''}><summary><b>${esc(tt('Мои подписки на встречи', 'My meeting alerts'))}</b> · ${subs.length}</summary>
      <ul class="msubs-list">${subs.map((x) => `<li data-sub="${x.id}"><span class="grow">${esc(subText(x))}</span>
        ${`<label class="sr-only" for="sl-${x.id}">${esc(tt('Язык', 'Language'))}</label><select id="sl-${x.id}" data-sub-lang="${x.id}">${x.mode === 'online' ? Object.keys(LANG_NAMES).map((k) => `<option value="${k}" ${k === x.language ? 'selected' : ''}>${esc(langName(k))}</option>`).join('') : langOpts(x.language)}</select>`}
        <button class="linkbtn danger" type="button" data-sub-off="${x.id}">${esc(tt('Отключить', 'Turn off'))}</button></li>`).join('')}</ul>
      <p class="small muted" style="margin:0">${esc(session.user ? tt('Сообщим в колокольчике и push-уведомлением, если оно включено.', 'We will notify you in the bell and by push, if enabled.') : tt('Сообщим в колокольчике в этом браузере. Войдите, чтобы получать и на других устройствах.', 'We will notify you in the bell in this browser. Sign in to get alerts on other devices too.'))}</p></details>` : '');
  const none = !dates.length && !filtered && !mode && !places.length;
  const liveSubs = subs.filter((x) => x.mode === 'live');
  ctx.main.innerHTML = `<div class="wrap page stack">
    <div class="page-head"><p class="eyebrow" style="margin:0">Dialogue Flow</p><h1>${esc(tt('Найти встречу', 'Find a meeting'))}</h1>
      ${none ? '' : `<p class="sub">${esc(mode === 'online' ? tt('Ближайшие встречи — сверху. Время — по вашему часовому поясу.', 'Nearest meetings first. Times are in your time zone.') : tt('Ближайшие встречи — сверху. Время живых встреч — по месту проведения.', 'Nearest meetings first. Live meeting times are local to the venue.'))}</p>`}</div>
    <details class="about-df card-ui flat accent-line"><summary><span class="grow">${esc(tt('Что такое Dialogue Flow?', 'What is Dialogue Flow?'))}</span><span class="chev" aria-hidden="true">▾</span></summary>
      <div class="about-body">
        ${(lang === 'en' ? ABOUT_FLOW.en : ABOUT_FLOW.ru).map((p) => `<p>${p.map((l) => esc(l).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')).join('<br>')}</p>`).join('')}
        <h3>${esc(tt('Как проходит встреча', 'How a meeting goes'))}</h3>
        <ol class="steps">
          <li>${esc(tt('Фасилитатор знакомит участников с форматом.', 'The facilitator introduces the format.'))}</li>
          <li>${esc(tt('Участники выбирают карты и общаются в парах. Карта помогает начать диалог, а дальше он продолжается в естественном потоке.', 'Participants choose cards and talk in pairs. The card helps start the dialogue, and then it carries on in a natural flow.'))}</li>
          <li>${esc(tt('В конце участники по желанию делятся впечатлениями.', 'At the end, participants share their impressions if they wish.'))}</li>
        </ol></div></details>
    <nav class="seg mode-seg" role="radiogroup" aria-label="${esc(tt('Формат встреч', 'Meeting format'))}">${tab('', 'Все', 'All')}${tab('live', 'Живые встречи', 'Live')}${tab('online', 'Онлайн', 'Online')}</nav>
    ${none ? '' : `<form class="filters card-ui flat" id="flt" style="padding:14px">
      ${geo ? `<label class="field">${esc(tt('Страна', 'Country'))}<select name="country"><option value="">${esc(tt('Все страны', 'All countries'))}</option>${places.map((p) => `<option ${p.country === country ? 'selected' : ''} value="${esc(p.country)}">${esc(p.country)} (${p.count})</option>`).join('')}</select></label>
      <label class="field">${esc(tt('Город', 'City'))}<select name="city" ${cur ? '' : 'disabled'}><option value="">${esc(cur ? tt('Все города', 'All cities') : tt('Сначала выберите страну', 'Choose a country first'))}</option>${cur ? cur.cities.map((c) => `<option ${c.city === city ? 'selected' : ''} value="${esc(c.city)}">${esc(c.city)} (${c.count})</option>`).join('') : ''}</select></label>` : ''}
      <label class="field">${esc(tt('Язык', 'Language'))}<select name="lang">${langOpts(language)}</select></label>
      ${mode === 'online' ? `<label class="field">${esc(tt('С даты', 'From'))}<input type="date" name="from" value="${esc(fromDay)}" min="${new Date().toISOString().slice(0, 10)}"></label>` : ''}
      ${filtered ? `<a class="btn sm light" href="${u('/meetings' + (mode ? '?mode=' + mode : ''))}">${esc(tt('Сбросить фильтр', 'Clear filter'))}</a>` : ''}
    </form>`}
    ${filtered && geo && country ? `<p class="small muted" style="margin:0">${esc(tt('Показаны встречи:', 'Showing meetings in:'))} <b>${esc([city, country].filter(Boolean).join(', '))}</b></p>` : ''}
    ${dates.length ? `<div class="list">${dates.map(eventRow).join('')}</div>`
      : none ? `<div class="empty stack" style="justify-items:center"><b>${esc(tt('Пока здесь нет предстоящих встреч', 'There are no upcoming meetings here yet'))}</b>
          ${liveSubs.length ? `<span class="small" role="status">${esc(tt(`Сообщим, когда появится встреча: ${liveSubs.map((x) => x.city).join(', ')}.`, `We will let you know when a meeting appears in: ${liveSubs.map((x) => x.city).join(', ')}.`))}</span>`
            : `<span class="small">${esc(tt('Выберите город, чтобы узнать о новых встречах.', 'Choose a city to hear about new meetings.'))}</span>`}
          ${cityAlert(true)}${hostInvite('', '')}</div>`
      : `<div class="empty stack" style="justify-items:center"><span>${esc(none ? tt('Пока нет запланированных встреч', 'No meetings planned yet') : mode === 'online' ? tt('Подходящих онлайн-встреч пока нет', 'No matching online meetings yet') : city ? tt('В этом городе пока нет предстоящих встреч', 'No upcoming meetings in this city yet') : country ? tt('В этой стране пока нет встреч', 'No meetings in this country yet') : tt('Подходящих встреч пока нет', 'No matching meetings yet'))}</span>
          ${emptyActions()}
          ${filtered && geo && country ? `<a class="btn light" href="${u('/meetings' + qs({}))}">${esc(tt('Посмотреть встречи в других городах', 'See meetings in other cities'))}</a>` : ''}
          ${hostInvite(geo ? country : '', geo ? city : '')}</div>`}
    ${none || mode === 'online' ? '' : cityAlert(false)}
    ${subsBlock()}
    ${dates.length && subOffer && !hasSame ? `<button class="linkbtn" type="button" data-sub-add style="justify-self:start">${esc(tt('Сообщать о новых встречах с этими фильтрами', 'Notify me about new meetings with these filters'))}</button>` : ''}
    ${session.user && session.user.roles.some((r) => r === 'facilitator' || r === 'admin') ? `<a class="btn" href="${u('/facilitator/m/new' + (mode === 'online' ? '?mode=online' : ''))}" style="justify-self:start">${esc(tt('Создать свою встречу', 'Create your meeting'))}</a>` : ''}
  </div>`;
  const f = ctx.main.querySelector('#flt');
  if (f) f.addEventListener('change', (e) => {
    const c = f.country ? f.country.value : ''; const ci = !f.city || e.target.name === 'country' ? '' : f.city.value;
    const next = { lang: f.lang.value, from: f.from ? f.from.value : '' };
    ctx.navigate((geo ? base(c, ci) : '/meetings') + qs(next));
  });
  ctx.main.querySelectorAll('[data-sub-add]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await api('/api/meeting-subs', { method: 'POST', body: subOffer }); try { sessionStorage.setItem(SUB_KEY, '1'); } catch { /* */ } toast(tt('Сообщим, когда появится встреча', 'We will let you know when a meeting appears')); ctx.rerender(); }
    catch (x) { b.disabled = false; toast(errorText(x)); }
  }));
  const ca = ctx.main.querySelector('#calert');
  if (ca) {
    const form = ca.querySelector('#cpick'); const res = ca.querySelector('#cp-res'); const inp = ca.querySelector('#cp-city');
    ca.querySelector('[data-cpick]').addEventListener('click', () => { ca.querySelector('#cpick-open').hidden = true; form.hidden = false; inp.focus(); });
    const subscribe = async (place, btn) => {
      btn.disabled = true;
      try { await api('/api/meeting-subs', { method: 'POST', body: { mode: 'live', country: place.country || '', city: place.city } }); try { sessionStorage.setItem(SUB_KEY, '1'); } catch { /* */ }
        toast(tt(`Сообщим о новых встречах: ${place.city}`, `We will let you know about new meetings: ${place.city}`)); ctx.rerender(); }
      catch (x) { btn.disabled = false; toast(errorText(x)); }
    };
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); const q = inp.value.trim(); if (!q) { inp.focus(); return; }
      res.innerHTML = `<p class="small muted" style="margin:0">${esc(tt('Ищем…', 'Searching…'))}</p>`;
      let list = []; try { list = (await api('/api/places/search?q=' + encodeURIComponent(q))).places; } catch { /* предложим как введено */ }
      if (!list.length) list = [{ city: q.charAt(0).toUpperCase() + q.slice(1), country: '' }];
      res.innerHTML = `${list.length > 1 ? `<p class="small muted" style="margin:0">${esc(tt('Выберите свой город:', 'Choose your city:'))}</p>` : ''}${list.map((p, i) => `<div class="row city-hit"><span class="grow"><b>${esc(p.city)}</b>${p.country ? `<span class="small muted">, ${esc(p.country)}</span>` : ''}</span>
        <button class="btn yellow sm" type="button" data-csub="${i}">${esc(tt('Сообщить о новых встречах', 'Notify me about new meetings'))}</button></div>`).join('')}`;
      res.querySelectorAll('[data-csub]').forEach((b) => b.addEventListener('click', () => subscribe(list[Number(b.dataset.csub)], b)));
    });
  }
  ctx.main.querySelectorAll('[data-sub-off]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/meeting-subs/${b.dataset.subOff}`, { method: 'DELETE' }); toast(tt('Подписка отключена', 'Alert turned off')); ctx.rerender(); } catch (x) { toast(errorText(x)); }
  }));
  ctx.main.querySelectorAll('[data-sub-lang]').forEach((sl) => sl.addEventListener('change', async () => {
    try { await api(`/api/meeting-subs/${sl.dataset.subLang}`, { method: 'PATCH', body: { language: sl.value } }); toast(tt('Подписка изменена', 'Alert updated')); ctx.rerender(); } catch (x) { toast(errorText(x)); }
  }));
}

export async function datePage(ctx, id) {
  loading(ctx.main);
  let d;
  try { d = await retryOnce(() => api(`/api/meetings/dates/${id}`)); } catch (e) {
    if (!ctx.alive()) return;
    if (e.status === 404) { ctx.main.innerHTML = `<div class="wrap page narrow"><p class="empty">${esc(tt('Встреча не найдена.', 'Meeting not found.'))}</p></div>`; return; }
    return failed(ctx.main, e, ctx.rerender);
  }
  if (!ctx.alive()) return;
  if (d.unavailable) { ctx.main.innerHTML = `<div class="wrap page narrow stack"><div class="empty stack" style="justify-items:center"><b>${esc(tt('Встреча недоступна', 'The meeting is unavailable'))}</b><a class="btn sm" href="${u('/meetings')}">${esc(tt('Посмотреть все встречи', 'See all meetings'))}</a></div></div>`; return; }
  const m = d.meeting;
  const dateStr = dateIn(d, m, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  let state = d.open ? (d.left ? 'open' : 'full') : 'closed';
  let done = null; let sending = false;
  // Имя: у вошедшего — его настоящее имя (можно исправить); у гостя и демо-ролей — пусто.
  const realName = session.user && !session.user.isDemo ? session.user.name || '' : '';
  const draft = { name: realName, email: session.user && !session.user.isDemo && session.user.email ? session.user.email : '', contact: '' };
  const draw = () => {
    const map = mapLink(m);
    ctx.main.innerHTML = `<div class="wrap page"><div class="cols-2" style="align-items:start;gap:22px">
      <div class="stack">
        ${isOnline(m) ? `<a class="small" href="${u('/meetings?mode=online')}">← ${esc(tt('Онлайн-встречи', 'Online meetings'))}</a>` : `<a class="small" href="${u('/meetings/' + encodeURIComponent(m.country) + '/' + encodeURIComponent(m.city))}">← ${esc(tt('Встречи', 'Meetings'))}: ${esc(m.city)}</a>`}
        <div class="page-head"><h1>${esc(m.title)} ${demoPill(m.isDemo)}</h1>${m.format === 'part' ? `<span class="ev-df">${esc(tt('В программе — Dialogue Flow', 'Dialogue Flow is part of the programme'))}</span>` : ''}</div>
        ${m.status === 'unpublished' ? `<div class="notice">${esc(tt('Встреча скрыта: участники видят «Встреча недоступна». Эту страницу видите только вы.', 'The meeting is hidden: participants see “The meeting is unavailable”. Only you can see this page.'))}</div>` : ''}
        ${m.status === 'removed' ? `<div class="notice red">${esc(tt('Встреча снята с публикации администратором.', 'The meeting was taken down by an administrator.'))}</div>` : ''}
        <div class="card-ui flat"><dl class="meeting-facts icons">
          <div><dt>${ic.calendar}<span>${esc(tt('Дата', 'Date'))}</span></dt><dd>${esc(dateStr)}</dd></div>
          <div><dt>${ic.clock}<span>${esc(tt('Время', 'Time'))}</span></dt><dd>${esc(timeRange(d, m))}${d.endsAt ? ` <span class="small muted">(${esc(durationText(m.durationMin))})</span>` : ''}${yourTime(d, m) ? `<br><span class="small muted">${esc(yourTime(d, m))}</span>` : ''}</dd></div>
          ${isOnline(m) ? `<div><dt>${ic.video || ic.globe}<span>${esc(tt('Формат', 'Format'))}</span></dt><dd>${esc(whereText(m))}<br><span class="small muted">${esc(tt('Данные для подключения придут после записи — в письме и на странице «Моя запись».', 'Joining details come after you sign up — in the email and on the “My registration” page.'))}</span></dd></div>`
          : `<div><dt>${ic.pin}<span>${esc(tt('Место', 'Place'))}</span></dt><dd>${esc([m.venue, m.address, m.city, m.country].filter(Boolean).join(', '))}
            <br>${map ? `<a class="small" href="${esc(map)}" target="_blank" rel="noopener">${esc(tt('Открыть на карте', 'Open in map'))} ↗</a>` : `<span class="small muted">${esc(tt('Точный адрес уточняется — его сообщит фасилитатор.', 'The exact address is to be confirmed by the facilitator.'))}</span>`}</dd></div>`}
          <div><dt>${ic.globe}<span>${esc(tt('Язык', 'Language'))}</span></dt><dd>${esc(langName(m.language))}</dd></div>
          <div><dt>${ic.ticket}<span>${esc(tt('Стоимость', 'Price'))}</span></dt><dd>${esc(priceText(m))}${m.priceType === 'paid' ? `<br><span class="small muted">${esc(m.priceNote ? m.priceNote + ' · ' : '')}${esc(tt('Сайт не принимает оплату: её организует фасилитатор.', 'The site does not take payments: the facilitator arranges them.'))}</span>` : ''}</dd></div>
          <div><dt>${ic.user}<span>${esc(tt('Фасилитатор', 'Facilitator'))}</span></dt><dd>${esc(m.facilitator)}</dd></div>
          <div><dt>${ic.people}<span>${esc(tt('Места', 'Seats'))}</span></dt><dd class="${d.left ? '' : 'warn'}">${esc(seatsText(d.left))}</dd></div>
        </dl></div>
        ${m.description ? `<div class="card-ui flat"><h3>${esc(tt('О встрече', 'About'))}</h3><p style="white-space:pre-wrap;margin:0">${esc(m.description)}</p></div>` : ''}
        ${d.otherDates.length ? `<div><h3>${esc(tt('Другие даты этой встречи', 'Other dates of this meeting'))}</h3><div class="chips">${d.otherDates.map((o) => `<a class="chip" href="${u('/m/' + o.id)}">${esc(fmtTz(o.startsAt, isOnline(m) ? myTz() : m.timezone, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))} · ${esc(seatsText(o.left))}</a>`).join('')}</div></div>` : ''}
      </div>
      <div class="card-ui" id="reg"></div></div></div>`;
    const reg = ctx.main.querySelector('#reg');
    if (done) {
      const mailLine = done.isDemo ? tt('Это демо-встреча: письмо не отправляется. Отменить запись можно по ссылке «Моя запись и отмена».', 'This is a demo meeting: no email is sent. You can cancel via “My registration and cancel”.')
        : done.letter.sent ? tt('Письмо с этими данными и ссылкой для отмены отправлено на вашу почту.', 'An email with these details and a cancel link has been sent to you.')
          : done.letter.failed ? tt('Запись сохранена, но письмо отправить не удалось. Сохраните ссылку «Моя запись и отмена» — по ней можно отменить запись.', 'You are registered, but the email could not be sent. Keep the “My registration” link — you can cancel there.')
            : tt('Почта пока не подключена: письмо не отправлено. Сохраните ссылку «Моя запись и отмена» — по ней можно отменить запись.', 'Email is not connected yet: no letter was sent. Keep the “My registration” link — you can cancel there.');
      reg.innerHTML = `<span class="pill mint">✓ ${esc(tt('Запись подтверждена', 'Registration confirmed'))}</span><h2 style="margin:10px 0 6px">${esc(m.title)}</h2>
        ${confirmHtml(d, m, done.token, done.joinInfo)}
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
    reg.innerHTML = `<h2 style="margin:0 0 4px">${esc(tt('Записаться', 'Sign up'))}</h2>
      <p class="reg-sum"><span>${ic.ticket}${esc(priceText(m))}</span><span>${ic.people}${esc(seatsText(d.left))}</span></p>
      <p class="small muted" style="margin:0 0 12px">${esc(tt('Аккаунт не нужен.', 'No account needed.'))}</p>
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
function confirmHtml(d, m, token, joinInfo = '') {
  const dateStr = dateIn(d, m, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const place = isOnline(m) ? whereText(m) : [m.venue, m.address, m.city, m.country].filter(Boolean).join(', ');
  const start = new Date(d.startsAt).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const end = d.endsAt ? new Date(d.endsAt).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '') : start;
  const gcal = 'https://calendar.google.com/calendar/render?' + new URLSearchParams({ action: 'TEMPLATE', text: m.title, dates: `${start}/${end}`, location: place, details: `${location.origin}${u('/r/' + token)}` });
  return `<dl class="meeting-facts confirm-list" style="margin:0">
      <div><dt>${esc(tt('Дата', 'Date'))}</dt><dd>${esc(dateStr)}</dd></div>
      <div><dt>${esc(tt('Время', 'Time'))}</dt><dd>${esc(timeRange(d, m))}${yourTime(d, m) ? `<br><span class="small muted">${esc(yourTime(d, m))}</span>` : ''}</dd></div>
      <div><dt>${esc(isOnline(m) ? tt('Формат', 'Format') : tt('Место', 'Place'))}</dt><dd>${esc(place)}</dd></div>
      ${isOnline(m) ? joinHtml(joinInfo) : ''}
      <div><dt>${esc(tt('Статус', 'Status'))}</dt><dd>${esc(tt('Вы записаны', 'You are registered'))}</dd></div>
    </dl>
    <div class="row" style="margin-top:12px">
      <a class="btn yellow" href="${u('/api/registrations/' + token + '/ics?lang=' + lang)}" download="dialogue-flow.ics">${ic.calendar} ${esc(tt('Добавить в календарь', 'Add to calendar'))}</a>
      <a class="btn light sm" href="${esc(gcal)}" target="_blank" rel="noopener">Google ${esc(tt('Календарь', 'Calendar'))}</a>
      <a class="btn sm" href="${u('/r/' + token)}">${esc(tt('Моя запись и отмена', 'My registration and cancel'))}</a></div>`;
}

/** Данные подключения онлайн-встречи — только записавшемуся; ссылки в тексте кликабельны. */
function joinHtml(info) {
  if (!info) return `<div><dt>${esc(tt('Подключение', 'Joining'))}</dt><dd class="small muted">${esc(tt('Фасилитатор пришлёт данные для подключения.', 'The facilitator will send the joining details.'))}</dd></div>`;
  const linked = esc(info).replace(/https?:\/\/[^\s<]+/g, (x) => `<a href="${x}" target="_blank" rel="noopener">${x}</a>`);
  return `<div class="join-info"><dt>${esc(tt('Как подключиться', 'How to join'))}</dt><dd style="white-space:pre-wrap">${linked}</dd></div>`;
}
export async function registration(ctx, token) {
  loading(ctx.main);
  let x;
  try { x = await retryOnce(() => api(`/api/registrations/${token}`)); } catch (e) {
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
      <p class="lead">${esc(dateIn(x.date, m, { weekday: 'long', day: 'numeric', month: 'long' }))}, ${esc(timeRange(x.date, m))} · ${esc(isOnline(m) ? whereText(m) : [m.venue, m.address, m.city].filter(Boolean).join(', '))}</p>
      ${isOnline(m) && active ? `<div class="card-ui flat"><dl class="meeting-facts" style="margin:0">${joinHtml(x.joinInfo)}</dl></div>` : ''}
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
