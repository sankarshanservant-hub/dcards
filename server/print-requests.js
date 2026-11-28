// Предварительные заявки на печатные колоды (26.11.2026). Печатных колод пока нет, сроки не определены: собираем спрос,
// не оформляем покупку — без оплаты, цен и сроков. Заявка связана с аккаунтом; дальнейшая связь — в приложении
// (колокольчик) и через «Написать администрации». Одна действующая заявка на человека: пока она «новая», её можно исправить.
const db = require('./db');
const bell = require('./bell');
const { demoWhere } = require('./demo-scope');

const cols = db.prepare('PRAGMA table_info(print_requests)').all().map((c) => c.name);
if (!cols.includes('count')) db.exec('ALTER TABLE print_requests ADD COLUMN count INTEGER');
if (!cols.includes('country')) db.exec("ALTER TABLE print_requests ADD COLUMN country TEXT NOT NULL DEFAULT ''");
if (!cols.includes('city')) db.exec("ALTER TABLE print_requests ADD COLUMN city TEXT NOT NULL DEFAULT ''");
if (!cols.includes('comment')) db.exec("ALTER TABLE print_requests ADD COLUMN comment TEXT NOT NULL DEFAULT ''");
if (!cols.includes('updated_at')) db.exec('ALTER TABLE print_requests ADD COLUMN updated_at TEXT');

const out = (p) => p && { id: p.id, count: p.count, country: p.country, city: p.city, comment: p.comment || p.note || '', status: p.status, createdAt: p.created_at, updatedAt: p.updated_at || p.created_at };
/** Последняя заявка человека (новая — в приоритете). */
function mine(userId) {
  return out(db.prepare("SELECT * FROM print_requests WHERE user_id = ? ORDER BY (status = 'new') DESC, id DESC LIMIT 1").get(userId)) || null;
}
function validate(b) {
  const raw = b && b.count;
  const count = typeof raw === 'number' ? raw : /^\s*\d+\s*$/.test(String(raw ?? '')) ? Number(raw) : NaN;
  if (!Number.isInteger(count) || count < 1 || count > 10000) return { error: 'count_invalid' };
  const country = String((b && b.country) || '').trim().slice(0, 100);
  const city = String((b && b.city) || '').trim().slice(0, 100);
  if (!country) return { error: 'country_required' };
  if (!city) return { error: 'city_required' };
  return { count, country, city, comment: String((b && b.comment) || '').trim().slice(0, 2000) };
}
/** Новая заявка или исправление своей «новой». Повторная отправка не создаёт вторую заявку. */
function save(user, body) {
  const v = validate(body); if (v.error) return v;
  const cur = db.prepare("SELECT * FROM print_requests WHERE user_id = ? AND status = 'new' ORDER BY id DESC LIMIT 1").get(user.id);
  if (cur) {
    db.prepare("UPDATE print_requests SET count = ?, country = ?, city = ?, comment = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(v.count, v.country, v.city, v.comment, cur.id);
    return { ok: true, updated: true, request: mine(user.id) };
  }
  db.prepare('INSERT INTO print_requests (user_id, note, count, country, city, comment, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(user.id, '', v.count, v.country, v.city, v.comment, user.is_demo ? 1 : 0);
  return { ok: true, created: true, request: mine(user.id) };
}
/** Для администратора: число колод, география, автор заявки. */
function list(showDemo) { // showDemo — область демо-данных (demoScope): false / true / 'only'
  return db.prepare(`SELECT p.*, COALESCE(NULLIF(u.public_name,''), u.name) AS name, u.email FROM print_requests p JOIN users u ON u.id = p.user_id
    WHERE ${demoWhere(showDemo, 'p.is_demo')} ORDER BY (p.status = 'new') DESC, p.id DESC LIMIT 300`).all()
    .map((p) => ({ ...out(p), userId: p.user_id, name: p.name, email: p.email, note: p.note, isDemo: !!p.is_demo }));
}
/**
 * Когда появится реальная возможность заказа: уведомление в приложении каждому заявителю (одно на человека и событие).
 * Сейчас нигде не вызывается — колод нет, сообщать о них нельзя.
 */
function notifyAll(eventKey, title, body) {
  let n = 0;
  for (const r of db.prepare("SELECT DISTINCT user_id, is_demo FROM print_requests WHERE status = 'new'").all()) {
    if (bell.add({ userId: r.user_id }, { kind: 'print_decks', title, body, url: '/facilitator?print=1', dedupe: `print:${eventKey}`, isDemo: !!r.is_demo })) n++;
  }
  return n;
}
module.exports = { mine, save, list, notifyAll, validate };
