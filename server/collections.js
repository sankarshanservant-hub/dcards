const crypto = require('crypto');
const db = require('./db');
const config = require('./config');
const { publicCard } = require('./cards');

// Короткий код ссылки без похожих символов (0/O, 1/l) — удобно диктовать и набирать вручную.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
function newSlug(len = 7) {
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}

const stmt = {
  bySlug: db.prepare('SELECT * FROM collections WHERE slug = ?'),
  byId: db.prepare('SELECT * FROM collections WHERE id = ?'),
  all: db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM collection_cards cc JOIN cards k ON k.id = cc.card_id WHERE cc.collection_id = c.id AND k.status = 'published') AS card_count,
      (SELECT COUNT(*) FROM collection_cards cc JOIN cards k ON k.id = cc.card_id WHERE cc.collection_id = c.id AND k.status <> 'published') AS unavailable_count,
      (SELECT COUNT(DISTINCT visitor_id) FROM card_offers o WHERE o.collection_id = c.id) AS visitors,
      (SELECT COUNT(*) FROM selections s WHERE s.collection_id = c.id AND s.cancelled_at IS NULL) AS selections
    FROM collections c ORDER BY c.updated_at DESC`),
  cards: db.prepare(`
    SELECT k.* FROM collection_cards cc JOIN cards k ON k.id = cc.card_id
    WHERE cc.collection_id = ? ORDER BY cc.position ASC`),
  insert: db.prepare('INSERT INTO collections (slug, title, is_test) VALUES (?, ?, ?)'),
  touch: db.prepare(`UPDATE collections SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`),
  cardInCollection: db.prepare(`
    SELECT k.* FROM collection_cards cc JOIN cards k ON k.id = cc.card_id
    WHERE cc.collection_id = ? AND k.code = ? AND k.status = 'published'`),
  activeSelections: db.prepare(`
    SELECT s.round, k.code FROM selections s JOIN cards k ON k.id = s.card_id
    WHERE s.collection_id = ? AND s.visitor_id = ? AND s.cancelled_at IS NULL AND k.status = 'published'
    ORDER BY s.round ASC`),
  activeInRound: db.prepare(`
    SELECT * FROM selections WHERE collection_id = ? AND visitor_id = ? AND round = ? AND cancelled_at IS NULL`),
  cancel: db.prepare(`UPDATE selections SET cancelled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`),
  insertSelection: db.prepare(`INSERT INTO selections (collection_id, card_id, visitor_id, round, is_test) VALUES (?, ?, ?, ?, ?)`),
  insertOffer: db.prepare(`INSERT OR IGNORE INTO card_offers (collection_id, card_id, visitor_id, is_test) VALUES (?, ?, ?, ?)`),
  publicCount: db.prepare(`SELECT COUNT(*) AS n FROM selections WHERE card_id = ? AND cancelled_at IS NULL AND is_test = 0`),
  cardStatsInCollection: db.prepare(`
    SELECT k.id,
      (SELECT COUNT(*) FROM selections s WHERE s.collection_id = @cid AND s.card_id = k.id AND s.cancelled_at IS NULL) AS selections,
      (SELECT COUNT(*) FROM card_offers o WHERE o.collection_id = @cid AND o.card_id = k.id) AS offers
    FROM collection_cards cc JOIN cards k ON k.id = cc.card_id WHERE cc.collection_id = @cid`),
};

function getPublic(slug, showDemo) {
  const col = stmt.bySlug.get(slug);
  if (!col) return null;
  // Демо-карты видны в подборке, если сама подборка демонстрационная или включён демо-просмотр.
  const cards = stmt.cards.all(col.id).filter((r) => r.status === 'published' && (!r.is_demo || col.is_demo || showDemo))
    .map((r) => publicCard(r, { withDetails: true }));
  return { col, data: { slug: col.slug, title: col.title, isTest: !!(col.is_test || col.is_demo), isDemo: !!col.is_demo, cards } };
}

function visitorState(col, visitorId) {
  const selections = stmt.activeSelections.all(col.id, visitorId);
  const counts = {};
  for (const s of selections) {
    const card = db.prepare('SELECT id FROM cards WHERE code = ?').get(s.code);
    counts[s.code] = stmt.publicCount.get(card.id).n;
  }
  return { selections, counts };
}

/** Участник открыл подборку: отмечаем, что карты были ему предложены (один раз на браузер). */
const recordVisit = db.transaction((col, visitorId) => {
  for (const r of stmt.cards.all(col.id)) {
    if (r.status === 'published') stmt.insertOffer.run(col.id, r.id, visitorId, col.is_test || col.is_demo ? 1 : 0);
  }
});

/**
 * Выбор карты для обсуждения. Правило прототипа (предложено, не утверждено):
 * в одном раунде у участника одна активная карта; выбор другой карты заменяет прежний,
 * повторный выбор той же карты ничего не меняет. Выборы прежних раундов сохраняются.
 */
const select = db.transaction((col, visitorId, code, round) => {
  const card = stmt.cardInCollection.get(col.id, code);
  if (!card) return { error: 'card_not_in_collection' };
  const current = stmt.activeInRound.get(col.id, visitorId, round);
  if (current && current.card_id === card.id) return { ok: true };
  if (current) stmt.cancel.run(current.id);
  stmt.insertSelection.run(col.id, card.id, visitorId, round, col.is_test || col.is_demo ? 1 : 0);
  return { ok: true };
});

const unselect = db.transaction((col, visitorId, round) => {
  const current = stmt.activeInRound.get(col.id, visitorId, round);
  if (current) stmt.cancel.run(current.id);
  return { ok: true };
});

// ---------- управление (владелец проекта) ----------

function listAll(ownerId = null) {
  return stmt.all.all().filter((c) => ownerId === null || c.owner_id === ownerId).map((c) => ({
    id: c.id, slug: c.slug, title: c.title, isTest: !!c.is_test, ownerId: c.owner_id, isDemo: !!c.is_demo,
    ownerName: c.owner_id ? (db.prepare('SELECT COALESCE(NULLIF(public_name, \'\'), name) AS n FROM users WHERE id = ?').get(c.owner_id) || {}).n : '',
    cardCount: c.card_count, unavailableCount: c.unavailable_count,
    visitors: c.visitors, selections: c.selections, updatedAt: c.updated_at,
  }));
}

function create(title, isTest = false, ownerId = null, isDemo = false) {
  let slug;
  do slug = newSlug(); while (stmt.bySlug.get(slug));
  const info = stmt.insert.run(slug, String(title || '').trim().slice(0, 120) || 'Новая подборка', isTest ? 1 : 0);
  db.prepare('UPDATE collections SET owner_id = ?, is_demo = ? WHERE id = ?').run(ownerId, isDemo ? 1 : 0, info.lastInsertRowid);
  return info.lastInsertRowid;
}
const ownerOf = (id) => (stmt.byId.get(id) || {}).owner_id ?? null;
const exists = (id) => !!stmt.byId.get(id);

function adminDetail(id) {
  const col = stmt.byId.get(id);
  if (!col) return null;
  const stats = new Map(stmt.cardStatsInCollection.all({ cid: id }).map((s) => [s.id, s]));
  const cards = stmt.cards.all(id).map((r) => ({
    ...publicCard(r, { withDetails: true }),
    status: r.status,
    selections: stats.get(r.id)?.selections || 0,
    offers: stats.get(r.id)?.offers || 0,
  }));
  const visitors = db.prepare('SELECT COUNT(DISTINCT visitor_id) AS n FROM card_offers WHERE collection_id = ?').get(id).n;
  return { id: col.id, slug: col.slug, title: col.title, isTest: !!col.is_test, isDemo: !!col.is_demo, ownerId: col.owner_id, updatedAt: col.updated_at, visitors, cards };
}

function update(id, { title, isTest }) {
  const col = stmt.byId.get(id);
  if (!col) return false;
  if (typeof title === 'string' && title.trim()) db.prepare('UPDATE collections SET title = ? WHERE id = ?').run(title.trim().slice(0, 120), id);
  if (typeof isTest === 'boolean') db.prepare('UPDATE collections SET is_test = ? WHERE id = ?').run(isTest ? 1 : 0, id);
  stmt.touch.run(id);
  return true;
}

/** Полностью задаёт состав подборки. Не больше 40 карт, без повторов. */
const setCards = db.transaction((id, codes) => {
  const col = stmt.byId.get(id);
  if (!col) return { error: 'not_found' };
  if (!Array.isArray(codes)) return { error: 'bad_request' };
  const unique = [...new Set(codes.map(String))];
  if (unique.length > config.maxCollectionSize) return { error: 'too_many_cards', max: config.maxCollectionSize };
  const current = new Set(stmt.cards.all(id).map((r) => r.code));
  const rows = [];
  for (const code of unique) {
    const r = db.prepare('SELECT * FROM cards WHERE code = ?').get(code);
    if (!r) return { error: 'unknown_card', code };
    // Снятую карту нельзя добавить заново, но можно оставить, если она уже была в подборке.
    if (r.status !== 'published' && !current.has(code)) return { error: 'card_unavailable', code };
    rows.push(r);
  }
  db.prepare('DELETE FROM collection_cards WHERE collection_id = ?').run(id);
  const ins = db.prepare('INSERT INTO collection_cards (collection_id, card_id, position) VALUES (?, ?, ?)');
  rows.forEach((r, i) => ins.run(id, r.id, i));
  stmt.touch.run(id);
  return { ok: true };
});

function remove(id) {
  return db.prepare('DELETE FROM collections WHERE id = ?').run(id).changes > 0;
}

module.exports = { ownerOf, exists, getPublic, visitorState, recordVisit, select, unselect, listAll, create, adminDetail, update, setCards, remove, stmt };
