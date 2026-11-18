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

// ---------- чаты ----------
// Кто видит переписку: общий — все вошедшие; кураторов — кураторы и администраторы; фасилитаторов — фасилитаторы и администраторы.
// [] — доступен любому вошедшему.
const ROOMS = { general: [], curators: ['curator'], facilitators: ['facilitator'] };
const CATEGORIES = ['meetings', 'illustrations', 'inspiration'];
const canRoom = (room, has) => !!ROOMS[room] && (!ROOMS[room].length || has(...ROOMS[room]));
const attOut = (room) => (a) => ({ id: a.id, category: a.category, width: a.width, height: a.height,
  thumb: `/api/chats/${room}/media/thumb/${a.file}`, full: `/api/chats/${room}/media/full/${a.file}` });
const rolesOf = (userId) => db.prepare('SELECT role FROM user_roles WHERE user_id = ?').all(userId).map((r) => r.role);
/** Доступ участника к комнате по его ролям (администратор — во все). */
function userCanRoom(room, userId) {
  const roles = rolesOf(userId);
  return canRoom(room, (...need) => roles.includes('admin') || need.some((r) => roles.includes(r)));
}
const excerpt = (t, n = 140) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x.length > n ? x.slice(0, n - 1) + '…' : x; };
const parseIds = (j) => { try { const a = JSON.parse(j || '[]'); return Array.isArray(a) ? a.map(Number).filter(Boolean) : []; } catch { return []; } };

/**
 * Сообщения комнаты. Удалённые автором — без текста. Скрытые модератором — без текста для всех, кроме администратора
 * (он видит исходный текст, чтобы решить, восстанавливать ли). Ответ показывает отрывок исходного сообщения, если оно не удалено.
 */
function chat(room, showDemo, viewer = null) {
  const isAdmin = !!(viewer && viewer.isAdmin);
  const rows = db.prepare(`SELECT * FROM chat_messages WHERE room = ? AND ${showDemo ? '1=1' : 'is_demo = 0'} ORDER BY id DESC LIMIT 200`).all(room).reverse();
  const atts = rows.length ? db.prepare(`SELECT * FROM chat_attachments WHERE message_id IN (${rows.map(() => '?').join(',')}) ORDER BY id`).all(...rows.map((m) => m.id)) : [];
  const byId = new Map(rows.map((m) => [m.id, m]));
  const getMsg = (id) => byId.get(id) || db.prepare('SELECT * FROM chat_messages WHERE id = ? AND room = ?').get(id, room);
  return rows.map((m) => {
    const gone = !!m.deleted_at;
    let replyTo = null;
    if (m.reply_to) {
      const o = getMsg(m.reply_to);
      replyTo = o ? { id: o.id, author: userName(o.user_id), text: o.deleted_at ? '' : excerpt(o.text, 90), deleted: !!o.deleted_at } : null;
    }
    return {
      id: m.id, author: userName(m.user_id), userId: m.user_id, createdAt: m.created_at, workId: m.work_id || null,
      deleted: gone, moderated: !!m.moderated, text: gone ? '' : m.text,
      hiddenText: gone && m.moderated && isAdmin ? m.text : undefined,
      replyTo, mentions: parseIds(m.mentions).map((id) => ({ id, name: userName(id) })),
      forwardOf: m.forward_of ? (() => { const o = db.prepare('SELECT id, room, user_id, created_at, deleted_at FROM chat_messages WHERE id = ?').get(m.forward_of); return o ? { id: o.id, room: o.room, author: userName(o.user_id), createdAt: o.created_at, deleted: !!o.deleted_at } : null; })() : null,
      attachments: gone ? [] : atts.filter((a) => a.message_id === m.id).map(attOut(room)),
    };
  });
}
/** Кого можно упомянуть: участники с доступом к комнате, писавшие в ней (и состав закрытой комнаты). */
function people(room, showDemo) {
  const ids = new Set(db.prepare(`SELECT DISTINCT user_id FROM chat_messages WHERE room = ? AND ${showDemo ? '1=1' : 'is_demo = 0'} ORDER BY id DESC LIMIT 300`).all(room).map((r) => r.user_id));
  const mem = members(room); if (mem) mem.forEach((x) => ids.add(x.id));
  return [...ids].filter((id) => userCanRoom(room, id)).map((id) => ({ id, name: userName(id) })).filter((x) => x.name).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}
/** Сообщение с изображениями. files — уже обработанные { file, width, height }. Повтор с тем же clientId не создаёт дубль. */
function post(room, user, text, { files = [], category = '', clientId = '', replyTo = null, mentions = [] } = {}) {
  const t = String(text || '').trim().slice(0, 4000);
  if (!t && !files.length) return { error: 'empty' };
  const cid = String(clientId || '').slice(0, 64);
  if (cid) { const dup = db.prepare('SELECT id FROM chat_messages WHERE user_id = ? AND client_id = ?').get(user.id, cid); if (dup) return { ok: true, id: dup.id, duplicate: true }; }
  const cat = CATEGORIES.includes(category) ? category : '';
  let rt = Number(replyTo) || null;
  if (rt && !db.prepare('SELECT id FROM chat_messages WHERE id = ? AND room = ?').get(rt, room)) rt = null; // ответ — только в той же комнате
  // Упомянуть можно только того, кто видит эту комнату (закрытое не уходит постороннему даже уведомлением).
  const ment = [...new Set((Array.isArray(mentions) ? mentions : String(mentions || '').split(',')).map(Number).filter(Boolean))]
    .filter((id) => id !== user.id && db.prepare('SELECT id FROM users WHERE id = ?').get(id) && userCanRoom(room, id)).slice(0, 20);
  return db.transaction(() => {
    const info = db.prepare('INSERT INTO chat_messages (room, user_id, text, is_demo, client_id, reply_to, mentions) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(room, user.id, t, user.is_demo ? 1 : 0, cid || null, rt, ment.length ? JSON.stringify(ment) : null);
    const id = Number(info.lastInsertRowid);
    for (const f of files) db.prepare('INSERT INTO chat_attachments (message_id, room, file, width, height, category) VALUES (?, ?, ?, ?, ?, ?)').run(id, room, f.file, f.width, f.height, cat);
    // своё сообщение прочитано
    db.prepare(`INSERT INTO chat_reads (user_id, room, last_id) VALUES (?, ?, ?) ON CONFLICT(user_id, room) DO UPDATE SET last_id = MAX(last_id, excluded.last_id)`).run(user.id, room, id);
    return { ok: true, id };
  })();
}
/**
 * Переслать сообщение из общего чата в другой чат, куда человек может писать (права — на сервере). Оригинал остаётся
 * на месте; в пересланном — автор оригинала и ссылка на него. Из закрытых чатов в общий не пересылается (только из общего).
 */
const FORWARD_FROM = ['general'];
function forward(fromRoom, id, user, toRoom) {
  if (!FORWARD_FROM.includes(fromRoom)) return { error: 'forward_not_allowed' };
  if (!ROOMS[toRoom] || toRoom === fromRoom) return { error: 'bad_room' };
  if (!userCanRoom(toRoom, user.id)) return { error: 'forbidden' };
  const m = db.prepare('SELECT * FROM chat_messages WHERE id = ? AND room = ?').get(id, fromRoom);
  if (!m || m.deleted_at) return { error: 'not_found' };
  const atts = db.prepare('SELECT * FROM chat_attachments WHERE message_id = ?').all(m.id);
  return db.transaction(() => {
    const info = db.prepare('INSERT INTO chat_messages (room, user_id, text, is_demo, forward_of) VALUES (?, ?, ?, ?, ?)')
      .run(toRoom, user.id, m.text, user.is_demo || m.is_demo ? 1 : 0, m.id);
    const nid = Number(info.lastInsertRowid);
    for (const a of atts) db.prepare('INSERT INTO chat_attachments (message_id, room, file, width, height, category) VALUES (?, ?, ?, ?, ?, ?)').run(nid, toRoom, a.file, a.width, a.height, a.category);
    db.prepare(`INSERT INTO chat_reads (user_id, room, last_id) VALUES (?, ?, ?) ON CONFLICT(user_id, room) DO UPDATE SET last_id = MAX(last_id, excluded.last_id)`).run(user.id, toRoom, nid);
    return { ok: true, id: nid, room: toRoom };
  })();
}
/**
 * Удалить сообщение. Автор удаляет своё. Администратор скрывает чужое как модератор: можно восстановить,
 * действие записывается в журнал. Текст никто не переписывает — только скрытие/восстановление.
 */
function deleteMessage(room, id, user, isAdmin, reason = '') {
  const m = db.prepare('SELECT * FROM chat_messages WHERE id = ? AND room = ?').get(id, room);
  if (!m) return { error: 'not_found' };
  if (m.user_id !== user.id && !isAdmin) return { error: 'forbidden' };
  if (m.deleted_at) return { ok: true };
  const mod = m.user_id !== user.id ? 1 : 0;
  db.transaction(() => {
    db.prepare(`UPDATE chat_messages SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), deleted_by = ?, moderated = ? WHERE id = ?`).run(user.id, mod, id);
    if (mod) db.prepare('INSERT INTO chat_mod_log (message_id, room, action, by_user, reason) VALUES (?, ?, ?, ?, ?)').run(id, room, 'hide', user.id, String(reason || '').slice(0, 300));
  })();
  return { ok: true, moderated: !!mod };
}
/** Восстановить скрытое модератором сообщение (только администратор; удалённое самим автором не восстанавливается). */
function restoreMessage(room, id, admin) {
  const m = db.prepare('SELECT * FROM chat_messages WHERE id = ? AND room = ?').get(id, room);
  if (!m) return { error: 'not_found' };
  if (!m.deleted_at || !m.moderated) return { error: 'not_moderated' };
  db.transaction(() => {
    db.prepare('UPDATE chat_messages SET deleted_at = NULL, deleted_by = NULL, moderated = 0 WHERE id = ?').run(id);
    db.prepare('INSERT INTO chat_mod_log (message_id, room, action, by_user) VALUES (?, ?, ?, ?)').run(id, room, 'restore', admin.id);
  })();
  return { ok: true };
}
function modLog() {
  return db.prepare('SELECT l.*, m.user_id AS author_id FROM chat_mod_log l JOIN chat_messages m ON m.id = l.message_id ORDER BY l.id DESC LIMIT 200').all()
    .map((l) => ({ id: l.id, messageId: l.message_id, room: l.room, action: l.action, by: userName(l.by_user), author: userName(l.author_id), reason: l.reason, at: l.created_at }));
}
/** «Медиа» чата: изображения неудалённых сообщений, с автором, временем и текстом сообщения. */
function media(room, showDemo, category = '') {
  return db.prepare(`SELECT a.*, m.user_id, m.text, m.created_at AS msg_at FROM chat_attachments a JOIN chat_messages m ON m.id = a.message_id
      WHERE a.room = ? AND m.deleted_at IS NULL AND ${showDemo ? '1=1' : 'm.is_demo = 0'} ${CATEGORIES.includes(category) ? 'AND a.category = ?' : ''} ORDER BY a.id DESC LIMIT 300`)
    .all(...[room, ...(CATEGORIES.includes(category) ? [category] : [])])
    .map((a) => ({ ...attOut(room)(a), messageId: a.message_id, author: userName(a.user_id), text: a.text, createdAt: a.msg_at }));
}
/** Файл вложения доступен, только если сообщение не удалено (права на комнату проверяет маршрут). */
function attachmentFile(room, file) {
  return db.prepare(`SELECT a.file FROM chat_attachments a JOIN chat_messages m ON m.id = a.message_id WHERE a.room = ? AND a.file = ? AND m.deleted_at IS NULL`).get(room, file);
}
/** Доступные комнаты с числом непрочитанных (чужие неудалённые сообщения после последнего прочитанного) и отметкой закрытости. */
function rooms(has, userId = null, showDemo = false) {
  return Object.keys(ROOMS).filter((r) => canRoom(r, has)).map((r) => {
    const last = db.prepare('SELECT id, created_at FROM chat_messages WHERE room = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1').get(r);
    let unread = 0; let mentions = 0;
    if (userId) {
      const seen = (db.prepare('SELECT last_id FROM chat_reads WHERE user_id = ? AND room = ?').get(userId, r) || {}).last_id || 0;
      const rows = db.prepare(`SELECT reply_to, mentions FROM chat_messages WHERE room = ? AND id > ? AND user_id != ? AND deleted_at IS NULL AND ${showDemo ? '1=1' : 'is_demo = 0'}`).all(r, seen, userId);
      unread = rows.length;
      mentions = rows.filter((m) => parseIds(m.mentions).includes(userId) || (m.reply_to && (db.prepare('SELECT user_id FROM chat_messages WHERE id = ?').get(m.reply_to) || {}).user_id === userId)).length;
    }
    const mode = userId ? (db.prepare('SELECT mode FROM chat_notify WHERE user_id = ? AND room = ?').get(userId, r) || {}).mode || 'mentions' : null;
    return { room: r, closed: ROOMS[r].length > 0, lastAt: last ? last.created_at : null, unread, mentions, notify: mode };
  });
}
function markRead(userId, room, lastId) {
  const max = (db.prepare('SELECT MAX(id) AS n FROM chat_messages WHERE room = ?').get(room) || {}).n || 0;
  const id = Math.min(Number(lastId) || max, max);
  db.prepare(`INSERT INTO chat_reads (user_id, room, last_id) VALUES (?, ?, ?) ON CONFLICT(user_id, room) DO UPDATE SET last_id = MAX(last_id, excluded.last_id)`).run(userId, room, id);
  return { ok: true };
}
function members(room) {
  if (!ROOMS[room].length) return null; // общий чат: все участники
  return db.prepare(`SELECT DISTINCT u.id, COALESCE(NULLIF(u.public_name,''), u.name) AS name, r.role FROM users u JOIN user_roles r ON r.user_id = u.id
    WHERE r.role IN (?, 'admin') ORDER BY r.role, name`).all(ROOMS[room][0]);
}

// ---------- заявка на роль фасилитатора ----------
// Курс — главы «Руководства фасилитатора Dialogue Flow». Вопросы проверки — по руководству, согласованы 16.11.2026.
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
// Вопросы проверки знаний по «Руководству фасилитатора Dialogue Flow» — согласованы с владельцем 16.11.2026.
// answer — номер верного варианта в options (на странице варианты перемешиваются); ch — главы курса (с нуля), где об этом сказано.
const QUESTIONS = [
  { id: 'q1', ch: [1, 5], text: 'Участник спрашивает: «А что означает эта карта?» Что ответит фасилитатор?', answer: 1, options: [
    'Коротко расскажет, что задумывал художник, чтобы человеку было от чего оттолкнуться',
    'Спросит: «А что вы сами в ней увидели?»',
    'Предложит пару возможных толкований на выбор'] },
  { id: 'q2', ch: [4, 5], text: 'Разговор пары ушёл далеко от карты. Что делать?', answer: 2, options: [
    'Мягко вернуть пару к карте, чтобы разговор не потерял опору',
    'Подойти и предложить вопрос из карточки, чтобы вернуть структуру',
    'Ничего — значит, карта уже выполнила свою задачу'] },
  { id: 'q3', ch: [1, 5], text: 'В паре наступила долгая пауза. Как поступить?', answer: 0, options: [
    'Не вмешиваться — дать тишине сделать свою работу',
    'Аккуратно подойти и предложить следующий вопрос из карточки',
    'Тихо спросить пару, всё ли в порядке'] },
  { id: 'q4', ch: [1, 5], text: 'Участник расплакался во время разговора. Что делать?', answer: 2, options: [
    'Мягко остановить разговор пары и предложить небольшой перерыв',
    'Подойти и бережно перевести разговор на более лёгкую тему',
    'Спокойно принести салфетки и воду, дать почувствовать поддержку и не мешать, если человек хочет продолжать'] },
  { id: 'q5', ch: [4], text: 'Участников нечётное число. Как быть?', answer: 1, options: [
    'Предложить одному из участников понаблюдать за этим раундом',
    'Фасилитатор сам становится одним из участников',
    'Сделать одну пару из трёх человек'] },
  { id: 'q6', ch: [4], text: 'Нужно ли проходить вопросы карточки по порядку и отвечать на каждый?', answer: 1, options: [
    'Желательно по порядку: вопросы выстроены так, чтобы разговор постепенно углублялся',
    'Нет: вопросы — помощь, их можно пропускать или задавать свои',
    'Достаточно ответить хотя бы на первые три, дальше — по желанию'] },
  { id: 'q7', ch: [1, 5], text: 'Участник не хочет отвечать на вопрос. Как правильно поступить?', answer: 1, options: [
    'Мягко поддержать его и предложить попробовать ответить хотя бы коротко',
    'Это его право: можно сказать «я пока не готов об этом говорить», объяснять ничего не нужно',
    'Предложить заменить вопрос на похожий, но менее личный'] },
  { id: 'q8', ch: [2, 5], text: 'Пара закончила разговор через 15 минут. Что делать?', answer: 2, options: [
    'Предложить продолжить до конца раунда с новыми вопросами',
    'Деликатно предложить им присоединиться к другой паре',
    'Спросить, завершился ли разговор: если да — уважать это; если пара просто потерялась — предложить вопросы или деталь карты'] },
  { id: 'q9', ch: [1, 4], text: 'Что важно сказать участникам о конфиденциальности?', answer: 1, options: [
    'Что лучше не называть имён и подробностей, чтобы истории оставались анонимными',
    'Всё, чем участники делятся, остаётся между ними, если они сами не договорились иначе',
    'Что интересными историями собеседника можно делиться с друзьями, не называя автора'] },
  { id: 'q10', ch: [4], text: 'Планируется фото- или видеосъёмка. Что важно?', answer: 1, options: [
    'Снимать ненавязчиво, чтобы не сбивать атмосферу, а согласие спросить после встречи',
    'Предупредить заранее, не записывать звук самих разговоров и дать каждому отказаться без объяснений',
    'Снимать только общие планы, а тех, кто против, потом размыть на видео'] },
];
function application(userId) {
  const a = db.prepare('SELECT * FROM fac_applications WHERE user_id = ?').get(userId);
  if (!a) return null;
  return { status: a.status, courseDone: JSON.parse(a.course_done), answers: JSON.parse(a.answers), about: a.about, city: a.city,
    decisionNote: a.decision_note, decidedAt: a.decided_at, createdAt: a.created_at, updatedAt: a.updated_at,
    quiz: quizInfo(a), manualReview: !!a.manual_review };
}
// Попытки проверки (задание 18.11.2026): первые две — только сколько верно; после третьей неудачной — номера вопросов
// с ошибками и ссылки на главы руководства к ним; если и после этого ошибка — можно отправить на ручную проверку. Ни проверка, ни ручная отправка роль не дают — только решение администратора.
const QUIZ = { numbersAfter: 3, chaptersAfter: 3, manualAfter: 4 };
function quizInfo(a) {
  const n = a.quiz_attempts || 0; const wrong = JSON.parse(a.quiz_wrong || '[]'); const passed = !!a.quiz_passed;
  const out = { attempts: n, passed, total: QUESTIONS.length, correct: n ? QUESTIONS.length - wrong.length : null };
  if (!passed && n >= QUIZ.numbersAfter) out.wrongNumbers = wrong.map((id) => QUESTIONS.findIndex((q) => q.id === id) + 1).filter((x) => x > 0);
  if (!passed && n >= QUIZ.chaptersAfter) out.chapters = Object.fromEntries(wrong.map((id) => [QUESTIONS.findIndex((q) => q.id === id) + 1, (QUESTIONS.find((q) => q.id === id) || {}).ch || []]));
  out.canManual = !passed && n >= QUIZ.manualAfter && wrong.length > 0;
  return out;
}
function checkQuiz(user, answers) {
  const a = db.prepare('SELECT * FROM fac_applications WHERE user_id = ?').get(user.id);
  if (!a) return { error: 'not_started' };
  if (!['in_progress', 'rejected'].includes(a.status)) return { error: 'locked', status: a.status };
  if (JSON.parse(a.course_done).length < COURSE.length) return { error: 'course_not_finished' };
  const ans = { ...JSON.parse(a.answers), ...(answers && typeof answers === 'object' ? answers : {}) };
  const wrong = QUESTIONS.filter((q) => Number(ans[q.id]) !== q.answer || ans[q.id] === undefined || ans[q.id] === null).map((q) => q.id);
  db.prepare(`UPDATE fac_applications SET answers = ?, quiz_attempts = quiz_attempts + 1, quiz_wrong = ?, quiz_passed = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
    .run(JSON.stringify(ans), JSON.stringify(wrong), wrong.length ? 0 : 1, a.id);
  return { ok: true, quiz: quizInfo(db.prepare('SELECT * FROM fac_applications WHERE id = ?').get(a.id)) };
}
/** Ручная проверка: после всех попыток с подсказками заявку с ответами можно отправить администратору. */
function manualReview(user, { about, city } = {}) {
  const a = db.prepare('SELECT * FROM fac_applications WHERE user_id = ?').get(user.id);
  if (!a) return { error: 'not_started' };
  if (!['in_progress', 'rejected'].includes(a.status)) return { error: 'locked', status: a.status };
  if (!quizInfo(a).canManual) return { error: 'manual_not_available' };
  db.prepare(`UPDATE fac_applications SET status = 'submitted', manual_review = 1, about = ?, city = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
    .run(String(about ?? a.about).slice(0, 2000), String(city ?? a.city).slice(0, 100), a.id);
  return { ok: true };
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
  db.prepare(`UPDATE fac_applications SET status = 'submitted', manual_review = 0, quiz_passed = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(a.id);
  return { ok: true };
}
function applications(showDemo) {
  return db.prepare(`SELECT * FROM fac_applications WHERE ${showDemo ? '1=1' : 'is_demo = 0'} ORDER BY updated_at DESC`).all()
    .map((a) => ({ userId: a.user_id, name: userName(a.user_id), status: a.status, city: a.city, about: a.about,
      courseDone: JSON.parse(a.course_done).length, quizPassed: quizPassed(JSON.parse(a.answers)), updatedAt: a.updated_at, isDemo: !!a.is_demo,
      manualReview: !!a.manual_review, quizAttempts: a.quiz_attempts || 0,
      // для ручной проверки администратор видит ответы: вопрос, выбранный вариант, верен ли он
      answers: a.manual_review ? QUESTIONS.map((q, i) => { const v = JSON.parse(a.answers)[q.id]; return { n: i + 1, text: q.text, chosen: v != null && q.options[v] ? q.options[v] : null, right: Number(v) === q.answer }; }) : undefined }));
}
function decideApplication(adminId, userId, approve, note = '') {
  const a = db.prepare('SELECT * FROM fac_applications WHERE user_id = ?').get(userId);
  if (!a) return { error: 'not_found' };
  db.prepare(`UPDATE fac_applications SET status = ?, decision_note = ?, decided_by = ?, decided_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(approve ? 'approved' : 'rejected', String(note).slice(0, 1000), adminId, a.id);
  if (approve) db.prepare(`INSERT OR IGNORE INTO user_roles (user_id, role, granted_by) VALUES (?, 'facilitator', ?)`).run(userId, adminId);
  return { ok: true };
}

// ---------- заявка на роль куратора ----------
const curApp = (a) => a && { status: a.status, name: a.name, contact: a.contact, motivation: a.motivation, decisionNote: a.decision_note, decidedAt: a.decided_at, createdAt: a.created_at };
function curatorApplication(userId) { return curApp(db.prepare('SELECT * FROM curator_applications WHERE user_id = ?').get(userId)); }
function submitCuratorApplication(user, { name, contact, motivation }) {
  const n = String(name || '').trim().slice(0, 100); const c = String(contact || '').trim().slice(0, 200); const m = String(motivation || '').trim().slice(0, 2000);
  if (!n) return { error: 'name_required' };
  if (!c) return { error: 'contact_required' };
  if (!m) return { error: 'motivation_required' };
  const old = db.prepare('SELECT * FROM curator_applications WHERE user_id = ?').get(user.id);
  if (old && old.status === 'submitted') return { error: 'already_submitted' };
  if (old && old.status === 'approved') return { error: 'already_curator' };
  if (old) db.prepare(`UPDATE curator_applications SET name=?, contact=?, motivation=?, status='submitted', decision_note='', decided_at=NULL, decided_by=NULL, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(n, c, m, old.id);
  else db.prepare('INSERT INTO curator_applications (user_id, name, contact, motivation, is_demo) VALUES (?, ?, ?, ?, ?)').run(user.id, n, c, m, user.is_demo ? 1 : 0);
  return { ok: true };
}
function curatorApplications(showDemo) {
  return db.prepare(`SELECT * FROM curator_applications WHERE ${showDemo ? '1=1' : 'is_demo = 0'} ORDER BY CASE status WHEN 'submitted' THEN 0 ELSE 1 END, updated_at DESC`).all()
    .map((a) => ({ userId: a.user_id, accountName: userName(a.user_id), ...curApp(a), updatedAt: a.updated_at, isDemo: !!a.is_demo }));
}
function decideCuratorApplication(adminId, userId, approve, note = '') {
  const a = db.prepare('SELECT * FROM curator_applications WHERE user_id = ?').get(userId);
  if (!a) return { error: 'not_found' };
  db.prepare(`UPDATE curator_applications SET status = ?, decision_note = ?, decided_by = ?, decided_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(approve ? 'approved' : 'rejected', String(note).slice(0, 1000), adminId, a.id);
  if (approve) db.prepare(`INSERT OR IGNORE INTO user_roles (user_id, role, granted_by) VALUES (?, 'curator', ?)`).run(userId, adminId);
  return { ok: true };
}

module.exports = {
  forward,
  curatorApplication, submitCuratorApplication, curatorApplications, decideCuratorApplication,
  comments, addComment, deleteComment, recentComments, ROOMS, CATEGORIES, canRoom, userCanRoom, chat, people, post, deleteMessage, restoreMessage, modLog, markRead, excerpt, media, attachmentFile, rooms, members,
  COURSE, QUESTIONS, application, startApplication, saveApplication, submitApplication, checkQuiz, manualReview, applications, decideApplication,
};
