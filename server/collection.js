// Изменения в коллекции (25.11.2026): история для фасилитаторов, уведомления об удалении и обновлении карт,
// окончательное удаление файлов, задачи администрации по внешним материалам.
// Фасилитаторы печатают карты сами, учёта распечаток нет — об удалении узнают ВСЕ фасилитаторы (важное уведомление + письмо).
// В уведомлениях — только номер карты (и версия), без изображения, ссылок на файл, причины и данных автора.
const fs = require('fs');
const path = require('path');
const db = require('./db');
const config = require('./config');
const bell = require('./bell');
const mail = require('./mail');

db.exec(`
CREATE TABLE IF NOT EXISTS collection_changes (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('added','updated','removed','version_revoked')),
  card_id INTEGER, code TEXT NOT NULL, version_label TEXT NOT NULL DEFAULT '', by TEXT NOT NULL DEFAULT '', is_demo INTEGER NOT NULL DEFAULT 0,
  event_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS fac_mail (
  id INTEGER PRIMARY KEY, change_id INTEGER NOT NULL REFERENCES collection_changes(id), user_id INTEGER NOT NULL, email TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'ru', status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','not_connected')),
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), UNIQUE (change_id, user_id)
);
CREATE TABLE IF NOT EXISTS removal_tasks (
  id INTEGER PRIMARY KEY, change_id INTEGER NOT NULL REFERENCES collection_changes(id), item TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','not_needed')), due_at TEXT NOT NULL, done_at TEXT, done_by INTEGER, note TEXT NOT NULL DEFAULT '',
  UNIQUE (change_id, item)
);`);
const cols = db.prepare('PRAGMA table_info(cards)').all().map((c) => c.name);
if (!cols.includes('purged_at')) db.exec('ALTER TABLE cards ADD COLUMN purged_at TEXT');
const vcols = db.prepare('PRAGMA table_info(card_versions)').all().map((c) => c.name);
if (!vcols.includes('revoked_at')) db.exec('ALTER TABLE card_versions ADD COLUMN revoked_at TEXT');
const wcols = db.prepare('PRAGMA table_info(work_versions)').all().map((c) => c.name);
if (!wcols.includes('purged_at')) db.exec('ALTER TABLE work_versions ADD COLUMN purged_at TEXT');
// 26.11: у обновления — прежняя версия («было v1 → стало v2»); что фасилитатор уже видел — для точки/счётчика в кабинете
const ccols = db.prepare('PRAGMA table_info(collection_changes)').all().map((c) => c.name);
if (!ccols.includes('prev_label')) db.exec("ALTER TABLE collection_changes ADD COLUMN prev_label TEXT NOT NULL DEFAULT ''");
db.exec('CREATE TABLE IF NOT EXISTS collection_seen (user_id INTEGER PRIMARY KEY, last_id INTEGER NOT NULL DEFAULT 0)');

const num = (code) => String(code || '').replace(/^DC-/, '');
/** Номер версии карты: v1 — первое изображение, текущая — число прежних + 1. */
function versionOf(cardId) { return (db.prepare('SELECT COUNT(*) AS n FROM card_versions WHERE card_id = ?').get(cardId).n || 0) + 1; }
const facilitators = (demo) => db.prepare(`SELECT u.id, u.email, u.lang FROM users u JOIN user_roles r ON r.user_id = u.id AND r.role = 'facilitator' WHERE u.is_demo = ?`).all(demo ? 1 : 0);

function record(kind, card, { versionLabel = '', prevLabel = '', by = '', key }) {
  const info = db.prepare('INSERT OR IGNORE INTO collection_changes (kind, card_id, code, version_label, prev_label, by, is_demo, event_key) VALUES (?,?,?,?,?,?,?,?)')
    .run(kind, card.id, card.code, versionLabel, prevLabel, by, card.is_demo ? 1 : 0, key);
  if (!info.changes) return null; // это событие уже обработано — без дублей
  return db.prepare('SELECT * FROM collection_changes WHERE id = ?').get(Number(info.lastInsertRowid));
}
const removedText = (ch, en) => {
  const v = ch.version_label;
  return en
    ? (v ? `Version ${v} of card No. ${num(ch.code)} has been removed from the Dialogue Cards collection. If you use a printed copy of this version, please remove it from your working materials.` : `Card No. ${num(ch.code)} has been removed from the Dialogue Cards collection. If you use a printed copy of it, please remove it from your working materials.`)
    : (v ? `Версия ${v} карты №${num(ch.code)} удалена из коллекции Dialogue Cards. Если вы используете распечатанную версию этой карты, пожалуйста, исключите её из своих рабочих материалов.` : `Карта №${num(ch.code)} удалена из коллекции Dialogue Cards. Если вы используете её распечатанную версию, пожалуйста, исключите её из своих рабочих материалов.`);
};
/** Важное уведомление всем фасилитаторам + письма в очередь. Без изображения и без ссылки на файл. */
function notifyRemoved(ch) {
  for (const f of facilitators(ch.is_demo)) {
    bell.add({ userId: f.id }, { kind: 'collection_removed', title: ch.version_label ? `Версия ${ch.version_label} карты №${num(ch.code)} удалена` : `Карта №${num(ch.code)} удалена из коллекции`,
      body: removedText(ch, false), url: '/facilitator/changes', dedupe: `cc:${ch.id}`, isDemo: !!ch.is_demo });
    if (f.email) db.prepare('INSERT OR IGNORE INTO fac_mail (change_id, user_id, email, lang) VALUES (?,?,?,?)').run(ch.id, f.id, f.email, f.lang === 'en' ? 'en' : 'ru');
  }
  processMail().catch(() => {});
}
function notifyUpdated(ch) {
  for (const f of facilitators(ch.is_demo)) {
    bell.add({ userId: f.id }, { kind: 'collection_updated', title: `Изображение карты №${num(ch.code)} обновлено`,
      body: 'Актуальная версия доступна в галерее. Если вы используете распечатанную версию карты, пожалуйста, ознакомьтесь с обновлением.',
      url: `/library?card=${encodeURIComponent(ch.code)}`, dedupe: `cc:${ch.id}`, isDemo: !!ch.is_demo, push: false });
  }
}

/** Очередь писем: реальная отправка только при подключённой почте; без неё — статус «почта не подключена», без имитации успеха. */
let busy = false;
async function processMail() {
  if (busy) return; busy = true;
  try {
    const rows = db.prepare(`SELECT m.*, c.code, c.version_label FROM fac_mail m JOIN collection_changes c ON c.id = m.change_id
      WHERE m.status = 'queued' OR (m.status = 'failed' AND m.attempts < 5) OR (m.status = 'not_connected' AND ?) ORDER BY m.id LIMIT 200`).all(mail.connected() ? 1 : 0);
    for (const m of rows) {
      if (!mail.connected()) { db.prepare("UPDATE fac_mail SET status = 'not_connected', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(m.id); continue; }
      const en = m.lang === 'en';
      const subject = en ? `Card No. ${num(m.code)} removed from the Dialogue Cards collection` : `Карта №${num(m.code)} удалена из коллекции Dialogue Cards`;
      const r = await mail.send(m.email, subject, removedText({ code: m.code, version_label: m.version_label }, en));
      db.prepare("UPDATE fac_mail SET status = ?, attempts = attempts + 1, last_error = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
        .run(r.sent ? 'sent' : 'failed', r.sent ? null : 'send_failed', m.id);
    }
  } finally { busy = false; }
}
setInterval(() => processMail().catch(() => {}), 10 * 60e3).unref();

/** Файлы карты удаляются с сервера (миниатюры, полные, исходник, обложка для превью). Запись с номером остаётся для истории. */
function unlinkQuiet(p) { try { fs.unlinkSync(p); } catch { /* уже нет */ } }
function purgeCardFiles(card) {
  for (const k of ['full', 'thumb']) unlinkQuiet(path.join(config.mediaDir, k, card[`image_${k}`]));
  if (card.image_original) unlinkQuiet(path.join(config.mediaDir, 'originals', card.image_original));
  for (const v of db.prepare('SELECT * FROM card_versions WHERE card_id = ?').all(card.id)) { unlinkQuiet(path.join(config.mediaDir, 'full', v.image_full)); unlinkQuiet(path.join(config.mediaDir, 'thumb', v.image_thumb)); }
  try { for (const f of fs.readdirSync(path.join(config.dataDir, 'og'))) if (f.startsWith(card.code + '-')) unlinkQuiet(path.join(config.dataDir, 'og', f)); } catch { /* */ }
  db.prepare("UPDATE cards SET purged_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(card.id);
}
const DUE_DAYS = 30;
const ITEMS = ['site', 'social', 'presentations', 'ads'];
function addTasks(ch) {
  const due = new Date(Date.parse(ch.created_at.replace(' ', 'T')) + DUE_DAYS * 86400e3).toISOString();
  for (const it of ITEMS) db.prepare('INSERT OR IGNORE INTO removal_tasks (change_id, item, due_at, status, done_at) VALUES (?,?,?,?,?)')
    .run(ch.id, it, due, it === 'site' ? 'done' : 'open', it === 'site' ? new Date().toISOString() : null);
}

/**
 * Окончательное удаление опубликованной карты (автор отозвал разрешение или администрация исключила карту):
 * карта сразу недоступна везде, файлы удаляются, всем фасилитаторам — важное уведомление и письмо,
 * у администрации — задачи по внешним материалам (соцсети, презентации, реклама) со сроком 30 дней.
 */
function removeFinal(cardOrCode, by) {
  const card = typeof cardOrCode === 'object' ? cardOrCode : db.prepare('SELECT * FROM cards WHERE code = ?').get(cardOrCode);
  if (!card) return { error: 'not_found' };
  if (card.purged_at) return { ok: true, already: true };
  const wasPublished = card.status === 'published' || (card.status === 'removed' && card.removed_by === 'admin');
  db.prepare(`UPDATE cards SET status = 'removed', removed_by = ?, removed_at = COALESCE(removed_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id = ?`).run(by === 'artist' ? 'artist' : 'final', card.id);
  purgeCardFiles(card);
  if (!wasPublished) return { ok: true };
  const ch = record('removed', card, { by, key: `removed:${card.id}` });
  if (ch) { addTasks(ch); notifyRemoved(ch); }
  return { ok: true, changeId: ch ? ch.id : null };
}
/** Отзыв разрешения на прежнюю версию карты: файлы этой версии удаляются, фасилитаторам — важное уведомление с номером версии. */
function revokeVersion(card, versionId, by) {
  const list = db.prepare('SELECT * FROM card_versions WHERE card_id = ? ORDER BY id').all(card.id);
  const i = list.findIndex((v) => v.id === Number(versionId)); if (i < 0) return { error: 'not_found' };
  const v = list[i]; if (v.revoked_at) return { ok: true, already: true };
  unlinkQuiet(path.join(config.mediaDir, 'full', v.image_full)); unlinkQuiet(path.join(config.mediaDir, 'thumb', v.image_thumb));
  db.prepare("UPDATE card_versions SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(v.id);
  const ch = record('version_revoked', card, { versionLabel: `v${i + 1}`, by, key: `revoked:${v.id}` });
  if (ch) { addTasks(ch); notifyRemoved(ch); }
  return { ok: true };
}
/** Новая карта в коллекции — только запись в истории. */
function added(card) { if (card) record('added', card, { versionLabel: 'v1', key: `added:${card.id}` }); }
/** Одобрена и опубликована новая версия — обычное уведомление (не в момент загрузки и не при рассмотрении). */
function updated(card, workId) {
  const v = versionOf(card.id);
  const ch = record('updated', card, { versionLabel: `v${v}`, prevLabel: v > 1 ? `v${v - 1}` : '', key: `updated:${card.id}:${workId}` });
  if (ch) notifyUpdated(ch);
}
/** Файлы непубликовавшейся работы (окончательно отклонена или снята автором с рассмотрения) удаляются; уведомлений фасилитаторам нет. */
function purgeWorkFiles(workId) {
  for (const v of db.prepare('SELECT * FROM work_versions WHERE work_id = ? AND purged_at IS NULL').all(workId)) {
    for (const k of ['full', 'thumb']) unlinkQuiet(path.join(config.mediaDir, 'works', k, v[`image_${k}`]));
    if (v.image_original) unlinkQuiet(path.join(config.mediaDir, 'works', 'originals', v.image_original));
    db.prepare("UPDATE work_versions SET purged_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(v.id);
  }
}

/** История для фасилитаторов: номер, тип, дата, версия; у добавленных и обновлённых — ссылка на актуальную карту. */
function history(showDemo, limit = 300) {
  return db.prepare(`SELECT ch.*, c.status AS card_status FROM collection_changes ch LEFT JOIN cards c ON c.id = ch.card_id
    WHERE ${showDemo ? '1=1' : 'ch.is_demo = 0'} ORDER BY ch.id DESC LIMIT ?`).all(limit)
    .map((x) => ({ id: x.id, kind: x.kind, code: x.code, number: num(x.code), version: x.version_label, prevVersion: x.prev_label || '', at: x.created_at, current: ['added', 'updated'].includes(x.kind) && x.card_status === 'published' }));
}
/** Непросмотренные изменения для точки/счётчика в кабинете фасилитатора (сбрасываются при открытии «Изменений в коллекции»). */
function unseen(userId, showDemo) {
  const last = (db.prepare('SELECT last_id FROM collection_seen WHERE user_id = ?').get(userId) || {}).last_id || 0;
  return db.prepare(`SELECT COUNT(*) AS n FROM collection_changes WHERE id > ? AND ${showDemo ? '1=1' : 'is_demo = 0'}`).get(last).n;
}
function markSeen(userId) {
  const max = (db.prepare('SELECT MAX(id) AS n FROM collection_changes').get() || {}).n || 0;
  db.prepare('INSERT INTO collection_seen (user_id, last_id) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET last_id = MAX(last_id, excluded.last_id)').run(userId, max);
  return { ok: true };
}
/** Для администрации: удаления, состояние писем и внешние задачи. */
function adminRemovals(showDemo) {
  return db.prepare(`SELECT * FROM collection_changes WHERE kind IN ('removed','version_revoked') AND ${showDemo ? '1=1' : 'is_demo = 0'} ORDER BY id DESC LIMIT 100`).all().map((ch) => ({
    id: ch.id, kind: ch.kind, code: ch.code, version: ch.version_label, by: ch.by, at: ch.created_at,
    mail: db.prepare('SELECT status, COUNT(*) AS n FROM fac_mail WHERE change_id = ? GROUP BY status').all(ch.id).reduce((o, r) => ({ ...o, [r.status]: r.n }), {}),
    tasks: db.prepare('SELECT id, item, status, due_at AS dueAt, done_at AS doneAt, note FROM removal_tasks WHERE change_id = ? ORDER BY id').all(ch.id),
  }));
}
function setTask(id, status, note, adminId) {
  if (!['open', 'done', 'not_needed'].includes(status)) return { error: 'bad_request' };
  const x = db.prepare(`UPDATE removal_tasks SET status = ?, note = ?, done_at = CASE WHEN ? = 'open' THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ','now') END, done_by = ? WHERE id = ?`)
    .run(status, String(note || '').slice(0, 300), status, adminId, Number(id));
  return x.changes ? { ok: true } : { error: 'not_found' };
}

module.exports = { unseen, markSeen, removeFinal, revokeVersion, added, updated, purgeWorkFiles, history, adminRemovals, setTask, processMail, versionOf, num };
