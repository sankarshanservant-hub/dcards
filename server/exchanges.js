// Обмен с другом «Что ты здесь видишь?» (18.11.2026).
// Три разных вида доступа, чтобы ссылка с правами одного не попала другому:
//   a_secret / b_secret — личный доступ участника («Вернуться к обмену»): открывает его обмен из любого браузера;
//   invite_token — приглашение для Б: до ответа показывает карту и вопрос (без ответа А), после ответа узнаёт только
//                  самого Б (тот же браузер или аккаунт); посторонний по пересланной ссылке видит «приглашение использовано»;
//   a_door — ссылка «вернуться к А» для предложения сторис от Б: узнаёт только А.
// Публичная ссылка на карту (/play/<код>) начинает новый обмен и к этому не относится.
// Право видеть ответы и подтверждать сторис проверяет сервер; до ответа Б сервер не отдаёт ему текст А.
const { demoWhere } = require('./demo-scope');
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
CREATE TABLE IF NOT EXISTS x_events (          -- аналитика обмена без имён, текстов и контактов (19.11.2026)
  exchange_id INTEGER NOT NULL REFERENCES exchanges(id), kind TEXT NOT NULL, via TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY (exchange_id, kind)
);
CREATE UNIQUE INDEX IF NOT EXISTS x_client_key ON exchanges(a_visitor, client_key) WHERE client_key IS NOT NULL;`);

// Разговор из раундов (19.11.2026): «Твоя очередь» — следующий раунд с тем же собеседником (conv_id, round_no, parent_id);
// получатель раунда известен (target_*) — приглашение приходит ему в колокольчик. origin: fresh | reply | forward | public.
const addCol = (c, def) => { if (!db.prepare('PRAGMA table_info(exchanges)').all().some((x) => x.name === c)) db.exec(`ALTER TABLE exchanges ADD COLUMN ${c} ${def}`); };
addCol('conv_id', 'INTEGER'); addCol('round_no', 'INTEGER NOT NULL DEFAULT 1'); addCol('parent_id', 'INTEGER');
addCol('origin', "TEXT NOT NULL DEFAULT 'fresh'"); addCol('source_ex', 'INTEGER');
addCol('target_user_id', 'INTEGER'); addCol('target_visitor', 'TEXT');
// Вопрос другу (20.11.2026): отправитель может изменить стандартный вопрос; хранится у конкретного обмена.
// Пустой или из пробелов — стандартная формулировка; у прежних обменов (question IS NULL) — тоже стандартная.
addCol('question', 'TEXT');
// фрагменты длинных ответов для сторис (21.11.2026): выбирает предложивший, согласие относится именно к ним
addCol('story_frag', 'TEXT');
const DEFAULT_QUESTION = 'Что тебе откликается в этой карте?';
const questionOf = (x) => (x && x.question) || DEFAULT_QUESTION;
const tok = () => crypto.randomBytes(18).toString('base64url');
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
// Пробелы и переводы строк — в один пробел, прочие управляющие символы убираются.
const clean = (t, n) => String(t || '').replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, n);
const nameOf = (userId, typed, fallback) => {
  if (userId) { const u = db.prepare('SELECT name, public_name FROM users WHERE id = ?').get(userId); if (u) return u.public_name || u.name; }
  return typed || fallback;
};
const same = (x, side, user, visitor) => (user && x[`${side}_user_id`] === user.id) || (visitor && x[`${side}_visitor`] === visitor);
/** Макет сторис: что именно увидят люди. Любое изменение — новый отпечаток и новые согласия. */
function storyHash(x, frag = fragOf(x)) {
  const c = db.prepare('SELECT code, image_full, author FROM cards WHERE id = ?').get(x.card_id);
  return crypto.createHash('sha256').update(JSON.stringify(['v2', c.code, c.image_full, c.author, x.a_name, frag.a, x.b_name, frag.b])).digest('hex').slice(0, 16);
}
/** Что из ответов попадёт в сторис: целиком или выбранный фрагмент (только подстрока самого ответа). */
function fragOf(x) { let f = {}; try { f = JSON.parse(x.story_frag || '{}') || {}; } catch { /* */ } return { a: validFrag(x.a_text, f.a), b: validFrag(x.b_text, f.b) }; }
function validFrag(full, f) { const t = String(full || ''); const s = String(f || '').trim(); return s && s.length >= 3 && s.length <= 220 && t.includes(s) ? s : t; }

function create(card, user, visitor, { text, name, question, clientKey, origin = 'fresh', parent = null, sourceEx = null }) {
  const t = clean(text, 300); if (!t) return { error: 'text_required' };
  if (!user && !visitor) return { error: 'visitor_required' };
  const key = clientKey ? clean(clientKey, 64).replace(/[^A-Za-z0-9_-]/g, '') : null;
  if (key) {
    const ex = db.prepare('SELECT * FROM exchanges WHERE a_visitor IS ? AND client_key = ?').get(visitor || null, key);
    if (ex) return { ok: true, repeated: true, ...links(ex, 'a') };
  }
  // кто прислал этот обмен раньше: если создатель — ответивший в другом обмене, отмечаем источник (для аналитики «дальше»)
  const src = sourceEx || (db.prepare(`SELECT id FROM exchanges WHERE b_answered_at IS NOT NULL AND ((b_user_id IS NOT NULL AND b_user_id = ?) OR (b_visitor IS NOT NULL AND b_visitor = ?)) ORDER BY b_answered_at DESC LIMIT 1`).get(user ? user.id : -1, visitor || '') || {}).id || null;
  const q = clean(question, 200); // пусто — стандартный вопрос
  const info = db.prepare(`INSERT INTO exchanges (card_id, a_user_id, a_visitor, a_name, a_text, a_secret, a_door, invite_token, client_key, is_demo, origin, source_ex, conv_id, round_no, parent_id, target_user_id, target_visitor, question)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(card.id, user ? user.id : null, visitor || null, nameOf(user && user.id, clean(name, 40), ''), t, tok(), tok(), tok(), key, (card.is_demo || (user && user.is_demo)) ? 1 : 0,
      origin, src, parent ? parent.conv : null, parent ? parent.round : 1, parent ? parent.id : null, parent ? parent.targetUser : null, parent ? parent.targetVisitor : null, q && q !== DEFAULT_QUESTION ? q : null);
  const id = Number(info.lastInsertRowid);
  if (!parent) db.prepare('UPDATE exchanges SET conv_id = ? WHERE id = ?').run(id, id);
  return { ok: true, ...links(db.prepare('SELECT * FROM exchanges WHERE id = ?').get(id), 'a') };
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
  const base = { id: x.id, role, card, answered: !!x.b_answered_at, createdAt: x.created_at, answeredAt: x.b_answered_at, round: x.round_no || 1, question: questionOf(x) };
  if (role === 'invitee') return { ...base, fromName: aName };
  if (role === 'stranger') return { ...base, used: true }; // ничего личного: ни имён, ни ответов
  const me = role; const other = role === 'a' ? 'b' : 'a';
  const out = { ...base, myName: me === 'a' ? aName : bName, otherName: me === 'a' ? (x.b_answered_at ? bName : null) : aName,
    myText: x[`${me}_text`], secret: x[`${me}_secret`] };
  if (me === 'a') out.invite = x.invite_token;
  // раунды этого разговора, видимые участнику (только свои ссылки)
  out.rounds = db.prepare('SELECT * FROM exchanges WHERE conv_id = ? ORDER BY round_no, id').all(x.conv_id || x.id).map((y) => {
    const side = sideOf(y, x, me); return side ? { id: y.id, round: y.round_no, answered: !!y.b_answered_at, current: y.id === x.id, secret: y[`${side}_secret`] || null, invite: side === 'a' && !y.b_answered_at ? y.invite_token : null, mine: side === 'a' } : null;
  }).filter(Boolean);
  if (x.b_answered_at) {
    out.otherText = x[`${other}_text`];
    const h = storyHash(x);
    const st = (v) => (v === 'declined' ? 'declined' : v === `agreed:${h}` ? 'agreed' : null);
    const fr = fragOf(x);
    out.story = { hash: h, frag: { mine: fr[me], other: fr[other] }, proposedBy: x.story_hash === h && x.story_proposed_by ? (x.story_proposed_by === me ? 'me' : 'other') : null,
      me: st(x[`story_${me}`]), other: st(x[`story_${other}`]),
      // ссылка, по которой другой участник вернётся к этому макету (узнаёт только его)
      otherDoor: me === 'a' ? x.invite_token : x.a_door };
    out.story.ready = out.story.me === 'agreed' && out.story.other === 'agreed';
  }
  return out;
}

/** Чья сторона в раунде y у человека, который в раунде x — сторона me (собеседники в разговоре меняются ролями). */
function sideOf(y, x, me) {
  const uid = x[`${me}_user_id`]; const vid = x[`${me}_visitor`];
  const is = (side) => (uid && y[`${side}_user_id`] === uid) || (vid && y[`${side}_visitor`] === vid);
  if (is('a')) return 'a';
  if (is('b') && y.b_answered_at) return 'b';
  if ((uid && y.target_user_id === uid) || (vid && y.target_visitor === vid)) return 'target';
  return null;
}

/** «Твоя очередь»: участник раунда отвечает своей картой тому же собеседнику — новый раунд того же разговора. */
function reply(token, user, visitor, card, { text, name, question, clientKey }) {
  const { x, role } = resolve(token, user, visitor);
  if (!x) return { error: 'not_found' };
  if (!['a', 'b'].includes(role) || !x.b_answered_at) return { error: 'forbidden' };
  const other = role === 'a' ? 'b' : 'a';
  const r = create(card, user || (x[`${role}_user_id`] ? { id: x[`${role}_user_id`], is_demo: 0 } : null), visitor || x[`${role}_visitor`], {
    text, name: name || x[`${role}_name`], question, clientKey, origin: 'reply', sourceEx: x.id,
    parent: { id: x.id, conv: x.conv_id || x.id, round: (db.prepare('SELECT MAX(round_no) AS n FROM exchanges WHERE conv_id = ?').get(x.conv_id || x.id).n || 1) + 1,
      targetUser: x[`${other}_user_id`] || null, targetVisitor: x[`${other}_user_id`] ? null : x[`${other}_visitor`] } });
  if (r.error || r.repeated) return r;
  const y = db.prepare('SELECT * FROM exchanges WHERE id = ?').get(r.id);
  const who = x[`${role}_name`] || 'Собеседник';
  bell.add(y.target_user_id ? { userId: y.target_user_id } : { visitorId: y.target_visitor }, { kind: 'exchange_round', title: 'Тебе прислали ответную карту',
    body: `${who}: ${questionOf(y).replace(/^./, (ch) => ch.toLowerCase())}`, url: `/x/${y.invite_token}`, dedupe: `x:${y.id}:round`, isDemo: !!y.is_demo });
  return r;
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
  event(x.id, 'answered');
  // один подтверждённый выбор: карту выбрал А, разговор состоялся, когда ответил Б
  talk.record(`x:${x.id}`, db.prepare('SELECT * FROM cards WHERE id = ?').get(x.card_id), { source: 'exchange', chooserId: x.a_user_id, demo: !!x.is_demo });
  bell.add(x.a_user_id ? { userId: x.a_user_id } : { visitorId: x.a_visitor }, { kind: 'exchange_answered', title: 'Друг ответил на карту',
    body: `${x.b_name || 'Друг'} написал(а), что видит в карте`, url: `/x/${x.a_secret}`, dedupe: `x:${x.id}:answered`, isDemo: !!x.is_demo });
  return { ok: true, ...links(x, 'b') };
}

/** Сторис: предложить (= согласиться на этот макет), согласиться, отказаться. */
function story(token, user, visitor, { action, hash, frag }) {
  const { x, role } = resolve(token, user, visitor);
  if (!x) return { error: 'not_found' };
  if (!['a', 'b'].includes(role) || !x.b_answered_at) return { error: 'forbidden' };
  // предложение может выбрать фрагменты длинных ответов — это новый макет со своим отпечатком
  if (action === 'propose' && frag && typeof frag === 'object') {
    const f = { a: validFrag(x.a_text, frag.a), b: validFrag(x.b_text, frag.b) };
    const nf = JSON.stringify({ a: f.a === x.a_text ? null : f.a, b: f.b === x.b_text ? null : f.b });
    if (nf !== (x.story_frag || JSON.stringify({ a: null, b: null }))) { db.prepare('UPDATE exchanges SET story_frag = ? WHERE id = ?').run(nf, x.id); x.story_frag = nf; }
    hash = storyHash(x);
  }
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
        bell.add(target(other), { kind: 'story_proposed', title: 'Тебе предложили поделиться ответами в сторис', body: 'Посмотри макет и реши', url: `/x/${y[`${other}_secret`]}/story`, dedupe: `x:${x.id}:story:${h}:to:${other}`, isDemo: !!x.is_demo });
      } else if (y[`story_${other}`] === `agreed:${h}`) {
        bell.add(target(other), { kind: 'story_agreed', title: 'Друг согласился поделиться в сторис', body: 'Можно сохранить картинку для сторис', url: `/x/${y[`${other}_secret`]}/story`, dedupe: `x:${x.id}:story:${h}:agreed:${me}`, isDemo: !!x.is_demo });
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
    return { id: x.id, role, code: x.code, thumb: v.card.thumb, answered: v.answered, otherName: v.otherName, createdAt: x.created_at, answeredAt: x.b_answered_at, conv: x.conv_id || x.id, round: x.round_no || 1,
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

// ---------- аналитика (без имён, текстов и контактов) ----------
function event(exchangeId, kind, via = null) { db.prepare('INSERT OR IGNORE INTO x_events (exchange_id, kind, via) VALUES (?, ?, ?)').run(exchangeId, kind, via); }
const BOT = /bot|crawler|spider|preview|facebookexternalhit|whatsapp|telegram|slack|discord|vkshare|skype|embedly|curl|wget|python|headless/i;
/** Первое открытие приглашения человеком: не автоматическое превью, не сам отправитель, только раз. */
function opened(x, role, ua) { if (role === 'invitee' && !BOT.test(String(ua || ''))) event(x.id, 'opened'); }
/** Отправитель воспользовался отправкой или копированием (не доказательство доставки; отменённое меню не пишем). */
function sent(token, user, visitor, via) {
  const { x, role } = resolve(token, user, visitor);
  if (!x || role !== 'a') return { error: 'forbidden' };
  event(x.id, 'sent', ['tg', 'wa', 'sys', 'copy', 'chat'].includes(via) ? via : 'other');
  return { ok: true };
}
/** Отчёт по этапам за период. Личные и (будущие) групповые ссылки — раздельно; знаменатели показаны явно. */
function stats(days = 30, showDemo = false) {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const demo = ` AND ${demoWhere(showDemo, 'x.is_demo')}`;
  const q = (sql, ...a) => db.prepare(sql).get(since, ...a).n;
  const created = (origin) => q(`SELECT COUNT(*) AS n FROM exchanges x WHERE x.created_at >= ?${demo}${origin ? ` AND x.origin = '${origin}'` : ''}`);
  const withEv = (kind, origin) => q(`SELECT COUNT(*) AS n FROM exchanges x JOIN x_events e ON e.exchange_id = x.id AND e.kind = '${kind}' WHERE x.created_at >= ?${demo}${origin ? ` AND x.origin = '${origin}'` : ''}`);
  const by = (origin) => ({ created: created(origin), sent: withEv('sent', origin), opened: withEv('opened', origin), answered: withEv('answered', origin) });
  // 4: уникальные ответившие, которые затем сами воспользовались отправкой нового приглашения (ответ следующего не нужен)
  const responders = db.prepare(`SELECT DISTINCT COALESCE('u' || x.b_user_id, 'v' || x.b_visitor) AS who, MIN(x.b_answered_at) AS at, x.b_user_id AS uid, x.b_visitor AS vid FROM exchanges x
    WHERE x.b_answered_at >= ?${demo} GROUP BY who`).all(since);
  const onward = (origins) => responders.filter((r) => db.prepare(`SELECT 1 FROM exchanges y JOIN x_events e ON e.exchange_id = y.id AND e.kind = 'sent'
    WHERE y.created_at > ? AND y.origin IN (${origins.map(() => '?').join(',')}) AND ((? IS NOT NULL AND y.a_user_id = ?) OR (? IS NOT NULL AND y.a_visitor = ?)) LIMIT 1`).get(r.at, ...origins, r.uid, r.uid, r.vid, r.vid)).length;
  return { days, since, personal: { all: by(null), fresh: by('fresh'), reply: by('reply'), forward: by('forward'), public: by('public') },
    responders: responders.length, onwardAny: onward(['fresh', 'reply', 'forward', 'public']), onwardReply: onward(['reply']), onwardNew: onward(['fresh', 'forward', 'public']),
    note: 'Гость между устройствами — разные люди для счёта; новый обмен не доказывает нового уникального человека.' };
}

module.exports = { create, resolve, view, answer, story, mine, claim, storyHash, reply, opened, sent, stats, event, questionOf, DEFAULT_QUESTION };
