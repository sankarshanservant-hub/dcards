// Единый счётчик «Выбрали для разговора» — новые источники (18.11.2026): обмен с другом, игры компанией, разговор в парах.
// Единица — один подтверждённый выбор карты в независимом месте разговора. У каждого места свой ключ по смыслу события
// (x:<обмен>, g:<комната>:<раунд>:<место>…): повтор запроса, двойное нажатие, переподключение не создают нового выбора,
// а выбор другой карты в том же месте заменяет прежний. Прежние источники (подборки, выбор в галерее) — в choices.js.
const db = require('./db');

db.exec(`CREATE TABLE IF NOT EXISTS talk_choices (
  key TEXT PRIMARY KEY, card_id INTEGER NOT NULL REFERENCES cards(id), source TEXT NOT NULL,
  counted INTEGER NOT NULL DEFAULT 1, user_id INTEGER, cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_talk_card ON talk_choices(card_id);`);

/**
 * Записать (или заменить) выбор в месте key. card — строка cards (или code). chooser — пользователь, выбравший карту
 * (если известен): выбор автором своей карты не считается. demo — демо-комната/обмен.
 */
function record(key, card, { source, chooserId = null, demo = false } = {}) {
  const c = typeof card === 'string' ? db.prepare('SELECT * FROM cards WHERE code = ?').get(card) : card;
  if (!c) return null;
  const chooser = chooserId ? db.prepare('SELECT id, is_demo FROM users WHERE id = ?').get(chooserId) : null;
  const counted = !(demo || c.is_demo || (chooser && chooser.is_demo) || (chooser && c.artist_id && c.artist_id === chooser.id));
  db.prepare(`INSERT INTO talk_choices (key, card_id, source, counted, user_id) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET card_id = excluded.card_id, counted = excluded.counted, user_id = excluded.user_id, cancelled_at = NULL,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`).run(key, c.id, source || 'game', counted ? 1 : 0, chooser ? chooser.id : null);
  return { counted };
}
function cancel(key) { db.prepare(`UPDATE talk_choices SET cancelled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key = ? AND cancelled_at IS NULL`).run(key); }
const sql = (alias = 'k') => `(SELECT COUNT(*) FROM talk_choices t WHERE t.card_id = ${alias}.id AND t.counted = 1 AND t.cancelled_at IS NULL)`;

module.exports = { record, cancel, sql };
