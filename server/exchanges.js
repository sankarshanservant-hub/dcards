// Обмен с другом «Что ты здесь видишь?» (18.11.2026).
// Три разных вида доступа, чтобы ссылка с правами одного не попала другому:
//   a_secret / b_secret — личный доступ участника («Вернуться к обмену»): открывает его обмен из любого браузера;
//   invite_token — приглашение для Б: до ответа показывает карту и вопрос (без ответа А), после ответа узнаёт только
//                  самого Б (тот же браузер или аккаунт); посторонний по пересланной ссылке видит «приглашение использовано»;
//   a_door — ссылка «вернуться к А» для предложения сторис от Б: узнаёт только А.
// Публичная ссылка на карту (/play/<код>) начинает новый обмен и к этому не относится.
// Право видеть ответы и подтверждать сторис проверяет сервер; до ответа Б сервер не отдаёт ему текст А.
const crypto = require('crypto');
const db = require('./db');
const { publicCard } = require('./cards');
const talk = require('./talk');
const bell = require('./bell');

db.exec(`CREATE TABLE IF NOT EXISTS exchanges (
  id INTEGER PRIMARY KEY, card_id INTEGER NOT NULL REFERENCES cards(id),
  a_user_id INTEGER REFERENCES users(id), a_visitor TEXT, a_name TEXT NOT NULL DEFAULT '', a_text TEXT NOT NULL,
  a_secret TEXT NOT NULL UNIQUE, a_door TEXT NOT NULL UNIQUE, invite_token TEXT NOT NULL UNIQUE, client_key TEXT,
  b_user_id INTEGER REFERENCES users(id), b_visitor TEXT, b_name TEXT NOT NULL DEFAULT '', b_text TEXT, b_secret TEXT UNIQUE, b_answer_key TEXT, b_answered_at TEXT,
  story_proposed_by TEXT, story_hash TEXT, story_a TEXT, story_b TEXT,      -- 'agreed:<hash>' | 'declined'
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_x_card ON exchanges(card_id);
CREATE UNIQUE INDEX IF NOT EXISTS x_client_key ON exchanges(a_visitor, client_key) WHERE client_key IS NOT NULL;`);

const tok = () => crypto.randomBytes(18).toString('base64url');
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const clean = (t, n) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n);
const nameOf = (userId, typed, fallback) => {
  if (userId) { const u = db.prepare('SELECT name, public_name FROM users WHERE id = ?').get(userId); if (u) return u.public_name || u.name; }
  return typed || fallback;
};
const same = (x, side, user, visitor) => (user && x[`${side}_user_id`] === user.id) || (visitor && x[`${side}_visitor`] === visitor);
/** Макет сторис: что именно увидят люди. Любое изменение — новый отпечаток и новые согласия. */
function storyHash(x) {
  const c = db.prepare('SELECT code, image_full, author FROM cards WHERE id = ?').get(x.card_id);
  return crypto.createHash('sha256').update(JSON.stringify([c.code, c.image_full, c.author, x.a_name, x.a_text, x.b_name, x.b_text])).digest('hex').slice(0, 16);
}

function create(card, user, visitor, { text, name, clientKey }) {
  const t = clean(text, 300); if (!t) return { error: 'text_required' };
  if (!user && !visitor) return { error: 'visitor_required' };
  const key = clientKey ? clean(clientKey, 64).replace(/[^A-Za-z0-9_-]/g, '') : null;
  if (key) {
    const ex = db.prepare('SELECT * FROM exchanges WHERE a_visitor IS ? AND client_key = ?').get(visitor || null, key);
    if (ex) return { ok: true, repeated: true, ...links(ex, 'a') };
  }
  const info = db.prepare(`INSERT INTO exchanges (card_id, a_user_id, a_visitor, a_name, a_text, a_secret, a_door, invite_token, client_key, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(card.id, user ? user.id : null, visitor || null, nameOf(user && user.id, clean(name, 40), ''), t, tok(), tok(), tok(), key, (card.is_demo || (user && user.is_demo)) ? 1 : 0);
  return { ok: true, ...links(db.prepare('SELECT * FROM exchanges WHERE id = ?').get(Number(info.lastInsertRowid)), 'a') };
}
function links(x, role) {
  return role === 'a' ? { id: x.id, secret: x.a_secret, invite: x.invite_token } : { id: x.id, secret: x.b_secret, door: x.a_door };
}

/** Кто открыл ссылку и что ему показать. */
function resolve(token, user, visitor) {
  const x = db.prepare('SELECT * FROM exchanges WHERE a_secret = ? OR b_secret = ? OR invite_token = ? OR a_door = ?').get(token, token, token, token);
  if (!x) return { x: null };
  if (x.a_secret === token) return { x, role: 'a' };
  if (x.b_secret === token) return { x, role: 'b' };
  if (same(x, 'a', user, visitor)) return { x, role: 'a' };
  if (x.b_answered_at && same(x, 'b', user, visitor)) return { x, role: 'b' };
  if (x.invite_token === token && !x.b_answered_at) return { x, role: 'invitee' };
  return { x, role: 'stranger' };
}

function view(x, role) {
  const card = publicCard(db.prepare('SELECT * FROM cards WHERE id = ?').get(x.card_id), { withDetails: true });
  const aName = x.a_name || 'Друг'; const bName = x.b_name || 'Друг';
  const base = { id: x.id, role, card, answered: !!x.b_answered_at, createdAt: x.created_at, answeredAt: x.b_answered_at };
  if (role === 'invitee') return { ...base, fromName: aName };
  if (role === 'stranger') return { ...base, used: true }; // ничего личного: ни имён, ни ответов
  const me = role; const other = role === 'a' ? 'b' : 'a';
  const out = { ...base, myName: me === 'a' ? aName : bName, otherName: me === 'a' ? (x.b_answered_at ? bName : null) : aName,
    myText: x[`${me}_text`], secret: x[`${me}_secret`] };
  if (me === 'a') out.invite = x.invite_token;
  if (x.b_answered_at) {
    out.otherText = x[`${other}_text`];
    const h = storyHash(x);
    const st = (v) => (v === 'declined' ? 'declined' : v === `agreed:${h}` ? 'agreed' : null);
    out.story = { hash: h, proposedBy: x.story_hash === h && x.story_proposed_by ? (x.story_proposed_by === me ? 'me' : 'other') : null,
      me: st(x[`story_${me}`]), other: st(x[`story_${other}`]),
      // ссылка, по которой другой участник вернётся к этому макету (узнаёт только его)
      otherDoor: me === 'a' ? x.invite_token : x.a_door };
    out.story.ready = out.story.me === 'agreed' && out.story.other === 'agreed';
  }
  return out;
}

function answer(token, user, visitor, { text, name, answerKey }) {
  const x0 = db.prepare('SELECT * FROM exchanges WHERE invite_token = ?').get(token);
  if (!x0) return { error: 'not_found' };
  if (same(x0, 'a', user, visitor)) return { error: 'exchange_own' };
  const key = clean(answerKey, 64);
  if (x0.b_answered_at) {
    // повтор той же отправки (обрыв сети, двойное нажатие) — без второй записи
    if ((key && x0.b_answer_key === key) || same(x0, 'b', user, visitor)) return { ok: true, repeated: true, ...links(x0, 'b') };
    return { error: 'exchange_taken' };
  }
  const t = clean(text, 300); if (!t) return { error: 'text_required' };
  const r = db.prepare(`UPDATE exchanges SET b_user_id = ?, b_visitor = ?, b_name = ?, b_text = ?, b_secret = ?, b_answer_key = ?, b_answered_at = ${NOW}, updated_at = ${NOW}
    WHERE id = ? AND b_answered_at IS NULL`).run(user ? user.id : null, visitor || null, nameOf(user && user.id, clean(name, 40), ''), t, tok(), key || null, x0.id);
  if (!r.changes) return answer(token, user, visitor, { text, name, answerKey }); // кто-то успел раньше — разберём заново
  const x = db.prepare('SELECT * FROM exchanges WHERE id = ?').get(x0.id);
  // один подтверждённый выбор: карту выбрал А, разговор состоялся, когда ответил Б
  talk.record(`x:${x.id}`, db.prepare('SELECT * FROM cards WHERE id = ?').get(x.card_id), { source: 'exchange', chooserId: x.a_user_id, demo: !!x.is_demo });
  bell.add(x.a_user_id ? { userId: x.a_user_id } : { visitorId: x.a_visitor }, { kind: 'exchange_answered', title: 'Друг ответил на карту',
    body: `${x.b_name || 'Друг'} написал(а), что видит в карте`, url: `/x/${x.a_secret}`, dedupe: `x:${x.id}:answered`, isDemo: !!x.is_demo });
  return { ok: true, ...links(x, 'b') };
}

/** Сторис: предложить (= согласиться на этот макет), согласиться, отказаться. */
function story(token, user, visitor, { action, hash }) {
  const { x, role } = resolve(token, user, visitor);
  if (!x) return { error: 'not_found' };
  if (!['a', 'b'].includes(role) || !x.b_answered_at) return { error: 'forbidden' };
  const h = storyHash(x);
  if (hash !== h) return { error: 'story_changed' }; // человек соглашался на другой макет
  const me = role; const other = role === 'a' ? 'b' : 'a';
  const target = (side) => (x[`${side}_user_id`] ? { userId: x[`${side}_user_id`] } : { visitorId: x[`${side}_visitor`] });
  if (action === 'propose' || action === 'agree') {
    const wasAgreed = x[`story_${me}`] === `agreed:${h}`;
    const fresh = x.story_hash !== h;
    db.prepare(`UPDATE exchanges SET story_${me} = ?, story_hash = ?, story_proposed_by = ?, updated_at = ${NOW} WHERE id = ?`)
      .run(`agreed:${h}`, h, fresh || !x.story_proposed_by ? me : x.story_proposed_by, x.id);
    const y = db.prepare('SELECT * FROM exchanges WHERE id = ?').get(x.id);
    if (!wasAgreed) {
      if (y.story_proposed_by === me && y[`story_${other}`] !== `agreed:${h}`) {
        bell.add(target(other), { kind: 'story_proposed', title: 'Тебе предложили поделиться ответами в сторис', body: 'Посмотри макет и реши', url: `/x/${y[`${other}_secret`]}?story=1`, dedupe: `x:${x.id}:story:${h}:to:${other}`, isDemo: !!x.is_demo });
      } else if (y[`story_${other}`] === `agreed:${h}`) {
        bell.add(target(other), { kind: 'story_agreed', title: 'Друг согласился поделиться в сторис', body: 'Можно сохранить картинку для сторис', url: `/x/${y[`${other}_secret`]}?story=1`, dedupe: `x:${x.id}:story:${h}:agreed:${me}`, isDemo: !!x.is_demo });
      }
    }
  } else if (action === 'decline') {
    db.prepare(`UPDATE exchanges SET story_${me} = 'declined', updated_at = ${NOW} WHERE id = ?`).run(x.id); // без напоминаний и уведомлений
  } else return { error: 'bad_action' };
  return { ok: true, exchange: view(db.prepare('SELECT * FROM exchanges WHERE id = ?').get(x.id), role) };
}

/** Мои обмены (как А и как Б): аккаунт и/или этот браузер. card — фильтр по коду карты. */
function mine(user, visitor, cardCode = null) {
  const cond = []; const args = [];
  if (user) { cond.push('a_user_id = ?', 'b_user_id = ?'); args.push(user.id, user.id); }
  if (visitor) { cond.push('a_visitor = ?', '(b_visitor = ? AND b_answered_at IS NOT NULL)'); args.push(visitor, visitor); }
  if (!cond.length) return [];
  let q = `SELECT x.*, k.code FROM exchanges x JOIN cards k ON k.id = x.card_id WHERE (${cond.join(' OR ')})`;
  if (cardCode) { q += ' AND k.code = ?'; args.push(cardCode); }
  return db.prepare(q + ' ORDER BY x.updated_at DESC LIMIT 200').all(...args).map((x) => {
    const role = same(x, 'a', user, visitor) ? 'a' : 'b';
    const v = view(x, role);
    return { id: x.id, role, code: x.code, thumb: v.card.thumb, answered: v.answered, otherName: v.otherName, createdAt: x.created_at, answeredAt: x.b_answered_at,
      secret: v.secret, storyReady: !!(v.story && v.story.ready), storyAsk: !!(v.story && v.story.proposedBy === 'other' && !v.story.me) };
  });
}
/** Вход гостя: обмены этого браузера переходят в аккаунт. */
function claim(visitor, userId) {
  if (!visitor) return 0;
  const a = db.prepare('UPDATE exchanges SET a_user_id = ? WHERE a_visitor = ? AND a_user_id IS NULL').run(userId, visitor).changes;
  const b = db.prepare('UPDATE exchanges SET b_user_id = ? WHERE b_visitor = ? AND b_user_id IS NULL AND b_answered_at IS NOT NULL').run(userId, visitor).changes;
  return a + b;
}

module.exports = { create, resolve, view, answer, story, mine, claim, storyHash };
