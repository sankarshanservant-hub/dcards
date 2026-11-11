const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const QRCode = require('qrcode');

const config = require('./config');
const db = require('./db');
const auth = require('./auth');
const cards = require('./cards');
const collections = require('./collections');

cards.seedIfEmpty();

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'",
  });
  next();
});

const VISITOR_RE = /^[A-Za-z0-9-]{16,64}$/;
const CODE_RE = /^DC-\d{4,6}$/;
const baseUrl = (req) => config.publicUrl || `${req.protocol}://${req.get('host')}`;
const bad = (res, error, status = 400, extra = {}) => res.status(status).json({ error, ...extra });

// ---------- изображения карт ----------
// Отдаются через проверку: изображения снятой с публикации карты недоступны посетителям.
app.get('/media/:kind(full|thumb)/:file', (req, res) => {
  const file = path.basename(req.params.file);
  const status = cards.mediaStatus(file);
  if (!status || (status !== 'published' && !auth.isAdmin(req))) return res.sendStatus(404);
  res.set('Cache-Control', status === 'published' ? 'public, max-age=86400' : 'private, no-store');
  res.sendFile(path.join(config.mediaDir, req.params.kind, file));
});

// ---------- публичное API ----------
app.get('/api/cards', (req, res) => {
  res.json({ cards: cards.listPublished() });
});

app.get('/api/cards/:code', (req, res) => {
  const c = CODE_RE.test(req.params.code) && cards.getPublished(req.params.code);
  if (!c) return bad(res, 'not_found', 404);
  res.json(c);
});

function loadCollection(req, res) {
  const found = collections.getPublic(String(req.params.slug));
  if (!found) { bad(res, 'not_found', 404); return null; }
  return found;
}
function visitorFrom(req, res) {
  const v = req.body && req.body.visitorId;
  if (typeof v !== 'string' || !VISITOR_RE.test(v)) { bad(res, 'bad_visitor'); return null; }
  return v;
}
function roundFrom(req, res) {
  const r = Number(req.body && req.body.round);
  if (!Number.isInteger(r) || r < 1 || r > config.maxRounds) { bad(res, 'bad_round'); return null; }
  return r;
}

app.get('/api/c/:slug', (req, res) => {
  const found = loadCollection(req, res);
  if (found) res.json(found.data);
});

app.post('/api/c/:slug/visit', (req, res) => {
  const found = loadCollection(req, res); if (!found) return;
  const v = visitorFrom(req, res); if (!v) return;
  collections.recordVisit(found.col, v);
  res.json(collections.visitorState(found.col, v));
});

app.post('/api/c/:slug/select', (req, res) => {
  const found = loadCollection(req, res); if (!found) return;
  const v = visitorFrom(req, res); if (!v) return;
  const round = roundFrom(req, res); if (!round) return;
  const code = String(req.body.code || '');
  const r = collections.select(found.col, v, code, round);
  if (r.error) return bad(res, r.error);
  res.json(collections.visitorState(found.col, v));
});

app.post('/api/c/:slug/unselect', (req, res) => {
  const found = loadCollection(req, res); if (!found) return;
  const v = visitorFrom(req, res); if (!v) return;
  const round = roundFrom(req, res); if (!round) return;
  collections.unselect(found.col, v, round);
  res.json(collections.visitorState(found.col, v));
});

app.get('/api/c/:slug/qr.:fmt(svg|png)', async (req, res, next) => {
  try {
    const found = loadCollection(req, res); if (!found) return;
    const url = `${baseUrl(req)}/s/${found.col.slug}`;
    const opts = { errorCorrectionLevel: 'M', margin: 2, color: { dark: '#1e1b16', light: '#ffffff' } };
    if (req.params.fmt === 'svg') {
      res.type('image/svg+xml').send(await QRCode.toString(url, { ...opts, type: 'svg' }));
    } else {
      const size = Math.min(Math.max(Number(req.query.size) || 1024, 256), 2048);
      if (req.query.download) res.attachment(`dialogue-cards-${found.col.slug}.png`);
      res.type('png').send(await QRCode.toBuffer(url, { ...opts, width: size }));
    }
  } catch (e) { next(e); }
});

// ---------- вход владельца ----------
app.get('/api/admin/me', (req, res) => {
  res.json({ admin: auth.isAdmin(req), devPassword: !config.adminPassword && !config.isProduction });
});
app.post('/api/admin/login', (req, res) => {
  const r = auth.checkPassword(req, req.body && req.body.password);
  if (!r.ok) return bad(res, r.error, r.error === 'too_many_attempts' ? 429 : 401);
  auth.issue(res, req);
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => { auth.clear(res); res.json({ ok: true }); });

const admin = express.Router();
admin.use(auth.requireAdmin);

admin.get('/collections', (req, res) => res.json({ collections: collections.listAll(), baseUrl: baseUrl(req) }));
admin.post('/collections', (req, res) => {
  const id = collections.create(req.body && req.body.title, !!(req.body && req.body.isTest));
  res.json({ id });
});
admin.get('/collections/:id', (req, res) => {
  const d = collections.adminDetail(Number(req.params.id));
  if (!d) return bad(res, 'not_found', 404);
  res.json({ ...d, url: `${baseUrl(req)}/s/${d.slug}` });
});
admin.patch('/collections/:id', (req, res) => {
  const ok = collections.update(Number(req.params.id), req.body || {});
  if (!ok) return bad(res, 'not_found', 404);
  res.json({ ok: true });
});
admin.put('/collections/:id/cards', (req, res) => {
  const r = collections.setCards(Number(req.params.id), req.body && req.body.codes);
  if (r.error) return bad(res, r.error, r.error === 'not_found' ? 404 : 400, r);
  res.json({ ok: true });
});
admin.delete('/collections/:id', (req, res) => {
  if (!collections.remove(Number(req.params.id))) return bad(res, 'not_found', 404);
  res.json({ ok: true });
});

admin.get('/cards', (req, res) => {
  const rows = db.prepare(`
    SELECT k.*,
      (SELECT COUNT(*) FROM selections s WHERE s.card_id = k.id AND s.cancelled_at IS NULL AND s.is_test = 0) AS selections,
      (SELECT COUNT(*) FROM selections s WHERE s.card_id = k.id AND s.cancelled_at IS NULL AND s.is_test = 1) AS test_selections,
      (SELECT COUNT(*) FROM card_offers o WHERE o.card_id = k.id AND o.is_test = 0) AS offers,
      (SELECT COUNT(*) FROM collection_cards cc WHERE cc.card_id = k.id) AS in_collections
    FROM cards k ORDER BY k.number ASC`).all();
  res.json({
    cards: rows.map((r) => ({
      ...cards.publicCard(r, { withDetails: true }),
      status: r.status, source: r.source, removedAt: r.removed_at,
      selections: r.selections, testSelections: r.test_selections, offers: r.offers, inCollections: r.in_collections,
    })),
  });
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp|tiff)$/.test(file.mimetype)),
});
admin.post('/cards', upload.array('images', 20), async (req, res) => {
  const files = req.files || [];
  if (!files.length) return bad(res, 'no_images');
  const created = [];
  const failed = [];
  for (const f of files) {
    try {
      created.push(await cards.createFromImage(f.buffer, { author: req.body.author || '', originalName: f.originalname }));
    } catch (e) {
      failed.push(f.originalname);
    }
  }
  res.status(created.length ? 200 : 400).json({ created, failed });
});
admin.patch('/cards/:code', (req, res) => {
  const author = req.body && req.body.author;
  if (typeof author !== 'string') return bad(res, 'bad_request');
  const r = db.prepare('UPDATE cards SET author = ? WHERE code = ?').run(author.trim().slice(0, 200), req.params.code);
  if (!r.changes) return bad(res, 'not_found', 404);
  res.json({ ok: true });
});
admin.post('/cards/bulk-author', (req, res) => {
  const author = String((req.body && req.body.author) || '').trim().slice(0, 200);
  if (!author) return bad(res, 'bad_request');
  const r = db.prepare(`UPDATE cards SET author = ? WHERE author = ''`).run(author);
  res.json({ updated: r.changes });
});
admin.post('/cards/:code/remove', (req, res) => {
  const r = db.prepare(`UPDATE cards SET status = 'removed', removed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE code = ? AND status = 'published'`).run(req.params.code);
  if (!r.changes) return bad(res, 'not_found', 404);
  res.json({ ok: true });
});
admin.post('/cards/:code/restore', (req, res) => {
  const r = db.prepare(`UPDATE cards SET status = 'published', removed_at = NULL WHERE code = ? AND status = 'removed'`).run(req.params.code);
  if (!r.changes) return bad(res, 'not_found', 404);
  res.json({ ok: true });
});

app.use('/api/admin', admin);
app.use('/api', (req, res) => bad(res, 'not_found', 404));

// ---------- фронтенд ----------
const publicDir = path.join(config.root, 'public');
app.use(express.static(publicDir, { index: false, maxAge: config.isProduction ? '1h' : 0 }));
const indexHtml = path.join(publicDir, 'index.html');
app.get('*', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(indexHtml);
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  if (err instanceof multer.MulterError) return bad(res, err.code === 'LIMIT_FILE_SIZE' ? 'file_too_large' : 'upload_error');
  bad(res, 'server_error', 500);
});

if (require.main === module) {
  if (!fs.existsSync(indexHtml)) console.warn('public/index.html is missing');
  if (!config.adminPassword) {
    console.warn(config.isProduction
      ? 'ADMIN_PASSWORD is not set: owner login is disabled.'
      : 'ADMIN_PASSWORD is not set: using development password "dcards-dev".');
  }
  app.listen(config.port, () => console.log(`Dialogue Cards: http://localhost:${config.port}`));
}

module.exports = app;
