const { demoWhere, demoScope } = require('./demo-scope');
const crypto = require('crypto');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const QRCode = require('qrcode');

const config = require('./config');
const db = require('./db');
const auth = require('./auth');
const mail = require('./mail');
const cards = require('./cards');
const collections = require('./collections');
const works = require('./works');
const meetings = require('./meetings');
const community = require('./community');
const push = require('./push');
const bell = require('./bell');
const events = require('./events');
const exchanges = require('./exchanges');
const xgroups = require('./xgroups');
const personal = require('./personal');
const safe = (fn) => { try { fn(); } catch (e) { console.error('event:', e.message); } }; // событие не должно ломать основное действие
const demo = require('./demo');
const choices = require('./choices');
const places = require('./places');
const guide = require('./guide');
const { cityKey } = require('./places-key');

cards.syncSeed();
if (config.demoMode) for (const u of auth.DEMO_USERS) auth.demoUser(u.key);

const site = require('./site');
const app = express();
// Адрес клиента: nginx на этом же сервере (127.0.0.1) дописывает его в X-Forwarded-For; верим только ему,
// иначе первый адрес списка мог бы прислать сам клиент. TRUST_PROXY — для другой схемы (например, контейнер за своим прокси).
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob: https://tile.openstreetmap.org; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'",
  });
  next();
});
const r = express.Router();
r.use(site.middleware); // какой вход: dialogue.cards или портал (server/site.js)
r.use(express.json({ limit: '200kb' }));
r.use(cookieParser());
r.use(auth.loadUser);
// Гость: случайный идентификатор этого браузера (заголовок X-DC-Visitor) — привязка его обменов, колокольчика, записей.
r.use((req, res, next) => { const v = String(req.get('x-dc-visitor') || ''); req.visitor = /^[A-Za-z0-9-]{16,64}$/.test(v) ? v : null; next(); });
// язык интерфейса вошедшего человека — для push-уведомлений (только ru/en; хранится последний выбранный)
r.use((req, res, next) => { const l = String(req.get('x-dc-lang') || ''); if (req.user && (l === 'ru' || l === 'en') && req.user.lang !== l) { try { db.prepare('UPDATE users SET lang = ? WHERE id = ?').run(l, req.user.id); req.user.lang = l; } catch { /* */ } } next(); });

const VISITOR_RE = /^[A-Za-z0-9-]{16,64}$/;
const CODE_RE = /^DC-\d{4,6}$/;
const baseUrl = (req) => req.site.origin; // адрес входа, с которого пришёл человек (server/site.js)
const bad = (res, error, status = 400, extra = {}) => res.status(status).json({ error, ...extra });
const out = (res, result, okStatus = 200) => (result && result.error
  ? bad(res, result.error, result.error === 'not_found' ? 404 : result.error === 'forbidden' ? 403 : 400, result)
  : res.status(okStatus).json(result));
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const isStaff = (req) => req.has('curator', 'admin');
// Демо-пользователи (тестовый переключатель ролей) работают только с демо-объектами: настоящие карты, работы,
// встречи, люди и сообщения им доступны лишь для просмотра.
const demoOnly = (req, res, isDemoTarget) => {
  if (!req.user || !req.user.is_demo || isDemoTarget) return true;
  bad(res, 'demo_readonly', 403); return false;
};
// Нет такой записи — «не демо»: демо-роль не должна проходить проверку на несуществующем номере.
const isDemoRow = (table, where, val) => { const r = db.prepare(`SELECT is_demo FROM ${table} WHERE ${where} = ?`).get(val); return !!r && !!r.is_demo; };

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp|tiff)$/.test(file.mimetype)),
});
// Работы авторов: только JPEG или PNG (условие проекта); неподходящий файл — понятная ошибка, а не молчаливый пропуск.
const artistUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => (/^image\/(jpeg|png)$/.test(file.mimetype) ? cb(null, true) : cb(Object.assign(new Error('bad_image_type'), { code: 'bad_image_type' }))),
});

// ---------- изображения ----------
// Карты: опубликованные — всем; снятые и прежние версии — автору, кураторам и администраторам. Демо — только в демо-режиме.
r.get('/media/:kind(full|thumb)/:file', (req, res) => {
  const file = path.basename(req.params.file);
  const info = cards.mediaInfo(file);
  if (!info) return res.sendStatus(404);
  const publicOk = info.status === 'published' && (!info.is_demo || req.showDemo);
  const privateOk = isStaff(req) || (req.user && info.artist_id === req.user.id);
  if (!publicOk && !privateOk) return res.sendStatus(404);
  res.set('Cache-Control', publicOk && !info.is_demo ? 'public, max-age=86400' : 'private, no-store');
  res.sendFile(path.join(config.mediaDir, req.params.kind, file), (err) => { if (err && !res.headersSent) res.sendStatus(404); });
});
// Работы на рассмотрении: автору, кураторам и администраторам.
r.get('/media/works/:kind(full|thumb)/:file', (req, res) => {
  const file = path.basename(req.params.file);
  if (!works.workMediaAllowed(file, req.user, req.roles)) return res.sendStatus(404);
  res.set('Cache-Control', 'private, no-store');
  res.sendFile(path.join(config.mediaDir, 'works', req.params.kind, file), (err) => { if (err && !res.headersSent) res.sendStatus(404); });
});

// ---------- общее ----------
// Вход по email без подключённой почты возможен только при локальной разработке (код показывается на экране).
// На сервере (NODE_ENV=production) без SMTP он выключен: иначе войти можно было бы под чужим адресом.
const emailLoginEnabled = () => mail.connected() || !config.isProduction;
r.get('/api/config', (req, res) => res.json({
  demoMode: config.demoMode, ownerLogin: auth.ownerLoginOpen(), mailConnected: mail.connected(), emailLogin: emailLoginEnabled(), siteLogin: !!config.siteAuthUrl && req.site.portal, translationConnected: false,
  termsVersion: config.termsVersion, authorTerms: terms.active() ? { active: true, editionId: (terms.current('ru') || {}).id } : { active: false }, basePath: req.site.base, maxCollectionSize: config.maxCollectionSize, languages: meetings.LANGS,
}));
r.get('/api/me', (req, res) => res.json({ user: auth.publicUser(req.user), demoMode: config.demoMode, showDemo: !!req.showDemo }));
r.patch('/api/me', auth.requireUser, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 100);
  const publicName = String(req.body.publicName ?? '').trim().slice(0, 100);
  if (!name) return bad(res, 'name_required');
  db.prepare('UPDATE users SET name = ?, public_name = ? WHERE id = ?').run(name, publicName, req.user.id);
  res.json({ ok: true });
});

// ---------- вход ----------
// Ответы входа по коду одинаковы для новых и известных адресов: есть ли аккаунт, видно только после верного кода.
r.post('/api/auth/request', wrap(async (req, res) => {
  if (!emailLoginEnabled()) return bad(res, 'mail_not_configured', 503);
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!auth.EMAIL_RE.test(email)) return bad(res, 'bad_email');
  const result = await auth.requestCode(email, req.body.lang === 'en' ? 'en' : 'ru');
  res.json({ sent: result.sent, demo: result.demo, failed: !!result.failed, demoCode: result.code });
}));
r.post('/api/auth/verify', (req, res) => {
  if (!emailLoginEnabled()) return bad(res, 'mail_not_configured', 503);
  const email = String(req.body.email || '').trim().toLowerCase();
  const v = auth.checkCode(email, req.body.code);
  if (v.error) return bad(res, v.error, 401);
  // новый человек без имени — просим имя, код остаётся действительным; имя известного аккаунта не меняется
  const exists = !!db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
  if (!exists && !String(req.body.name || '').trim()) return bad(res, 'name_required');
  if (!auth.consumeCode(v.id)) return bad(res, 'no_code', 401);
  const u = auth.findOrCreateUser(email, req.body.name, req.body.publicName);
  auth.issue(res, req, u.id);
  res.json({ user: auth.publicUser(u) });
});
// Вход общим аккаунтом сайта: браузер передаёт сессию сайта, сервер проверяет её у сайта.
r.post('/api/auth/site', wrap(async (req, res) => {
  const x = await auth.siteLogin(req.body && req.body.session);
  if (x.error) return bad(res, x.error, x.error === 'site_unreachable' ? 502 : 401);
  auth.issue(res, req, x.user.id);
  res.json({ user: auth.publicUser(x.user) });
}));
r.post('/api/auth/owner', (req, res) => {
  if (!auth.ownerLoginOpen()) return bad(res, 'owner_login_closed', 403);
  const c = auth.checkOwnerPassword(req, req.body && req.body.password);
  if (!c.ok) return bad(res, c.error, c.error === 'too_many_attempts' ? 429 : 401);
  const u = auth.ownerUser();
  auth.issue(res, req, u.id);
  res.json({ user: auth.publicUser(u) });
});
r.post('/api/auth/logout', (req, res) => { auth.clear(res); res.json({ ok: true }); });
// Тестовый переключатель ролей (только в демо-режиме). Права всё равно проверяются по ролям демо-пользователя.
r.post('/api/demo/login', wrap(async (req, res) => {
  if (!config.demoMode) return bad(res, 'demo_disabled', 403);
  const u = auth.demoUser(String(req.body.as || ''));
  if (!u) return bad(res, 'unknown_role');
  try { await demo.ensure(); } catch (e) { console.error('demo seed', e); } // демо-данные создаются при первом входе в демо
  auth.issue(res, req, u.id);
  res.cookie(auth.DEMO_COOKIE, '1', { sameSite: 'lax', path: auth.cpath(), maxAge: 30 * 24 * 3600 * 1000 });
  res.json({ user: auth.publicUser(u) });
}));
r.post('/api/demo/view', (req, res) => {
  if (!config.demoMode) return bad(res, 'demo_disabled', 403);
  if (req.body.on) res.cookie(auth.DEMO_COOKIE, '1', { sameSite: 'lax', path: auth.cpath(), maxAge: 30 * 24 * 3600 * 1000 });
  else res.clearCookie(auth.DEMO_COOKIE, { path: auth.cpath() });
  res.json({ ok: true });
});

// ---------- карты и обсуждения ----------
r.get('/api/cards', (req, res) => res.json({ cards: cards.listPublished(req.showDemo) }));
r.get('/api/cards/:code', (req, res) => {
  const c = CODE_RE.test(req.params.code) && cards.getPublished(req.params.code, req.showDemo);
  if (!c) return bad(res, 'not_found', 404);
  // Свой ли выбор у этого браузера/аккаунта (visitor — необязательный идентификатор браузера).
  const v = typeof req.query.visitor === 'string' && VISITOR_RE.test(req.query.visitor) ? req.query.visitor : null;
  if (v || req.user) c.chosenByMe = !!choices.mine(c.id ?? db.prepare('SELECT id FROM cards WHERE code = ?').get(c.code).id, v, req.user);
  res.json(c);
});
// Выбор для обсуждения в общей библиотеке («Вдвоём», «В группе»): без входа; в общий счёт — только явный выбор, один раз.
const publishedCardRow = (req) => {
  const row = CODE_RE.test(req.params.code) && db.prepare('SELECT * FROM cards WHERE code = ?').get(req.params.code);
  return row && row.status === 'published' && (!row.is_demo || req.showDemo) ? row : null;
};
r.post('/api/cards/:code/choose', (req, res) => {
  const row = publishedCardRow(req); if (!row) return bad(res, 'not_found', 404);
  const v = visitorFrom(req, res); if (!v) return;
  res.json(choices.choose(row, v, req.user));
});
r.post('/api/cards/:code/unchoose', (req, res) => {
  const row = publishedCardRow(req); if (!row) return bad(res, 'not_found', 404);
  const v = visitorFrom(req, res); if (!v) return;
  res.json(choices.unchoose(row, v, req.user));
});
const publishedCardId = (req) => {
  const row = CODE_RE.test(req.params.code) && db.prepare('SELECT * FROM cards WHERE code = ?').get(req.params.code);
  return row && row.status === 'published' && (!row.is_demo || req.showDemo) ? row.id : null;
};
r.get('/api/cards/:code/comments', (req, res) => {
  const id = publishedCardId(req);
  if (!id) return bad(res, 'not_found', 404); // у снятой карты обсуждение перестаёт быть публичным
  res.json({ comments: community.comments(id, req.user).filter((c) => !c.isDemo || req.showDemo) });
});
r.post('/api/cards/:code/comments', auth.requireUser, (req, res) => {
  const id = publishedCardId(req);
  if (!id) return bad(res, 'not_found', 404);
  out(res, community.addComment(id, req.user, req.body.text), 201);
});
r.delete('/api/comments/:id', auth.requireUser, (req, res, next) => (demoOnly(req, res, isDemoRow('comments', 'id', Number(req.params.id)) || !req.has('admin')) ? next() : undefined), (req, res) => out(res, community.deleteComment(Number(req.params.id), req.user, req.has('admin'))));
r.get('/api/criteria', (req, res) => res.json({ criteria: works.criteriaList() }));
r.get('/api/terms', (req, res) => res.json({ version: config.termsVersion, draft: true }));
// ---------- соглашение с авторами (25.11.2026) ----------
const terms = require('./terms');
// действующая редакция (если опубликована) — на языке читателя или русский оригинал, пока перевод на проверке
r.get('/api/terms/authors', (req, res) => { const e = terms.forReader(req.query.lang === 'en' ? 'en' : 'ru'); res.set('Cache-Control', 'no-store').json({ active: terms.active(), edition: e }); });
// конкретная редакция (например, принятая автором) — опубликованные открыты, черновики — только администрации
r.get('/api/terms/editions/:id', (req, res) => { const e = terms.editionText(req.params.id, req.user, req.has && req.has('admin')); if (!e) return bad(res, 'not_found', 404); res.json({ edition: e }); });
r.post('/api/artist/consent', auth.requireUser, (req, res) => { const b = req.body || {}; out(res, terms.accept(req.user, { editionId: b.editionId, purpose: b.purpose, target: b.target }), 201); });
r.get('/api/artist/consents', auth.requireUser, (req, res) => res.json({ consents: terms.mine(req.user.id) }));

// ---------- подборка на встрече (участник, без аккаунта) ----------
function loadCollection(req, res) {
  const found = collections.getPublic(String(req.params.slug), req.showDemo);
  if (!found) { bad(res, 'not_found', 404); return null; }
  return found;
}
function visitorFrom(req, res) {
  const v = req.body && req.body.visitorId;
  if (typeof v !== 'string' || !VISITOR_RE.test(v)) { bad(res, 'bad_visitor'); return null; }
  return v;
}
function roundFrom(req, res) {
  const n = Number(req.body && req.body.round);
  if (!Number.isInteger(n) || n < 1 || n > config.maxRounds) { bad(res, 'bad_round'); return null; }
  return n;
}
r.get('/api/c/:slug', (req, res) => { const f = loadCollection(req, res); if (f) res.json(f.data); });
r.post('/api/c/:slug/visit', (req, res) => {
  const f = loadCollection(req, res); if (!f) return;
  const v = visitorFrom(req, res); if (!v) return;
  collections.recordVisit(f.col, v);
  res.json(collections.visitorState(f.col, v));
});
r.post('/api/c/:slug/select', (req, res) => {
  const f = loadCollection(req, res); if (!f) return;
  const v = visitorFrom(req, res); if (!v) return;
  const round = roundFrom(req, res); if (!round) return;
  const x = collections.select(f.col, v, String(req.body.code || ''), round, req.user);
  if (x.error) return bad(res, x.error);
  res.json({ ...collections.visitorState(f.col, v), notCounted: x.notCounted || null });
});
r.post('/api/c/:slug/unselect', (req, res) => {
  const f = loadCollection(req, res); if (!f) return;
  const v = visitorFrom(req, res); if (!v) return;
  const round = roundFrom(req, res); if (!round) return;
  collections.unselect(f.col, v, round);
  res.json(collections.visitorState(f.col, v));
});
r.get('/api/c/:slug/qr.:fmt(svg|png)', wrap(async (req, res) => {
  const f = loadCollection(req, res); if (!f) return;
  const url = `${site.shareUrl()}/s/${f.col.slug}`; // QR — для других людей: dialogue.cards
  const opts = { errorCorrectionLevel: 'M', margin: 2, color: { dark: '#0f1430', light: '#ffffff' } };
  if (req.params.fmt === 'svg') return res.type('image/svg+xml').send(await QRCode.toString(url, { ...opts, type: 'svg' }));
  const size = Math.min(Math.max(Number(req.query.size) || 1024, 256), 2048);
  if (req.query.download) res.attachment(`dialogue-cards-${f.col.slug}.png`);
  res.type('png').send(await QRCode.toBuffer(url, { ...opts, width: size }));
}));

// ---------- встречи (публично) ----------
// Справочник городов для подписки на новые встречи — открытый, только названия (без пояса и координат).
r.get('/api/places/search', (req, res) => res.json({ places: places.search(String(req.query.q || '').slice(0, 80), String(req.query.country || '').slice(0, 80)) }));
r.get('/api/meetings/places', (req, res) => res.json({ places: meetings.places(req.showDemo) }));
r.get('/api/meetings', (req, res) => res.json({ dates: meetings.upcoming({ country: req.query.country, city: req.query.city, mode: req.query.mode, language: req.query.language, from: req.query.from }, req.showDemo) }));
// Подписки на новые встречи (22.11.2026): аккаунт или гость (этот браузер)
const msubs = require('./meeting-subs');
// Предварительные заявки на онлайн-занятия (28.11.2026): без регистрации; повтор — та же заявка.
const workshops = require('./workshops');
r.get('/api/workshops/mine', (req, res) => res.json({ request: workshops.mine(req.user, req.visitor) }));
r.post('/api/workshops', (req, res) => { if (!req.user && !req.visitor) return bad(res, 'bad_visitor'); out(res, workshops.submit(req.user, req.visitor, req.body || {}), 201); });
const subWho = (req, res) => { if (!req.user && !req.visitor) { bad(res, 'bad_visitor'); return false; } return true; };
r.get('/api/meeting-subs', (req, res) => res.json({ subs: msubs.list(req.user, req.visitor) }));
r.post('/api/meeting-subs', (req, res) => { if (subWho(req, res)) out(res, msubs.create(req.user, req.visitor, req.body || {}), 201); });
r.patch('/api/meeting-subs/:id', (req, res) => { if (subWho(req, res)) out(res, msubs.update(req.user, req.visitor, req.params.id, req.body || {})); });
r.delete('/api/meeting-subs/:id', (req, res) => { if (subWho(req, res)) out(res, msubs.remove(req.user, req.visitor, req.params.id)); });
r.get('/api/meetings/dates/:id', (req, res) => {
  const d = meetings.datePublic(Number(req.params.id), req.showDemo, req.user ? { id: req.user.id, isAdmin: req.has('admin') } : null);
  if (!d) return bad(res, 'not_found', 404);
  res.json(d);
});
r.post('/api/meetings/dates/:id/register', wrap(async (req, res) => {
  const r0 = await meetings.register(Number(req.params.id), { ...(req.body || {}), userId: req.user && !req.user.is_demo ? req.user.id : null, visitorId: req.visitor }, baseUrl(req), req.body.lang === 'en' ? 'en' : 'ru');
  if (r0.ok) safe(() => events.registered(r0.token));
  out(res, r0, 201);
}));
r.get('/api/registrations/:token', (req, res) => {
  const x = meetings.registrationByToken(String(req.params.token));
  if (!x) return bad(res, 'not_found', 404);
  res.json(x);
});
r.get('/api/registrations/:token/ics', (req, res) => {
  const ics = meetings.icsByToken(String(req.params.token), baseUrl(req), req.query.lang === 'en' ? 'en' : 'ru');
  if (!ics) return bad(res, 'not_found', 404);
  res.set('Content-Type', 'text/calendar; charset=utf-8').set('Content-Disposition', 'attachment; filename="dialogue-flow.ics"').set('Cache-Control', 'no-store').send(ics);
});
r.post('/api/registrations/:token/cancel', (req, res) => { const r0 = meetings.cancelByToken(String(req.params.token)); if (r0.ok && !r0.already) safe(() => events.registrationCancelled(String(req.params.token))); out(res, r0); });

// ---------- автор ----------
// Роль автора выдаётся автоматически при первой подаче работ (правила выдачи ролей ещё уточняются).
r.get('/api/artist/works', auth.requireUser, (req, res) => res.json({ works: works.myWorks(req.user.id), cards: works.myCards(req.user.id), criteria: works.criteriaList() }));
r.post('/api/artist/works', auth.requireUser, artistUpload.array('images', 20), wrap(async (req, res) => {
  const notes = [].concat(req.body.notes || []);
  const result = await works.submit(req.user, req.files || [], { termsAccepted: req.body.termsAccepted === 'true', termsVersion: req.body.termsVersion, notes, clientKey: req.body.clientKey, consentId: req.body.consentId });
  if (!result.error) auth.grant(req.user.id, 'artist');
  if (!result.error && !result.repeated) safe(() => events.worksQueued(!!req.user.is_demo, req.user.id));
  out(res, result, 201);
}));
r.post('/api/artist/works/:id/versions', auth.requireUser, artistUpload.single('image'), wrap(async (req, res) => {
  if (!req.file) return bad(res, 'no_image');
  const r0 = await works.addVersion(req.user, Number(req.params.id), req.file, req.body.note, req.body.consentId);
  if (r0.ok) safe(() => events.worksQueued(!!req.user.is_demo, req.user.id));
  out(res, r0);
}));
r.post('/api/artist/cards/:code/replace', auth.requireUser, artistUpload.single('image'), wrap(async (req, res) => {
  if (!req.file) return bad(res, 'no_image');
  const r0 = await works.proposeReplacement(req.user, req.params.code, req.file, { termsAccepted: req.body.termsAccepted === 'true', termsVersion: req.body.termsVersion, note: req.body.note, consentId: req.body.consentId });
  if (r0.id) safe(() => events.worksQueued(!!req.user.is_demo, req.user.id));
  out(res, r0, 201);
}));
r.post('/api/artist/cards/:code/withdraw', auth.requireUser, (req, res) => out(res, works.withdrawCard(req.user, req.params.code)));
r.post('/api/artist/cards/:code/versions/:vid/revoke', auth.requireUser, (req, res) => out(res, works.revokeOldVersion(req.user, req.params.code, req.params.vid)));
r.post('/api/artist/works/:id/withdraw', auth.requireUser, (req, res) => out(res, works.withdrawWork(req.user, Number(req.params.id))));
// ---------- изменения в коллекции: история для фасилитаторов ----------
const collection = require('./collection');
const printRequests = require('./print-requests');
r.get('/api/fac/changes', auth.requireUser, (req, res) => { if (!req.has('facilitator') && !req.has('admin')) return bad(res, 'forbidden', 403); res.json({ changes: collection.history(req.showDemo), unseen: collection.unseen(req.user.id, req.showDemo), unreadRemoved: db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND kind = 'collection_removed' AND read_at IS NULL").get(req.user.id).n }); });
r.post('/api/fac/changes/seen', auth.requireUser, (req, res) => { if (!req.has('facilitator') && !req.has('admin')) return bad(res, 'forbidden', 403); res.json(collection.markSeen(req.user.id)); });
r.get('/api/works/:id', auth.requireUser, (req, res) => {
  const id = Number(req.params.id);
  if (!works.canSee(req.user, req.roles, id)) return bad(res, 'not_found', 404);
  res.json(works.detail(id));
});

// ---------- кураторы ----------
const curator = auth.requireRole('curator');
r.get('/api/curation/queue', curator, (req, res) => res.json({ queue: works.queue(demoScope(req)), recent: works.recentDecided(demoScope(req)), criteria: works.criteriaList(), me: req.user.id }));
r.use('/api/curation/works/:id', (req, res, next) => (demoOnly(req, res, isDemoRow('works', 'id', Number(req.params.id))) ? next() : undefined));
r.post('/api/curation/works/:id/decide', curator, (req, res) => {
  const result = works.decide(req.user, Number(req.params.id), req.body || {});
  if (result.decisionId && !result.recommended) { push.onWorkDecision(result.decisionId).catch(() => {}); safe(() => events.workDecided(result.decisionId)); } // автору — о возврате или отклонении
  if (result.recommended) safe(() => events.workRecommended(Number(req.params.id), req.user.id));
  out(res, result);
});
r.post('/api/curation/works/:id/discuss', curator, (req, res) => { const r0 = works.discuss(req.user, Number(req.params.id), req.body.question ?? req.body.comment); if (r0.ok) safe(() => events.workDiscussed(Number(req.params.id), req.user.id)); out(res, r0); });
r.post('/api/curation/works/:id/vote', curator, (req, res) => out(res, works.vote(req.user, Number(req.params.id), req.body.vote, req.body.comment)));

// ---------- чаты: общий и ролевые; сообщения с изображениями; «Медиа» ----------
const chatUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 6 },
  fileFilter: (req, file, cb) => (/^image\/(jpeg|png|webp)$/.test(file.mimetype) ? cb(null, true) : cb(Object.assign(new Error('bad_image_type'), { code: 'bad_image_type' }))),
});
const CHAT_DIR = path.join(config.mediaDir, 'chat');
for (const d of ['full', 'thumb']) fs.mkdirSync(path.join(CHAT_DIR, d), { recursive: true });
async function chatImage(buf) {
  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height) throw Object.assign(new Error('bad_image_type'), { code: 'bad_image_type' });
  const name = `${crypto.randomBytes(12).toString('base64url')}.webp`;
  const full = await sharp(buf).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 84 }).toBuffer({ resolveWithObject: true });
  await sharp(buf).rotate().resize({ width: 360, withoutEnlargement: true }).webp({ quality: 78 }).toFile(path.join(CHAT_DIR, 'thumb', name));
  fs.writeFileSync(path.join(CHAT_DIR, 'full', name), full.data);
  return { file: name, width: full.info.width, height: full.info.height };
}
const roomGuard = (req, res, next) => {
  const room = req.params.room;
  const owner = community.dmOwner(room);
  if (owner) { // личная переписка с администрацией: сам участник или администратор
    if (owner !== req.user.id && !req.has('admin')) return bad(res, 'forbidden', 403);
    if (!db.prepare('SELECT id FROM users WHERE id = ?').get(owner)) return bad(res, 'not_found', 404);
    return next();
  }
  if (!community.ROOMS[room]) return bad(res, 'not_found', 404);
  if (!community.canRoom(room, req.has)) return bad(res, 'forbidden', 403);
  next();
};
// Руководство фасилитатора — открытое: скачать может любой.
r.get('/guide/dialogue-flow-guide.docx', (req, res) => {
  const f = guide.docxPath(); if (!f) return bad(res, 'not_found', 404);
  res.set('Cache-Control', 'no-cache');
  res.download(f, 'Dialogue Flow — руководство фасилитатора.docx');
});
r.get('/api/chats', auth.requireUser, (req, res) => res.json({ rooms: community.rooms(req.has, req.user.id, req.showDemo),
  direct: { unread: community.dmUnread(req.user.id), ...(req.has('admin') ? { adminThreads: community.dmUnreadAdmin(req.user.id, req.showDemo) } : {}) } }));
// Личная переписка с администрацией (28.11.2026): участник видит свою; сообщения администрации подписаны «Администрация».
r.get('/api/messages', auth.requireUser, (req, res) => res.json({ room: 'dm-' + req.user.id, messages: community.dmForOwner(req.user.id, req.showDemo), unread: community.dmUnread(req.user.id) }));
r.get('/api/chats/:room', auth.requireUser, roomGuard, (req, res) => res.json({
  messages: community.chat(req.params.room, req.showDemo, { id: req.user.id, isAdmin: req.has('admin') }),
  members: community.members(req.params.room), people: community.people(req.params.room, req.showDemo),
  notify: push.roomMode(req.user.id, req.params.room), rooms: community.rooms(req.has, req.user.id, req.showDemo),
}));
r.post('/api/chats/:room/read', auth.requireUser, roomGuard, (req, res) => res.json(community.markRead(req.user.id, req.params.room, (req.body || {}).lastId)));
r.put('/api/chats/:room/notify', auth.requireUser, roomGuard, (req, res) => out(res, push.setRoomMode(req.user.id, req.params.room, (req.body || {}).mode)));
r.post('/api/chats/:room/messages/:id/restore', auth.requireUser, roomGuard, (req, res) => {
  if (!req.has('admin')) return bad(res, 'forbidden', 403);
  out(res, community.restoreMessage(req.params.room, Number(req.params.id), req.user));
});
r.post('/api/chats/:room/messages/:id/forward', auth.requireUser, roomGuard, (req, res) => {
  const r0 = community.forward(req.params.room, Number(req.params.id), req.user, String((req.body || {}).to || ''));
  if (r0.ok) push.onMessage(r0.id).catch(() => {});
  out(res, r0, 201);
});
r.get('/api/admin/chat-log', auth.requireUser, (req, res) => (req.has('admin') ? res.json({ log: community.modLog() }) : bad(res, 'forbidden', 403)));
// ---------- push-уведомления: подписка по согласию, настройки, проверка ----------
r.get('/api/push', auth.requireUser, (req, res) => res.json({ ...push.status(req.user), demo: !!req.user.is_demo }));
r.post('/api/push/subscribe', auth.requireUser, (req, res) => out(res, push.subscribe(req.user, (req.body || {}).subscription, req.get('user-agent') || '')));
r.post('/api/push/unsubscribe', auth.requireUser, (req, res) => out(res, push.unsubscribe(req.user, (req.body || {}).endpoint)));
r.put('/api/push/prefs', auth.requireUser, (req, res) => { const b = req.body || {}; const patch = {}; for (const k of ['enabled', ...push.CATS]) if (typeof b[k] === 'boolean') patch[k] = b[k]; res.json({ prefs: push.setPrefs(req.user.id, patch) }); });
r.post('/api/push/test', auth.requireUser, wrap(async (req, res) => { const sent = await push.test(req.user); res.json({ sent }); }));
r.post('/api/chats/:room', auth.requireUser, roomGuard, chatUpload.array('images', 6), wrap(async (req, res) => {
  const b = req.body || {};
  if (b.clientId) { const dup = db.prepare('SELECT id FROM chat_messages WHERE user_id = ? AND client_id = ?').get(req.user.id, String(b.clientId).slice(0, 64)); if (dup) return res.status(201).json({ ok: true, id: dup.id, duplicate: true }); }
  const files = [];
  for (const f of req.files || []) files.push(await chatImage(f.buffer));
  const r0 = community.post(req.params.room, req.user, b.text, { files, category: b.category, clientId: b.clientId, replyTo: b.replyTo, mentions: b.mentions });
  if (r0.ok && !r0.duplicate) { push.onMessage(r0.id).catch((e) => console.error('push:', e.message)); safe(() => events.chatMessage(r0.id)); } // в фоне: ответ не ждёт push-сервисов
  out(res, r0, 201);
}));
r.delete('/api/chats/:room/messages/:id', auth.requireUser, roomGuard, (req, res) => out(res, community.deleteMessage(req.params.room, Number(req.params.id), req.user, req.has('admin'), (req.body || {}).reason || req.query.reason)));
r.get('/api/chats/:room/media', auth.requireUser, roomGuard, (req, res) => res.json({ media: community.media(req.params.room, req.showDemo, String(req.query.category || '')) }));
// Файлы вложений — только тем, у кого есть доступ к комнате, и только у неудалённых сообщений (не публичные адреса /media).
r.get('/api/chats/:room/media/:kind(full|thumb)/:file', auth.requireUser, roomGuard, (req, res) => {
  const file = path.basename(req.params.file);
  if (!community.attachmentFile(req.params.room, file)) return bad(res, 'not_found', 404);
  res.set('Cache-Control', 'private, no-cache'); // всегда перепроверять: удалённое сообщение не должно оставаться видимым из кэша
  res.sendFile(path.join(CHAT_DIR, req.params.kind, file));
});

// ---------- фасилитатор: подборки ----------
const fac = auth.requireRole('facilitator');
const ownsCollection = (req, id) => collections.ownerOf(id) === req.user.id || (req.has('admin') && (!req.user.is_demo || isDemoRow('collections', 'id', id)));
r.get('/api/collections', fac, (req, res) => res.json({
  collections: collections.listAll(req.has('admin') ? null : req.user.id).filter((c) => (req.user.is_demo ? c.isDemo : !c.isDemo || req.showDemo)), baseUrl: site.shareUrl(),
}));
r.post('/api/collections', fac, (req, res) => res.json({ id: collections.create(req.body && req.body.title, !!(req.body && req.body.isTest), req.user.id, !!req.user.is_demo) }));
r.get('/api/collections/:id', fac, (req, res) => {
  const id = Number(req.params.id);
  if (!collections.exists(id) || !ownsCollection(req, id)) return bad(res, 'not_found', 404);
  const d = collections.adminDetail(id);
  res.json({ ...d, url: `${site.shareUrl()}/s/${d.slug}` });
});
r.patch('/api/collections/:id', fac, (req, res) => {
  const id = Number(req.params.id);
  if (!collections.exists(id) || !ownsCollection(req, id)) return bad(res, 'not_found', 404);
  collections.update(id, req.body || {}); res.json({ ok: true });
});
r.put('/api/collections/:id/cards', fac, (req, res) => {
  const id = Number(req.params.id);
  if (!collections.exists(id) || !ownsCollection(req, id)) return bad(res, 'not_found', 404);
  out(res, collections.setCards(id, req.body && req.body.codes));
});
r.delete('/api/collections/:id', fac, (req, res) => {
  const id = Number(req.params.id);
  if (!collections.exists(id) || !ownsCollection(req, id)) return bad(res, 'not_found', 404);
  collections.remove(id); res.json({ ok: true });
});

// ---------- фасилитатор: встречи ----------
const ownsMeeting = (req, id) => meetings.facilitatorOf(id) === req.user.id || (req.has('admin') && (!req.user.is_demo || isDemoRow('meetings', 'id', id)));
r.get('/api/fac/meetings', fac, (req, res) => res.json({ meetings: meetings.mine(req.user.id) }));
// Поиск места/адреса для точки на карте (через сервер; OpenStreetMap Nominatim). Результат подтверждает фасилитатор.
const geoCache = new Map(); let geoLast = 0;
r.get('/api/places/geocode', fac, wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 200); const cc = /^[a-z]{2}$/i.test(req.query.cc || '') ? req.query.cc.toLowerCase() : '';
  if (q.length < 3) return res.json({ results: [] });
  const key = cc + '|' + q.toLowerCase();
  if (geoCache.has(key)) return res.json({ results: geoCache.get(key) });
  const wait = Math.max(0, geoLast + 1100 - Date.now()); if (wait) await new Promise((r2) => setTimeout(r2, wait)); geoLast = Date.now(); // не чаще 1 запроса в секунду
  try {
    const url = `${process.env.GEOCODER_URL || 'https://nominatim.openstreetmap.org/search'}?${new URLSearchParams({ format: 'jsonv2', limit: '5', q, 'accept-language': req.query.lang === 'en' ? 'en' : 'ru', ...(cc ? { countrycodes: cc } : {}) })}`;
    const rr = await fetch(url, { headers: { 'User-Agent': 'DialogueCards/1.0 (+https://dialogue.cards/)' }, signal: AbortSignal.timeout(8000) });
    if (!rr.ok) throw new Error('geocoder ' + rr.status);
    const results = (await rr.json()).map((x) => ({ label: x.display_name, lat: Number(x.lat), lng: Number(x.lon) })).filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng));
    geoCache.set(key, results); if (geoCache.size > 500) geoCache.delete(geoCache.keys().next().value);
    res.json({ results });
  } catch { bad(res, 'geocoder_unavailable', 503); }
}));
// Город встречи → часовой пояс (пояс вручную не выбирается). ?city=&country=&placeId=
r.get('/api/places/resolve', fac, (req, res) => res.json(places.resolve({ city: req.query.city, country: req.query.country, placeId: req.query.placeId })));
/**
 * Пояс встречи определяется по городу на сервере; присланный клиентом timezone не используется.
 * При повторе встречи (sameAs) и при сохранении без смены города пояс берётся у исходной встречи.
 */
function meetingPlace(req, existing) {
  const b = req.body || {};
  // онлайн-встреча: города нет, пояс выбирает фасилитатор (время вводится в этом поясе)
  if (b.mode === 'online') return meetings.validTz(String(b.timezone || '')) ? { city: '', country: '', timezone: String(b.timezone) } : { error: 'bad_timezone' };
  const same = (m) => m && cityKey(m.city) === cityKey(b.city) && cityKey(m.country) === cityKey(b.country);
  if (same(existing)) return { city: existing.city, country: existing.country, timezone: existing.timezone };
  const srcId = Number(b.sameAs);
  if (!existing && srcId && meetings.facilitatorOf(srcId) && ownsMeeting(req, srcId)) {
    const src = meetings.oneForEditor(srcId);
    if (same(src)) return { city: src.city, country: src.country, timezone: src.timezone };
  }
  const r = places.resolve({ city: b.city, country: b.country, placeId: b.placeId });
  if (r.status !== 'ok') return { error: r.status === 'empty' ? 'required_fields' : 'city_unresolved', options: r.options || [] };
  return { city: r.place.city, country: r.place.country, timezone: r.place.timezone };
}
r.post('/api/fac/meetings', fac, (req, res) => {
  const pl = meetingPlace(req, null); if (pl.error) return res.status(400).json(pl);
  const r0 = meetings.create(req.user, { ...req.body, ...pl });
  if (r0.id) safe(() => msubs.notifyNew(r0.id)); // подписчикам — о новой встрече
  out(res, r0, 201);
});
r.get('/api/fac/meetings/:id', fac, (req, res) => {
  const id = Number(req.params.id);
  if (!meetings.facilitatorOf(id) || !ownsMeeting(req, id)) return bad(res, 'not_found', 404);
  res.json(meetings.oneForEditor(id));
});
r.put('/api/fac/meetings/:id', fac, (req, res) => {
  const id = Number(req.params.id);
  if (!meetings.facilitatorOf(id) || !ownsMeeting(req, id)) return bad(res, 'not_found', 404);
  const pl = meetingPlace(req, meetings.oneForEditor(id)); if (pl.error) return res.status(400).json(pl);
  const before = db.prepare('SELECT venue, city, country FROM meetings WHERE id = ?').get(id);
  const r0 = meetings.update(id, { ...req.body, ...pl });
  if (r0.ok) safe(() => events.placeChanged(id, before, req.user.id));
  out(res, r0);
});
r.post('/api/fac/meetings/:id/dates', fac, (req, res) => {
  const id = Number(req.params.id);
  if (!meetings.facilitatorOf(id) || !ownsMeeting(req, id)) return bad(res, 'not_found', 404);
  out(res, meetings.addDates(id, req.body || {}));
});
r.post('/api/fac/meetings/:id/publish', fac, (req, res) => {
  const id = Number(req.params.id);
  if (!meetings.facilitatorOf(id) || !ownsMeeting(req, id)) return bad(res, 'not_found', 404);
  const r0 = meetings.setPublished(id, !!req.body.published);
  if (r0.becamePublished) safe(() => msubs.notifyNew(id)); // повторная публикация не дублирует (dedupe по встрече)
  out(res, r0);
});
r.patch('/api/fac/dates/:id', fac, (req, res) => {
  const mid = meetings.meetingOfDate(Number(req.params.id));
  if (!mid || !ownsMeeting(req, mid)) return bad(res, 'not_found', 404);
  const did = Number(req.params.id);
  const was = db.prepare('SELECT status FROM meeting_dates WHERE id = ?').get(did);
  const r0 = meetings.setDate(did, req.body || {});
  if (r0.ok && was && was.status !== 'cancelled' && req.body && req.body.status === 'cancelled') safe(() => events.dateCancelled(did, req.user.id));
  out(res, r0);
});

// ---------- встреча по телефонам (live): пульт фасилитатора и экран участника ----------
const live = require('./live');
const FEEDBACK_DIR = path.join(config.mediaDir, 'feedback');
fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
// Отзыв встречи: аудио или видео. Расширение файла — по проверенному типу (не по имени файла),
// содержимое сверяется с типом по первым байтам.
const FEEDBACK_TYPES = {
  'audio/mpeg': ['.mp3', 'mpeg'], 'audio/mp3': ['.mp3', 'mpeg'], 'audio/aac': ['.aac', 'mpeg'],
  'audio/mp4': ['.m4a', 'mp4'], 'audio/x-m4a': ['.m4a', 'mp4'], 'audio/m4a': ['.m4a', 'mp4'], 'audio/3gpp': ['.3gp', 'mp4'],
  'video/mp4': ['.mp4', 'mp4'], 'video/quicktime': ['.mov', 'mp4'], 'video/3gpp': ['.3gp', 'mp4'],
  'audio/webm': ['.webm', 'webm'], 'video/webm': ['.webm', 'webm'], 'video/x-matroska': ['.mkv', 'webm'],
  'audio/ogg': ['.ogg', 'ogg'], 'video/ogg': ['.ogv', 'ogg'],
  'audio/wav': ['.wav', 'wav'], 'audio/x-wav': ['.wav', 'wav'], 'audio/wave': ['.wav', 'wav'],
  'audio/flac': ['.flac', 'flac'], 'audio/amr': ['.amr', 'amr'],
};
const mediaType = (mime) => String(mime || '').split(';')[0].trim().toLowerCase();
/** Первые байты файла соответствуют заявленному контейнеру. */
function mediaMatches(family, b) {
  const at = (o, str) => b.length >= o + str.length && b.toString('latin1', o, o + str.length) === str;
  switch (family) {
    case 'mpeg': return at(0, 'ID3') || (b.length > 1 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0);
    case 'mp4': return ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip'].some((t) => at(4, t));
    case 'webm': return b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
    case 'ogg': return at(0, 'OggS');
    case 'wav': return at(0, 'RIFF') && at(8, 'WAVE');
    case 'flac': return at(0, 'fLaC');
    case 'amr': return at(0, '#!AMR');
    default: return false;
  }
}
function fileHead(file, n = 16) {
  const fd = fs.openSync(file, 'r');
  try { const b = Buffer.alloc(n); return b.subarray(0, fs.readSync(fd, b, 0, n, 0)); } finally { fs.closeSync(fd); }
}
const dropUpload = (req) => { if (req.file && req.file.path) try { fs.rmSync(req.file.path, { force: true }); } catch (e) { console.error('feedback file:', e.message); } };
const feedbackUpload = multer({
  storage: multer.diskStorage({ destination: FEEDBACK_DIR, filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + FEEDBACK_TYPES[mediaType(file.mimetype)][0]) }),
  limits: { fileSize: 80 * 1024 * 1024, files: 1, fields: 10, fieldSize: 64 * 1024 },
  fileFilter: (req, file, cb) => (FEEDBACK_TYPES[mediaType(file.mimetype)] ? cb(null, true) : cb(Object.assign(new Error('bad_media_type'), { code: 'bad_media_type' }))),
});
const liveDevice = (req, res) => { const v = (req.body && req.body.deviceId) || req.query.device; if (typeof v !== 'string' || !VISITOR_RE.test(v)) { bad(res, 'bad_visitor'); return null; } return v; };
const liveDone = (res, r) => { if (r && r.ok && r.sessionId) live.touch(r.sessionId); out(res, r); };
r.post('/api/fac/live', fac, (req, res) => {
  const cid = Number((req.body || {}).collectionId);
  const col = db.prepare('SELECT slug FROM collections WHERE id = ?').get(cid);
  if (!col) return bad(res, 'not_found', 404);
  if (!ownsCollection(req, cid)) return bad(res, 'forbidden', 403);
  const x = live.start(cid, req.user);
  if (x.ok && !x.existing) live.bus.emit('col' + col.slug); // открытые страницы QR узнают о новой встрече
  out(res, x, 201);
});
r.get('/api/fac/live', fac, (req, res) => res.json({ sessions: live.mine(req.user.id, req.has('admin')) }));
const liveFac = (req, res) => { const s = live.forFacilitator(Number(req.params.id), req.user, req.has('admin')); if (!s) { bad(res, 'not_found', 404); return null; } return s; };
r.get('/api/fac/live/:id', fac, (req, res) => { const s = liveFac(req, res); if (!s) return; const d = req.query.device; if (typeof d === 'string' && VISITOR_RE.test(d)) live.setFacDevice(s, d); res.json(live.panel(live.forFacilitator(s.id, req.user, true))); });
const LIVE_ACTIONS = {
  start_round: (s) => live.startRound(s), advance: (s) => live.advance(s), talk: (s, b) => live.startTalk(s, b.minutes), add_time: (s, b) => live.addTime(s, b.minutes),
  end_round: (s) => live.endRound(s), recall: (s) => live.recall(s), minutes: (s, b) => live.setMinutes(s, b.minutes), end: (s) => live.end(s),
  remove: (s, b) => live.removeMember(s, b.memberId),
};
r.post('/api/fac/live/:id/:action(start_round|advance|talk|add_time|end_round|recall|minutes|end|remove)', fac, (req, res) => {
  const s = liveFac(req, res); if (!s) return;
  const x = LIVE_ACTIONS[req.params.action](s, req.body || {});
  if (x.error) return bad(res, x.error);
  live.touch(s.id); res.json(live.panel(live.forFacilitator(s.id, req.user, true)));
});
r.post('/api/fac/live/:id/self', fac, (req, res) => {
  const s = liveFac(req, res); if (!s) return;
  const d = liveDevice(req, res); if (!d) return;
  live.selfJoin(s, req.user, d, !!(req.body || {}).on); live.touch(s.id); res.json(live.panel(live.forFacilitator(s.id, req.user, true)));
});
r.get('/api/fac/live/:id/feedback/:fid/file', fac, (req, res) => {
  const s = liveFac(req, res); if (!s) return;
  const f = live.feedbackFile(s.id, req.params.fid);
  if (!f || !f.file) return bad(res, 'not_found', 404);
  res.set('Cache-Control', 'private, no-cache'); res.type(f.mime || 'application/octet-stream');
  res.sendFile(path.join(FEEDBACK_DIR, path.basename(f.file)));
});
// Поток событий: при каждом изменении — номер версии; клиент перечитывает состояние. Буферизацию nginx отключаем заголовком.
function liveStream(req, res, sessionId) {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
  res.flushHeaders();
  const send = (v) => res.write(`data: ${v}\n\n`);
  send(live.version(sessionId));
  const on = (v) => send(v);
  live.bus.on('s' + sessionId, on);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); live.bus.off('s' + sessionId, on); });
}
r.get('/api/fac/live/:id/events', fac, (req, res) => { const s = liveFac(req, res); if (s) liveStream(req, res, s.id); });
r.get('/api/live/:slug/state', (req, res) => {
  const d = liveDevice(req, res); if (!d) return;
  const st = live.participantState(req.params.slug, d);
  if (!st) return bad(res, 'not_found', 404);
  res.set('Cache-Control', 'no-store'); res.json(st);
});
r.get('/api/live/:slug/events', (req, res) => {
  const { s, last } = live.bySlug(req.params.slug);
  const id = s ? s.id : last ? last.id : 0;
  liveStream(req, res, id);
  // новая встреча по этому QR: слушаем и её
  if (!s) { const on = () => res.write('data: new\n\n'); live.bus.on('col' + req.params.slug, on); req.on('close', () => live.bus.off('col' + req.params.slug, on)); }
});
r.post('/api/live/:slug/join', (req, res) => { const d = liveDevice(req, res); if (d) liveDone(res, live.join(req.params.slug, d, (req.body || {}).name, req.user)); });
r.post('/api/live/:slug/leave', (req, res) => { const d = liveDevice(req, res); if (d) liveDone(res, live.leave(req.params.slug, d)); });
r.post('/api/live/:slug/pick', (req, res) => { const d = liveDevice(req, res); if (d) liveDone(res, live.holderPick(req.params.slug, d, (req.body || {}).code)); });
r.post('/api/live/:slug/partner', (req, res) => { const d = liveDevice(req, res); if (d) liveDone(res, live.listenerPick(req.params.slug, d, (req.body || {}).slotId)); });
// Отзыв: сначала проверка встречи и участника (до приёма файла), затем файл; при любой ошибке принятый файл удаляется.
r.post('/api/live/feedback/:id', (req, res, next) => {
  const v = (req.body && req.body.deviceId) || req.query.device || req.visitor;
  if (typeof v !== 'string' || !VISITOR_RE.test(v)) return bad(res, 'bad_visitor');
  const g = live.feedbackAllowed(Number(req.params.id), v);
  if (g.error) return bad(res, g.error, g.status || 400);
  req.liveDevice = v;
  feedbackUpload.single('media')(req, res, (err) => {
    if (!err) return next();
    dropUpload(req);
    bad(res, err.code === 'bad_media_type' ? 'bad_media_type' : err.code === 'LIMIT_FILE_SIZE' ? 'media_too_large' : 'upload_error');
  });
}, (req, res) => {
  let done = false;
  try {
    const b = req.body || {};
    if (b.deviceId !== undefined && b.deviceId !== req.liveDevice) return bad(res, 'bad_visitor');
    let file = null; let mime = null;
    if (req.file) {
      mime = mediaType(req.file.mimetype);
      if (!mediaMatches(FEEDBACK_TYPES[mime][1], fileHead(req.file.path))) return bad(res, 'bad_media_type');
      file = req.file.filename;
    }
    const x = live.feedback(Number(req.params.id), req.liveDevice, { text: b.text, file, mime, mayPublish: b.mayPublish === '1' || b.mayPublish === true });
    if (x.error) return bad(res, x.error, x.status || 400);
    done = true;
    live.touch(Number(req.params.id));
    res.status(201).json({ ok: true });
  } finally { if (!done) dropUpload(req); }
});

// ---------- игры компанией (без фасилитатора): комната по QR/коду ----------
const group = require('./group');
const groupDone = (res, x, status = 200) => { if (x && x.ok && x.id) group.touch(x.id); out(res, x, status); };
r.post('/api/group', (req, res) => { const d = liveDevice(req, res); if (!d) return; const b = req.body || {}; const x = group.create({ format: b.format, deviceId: d, name: b.name, showDemo: req.showDemo, codes: Array.isArray(b.codes) ? b.codes : (b.collection && req.user ? personal.collectionCodes(req.user.id, b.collection) : null), from: typeof b.from === 'string' ? b.from : null }); if (x.fromId) group.touch(x.fromId); out(res, x, 201); });
r.get('/api/group/:code/state', (req, res) => {
  const d = liveDevice(req, res); if (!d) return;
  const st = group.state(req.params.code, d, req.showDemo);
  if (!st) return bad(res, 'group_not_found', 404);
  res.set('Cache-Control', 'no-store'); res.json({ ...st, serverNow: new Date().toISOString() });
});
r.get('/api/group/:code/events', (req, res) => {
  const rm = group.room(req.params.code); if (!rm) return bad(res, 'group_not_found', 404);
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
  res.flushHeaders(); res.write(`data: ${group.version(rm.id)}\n\n`);
  const on = (v) => res.write(`data: ${v}\n\n`); group.bus.on('g' + rm.id, on);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); group.bus.off('g' + rm.id, on); });
});
r.post('/api/group/:code/join', (req, res) => { const d = liveDevice(req, res); if (d) groupDone(res, group.join(req.params.code, d, (req.body || {}).name)); });
r.post('/api/group/:code/leave', (req, res) => { const d = liveDevice(req, res); if (d) groupDone(res, group.leave(req.params.code, d)); });
r.post('/api/group/:code/act', (req, res) => { const d = liveDevice(req, res); if (!d) return; const b = req.body || {}; groupDone(res, group.act(req.params.code, d, String(b.action || ''), b, req.showDemo)); });
r.get('/api/group/:code/qr.png', wrap(async (req, res) => {
  const rm = group.room(req.params.code); if (!rm) return bad(res, 'group_not_found', 404);
  const png = await QRCode.toBuffer(`${site.shareUrl()}/g/${rm.code}`, { width: Math.min(1600, Math.max(200, Number(req.query.size) || 600)), margin: 2 });
  res.type('png').send(png);
}));

// ---------- путь к роли фасилитатора ----------
r.get('/api/fac/application', auth.requireUser, (req, res) => {
  const g = guide.load();
  const chapters = g ? g.chapters.filter((c) => c.course) : null;
  res.json({
    application: community.application(req.user.id), isFacilitator: req.has('facilitator'),
    // главы курса: из загруженного руководства (с текстом) или названия глав без текста, пока руководство не загружено
    course: chapters && chapters.length === community.COURSE.length ? chapters.map((c) => c.title) : community.COURSE,
    chapters: chapters && chapters.length === community.COURSE.length ? chapters.map((c) => c.blocks) : null,
    extra: g ? g.chapters.filter((c) => !c.course) : [],
    guideTitle: g ? g.title : '', guideMissing: !(chapters && chapters.length === community.COURSE.length),
    questions: community.QUESTIONS.map(({ id, text, options }) => ({ id, text, options })), questionsPlaceholder: false,
  });
});
r.post('/api/fac/application', auth.requireUser, (req, res) => res.json({ application: community.startApplication(req.user) }));
r.put('/api/fac/application', auth.requireUser, (req, res) => out(res, community.saveApplication(req.user, req.body || {})));
// Заявка на роль куратора (вошедший пользователь); решение — администратор.
r.get('/api/curator/application', auth.requireUser, (req, res) => res.json({ isCurator: req.roles.includes('curator'), application: community.curatorApplication(req.user.id) }));
r.post('/api/curator/application', auth.requireUser, (req, res) => { const r0 = community.submitCuratorApplication(req.user, req.body || {}); if (r0.ok) safe(() => events.applicationSubmitted('curator', req.user.id)); out(res, r0, 201); });
// Запрос фасилитатора на готовую печатную колоду: уходит команде проекта (виден администратору).
r.get('/api/fac/print-request', fac, (req, res) => res.json({ request: printRequests.mine(req.user.id) }));
r.post('/api/fac/print-request', fac, (req, res) => out(res, printRequests.save(req.user, req.body || {}), 201));
r.post('/api/fac/application/submit', auth.requireUser, (req, res) => { const r0 = community.submitApplication(req.user); if (r0.ok) safe(() => events.applicationSubmitted('facilitator', req.user.id)); out(res, r0); });
r.post('/api/fac/application/quiz', auth.requireUser, (req, res) => out(res, community.checkQuiz(req.user, (req.body || {}).answers)));
r.post('/api/fac/application/manual', auth.requireUser, (req, res) => { const r0 = community.manualReview(req.user, req.body || {}); if (r0.ok) safe(() => events.applicationSubmitted('facilitator', req.user.id, { manual: true })); out(res, r0); });

// ---------- печатное направление ----------
r.get('/api/print', auth.requireUser, (req, res) => {
  if (!req.has('curator', 'artist')) return bad(res, 'forbidden', 403); // состав печатной колоды определяет владелец проекта; фасилитатору отбор карт для печати не нужен
  const rows = db.prepare(`SELECT k.code, k.number, k.author, k.print_permission, k.image_thumb, k.width, k.height,
      ${choices.totalSql('k')} AS selections
    FROM cards k WHERE k.status = 'published' AND k.is_demo = 0 ORDER BY selections DESC, k.number LIMIT 60`).all();
  res.json({ downloadsEnabled: false, cards: rows.map((c) => ({ code: c.code, author: c.author, printPermission: c.print_permission, selections: c.selections,
    thumb: cards.mediaUrl('thumb', c.image_thumb), width: c.width, height: c.height })) });
});

// ---------- администратор ----------
const admin = express.Router();
admin.use(auth.requireRole('admin'));
// Демо-администратор: изменения — только над демо-объектами; журнал писем и чужие email ему не показываются.
admin.use((req, res, next) => {
  if (!req.user.is_demo) return next();
  const p = req.path; const m = req.method;
  if (m === 'GET') return p === '/outbox' ? bad(res, 'demo_readonly', 403) : next();
  let ok = false; let mm;
  if (p === '/demo/seed' || p === '/demo/clear') ok = true;
  else if ((mm = p.match(/^\/users\/(\d+)(?:\/|$)/))) ok = isDemoRow('users', 'id', Number(mm[1]));
  else if ((mm = p.match(/^\/applications\/(\d+)(?:\/|$)/))) ok = isDemoRow('fac_applications', 'user_id', Number(mm[1]));
  else if ((mm = p.match(/^\/print-requests\/(\d+)(?:\/|$)/))) ok = isDemoRow('print_requests', 'id', Number(mm[1]));
  else if ((mm = p.match(/^\/curator-applications\/(\d+)(?:\/|$)/))) ok = isDemoRow('curator_applications', 'user_id', Number(mm[1]));
  else if ((mm = p.match(/^\/meetings\/(\d+)(?:\/|$)/))) ok = isDemoRow('meetings', 'id', Number(mm[1]));
  else if ((mm = p.match(/^\/cards\/(DC-\d+)(?:\/|$)/)) && p !== '/cards/bulk-author') ok = isDemoRow('cards', 'code', mm[1]);
  return ok ? next() : bad(res, 'demo_readonly', 403);
});
admin.get('/overview', (req, res) => {
  const count = (sql, ...a) => db.prepare(sql).get(...a).n;
  const byStatus = (table, col = 'status') => Object.fromEntries(db.prepare(`SELECT ${col} AS s, COUNT(*) AS n FROM ${table} GROUP BY ${col}`).all().map((x) => [x.s, x.n]));
  res.json({
    cards: byStatus('cards'), works: byStatus('works'), meetings: byStatus('meetings'),
    users: count('SELECT COUNT(*) AS n FROM users WHERE is_demo = 0'),
    pendingApplications: count(`SELECT COUNT(*) AS n FROM fac_applications WHERE status = 'submitted'`) + count(`SELECT COUNT(*) AS n FROM curator_applications WHERE status = 'submitted'`),
    printRequests: count(`SELECT COUNT(*) AS n FROM print_requests WHERE status = 'new' AND is_demo = 0`),
    registrations: count(`SELECT COUNT(*) AS n FROM registrations WHERE status = 'active'`),
    comments: count('SELECT COUNT(*) AS n FROM comments WHERE deleted_at IS NULL'),
    mailConnected: mail.connected(), demoMode: config.demoMode,
  });
});
admin.get('/workshops', (req, res) => res.json(workshops.list(req.showDemo || !!req.user.is_demo)));
admin.post('/workshops/:id/status', (req, res) => out(res, workshops.setStatus(req.params.id, String((req.body || {}).status || ''), req.user.id)));
// «Требует внимания»: только то, что ждёт решения администратора, — счётчики для стартового экрана и меню разделов.
admin.get('/attention', (req, res) => {
  const sc = demoScope(req); const demo = sc !== false; const dw = (col) => (sc === false ? `${col} = 0` : sc === 'only' ? `${col} = 1` : '1=1');
  const n = (sql) => db.prepare(sql).get().n;
  res.json({
    works: n(`SELECT COUNT(*) AS n FROM works WHERE recommended_at IS NOT NULL AND status IN ('submitted','discussion','recommended') AND ${dw('is_demo')}`),
    facApps: n(`SELECT COUNT(*) AS n FROM fac_applications WHERE status = 'submitted' AND manual_review = 0 AND ${dw('is_demo')}`),
    facManual: n(`SELECT COUNT(*) AS n FROM fac_applications WHERE status = 'submitted' AND manual_review = 1 AND ${dw('is_demo')}`),
    curApps: n(`SELECT COUNT(*) AS n FROM curator_applications WHERE status = 'submitted' AND ${dw('is_demo')}`),
    decks: n(`SELECT COUNT(*) AS n FROM print_requests WHERE status = 'new' AND ${dw('is_demo')}`),
    messages: community.dmUnreadAdmin(req.user.id, demo),
    workshops: workshops.newCount(demo),
  });
});
// «Сообщения»: личные переписки участников с администрацией. Сам текст — через /api/chats/dm-<id> (общие механизмы чата).
admin.get('/messages', (req, res) => res.json({ threads: community.dmThreads(req.user.id, req.showDemo || !!req.user.is_demo).filter((t) => (req.user.is_demo ? t.isDemo : true)) }));
admin.get('/messages/:uid', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.uid));
  if (!u || (req.user.is_demo && !u.is_demo)) return bad(res, 'not_found', 404);
  const room = 'dm-' + u.id;
  res.json({ user: { id: u.id, name: u.public_name || u.name, roles: community.ROOMS && db.prepare('SELECT role FROM user_roles WHERE user_id = ?').all(u.id).map((x) => x.role), email: u.email, createdAt: u.created_at },
    room, messages: community.chat(room, true, { id: req.user.id, isAdmin: true }).map((m) => ({ ...m, fromAdmin: m.userId !== u.id })) });
});
admin.get('/users', (req, res) => {
  const rows = db.prepare(`SELECT * FROM users WHERE ${req.user.is_demo ? 'is_demo = 1' : req.showDemo ? '1=1' : 'is_demo = 0'} ORDER BY is_demo, id`).all();
  const cardsOf = db.prepare(`SELECT COUNT(*) AS n FROM cards WHERE artist_id = ? AND status = 'published'`);
  res.json({ users: rows.map((u) => ({ ...auth.publicUser(u), createdAt: u.created_at, lastLoginAt: u.last_login_at, cardCount: cardsOf.get(u.id).n })) });
});
// Привязать карты к аккаунту автора (например, первую колоду «Ананды Майи» — к её настоящему аккаунту):
// по этой связи сервер узнаёт автора, и его выбор своей карты не идёт в общий счёт.
admin.post('/users/:id/transfer-cards', (req, res) => {
  if (req.user.is_demo) return bad(res, 'demo_readonly', 403);
  const from = Number(req.params.id); const to = Number(req.body && req.body.to);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(to);
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(from) || !target || target.is_demo || from === to) return bad(res, 'not_found', 404);
  const r = db.prepare('UPDATE cards SET artist_id = ? WHERE artist_id = ? AND is_demo = 0').run(to, from);
  auth.grant(to, 'artist', req.user.id);
  res.json({ ok: true, moved: Number(r.changes) });
});
admin.post('/users/:id/roles', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) return bad(res, 'not_found', 404);
  if (!auth.ROLES.includes(req.body.role)) return bad(res, 'bad_role');
  if (req.body.grant) auth.grant(id, req.body.role, req.user.id);
  else {
    if (req.body.role === 'admin' && id === req.user.id) return bad(res, 'cannot_revoke_own_admin');
    auth.revoke(id, req.body.role);
  }
  res.json({ ok: true, roles: auth.rolesOf(id) });
});
admin.patch('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const email = req.body.email ? String(req.body.email).trim().toLowerCase() : null;
  if (email && !auth.EMAIL_RE.test(email)) return bad(res, 'bad_email');
  try { db.prepare('UPDATE users SET email = COALESCE(?, email) WHERE id = ?').run(email, id); } catch { return bad(res, 'email_taken'); }
  res.json({ ok: true });
});
// Руководство фасилитатора (.docx) — текст глав вводного курса. Хранится в данных сервера, не в репозитории.
const docUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } });
admin.get('/guide', (req, res) => { const g = guide.load(); res.json({ uploadedAt: g ? g.uploadedAt : null, bundled: !!(g && g.bundled), title: g ? g.title : '', chapters: g ? g.chapters.map((c) => ({ title: c.title, course: c.course, blocks: c.blocks.length })) : [] }); });
admin.post('/guide', (req, res, next) => (req.user.is_demo ? bad(res, 'demo_readonly', 403) : next()), docUpload.single('file'), (req, res) => {
  if (!req.file) return bad(res, 'file_required');
  out(res, guide.save(req.file.buffer, req.user.id), 201);
});
// Материалы руководств (18.11.2026): полный PDF и аудиозаписи глав. Пока файлов нет — ничего не показывается (без заглушек-файлов).
// guide: facilitator | artist; аудио — глава n (с 1). Файлы — в DATA_DIR/guide-assets.
const assetDir = path.join(config.dataDir, 'guide-assets');
const assetUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 80 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => (/^(application\/pdf|audio\/(mpeg|mp4|x-m4a|aac|ogg|webm|wav))$/.test(file.mimetype) ? cb(null, true) : cb(Object.assign(new Error('bad_file_type'), { code: 'bad_file_type' }))) });
const assetName = (g, kind, n) => (['facilitator', 'artist', 'project'].includes(g) ? (kind === 'pdf' ? `${g}.pdf` : /^\d{1,2}$/.test(String(n)) ? `${g}-ch${Number(n)}.audio` : null) : null);
function guideAssets(g) {
  const out = { pdf: false, audio: {} };
  if (!['facilitator', 'artist', 'project'].includes(g)) return out; // g идёт в RegExp — только известные значения
  try { for (const f of fs.readdirSync(assetDir)) { if (f === `${g}.pdf`) out.pdf = true; const m = f.match(new RegExp(`^${g}-ch(\\d+)\\.audio$`)); if (m) out.audio[m[1]] = true; } } catch { /* ещё нет */ }
  return out;
}
r.get('/api/guides/:g/assets', (req, res) => res.json(guideAssets(String(req.params.g))));
r.get('/guides/:g/:file', (req, res) => {
  const g = String(req.params.g); const f = String(req.params.file);
  const name = f === 'guide.pdf' ? assetName(g, 'pdf') : (f.match(/^chapter-(\d{1,2})$/) ? assetName(g, 'audio', f.split('-')[1]) : null);
  if (!name) return bad(res, 'not_found', 404);
  const full = path.join(assetDir, name); if (!fs.existsSync(full)) return bad(res, 'not_found', 404);
  let type = 'application/pdf'; try { type = name.endsWith('.pdf') ? 'application/pdf' : fs.readFileSync(full + '.type', 'utf8'); } catch { type = 'audio/mpeg'; }
  res.type(type).sendFile(full);
});
admin.post('/guides/:g/:kind', (req, res, next) => (req.user.is_demo ? bad(res, 'demo_readonly', 403) : next()), assetUpload.single('file'), (req, res) => {
  const name = assetName(String(req.params.g), req.params.kind === 'pdf' ? 'pdf' : 'audio', req.query.chapter);
  if (!name || !req.file) return bad(res, 'file_required');
  fs.mkdirSync(assetDir, { recursive: true }); fs.writeFileSync(path.join(assetDir, name), req.file.buffer);
  if (!name.endsWith('.pdf')) fs.writeFileSync(path.join(assetDir, name + '.type'), req.file.mimetype);
  res.status(201).json({ ok: true });
});
admin.get('/print-requests', (req, res) => res.json({ requests: printRequests.list(demoScope(req)) }));
admin.post('/print-requests/:id/done', (req, res) => { db.prepare(`UPDATE print_requests SET status = 'done' WHERE id = ?`).run(Number(req.params.id)); res.json({ ok: true }); });
admin.get('/curator-applications', (req, res) => res.json({ applications: community.curatorApplications(demoScope(req)) }));
admin.post('/curator-applications/:userId/decide', (req, res) => { const r0 = community.decideCuratorApplication(req.user.id, Number(req.params.userId), !!req.body.approve, req.body.note); if (r0.ok) safe(() => events.applicationDecided('curator', Number(req.params.userId), !!req.body.approve)); out(res, r0); });
admin.get('/applications', (req, res) => res.json({ applications: community.applications(demoScope(req)) }));
admin.post('/applications/:userId/decide', (req, res) => { const r0 = community.decideApplication(req.user.id, Number(req.params.userId), !!req.body.approve, req.body.note); if (r0.ok) safe(() => events.applicationDecided('facilitator', Number(req.params.userId), !!req.body.approve)); out(res, r0); });
admin.get('/meetings', (req, res) => res.json({ meetings: meetings.allForAdmin(demoScope(req)) }));
admin.post('/meetings/:id/remove', (req, res) => { const r0 = meetings.removeByAdmin(req.user.id, Number(req.params.id), req.body.reason); if (r0.ok) safe(() => events.meetingRemoved(Number(req.params.id))); out(res, r0); });
admin.post('/meetings/:id/restore', (req, res) => out(res, meetings.restoreByAdmin(Number(req.params.id))));
admin.get('/comments', (req, res) => res.json({ comments: community.recentComments(demoScope(req)) }));
admin.put('/criteria', (req, res) => out(res, works.setCriteria(req.body && req.body.criteria)));
// Работы: очередь «Одобрено кураторами» (только рекомендации) и обзор всех решений; окончательное решение — администратор.
admin.get('/exchange-stats', (req, res) => res.json(exchanges.stats(Math.min(365, Math.max(1, Number(req.query.days) || 30)), demoScope(req))));
admin.get('/works', (req, res) => res.json({ recommended: works.recommendedQueue(demoScope(req)), decisions: works.decisionsLog(demoScope(req)), criteria: works.criteriaList() }));
admin.post('/works/:id/decide', (req, res) => {
  const result = works.adminDecide(req.user, Number(req.params.id), req.body || {});
  if (result.decisionId) { push.onWorkDecision(result.decisionId).catch(() => {}); safe(() => events.workDecided(result.decisionId)); } // автору — о публикации, возврате или отклонении
  out(res, result);
});
admin.get('/outbox', (req, res) => res.json({ letters: db.prepare('SELECT id, to_email AS "to", subject, status, created_at AS createdAt FROM outbox ORDER BY id DESC LIMIT 50').all() }));
admin.post('/demo/seed', wrap(async (req, res) => { if (!config.demoMode) return bad(res, 'demo_disabled', 403); res.json(await demo.seed()); }));
admin.post('/demo/clear', (req, res) => { if (!config.demoMode) return bad(res, 'demo_disabled', 403); res.json(demo.clear()); });

admin.get('/cards', (req, res) => {
  const rows = db.prepare(`
    SELECT k.*,
      ${choices.totalSql('k')} AS selections,
      (SELECT COUNT(*) FROM selections s WHERE s.card_id = k.id AND s.cancelled_at IS NULL AND s.is_test = 0 AND s.counted = 1) AS col_selections,
      (SELECT COUNT(*) FROM selections s WHERE s.card_id = k.id AND s.cancelled_at IS NULL AND (s.is_test = 1 OR s.counted = 0)) AS test_selections,
      (SELECT COUNT(*) FROM card_offers o WHERE o.card_id = k.id AND o.is_test = 0) AS offers,
      (SELECT COUNT(*) FROM collection_cards cc WHERE cc.card_id = k.id) AS in_collections,
      (SELECT COUNT(*) FROM comments c WHERE c.card_id = k.id AND c.deleted_at IS NULL) AS comments
    FROM cards k WHERE ${demoWhere(demoScope(req), 'k.is_demo')} ORDER BY k.number ASC`).all();
  res.json({ cards: rows.map((x) => ({
    ...cards.publicCard(x, { withDetails: true }), status: x.status, source: x.source, removedAt: x.removed_at, removedBy: x.removed_by, purged: !!x.purged_at,
    selections: x.selections, colSelections: x.col_selections, testSelections: x.test_selections, offers: x.offers, inCollections: x.in_collections, comments: x.comments,
    printPermission: x.print_permission,
  })) });
});
admin.post('/cards', upload.array('images', 20), wrap(async (req, res) => {
  const files = req.files || [];
  if (!files.length) return bad(res, 'no_images');
  const created = []; const failed = [];
  for (const f of files) {
    try { created.push(await cards.createFromImage(f.buffer, { author: req.body.author || '', originalName: f.originalname })); } catch { failed.push(f.originalname); }
  }
  res.status(created.length ? 200 : 400).json({ created, failed });
}));
admin.patch('/cards/:code', (req, res) => {
  const author = req.body && req.body.author;
  if (typeof author !== 'string') return bad(res, 'bad_request');
  const x = db.prepare('UPDATE cards SET author = ? WHERE code = ?').run(author.trim().slice(0, 200), req.params.code);
  if (!x.changes) return bad(res, 'not_found', 404);
  res.json({ ok: true });
});
admin.patch('/cards/:code/print', (req, res) => {
  if (!['not_set', 'allowed', 'denied'].includes(req.body.permission)) return bad(res, 'bad_request');
  const x = db.prepare('UPDATE cards SET print_permission = ? WHERE code = ?').run(req.body.permission, req.params.code);
  if (!x.changes) return bad(res, 'not_found', 404);
  res.json({ ok: true });
});
admin.post('/cards/bulk-author', (req, res) => {
  const author = String((req.body && req.body.author) || '').trim().slice(0, 200);
  if (!author) return bad(res, 'bad_request');
  res.json({ updated: db.prepare(`UPDATE cards SET author = ? WHERE author = ''`).run(author).changes });
});
admin.post('/cards/:code/remove', (req, res) => {
  const x = db.prepare(`UPDATE cards SET status = 'removed', removed_by = 'admin', removed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE code = ? AND status = 'published'`).run(req.params.code);
  if (!x.changes) return bad(res, 'not_found', 404);
  res.json({ ok: true });
});
// окончательное исключение карты из коллекции (в отличие от временного «Снять с публикации»): файлы удаляются, фасилитаторы уведомляются
admin.post('/cards/:code/exclude', (req, res) => { if (!(req.body && req.body.confirm)) return bad(res, 'confirm_required'); out(res, collection.removeFinal(req.params.code, 'admin')); });
admin.get('/removals', (req, res) => res.json({ removals: collection.adminRemovals(demoScope(req)), mailConnected: mail.connected() }));
admin.post('/removal-tasks/:id', (req, res) => out(res, collection.setTask(req.params.id, String((req.body || {}).status || ''), (req.body || {}).note, req.user.id)));
admin.post('/removals/retry-mail', wrap(async (req, res) => { await collection.processMail(); res.json({ ok: true }); }));
admin.get('/terms', (req, res) => res.json({ drafts: terms.drafts(), active: terms.active(), stats: db.prepare('SELECT e.version, e.lang, COUNT(c.id) AS n FROM terms_editions e LEFT JOIN terms_consents c ON c.edition_id = e.id AND c.used_at IS NOT NULL GROUP BY e.id').all() }));
admin.post('/terms/publish', (req, res) => { const b = req.body || {}; if (!b.confirm) return bad(res, 'confirm_required'); out(res, terms.publish(req.user, b.lang)); });
admin.post('/cards/:code/restore', (req, res) => {
  const pc = db.prepare('SELECT purged_at FROM cards WHERE code = ?').get(req.params.code);
  if (pc && pc.purged_at) return bad(res, 'card_purged'); // окончательно удалённую карту вернуть нельзя
  const x = db.prepare(`UPDATE cards SET status = 'published', removed_at = NULL, removed_by = '' WHERE code = ? AND status = 'removed'`).run(req.params.code);
  if (!x.changes) return bad(res, 'not_found', 404);
  res.json({ ok: true });
});
// ---------- обмен с другом «Что ты здесь видишь?» (exchanges.js) ----------
const pubCard = (code) => db.prepare("SELECT * FROM cards WHERE code = ? AND status = 'published'").get(String(code || ''));
// ---------- «Глаз-алмаз»: банк вопросов и обмен «Предложить другу» (22.11.2026) ----------
const eagle = require('./eagle');
r.get('/api/eagle/bank', (req, res) => {
  const codes = db.prepare("SELECT code, is_demo FROM cards WHERE status = 'published'").all().filter((c) => !c.is_demo || req.showDemo).map((c) => c.code);
  res.set('Cache-Control', 'no-store').json(eagle.forCards(codes));
});
r.post('/api/eagle/x', (req, res) => { if (!req.visitor && !req.user) return bad(res, 'bad_visitor'); out(res, eagle.create(req.user, req.visitor, req.body || {}, !!req.showDemo && !!(req.user && req.user.is_demo)), 201); });
r.get('/api/eagle/x/:t', (req, res) => {
  const v = eagle.view(String(req.params.t), req.user, req.visitor, { look: req.query.look === '1' });
  if (!v) return bad(res, 'not_found', 404);
  const c = pubCard(v.code);
  res.set('Cache-Control', 'no-store').json({ ...v, card: c ? cards.publicCard(c) : null });
});
r.post('/api/eagle/x/:t/answer', (req, res) => {
  const r0 = eagle.reply(String(req.params.t), req.user, req.visitor, req.body || {});
  if (r0.error) return out(res, r0);
  if (!r0.repeated) safe(() => bell.add(r0.x.from_user ? { userId: r0.x.from_user } : { visitorId: r0.x.from_visitor }, { kind: 'eagle_answered', title: 'Друг ответил', body: 'Открой, чтобы сравнить ваши ответы', url: `/e/${r0.x.secret}`, dedupe: `e:${r0.x.id}:${req.visitor}`, isDemo: !!r0.x.is_demo }));
  const v = eagle.view(String(req.params.t), req.user, req.visitor);
  const c = pubCard(v.code); res.json({ ok: true, repeated: !!r0.repeated, ...v, card: c ? cards.publicCard(c) : null });
});
r.get('/og/eagle.jpg', wrap(async (req, res) => {
  const file = path.join(ogDir, 'eagle-back.jpg');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(ogDir, { recursive: true });
    const back = await sharp(path.join(__dirname, '..', 'public', 'img', 'card-back.webp')).resize({ height: 600, fit: 'inside' }).jpeg({ quality: 86 }).toBuffer();
    const meta = await sharp(back).metadata();
    await sharp({ create: { width: 1200, height: 630, channels: 3, background: '#060c1e' } }).composite([{ input: back, left: Math.round((1200 - meta.width) / 2), top: Math.round((630 - meta.height) / 2) }]).jpeg({ quality: 85 }).toFile(file);
  }
  res.set('Cache-Control', 'public, max-age=86400').type('jpeg').sendFile(file);
}));

r.post('/api/exchanges', (req, res) => {
  const b = req.body || {}; const c = pubCard(b.code);
  if (!c || (c.is_demo && !req.showDemo)) return bad(res, 'not_found', 404);
  if (b.multi) return out(res, xgroups.create(c, req.user, req.visitor, { text: b.text, name: b.name, question: b.question, clientKey: b.clientKey, inviteToken: b.inviteToken }), 201); // «Отправить нескольким людям»
  out(res, exchanges.create(c, req.user, req.visitor, { text: b.text, name: b.name, question: b.question, clientKey: b.clientKey, inviteToken: b.inviteToken, origin: ['fresh', 'forward', 'public'].includes(b.origin) ? b.origin : 'fresh' }), 201);
});
r.get('/api/exchanges', (req, res) => {
  const list = exchanges.mine(req.user, req.visitor, req.query.card ? String(req.query.card) : null);
  const groups = req.query.card ? [] : xgroups.mine(req.user, req.visitor);
  res.json({ exchanges: [...list, ...groups].sort((p, q) => String(q.createdAt).localeCompare(String(p.createdAt))) });
});
r.get('/api/x/:token', (req, res) => {
  const { x, role } = exchanges.resolve(String(req.params.token), req.user, req.visitor);
  if (!x) {
    const G = xgroups.resolve(String(req.params.token), req.user, req.visitor);
    if (!G.g) return bad(res, 'not_found', 404);
    return res.set('Cache-Control', 'no-store').json(xgroups.view(G.g, G.role, G.m));
  }
  exchanges.opened(x, role, req.get('user-agent')); // первое открытие человеком (не превью и не сам отправитель)
  res.set('Cache-Control', 'no-store').json(exchanges.view(x, role));
});
r.post('/api/x/:token/reply', (req, res) => {
  const b = req.body || {}; const c = pubCard(b.code);
  if (!c || (c.is_demo && !req.showDemo)) return bad(res, 'not_found', 404);
  out(res, exchanges.reply(String(req.params.token), req.user, req.visitor, c, { text: b.text, name: b.name, question: b.question, clientKey: b.clientKey, inviteToken: b.inviteToken }), 201);
});
r.post('/api/x/:token/sent', (req, res) => out(res, exchanges.sent(String(req.params.token), req.user, req.visitor, String((req.body || {}).via || ''))));
r.post('/api/x/:token/answer', (req, res) => {
  const b = req.body || {};
  const G = xgroups.answer(String(req.params.token), req.user, req.visitor, { text: b.text, name: b.name, answerKey: b.answerKey });
  if (G.error !== 'not_found') { if (G.error) return out(res, G); return res.status(201).json({ ok: true, repeated: !!G.repeated, exchange: xgroups.view(G.g, 'member', G.m) }); }
  const r0 = exchanges.answer(String(req.params.token), req.user, req.visitor, { text: b.text, name: b.name, answerKey: b.answerKey });
  if (r0.error) return out(res, r0);
  const { x, role } = exchanges.resolve(r0.secret, req.user, req.visitor);
  res.status(201).json({ ok: true, repeated: !!r0.repeated, exchange: exchanges.view(x, role) });
});
r.post('/api/x/:token/story', (req, res) => out(res, exchanges.story(String(req.params.token), req.user, req.visitor, req.body || {})));

// ---------- колокольчик (bell.js) ----------
r.get('/api/bell', (req, res) => res.set('Cache-Control', 'no-store').json(bell.list(req.user, req.visitor, req.showDemo)));
r.post('/api/bell/read', (req, res) => out(res, bell.markRead(req.user, req.visitor, (req.body || {}).all ? 'all' : (req.body || {}).ids)));
// версия приложения: клиент сравнивает с загруженной и предлагает «Обновить»
const BUILD = String(Date.now());
r.get('/api/version', (req, res) => res.set('Cache-Control', 'no-store').json({ build: BUILD }));

// ---------- личное: заметки, избранное, подборки (personal.js); у гостя — в браузере ----------
r.get('/api/me/personal', auth.requireUser, (req, res) => res.json(personal.state(req.user.id)));
r.put('/api/me/notes/:code', auth.requireUser, (req, res) => out(res, personal.setNote(req.user.id, req.params.code, (req.body || {}).text)));
r.post('/api/me/collections', auth.requireUser, (req, res) => out(res, personal.createCollection(req.user.id, (req.body || {}).title), 201));
r.patch('/api/me/collections/:id', auth.requireUser, (req, res) => out(res, personal.renameCollection(req.user.id, req.params.id, (req.body || {}).title)));
r.delete('/api/me/collections/:id', auth.requireUser, (req, res) => out(res, personal.deleteCollection(req.user.id, req.params.id)));
r.post('/api/me/collections/:id/cards', auth.requireUser, (req, res) => out(res, personal.toggle(req.user.id, req.params.id === 'favorites' ? 'favorites' : req.params.id, (req.body || {}).code, (req.body || {}).on !== false)));
// после входа: обмены и колокольчик этого браузера — в аккаунт; личные данные гостя — по согласию (merge)
r.post('/api/me/claim', auth.requireUser, (req, res) => res.json({ ok: true, exchanges: exchanges.claim(req.visitor, req.user.id) + xgroups.claim(req.visitor, req.user.id), notifications: bell.claim(req.visitor, req.user.id), meetingSubs: msubs.claim(req.visitor, req.user.id) }));
r.put('/api/me/images/:id', auth.requireUser, (req, res) => out(res, personal.saveImage(req.user.id, { ...(req.body || {}), id: req.params.id })));
r.delete('/api/me/images/:id', auth.requireUser, (req, res) => out(res, personal.deleteImage(req.user.id, req.params.id)));
r.put('/api/me/postcards/:id', auth.requireUser, (req, res) => out(res, personal.savePostcard(req.user.id, { ...(req.body || {}), id: req.params.id })));
r.delete('/api/me/postcards/:id', auth.requireUser, (req, res) => out(res, personal.deletePostcard(req.user.id, req.params.id)));
r.post('/api/me/merge', auth.requireUser, (req, res) => out(res, personal.merge(req.user.id, req.body || {})));
r.post('/api/cards-by-codes', (req, res) => res.json({ cards: personal.cardsOf((Array.isArray((req.body || {}).codes) ? req.body.codes : []).slice(0, 200).map(String)) }));

r.use('/api/admin', admin);
r.use('/api', (req, res) => bad(res, 'not_found', 404));

// ---------- фронтенд ----------
const publicDir = path.join(config.root, 'public');
// Стили и скрипты — всегда сверяются с сервером (ETag), чтобы после обновления не показывалась старая версия;
// шрифты и картинки интерфейса кэшируются на сутки.
r.use(express.static(publicDir, {
  index: false,
  setHeaders: (res, file) => res.set('Cache-Control', /\.(js|css|html|json)$/.test(file) ? 'no-cache' : 'public, max-age=86400'),
}));
const indexHtml = (base) => fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8').replaceAll('{{BASE}}', base).replaceAll('{{SHARE}}', site.shareMeta());
const cachedIndex = new Map(); // путь входа → index.html
// Превью ссылок для мессенджеров (19.11.2026): у приглашения и публичной ссылки карты — сама иллюстрация и вопрос.
// Никаких ответов и имён; запрос превью ничего не меняет в обмене и не считается открытием.
const OG_DESC = 'Повод для интересного разговора';
function ogFor(req) {
  // главная: заголовок — «Dialogue Cards», описание — слоган, без повторов названия и без встреч (23.11.2026)
  if (req.path === '/' || req.path === '') return { title: 'Dialogue Cards', home: true, image: `${baseUrl(req)}${req.site.base}/og/eagle.jpg`, url: `${site.shareUrl()}/` };
  // «Глаз-алмаз»: в превью вопрос скрыт, картинка — рубашка карты
  if (/^\/e\/[A-Za-z0-9_-]{22,40}\/?$/.test(req.path)) return { title: 'Проверим нашу наблюдательность?', desc: 'Рассмотри карту, запомни детали и ответь на вопрос. Потом сравним наши ответы.', image: `${baseUrl(req)}${req.site.base}/og/eagle.jpg`, url: `${baseUrl(req)}${req.site.base}${req.path}` };
  const m = req.path.match(/^\/(x\/([A-Za-z0-9_-]{16,40})|play\/(DC-\d{4,6}))\/?$/);
  let code = m && m[3];
  let title = 'Что ты здесь видишь?';
  if (m && m[2]) { const x = db.prepare('SELECT card_id, question FROM exchanges WHERE invite_token = ? OR a_secret = ? OR b_secret = ? OR a_door = ?').get(m[2], m[2], m[2], m[2]) || xgroups.cardCodeOf(m[2]); code = x && (db.prepare('SELECT code FROM cards WHERE id = ?').get(x.card_id) || {}).code; if (x) title = exchanges.questionOf(x); }
  if (!code && req.path.startsWith('/library') && /^DC-\d{4,6}$/.test(String(req.query.card || ''))) code = String(req.query.card);
  const c = code && pubCard(code); if (!c || c.is_demo) return null;
  return { code: c.code, title, image: `${baseUrl(req)}${req.site.base}/og/${c.code}.jpg`, url: `${baseUrl(req)}${req.site.base}${req.path}` };
}
const ESC_ATTR = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escAttr = (t) => String(t).replace(/[&<>"']/g, (ch) => ESC_ATTR[ch]);
const ogDir = path.join(config.dataDir, 'og');
r.get('/og/:code.jpg', wrap(async (req, res) => {
  const c = pubCard(req.params.code); if (!c || c.is_demo) return bad(res, 'not_found', 404);
  const file = path.join(ogDir, `${c.code}-${String(c.image_full).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24)}.jpg`);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(ogDir, { recursive: true });
    const src = path.join(config.mediaDir, 'full', c.image_full);
    const card = await sharp(src).resize({ height: 600, fit: 'inside' }).jpeg({ quality: 86 }).toBuffer();
    const meta = await sharp(card).metadata();
    // 1200×630: карта целиком по центру на тёмном фоне проекта
    await sharp({ create: { width: 1200, height: 630, channels: 3, background: '#060c1e' } })
      .composite([{ input: card, left: Math.round((1200 - meta.width) / 2), top: Math.round((630 - meta.height) / 2) }]).jpeg({ quality: 85 }).toFile(file);
  }
  res.set('Cache-Control', 'public, max-age=86400').type('jpeg').sendFile(file);
}));
r.get('*', (req, res) => {
  const base = req.site.base;
  if (!cachedIndex.has(base) || !config.isProduction) cachedIndex.set(base, indexHtml(base));
  const html = cachedIndex.get(base);
  const og = ogFor(req);
  if (og) {
    const tags = `<meta property="og:type" content="website">${og.home ? '' : '<meta property="og:site_name" content="Dialogue Cards">'}<meta property="og:title" content="${escAttr(og.title)}"><meta property="og:description" content="${escAttr(og.desc || OG_DESC)}"><meta property="og:image" content="${escAttr(og.image)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:url" content="${escAttr(og.url)}"><meta name="twitter:card" content="summary_large_image">`;
    // приглашение и личные ссылки — не для поисковиков
    if (!og.home) res.set('X-Robots-Tag', 'noindex'); // главную индексировать можно
    return res.set('Cache-Control', 'no-cache').type('html').send(html.replace('</head>', () => `${tags}\n</head>`).replace(/<title>[^<]*<\/title>/, () => (og.home ? '<title>Dialogue Cards</title>' : `<title>${escAttr(og.title)} · Dialogue Cards</title>`))); // функции: «$» в тексте вопроса — обычный символ
  }
  res.set('Cache-Control', 'no-cache').type('html').send(html);
});

r.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err && err.code === 'bad_image_type') return bad(res, 'bad_image_type');
  if (err && err.code === 'bad_file_type') return bad(res, 'bad_file_type');
  if (err && err.code === 'bad_media_type') return bad(res, 'bad_media_type');
  console.error(err);
  if (err instanceof multer.MulterError) return bad(res, err.code === 'LIMIT_FILE_SIZE' ? 'file_too_large' : 'upload_error');
  bad(res, 'server_error', 500);
});
// Один и тот же набор адресов — на каждом входе: '/dialogue-cards' (портал) и '' (dialogue.cards); без SITE_URL — только BASE_PATH.
// На своём домене старые адреса с /dialogue-cards/ ведут в корень (ссылки, скопированные с портала).
if (config.siteUrl && site.appHost) {
  app.use(config.siteBasePath, (req, res, next) => (String(req.get('host') || '').toLowerCase() === site.appHost ? res.redirect(301, '/' + req.originalUrl.slice(config.siteBasePath.length).replace(/^\/+/, '')) : next()));
}
for (const m of site.mounts()) app.use(m || '/', r);
const B = site.mounts()[0];
if (B && !config.siteUrl) app.get('/', (req, res) => res.redirect(B + '/'));

if (require.main === module) {
  if (auth.ownerPasswordTooShort()) {
    console.error(`ERROR: ADMIN_PASSWORD is shorter than ${config.minAdminPassword} characters: owner password login is disabled. Set a longer ADMIN_PASSWORD (for example: openssl rand -base64 24) and restart.`);
  } else if (!config.adminPassword) {
    console.warn(config.isProduction ? 'ADMIN_PASSWORD is not set: owner login is disabled.' : 'ADMIN_PASSWORD is not set: using development password "dcards-dev".');
  }
  console.log(`Demo mode: ${config.demoMode ? 'on' : 'off'}; mail: ${mail.connected() ? 'SMTP' : 'not connected (letters shown on screen)'}`);
  app.listen(config.port, () => console.log(`Dialogue Cards: http://localhost:${config.port}${B}/`));
}

module.exports = app;
