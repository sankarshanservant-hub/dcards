// «Глаз-алмаз» (22.11.2026): банк вопросов к картам и обмен «Предложить другу».
// Банк — server/data/eagle-bank.txt, дословно от автора: код DC-XXXX, под ним ровно три строки «вопрос | правильный ответ».
// Вопрос узнаётся по постоянному коду: <код>#<номер строки> (1–3), версия — отпечаток текста. Банк подключён только к «Глаз-алмазу».
// В обмене вопрос и ответ хранятся вместе с ним (снимок): правка банка не меняет уже отправленные задания.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const FILE = path.join(__dirname, 'data', 'eagle-bank.txt');
/** Разбор банка. Ошибка формата — исключение (сервер не стартует с испорченным банком; тест ловит раньше). */
function parse(text) {
  const out = new Map(); let code = null;
  const lines = String(text).replace(/\r/g, '').split('\n');
  lines.forEach((raw, i) => {
    const line = raw.trim(); if (!line) return;
    if (/^DC-\d{4}$/.test(line)) { if (out.has(line)) throw new Error(`eagle bank: duplicate ${line}`); code = line; out.set(code, []); return; }
    if (!code) throw new Error(`eagle bank: line ${i + 1} before a code`);
    const at = line.indexOf(' | '); if (at < 0) throw new Error(`eagle bank: line ${i + 1} without " | "`);
    const q = line.slice(0, at).trim(); const a = line.slice(at + 3).trim();
    if (!q || !a) throw new Error(`eagle bank: line ${i + 1} empty`);
    const list = out.get(code); const n = list.length + 1;
    list.push({ id: `${code}#${n}`, v: crypto.createHash('sha1').update(q + '|' + a).digest('hex').slice(0, 10), q, a });
  });
  for (const [c, list] of out) if (list.length !== 3) throw new Error(`eagle bank: ${c} has ${list.length} pairs`);
  return out;
}
let bank = parse(fs.readFileSync(FILE, 'utf8'));
const version = () => crypto.createHash('sha1').update(JSON.stringify([...bank])).digest('hex').slice(0, 12);
const item = (id) => { const code = String(id || '').split('#')[0]; return (bank.get(code) || []).find((x) => x.id === id) || null; };
/** Банк для игры: только карты, которые сейчас опубликованы. */
function forCards(codes) {
  const set = new Set(codes);
  return { version: version(), items: Object.fromEntries([...bank].filter(([c]) => set.has(c))) };
}

db.exec(`
CREATE TABLE IF NOT EXISTS eagle_x (
  id INTEGER PRIMARY KEY, secret TEXT NOT NULL UNIQUE, code TEXT NOT NULL, qid TEXT NOT NULL, qver TEXT NOT NULL,
  question TEXT NOT NULL, answer TEXT NOT NULL, from_name TEXT NOT NULL, from_answer TEXT NOT NULL,
  from_visitor TEXT, from_user INTEGER, is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS eagle_replies (
  id INTEGER PRIMARY KEY, x_id INTEGER NOT NULL REFERENCES eagle_x(id), visitor TEXT NOT NULL, user_id INTEGER,
  name TEXT NOT NULL, answer TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (x_id, visitor)
);`);
const okToken = (t) => typeof t === 'string' && /^[A-Za-z0-9_-]{22,40}$/.test(t);
const clean = (s, n) => String(s || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().replace(/[ \t]+/g, ' ').slice(0, n);
const byToken = (t) => (okToken(t) ? db.prepare('SELECT * FROM eagle_x WHERE secret = ?').get(t) : null);
const isMine = (x, user, visitor) => (user && x.from_user === user.id) || (visitor && x.from_visitor === visitor);

/** Отправитель: своё задание (карта + вопрос) и свой записанный ответ — друг получает то же задание. */
function create(user, visitor, { token, qid, name, answer, ver }, isDemo = false) {
  if (!okToken(token)) return { error: 'bad_request' };
  const ex = byToken(token);
  if (ex) return isMine(ex, user, visitor) ? { ok: true, secret: ex.secret, repeated: true } : { error: 'conflict' };
  const it = item(qid); if (!it) return { error: 'eagle_task_gone' };
  // задание у игрока могло быть открыто до обновления банка: старая версия вопроса — не отправляем подменённый текст
  if (ver && ver !== it.v) return { error: 'eagle_task_changed' };
  const card = db.prepare("SELECT code FROM cards WHERE code = ? AND status = 'published'").get(it.id.split('#')[0]); if (!card) return { error: 'not_found' };
  const n = clean(name, 40); if (!n) return { error: 'live_name_required' };
  const a = clean(answer, 300); if (!a) return { error: 'answer_required' };
  db.prepare('INSERT INTO eagle_x (secret, code, qid, qver, question, answer, from_name, from_answer, from_visitor, from_user, is_demo) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(token, card.code, it.id, it.v, it.q, it.a, n, a, visitor || null, user ? user.id : null, isDemo || (user && user.is_demo) ? 1 : 0);
  return { ok: true, secret: token };
}
const replyOf = (x, visitor) => (visitor ? db.prepare('SELECT * FROM eagle_replies WHERE x_id = ? AND visitor = ?').get(x.id, visitor) : null);
/** Что видит открывший ссылку. Вопрос — только после «Запомнил» (look=1), правильный ответ и чужие ответы — после своего. */
function view(token, user, visitor, { look = false } = {}) {
  const x = byToken(token); if (!x) return null;
  const mine = isMine(x, user, visitor);
  const out = { code: x.code, fromName: x.from_name, mine, createdAt: x.created_at };
  if (mine) {
    const rs = db.prepare('SELECT name, answer, created_at FROM eagle_replies WHERE x_id = ? ORDER BY id').all(x.id);
    return { ...out, phase: 'result', question: x.question, answer: x.answer, answers: [{ name: x.from_name, text: x.from_answer, me: true }, ...rs.map((r) => ({ name: r.name, text: r.answer }))], replies: rs.length };
  }
  const r = replyOf(x, visitor);
  if (r) return { ...out, phase: 'result', question: x.question, answer: x.answer, answers: [{ name: x.from_name, text: x.from_answer }, { name: r.name, text: r.answer, me: true }] };
  return look ? { ...out, phase: 'ask', question: x.question } : { ...out, phase: 'look' };
}
/** Ответ друга. Повторная отправка не меняет записанный ответ — возвращается результат. */
function reply(token, user, visitor, { name, answer }) {
  const x = byToken(token); if (!x) return { error: 'not_found' };
  if (!visitor) return { error: 'bad_visitor' };
  if (isMine(x, user, visitor)) return { error: 'eagle_own_task' };
  const was = replyOf(x, visitor);
  if (was) return { ok: true, repeated: true, x };
  const n = clean(name, 40); if (!n) return { error: 'live_name_required' };
  const a = clean(answer, 300); if (!a) return { error: 'answer_required' };
  db.prepare('INSERT INTO eagle_replies (x_id, visitor, user_id, name, answer) VALUES (?,?,?,?,?)').run(x.id, visitor, user ? user.id : null, n, a);
  return { ok: true, x, name: n };
}

module.exports = { parse, forCards, create, view, reply, item, version, byToken, _setBank: (text) => { bank = parse(text); } };
