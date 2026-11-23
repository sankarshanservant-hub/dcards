// Колокольчик — личная история событий (18.11.2026). Получатель — аккаунт (user_id) или гость (visitor_id: случайный
// идентификатор этого браузера). Запись появляется после успешного сохранения изменения; одно событие — одна запись
// человеку (dedupe). Однотипные события по одному объекту (например, записи на одну дату) сворачиваются в одну
// обновляемую запись с актуальным числом (group). Открытие списка ничего не помечает прочитанным.
// Push лишь приглашает вернуться: нейтральный текст без личных ответов и причин решений.
const db = require('./db');

db.exec(`CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id), visitor_id TEXT,
  kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '',
  dedupe TEXT,                 -- одно событие — одна запись (например, x:12:answered)
  grp TEXT,                    -- свёртка однотипных (например, reg:date:5) — запись обновляется
  count INTEGER NOT NULL DEFAULT 1,
  resolved INTEGER NOT NULL DEFAULT 0,   -- задача уже решена (другим администратором и т. п.)
  read_at TEXT, is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, id);
CREATE INDEX IF NOT EXISTS idx_notif_visitor ON notifications(visitor_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS notif_dedupe_u ON notifications(user_id, dedupe) WHERE dedupe IS NOT NULL AND user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS notif_dedupe_v ON notifications(visitor_id, dedupe) WHERE dedupe IS NOT NULL AND visitor_id IS NOT NULL;`);

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
let pushHook = null; // push.js подключает себя (без циклического require)
function onPush(fn) { pushHook = fn; }

/** Заголовки push по виду события (23.11.2026: «Друг ответил» вместо общего). */
const PUSH_TITLE = { exchange_answered: ['Друг ответил', 'Your friend answered'], eagle_answered: ['Друг ответил', 'Your friend answered'] };
/** Нейтральные тексты для экрана блокировки — без имён, ответов и причин. */
const PUSH_TEXT = {
  exchange_answered: 'Открой, чтобы сравнить ваши ответы', eagle_answered: 'Открой, чтобы сравнить ваши ответы', story_proposed: 'Вам предложили поделиться ответами в сторис', story_agreed: 'Друг согласился поделиться в сторис',
  work_published: 'Решение по вашей работе', work_returned: 'Решение по вашей работе', work_rejected: 'Решение по вашей работе',
  application: 'Новости по вашей заявке', registration: 'Новости по вашей записи на встречу', meeting_new: 'Новая встреча Dialogue Flow',
};
const PUSH_TEXT_EN = {
  exchange_answered: 'Open to compare your answers', eagle_answered: 'Open to compare your answers', story_proposed: 'You were invited to share your answers in Instagram Stories', story_agreed: 'Your friend agreed to share in Instagram Stories',
  work_published: 'A decision on your work', work_returned: 'A decision on your work', work_rejected: 'A decision on your work',
  application: 'News about your application', registration: 'News about your meeting registration', meeting_new: 'A new Dialogue Flow meeting',
};

/**
 * to: { userId } | { visitorId }; n: { kind, title, body, url, dedupe?, group?, isDemo?, push? }
 * Возвращает id записи или null (повтор того же события).
 */
function add(to, n) {
  const uid = to.userId || null; const vid = uid ? null : (to.visitorId || null);
  if (!uid && !vid) return null;
  if (uid && db.prepare('SELECT is_demo FROM users WHERE id = ?').get(uid)?.is_demo && !n.isDemo) n = { ...n, isDemo: true };
  const who = uid ? ['user_id = ?', uid] : ['visitor_id = ?', vid];
  if (n.group) {
    const ex = db.prepare(`SELECT * FROM notifications WHERE ${who[0]} AND grp = ? AND resolved = 0 ORDER BY id DESC LIMIT 1`).get(who[1], n.group);
    if (ex) {
      db.prepare(`UPDATE notifications SET title = ?, body = ?, url = ?, count = ?, read_at = NULL, updated_at = ${NOW} WHERE id = ?`)
        .run(n.title, n.body || '', n.url || '', n.count || ex.count + 1, ex.id);
      return ex.id;
    }
  }
  const info = db.prepare(`INSERT OR IGNORE INTO notifications (user_id, visitor_id, kind, title, body, url, dedupe, grp, count, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(uid, vid, n.kind, n.title, n.body || '', n.url || '', n.dedupe || null, n.group || null, n.count || 1, n.isDemo ? 1 : 0);
  if (!info.changes) return null;
  const id = Number(info.lastInsertRowid);
  if (uid && n.push !== false && pushHook) {
    const en = (db.prepare('SELECT lang FROM users WHERE id = ?').get(uid) || {}).lang === 'en';
    pushHook(uid, { title: PUSH_TITLE[n.kind] ? (en ? PUSH_TITLE[n.kind][1] : PUSH_TITLE[n.kind][0]) : 'Dialogue Cards', body: en ? (PUSH_TEXT_EN[n.kind] || 'Something new in D-Cards') : (PUSH_TEXT[n.kind] || 'Новое событие в D-Cards'), url: n.url, tag: `dc-n${id}` }, n.kind);
  }
  return id;
}
/** Задача решена (например, работу опубликовал другой администратор): запись остаётся, но показывает актуальный итог. */
function resolve(group, title, body) {
  db.prepare(`UPDATE notifications SET resolved = 1, title = COALESCE(?, title), body = COALESCE(?, body), updated_at = ${NOW} WHERE grp = ? AND resolved = 0`).run(title || null, body || null, group);
}
const out = (r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, url: r.url, count: r.count, resolved: !!r.resolved, read: !!r.read_at, createdAt: r.created_at, updatedAt: r.updated_at });
function whoSql(user, visitor) {
  if (user) return ['user_id = ?', [user.id]];
  if (visitor) return ['visitor_id = ?', [visitor]];
  return null;
}
function list(user, visitor, showDemo) {
  const w = whoSql(user, visitor); if (!w) return { items: [], unread: 0 };
  const demo = showDemo ? '' : ' AND is_demo = 0';
  const items = db.prepare(`SELECT * FROM notifications WHERE ${w[0]}${demo} ORDER BY updated_at DESC, id DESC LIMIT 100`).all(...w[1]).map(out);
  const unread = db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE ${w[0]}${demo} AND read_at IS NULL`).get(...w[1]).n;
  return { items, unread };
}
function markRead(user, visitor, ids) {
  const w = whoSql(user, visitor); if (!w) return { ok: true };
  if (ids === 'all') db.prepare(`UPDATE notifications SET read_at = ${NOW} WHERE ${w[0]} AND read_at IS NULL`).run(...w[1]);
  else for (const id of (ids || []).map(Number).filter(Boolean)) db.prepare(`UPDATE notifications SET read_at = ${NOW} WHERE id = ? AND ${w[0]} AND read_at IS NULL`).run(id, ...w[1]);
  return { ok: true };
}
/** Вход гостя: его история переходит в аккаунт (только записи этого браузера). */
function claim(visitor, userId) {
  if (!visitor) return 0;
  return db.prepare('UPDATE OR IGNORE notifications SET user_id = ?, visitor_id = NULL WHERE visitor_id = ?').run(userId, visitor).changes;
}
/** Обладатели роли (администратор — только если роль 'admin'). Для демо-объектов — демо-пользователи, для настоящих — настоящие. */
const usersWithRole = (role, demo = false) => db.prepare(`SELECT DISTINCT u.id FROM users u JOIN user_roles r ON r.user_id = u.id WHERE r.role = ? AND u.is_demo = ?`).all(role, demo ? 1 : 0).map((x) => x.id);

module.exports = { add, resolve, list, markRead, claim, onPush, usersWithRole };
