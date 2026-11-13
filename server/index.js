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
const demo = require('./demo');
const choices = require('./choices');
const places = require('./places');
const { cityKey } = require('./places-key');

cards.syncSeed();
if (config.demoMode) for (const u of auth.DEMO_USERS) auth.demoUser(u.key);

const B = config.basePath;
const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'",
  });
  next();
});
const r = express.Router();
r.use(express.json({ limit: '200kb' }));
r.use(cookieParser());
r.use(auth.loadUser);

const VISITOR_RE = /^[A-Za-z0-9-]{16,64}$/;
const CODE_RE = /^DC-\d{4,6}$/;
const baseUrl = (req) => config.publicUrl || `${req.protocol}://${req.get('host')}`;
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
const isDemoRow = (table, where, val) => { const r = db.prepare(`SELECT is_demo FROM ${table} WHERE ${where} = ?`).get(val); return !r || !!r.is_demo; };

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp|tiff)$/.test(file.mimetype)),
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
  res.sendFile(path.join(config.mediaDir, req.params.kind, file));
});
// Работы на рассмотрении: автору, кураторам и администраторам.
r.get('/media/works/:kind(full|thumb)/:file', (req, res) => {
  const file = path.basename(req.params.file);
  if (!works.workMediaAllowed(file, req.user, req.roles)) return res.sendStatus(404);
  res.set('Cache-Control', 'private, no-store');
  res.sendFile(path.join(config.mediaDir, 'works', req.params.kind, file));
});

// ---------- общее ----------
// Вход по email без подключённой почты возможен только при локальной разработке (код показывается на экране).
// На сервере (NODE_ENV=production) без SMTP он выключен: иначе войти можно было бы под чужим адресом.
const emailLoginEnabled = () => mail.connected() || !config.isProduction;
r.get('/api/config', (req, res) => res.json({
  demoMode: config.demoMode, mailConnected: mail.connected(), emailLogin: emailLoginEnabled(), siteLogin: !!config.siteAuthUrl, translationConnected: false,
  termsVersion: config.termsVersion, basePath: B, maxCollectionSize: config.maxCollectionSize, languages: meetings.LANGS,
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
r.post('/api/auth/request', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!auth.EMAIL_RE.test(email)) return bad(res, 'bad_email');
  if (!emailLoginEnabled()) return bad(res, 'mail_not_configured', 503);
  const result = await auth.requestCode(email, req.body.lang === 'en' ? 'en' : 'ru');
  res.json({ sent: result.sent, demo: result.demo, failed: !!result.failed, demoCode: result.code, isNew: !db.prepare('SELECT 1 FROM users WHERE email = ?').get(email) });
}));
r.post('/api/auth/verify', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const isNew = !db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
  if (isNew && !String(req.body.name || '').trim()) return bad(res, 'name_required');
  const v = auth.verifyCode(email, req.body.code);
  if (v.error) return bad(res, v.error, 401);
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
  res.cookie(auth.DEMO_COOKIE, '1', { sameSite: 'lax', path: auth.CPATH, maxAge: 30 * 24 * 3600 * 1000 });
  res.json({ user: auth.publicUser(u) });
}));
r.post('/api/demo/view', (req, res) => {
  if (!config.demoMode) return bad(res, 'demo_disabled', 403);
  if (req.body.on) res.cookie(auth.DEMO_COOKIE, '1', { sameSite: 'lax', path: auth.CPATH, maxAge: 30 * 24 * 3600 * 1000 });
  else res.clearCookie(auth.DEMO_COOKIE, { path: auth.CPATH });
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
  const url = `${baseUrl(req)}${B}/s/${f.col.slug}`;
  const opts = { errorCorrectionLevel: 'M', margin: 2, color: { dark: '#0f1430', light: '#ffffff' } };
  if (req.params.fmt === 'svg') return res.type('image/svg+xml').send(await QRCode.toString(url, { ...opts, type: 'svg' }));
  const size = Math.min(Math.max(Number(req.query.size) || 1024, 256), 2048);
  if (req.query.download) res.attachment(`dialogue-cards-${f.col.slug}.png`);
  res.type('png').send(await QRCode.toBuffer(url, { ...opts, width: size }));
}));

// ---------- встречи (публично) ----------
r.get('/api/meetings/places', (req, res) => res.json({ places: meetings.places(req.showDemo) }));
r.get('/api/meetings', (req, res) => res.json({ dates: meetings.upcoming({ country: req.query.country, city: req.query.city }, req.showDemo) }));
r.get('/api/meetings/dates/:id', (req, res) => {
  const d = meetings.datePublic(Number(req.params.id), req.showDemo);
  if (!d) return bad(res, 'not_found', 404);
  res.json(d);
});
r.post('/api/meetings/dates/:id/register', wrap(async (req, res) => {
  out(res, await meetings.register(Number(req.params.id), req.body || {}, baseUrl(req), req.body.lang === 'en' ? 'en' : 'ru'), 201);
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
r.post('/api/registrations/:token/cancel', (req, res) => out(res, meetings.cancelByToken(String(req.params.token))));

// ---------- художник ----------
// Роль художника выдаётся автоматически при первой подаче работ (правила выдачи ролей ещё уточняются).
r.get('/api/artist/works', auth.requireUser, (req, res) => res.json({ works: works.myWorks(req.user.id), cards: works.myCards(req.user.id), criteria: works.criteriaList() }));
r.post('/api/artist/works', auth.requireUser, upload.array('images', 20), wrap(async (req, res) => {
  const notes = [].concat(req.body.notes || []);
  const result = await works.submit(req.user, req.files || [], { termsAccepted: req.body.termsAccepted === 'true', termsVersion: req.body.termsVersion, notes });
  if (!result.error) auth.grant(req.user.id, 'artist');
  out(res, result, 201);
}));
r.post('/api/artist/works/:id/versions', auth.requireUser, upload.single('image'), wrap(async (req, res) => {
  if (!req.file) return bad(res, 'no_image');
  out(res, await works.addVersion(req.user, Number(req.params.id), req.file, req.body.note));
}));
r.post('/api/artist/cards/:code/replace', auth.requireUser, upload.single('image'), wrap(async (req, res) => {
  if (!req.file) return bad(res, 'no_image');
  out(res, await works.proposeReplacement(req.user, req.params.code, req.file, { termsAccepted: req.body.termsAccepted === 'true', termsVersion: req.body.termsVersion, note: req.body.note }), 201);
}));
r.post('/api/artist/cards/:code/withdraw', auth.requireUser, (req, res) => out(res, works.withdrawCard(req.user, req.params.code)));
r.get('/api/works/:id', auth.requireUser, (req, res) => {
  const id = Number(req.params.id);
  if (!works.canSee(req.user, req.roles, id)) return bad(res, 'not_found', 404);
  res.json(works.detail(id));
});

// ---------- кураторы ----------
const curator = auth.requireRole('curator');
r.get('/api/curation/queue', curator, (req, res) => res.json({ queue: works.queue(req.showDemo), recent: works.recentDecided(req.showDemo), criteria: works.criteriaList(), me: req.user.id }));
r.use('/api/curation/works/:id', (req, res, next) => (demoOnly(req, res, isDemoRow('works', 'id', Number(req.params.id))) ? next() : undefined));
r.post('/api/curation/works/:id/decide', curator, (req, res) => out(res, works.decide(req.user, Number(req.params.id), req.body || {})));
r.post('/api/curation/works/:id/discuss', curator, (req, res) => out(res, works.discuss(req.user, Number(req.params.id), req.body.question ?? req.body.comment)));
r.post('/api/curation/works/:id/vote', curator, (req, res) => out(res, works.vote(req.user, Number(req.params.id), req.body.vote, req.body.comment)));

// ---------- командные чаты ----------
r.get('/api/chats/:room', auth.requireUser, (req, res) => {
  const room = req.params.room;
  if (!community.ROOMS[room]) return bad(res, 'not_found', 404);
  if (!req.has(...community.ROOMS[room])) return bad(res, 'forbidden', 403);
  res.json({ messages: community.chat(room, req.showDemo), members: community.members(room) });
});
r.post('/api/chats/:room', auth.requireUser, (req, res) => {
  const room = req.params.room;
  if (!community.ROOMS[room]) return bad(res, 'not_found', 404);
  if (!req.has(...community.ROOMS[room])) return bad(res, 'forbidden', 403);
  out(res, community.post(room, req.user, req.body.text), 201);
});

// ---------- фасилитатор: подборки ----------
const fac = auth.requireRole('facilitator');
const ownsCollection = (req, id) => collections.ownerOf(id) === req.user.id || (req.has('admin') && (!req.user.is_demo || isDemoRow('collections', 'id', id)));
r.get('/api/collections', fac, (req, res) => res.json({
  collections: collections.listAll(req.has('admin') ? null : req.user.id).filter((c) => !c.isDemo || req.showDemo), baseUrl: baseUrl(req) + B,
}));
r.post('/api/collections', fac, (req, res) => res.json({ id: collections.create(req.body && req.body.title, !!(req.body && req.body.isTest), req.user.id, !!req.user.is_demo) }));
r.get('/api/collections/:id', fac, (req, res) => {
  const id = Number(req.params.id);
  if (!collections.exists(id) || !ownsCollection(req, id)) return bad(res, 'not_found', 404);
  const d = collections.adminDetail(id);
  res.json({ ...d, url: `${baseUrl(req)}${B}/s/${d.slug}` });
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
// Город встречи → часовой пояс (пояс вручную не выбирается). ?city=&country=&placeId=
r.get('/api/places/resolve', fac, (req, res) => res.json(places.resolve({ city: req.query.city, country: req.query.country, placeId: req.query.placeId })));
/**
 * Пояс встречи определяется по городу на сервере; присланный клиентом timezone не используется.
 * При повторе встречи (sameAs) и при сохранении без смены города пояс берётся у исходной встречи.
 */
function meetingPlace(req, existing) {
  const b = req.body || {};
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
  out(res, meetings.create(req.user, { ...req.body, ...pl }), 201);
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
  out(res, meetings.update(id, { ...req.body, ...pl }));
});
r.post('/api/fac/meetings/:id/dates', fac, (req, res) => {
  const id = Number(req.params.id);
  if (!meetings.facilitatorOf(id) || !ownsMeeting(req, id)) return bad(res, 'not_found', 404);
  out(res, meetings.addDates(id, req.body || {}));
});
r.post('/api/fac/meetings/:id/publish', fac, (req, res) => {
  const id = Number(req.params.id);
  if (!meetings.facilitatorOf(id) || !ownsMeeting(req, id)) return bad(res, 'not_found', 404);
  out(res, meetings.setPublished(id, !!req.body.published));
});
r.patch('/api/fac/dates/:id', fac, (req, res) => {
  const mid = meetings.meetingOfDate(Number(req.params.id));
  if (!mid || !ownsMeeting(req, mid)) return bad(res, 'not_found', 404);
  out(res, meetings.setDate(Number(req.params.id), req.body || {}));
});

// ---------- путь к роли фасилитатора ----------
r.get('/api/fac/application', auth.requireUser, (req, res) => res.json({
  application: community.application(req.user.id), isFacilitator: req.has('facilitator'),
  course: community.COURSE, questions: community.QUESTIONS.map(({ id, text, options }) => ({ id, text, options })),
}));
r.post('/api/fac/application', auth.requireUser, (req, res) => res.json({ application: community.startApplication(req.user) }));
r.put('/api/fac/application', auth.requireUser, (req, res) => out(res, community.saveApplication(req.user, req.body || {})));
// Заявка на роль куратора (вошедший пользователь); решение — администратор.
r.get('/api/curator/application', auth.requireUser, (req, res) => res.json({ isCurator: req.roles.includes('curator'), application: community.curatorApplication(req.user.id) }));
r.post('/api/curator/application', auth.requireUser, (req, res) => out(res, community.submitCuratorApplication(req.user, req.body || {}), 201));
// Запрос фасилитатора на готовую печатную колоду: уходит команде проекта (виден администратору).
r.post('/api/fac/print-request', fac, (req, res) => {
  const note = String((req.body && req.body.note) || '').trim().slice(0, 1000);
  const dup = db.prepare(`SELECT 1 FROM print_requests WHERE user_id = ? AND status = 'new'`).get(req.user.id);
  if (!dup) db.prepare('INSERT INTO print_requests (user_id, note, is_demo) VALUES (?, ?, ?)').run(req.user.id, note, req.user.is_demo ? 1 : 0);
  res.status(201).json({ ok: true, already: !!dup });
});
r.post('/api/fac/application/submit', auth.requireUser, (req, res) => out(res, community.submitApplication(req.user)));

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
  else if ((mm = p.match(/^\/users\/(\d+)/))) ok = isDemoRow('users', 'id', Number(mm[1]));
  else if ((mm = p.match(/^\/applications\/(\d+)/))) ok = isDemoRow('fac_applications', 'user_id', Number(mm[1]));
  else if ((mm = p.match(/^\/print-requests\/(\d+)/))) ok = isDemoRow('print_requests', 'id', Number(mm[1]));
  else if ((mm = p.match(/^\/curator-applications\/(\d+)/))) ok = isDemoRow('curator_applications', 'user_id', Number(mm[1]));
  else if ((mm = p.match(/^\/meetings\/(\d+)/))) ok = isDemoRow('meetings', 'id', Number(mm[1]));
  else if ((mm = p.match(/^\/cards\/(DC-\d+)/)) && p !== '/cards/bulk-author') ok = isDemoRow('cards', 'code', mm[1]);
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
admin.get('/print-requests', (req, res) => res.json({ requests: db.prepare(`SELECT p.*, COALESCE(NULLIF(u.public_name,''), u.name) AS name, u.email FROM print_requests p JOIN users u ON u.id = p.user_id WHERE ${req.showDemo ? '1=1' : 'p.is_demo = 0'} ORDER BY (p.status = 'new') DESC, p.id DESC LIMIT 100`).all()
  .map((p) => ({ id: p.id, name: p.name, email: p.email, note: p.note, status: p.status, createdAt: p.created_at, isDemo: !!p.is_demo })) }));
admin.post('/print-requests/:id/done', (req, res) => { db.prepare(`UPDATE print_requests SET status = 'done' WHERE id = ?`).run(Number(req.params.id)); res.json({ ok: true }); });
admin.get('/curator-applications', (req, res) => res.json({ applications: community.curatorApplications(req.showDemo) }));
admin.post('/curator-applications/:userId/decide', (req, res) => out(res, community.decideCuratorApplication(req.user.id, Number(req.params.userId), !!req.body.approve, req.body.note)));
admin.get('/applications', (req, res) => res.json({ applications: community.applications(req.showDemo) }));
admin.post('/applications/:userId/decide', (req, res) => out(res, community.decideApplication(req.user.id, Number(req.params.userId), !!req.body.approve, req.body.note)));
admin.get('/meetings', (req, res) => res.json({ meetings: meetings.allForAdmin(req.showDemo) }));
admin.post('/meetings/:id/remove', (req, res) => out(res, meetings.removeByAdmin(req.user.id, Number(req.params.id), req.body.reason)));
admin.post('/meetings/:id/restore', (req, res) => out(res, meetings.restoreByAdmin(Number(req.params.id))));
admin.get('/comments', (req, res) => res.json({ comments: community.recentComments(req.showDemo) }));
admin.put('/criteria', (req, res) => out(res, works.setCriteria(req.body && req.body.criteria)));
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
    FROM cards k WHERE ${req.showDemo ? '1=1' : 'k.is_demo = 0'} ORDER BY k.number ASC`).all();
  res.json({ cards: rows.map((x) => ({
    ...cards.publicCard(x, { withDetails: true }), status: x.status, source: x.source, removedAt: x.removed_at, removedBy: x.removed_by,
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
admin.post('/cards/:code/restore', (req, res) => {
  const x = db.prepare(`UPDATE cards SET status = 'published', removed_at = NULL, removed_by = '' WHERE code = ? AND status = 'removed'`).run(req.params.code);
  if (!x.changes) return bad(res, 'not_found', 404);
  res.json({ ok: true });
});
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
const indexHtml = () => fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8').replaceAll('{{BASE}}', B);
let cachedIndex = null;
r.get('*', (req, res) => {
  if (!cachedIndex || !config.isProduction) cachedIndex = indexHtml();
  res.set('Cache-Control', 'no-cache').type('html').send(cachedIndex);
});

r.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  if (err instanceof multer.MulterError) return bad(res, err.code === 'LIMIT_FILE_SIZE' ? 'file_too_large' : 'upload_error');
  bad(res, 'server_error', 500);
});
app.use(B || '/', r);
if (B) app.get('/', (req, res) => res.redirect(B + '/'));

if (require.main === module) {
  if (!config.adminPassword) {
    console.warn(config.isProduction ? 'ADMIN_PASSWORD is not set: owner login is disabled.' : 'ADMIN_PASSWORD is not set: using development password "dcards-dev".');
  }
  console.log(`Demo mode: ${config.demoMode ? 'on' : 'off'}; mail: ${mail.connected() ? 'SMTP' : 'not connected (letters shown on screen)'}`);
  app.listen(config.port, () => console.log(`Dialogue Cards: http://localhost:${config.port}${B}/`));
}

module.exports = app;
