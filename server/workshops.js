// Предварительные заявки на онлайн-занятия «Метафорическое мышление и создание карт» (28.11.2026).
// Это сбор интереса, а не запись на курс: дат, программы и стоимости нет. Регистрация не требуется.
// Одна заявка на человека: у вошедшего — по аккаунту, у гостя — по браузеру и по контакту. Повтор возвращает ту же заявку.
// Данные заявителей видит только администратор (маршрут под /api/admin).
const db = require('./db');
const bell = require('./bell');

db.exec(`CREATE TABLE IF NOT EXISTS workshop_requests (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id), visitor_id TEXT,
  name TEXT NOT NULL, contact TEXT NOT NULL, contact_kind TEXT NOT NULL, contact_key TEXT NOT NULL,
  interest TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',          -- new | seen
  seen_at TEXT, seen_by INTEGER, is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ws_user ON workshop_requests(user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ws_contact ON workshop_requests(contact_key);`);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Email или Telegram (@ник или t.me/ник). → { kind, value, key } или null. */
function parseContact(raw) {
  const s = String(raw || '').trim();
  if (EMAIL_RE.test(s) && s.length <= 200) return { kind: 'email', value: s, key: 'e:' + s.toLowerCase() };
  const m = /^(?:https?:\/\/)?(?:t\.me\/|telegram\.me\/)?@?([A-Za-z][A-Za-z0-9_]{4,31})$/.exec(s);
  if (m) return { kind: 'telegram', value: '@' + m[1], key: 't:' + m[1].toLowerCase() };
  return null;
}
const out = (r) => r && ({ id: r.id, name: r.name, contact: r.contact, contactKind: r.contact_kind, interest: r.interest, createdAt: r.created_at });

/** Заявка этого человека (для «Заявка отправлена» вместо повторной формы). */
function mine(user, visitor) {
  if (user) return out(db.prepare('SELECT * FROM workshop_requests WHERE user_id = ?').get(user.id));
  if (visitor) return out(db.prepare('SELECT * FROM workshop_requests WHERE visitor_id = ? AND user_id IS NULL ORDER BY id DESC LIMIT 1').get(visitor));
  return null;
}
function submit(user, visitor, { name, contact, interest }) {
  const n = String(name || '').trim().slice(0, 100);
  if (!n) return { error: 'name_required' };
  const c = parseContact(contact);
  if (!c) return { error: 'contact_invalid' };
  const existing = mine(user, visitor) || out(db.prepare('SELECT * FROM workshop_requests WHERE contact_key = ?').get(c.key));
  if (existing) return { ok: true, already: true, request: existing };
  const info = db.prepare(`INSERT OR IGNORE INTO workshop_requests (user_id, visitor_id, name, contact, contact_kind, contact_key, interest, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(user ? user.id : null, user ? null : (visitor || null), n, c.value, c.kind, c.key, String(interest || '').trim().slice(0, 2000), user && user.is_demo ? 1 : 0);
  if (!info.changes) return { ok: true, already: true, request: mine(user, visitor) }; // одновременная отправка: уже сохранена
  const id = Number(info.lastInsertRowid);
  const demo = !!(user && user.is_demo);
  // администраторам — одна обновляемая запись в колокольчике с числом новых заявок
  const fresh = db.prepare(`SELECT COUNT(*) AS n FROM workshop_requests WHERE status = 'new' AND is_demo = ?`).get(demo ? 1 : 0).n;
  for (const uid of bell.usersWithRole('admin', demo)) bell.add({ userId: uid }, { kind: 'admin_workshop', title: `Новые заявки на онлайн-занятия: ${fresh}`, body: '', url: '/admin/workshops', group: 'ws:new', count: fresh, isDemo: demo });
  return { ok: true, request: out(db.prepare('SELECT * FROM workshop_requests WHERE id = ?').get(id)) };
}
function list(showDemo) {
  const rows = db.prepare(`SELECT w.*, COALESCE(NULLIF(u.public_name,''), u.name) AS account FROM workshop_requests w LEFT JOIN users u ON u.id = w.user_id
    WHERE ${showDemo ? '1=1' : 'w.is_demo = 0'} ORDER BY CASE w.status WHEN 'new' THEN 0 ELSE 1 END, w.id DESC`).all();
  return { total: rows.length, fresh: rows.filter((r) => r.status === 'new').length,
    requests: rows.map((r) => ({ ...out(r), status: r.status, userId: r.user_id, account: r.account || null, isDemo: !!r.is_demo, seenAt: r.seen_at })) };
}
function setStatus(id, status, adminId) {
  if (!['new', 'seen'].includes(status)) return { error: 'bad_status' };
  const r = db.prepare(`UPDATE workshop_requests SET status = ?, seen_at = CASE WHEN ? = 'seen' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END, seen_by = ? WHERE id = ?`).run(status, status, adminId, Number(id));
  if (!r.changes) return { error: 'not_found' };
  if (!db.prepare(`SELECT 1 FROM workshop_requests WHERE status = 'new'`).get()) bell.resolve('ws:new', 'Новые заявки на онлайн-занятия просмотрены', '');
  return { ok: true };
}
const newCount = (showDemo) => db.prepare(`SELECT COUNT(*) AS n FROM workshop_requests WHERE status = 'new' AND ${showDemo ? '1=1' : 'is_demo = 0'}`).get().n;

module.exports = { parseContact, mine, submit, list, setStatus, newCount };
