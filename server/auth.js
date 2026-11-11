// Пользователи, вход и роли.
// Вход без пароля: код из письма (6 цифр, 15 минут). Без настроенной почты (демо-режим) код показывается на экране.
// Владелец проекта может войти по паролю ADMIN_PASSWORD (роль «администратор»).
// В демо-режиме есть тестовый переключатель ролей: вход под заранее созданными демо-пользователями.
// Права проверяются на сервере по ролям из базы при каждом запросе — скрытия кнопок для этого недостаточно.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const db = require('./db');
const mail = require('./mail');

const COOKIE = 'dc_session';
const DEMO_COOKIE = 'dc_demo';
const TTL_MS = 30 * 24 * 3600 * 1000;
const ROLES = ['artist', 'curator', 'facilitator', 'admin'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CPATH = config.basePath || '/';

function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(config.dataDir, 'session-secret');
  try { return fs.readFileSync(file, 'utf8').trim(); } catch {
    const s = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, s, { mode: 0o600 });
    return s;
  }
}
const secret = loadSecret();
const sign = (s) => crypto.createHmac('sha256', secret).update(s).digest('base64url');
const hash = (s) => crypto.createHash('sha256').update(secret + ':' + s).digest('hex');

const stmt = {
  user: db.prepare('SELECT * FROM users WHERE id = ?'),
  byEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  byDemoKey: db.prepare('SELECT * FROM users WHERE demo_key = ?'),
  roles: db.prepare('SELECT role FROM user_roles WHERE user_id = ?'),
  grant: db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role, granted_by) VALUES (?, ?, ?)'),
  revoke: db.prepare('DELETE FROM user_roles WHERE user_id = ? AND role = ?'),
  insertUser: db.prepare('INSERT INTO users (email, name, public_name, is_demo, demo_key) VALUES (?, ?, ?, ?, ?)'),
  touch: db.prepare(`UPDATE users SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`),
};

function rolesOf(userId) { return stmt.roles.all(userId).map((r) => r.role); }
function publicUser(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, publicName: u.public_name || u.name, email: u.email, isDemo: !!u.is_demo, roles: rolesOf(u.id) };
}
const displayName = (u) => (u ? (u.public_name || u.name) : '');

function issue(res, req, userId) {
  const payload = `${userId}.${Date.now() + TTL_MS}`;
  res.cookie(COOKIE, `${payload}.${sign(payload)}`, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: TTL_MS, path: CPATH });
  stmt.touch.run(userId);
}
function clear(res) { res.clearCookie(COOKIE, { path: CPATH }); res.clearCookie(DEMO_COOKIE, { path: CPATH }); }

/** Загружает пользователя сессии в req.user (с ролями) — промежуточный обработчик для всех запросов. */
function loadUser(req, res, next) {
  req.user = null;
  const raw = req.cookies && req.cookies[COOKIE];
  if (raw) {
    const parts = raw.split('.');
    if (parts.length === 3) {
      const payload = `${parts[0]}.${parts[1]}`;
      const expected = sign(payload);
      if (parts[2].length === expected.length && crypto.timingSafeEqual(Buffer.from(parts[2]), Buffer.from(expected)) && Number(parts[1]) > Date.now()) {
        const u = stmt.user.get(Number(parts[0]));
        if (u) { req.user = u; req.roles = rolesOf(u.id); }
      }
    }
  }
  req.roles = req.roles || [];
  req.has = (...roles) => !!req.user && (req.roles.includes('admin') || roles.some((r) => req.roles.includes(r)));
  // Демо-данные видны только тем, кто вошёл в демо-режим (демо-пользователь или включённый демо-просмотр).
  req.showDemo = config.demoMode && ((req.user && req.user.is_demo) || (req.cookies && req.cookies[DEMO_COOKIE] === '1'));
  next();
}
function requireUser(req, res, next) {
  if (req.user) return next();
  res.status(401).json({ error: 'auth_required' });
}
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'auth_required' });
  if (req.has(...roles)) return next();
  res.status(403).json({ error: 'forbidden', need: roles });
};

// ---------- вход по коду ----------
async function requestCode(email, lang = 'ru') {
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  db.prepare(`UPDATE login_codes SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE email = ? AND used_at IS NULL`).run(email);
  db.prepare('INSERT INTO login_codes (email, code_hash, expires_at) VALUES (?, ?, ?)')
    .run(email, hash(email + ':' + code), new Date(Date.now() + 15 * 60 * 1000).toISOString());
  const subject = lang === 'en' ? `Dialogue Cards sign-in code: ${code}` : `Код входа в Dialogue Cards: ${code}`;
  const body = lang === 'en'
    ? `Your sign-in code: ${code}\nIt is valid for 15 minutes. If you did not request it, ignore this email.`
    : `Ваш код входа: ${code}\nКод действует 15 минут. Если вы не запрашивали вход, просто не отвечайте на это письмо.`;
  const result = await mail.send(email, subject, body);
  return { ...result, code: result.demo ? code : undefined };
}

function verifyCode(email, code) {
  const row = db.prepare(`SELECT * FROM login_codes WHERE email = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1`).get(email);
  if (!row) return { error: 'no_code' };
  if (row.expires_at < new Date().toISOString()) return { error: 'code_expired' };
  if (row.attempts >= 5) return { error: 'too_many_attempts' };
  if (row.code_hash !== hash(email + ':' + String(code).trim())) {
    db.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    return { error: 'wrong_code' };
  }
  db.prepare(`UPDATE login_codes SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(row.id);
  return { ok: true };
}

function findOrCreateUser(email, name, publicName) {
  let u = stmt.byEmail.get(email);
  if (!u) {
    const info = stmt.insertUser.run(email, String(name || '').trim().slice(0, 100) || email.split('@')[0], String(publicName || '').trim().slice(0, 100), 0, null);
    u = stmt.user.get(info.lastInsertRowid);
  }
  return u;
}

// ---------- вход общим аккаунтом сайта ----------
/** Проверяет сессию сайта (API «me») и возвращает пользователя Dialogue Cards, связанного с этим аккаунтом. */
async function siteLogin(siteSession) {
  if (!config.siteAuthUrl) return { error: 'site_login_disabled' };
  if (typeof siteSession !== 'string' || siteSession.length < 10 || siteSession.length > 400) return { error: 'bad_session' };
  let r;
  try {
    const url = `${config.siteAuthUrl}?${new URLSearchParams({ api: 'me', session: siteSession, siteOrigin: config.publicUrl || '' })}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    r = await res.json();
  } catch { return { error: 'site_unreachable' }; }
  if (!r || !r.ok || !r.user || !r.user.uid) return { error: 'site_session_invalid' };
  const su = r.user;
  const name = String(su.displayName || su.name || '').trim().slice(0, 100) || 'Участник';
  const email = su.email && EMAIL_RE.test(su.email) ? String(su.email).trim().toLowerCase() : null;
  let u = db.prepare('SELECT * FROM users WHERE site_uid = ?').get(String(su.uid));
  if (!u && email) {
    u = stmt.byEmail.get(email);
    if (u) db.prepare('UPDATE users SET site_uid = ? WHERE id = ?').run(String(su.uid), u.id);
  }
  if (!u) {
    const info = db.prepare('INSERT INTO users (email, name, public_name, is_demo, site_uid) VALUES (?, ?, ?, 0, ?)').run(email, name, '', String(su.uid));
    u = stmt.user.get(info.lastInsertRowid);
  }
  return { user: u };
}

// ---------- владелец проекта ----------
function ownerPassword() {
  if (config.adminPassword) return config.adminPassword;
  return config.isProduction ? null : 'dcards-dev';
}
const attempts = new Map();
function checkOwnerPassword(req, password) {
  const key = req.ip; const now = Date.now();
  const a = attempts.get(key) || { n: 0, until: 0 };
  if (a.until > now) return { ok: false, error: 'too_many_attempts' };
  const expected = ownerPassword();
  const ok = !!expected && typeof password === 'string' && password.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(password), Buffer.from(expected));
  if (ok) { attempts.delete(key); return { ok: true }; }
  a.n += 1; if (a.n >= 5) { a.until = now + 5 * 60 * 1000; a.n = 0; }
  attempts.set(key, a);
  return { ok: false, error: 'wrong_password' };
}
function ownerUser() {
  let u = stmt.byDemoKey.get('owner');
  if (!u) {
    const info = stmt.insertUser.run(null, 'Владелец проекта', '', 0, 'owner');
    u = stmt.user.get(info.lastInsertRowid);
  }
  stmt.grant.run(u.id, 'admin', null);
  return u;
}

// ---------- демо-пользователи (тестовый переключатель ролей) ----------
const DEMO_USERS = [
  { key: 'artist', name: 'Мира (демо-художник)', roles: ['artist'] },
  { key: 'curator', name: 'Олег (демо-куратор)', roles: ['curator'] },
  { key: 'curator2', name: 'Анна (демо-куратор)', roles: ['curator'] },
  { key: 'facilitator', name: 'Лея (демо-фасилитатор)', roles: ['facilitator'] },
  { key: 'admin', name: 'Демо-администратор', roles: ['admin'] },
  { key: 'guest', name: 'Гость (демо-пользователь)', roles: [] },
];
function demoUser(key) {
  const d = DEMO_USERS.find((x) => x.key === key);
  if (!d) return null;
  let u = stmt.byDemoKey.get('demo-' + key);
  if (!u) {
    const info = stmt.insertUser.run(null, d.name, '', 1, 'demo-' + key);
    u = stmt.user.get(info.lastInsertRowid);
    for (const r of d.roles) stmt.grant.run(u.id, r, null);
  }
  return u;
}

function grant(userId, role, by) { if (ROLES.includes(role)) stmt.grant.run(userId, role, by || null); }
function revoke(userId, role) { stmt.revoke.run(userId, role); }

module.exports = {
  CPATH, COOKIE, DEMO_COOKIE, ROLES, EMAIL_RE, DEMO_USERS,
  loadUser, requireUser, requireRole, issue, clear, publicUser, displayName, rolesOf,
  siteLogin, requestCode, verifyCode, findOrCreateUser, checkOwnerPassword, ownerUser, ownerPassword, demoUser, grant, revoke,
};
