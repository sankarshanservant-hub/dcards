// Пользователи, вход и роли.
// Вход без пароля: код из письма (6 цифр, 15 минут). Без настроенной почты (демо-режим) код показывается на экране.
// Владелец проекта может войти по паролю ADMIN_PASSWORD (роль «администратор») или, после явной привязки, аккаунтом сайта.
// Сессия — случайный идентификатор в cookie; в базе хранится только его хеш (таблица sessions), поэтому сессию можно
// отозвать: «Выйти», «Выйти на всех устройствах», смена пароля владельца.
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
const DAY = 24 * 3600 * 1000;
const TTL_MS = 30 * DAY;        // обычная сессия
const ADMIN_TTL_MS = 7 * DAY;   // сессия с правами администратора
const PREFIX = 's2.';           // новый формат cookie; прежний — «id.срок.подпись»
// Повторное предъявление прежней cookie после её замены: короткое окно для одновременных запросов при открытии страницы.
const LEGACY_GRACE_MS = 60 * 1000;
const PRIVILEGED = ['admin', 'curator', 'facilitator'];
const ROLES = ['artist', 'curator', 'facilitator', 'admin'];
// Без вложенного перебора и с пределом длины: прежний шаблон на строке «a@....@» в 150 КБ занимал сервер на 12 с.
const EMAIL_RE = /^(?=.{3,254}$)[^\s@]{1,64}@[^\s@.]+(?:\.[^\s@.]+)+$/;
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

// ---------- сессии ----------
db.exec(`CREATE TABLE IF NOT EXISTS sessions (
  id_hash    TEXT PRIMARY KEY,                -- sha256 идентификатора из cookie; сам идентификатор не хранится
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  via        TEXT NOT NULL DEFAULT '',        -- password | site | email | demo | legacy
  created_at INTEGER NOT NULL,                -- мс
  last_seen  INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip_hash    TEXT NOT NULL DEFAULT '',
  ua         TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS legacy_sessions_used (  -- прежние подписанные cookie, уже заменённые на новые сессии
  sig_hash TEXT PRIMARY KEY, used_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'sessions_revoked_at')) {
  db.exec('ALTER TABLE users ADD COLUMN sessions_revoked_at INTEGER NOT NULL DEFAULT 0'); // мс: сессии, выданные раньше, не действуют
}
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const S = {
  insert: db.prepare('INSERT INTO sessions (id_hash, user_id, via, created_at, last_seen, expires_at, ip_hash, ua) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
  get: db.prepare('SELECT * FROM sessions WHERE id_hash = ?'),
  seen: db.prepare('UPDATE sessions SET last_seen = ? WHERE id_hash = ?'),
  drop: db.prepare('DELETE FROM sessions WHERE id_hash = ?'),
  dropUser: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
  countUser: db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND expires_at > ?'),
  revokedAt: db.prepare('UPDATE users SET sessions_revoked_at = ? WHERE id = ?'),
  legacyUsed: db.prepare('SELECT * FROM legacy_sessions_used WHERE sig_hash = ?'),
  legacyMark: db.prepare('INSERT OR IGNORE INTO legacy_sessions_used (sig_hash, used_at, expires_at) VALUES (?, ?, ?)'),
  setting: db.prepare('SELECT value FROM settings WHERE key = ?'),
  setSetting: db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
};
const ipHash = (req) => hash('ip:' + (req.ip || '')).slice(0, 24);
const isAdminUser = (userId) => rolesOf(userId).includes('admin');

const userById = (id) => stmt.user.get(id);
function rolesOf(userId) { return stmt.roles.all(userId).map((r) => r.role); }
function publicUser(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, publicName: u.public_name || u.name, email: u.email, isDemo: !!u.is_demo, roles: rolesOf(u.id),
    isOwner: u.demo_key === 'owner', siteLinked: !!u.site_uid };
}
const displayName = (u) => (u ? (u.public_name || u.name) : '');

/** Срок новой сессии: с правами администратора — 7 дней, иначе 30. */
const ttlFor = (userId) => (isAdminUser(userId) ? ADMIN_TTL_MS : TTL_MS);
function setCookie(res, req, value, maxAge) {
  res.cookie(COOKIE, value, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: Math.max(0, maxAge), path: CPATH });
}
/** Новая сессия: случайный идентификатор (256 бит) — в cookie, его хеш — в базе. */
function issue(res, req, userId, via = '', { expiresAt } = {}) {
  const prev = req.cookies && req.cookies[COOKIE];
  if (prev && prev.startsWith(PREFIX)) S.drop.run(sha(prev.slice(PREFIX.length))); // повторный вход заменяет сессию этого браузера
  const id = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const exp = Math.min(expiresAt || Infinity, now + ttlFor(userId));
  S.insert.run(sha(id), userId, String(via).slice(0, 20), now, now, exp, ipHash(req), String(req.get('user-agent') || '').slice(0, 200));
  setCookie(res, req, PREFIX + id, exp - now);
  stmt.touch.run(userId);
}
function clear(res) { res.clearCookie(COOKIE, { path: CPATH }); res.clearCookie(DEMO_COOKIE, { path: CPATH }); }
/** «Выйти» на этом устройстве: сессия удаляется из базы, cookie — из браузера. */
function logout(req, res) {
  const raw = req.cookies && req.cookies[COOKIE];
  if (raw && raw.startsWith(PREFIX)) S.drop.run(sha(raw.slice(PREFIX.length)));
  clear(res);
}
const clearSession = (res) => res.clearCookie(COOKIE, { path: CPATH });
/** «Выйти на всех устройствах»: все сессии человека удаляются, прежние подписанные cookie перестают действовать. */
function revokeAll(userId) {
  S.dropUser.run(userId);
  S.revokedAt.run(Date.now(), userId);
}
const sessionCount = (userId) => S.countUser.get(userId, Date.now()).n;

/** Сессия по новой cookie: есть в базе, не истекла; права администратора — не дольше 7 дней от входа. */
function fromSession(req, raw) {
  const h = sha(raw.slice(PREFIX.length));
  const row = S.get.get(h);
  const now = Date.now();
  if (!row) return null;
  const u = stmt.user.get(row.user_id);
  if (!u || row.expires_at <= now || row.created_at < (u.sessions_revoked_at || 0) ||
      (row.created_at + ADMIN_TTL_MS <= now && isAdminUser(u.id))) { S.drop.run(h); return null; }
  if (now - row.last_seen > 5 * 60 * 1000) S.seen.run(now, h); // не пишем в базу на каждый запрос
  return u;
}
/**
 * Прежняя подписанная cookie (до 19.11.2026) действует до своего срока: при первом предъявлении она заменяется
 * новой сессией (без массового выхода). Повтор той же cookie позже чем через минуту — отказ.
 */
function fromLegacy(req, res, raw) {
  const parts = raw.split('.');
  if (parts.length !== 3) return null;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = sign(payload);
  if (parts[2].length !== expected.length || !crypto.timingSafeEqual(Buffer.from(parts[2]), Buffer.from(expected))) return null;
  const exp = Number(parts[1]); const now = Date.now();
  if (!(exp > now)) return null;
  const u = stmt.user.get(Number(parts[0]));
  if (!u || exp - TTL_MS < (u.sessions_revoked_at || 0)) return null; // выдана до «выйти везде» или смены пароля
  const sig = sha('legacy:' + parts[2]);
  const used = S.legacyUsed.get(sig);
  if (used && now - used.used_at > LEGACY_GRACE_MS) return null;
  if (u.is_demo && !config.demoMode) return u; // решение примет loadUser
  if (!used) S.legacyMark.run(sig, now, exp);
  issue(res, req, u.id, 'legacy', { expiresAt: exp });
  return u;
}

/** Загружает пользователя сессии в req.user (с ролями) — промежуточный обработчик для всех запросов. */
function loadUser(req, res, next) {
  req.user = null;
  const raw = req.cookies && req.cookies[COOKIE];
  if (raw) {
    const u = raw.startsWith(PREFIX) ? fromSession(req, raw) : fromLegacy(req, res, raw);
    // демо-сессия, выданная, пока демо было включено, без демо-режима не действует (22.11.2026): иначе новый
    // посетитель этого браузера видит общий тестовый аккаунт («Мира (демо-художник)») и его имя в формах
    if (u && u.is_demo && !config.demoMode) { if (raw.startsWith(PREFIX)) S.drop.run(sha(raw.slice(PREFIX.length))); clear(res); }
    else if (u) { req.user = u; req.roles = rolesOf(u.id); }
    else clearSession(res); // недействительная или отозванная сессия
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

/**
 * Проверяет код, не расходуя его: неверный код считается попыткой (не больше 5).
 * Верный код остаётся действительным до consumeCode — так можно сначала запросить недостающее имя.
 */
function checkCode(email, code) {
  const row = db.prepare(`SELECT * FROM login_codes WHERE email = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1`).get(email);
  if (!row) return { error: 'no_code' };
  if (row.expires_at < new Date().toISOString()) return { error: 'code_expired' };
  if (row.attempts >= 5) return { error: 'too_many_attempts' };
  if (row.code_hash !== hash(email + ':' + String(code ?? '').trim())) {
    db.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    return { error: 'wrong_code' };
  }
  return { ok: true, id: row.id };
}
/** Расходует проверенный код; повторно израсходовать нельзя. */
function consumeCode(id) {
  return db.prepare(`UPDATE login_codes SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND used_at IS NULL`).run(id).changes === 1;
}
function verifyCode(email, code) {
  const v = checkCode(email, code);
  if (v.error) return v;
  return consumeCode(v.id) ? { ok: true } : { error: 'no_code' };
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
/** Проверяет сессию сайта (API «me») и возвращает его пользователя: { su } или { error }. */
async function siteMe(siteSession) {
  if (!config.siteAuthUrl) return { error: 'site_login_disabled' };
  if (typeof siteSession !== 'string' || siteSession.length < 10 || siteSession.length > 400) return { error: 'bad_session' };
  let r;
  try {
    const url = `${config.siteAuthUrl}?${new URLSearchParams({ api: 'me', session: siteSession, siteOrigin: config.publicUrl || '' })}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    r = await res.json();
  } catch { return { error: 'site_unreachable' }; }
  if (!r || !r.ok || !r.user || !r.user.uid) return { error: 'site_session_invalid' };
  return { su: r.user };
}
/**
 * Аккаунт, который нельзя привязать к аккаунту сайта автоматически по совпавшему email: владелец, демо, люди с правами
 * (администратор, куратор, фасилитатор) и уже привязанные к другому аккаунту сайта. Для них — только явная привязка
 * из профиля (вошли своим способом и нажали «Привязать к моему аккаунту сайта»).
 */
const needsExplicitLink = (u) => !!(u.demo_key || u.is_demo || u.site_uid || rolesOf(u.id).some((r) => PRIVILEGED.includes(r)));
/** Проверяет сессию сайта и возвращает пользователя Dialogue Cards, связанного с этим аккаунтом. */
async function siteLogin(siteSession) {
  const m = await siteMe(siteSession);
  if (m.error) return m;
  const su = m.su;
  const name = String(su.displayName || su.name || '').trim().slice(0, 100) || 'Участник';
  const email = su.email && EMAIL_RE.test(su.email) ? String(su.email).trim().toLowerCase() : null;
  let u = db.prepare('SELECT * FROM users WHERE site_uid = ?').get(String(su.uid));
  if (!u && email) {
    const byEmail = stmt.byEmail.get(email);
    if (byEmail && needsExplicitLink(byEmail)) return { error: 'site_link_required' };
    if (byEmail) { db.prepare('UPDATE users SET site_uid = ? WHERE id = ?').run(String(su.uid), byEmail.id); u = stmt.user.get(byEmail.id); }
  }
  if (!u) {
    const info = db.prepare('INSERT INTO users (email, name, public_name, is_demo, site_uid) VALUES (?, ?, ?, 0, ?)').run(email, name, '', String(su.uid));
    u = stmt.user.get(info.lastInsertRowid);
  }
  if (u.is_demo) return { error: 'site_session_invalid' };
  return { user: u };
}
/**
 * Явная привязка: вошедший (например, владелец по паролю) подтверждает, что аккаунт сайта — его. После этого вход
 * аккаунтом сайта открывает именно этот аккаунт. Если аккаунт сайта уже был у обычного аккаунта без прав (например,
 * человек раньше входил через сайт как участник), тот аккаунт отвязывается; аккаунт с правами не отвязывается.
 */
async function linkSite(user, siteSession) {
  if (!user || user.is_demo) return { error: 'forbidden' };
  const m = await siteMe(siteSession);
  if (m.error) return m;
  const uid = String(m.su.uid);
  const other = db.prepare('SELECT * FROM users WHERE site_uid = ?').get(uid);
  if (other && other.id !== user.id) {
    if (other.demo_key || rolesOf(other.id).some((r) => PRIVILEGED.includes(r))) return { error: 'site_account_in_use' };
  }
  db.transaction(() => {
    if (other && other.id !== user.id) db.prepare('UPDATE users SET site_uid = NULL WHERE id = ?').run(other.id);
    db.prepare('UPDATE users SET site_uid = ? WHERE id = ?').run(uid, user.id);
  })();
  return { ok: true, detached: !!(other && other.id !== user.id) };
}

// ---------- владелец проекта ----------
/** Пароль слишком короткий для боевого сервера — такой пароль не принимается. */
const ownerPasswordTooShort = () => config.isProduction && !!config.adminPassword && config.adminPassword.length < config.minAdminPassword;
function ownerPassword() {
  if (ownerPasswordTooShort()) return null;
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
/**
 * Смена пароля владельца (ADMIN_PASSWORD в /etc/dcards.env) отзывает все сессии владельца: при запуске отпечаток
 * нового пароля сравнивается с сохранённым. Сам пароль не хранится.
 */
function checkOwnerPasswordRotation() {
  const pw = ownerPassword();
  if (!pw || !config.adminPassword) return false;
  const fp = hash('owner-password:' + pw);
  const prev = S.setting.get('owner_password_fp');
  if (prev && prev.value === fp) return false;
  if (prev) { const u = stmt.byDemoKey.get('owner'); if (u) revokeAll(u.id); }
  S.setSetting.run('owner_password_fp', fp);
  return !!prev;
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
  loadUser, requireUser, requireRole, issue, clear, logout, revokeAll, sessionCount, publicUser, displayName, rolesOf,
  siteLogin, linkSite, userById, checkOwnerPasswordRotation, ADMIN_TTL_MS, TTL_MS, requestCode, checkCode, consumeCode, verifyCode, findOrCreateUser, checkOwnerPassword, ownerUser, ownerPassword, ownerPasswordTooShort, demoUser, grant, revoke,
};
