// Личное участника (18.11.2026): заметки к картам («видна только тебе»), «Избранное» и свои подборки.
// У гостя всё это хранится в его браузере (localStorage); у вошедшего — здесь, на сервере, и видно на всех его устройствах.
// При входе гость переносит своё сюда: объединение без дублей и без перезаписи разных заметок (merge).
const db = require('./db');
const { publicCard } = require('./cards');

db.exec(`CREATE TABLE IF NOT EXISTS user_notes (
  user_id INTEGER NOT NULL REFERENCES users(id), card_id INTEGER NOT NULL REFERENCES cards(id), text TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY (user_id, card_id)
);
CREATE TABLE IF NOT EXISTS user_collections (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), title TEXT NOT NULL, is_favorites INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uc_fav ON user_collections(user_id) WHERE is_favorites = 1;
CREATE TABLE IF NOT EXISTS user_collection_cards (
  collection_id INTEGER NOT NULL REFERENCES user_collections(id) ON DELETE CASCADE, card_id INTEGER NOT NULL REFERENCES cards(id),
  position INTEGER NOT NULL DEFAULT 0, added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY (collection_id, card_id)
);`);

// «Мои открытки» (21.11.2026) — внутри «Избранного»: законченная открытка = карта + оформление (design, JSON).
// Картинку не храним: она каждый раз рисуется из оформления, как в редакторе. cid — идентификатор из браузера (перенос без дублей).
db.exec(`CREATE TABLE IF NOT EXISTS user_postcards (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), card_id INTEGER NOT NULL REFERENCES cards(id),
  cid TEXT NOT NULL, design TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS up_cid ON user_postcards(user_id, cid);`);
const MAX_POSTCARDS = 100;
const DESIGN_KEYS = ['layout', 'paper', 'text', 'font', 'weight', 'color', 'k', 'align', 'cx', 'cy', 'bg', 'tone'];
// Оформление открытки — только известные значения: цвета #rrggbb, перечисления, числа в пределах; текст без управляющих символов.
const ENUMS = { layout: ['full', 'frame', 'poster'], font: ['onest', 'serif', 'hand'], weight: ['light', 'mid', 'bold'], align: ['left', 'center', 'right'], bg: ['none', 'grad', 'plate'], tone: ['dark', 'light'] };
const NUMS = { k: [0.02, 0.16], cx: [0, 1], cy: [0, 1] };
function cleanDesign(d) {
  const o = {}; const src = d && typeof d === 'object' ? d : {};
  for (const [k, list] of Object.entries(ENUMS)) if (list.includes(src[k])) o[k] = src[k];
  for (const [k, [lo, hi]] of Object.entries(NUMS)) { const n = Number(src[k]); if (Number.isFinite(n)) o[k] = Math.min(hi, Math.max(lo, n)); }
  for (const k of ['paper', 'color']) if (/^#[0-9a-fA-F]{6}$/.test(String(src[k] || ''))) o[k] = String(src[k]).toLowerCase();
  if (src.text !== undefined) o.text = String(src.text).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, '').slice(0, 240);
  return o;
}
const cleanCid = (c) => String(c || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
function postcards(userId) {
  return db.prepare('SELECT p.cid, p.design, p.created_at, p.updated_at, k.code FROM user_postcards p JOIN cards k ON k.id = p.card_id WHERE p.user_id = ? AND k.status = \'published\' ORDER BY p.updated_at DESC').all(userId)
    .map((r) => ({ id: r.cid, code: r.code, design: JSON.parse(r.design), createdAt: r.created_at, updatedAt: r.updated_at }));
}
function savePostcard(userId, { id, code, design }) {
  const k = cardByCode(code); if (!k) return { error: 'not_found' };
  const cid = cleanCid(id); if (!cid) return { error: 'bad_request' };
  const ex = db.prepare('SELECT id FROM user_postcards WHERE user_id = ? AND cid = ?').get(userId, cid);
  if (!ex && db.prepare('SELECT COUNT(*) AS n FROM user_postcards WHERE user_id = ?').get(userId).n >= MAX_POSTCARDS) return { error: 'collection_full' };
  const d = JSON.stringify(cleanDesign(design));
  if (ex) db.prepare(`UPDATE user_postcards SET card_id = ?, design = ?, updated_at = ${NOW} WHERE id = ?`).run(k.id, d, ex.id);
  else db.prepare('INSERT INTO user_postcards (user_id, card_id, cid, design) VALUES (?, ?, ?, ?)').run(userId, k.id, cid, d);
  return { ok: true, id: cid };
}
function deletePostcard(userId, id) { db.prepare('DELETE FROM user_postcards WHERE user_id = ? AND cid = ?').run(userId, cleanCid(id)); return { ok: true }; }

// «Мои образы» (22.11.2026) — внутри «Моих подборок»: запись из игры «Придумай ассоциации» вместе с картой и парой слов.
db.exec(`CREATE TABLE IF NOT EXISTS user_images (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), card_id INTEGER NOT NULL REFERENCES cards(id),
  cid TEXT NOT NULL, words TEXT NOT NULL, text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ui_cid ON user_images(user_id, cid);`);
const MAX_IMAGES = 200;
const cleanLine = (t, n) => String(t || '').replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, n);
function images(userId) {
  return db.prepare("SELECT i.cid, i.words, i.text, i.created_at, k.code FROM user_images i JOIN cards k ON k.id = i.card_id WHERE i.user_id = ? AND k.status = 'published' ORDER BY i.created_at DESC").all(userId)
    .map((r) => ({ id: r.cid, code: r.code, words: JSON.parse(r.words), text: r.text, createdAt: r.created_at }));
}
function saveImage(userId, { id, code, words, text }) {
  const k = cardByCode(code); if (!k) return { error: 'not_found' };
  const cid = cleanCid(id); const t = cleanLine(text, 300); if (!cid || !t) return { error: 'text_required' };
  const w = (Array.isArray(words) ? words : []).slice(0, 2).map((x) => cleanLine(x, 60)); if (w.length !== 2 || !w[0] || !w[1]) return { error: 'bad_request' };
  if (db.prepare('SELECT 1 FROM user_images WHERE user_id = ? AND cid = ?').get(userId, cid)) { db.prepare('UPDATE user_images SET text = ?, words = ?, card_id = ? WHERE user_id = ? AND cid = ?').run(t, JSON.stringify(w), k.id, userId, cid); return { ok: true, id: cid }; }
  if (db.prepare('SELECT COUNT(*) AS n FROM user_images WHERE user_id = ?').get(userId).n >= MAX_IMAGES) return { error: 'collection_full' };
  db.prepare('INSERT INTO user_images (user_id, card_id, cid, words, text) VALUES (?, ?, ?, ?, ?)').run(userId, k.id, cid, JSON.stringify(w), t);
  return { ok: true, id: cid };
}
function deleteImage(userId, id) { db.prepare('DELETE FROM user_images WHERE user_id = ? AND cid = ?').run(userId, cleanCid(id)); return { ok: true }; }

const MAX = 40; // как у подборки фасилитатора
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const cardByCode = (code) => db.prepare("SELECT * FROM cards WHERE code = ? AND status = 'published'").get(String(code || ''));
function favorites(userId) {
  let f = db.prepare('SELECT * FROM user_collections WHERE user_id = ? AND is_favorites = 1').get(userId);
  if (!f) { db.prepare("INSERT OR IGNORE INTO user_collections (user_id, title, is_favorites) VALUES (?, 'Избранное', 1)").run(userId); f = db.prepare('SELECT * FROM user_collections WHERE user_id = ? AND is_favorites = 1').get(userId); }
  return f;
}
const own = (userId, id) => db.prepare('SELECT * FROM user_collections WHERE id = ? AND user_id = ?').get(Number(id), userId);

function state(userId) {
  favorites(userId);
  const notes = Object.fromEntries(db.prepare('SELECT k.code, n.text, n.updated_at FROM user_notes n JOIN cards k ON k.id = n.card_id WHERE n.user_id = ?').all(userId).map((r) => [r.code, { text: r.text, updatedAt: r.updated_at }]));
  const collections = db.prepare('SELECT * FROM user_collections WHERE user_id = ? ORDER BY is_favorites DESC, updated_at DESC').all(userId).map((c) => ({
    id: c.id, title: c.title, favorites: !!c.is_favorites, updatedAt: c.updated_at,
    codes: db.prepare("SELECT k.code FROM user_collection_cards x JOIN cards k ON k.id = x.card_id WHERE x.collection_id = ? AND k.status = 'published' ORDER BY x.position, x.added_at").all(c.id).map((r) => r.code),
  }));
  return { notes, collections, postcards: postcards(userId), images: images(userId), max: MAX };
}
function setNote(userId, code, text) {
  const c = cardByCode(code); if (!c) return { error: 'not_found' };
  const t = String(text || '').trim().slice(0, 2000);
  if (!t) db.prepare('DELETE FROM user_notes WHERE user_id = ? AND card_id = ?').run(userId, c.id);
  else db.prepare(`INSERT INTO user_notes (user_id, card_id, text) VALUES (?, ?, ?) ON CONFLICT(user_id, card_id) DO UPDATE SET text = excluded.text, updated_at = ${NOW}`).run(userId, c.id, t);
  return { ok: true };
}
function createCollection(userId, title) {
  const t = String(title || '').trim().slice(0, 80); if (!t) return { error: 'title_required' };
  const info = db.prepare('INSERT INTO user_collections (user_id, title) VALUES (?, ?)').run(userId, t);
  return { ok: true, id: Number(info.lastInsertRowid) };
}
function renameCollection(userId, id, title) {
  const c = own(userId, id); if (!c) return { error: 'not_found' };
  if (c.is_favorites) return { error: 'forbidden' };
  const t = String(title || '').trim().slice(0, 80); if (!t) return { error: 'title_required' };
  db.prepare(`UPDATE user_collections SET title = ?, updated_at = ${NOW} WHERE id = ?`).run(t, c.id); return { ok: true };
}
function deleteCollection(userId, id) {
  const c = own(userId, id); if (!c) return { error: 'not_found' };
  if (c.is_favorites) return { error: 'forbidden' };
  db.prepare('DELETE FROM user_collection_cards WHERE collection_id = ?').run(c.id);
  db.prepare('DELETE FROM user_collections WHERE id = ?').run(c.id); return { ok: true };
}
/** Добавить/убрать карту. id 'favorites' — «Избранное». */
function toggle(userId, id, code, on) {
  const c = id === 'favorites' ? favorites(userId) : own(userId, id); if (!c) return { error: 'not_found' };
  const k = cardByCode(code); if (!k) return { error: 'not_found' };
  if (on) {
    const n = db.prepare('SELECT COUNT(*) AS n FROM user_collection_cards WHERE collection_id = ?').get(c.id).n;
    if (n >= MAX && !db.prepare('SELECT 1 FROM user_collection_cards WHERE collection_id = ? AND card_id = ?').get(c.id, k.id)) return { error: 'collection_full' };
    db.prepare('INSERT OR IGNORE INTO user_collection_cards (collection_id, card_id, position) VALUES (?, ?, ?)').run(c.id, k.id, n);
  } else db.prepare('DELETE FROM user_collection_cards WHERE collection_id = ? AND card_id = ?').run(c.id, k.id);
  db.prepare(`UPDATE user_collections SET updated_at = ${NOW} WHERE id = ?`).run(c.id);
  return { ok: true };
}
/**
 * Перенос из браузера гостя. local: { notes: {code: {text, updatedAt}}, favorites: [code], collections: [{title, codes}] }.
 * Заметка: если в аккаунте её нет — переносим; если есть и текст другой — сохраняем обе (новая дописывается ниже с пометкой);
 * если такая же — ничего. Подборки с тем же названием объединяются, карты не дублируются.
 */
function merge(userId, local) {
  const L = local && typeof local === 'object' ? local : {};
  let notes = 0; let cards = 0; let cols = 0;
  db.transaction(() => {
    for (const [code, v] of Object.entries(L.notes || {}).slice(0, 500)) {
      const k = cardByCode(code); const t = String((v && v.text) || '').trim().slice(0, 2000); if (!k || !t) continue;
      const ex = db.prepare('SELECT text FROM user_notes WHERE user_id = ? AND card_id = ?').get(userId, k.id);
      if (!ex) { db.prepare('INSERT INTO user_notes (user_id, card_id, text) VALUES (?, ?, ?)').run(userId, k.id, t); notes++; }
      else if (ex.text !== t && !ex.text.includes(t)) { db.prepare(`UPDATE user_notes SET text = ?, updated_at = ${NOW} WHERE user_id = ? AND card_id = ?`).run(`${ex.text}\n\n— с другого устройства —\n${t}`.slice(0, 4000), userId, k.id); notes++; }
    }
    const fav = favorites(userId);
    const add = (cid, code) => { const k = cardByCode(code); if (!k) return; const n = db.prepare('SELECT COUNT(*) AS n FROM user_collection_cards WHERE collection_id = ?').get(cid).n; if (n >= MAX) return; cards += db.prepare('INSERT OR IGNORE INTO user_collection_cards (collection_id, card_id, position) VALUES (?, ?, ?)').run(cid, k.id, n).changes; };
    for (const code of (L.favorites || []).slice(0, 200)) add(fav.id, code);
    for (const im of (Array.isArray(L.images) ? L.images : []).slice(0, MAX_IMAGES)) {
      if (im && !db.prepare('SELECT 1 FROM user_images WHERE user_id = ? AND cid = ?').get(userId, cleanCid(im.id)) && saveImage(userId, im).ok) cards++;
    }
    for (const p of (Array.isArray(L.postcards) ? L.postcards : []).slice(0, MAX_POSTCARDS)) {
      if (p && !db.prepare('SELECT 1 FROM user_postcards WHERE user_id = ? AND cid = ?').get(userId, cleanCid(p.id)) && savePostcard(userId, p).ok) cards++;
    }
    for (const c of (L.collections || []).slice(0, 50)) {
      const t = String((c && c.title) || '').trim().slice(0, 80); if (!t) continue;
      let col = db.prepare('SELECT * FROM user_collections WHERE user_id = ? AND title = ? AND is_favorites = 0').get(userId, t);
      if (!col) { const info = db.prepare('INSERT INTO user_collections (user_id, title) VALUES (?, ?)').run(userId, t); col = { id: Number(info.lastInsertRowid) }; cols++; }
      for (const code of (c.codes || []).slice(0, MAX)) add(col.id, code);
    }
  })();
  return { ok: true, notes, cards, collections: cols };
}
/** Карты своей подборки — для игры компанией. */
function collectionCodes(userId, id) {
  const c = id === 'favorites' ? favorites(userId) : own(userId, id); if (!c) return null;
  return db.prepare("SELECT k.code FROM user_collection_cards x JOIN cards k ON k.id = x.card_id WHERE x.collection_id = ? AND k.status = 'published'").all(c.id).map((r) => r.code);
}
const cardsOf = (codes) => codes.map(cardByCode).filter(Boolean).map((k) => publicCard(k));

module.exports = { cleanDesign, images, saveImage, deleteImage, postcards, savePostcard, deletePostcard, state, setNote, createCollection, renameCollection, deleteCollection, toggle, merge, collectionCodes, cardsOf, MAX };
