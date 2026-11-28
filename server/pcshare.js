// Отправленная открытка (26.11.2026): ссылка /pc/<ссылка> открывает карту и послание. Превью ссылки в мессенджере —
// «Вам открытка!» и сама карта, без текста послания (его видно, только открыв ссылку). Адрес — случайный, не короче
// 22 символов; повтор с тем же clientKey не создаёт вторую запись. Карта снята с публикации — открытка не показывается.
const crypto = require('crypto');
const db = require('./db');
const { cleanDesign } = require('./personal');

db.exec(`CREATE TABLE IF NOT EXISTS shared_postcards (
  id INTEGER PRIMARY KEY, token TEXT NOT NULL UNIQUE, card_id INTEGER NOT NULL REFERENCES cards(id), design TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id), visitor_id TEXT, client_key TEXT, is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS sp_client ON shared_postcards(client_key) WHERE client_key IS NOT NULL;`);

const okToken = (t) => typeof t === 'string' && /^[A-Za-z0-9_-]{22,40}$/.test(t);
const tok = () => crypto.randomBytes(18).toString('base64url');

/** card — опубликованная карта. token может прийти от браузера заранее (меню отправки открывается сразу по нажатию). */
function create(card, user, visitor, { design, clientKey, token }) {
  const key = clientKey ? String(clientKey).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) : null;
  if (key) { const ex = db.prepare('SELECT token FROM shared_postcards WHERE client_key = ?').get(key); if (ex) return { ok: true, token: ex.token, repeated: true }; }
  let t = tok();
  if (okToken(token)) { if (db.prepare('SELECT 1 FROM shared_postcards WHERE token = ?').get(token)) return { error: 'conflict' }; t = token; }
  db.prepare('INSERT INTO shared_postcards (token, card_id, design, user_id, visitor_id, client_key, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(t, card.id, JSON.stringify(cleanDesign(design)), user ? user.id : null, user ? null : (visitor || null), key, card.is_demo || (user && user.is_demo) ? 1 : 0);
  return { ok: true, token: t };
}
/** Открытка по ссылке: карта (если ещё опубликована) и оформление. */
function get(token) {
  if (!okToken(token)) return null;
  const p = db.prepare('SELECT * FROM shared_postcards WHERE token = ?').get(token); if (!p) return null;
  const card = db.prepare("SELECT * FROM cards WHERE id = ? AND status = 'published'").get(p.card_id);
  let design = {}; try { design = JSON.parse(p.design); } catch { /* */ }
  return { card, design, isDemo: !!p.is_demo };
}
module.exports = { create, get, okToken };
