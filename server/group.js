// Игры компанией без фасилитатора: любой открывает «комнату», друзья заходят по QR/коду и играют на своих телефонах.
// Форматы: one — одна карта на всех; own — каждому своя карта; guess — угадай, кто выбрал; friend — карта для друга;
// story — история по кругу; question — вопрос от карты. Управляет тот, кто открыл комнату (ведущий).
const crypto = require('crypto');
const { EventEmitter } = require('events');
const db = require('./db');
const { publicCard } = require('./cards');

db.exec(`
CREATE TABLE IF NOT EXISTS group_rooms (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, format TEXT NOT NULL, host_device TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'lobby', step INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL DEFAULT '{}', is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS group_members (
  id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL REFERENCES group_rooms(id), device_id TEXT NOT NULL, name TEXT NOT NULL,
  joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), left_at TEXT, UNIQUE (room_id, device_id)
);
CREATE TABLE IF NOT EXISTS group_picks (
  room_id INTEGER NOT NULL, step INTEGER NOT NULL, member_id INTEGER NOT NULL, code TEXT, target_id INTEGER, text TEXT,
  PRIMARY KEY (room_id, step, member_id)
);`);

const FORMATS = ['one', 'own', 'guess', 'friend', 'story', 'question'];
const MAX = 20;
const TTL = 12 * 3600e3;
const bus = new EventEmitter(); bus.setMaxListeners(0);
const versions = new Map();
const touch = (id) => { const v = (versions.get(id) || 0) + 1; versions.set(id, v); bus.emit('g' + id, v); };
const version = (id) => versions.get(id) || 0;
const now = () => new Date().toISOString();
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
/** Перестановка без совпадений: каждый получает не себя (для «карты для друга» и «вопроса от карты»). */
function derange(ids) {
  if (ids.length < 2) return new Map();
  const a = shuffle([...ids]);
  const m = new Map(); a.forEach((id, i) => m.set(id, a[(i + 1) % a.length]));
  return m;
}

const R = {
  byCode: db.prepare('SELECT * FROM group_rooms WHERE code = ?'),
  members: db.prepare('SELECT * FROM group_members WHERE room_id = ? AND left_at IS NULL ORDER BY id'),
  member: db.prepare('SELECT * FROM group_members WHERE room_id = ? AND device_id = ?'),
  picks: db.prepare('SELECT * FROM group_picks WHERE room_id = ? AND step = ?'),
};
const dataOf = (r) => { try { return JSON.parse(r.data || '{}'); } catch { return {}; } };
function save(r, patch) {
  const d = { ...dataOf(r), ...patch };
  db.prepare('UPDATE group_rooms SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(d), now(), r.id);
  return d;
}
function setRoom(r, fields) {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE group_rooms SET ${keys.map((k) => `${k} = @${k}`).join(', ')}, updated_at = @u WHERE id = @id`).run({ ...fields, u: now(), id: r.id });
}

/** Карты галереи: опубликованные; демо-карты — только в демо-просмотре. */
function pool(showDemo) {
  return db.prepare("SELECT * FROM cards WHERE status = 'published' ORDER BY id DESC").all().filter((c) => !c.is_demo || showDemo);
}
function randomCard(showDemo, avoid = []) {
  const all = pool(showDemo); if (!all.length) return null;
  const fresh = all.filter((c) => !avoid.includes(c.code));
  const from = fresh.length ? fresh : all;
  return from[Math.floor(Math.random() * from.length)].code;
}

function create({ format, deviceId, name, showDemo }) {
  if (!FORMATS.includes(format)) return { error: 'group_bad_format' };
  const n = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!n) return { error: 'live_name_required' };
  let code; do { code = crypto.randomBytes(4).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 5).toUpperCase(); } while (code.length < 5 || R.byCode.get(code));
  const info = db.prepare('INSERT INTO group_rooms (code, format, host_device, is_demo) VALUES (?, ?, ?, ?)').run(code, format, deviceId, showDemo ? 1 : 0);
  db.prepare('INSERT INTO group_members (room_id, device_id, name) VALUES (?, ?, ?)').run(Number(info.lastInsertRowid), deviceId, n);
  return { ok: true, code };
}
function room(code) {
  const r = R.byCode.get(String(code || '').toUpperCase());
  if (!r) return null;
  if (r.status !== 'ended' && Date.now() - Date.parse(r.updated_at) > TTL) { setRoom(r, { status: 'ended' }); return R.byCode.get(r.code); }
  return r;
}
function join(code, deviceId, name) {
  const r = room(code); if (!r || r.status === 'ended') return { error: 'group_not_found' };
  const n = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 40); if (!n) return { error: 'live_name_required' };
  const m = R.member.get(r.id, deviceId);
  if (m) db.prepare('UPDATE group_members SET name = ?, left_at = NULL WHERE id = ?').run(n, m.id);
  else { if (R.members.all(r.id).length >= MAX) return { error: 'live_full' }; db.prepare('INSERT INTO group_members (room_id, device_id, name) VALUES (?, ?, ?)').run(r.id, deviceId, n); }
  return { ok: true, id: r.id };
}
function leave(code, deviceId) {
  const r = room(code); if (!r) return { ok: true };
  const m = R.member.get(r.id, deviceId); if (m) db.prepare('UPDATE group_members SET left_at = ? WHERE id = ?').run(now(), m.id);
  return { ok: true, id: r.id };
}

// ---------- ход игры ----------
/** Новый круг (для форматов с выбором): все снова выбирают / пишут. */
function newRound(r, showDemo) {
  const step = r.step + 1;
  const members = R.members.all(r.id);
  const patch = { phase: 'pick', order: [], index: 0, revealed: false };
  if (r.format === 'friend') {
    if (members.length < 2) return { error: 'live_too_few' };
    const m = derange(members.map((x) => x.id));
    for (const x of members) db.prepare('INSERT OR REPLACE INTO group_picks (room_id, step, member_id, target_id) VALUES (?, ?, ?, ?)').run(r.id, step, x.id, m.get(x.id));
  }
  if (r.format === 'question') { patch.card = randomCard(showDemo, dataOf(r).seen || []); patch.seen = [...(dataOf(r).seen || []), patch.card].slice(-30); patch.phase = 'write'; }
  setRoom(r, { status: 'play', step }); save(R.byCode.get(r.code), patch);
  return { ok: true };
}

function act(code, deviceId, action, body = {}, showDemo = false) {
  const r = room(code); if (!r || r.status === 'ended') return { error: 'group_not_found' };
  const me = R.member.get(r.id, deviceId); if (!me || me.left_at) return { error: 'group_not_member' };
  const host = r.host_device === deviceId;
  const d = dataOf(r);
  const hostOnly = () => (host ? null : { error: 'group_host_only' });
  switch (action) {
    case 'start': {
      if (hostOnly()) return hostOnly();
      if (r.format === 'one') { const c = randomCard(showDemo); setRoom(r, { status: 'play', step: 1 }); save(R.byCode.get(r.code), { card: c, seen: [c] }); return { ok: true, id: r.id }; }
      if (r.format === 'story') { const c = randomCard(showDemo); setRoom(r, { status: 'play', step: 1 }); save(R.byCode.get(r.code), { cards: [c] }); return { ok: true, id: r.id }; }
      const x = newRound(r, showDemo); return x.error ? x : { ok: true, id: r.id };
    }
    case 'next_card': { // «Одна карта на всех» и «История по кругу»: новая случайная карта
      if (hostOnly()) return hostOnly();
      if (r.format === 'one') { const c = randomCard(showDemo, d.seen || []); save(r, { card: c, seen: [...(d.seen || []), c].slice(-30) }); setRoom(R.byCode.get(r.code), { step: r.step + 1 }); }
      else if (r.format === 'story') { const c = randomCard(showDemo, d.cards || []); save(r, { cards: [...(d.cards || []), c].slice(0, 12) }); }
      else return { error: 'live_bad_state' };
      return { ok: true, id: r.id };
    }
    case 'pick': { // выбрать карту (own, guess, friend)
      if (!['own', 'guess', 'friend'].includes(r.format) || d.phase !== 'pick') return { error: 'live_bad_state' };
      const card = db.prepare("SELECT code FROM cards WHERE code = ? AND status = 'published'").get(String(body.code || ''));
      if (!card) return { error: 'not_found' };
      const ex = db.prepare('SELECT * FROM group_picks WHERE room_id = ? AND step = ? AND member_id = ?').get(r.id, r.step, me.id);
      if (ex) db.prepare('UPDATE group_picks SET code = ? WHERE room_id = ? AND step = ? AND member_id = ?').run(card.code, r.id, r.step, me.id);
      else db.prepare('INSERT INTO group_picks (room_id, step, member_id, code) VALUES (?, ?, ?, ?)').run(r.id, r.step, me.id, card.code);
      maybeReveal(R.byCode.get(r.code));
      return { ok: true, id: r.id };
    }
    case 'write': { // «Вопрос от карты»: свой вопрос
      if (r.format !== 'question' || d.phase !== 'write') return { error: 'live_bad_state' };
      const t = String(body.text || '').trim().slice(0, 300); if (!t) return { error: 'question_required' };
      db.prepare('INSERT OR REPLACE INTO group_picks (room_id, step, member_id, text) VALUES (?, ?, ?, ?)').run(r.id, r.step, me.id, t);
      return { ok: true, id: r.id };
    }
    case 'reveal': { // ведущий: открыть всё (own/friend), раздать вопросы (question), открыть автора (guess)
      if (hostOnly()) return hostOnly();
      if (r.format === 'question' && d.phase === 'write') {
        const ps = R.picks.all(r.id, r.step).filter((p) => p.text);
        if (ps.length < 2) return { error: 'group_need_two' };
        const m = derange(ps.map((p) => p.member_id));
        save(r, { phase: 'deal', deal: Object.fromEntries([...m].map(([who, from]) => [who, from])) });
        return { ok: true, id: r.id };
      }
      if (r.format === 'guess' && d.phase === 'guess') { save(r, { revealed: true }); return { ok: true, id: r.id }; }
      if (d.phase === 'pick') { if (!R.picks.all(r.id, r.step).some((p) => p.code)) return { error: 'live_no_cards' }; toShow(r); return { ok: true, id: r.id }; }
      return { error: 'live_bad_state' };
    }
    case 'next': { // «Угадай»: следующая карта
      if (hostOnly()) return hostOnly();
      if (r.format !== 'guess' || d.phase !== 'guess') return { error: 'live_bad_state' };
      if (d.index + 1 >= d.order.length) save(r, { phase: 'done' }); else save(r, { index: d.index + 1, revealed: false });
      return { ok: true, id: r.id };
    }
    case 'again': { // новый круг
      if (hostOnly()) return hostOnly();
      if (r.format === 'story') { const c = randomCard(showDemo); save(r, { cards: [c] }); return { ok: true, id: r.id }; }
      const x = newRound(r, showDemo); return x.error ? x : { ok: true, id: r.id };
    }
    case 'end': { if (hostOnly()) return hostOnly(); setRoom(r, { status: 'ended' }); return { ok: true, id: r.id }; }
    default: return { error: 'live_bad_state' };
  }
}
/** Все выбрали — показываем (own/friend) или начинаем угадывание (guess). */
function maybeReveal(r) {
  const members = R.members.all(r.id);
  const picked = R.picks.all(r.id, r.step).filter((p) => p.code).map((p) => p.member_id);
  if (members.every((m) => picked.includes(m.id))) toShow(r);
}
function toShow(r) {
  const d = dataOf(r);
  if (r.format === 'guess') save(r, { phase: 'guess', order: shuffle(R.picks.all(r.id, r.step).filter((p) => p.code).map((p) => p.member_id)), index: 0, revealed: false });
  else save(r, { ...d, phase: 'show' });
}

/** Состояние для телефона участника. Чужой выбор до раскрытия не показывается. */
function state(code, deviceId, showDemo) {
  const r = room(code); if (!r) return null;
  const members = R.members.all(r.id);
  const me = R.member.get(r.id, deviceId);
  const d = dataOf(r);
  const cardOut = (c) => { if (!c) return null; const k = db.prepare('SELECT * FROM cards WHERE code = ?').get(c); return k ? publicCard(k) : null; };
  const name = (id) => (members.find((m) => m.id === id) || db.prepare('SELECT name FROM group_members WHERE id = ?').get(id) || {}).name || '—';
  const out = { code: r.code, format: r.format, status: r.status, step: r.step, version: version(r.id), id: r.id,
    host: r.host_device === deviceId, hostName: name((members.find((m) => m.device_id === r.host_device) || {}).id),
    members: members.map((m) => ({ id: m.id, name: m.name })), me: me && !me.left_at ? { id: me.id, name: me.name } : null, phase: d.phase || null };
  if (r.status !== 'play') return out;
  const picks = R.picks.all(r.id, r.step);
  const mine = me ? picks.find((p) => p.member_id === me.id) : null;
  if (r.format === 'one') out.card = cardOut(d.card);
  if (r.format === 'story') out.cards = (d.cards || []).map(cardOut).filter(Boolean);
  if (['own', 'guess', 'friend'].includes(r.format)) {
    out.picked = picks.filter((p) => p.code).length;
    out.myCard = mine && mine.code ? cardOut(mine.code) : null;
    if (r.format === 'friend' && mine) out.target = name(mine.target_id);
    if (d.phase === 'pick') out.gallery = pool(showDemo || r.is_demo).map((k) => publicCard(k));
    if (d.phase === 'show') out.shown = picks.filter((p) => p.code).map((p) => ({ name: name(p.member_id), for: r.format === 'friend' ? name(p.target_id) : null, card: cardOut(p.code) }));
    if (d.phase === 'guess' || d.phase === 'done') {
      out.total = d.order.length; out.index = d.index;
      const p = picks.find((x) => x.member_id === d.order[d.index]);
      if (p && d.phase === 'guess') { out.current = cardOut(p.code); out.revealed = !!d.revealed; if (d.revealed) out.author = name(p.member_id); }
      if (d.phase === 'done') out.shown = d.order.map((id) => { const x = picks.find((y) => y.member_id === id); return { name: name(id), card: cardOut(x.code) }; });
    }
  }
  if (r.format === 'question') {
    out.card = cardOut(d.card);
    out.written = picks.filter((p) => p.text).length;
    out.myText = mine ? mine.text : null;
    if (d.phase === 'deal' && me && d.deal && d.deal[me.id]) { const p = picks.find((x) => x.member_id === Number(d.deal[me.id])); out.question = p ? p.text : null; }
  }
  return out;
}

module.exports = { FORMATS, bus, touch, version, create, room, join, leave, act, state };
