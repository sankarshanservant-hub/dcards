// Единый счётчик «Выбрали для обсуждения» по карте: выборы в подборках фасилитаторов + выборы в общей библиотеке.
// В счёт не идут: тестовые и демо-подборки, демо-карты, демо-роли, выбор автором своей карты (авторство — по cards.artist_id
// на сервере), отменённые выборы. Повторный выбор той же карты новым выбором не считается.
const db = require('./db');

/** SQL-выражение общего числа выборов карты; alias — псевдоним таблицы cards в запросе. */
const totalSql = (alias = 'k') => `((SELECT COUNT(*) FROM selections s WHERE s.card_id = ${alias}.id AND s.cancelled_at IS NULL AND s.is_test = 0 AND s.counted = 1)
  + (SELECT COUNT(*) FROM library_choices l WHERE l.card_id = ${alias}.id AND l.cancelled_at IS NULL AND l.counted = 1))`;

const stmt = {
  total: db.prepare(`SELECT ${totalSql('k')} AS n FROM cards k WHERE k.id = ?`),
  activeByVisitor: db.prepare(`SELECT * FROM library_choices WHERE card_id = ? AND visitor_id = ? AND cancelled_at IS NULL`),
  activeByUser: db.prepare(`SELECT * FROM library_choices WHERE card_id = ? AND user_id = ? AND cancelled_at IS NULL`),
  insert: db.prepare(`INSERT INTO library_choices (card_id, visitor_id, user_id, counted) VALUES (?, ?, ?, ?)`),
  cancel: db.prepare(`UPDATE library_choices SET cancelled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`),
};

const total = (cardId) => stmt.total.get(cardId).n;

/** Почему выбор не идёт в общий счёт: 'own_card' | 'demo' | null (идёт). card — строка из cards, user — вошедший пользователь или null. */
function notCountedReason(card, user, { testCollection = false } = {}) {
  if (testCollection || card.is_demo || (user && user.is_demo)) return 'demo';
  if (user && card.artist_id && card.artist_id === user.id) return 'own_card';
  return null;
}

function mine(cardId, visitorId, user) {
  return (user && stmt.activeByUser.get(cardId, user.id)) || (visitorId && stmt.activeByVisitor.get(cardId, visitorId)) || null;
}

/** Выбор в библиотеке: повторный выбор той же карты (тем же браузером или аккаунтом) ничего не добавляет. */
const choose = db.transaction((card, visitorId, user) => {
  const reason = notCountedReason(card, user);
  if (!mine(card.id, visitorId, user)) stmt.insert.run(card.id, visitorId, user ? user.id : null, reason ? 0 : 1);
  return { chosen: true, notCounted: reason, selectedCount: total(card.id) };
});
const unchoose = db.transaction((card, visitorId, user) => {
  const x = mine(card.id, visitorId, user);
  if (x) stmt.cancel.run(x.id);
  return { chosen: false, selectedCount: total(card.id) };
});

module.exports = { totalSql, total, notCountedReason, mine, choose, unchoose };
