// Встречи Dialogue Flow: публикация фасилитатором, поиск страна → город → дата, запись без аккаунта.
// У каждой даты свои места и записи. Время хранится в UTC, вводится и показывается в поясе встречи.
const crypto = require('crypto');
const db = require('./db');
const config = require('./config');
const mail = require('./mail');

const LANGS = ['ru', 'en', 'zh', 'th', 'de', 'fr', 'es', 'it', 'uk', 'kk', 'other'];

function validTz(tz) { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } }
/** Смещение пояса (мс) в момент utcMs. */
function tzOffset(utcMs, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(utcMs)).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMs;
}
/** 'YYYY-MM-DDTHH:MM' в поясе tz → ISO UTC. */
function zonedToUtc(local, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local || '');
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let utc = guess - tzOffset(guess, tz);
  utc = guess - tzOffset(utc, tz);
  return new Date(utc).toISOString();
}

const userName = (id) => { const u = db.prepare('SELECT name, public_name FROM users WHERE id = ?').get(id); return u ? (u.public_name || u.name) : ''; };
const seatsTaken = db.prepare(`SELECT COUNT(*) AS n FROM registrations WHERE date_id = ? AND status = 'active'`);
const nowIso = () => new Date().toISOString();

function dateOut(d, m) {
  const taken = seatsTaken.get(d.id).n;
  return { id: d.id, startsAt: d.starts_at, localTime: d.local_time, capacity: d.capacity, taken, left: Math.max(0, d.capacity - taken),
    status: d.status, past: d.starts_at < nowIso(), meetingId: m ? m.id : d.meeting_id };
}
function meetingOut(m, { withDates = false, includePast = false } = {}) {
  const out = {
    id: m.id, title: m.title, description: m.description, country: m.country, city: m.city, venue: m.venue,
    language: m.language, timezone: m.timezone, priceType: m.price_type, priceNote: m.price_note, priceAmount: m.price_type === 'paid' ? m.price_amount : null, currency: m.price_type === 'paid' ? m.currency : '', capacity: m.capacity,
    askContact: !!m.ask_contact, status: m.status, removedReason: m.removed_reason, isDemo: !!m.is_demo,
    facilitator: userName(m.facilitator_id), facilitatorId: m.facilitator_id, createdAt: m.created_at,
  };
  if (withDates) {
    out.dates = db.prepare('SELECT * FROM meeting_dates WHERE meeting_id = ? ORDER BY starts_at').all(m.id)
      .map((d) => dateOut(d, m)).filter((d) => includePast || !d.past);
  }
  return out;
}

// ---------- публичное ----------
const visible = (showDemo) => `m.status = 'published' AND ${showDemo ? '1=1' : 'm.is_demo = 0'}`;
function places(showDemo) {
  const rows = db.prepare(`SELECT m.country, m.city, COUNT(DISTINCT d.id) AS n FROM meetings m
    JOIN meeting_dates d ON d.meeting_id = m.id AND d.status = 'active' AND d.starts_at >= ?
    WHERE ${visible(showDemo)} GROUP BY m.country, m.city ORDER BY m.country, m.city`).all(nowIso());
  const byCountry = new Map();
  for (const r of rows) {
    if (!byCountry.has(r.country)) byCountry.set(r.country, { country: r.country, cities: [], count: 0 });
    const c = byCountry.get(r.country); c.cities.push({ city: r.city, count: r.n }); c.count += r.n;
  }
  return [...byCountry.values()];
}
function upcoming({ country, city }, showDemo) {
  const rows = db.prepare(`SELECT d.*, m.id AS mid FROM meeting_dates d JOIN meetings m ON m.id = d.meeting_id
    WHERE ${visible(showDemo)} AND d.status = 'active' AND d.starts_at >= ? AND (? IS NULL OR m.country = ?) AND (? IS NULL OR m.city = ?)
    ORDER BY d.starts_at LIMIT 200`).all(nowIso(), country || null, country || null, city || null, city || null);
  return rows.map((d) => { const m = db.prepare('SELECT * FROM meetings WHERE id = ?').get(d.mid); return { ...dateOut(d, m), meeting: meetingOut(m) }; });
}
function datePublic(id, showDemo) {
  const d = db.prepare('SELECT * FROM meeting_dates WHERE id = ?').get(id);
  if (!d) return null;
  const m = db.prepare('SELECT * FROM meetings WHERE id = ?').get(d.meeting_id);
  if (m.is_demo && !showDemo) return null;
  const others = db.prepare(`SELECT * FROM meeting_dates WHERE meeting_id = ? AND id <> ? AND status = 'active' AND starts_at >= ? ORDER BY starts_at LIMIT 8`)
    .all(m.id, d.id, nowIso()).map((x) => dateOut(x, m));
  return { ...dateOut(d, m), meeting: meetingOut(m), otherDates: others, open: m.status === 'published' && d.status === 'active' && d.starts_at >= nowIso() };
}

function fmtLocal(d, m, lang) {
  const dt = new Date(d.starts_at);
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'ru-RU', { timeZone: m.timezone, dateStyle: 'full', timeStyle: 'short' }).format(dt) + ` (${m.timezone})`;
}

/** Запись на дату: занимает место; при заполнении запись закрывается. Подтверждение — письмом (или показ текста в демо). */
async function register(dateId, { name, email, contact }, baseUrl, lang = 'ru') {
  const n = String(name || '').trim().slice(0, 100);
  const e = String(email || '').trim().toLowerCase().slice(0, 200);
  if (!n) return { error: 'name_required' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { error: 'email_required' };
  const result = db.transaction(() => {
    const d = db.prepare('SELECT * FROM meeting_dates WHERE id = ?').get(dateId);
    if (!d) return { error: 'not_found' };
    const m = db.prepare('SELECT * FROM meetings WHERE id = ?').get(d.meeting_id);
    if (m.status !== 'published' || d.status !== 'active') return { error: 'closed' };
    if (d.starts_at < nowIso()) return { error: 'past' };
    if (seatsTaken.get(d.id).n >= d.capacity) return { error: 'full' };
    if (db.prepare(`SELECT 1 FROM registrations WHERE date_id = ? AND email = ? AND status = 'active'`).get(d.id, e)) return { error: 'already_registered' };
    const token = crypto.randomBytes(18).toString('base64url');
    db.prepare('INSERT INTO registrations (date_id, name, email, contact, token, is_demo) VALUES (?, ?, ?, ?, ?, ?)')
      .run(d.id, n, e, m.ask_contact ? String(contact || '').trim().slice(0, 200) : '', token, m.is_demo);
    return { token, d, m };
  })();
  if (result.error) return result;
  const { token, d, m } = result;
  const link = `${baseUrl}${config.basePath}/r/${token}`;
  const when = fmtLocal(d, m, lang);
  const subject = lang === 'en' ? `You are registered: ${m.title}` : `Вы записаны: ${m.title}`;
  const ics = `${baseUrl}${config.basePath}/api/registrations/${token}/ics`;
  const body = lang === 'en'
    ? `Hello, ${n}!\n\nYou are registered for the Dialogue Flow meeting “${m.title}”.\nWhen: ${when}\nWhere: ${[m.venue, m.city, m.country].filter(Boolean).join(', ')}\nLanguage: ${m.language}\nFacilitator: ${userName(m.facilitator_id)}\n${m.price_type === 'paid' ? `Price: ${m.price_amount} ${m.currency} per person. Payment is arranged by the facilitator. ${m.price_note}\n` : 'Free.\n'}\nAdd to calendar: ${ics}\nCannot come? Cancel here to free your seat: ${link}`
    : `Здравствуйте, ${n}!\n\nВы записаны на встречу Dialogue Flow «${m.title}».\nКогда: ${when}\nГде: ${[m.venue, m.city, m.country].filter(Boolean).join(', ')}\nЯзык встречи: ${m.language}\nФасилитатор: ${userName(m.facilitator_id)}\n${m.price_type === 'paid' ? `Стоимость: ${m.price_amount} ${m.currency} с человека. Оплату организует фасилитатор. ${m.price_note}\n` : 'Бесплатно.\n'}\nДобавить в календарь: ${ics}\nНе сможете прийти? Отмените запись, чтобы освободить место: ${link}`;
  // Демо-встреча: письмо не отправляется (честно сообщаем об этом на странице), настоящая почта не задействуется.
  const letter = m.is_demo ? { sent: false, demo: true, demoMeeting: true, subject, body } : await mail.send(e, subject, body);
  return { ok: true, token, letter, link, isDemo: !!m.is_demo, startsAt: d.starts_at, timezone: m.timezone, place: [m.venue, m.city, m.country].filter(Boolean).join(', ') };
}

function registrationByToken(token) {
  const r = db.prepare('SELECT * FROM registrations WHERE token = ?').get(token);
  if (!r) return null;
  const d = db.prepare('SELECT * FROM meeting_dates WHERE id = ?').get(r.date_id);
  const m = db.prepare('SELECT * FROM meetings WHERE id = ?').get(d.meeting_id);
  return { name: r.name, email: r.email, status: r.status, createdAt: r.created_at, cancelledAt: r.cancelled_at, date: dateOut(d, m), meeting: meetingOut(m) };
}
const icsText = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsTime = (iso) => iso.replace(/[-:]/g, '').replace(/\.\d+/, '');
function foldIcs(line) { const out = []; let rest = line; while (Buffer.byteLength(rest) > 74) { let n = 74; while (Buffer.byteLength(rest.slice(0, n)) > 74) n--; out.push(rest.slice(0, n)); rest = ' ' + rest.slice(n); } out.push(rest); return out.join('\r\n'); }
/** Файл календаря (.ics) для записи: время в UTC (календарь покажет его в поясе устройства), место, ссылка для отмены. */
function icsByToken(token, baseUrl, lang = 'ru') {
  const r = db.prepare('SELECT * FROM registrations WHERE token = ?').get(token);
  if (!r) return null;
  const d = db.prepare('SELECT * FROM meeting_dates WHERE id = ?').get(r.date_id);
  const m = db.prepare('SELECT * FROM meetings WHERE id = ?').get(d.meeting_id);
  const link = `${baseUrl}${config.basePath}/r/${token}`;
  const place = [m.venue, m.city, m.country].filter(Boolean).join(', ');
  const desc = (lang === 'en'
    ? `Dialogue Flow meeting.\nLocal time: ${fmtLocal(d, m, 'en')}\nPlace: ${place}\nFacilitator: ${userName(m.facilitator_id)}\nCannot come? Cancel to free your seat: ${link}`
    : `Встреча Dialogue Flow.\nМестное время: ${fmtLocal(d, m, 'ru')}\nМесто: ${place}\nФасилитатор: ${userName(m.facilitator_id)}\nНе сможете прийти? Отмените запись, чтобы освободить место: ${link}`);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dialogue Cards//Meetings//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:dcards-reg-${r.id}-${d.id}@dialogue-cards`, `DTSTAMP:${icsTime(new Date().toISOString())}`, `DTSTART:${icsTime(d.starts_at)}`,
    `SUMMARY:${icsText(m.title)}`, `LOCATION:${icsText(place)}`, `DESCRIPTION:${icsText(desc)}`, `URL:${link}`,
    `STATUS:${r.status === 'cancelled' || d.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT', 'END:VCALENDAR'];
  return lines.map(foldIcs).join('\r\n') + '\r\n';
}
function cancelByToken(token) {
  const r = db.prepare('SELECT * FROM registrations WHERE token = ?').get(token);
  if (!r) return { error: 'not_found' };
  if (r.status === 'cancelled') return { ok: true, already: true };
  db.prepare(`UPDATE registrations SET status = 'cancelled', cancelled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(r.id);
  return { ok: true };
}

// ---------- фасилитатор ----------
function parseMeeting(body) {
  const tz = String(body.timezone || '').trim();
  const m = {
    title: String(body.title || '').trim().slice(0, 140),
    description: String(body.description || '').trim().slice(0, 3000),
    country: String(body.country || '').trim().slice(0, 80),
    city: String(body.city || '').trim().slice(0, 80),
    venue: String(body.venue || '').trim().slice(0, 300),
    language: LANGS.includes(body.language) ? body.language : 'ru',
    timezone: tz,
    price_type: body.priceType === 'paid' ? 'paid' : 'free',
    price_note: String(body.priceNote || '').trim().slice(0, 300),
    price_amount: body.priceType === 'paid' ? Number(String(body.priceAmount ?? '').replace(',', '.')) : null,
    currency: body.priceType === 'paid' ? String(body.currency || '').trim().toUpperCase().slice(0, 3) : '',
    capacity: Math.max(1, Math.min(500, Number(body.capacity) || 0)),
    ask_contact: body.askContact ? 1 : 0,
  };
  if (!m.title || !m.country || !m.city) return { error: 'required_fields' };
  if (!validTz(tz)) return { error: 'bad_timezone' };
  if (!Number(body.capacity)) return { error: 'capacity_required' };
  if (m.price_type === 'paid') {
    if (!(m.price_amount > 0) || m.price_amount > 1e9) return { error: 'price_required' };
    if (!/^[A-Z]{3}$/.test(m.currency)) return { error: 'currency_required' };
  }
  return { m };
}
/** Даты: список «YYYY-MM-DDTHH:MM» и/или повтор каждую неделю N раз от первой даты. */
function expandDates(body, tz) {
  const list = (Array.isArray(body.dates) ? body.dates : [body.firstDate]).filter(Boolean).map(String);
  const repeat = Math.max(0, Math.min(52, Number(body.repeatWeekly) || 0));
  const out = [];
  for (const local of list) {
    out.push(local);
    if (repeat && local === list[0]) {
      const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
      if (!m) continue;
      for (let i = 1; i < repeat; i++) {
        const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + 7 * i));
        out.push(`${d.toISOString().slice(0, 10)}T${m[4]}:${m[5]}`);
      }
    }
  }
  const dates = [];
  for (const local of out) { const utc = zonedToUtc(local, tz); if (!utc) return { error: 'bad_date' }; dates.push({ local, utc }); }
  if (!dates.length) return { error: 'date_required' };
  return { dates };
}
function create(user, body) {
  const p = parseMeeting(body); if (p.error) return p;
  const ds = expandDates(body, p.m.timezone); if (ds.error) return ds;
  const id = db.transaction(() => {
    const info = db.prepare(`INSERT INTO meetings (facilitator_id, title, description, country, city, venue, language, timezone, price_type, price_note, price_amount, currency, capacity, ask_contact, is_demo)
      VALUES (@fid, @title, @description, @country, @city, @venue, @language, @timezone, @price_type, @price_note, @price_amount, @currency, @capacity, @ask_contact, @is_demo)`)
      .run({ ...p.m, fid: user.id, is_demo: user.is_demo ? 1 : 0 });
    const ins = db.prepare('INSERT INTO meeting_dates (meeting_id, starts_at, local_time, capacity) VALUES (?, ?, ?, ?)');
    for (const d of ds.dates) ins.run(info.lastInsertRowid, d.utc, d.local, p.m.capacity);
    return info.lastInsertRowid;
  })();
  return { id };
}
function update(meetingId, body) {
  const p = parseMeeting(body); if (p.error) return p;
  const before = db.prepare('SELECT timezone FROM meetings WHERE id = ?').get(meetingId);
  // Город сменился на другой часовой пояс: будущие даты сохраняют местное время (19:00 остаётся 19:00 в новом городе).
  if (before && before.timezone !== p.m.timezone) {
    const fut = db.prepare('SELECT id, local_time FROM meeting_dates WHERE meeting_id = ? AND starts_at >= ?').all(meetingId, nowIso());
    for (const d of fut) { const utc = zonedToUtc(d.local_time, p.m.timezone); if (utc) db.prepare('UPDATE meeting_dates SET starts_at = ? WHERE id = ?').run(utc, d.id); }
  }
  db.prepare(`UPDATE meetings SET title=@title, description=@description, country=@country, city=@city, venue=@venue, language=@language,
    timezone=@timezone, price_type=@price_type, price_note=@price_note, price_amount=@price_amount, currency=@currency, capacity=@capacity, ask_contact=@ask_contact WHERE id=@id`).run({ ...p.m, id: meetingId });
  return { ok: true };
}
function addDates(meetingId, body) {
  const m = db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId);
  const ds = expandDates(body, m.timezone); if (ds.error) return ds;
  const ins = db.prepare('INSERT INTO meeting_dates (meeting_id, starts_at, local_time, capacity) VALUES (?, ?, ?, ?)');
  const cap = Math.max(1, Math.min(500, Number(body.capacity) || m.capacity));
  for (const d of ds.dates) ins.run(meetingId, d.utc, d.local, cap);
  return { ok: true };
}
function setDate(dateId, { status, capacity }) {
  const d = db.prepare('SELECT * FROM meeting_dates WHERE id = ?').get(dateId);
  if (!d) return { error: 'not_found' };
  if (capacity !== undefined) {
    const cap = Math.max(1, Math.min(500, Number(capacity) || 0));
    if (cap < seatsTaken.get(dateId).n) return { error: 'capacity_below_registrations' };
    db.prepare('UPDATE meeting_dates SET capacity = ? WHERE id = ?').run(cap, dateId);
  }
  if (status === 'cancelled' || status === 'active') db.prepare('UPDATE meeting_dates SET status = ? WHERE id = ?').run(status, dateId);
  return { ok: true };
}
const meetingOfDate = (dateId) => (db.prepare('SELECT meeting_id FROM meeting_dates WHERE id = ?').get(dateId) || {}).meeting_id;
const facilitatorOf = (meetingId) => (db.prepare('SELECT facilitator_id FROM meetings WHERE id = ?').get(meetingId) || {}).facilitator_id;
function setPublished(meetingId, published) {
  db.prepare(`UPDATE meetings SET status = ? WHERE id = ? AND status <> 'removed'`).run(published ? 'published' : 'unpublished', meetingId);
  return { ok: true };
}
function mine(userId) {
  return db.prepare('SELECT * FROM meetings WHERE facilitator_id = ? ORDER BY id DESC').all(userId).map((m) => meetingOut(m, { withDates: true, includePast: true }));
}
function oneForEditor(meetingId) {
  const m = db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId);
  if (!m) return null;
  const out = meetingOut(m, { withDates: true, includePast: true });
  for (const d of out.dates) {
    d.registrations = db.prepare('SELECT id, name, email, contact, status, created_at AS createdAt, cancelled_at AS cancelledAt FROM registrations WHERE date_id = ? ORDER BY id').all(d.id);
  }
  return out;
}

// ---------- администратор ----------
function allForAdmin(showDemo) {
  return db.prepare(`SELECT * FROM meetings WHERE ${showDemo ? '1=1' : 'is_demo = 0'} ORDER BY id DESC`).all().map((m) => meetingOut(m, { withDates: true }));
}
function removeByAdmin(adminId, meetingId, reason) {
  const r = db.prepare(`UPDATE meetings SET status = 'removed', removed_reason = ?, removed_by = ? WHERE id = ?`).run(String(reason || '').trim().slice(0, 500), adminId, meetingId);
  return r.changes ? { ok: true } : { error: 'not_found' };
}
function restoreByAdmin(meetingId) {
  const r = db.prepare(`UPDATE meetings SET status = 'published', removed_reason = '', removed_by = NULL WHERE id = ? AND status = 'removed'`).run(meetingId);
  return r.changes ? { ok: true } : { error: 'not_found' };
}

module.exports = {
  LANGS, validTz, zonedToUtc, places, upcoming, datePublic, register, registrationByToken, cancelByToken, icsByToken,
  create, update, addDates, setDate, setPublished, mine, oneForEditor, meetingOfDate, facilitatorOf, allForAdmin, removeByAdmin, restoreByAdmin,
};
