// Подписки на новые встречи (22.11.2026): живые — по городу (и, по желанию, языку), онлайн — по языку.
// Подписчик — аккаунт или гость (этот браузер). Новая опубликованная встреча — одна запись в колокольчике на подписчика
// (dedupe по встрече); для аккаунта — ещё push, если он включён. Человек видит параметры, меняет их или отключает подписку.
const db = require('./db');
const bell = require('./bell');
const { LANGS } = require('./meetings');

db.exec(`CREATE TABLE IF NOT EXISTS meeting_subs (
  id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, visitor_id TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('live','online')), country TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', language TEXT NOT NULL DEFAULT '',
  is_demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_msubs_user ON meeting_subs(user_id);
CREATE INDEX IF NOT EXISTS idx_msubs_visitor ON meeting_subs(visitor_id);`);

const MAX = 10;
const line = (v, n) => String(v ?? "").replace(/[\r\n\t\u2028\u2029]+/g, " ").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim().slice(0, n);
const who = (user, visitor) => (user ? ['user_id = ?', user.id] : visitor ? ['visitor_id = ?', visitor] : null);
const out = (r) => ({ id: r.id, mode: r.mode, country: r.country, city: r.city, language: r.language, createdAt: r.created_at });

function parse(b) {
  const mode = b.mode === 'online' ? 'online' : 'live';
  const language = LANGS.includes(b.language) ? b.language : '';
  const country = mode === 'live' ? line(b.country, 80) : '';
  const city = mode === 'live' ? line(b.city, 80) : '';
  if (mode === 'live' && !city) return { error: 'sub_city_required' };
  if (mode === 'online' && !language) return { error: 'sub_language_required' };
  return { s: { mode, country, city, language } };
}
function list(user, visitor) {
  const w = who(user, visitor); if (!w) return [];
  return db.prepare(`SELECT * FROM meeting_subs WHERE ${w[0]} ORDER BY id`).all(w[1]).map(out);
}
function create(user, visitor, b) {
  const w = who(user, visitor); if (!w) return { error: 'bad_visitor' };
  const p = parse(b || {}); if (p.error) return p;
  const s = p.s;
  // та же подписка второй раз — не дублируем
  const same = db.prepare(`SELECT * FROM meeting_subs WHERE ${w[0]} AND mode = ? AND country = ? AND city = ? AND language = ?`).get(w[1], s.mode, s.country, s.city, s.language);
  if (same) return { ok: true, sub: out(same), repeated: true };
  if (db.prepare(`SELECT COUNT(*) AS n FROM meeting_subs WHERE ${w[0]}`).get(w[1]).n >= MAX) return { error: 'sub_limit' };
  const info = db.prepare('INSERT INTO meeting_subs (user_id, visitor_id, mode, country, city, language, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(user ? user.id : null, user ? null : visitor, s.mode, s.country, s.city, s.language, user && user.is_demo ? 1 : 0);
  return { ok: true, sub: out(db.prepare('SELECT * FROM meeting_subs WHERE id = ?').get(info.lastInsertRowid)) };
}
function update(user, visitor, id, b) {
  const w = who(user, visitor); if (!w) return { error: 'bad_visitor' };
  const ex = db.prepare(`SELECT * FROM meeting_subs WHERE id = ? AND ${w[0]}`).get(Number(id), w[1]); if (!ex) return { error: 'not_found' };
  const p = parse({ ...out(ex), ...(b || {}) }); if (p.error) return p;
  db.prepare('UPDATE meeting_subs SET mode = ?, country = ?, city = ?, language = ? WHERE id = ?').run(p.s.mode, p.s.country, p.s.city, p.s.language, ex.id);
  return { ok: true, sub: out(db.prepare('SELECT * FROM meeting_subs WHERE id = ?').get(ex.id)) };
}
function remove(user, visitor, id) {
  const w = who(user, visitor); if (!w) return { error: 'bad_visitor' };
  const r = db.prepare(`DELETE FROM meeting_subs WHERE id = ? AND ${w[0]}`).run(Number(id), w[1]);
  return r.changes ? { ok: true } : { error: 'not_found' };
}
/** Вход гостя: его подписки переходят в аккаунт. */
function claim(visitor, userId) {
  if (!visitor) return 0;
  return db.prepare('UPDATE meeting_subs SET user_id = ?, visitor_id = NULL WHERE visitor_id = ?').run(userId, visitor).changes;
}

const cityKey = (s) => String(s || '').trim().toLowerCase();
/** Новая опубликованная встреча → подходящим подписчикам по одной записи (повторная публикация того же не дублирует). */
function notifyNew(meetingId) {
  const m = db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId);
  if (!m || m.status !== 'published') return 0;
  const d = db.prepare("SELECT id FROM meeting_dates WHERE meeting_id = ? AND status = 'active' AND starts_at >= ? ORDER BY starts_at LIMIT 1").get(m.id, new Date().toISOString());
  if (!d) return 0;
  const online = m.mode === 'online';
  const subs = db.prepare('SELECT * FROM meeting_subs WHERE mode = ? AND is_demo = ?').all(online ? 'online' : 'live', m.is_demo ? 1 : 0)
    .filter((s) => (online ? s.language === m.language : cityKey(s.city) === cityKey(m.city) && (!s.country || cityKey(s.country) === cityKey(m.country)) && (!s.language || s.language === m.language)));
  let n = 0; const seen = new Set();
  for (const s of subs) {
    const key = s.user_id ? 'u' + s.user_id : 'v' + s.visitor_id; if (seen.has(key)) continue; seen.add(key);
    if (s.user_id && s.user_id === m.facilitator_id) continue; // о своей встрече себе не пишем
    const id = bell.add(s.user_id ? { userId: s.user_id } : { visitorId: s.visitor_id }, {
      kind: 'meeting_new', title: online ? 'Новая онлайн-встреча' : `Новая встреча в городе ${m.city}`, body: m.title,
      url: `/m/${d.id}`, dedupe: `msub:m:${m.id}`, isDemo: !!m.is_demo });
    if (id) n++;
  }
  return n;
}

module.exports = { list, create, update, remove, claim, notifyNew };
