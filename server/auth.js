// Вход владельца проекта для прототипа: один пароль из переменной окружения ADMIN_PASSWORD.
// Сессия — подписанная cookie (HMAC). Все служебные API проверяют её на сервере.
// Позже заменяется входом по email и ролями (художник, куратор, фасилитатор, администратор).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const COOKIE = 'dc_admin';
const TTL_MS = 30 * 24 * 3600 * 1000;

function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(config.dataDir, 'session-secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const s = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(file, s, { mode: 0o600 });
    return s;
  }
}
const secret = loadSecret();

function sign(payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function issue(res, req) {
  const payload = `owner.${Date.now() + TTL_MS}`;
  res.cookie(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    maxAge: TTL_MS,
    path: '/',
  });
}

function isAdmin(req) {
  const raw = req.cookies && req.cookies[COOKIE];
  if (!raw) return false;
  const i = raw.lastIndexOf('.');
  const payload = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  const exp = Number(payload.split('.')[1]);
  return Number.isFinite(exp) && exp > Date.now();
}

function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  res.status(401).json({ error: 'auth_required' });
}

function effectivePassword() {
  if (config.adminPassword) return config.adminPassword;
  if (config.isProduction) return null; // в продакшене без пароля вход закрыт
  return 'dcards-dev';
}

// Простое ограничение попыток входа (в памяти процесса).
const attempts = new Map();
function checkPassword(req, password) {
  const key = req.ip;
  const now = Date.now();
  const a = attempts.get(key) || { n: 0, until: 0 };
  if (a.until > now) return { ok: false, error: 'too_many_attempts' };
  const expected = effectivePassword();
  const ok = !!expected && typeof password === 'string' &&
    password.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(password), Buffer.from(expected));
  if (ok) { attempts.delete(key); return { ok: true }; }
  a.n += 1;
  if (a.n >= 5) { a.until = now + 5 * 60 * 1000; a.n = 0; }
  attempts.set(key, a);
  return { ok: false, error: 'wrong_password' };
}

function clear(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

module.exports = { issue, isAdmin, requireAdmin, checkPassword, clear, effectivePassword };
