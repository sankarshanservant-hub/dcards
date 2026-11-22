// События колокольчика по каталогу задания 18.11.2026 — привязаны к реально существующим операциям.
// Вызываются после успешного сохранения. Получатели — по связи с объектом и текущим правам; одно событие — одна запись
// человеку; однотипные события по одному объекту сворачиваются (group) с актуальным числом.
const db = require('./db');
const bell = require('./bell');
const community = require('./community');

const nm = (id) => { const u = id && db.prepare('SELECT name, public_name FROM users WHERE id = ?').get(id); return u ? (u.public_name || u.name) : ''; };
const ROOM = { general: 'общем чате', curators: 'чате кураторов', facilitators: 'чате фасилитаторов' };

/** Чат: ответ на сообщение и упоминание — адресату (одна запись, если и то и другое). Обычная переписка — только в чате. */
function chatMessage(messageId) {
  const m = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(messageId);
  if (!m || m.deleted_at) return;
  const to = new Map();
  if (m.reply_to) { const o = db.prepare('SELECT user_id FROM chat_messages WHERE id = ?').get(m.reply_to); if (o && o.user_id !== m.user_id) to.set(o.user_id, 'reply'); }
  let ment = []; try { ment = JSON.parse(m.mentions || '[]'); } catch { /* */ }
  for (const id of ment.map(Number)) if (id !== m.user_id) to.set(id, to.has(id) ? 'both' : 'mention');
  for (const [uid, why] of to) {
    if (!community.userCanRoom(m.room, uid)) continue; // права изменились — не пишем
    bell.add({ userId: uid }, { kind: 'chat', title: why === 'mention' ? `Тебя упомянули в ${ROOM[m.room] || 'чате'}` : `Тебе ответили в ${ROOM[m.room] || 'чате'}`,
      body: nm(m.user_id), url: `/team/${m.room}?m=${m.id}`, dedupe: `m:${m.id}`, isDemo: !!m.is_demo, push: false }); // push о чатах — своими настройками (push.js)
  }
}

// ---------- встречи ----------
const regTarget = (r) => (r.user_id ? { userId: r.user_id } : r.visitor_id ? { visitorId: r.visitor_id } : null);
function dateInfo(dateId) {
  const d = db.prepare('SELECT * FROM meeting_dates WHERE id = ?').get(dateId);
  const m = d && db.prepare('SELECT * FROM meetings WHERE id = ?').get(d.meeting_id);
  return { d, m };
}
const active = (dateId) => db.prepare("SELECT COUNT(*) AS n FROM registrations WHERE date_id = ? AND status = 'active'").get(dateId).n;
/** Фасилитатору — записи и отмены по его дате одной обновляемой записью. */
function facilitatorDate(dateId) {
  const { d, m } = dateInfo(dateId); if (!m) return;
  bell.add({ userId: m.facilitator_id }, { kind: 'registrations', title: `Записи на «${m.title}»`, body: `Сейчас записано: ${active(d.id)} из ${d.capacity}`,
    url: `/facilitator/m/${m.id}`, group: `reg:date:${d.id}`, isDemo: !!m.is_demo, push: false });
}
function registered(regToken) {
  const r = db.prepare('SELECT * FROM registrations WHERE token = ?').get(regToken); if (!r) return;
  const { m } = dateInfo(r.date_id);
  const t = regTarget(r);
  if (t) bell.add(t, { kind: 'registration', title: 'Вы записаны на встречу', body: m.title, url: `/r/${r.token}`, dedupe: `reg:${r.id}:ok`, isDemo: !!r.is_demo, push: false });
  facilitatorDate(r.date_id);
}
function registrationCancelled(regToken) {
  const r = db.prepare('SELECT * FROM registrations WHERE token = ?').get(regToken); if (r) facilitatorDate(r.date_id);
}
/** Организатор отменил дату — участникам этой даты (с действующей привязкой к записи в этом браузере или аккаунте). */
function dateCancelled(dateId, actorId) {
  const { d, m } = dateInfo(dateId); if (!m) return;
  for (const r of db.prepare("SELECT * FROM registrations WHERE date_id = ? AND status = 'active'").all(d.id)) {
    const t = regTarget(r); if (t) bell.add(t, { kind: 'registration', title: 'Дата встречи отменена организатором', body: m.title, url: `/r/${r.token}`, dedupe: `date:${d.id}:cancelled:${r.id}`, isDemo: !!m.is_demo });
  }
  if (actorId && actorId !== m.facilitator_id) bell.add({ userId: m.facilitator_id }, { kind: 'meeting_admin', title: 'Администратор отменил дату вашей встречи', body: m.title, url: `/facilitator/m/${m.id}`, dedupe: `date:${d.id}:cancelled:fac`, isDemo: !!m.is_demo });
}
/** Изменилось место встречи — участникам будущих дат. */
function placeChanged(meetingId, before, actorId) {
  const m = db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId); if (!m || !before) return;
  if ([m.venue, m.city, m.country].join('|') === [before.venue, before.city, before.country].join('|')) return;
  const stamp = Date.now();
  for (const r of db.prepare(`SELECT r.* FROM registrations r JOIN meeting_dates d ON d.id = r.date_id WHERE d.meeting_id = ? AND r.status = 'active' AND d.starts_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now')`).all(m.id)) {
    const t = regTarget(r); if (t) bell.add(t, { kind: 'registration', title: 'Изменилось место встречи', body: `${m.title}: ${[m.venue, m.city].filter(Boolean).join(', ')}`, url: `/r/${r.token}`, dedupe: `place:${m.id}:${stamp}:${r.id}`, isDemo: !!m.is_demo });
  }
  if (actorId && actorId !== m.facilitator_id) bell.add({ userId: m.facilitator_id }, { kind: 'meeting_admin', title: 'Администратор изменил вашу встречу', body: m.title, url: `/facilitator/m/${m.id}`, dedupe: `place:${m.id}:${stamp}:fac`, isDemo: !!m.is_demo });
}
/** Администратор снял встречу из публичной выдачи — только фасилитатору (это не отмена для участников). */
function meetingRemoved(meetingId) {
  const m = db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId); if (!m) return;
  bell.add({ userId: m.facilitator_id }, { kind: 'meeting_admin', title: 'Администратор снял встречу с публикации', body: m.title, url: `/facilitator/m/${m.id}`, dedupe: `removed:${m.id}:${Date.now()}`, isDemo: !!m.is_demo });
}

// ---------- заявки на роли ----------
function applicationSubmitted(kind, userId, { manual = false } = {}) {
  const u = db.prepare('SELECT is_demo FROM users WHERE id = ?').get(userId) || {};
  const title = kind === 'facilitator' ? (manual ? 'Ручная проверка ответов фасилитатора' : 'Новая заявка на роль фасилитатора') : 'Новая заявка на роль куратора';
  for (const a of bell.usersWithRole('admin', !!u.is_demo)) {
    if (a === userId) continue;
    bell.add({ userId: a }, { kind: 'admin_application', title, body: nm(userId), url: '/admin/applications', group: `app:${kind}:${userId}`, isDemo: !!u.is_demo });
  }
}
function applicationDecided(kind, userId, approve) {
  bell.resolve(`app:${kind}:${userId}`, approve ? 'Заявка одобрена' : 'Заявка рассмотрена', nm(userId)); // задача закрыта у всех администраторов
  const role = kind === 'facilitator' ? 'фасилитатора' : 'куратора';
  bell.add({ userId }, { kind: 'application', title: approve ? `Заявка на роль ${role} одобрена` : `Заявка на роль ${role} не одобрена`,
    body: approve ? 'Открылся ваш кабинет' : 'Причина — в заявке', url: approve ? (kind === 'facilitator' ? '/facilitator' : '/curator') : (kind === 'facilitator' ? '/facilitator/apply' : '/curator/apply'),
    dedupe: `app:${kind}:${userId}:${Date.now()}` });
}

// ---------- работы авторов ----------
const queueCount = (demo) => db.prepare(`SELECT COUNT(*) AS n FROM works WHERE status IN ('submitted','discussion') AND recommended_at IS NULL AND is_demo = ?`).get(demo ? 1 : 0).n;
/** Новая работа или версия на проверке — кураторам одной обновляемой записью «в общей очереди N работ». */
function worksQueued(demo, actorId) {
  const n = queueCount(demo); if (!n) return;
  for (const c of bell.usersWithRole('curator', demo)) {
    if (c === actorId) continue;
    bell.add({ userId: c }, { kind: 'curator_queue', title: 'Новые работы на проверке', body: `В общей очереди: ${n}`, url: '/curator', group: 'curator:queue', count: n, isDemo: demo, push: false });
  }
}
function workDiscussed(workId, actorId) {
  const w = db.prepare('SELECT * FROM works WHERE id = ?').get(workId); if (!w) return;
  for (const c of bell.usersWithRole('curator', !!w.is_demo)) {
    if (c === actorId) continue;
    bell.add({ userId: c }, { kind: 'curator_discuss', title: 'Работу вынесли на обсуждение', body: `Работа №${w.id} · ${nm(actorId)}`, url: `/curator/works/${w.id}`, dedupe: `discuss:${w.id}`, isDemo: !!w.is_demo, push: false });
  }
}
/** Куратор рекомендовал — администраторам задача на окончательное решение (возвраты и отказы задач не создают). */
function workRecommended(workId, curatorId) {
  const w = db.prepare('SELECT * FROM works WHERE id = ?').get(workId); if (!w) return;
  for (const a of bell.usersWithRole('admin', !!w.is_demo)) {
    if (a === curatorId) continue;
    bell.add({ userId: a }, { kind: 'admin_recommendation', title: 'Иллюстрацию рекомендуют к публикации', body: `Работа №${w.id} · ${nm(w.artist_id)}`, url: '/admin/works', group: `rec:${w.id}`, isDemo: !!w.is_demo });
  }
  worksQueued(!!w.is_demo, curatorId);
}
const OUTCOME = { approve: ['work_published', 'Работа опубликована'], return: ['work_returned', 'Работа возвращена на доработку'], reject: ['work_rejected', 'Работа отклонена'] };
/** Решение по работе: автору (push — отдельно в push.js), закрыть задачу администраторов, рекомендовавшему — итог. */
function workDecided(decisionId) {
  const d = db.prepare('SELECT * FROM decisions WHERE id = ?').get(decisionId); if (!d || !OUTCOME[d.action]) return;
  const w = db.prepare('SELECT * FROM works WHERE id = ?').get(d.work_id); if (!w) return;
  const [kind, title] = OUTCOME[d.action];
  bell.add({ userId: w.artist_id }, { kind, title, body: `Работа №${w.id}, версия ${d.version_n}`, url: `/artist/works/${w.id}`, dedupe: `decision:${d.id}`, isDemo: !!w.is_demo, push: false });
  bell.resolve(`rec:${w.id}`, `${title} (решение принято)`, null);
  const rec = db.prepare("SELECT actor_id FROM decisions WHERE work_id = ? AND action = 'recommend' ORDER BY id DESC LIMIT 1").get(w.id);
  if (rec && d.action === 'approve' && rec.actor_id !== d.actor_id) bell.add({ userId: rec.actor_id }, { kind: 'curator_outcome', title: 'Рекомендованная вами работа опубликована', body: `Работа №${w.id}`, url: `/curator/works/${w.id}`, dedupe: `outcome:${d.id}`, isDemo: !!w.is_demo, push: false });
  worksQueued(!!w.is_demo, null);
}

module.exports = { chatMessage, registered, registrationCancelled, dateCancelled, placeChanged, meetingRemoved, applicationSubmitted, applicationDecided, worksQueued, workDiscussed, workRecommended, workDecided };
