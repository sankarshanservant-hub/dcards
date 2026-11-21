// Общий обмен «Отправить нескольким людям» (21.11.2026): одна ссылка-приглашение на карту с вопросом для нескольких
// получателей в разных чатах. Каждый отвечает сам и только после этого видит накопившиеся ответы (свой — тоже).
// До ответа и в превью ссылки чужих ответов нет. Повторное открытие тем же участником (браузер или аккаунт) восстанавливает
// его состояние. Личные ответы из прежних парных обменов сюда не переносятся. Сторис с чужими ответами здесь нет: согласие
// всех авторов не собирается, поэтому для сторис — только вариант с самой картой.
const crypto = require('crypto');
const db = require('./db');
const { publicCard } = require('./cards');
const talk = require('./talk');
const bell = require('./bell');

db.exec(`CREATE TABLE IF NOT EXISTS x_groups (
  id INTEGER PRIMARY KEY, card_id INTEGER NOT NULL REFERENCES cards(id),
  a_user_id INTEGER REFERENCES users(id), a_visitor TEXT, a_name TEXT NOT NULL DEFAULT '', a_text TEXT NOT NULL, question TEXT,
  a_secret TEXT NOT NULL UNIQUE, invite_token TEXT NOT NULL UNIQUE, client_key TEXT, is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS xg_client ON x_groups(a_visitor, client_key) WHERE client_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS x_group_members (
  id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES x_groups(id), user_id INTEGER REFERENCES users(id), visitor TEXT,
  name TEXT NOT NULL DEFAULT '', text TEXT NOT NULL, secret TEXT NOT NULL UNIQUE, answer_key TEXT,
  answered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS xgm_group ON x_group_members(group_id);`);

// 23.11.2026: прежний вопрос по умолчанию у уже созданных общих обменов сохраняется (см. exchanges.js)
if (!db.prepare('PRAGMA table_info(x_groups)').all().some((x) => x.name === 'q_v2')) {
  db.exec('ALTER TABLE x_groups ADD COLUMN q_v2 INTEGER NOT NULL DEFAULT 1');
  db.prepare("UPDATE x_groups SET question = 'Что тебе откликается в этой карте?' WHERE question IS NULL").run();
}
const MAX_MEMBERS = 50;
const DEFAULT_QUESTION = 'Что ты здесь видишь?'; // как на главной (23.11.2026)
const tok = () => crypto.randomBytes(18).toString('base64url');
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
// пробелы и переводы строк — в один пробел, прочие управляющие символы убираются (как в exchanges.js)
const clean = (t, n) => String(t || '').replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, n);
const nameOf = (userId, typed) => { if (userId) { const u = db.prepare('SELECT name, public_name FROM users WHERE id = ?').get(userId); if (u) return u.public_name || u.name; } return typed; };
const isOwner = (g, user, visitor) => (user && g.a_user_id === user.id) || (visitor && g.a_visitor === visitor);
const memberOf = (g, user, visitor) => db.prepare('SELECT * FROM x_group_members WHERE group_id = ? AND ((user_id IS NOT NULL AND user_id = ?) OR (visitor IS NOT NULL AND visitor = ?)) LIMIT 1').get(g.id, user ? user.id : -1, visitor || '');

function create(card, user, visitor, { text, name, question, clientKey }) {
  const t = clean(text, 300); if (!t) return { error: 'text_required' };
  if (!user && !visitor) return { error: 'visitor_required' };
  const key = clientKey ? clean(clientKey, 64).replace(/[^A-Za-z0-9_-]/g, '') : null;
  if (key) { const ex = db.prepare('SELECT * FROM x_groups WHERE a_visitor IS ? AND client_key = ?').get(visitor || null, key); if (ex) return { ok: true, repeated: true, group: true, id: ex.id, secret: ex.a_secret, invite: ex.invite_token }; }
  const q = clean(question, 200);
  const info = db.prepare('INSERT INTO x_groups (card_id, a_user_id, a_visitor, a_name, a_text, question, a_secret, invite_token, client_key, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(card.id, user ? user.id : null, visitor || null, nameOf(user && user.id, clean(name, 40)) || '', t, q && q !== DEFAULT_QUESTION ? q : null, tok(), tok(), key, (card.is_demo || (user && user.is_demo)) ? 1 : 0);
  const g = db.prepare('SELECT * FROM x_groups WHERE id = ?').get(Number(info.lastInsertRowid));
  return { ok: true, group: true, id: g.id, secret: g.a_secret, invite: g.invite_token };
}

/** Кто открыл ссылку: owner (создатель), member (уже ответил), invitee (ещё не ответил). */
function resolve(token, user, visitor) {
  let g = db.prepare('SELECT * FROM x_groups WHERE a_secret = ? OR invite_token = ?').get(token, token);
  let m = null;
  if (!g) { m = db.prepare('SELECT * FROM x_group_members WHERE secret = ?').get(token); if (m) g = db.prepare('SELECT * FROM x_groups WHERE id = ?').get(m.group_id); }
  if (!g) return { g: null };
  if (g.a_secret === token || isOwner(g, user, visitor)) return { g, role: 'owner' };
  m = m || memberOf(g, user, visitor);
  if (m) return { g, role: 'member', m };
  return { g, role: 'invitee' };
}

function view(g, role, m = null) {
  const card = publicCard(db.prepare('SELECT * FROM cards WHERE id = ?').get(g.card_id), { withDetails: true });
  const base = { kind: 'group', id: g.id, role, card, question: g.question || DEFAULT_QUESTION, fromName: g.a_name || '', createdAt: g.created_at };
  if (role === 'invitee') return base; // ни одного ответа до своего
  const members = db.prepare('SELECT * FROM x_group_members WHERE group_id = ? ORDER BY answered_at, id').all(g.id);
  const answers = [{ name: g.a_name || '', text: g.a_text, me: role === 'owner', owner: true },
    ...members.map((x) => ({ name: x.name || '', text: x.text, me: !!(m && x.id === m.id) }))];
  return { ...base, answers, count: members.length, secret: role === 'owner' ? g.a_secret : m.secret, invite: g.invite_token, answered: members.length > 0 };
}

function answer(token, user, visitor, { text, name, answerKey }) {
  const g = db.prepare('SELECT * FROM x_groups WHERE invite_token = ?').get(token);
  if (!g) return { error: 'not_found' };
  if (isOwner(g, user, visitor)) return { error: 'exchange_own' };
  const key = clean(answerKey, 64);
  const ex = memberOf(g, user, visitor) || (key && db.prepare('SELECT * FROM x_group_members WHERE group_id = ? AND answer_key = ?').get(g.id, key));
  if (ex) return { ok: true, repeated: true, g, m: ex };
  if (db.prepare('SELECT COUNT(*) AS n FROM x_group_members WHERE group_id = ?').get(g.id).n >= MAX_MEMBERS) return { error: 'group_full' };
  const t = clean(text, 300); if (!t) return { error: 'text_required' };
  const info = db.prepare('INSERT INTO x_group_members (group_id, user_id, visitor, name, text, secret, answer_key) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(g.id, user ? user.id : null, visitor || null, nameOf(user && user.id, clean(name, 40)) || '', t, tok(), key || null);
  db.prepare(`UPDATE x_groups SET updated_at = ${NOW} WHERE id = ?`).run(g.id);
  const m = db.prepare('SELECT * FROM x_group_members WHERE id = ?').get(Number(info.lastInsertRowid));
  // разговор с этой картой состоялся — один раз на общий обмен
  talk.record(`xg:${g.id}`, db.prepare('SELECT * FROM cards WHERE id = ?').get(g.card_id), { source: 'exchange', chooserId: g.a_user_id, demo: !!g.is_demo });
  bell.add(g.a_user_id ? { userId: g.a_user_id } : { visitorId: g.a_visitor }, { kind: 'exchange_answered', title: 'Новый ответ на карту',
    body: `${m.name || 'Участник'} ответил(а) в общем обмене`, url: `/x/${g.a_secret}`, group: `xg:${g.id}`, isDemo: !!g.is_demo });
  return { ok: true, g, m };
}

function mine(user, visitor) {
  const out = [];
  const own = db.prepare('SELECT g.*, k.code FROM x_groups g JOIN cards k ON k.id = g.card_id WHERE (a_user_id IS NOT NULL AND a_user_id = ?) OR (a_visitor IS NOT NULL AND a_visitor = ?) ORDER BY g.updated_at DESC LIMIT 100').all(user ? user.id : -1, visitor || '');
  for (const g of own) { const n = db.prepare('SELECT COUNT(*) AS n FROM x_group_members WHERE group_id = ?').get(g.id).n; out.push({ kind: 'group', id: g.id, role: 'owner', code: g.code, thumb: publicCard(db.prepare('SELECT * FROM cards WHERE id = ?').get(g.card_id)).thumb, answered: n > 0, count: n, createdAt: g.created_at, secret: g.a_secret }); }
  const mem = db.prepare('SELECT m.*, g.card_id, g.a_name, k.code FROM x_group_members m JOIN x_groups g ON g.id = m.group_id JOIN cards k ON k.id = g.card_id WHERE (m.user_id IS NOT NULL AND m.user_id = ?) OR (m.visitor IS NOT NULL AND m.visitor = ?) ORDER BY m.answered_at DESC LIMIT 100').all(user ? user.id : -1, visitor || '');
  for (const m of mem) { const n = db.prepare('SELECT COUNT(*) AS n FROM x_group_members WHERE group_id = ?').get(m.group_id).n; out.push({ kind: 'group', id: m.group_id, role: 'member', code: m.code, thumb: publicCard(db.prepare('SELECT * FROM cards WHERE id = ?').get(m.card_id)).thumb, answered: true, count: n, otherName: m.a_name, createdAt: m.answered_at, secret: m.secret }); }
  return out;
}
/** Вход гостя: общие обмены этого браузера переходят в аккаунт с той же ролью. */
function claim(visitor, userId) {
  if (!visitor) return 0;
  return db.prepare('UPDATE x_groups SET a_user_id = ? WHERE a_visitor = ? AND a_user_id IS NULL').run(userId, visitor).changes
    + db.prepare('UPDATE x_group_members SET user_id = ? WHERE visitor = ? AND user_id IS NULL').run(userId, visitor).changes;
}
const cardCodeOf = (token) => { const g = db.prepare('SELECT g.card_id, g.question FROM x_groups g WHERE invite_token = ? OR a_secret = ?').get(token, token) || (db.prepare('SELECT g.card_id, g.question FROM x_group_members m JOIN x_groups g ON g.id = m.group_id WHERE m.secret = ?').get(token)); return g || null; };

module.exports = { create, resolve, view, answer, mine, claim, cardCodeOf, DEFAULT_QUESTION };
