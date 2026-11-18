// Push-уведомления (Web Push, VAPID) о сообщениях в чатах. Только по согласию человека; email о чатах не отправляется.
// Ключи VAPID создаются один раз и хранятся в DATA_DIR/vapid.json (не в репозитории).
// Кому: автору сообщения, на которое ответили («Ответы на мои сообщения»), упомянутым («Упоминания меня»),
// и тем, кто включил для комнаты «Все сообщения». Одно сообщение — не больше одного уведомления человеку.
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const db = require('./db');
const community = require('./community');

const config = require('./config');
const DATA_DIR = config.dataDir;
const SUBJECT = process.env.VAPID_SUBJECT || (process.env.PUBLIC_URL ? process.env.PUBLIC_URL.replace(/\/$/, '') + config.basePath + '/' : 'https://harekrishna.info/dialogue-cards/');
const MODES = ['all', 'mentions', 'none'];
const ROOM_TITLE = { general: 'Общий чат', curators: 'Чат кураторов', facilitators: 'Чат фасилитаторов' };

let keys = null;
// Порядок: ключи из окружения (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, например в /etc/dcards.env — там их можно хранить
// вместе с паролем владельца), затем DATA_DIR/vapid.json, иначе создаются новые. Потеря ключей не опасна: браузеры
// с разрешением сами переподпишутся на новый ключ при следующем открытии сайта (public/js/push.js, syncPush).
function vapid() {
  if (keys) return keys;
  const file = path.join(DATA_DIR, 'vapid.json');
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) keys = { publicKey: process.env.VAPID_PUBLIC_KEY.trim(), privateKey: process.env.VAPID_PRIVATE_KEY.trim() };
  else try { keys = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* ещё нет */ }
  if (!keys || !keys.publicKey || !keys.privateKey) {
    keys = webpush.generateVAPIDKeys();
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
  }
  webpush.setVapidDetails(SUBJECT, keys.publicKey, keys.privateKey);
  return keys;
}

// Можно подменить в тестах (сеть к push-сервисам в тестовой среде закрыта).
let sender = (sub, payload, opts) => webpush.sendNotification(sub, payload, opts);
function setSender(fn) { sender = fn; }

const prefsOf = (userId) => {
  const p = db.prepare('SELECT * FROM notify_prefs WHERE user_id = ?').get(userId);
  return { enabled: p ? !!p.enabled : true, replies: p ? !!p.replies : true, mentions: p ? !!p.mentions : true, works: p ? p.works !== 0 : true };
};
function setPrefs(userId, { enabled, replies, mentions, works }) {
  const cur = prefsOf(userId);
  const v = { enabled: enabled ?? cur.enabled, replies: replies ?? cur.replies, mentions: mentions ?? cur.mentions, works: works ?? cur.works };
  db.prepare(`INSERT INTO notify_prefs (user_id, enabled, replies, mentions, works) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET enabled = excluded.enabled, replies = excluded.replies, mentions = excluded.mentions, works = excluded.works`)
    .run(userId, v.enabled ? 1 : 0, v.replies ? 1 : 0, v.mentions ? 1 : 0, v.works ? 1 : 0);
  return prefsOf(userId);
}
const roomMode = (userId, room) => (db.prepare('SELECT mode FROM chat_notify WHERE user_id = ? AND room = ?').get(userId, room) || {}).mode || 'mentions';
function setRoomMode(userId, room, mode) {
  if (!MODES.includes(mode)) return { error: 'bad_mode' };
  db.prepare(`INSERT INTO chat_notify (user_id, room, mode) VALUES (?, ?, ?) ON CONFLICT(user_id, room) DO UPDATE SET mode = excluded.mode`).run(userId, room, mode);
  return { ok: true, mode };
}

function subscribe(user, sub, ua = '') {
  if (user.is_demo) return { error: 'push_demo' }; // демо-аккаунты общие — уведомления пришли бы чужим людям
  const s = sub || {};
  const endpoint = String(s.endpoint || '');
  const k = s.keys || {};
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !k.p256dh || !k.auth) return { error: 'bad_subscription' };
  db.prepare(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, ua) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua, last_error = NULL`)
    .run(user.id, endpoint, String(k.p256dh).slice(0, 200), String(k.auth).slice(0, 100), String(ua).slice(0, 200));
  return { ok: true };
}
function unsubscribe(user, endpoint) {
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(user.id, String(endpoint || ''));
  return { ok: true };
}
function status(user) {
  const subs = db.prepare('SELECT endpoint, created_at, last_ok_at, last_error FROM push_subscriptions WHERE user_id = ?').all(user.id);
  return { publicKey: vapid().publicKey, devices: subs.length, subscriptions: subs.map((s) => ({ endpoint: s.endpoint, lastOkAt: s.last_ok_at, lastError: s.last_error })), prefs: prefsOf(user.id) };
}

async function deliver(userId, payload) {
  vapid();
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
  let sent = 0;
  for (const s of subs) {
    try {
      await sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 86400, urgency: 'normal' });
      db.prepare("UPDATE push_subscriptions SET last_ok_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), last_error = NULL WHERE id = ?").run(s.id);
      sent++;
    } catch (e) {
      const code = e && e.statusCode;
      if (code === 404 || code === 410) db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id); // подписка больше не действует
      else db.prepare('UPDATE push_subscriptions SET last_error = ? WHERE id = ?').run(String((e && (e.body || e.message)) || e).slice(0, 300), s.id);
    }
  }
  return sent;
}

/** Кому и почему отправить уведомление о новом сообщении. → Map(userId → 'reply' | 'mention' | 'reply_mention' | 'all') */
function recipients(messageId) {
  const m = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(messageId);
  if (!m || m.deleted_at) return new Map();
  const out = new Map();
  const add = (uid, why) => {
    if (!uid || uid === m.user_id) return;
    const prev = out.get(uid);
    if (!prev) out.set(uid, why);
    else if ((prev === 'reply' && why === 'mention') || (prev === 'mention' && why === 'reply')) out.set(uid, 'reply_mention');
  };
  if (m.reply_to) { const o = db.prepare('SELECT user_id FROM chat_messages WHERE id = ?').get(m.reply_to); if (o) add(o.user_id, 'reply'); }
  let ment = []; try { ment = JSON.parse(m.mentions || '[]'); } catch { /* */ }
  for (const id of ment) add(Number(id), 'mention');
  for (const r of db.prepare("SELECT user_id FROM chat_notify WHERE room = ? AND mode = 'all'").all(m.room)) if (!out.has(r.user_id)) add(r.user_id, 'all');
  // фильтры: доступ к комнате, демо, общий переключатель, режим комнаты, категории
  for (const [uid, why] of [...out]) {
    const u = db.prepare('SELECT id, is_demo FROM users WHERE id = ?').get(uid);
    const p = prefsOf(uid); const mode = roomMode(uid, m.room);
    const catOk = why === 'all' ? true : why === 'reply' ? p.replies : why === 'mention' ? p.mentions : (p.replies || p.mentions);
    const ok = u && !u.is_demo && !(m.is_demo && !u.is_demo) && community.userCanRoom(m.room, uid) && p.enabled && mode !== 'none'
      && (mode === 'all' || (why !== 'all' && catOk));
    if (!ok) out.delete(uid);
  }
  return out;
}

const B = config.basePath;
/** После сохранения сообщения: уведомления в фоне. Повторно об одном сообщении не уведомляем (push_log). */
function onMessage(messageId) {
  const m = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(messageId);
  if (!m) return Promise.resolve([]);
  const author = (db.prepare('SELECT COALESCE(NULLIF(public_name, \'\'), name) AS n FROM users WHERE id = ?').get(m.user_id) || {}).n || '';
  const jobs = [];
  for (const [uid, why] of recipients(messageId)) {
    const fresh = db.prepare('INSERT OR IGNORE INTO push_log (user_id, message_id, reason) VALUES (?, ?, ?)').run(uid, messageId, why).changes;
    if (!fresh) continue;
    const lead = why === 'all' ? '' : why === 'mention' ? 'Упомянул(а) вас: ' : 'Ответ: ';
    const body = lead + (community.excerpt(m.text, 120) || 'Изображение');
    jobs.push(deliver(uid, { title: `${author} · ${ROOM_TITLE[m.room] || 'Чат'}`, body, url: `${B}/team/${m.room}?m=${m.id}`, tag: `dc-m${m.id}` }).then((n) => ({ uid, why, sent: n })));
  }
  return Promise.all(jobs);
}
/**
 * Автору — об изменении статуса работы: фактическая публикация (решение администратора), возврат на доработку, отклонение.
 * Одно уведомление на решение (push_work_log); рекомендация кураторов и обсуждение автору не приходят. Нажатие открывает работу.
 */
const WORK_TEXT = { approve: 'Работа опубликована в галерее', return: 'Работу вернули на доработку — причина в кабинете', reject: 'Работа отклонена — причина в кабинете' };
function onWorkDecision(decisionId) {
  const d = db.prepare('SELECT * FROM decisions WHERE id = ?').get(decisionId);
  if (!d || !WORK_TEXT[d.action]) return Promise.resolve(0);
  const w = db.prepare('SELECT * FROM works WHERE id = ?').get(d.work_id);
  const u = w && db.prepare('SELECT id, is_demo FROM users WHERE id = ?').get(w.artist_id);
  if (!u || u.is_demo || w.is_demo) return Promise.resolve(0);
  const p = prefsOf(u.id); if (!p.enabled || !p.works) return Promise.resolve(0);
  if (!db.prepare('INSERT OR IGNORE INTO push_work_log (decision_id, user_id) VALUES (?, ?)').run(d.id, u.id).changes) return Promise.resolve(0);
  return deliver(u.id, { title: 'Dialogue Cards · Мои работы', body: WORK_TEXT[d.action], url: `${B}/artist/works/${w.id}`, tag: `dc-w${w.id}-${d.id}` });
}
/** Проверочное уведомление — по нажатию самого человека. */
function test(user) {
  return deliver(user.id, { title: 'Dialogue Cards', body: 'Уведомления включены. Так будут приходить ответы и упоминания.', url: `${B}/me/notifications`, tag: 'dc-test' });
}

// Колокольчик приглашает вернуться push-уведомлением (нейтральный текст) — по общим настройкам человека.
require('./bell').onPush((uid, payload, kind) => {
  const u = db.prepare('SELECT is_demo FROM users WHERE id = ?').get(uid); if (!u || u.is_demo) return;
  const p = prefsOf(uid); if (!p.enabled) return;
  if (/^work_/.test(kind)) return; // о решениях по работам — onWorkDecision (своя настройка «Решения по моим работам»)
  deliver(uid, payload).catch(() => {});
});

module.exports = { vapid, subscribe, unsubscribe, status, prefsOf, setPrefs, roomMode, setRoomMode, recipients, onMessage, onWorkDecision, test, setSender, MODES };
