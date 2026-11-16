// Встреча Dialogue Flow по телефонам (без физической колоды), по главе 5 «Руководства фасилитатора».
// Фасилитатор открывает встречу по своей подборке; участники заходят по тому же QR (/s/<slug>) и вводят имя.
// Раунд: группа делится пополам — «держатели карт» выбирают карты (одну карту могут выбрать несколько человек),
// затем «собеседники» выбирают из выбранных карт; выбранная собеседником карта сразу становится недоступной другим.
// Пара — держатель и собеседник одной карты; у пары общий знак (две цветные фигуры и номер), по нему находят друг друга.
// Во втором раунде роли меняются. Завершение встречи освобождает QR для новой группы.
const db = require('./db');
const { EventEmitter } = require('events');
const choices = require('./choices');

db.exec(`
CREATE TABLE IF NOT EXISTS live_sessions (
  id INTEGER PRIMARY KEY, collection_id INTEGER NOT NULL REFERENCES collections(id), facilitator_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'lobby',            -- lobby | holders | listeners | pairs | talk | break | ended
  round INTEGER NOT NULL DEFAULT 0, round_minutes INTEGER NOT NULL DEFAULT 30,
  talk_started_at TEXT, talk_ends_at TEXT, recall_at TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), ended_at TEXT
);
CREATE TABLE IF NOT EXISTS live_members (
  id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES live_sessions(id), device_id TEXT NOT NULL, name TEXT NOT NULL,
  is_facilitator INTEGER NOT NULL DEFAULT 0, user_id INTEGER,
  joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), removed_at TEXT,
  UNIQUE (session_id, device_id)
);
CREATE TABLE IF NOT EXISTS live_roles (
  session_id INTEGER NOT NULL, round INTEGER NOT NULL, member_id INTEGER NOT NULL, role TEXT NOT NULL, -- holder | listener
  PRIMARY KEY (session_id, round, member_id)
);
CREATE TABLE IF NOT EXISTS live_slots (
  id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL, round INTEGER NOT NULL, holder_id INTEGER NOT NULL, card_code TEXT NOT NULL,
  sign INTEGER NOT NULL, listener_id INTEGER, extra_listener_id INTEGER,
  UNIQUE (session_id, round, holder_id)
);
CREATE TABLE IF NOT EXISTS live_feedback (
  id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL, member_id INTEGER, name TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '', file TEXT, mime TEXT, may_publish INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);`);

try { db.exec('ALTER TABLE live_sessions ADD COLUMN fac_device TEXT'); } catch { /* уже есть */ } // телефон фасилитатора: с него он входит в игру при нечётной группе
const now = () => new Date().toISOString();
const ACTIVE = "status != 'ended'";
const MAX_MEMBERS = 60;

// ---------- события: участники и пульт перечитывают состояние, когда номер версии меняется ----------
const bus = new EventEmitter(); bus.setMaxListeners(0);
const versions = new Map();
function touch(sessionId) { const v = (versions.get(sessionId) || 0) + 1; versions.set(sessionId, v); bus.emit('s' + sessionId, v); }
const version = (id) => versions.get(id) || 0;

// ---------- знаки пар: две фигуры разных цветов + номер (номер и словесное описание — для тех, кто плохо различает цвета) ----------
const COLORS = [ // [цвет, м. р., ж. р., англ.]
  ['#FF3D8B', 'розовый', 'розовая', 'pink'], ['#2F6BFF', 'синий', 'синяя', 'blue'], ['#FFC21A', 'жёлтый', 'жёлтая', 'yellow'], ['#22C55E', 'зелёный', 'зелёная', 'green'],
  ['#FF7A1A', 'оранжевый', 'оранжевая', 'orange'], ['#9B5CFF', 'фиолетовый', 'фиолетовая', 'violet'], ['#14D3C4', 'бирюзовый', 'бирюзовая', 'turquoise'], ['#FF4D4D', 'красный', 'красная', 'red'],
];
const SHAPES = [['circle', 'круг', 'circle'], ['square', 'квадрат', 'square'], ['triangle', 'треугольник', 'triangle'], ['star', 'звезда', 'star', 'f'], ['diamond', 'ромб', 'diamond']];
// Заранее перемешанный список различимых сочетаний: верхняя фигура/цвет, нижняя фигура/цвет (цвета и фигуры у половинок разные).
const SIGNS = (() => {
  const out = [];
  for (let a = 0; a < COLORS.length; a++) for (let b = 0; b < COLORS.length; b++) {
    if (a === b) continue;
    out.push({ top: [(a + b) % SHAPES.length, a], bottom: [(a + 2 * b + 1) % SHAPES.length, b] });
  }
  // разнести похожие: сначала все сочетания с разными верхними цветами
  out.sort((x, y) => ((x.bottom[1] - x.top[1] + 8) % 8) - ((y.bottom[1] - y.top[1] + 8) % 8) || x.top[1] - y.top[1]);
  return out.map((s) => (s.top[0] === s.bottom[0] ? { ...s, bottom: [(s.bottom[0] + 1) % SHAPES.length, s.bottom[1]] } : s));
})();
function signOut(i, n = null) {
  const s = SIGNS[i % SIGNS.length];
  const part = ([sh, c]) => ({ shape: SHAPES[sh][0], color: COLORS[c][0], ru: `${COLORS[c][SHAPES[sh][3] === 'f' ? 2 : 1]} ${SHAPES[sh][1]}`, en: `${COLORS[c][3]} ${SHAPES[sh][2]}` });
  return { n, top: part(s.top), bottom: part(s.bottom) };
}
/** Знак для новой пары: как можно меньше общего с уже выданными в раунде (цвета и фигуры не повторяются, пока хватает). */
function pickSign(used) {
  const parts = (i) => [SIGNS[i].top, SIGNS[i].bottom];
  const score = (i) => {
    if (used.includes(i)) return 1e9;
    let sc = 0;
    for (const u of used) for (const a of parts(i)) for (const b of parts(u)) { if (a[1] === b[1]) sc += 3; if (a[0] === b[0]) sc += 1; if (a[0] === b[0] && a[1] === b[1]) sc += 10; }
    return sc;
  };
  let best = Infinity; let pick = [];
  for (let i = 0; i < SIGNS.length; i++) { const v = score(i); if (v < best) { best = v; pick = [i]; } else if (v === best) pick.push(i); }
  return pick[Math.floor(Math.random() * pick.length)];
}
// Номер пары — порядок карты в раунде (1, 2, 3…), чтобы его было легко назвать вслух.
const pairNo = (slots, slot) => slots.findIndex((x) => x.id === slot.id) + 1;

// ---------- выборка ----------
const S = {
  session: db.prepare('SELECT * FROM live_sessions WHERE id = ?'),
  activeFor: db.prepare(`SELECT * FROM live_sessions WHERE collection_id = ? AND ${ACTIVE} ORDER BY id DESC LIMIT 1`),
  lastFor: db.prepare('SELECT * FROM live_sessions WHERE collection_id = ? ORDER BY id DESC LIMIT 1'),
  members: db.prepare('SELECT * FROM live_members WHERE session_id = ? AND removed_at IS NULL ORDER BY id'),
  member: db.prepare('SELECT * FROM live_members WHERE session_id = ? AND device_id = ?'),
  roles: db.prepare('SELECT * FROM live_roles WHERE session_id = ? AND round = ?'),
  slots: db.prepare('SELECT * FROM live_slots WHERE session_id = ? AND round = ? ORDER BY id'),
};
const colBySlug = db.prepare('SELECT * FROM collections WHERE slug = ?');

/** Встреча закончилась сама, если время раунда вышло: статус «перерыв» (раунд закончен). */
function settle(s) {
  if (s && s.status === 'talk' && s.talk_ends_at && s.talk_ends_at <= now()) {
    db.prepare("UPDATE live_sessions SET status = 'break' WHERE id = ? AND status = 'talk'").run(s.id);
    s = S.session.get(s.id); touch(s.id);
  }
  return s;
}
function roleMap(s) { return new Map(S.roles.all(s.id, s.round).map((r) => [r.member_id, r.role])); }

// ---------- фасилитатор ----------
function start(collectionId, user) {
  const ex = S.activeFor.get(collectionId);
  if (ex) return { ok: true, id: ex.id, existing: true };
  const col = db.prepare('SELECT * FROM collections WHERE id = ?').get(collectionId);
  if (!col) return { error: 'not_found' };
  const info = db.prepare('INSERT INTO live_sessions (collection_id, facilitator_id, is_demo) VALUES (?, ?, ?)').run(collectionId, user.id, user.is_demo || col.is_demo ? 1 : 0);
  return { ok: true, id: Number(info.lastInsertRowid) };
}
const forFacilitator = (id, user, isAdmin) => { const s = settle(S.session.get(id)); if (!s || (!isAdmin && s.facilitator_id !== user.id)) return null; return s; };

/** Полное состояние для пульта фасилитатора: участники, роли, пары с именами. */
function panel(s) {
  const members = S.members.all(s.id);
  const roles = roleMap(s);
  const slots = S.slots.all(s.id, s.round);
  const name = (id) => (members.find((m) => m.id === id) || {}).name || '—';
  const col = db.prepare('SELECT slug, title FROM collections WHERE id = ?').get(s.collection_id);
  return {
    id: s.id, slug: col.slug, title: col.title, status: s.status, round: s.round, roundMinutes: s.round_minutes,
    talkEndsAt: s.talk_ends_at, recallAt: s.recall_at, serverNow: now(), createdAt: s.created_at, endedAt: s.ended_at, isDemo: !!s.is_demo, version: version(s.id),
    members: members.filter((m) => !m.is_facilitator).map((m) => ({ id: m.id, name: m.name, role: roles.get(m.id) || null, joinedAt: m.joined_at })),
    facRole: (() => { const f = members.find((m) => m.is_facilitator); return f ? roles.get(f.id) || null : null; })(),
    pairs: slots.map((x, i) => ({ slotId: x.id, sign: signOut(x.sign, i + 1), card: x.card_code, holder: name(x.holder_id), listeners: [x.listener_id, x.extra_listener_id].filter(Boolean).map(name) })),
    progress: {
      holders: [...roles.values()].filter((r) => r === 'holder').length, holdersDone: slots.length,
      listeners: [...roles.values()].filter((r) => r === 'listener').length, listenersDone: slots.reduce((n, x) => n + (x.listener_id ? 1 : 0) + (x.extra_listener_id ? 1 : 0), 0),
    },
    feedback: feedbackList(s.id),
  };
}

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** Новый раунд: половина — держатели карт. Со второго раунда роли меняются: прежние собеседники становятся держателями. */
const startRound = db.transaction((s) => {
  if (!['lobby', 'break'].includes(s.status)) return { error: 'live_bad_state' };
  // Перед каждым раундом группа пересчитывается: опоздавшие входят, ушедшие выходят. Нечётное число — фасилитатор
  // сам становится участником (с самого распределения); чётное — фасилитатор в этом раунде не играет. Пар втроём нет.
  const all = db.prepare('SELECT * FROM live_members WHERE session_id = ?').all(s.id);
  const others = all.filter((m) => !m.is_facilitator && !m.removed_at);
  let fac = all.find((m) => m.is_facilitator);
  const needFac = others.length % 2 === 1;
  if (needFac && s.fac_device) {
    if (fac) db.prepare('UPDATE live_members SET removed_at = NULL WHERE id = ?').run(fac.id);
    else {
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(s.facilitator_id) || {};
      const ex = S.member.get(s.id, s.fac_device);
      if (ex) db.prepare('UPDATE live_members SET removed_at = NULL, is_facilitator = 1 WHERE id = ?').run(ex.id);
      else db.prepare('INSERT INTO live_members (session_id, device_id, name, is_facilitator, user_id) VALUES (?, ?, ?, 1, ?)').run(s.id, s.fac_device, String(u.public_name || u.name || 'Фасилитатор').slice(0, 60), s.facilitator_id);
    }
  } else if (!needFac && fac && !fac.removed_at) db.prepare('UPDATE live_members SET removed_at = ? WHERE id = ?').run(now(), fac.id);
  const members = S.members.all(s.id);
  if (members.length < 2) return { error: 'live_too_few' };
  const prev = s.round ? roleMap(s) : new Map();
  const wasListener = shuffle(members.filter((m) => prev.get(m.id) === 'listener'));
  const fresh = shuffle(members.filter((m) => !prev.has(m.id)));
  const wasHolder = shuffle(members.filter((m) => prev.get(m.id) === 'holder'));
  const order = [...wasListener, ...fresh, ...wasHolder];
  const nh = Math.floor(members.length / 2);
  const round = s.round + 1;
  order.forEach((m, i) => db.prepare('INSERT INTO live_roles (session_id, round, member_id, role) VALUES (?, ?, ?, ?)').run(s.id, round, m.id, i < nh ? 'holder' : 'listener'));
  db.prepare("UPDATE live_sessions SET status = 'holders', round = ?, talk_started_at = NULL, talk_ends_at = NULL, recall_at = NULL WHERE id = ?").run(round, s.id);
  return { ok: true, round, facIn: needFac };
});
/** Телефон фасилитатора (с которого открыт пульт) — на нём он участвует, если понадобится. */
function setFacDevice(s, deviceId) { if (deviceId && s.fac_device !== deviceId) db.prepare('UPDATE live_sessions SET fac_device = ? WHERE id = ?').run(deviceId, s.id); }

/** Дальше, не дожидаясь: держатели без карты становятся собеседниками; собеседники без пары распределяются по свободным картам. */
const advance = db.transaction((s) => {
  if (s.status === 'holders') {
    const slots = S.slots.all(s.id, s.round);
    if (!slots.length) return { error: 'live_no_cards' };
    const has = new Set(slots.map((x) => x.holder_id));
    for (const [mid, r] of roleMap(s)) if (r === 'holder' && !has.has(mid)) db.prepare("UPDATE live_roles SET role = 'listener' WHERE session_id = ? AND round = ? AND member_id = ?").run(s.id, s.round, mid);
    db.prepare("UPDATE live_sessions SET status = 'listeners' WHERE id = ?").run(s.id);
    return { ok: true };
  }
  if (s.status === 'listeners') {
    const slots = S.slots.all(s.id, s.round);
    const assigned = new Set(slots.flatMap((x) => [x.listener_id, x.extra_listener_id]).filter(Boolean));
    const waiting = shuffle([...roleMap(s)].filter(([mid, r]) => r === 'listener' && !assigned.has(mid)).map(([mid]) => mid));
    for (const mid of waiting) {
      const free = S.slots.all(s.id, s.round).find((x) => !x.listener_id) || S.slots.all(s.id, s.round).find((x) => !x.extra_listener_id);
      if (!free) break;
      db.prepare(`UPDATE live_slots SET ${free.listener_id ? 'extra_listener_id' : 'listener_id'} = ? WHERE id = ?`).run(mid, free.id);
    }
    db.prepare("UPDATE live_sessions SET status = 'pairs' WHERE id = ?").run(s.id);
    return { ok: true };
  }
  return { error: 'live_bad_state' };
});

function startTalk(s, minutes) {
  if (!['pairs', 'listeners'].includes(s.status)) return { error: 'live_bad_state' };
  if (s.status === 'listeners') advance(s);
  const m = Math.min(120, Math.max(1, Math.round(Number(minutes) || s.round_minutes)));
  const t = new Date(); const ends = new Date(t.getTime() + m * 60000);
  db.prepare("UPDATE live_sessions SET status = 'talk', round_minutes = ?, talk_started_at = ?, talk_ends_at = ? WHERE id = ?").run(m, t.toISOString(), ends.toISOString(), s.id);
  return { ok: true };
}
function addTime(s, minutes) {
  if (s.status !== 'talk') return { error: 'live_bad_state' };
  const ends = new Date(Math.max(Date.parse(s.talk_ends_at), Date.now()) + Math.round(Number(minutes) || 5) * 60000).toISOString();
  db.prepare('UPDATE live_sessions SET talk_ends_at = ? WHERE id = ?').run(ends, s.id);
  return { ok: true };
}
function endRound(s) {
  if (!['talk', 'pairs'].includes(s.status)) return { error: 'live_bad_state' };
  db.prepare("UPDATE live_sessions SET status = 'break', talk_ends_at = ? WHERE id = ?").run(now(), s.id);
  return { ok: true };
}
/** «Позвать всех»: мягкое напоминание у всех — через минуту следующий раунд. */
function recall(s) {
  if (!['break', 'lobby'].includes(s.status)) return { error: 'live_bad_state' };
  db.prepare('UPDATE live_sessions SET recall_at = ? WHERE id = ?').run(now(), s.id);
  return { ok: true };
}
function setMinutes(s, minutes) {
  const m = Math.min(120, Math.max(1, Math.round(Number(minutes) || 30)));
  db.prepare('UPDATE live_sessions SET round_minutes = ? WHERE id = ?').run(m, s.id);
  return { ok: true };
}
function end(s) {
  if (s.status === 'ended') return { ok: true };
  db.prepare("UPDATE live_sessions SET status = 'ended', ended_at = ? WHERE id = ?").run(now(), s.id);
  return { ok: true };
}
function removeMember(s, memberId) {
  db.prepare('UPDATE live_members SET removed_at = ? WHERE id = ? AND session_id = ?').run(now(), Number(memberId), s.id);
  return { ok: true };
}
/** Фасилитатор тоже участвует (нечётное число участников): его устройство — обычный участник. */
function selfJoin(s, user, deviceId, on) {
  const m = S.member.get(s.id, deviceId);
  if (!on) { if (m) db.prepare('UPDATE live_members SET removed_at = ? WHERE id = ?').run(now(), m.id); return { ok: true }; }
  const name = user.public_name || user.name || 'Фасилитатор';
  if (m) db.prepare('UPDATE live_members SET removed_at = NULL, is_facilitator = 1 WHERE id = ?').run(m.id);
  else db.prepare('INSERT INTO live_members (session_id, device_id, name, is_facilitator, user_id) VALUES (?, ?, ?, 1, ?)').run(s.id, deviceId, String(name).slice(0, 60), user.id);
  return { ok: true };
}

// ---------- участник ----------
function bySlug(slug) {
  const col = colBySlug.get(String(slug));
  if (!col) return { col: null, s: null };
  return { col, s: settle(S.activeFor.get(col.id)) || null, last: S.lastFor.get(col.id) };
}
function join(slug, deviceId, name, user = null) {
  const { col, s } = bySlug(slug);
  if (!col || !s) return { error: 'live_not_active' };
  const n = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!n) return { error: 'live_name_required' };
  const m = S.member.get(s.id, deviceId);
  if (m) { db.prepare('UPDATE live_members SET name = ?, removed_at = NULL WHERE id = ?').run(n, m.id); return { ok: true, sessionId: s.id }; }
  if (S.members.all(s.id).length >= MAX_MEMBERS) return { error: 'live_full' };
  db.prepare('INSERT INTO live_members (session_id, device_id, name, user_id) VALUES (?, ?, ?, ?)').run(s.id, deviceId, n, user ? user.id : null);
  return { ok: true, sessionId: s.id };
}
function leave(slug, deviceId) {
  const { s } = bySlug(slug);
  if (!s) return { ok: true };
  const m = S.member.get(s.id, deviceId);
  if (m) db.prepare('UPDATE live_members SET removed_at = ? WHERE id = ?').run(now(), m.id);
  return { ok: true, sessionId: s.id };
}

/** Состояние для телефона участника. Чужие имена и выбор держателей до пары не раскрываются. */
function participantState(slug, deviceId) {
  const { col, s, last } = bySlug(slug);
  if (!col) return null;
  const base = { serverNow: now() };
  if (!s) {
    // Встреча закончилась недавно, а этот телефон в ней был — экран благодарности и отзыв.
    if (last && last.status === 'ended' && Date.now() - Date.parse(last.ended_at) < 12 * 3600e3) {
      const m = S.member.get(last.id, deviceId);
      if (m) return { ...base, live: { id: last.id, status: 'ended', me: { name: m.name }, feedbackSent: !!db.prepare('SELECT id FROM live_feedback WHERE session_id = ? AND member_id = ?').get(last.id, m.id) } };
    }
    return { ...base, live: null };
  }
  const m = S.member.get(s.id, deviceId);
  const out = { id: s.id, status: s.status, round: s.round, roundMinutes: s.round_minutes, talkEndsAt: s.talk_ends_at, recallAt: s.recall_at, version: version(s.id), count: S.members.all(s.id).length };
  if (!m || m.removed_at) return { ...base, live: { ...out, me: null } };
  const role = s.round ? roleMap(s).get(m.id) || null : null;
  const slots = s.round ? S.slots.all(s.id, s.round) : [];
  const mySlot = slots.find((x) => x.holder_id === m.id || x.listener_id === m.id || x.extra_listener_id === m.id) || null;
  const names = (ids) => ids.filter(Boolean).map((id) => (db.prepare('SELECT name FROM live_members WHERE id = ?').get(id) || {}).name).filter(Boolean);
  const me = { id: m.id, name: m.name, role, card: mySlot ? mySlot.card_code : null };
  // Пару (знак и имя собеседника) показываем, когда распределение закончено.
  if (mySlot && ['pairs', 'talk', 'break'].includes(s.status)) {
    me.pair = { sign: signOut(mySlot.sign, pairNo(slots, mySlot)), partners: names(mySlot.holder_id === m.id ? [mySlot.listener_id, mySlot.extra_listener_id] : [mySlot.holder_id, mySlot.listener_id === m.id ? mySlot.extra_listener_id : mySlot.listener_id]) };
  }
  // Собеседнику в его очереди — карты держателей (без имён), занятые отмечены.
  if (s.status === 'listeners' && role === 'listener') {
    const listenersN = [...roleMap(s).values()].filter((r) => r === 'listener').length;
    const allTaken = slots.every((x) => x.listener_id);
    out.slots = slots.map((x) => ({ id: x.id, code: x.card_code, taken: allTaken && listenersN > slots.length ? !!x.extra_listener_id : !!x.listener_id, mine: x.listener_id === m.id || x.extra_listener_id === m.id }));
  }
  return { ...base, live: { ...out, me } };
}

/** Держатель выбирает карту подборки (можно поменять, пока держатели выбирают). Выбор идёт в общий счёт карты. */
const holderPick = db.transaction((slug, deviceId, code) => {
  const { col, s } = bySlug(slug);
  if (!s || s.status !== 'holders') return { error: 'live_bad_state' };
  const m = S.member.get(s.id, deviceId);
  if (!m || m.removed_at || roleMap(s).get(m.id) !== 'holder') return { error: 'live_not_holder' };
  const card = db.prepare(`SELECT k.* FROM collection_cards cc JOIN cards k ON k.id = cc.card_id WHERE cc.collection_id = ? AND k.code = ? AND k.status = 'published'`).get(col.id, String(code));
  if (!card) return { error: 'card_not_in_collection' };
  const ex = db.prepare('SELECT * FROM live_slots WHERE session_id = ? AND round = ? AND holder_id = ?').get(s.id, s.round, m.id);
  if (ex) db.prepare('UPDATE live_slots SET card_code = ? WHERE id = ?').run(card.code, ex.id);
  else {
    const sign = pickSign(S.slots.all(s.id, s.round).map((x) => x.sign));
    db.prepare('INSERT INTO live_slots (session_id, round, holder_id, card_code, sign) VALUES (?, ?, ?, ?, ?)').run(s.id, s.round, m.id, card.code, sign);
  }
  // общий счётчик «Выбрали для разговора»: один выбор на раунд встречи (замена карты — замена выбора)
  const vround = 1000 + s.id * 20 + s.round;
  const cur = db.prepare('SELECT id FROM selections WHERE collection_id = ? AND visitor_id = ? AND round = ? AND cancelled_at IS NULL').get(col.id, deviceId, vround);
  if (cur) db.prepare("UPDATE selections SET cancelled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(cur.id);
  const reason = choices.notCountedReason(card, null, { testCollection: !!(col.is_test || col.is_demo || s.is_demo) });
  db.prepare('INSERT INTO selections (collection_id, card_id, visitor_id, round, is_test, counted, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(col.id, card.id, deviceId, vround, reason ? 1 : 0, reason ? 0 : 1, m.user_id || null);
  // все держатели выбрали — очередь собеседников
  const holders = [...roleMap(s).values()].filter((r) => r === 'holder').length;
  if (S.slots.all(s.id, s.round).length >= holders) db.prepare("UPDATE live_sessions SET status = 'listeners' WHERE id = ?").run(s.id);
  return { ok: true, sessionId: s.id };
});

/** Собеседник выбирает карту держателя. Одна карта — один собеседник; лишний собеседник (нечётная группа) — третьим к любой паре. */
const listenerPick = db.transaction((slug, deviceId, slotId) => {
  const { s } = bySlug(slug);
  if (!s || s.status !== 'listeners') return { error: 'live_bad_state' };
  const m = S.member.get(s.id, deviceId);
  if (!m || m.removed_at || roleMap(s).get(m.id) !== 'listener') return { error: 'live_not_listener' };
  const slots = S.slots.all(s.id, s.round);
  if (slots.some((x) => x.listener_id === m.id || x.extra_listener_id === m.id)) return { error: 'live_already_paired' };
  const slot = slots.find((x) => x.id === Number(slotId));
  if (!slot) return { error: 'not_found' };
  if (!slot.listener_id) db.prepare('UPDATE live_slots SET listener_id = ? WHERE id = ? AND listener_id IS NULL').run(m.id, slot.id);
  else if (slots.every((x) => x.listener_id) && !slot.extra_listener_id) db.prepare('UPDATE live_slots SET extra_listener_id = ? WHERE id = ?').run(m.id, slot.id);
  else return { error: 'live_taken' };
  const after = S.slots.all(s.id, s.round);
  const assigned = after.reduce((n, x) => n + (x.listener_id ? 1 : 0) + (x.extra_listener_id ? 1 : 0), 0);
  const listeners = [...roleMap(s).values()].filter((r) => r === 'listener').length;
  if (assigned >= listeners || after.every((x) => x.listener_id && x.extra_listener_id)) db.prepare("UPDATE live_sessions SET status = 'pairs' WHERE id = ?").run(s.id);
  return { ok: true, sessionId: s.id };
});

// ---------- отзывы ----------
function feedback(sessionId, deviceId, { text, file, mime, mayPublish }) {
  const s = S.session.get(sessionId);
  if (!s) return { error: 'not_found' };
  const m = S.member.get(s.id, deviceId);
  const t = String(text || '').trim().slice(0, 4000);
  if (!t && !file) return { error: 'feedback_empty' };
  db.prepare('INSERT INTO live_feedback (session_id, member_id, name, text, file, mime, may_publish) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(s.id, m ? m.id : null, m ? m.name : '', t, file || null, mime || null, mayPublish ? 1 : 0);
  return { ok: true };
}
function feedbackList(sessionId) {
  return db.prepare('SELECT * FROM live_feedback WHERE session_id = ? ORDER BY id').all(sessionId)
    .map((f) => ({ id: f.id, name: f.name, text: f.text, file: f.file ? `/api/fac/live/${sessionId}/feedback/${f.id}/file` : null, mime: f.mime, mayPublish: !!f.may_publish, createdAt: f.created_at }));
}
const feedbackFile = (sessionId, id) => db.prepare('SELECT * FROM live_feedback WHERE session_id = ? AND id = ?').get(sessionId, Number(id));
/** Встречи фасилитатора (для кабинета): идущая и прошедшие с числом отзывов. */
function mine(userId, isAdmin) {
  return db.prepare(`SELECT l.*, c.title, c.slug, (SELECT COUNT(*) FROM live_feedback f WHERE f.session_id = l.id) AS fb,
      (SELECT COUNT(*) FROM live_members m WHERE m.session_id = l.id) AS people FROM live_sessions l JOIN collections c ON c.id = l.collection_id
      WHERE ${isAdmin ? '1=1' : 'l.facilitator_id = ?'} ORDER BY l.id DESC LIMIT 50`).all(...(isAdmin ? [] : [userId]))
    .map((l) => ({ id: l.id, title: l.title, slug: l.slug, status: l.status, rounds: l.round, people: l.people, feedback: l.fb, createdAt: l.created_at, endedAt: l.ended_at }));
}

module.exports = {
  bus, touch, version, signOut, SIGNS, pickSign, start, forFacilitator, panel, startRound, advance, startTalk, addTime, endRound, recall, setMinutes, end,
  removeMember, selfJoin, setFacDevice, bySlug, join, leave, participantState, holderPick, listenerPick, feedback, feedbackList, feedbackFile, mine,
};
