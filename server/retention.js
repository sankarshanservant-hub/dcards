// Сроки хранения записей без аккаунта (19.11.2026). Запускается при старте службы и раз в 6 часов.
// - обмены, в которых никто не вошёл в аккаунт (только браузеры гостей), — через год после последнего изменения;
// - общие обмены («нескольким людям») без единого аккаунта — так же;
// - комнаты игр компанией: закончившиеся или заброшенные — через 30 дней;
// - уведомления колокольчика гостей — через год; истёкшие сессии и коды входа — сразу после срока.
// Общий счётчик «Выбрали для разговора» не меняется: выборы хранятся отдельно (talk_choices) и не удаляются.
const db = require('./db');

const DAY = 24 * 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const has = (table) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);

function run(now = Date.now()) {
  const yearAgo = iso(now - 365 * DAY);
  const monthAgo = iso(now - 30 * DAY);
  const out = { exchanges: 0, groups: 0, rooms: 0, notifications: 0, sessions: 0, codes: 0, requests: 0 };
  db.transaction(() => {
    if (has('exchanges')) {
      const ids = db.prepare(`SELECT id FROM exchanges WHERE updated_at < ? AND a_user_id IS NULL AND b_user_id IS NULL AND target_user_id IS NULL`).all(yearAgo).map((x) => x.id);
      const delEv = db.prepare('DELETE FROM x_events WHERE exchange_id = ?');
      const delX = db.prepare('DELETE FROM exchanges WHERE id = ?');
      for (const id of ids) { delEv.run(id); delX.run(id); }
      out.exchanges = ids.length;
    }
    if (has('x_groups')) {
      const ids = db.prepare(`SELECT g.id FROM x_groups g WHERE g.updated_at < ? AND g.a_user_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM x_group_members m WHERE m.group_id = g.id AND (m.user_id IS NOT NULL OR m.answered_at >= ?))`).all(yearAgo, yearAgo).map((x) => x.id);
      for (const id of ids) { db.prepare('DELETE FROM x_group_members WHERE group_id = ?').run(id); db.prepare('DELETE FROM x_groups WHERE id = ?').run(id); }
      out.groups = ids.length;
    }
    if (has('group_rooms')) {
      const ids = db.prepare('SELECT id FROM group_rooms WHERE updated_at < ?').all(monthAgo).map((x) => x.id);
      for (const id of ids) {
        db.prepare('DELETE FROM group_picks WHERE room_id = ?').run(id);
        db.prepare('DELETE FROM group_members WHERE room_id = ?').run(id);
        db.prepare('DELETE FROM group_rooms WHERE id = ?').run(id);
      }
      out.rooms = ids.length;
    }
    if (has('notifications')) out.notifications = Number(db.prepare('DELETE FROM notifications WHERE user_id IS NULL AND updated_at < ?').run(yearAgo).changes);
    if (has('sessions')) {
      out.sessions = Number(db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now).changes);
      db.prepare('DELETE FROM legacy_sessions_used WHERE expires_at <= ?').run(now);
    }
    out.codes = Number(db.prepare('DELETE FROM login_codes WHERE expires_at < ?').run(iso(now - DAY)).changes);
    if (has('registration_requests')) out.requests = Number(db.prepare('DELETE FROM registration_requests WHERE expires_at < ?').run(iso(now - DAY)).changes);
  })();
  return out;
}

let timer = null;
function schedule() {
  const tick = () => { try { const r = run(); if (Object.values(r).some(Boolean)) console.log('retention:', JSON.stringify(r)); } catch (e) { console.error('retention:', e.message); } };
  setTimeout(tick, 30 * 1000).unref();
  timer = setInterval(tick, 6 * 3600 * 1000); timer.unref();
}

module.exports = { run, schedule };
