// Обсуждения карт, командные чаты, заявки на роль фасилитатора.
const db = require('./db');

const userName = (id) => { const u = db.prepare('SELECT name, public_name FROM users WHERE id = ?').get(id); return u ? (u.public_name || u.name) : ''; };

// ---------- обсуждение карты: читают все, пишут вошедшие ----------
function comments(cardId, viewer) {
  return db.prepare('SELECT * FROM comments WHERE card_id = ? AND deleted_at IS NULL ORDER BY id').all(cardId)
    .map((c) => ({ id: c.id, author: userName(c.user_id), text: c.text, createdAt: c.created_at, mine: !!viewer && viewer.id === c.user_id, isDemo: !!c.is_demo }));
}
function addComment(cardId, user, text) {
  const t = String(text || '').trim().slice(0, 2000);
  if (!t) return { error: 'empty' };
  const info = db.prepare('INSERT INTO comments (card_id, user_id, text, is_demo) VALUES (?, ?, ?, ?)').run(cardId, user.id, t, user.is_demo ? 1 : 0);
  return { id: info.lastInsertRowid };
}
function deleteComment(id, user, isAdmin) {
  const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(id);
  if (!c || c.deleted_at) return { error: 'not_found' };
  if (c.user_id !== user.id && !isAdmin) return { error: 'forbidden' };
  db.prepare(`UPDATE comments SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), deleted_by = ? WHERE id = ?`).run(user.id, id);
  return { ok: true };
}
function recentComments(showDemo) {
  return db.prepare(`SELECT c.*, k.code FROM comments c JOIN cards k ON k.id = c.card_id
    WHERE c.deleted_at IS NULL AND ${showDemo ? '1=1' : 'c.is_demo = 0'} ORDER BY c.id DESC LIMIT 100`).all()
    .map((c) => ({ id: c.id, code: c.code, author: userName(c.user_id), text: c.text, createdAt: c.created_at, isDemo: !!c.is_demo }));
}

// ---------- командные чаты ----------
// Кто видит переписку: чат кураторов — кураторы и администраторы; чат фасилитаторов — фасилитаторы и администраторы.
const ROOMS = { curators: ['curator'], facilitators: ['facilitator'] };
function chat(room, showDemo) {
  return db.prepare(`SELECT * FROM chat_messages WHERE room = ? AND ${showDemo ? '1=1' : 'is_demo = 0'} ORDER BY id DESC LIMIT 200`).all(room).reverse()
    .map((m) => ({ id: m.id, author: userName(m.user_id), userId: m.user_id, text: m.text, createdAt: m.created_at }));
}
function post(room, user, text) {
  const t = String(text || '').trim().slice(0, 4000);
  if (!t) return { error: 'empty' };
  db.prepare('INSERT INTO chat_messages (room, user_id, text, is_demo) VALUES (?, ?, ?, ?)').run(room, user.id, t, user.is_demo ? 1 : 0);
  return { ok: true };
}
function members(room) {
  return db.prepare(`SELECT DISTINCT u.id, COALESCE(NULLIF(u.public_name,''), u.name) AS name, r.role FROM users u JOIN user_roles r ON r.user_id = u.id
    WHERE r.role IN (?, 'admin') ORDER BY r.role, name`).all(ROOMS[room][0]);
}

// ---------- заявка на роль фасилитатора ----------
// Курс — главы «Руководства фасилитатора Dialogue Flow» (черновик владельца). Вопросы проверки — временные (демо).
const COURSE = [
  'Глава 1. Почему появился Dialogue Flow',
  'Глава 2. Принципы Dialogue Flow',
  'Глава 3. Искусство быть фасилитатором',
  'Глава 4. Подготовка пространства',
  'Глава 5. Сценарий встречи',
  'Глава 6. Когда что-то идёт не по плану',
  'Глава 7. Философия вопросов',
  'Глава 8. Dialogue Flow — это только начало',
];
const QUESTIONS = [
  { id: 'q1', text: 'Есть ли у карты «правильное» значение, которое фасилитатор должен объяснить участникам?', options: ['Да', 'Нет'], answer: 1 },
  { id: 'q2', text: 'Где происходит основное общение на встрече?', options: ['Между фасилитатором и группой', 'Между участниками, часто в парах'], answer: 1 },
  { id: 'q3', text: 'Обещает ли встреча Dialogue Flow терапевтический результат?', options: ['Да', 'Нет'], answer: 1 },
];
function application(userId) {
  const a = db.prepare('SELECT * FROM fac_applications WHERE user_id = ?').get(userId);
  if (!a) return null;
  return { status: a.status, courseDone: JSON.parse(a.course_done), answers: JSON.parse(a.answers), about: a.about, city: a.city,
    decisionNote: a.decision_note, decidedAt: a.decided_at, createdAt: a.created_at, updatedAt: a.updated_at };
}
function startApplication(user) {
  db.prepare('INSERT OR IGNORE INTO fac_applications (user_id, is_demo) VALUES (?, ?)').run(user.id, user.is_demo ? 1 : 0);
  return application(user.id);
}
function saveApplication(user, { courseDone, answers, about, city }) {
  const a = db.prepare('SELECT * FROM fac_applications WHERE user_id = ?').get(user.id);
  if (!a) return { error: 'not_started' };
  if (!['in_progress', 'rejected'].includes(a.status)) return { error: 'locked', status: a.status };
  const done = Array.isArray(courseDone) ? [...new Set(courseDone.map(Number).filter((n) => n >= 0 && n < COURSE.length))] : JSON.parse(a.course_done);
  db.prepare(`UPDATE fac_applications SET course_done = ?, answers = ?, about = ?, city = ?, status = 'in_progress', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
    .run(JSON.stringify(done), JSON.stringify(answers || JSON.parse(a.answers)), String(about ?? a.about).slice(0, 2000), String(city ?? a.city).slice(0, 100), a.id);
  return { ok: true };
}
function quizPassed(answers) { return QUESTIONS.every((q) => Number(answers[q.id]) === q.answer); }
function submitApplication(user) {
  const a = db.prepare('SELECT * FROM fac_applications WHERE user_id = ?').get(user.id);
  if (!a) return { error: 'not_started' };
  if (JSON.parse(a.course_done).length < COURSE.length) return { error: 'course_not_finished' };
  if (!quizPassed(JSON.parse(a.answers))) return { error: 'quiz_not_passed' };
  db.prepare(`UPDATE fac_applications SET status = 'submitted', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(a.id);
  return { ok: true };
}
function applications(showDemo) {
  return db.prepare(`SELECT * FROM fac_applications WHERE ${showDemo ? '1=1' : 'is_demo = 0'} ORDER BY updated_at DESC`).all()
    .map((a) => ({ userId: a.user_id, name: userName(a.user_id), status: a.status, city: a.city, about: a.about,
      courseDone: JSON.parse(a.course_done).length, quizPassed: quizPassed(JSON.parse(a.answers)), updatedAt: a.updated_at, isDemo: !!a.is_demo }));
}
function decideApplication(adminId, userId, approve, note = '') {
  const a = db.prepare('SELECT * FROM fac_applications WHERE user_id = ?').get(userId);
  if (!a) return { error: 'not_found' };
  db.prepare(`UPDATE fac_applications SET status = ?, decision_note = ?, decided_by = ?, decided_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(approve ? 'approved' : 'rejected', String(note).slice(0, 1000), adminId, a.id);
  if (approve) db.prepare(`INSERT OR IGNORE INTO user_roles (user_id, role, granted_by) VALUES (?, 'facilitator', ?)`).run(userId, adminId);
  return { ok: true };
}

module.exports = {
  comments, addComment, deleteComment, recentComments, ROOMS, chat, post, members,
  COURSE, QUESTIONS, application, startApplication, saveApplication, submitApplication, applications, decideApplication,
};
