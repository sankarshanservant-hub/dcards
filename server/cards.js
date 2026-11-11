const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const db = require('./db');
const config = require('./config');

const FULL_HEIGHT = 1600;
const THUMB_WIDTH = 360;
const B = config.basePath;

for (const d of ['full', 'thumb', 'originals', 'works']) fs.mkdirSync(path.join(config.mediaDir, d), { recursive: true });

const codeFor = (n) => `DC-${String(n).padStart(4, '0')}`;
const mediaUrl = (kind, file) => `${B}/media/${kind}/${file}`;

function publicCard(row, { withDetails = false } = {}) {
  const c = {
    code: row.code,
    thumb: mediaUrl('thumb', row.image_thumb),
    full: mediaUrl('full', row.image_full),
    width: row.width,
    height: row.height,
    publishedAt: row.published_at,
    isDemo: !!row.is_demo,
  };
  if (withDetails) { c.number = row.number; c.author = row.author; }
  return c;
}

const demoFilter = (showDemo, alias = '') => (showDemo ? '1=1' : `${alias}is_demo = 0`);

const stmt = {
  byCode: db.prepare(`SELECT * FROM cards WHERE code = ?`),
  byMedia: db.prepare(`SELECT status, is_demo, artist_id FROM cards WHERE image_full = ? OR image_thumb = ?`),
  byOldMedia: db.prepare(`SELECT c.status, c.is_demo FROM card_versions v JOIN cards c ON c.id = v.card_id WHERE v.image_full = ? OR v.image_thumb = ?`),
  maxNumber: db.prepare(`SELECT COALESCE(MAX(number), 0) AS n FROM cards`),
  insert: db.prepare(`INSERT INTO cards (code, number, author, image_full, image_thumb, image_original, width, height, source, published_at, artist_id, is_demo)
                      VALUES (@code, @number, @author, @image_full, @image_thumb, @image_original, @width, @height, @source, @published_at, @artist_id, @is_demo)`),
  publicCount: db.prepare(`SELECT COUNT(*) AS n FROM selections WHERE card_id = ? AND cancelled_at IS NULL AND is_test = 0`),
  commentCount: db.prepare(`SELECT COUNT(*) AS n FROM comments WHERE card_id = ? AND deleted_at IS NULL`),
};

function listPublished(showDemo) {
  return db.prepare(`SELECT * FROM cards WHERE status = 'published' AND ${demoFilter(showDemo)} ORDER BY published_at DESC, number ASC`)
    .all().map((r) => publicCard(r));
}

function getPublished(code, showDemo) {
  const row = stmt.byCode.get(code);
  if (!row || row.status !== 'published' || (row.is_demo && !showDemo)) return null;
  return { ...publicCard(row, { withDetails: true }), selectedCount: stmt.publicCount.get(row.id).n, comments: stmt.commentCount.get(row.id).n };
}

/** Статус карты по имени файла изображения (для проверки доступа к /media). */
function mediaInfo(file) {
  return stmt.byMedia.get(file, file) || stmt.byOldMedia.get(file, file) || null;
}

/**
 * Готовит экранные версии изображения: full (по высоте 1600) и thumb (по ширине 360), исходник хранится отдельно.
 * dir — подпапка в media ('' для карт, 'works' для работ на рассмотрении).
 */
async function processImage(buffer, originalName = '', dir = '') {
  const meta = await sharp(buffer).metadata();
  if (!meta.width || !meta.height) throw new Error('not_an_image');
  const id = crypto.randomBytes(9).toString('base64url');
  const ext = (path.extname(originalName) || `.${meta.format || 'bin'}`).toLowerCase().replace(/[^.a-z0-9]/g, '');
  const base = dir ? path.join(config.mediaDir, dir) : config.mediaDir;
  for (const d of ['full', 'thumb', 'originals']) fs.mkdirSync(path.join(base, d), { recursive: true });
  const original = `${id}${ext}`; const name = `${id}.webp`;
  fs.writeFileSync(path.join(base, 'originals', original), buffer);
  const full = await sharp(buffer).rotate().toColorspace('srgb').resize({ height: FULL_HEIGHT, withoutEnlargement: true })
    .webp({ quality: 84 }).toFile(path.join(base, 'full', name));
  await sharp(buffer).rotate().toColorspace('srgb').resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .webp({ quality: 80 }).toFile(path.join(base, 'thumb', name));
  return { full: name, thumb: name, original, width: full.width, height: full.height };
}

/** Публикует изображение работы как карту: копирует файлы в общую папку карт. */
function copyWorkImage(version) {
  for (const kind of ['full', 'thumb']) {
    fs.copyFileSync(path.join(config.mediaDir, 'works', kind, version.image_full), path.join(config.mediaDir, kind, version.image_full));
  }
  if (version.image_original) {
    try { fs.copyFileSync(path.join(config.mediaDir, 'works', 'originals', version.image_original), path.join(config.mediaDir, 'originals', version.image_original)); } catch { /* исходник не обязателен */ }
  }
}

const insertCard = db.transaction((row) => {
  const number = stmt.maxNumber.get().n + 1;
  const full = { code: codeFor(number), number, source: 'upload', published_at: new Date().toISOString(), artist_id: null, is_demo: 0, image_original: null, author: '', ...row };
  stmt.insert.run(full);
  return stmt.byCode.get(full.code);
});

/** Карта, загруженная владельцем напрямую (раздел «Карты и статистика»). */
async function createFromImage(buffer, { author = '', originalName = '' } = {}) {
  const img = await processImage(buffer, originalName);
  const card = insertCard({ author: String(author).trim().slice(0, 200), image_full: img.full, image_thumb: img.thumb, image_original: img.original, width: img.width, height: img.height });
  return card.code;
}

/**
 * Первая колода из seed/cards. При пустой базе — добавляет карты; при существующей — обновляет изображения
 * и проставляет автора, где он не указан. Карты связываются с художником (пользователь без email, заведён здесь).
 */
function syncSeed() {
  const seedDir = path.join(config.root, 'seed', 'cards');
  const manifestFile = path.join(seedDir, 'manifest.json');
  if (!fs.existsSync(manifestFile)) return;
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const author = manifest.author || '';
  let artistId = null;
  if (author) {
    let u = db.prepare(`SELECT * FROM users WHERE demo_key = 'seed-artist'`).get();
    if (!u) {
      const info = db.prepare(`INSERT INTO users (email, name, public_name, is_demo, demo_key) VALUES (NULL, ?, ?, 0, 'seed-artist')`).run(author, author);
      u = { id: info.lastInsertRowid };
    }
    artistId = u.id;
    db.prepare(`INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, 'artist')`).run(artistId);
  }
  const publishedAt = new Date().toISOString();
  const findSeed = db.prepare(`SELECT * FROM cards WHERE number = ? AND source = 'seed'`);
  const update = db.prepare(`UPDATE cards SET width = ?, height = ?, author = CASE WHEN author = '' THEN ? ELSE author END,
                             artist_id = COALESCE(artist_id, ?) WHERE id = ?`);
  let added = 0;
  db.transaction(() => {
    for (const c of manifest.cards) {
      const name = `seed-${c.file}`;
      const existing = findSeed.get(c.number);
      // изображение не трогаем, если карта уже заменена новой версией через кураторов
      if (!existing || existing.image_full === name) {
        fs.copyFileSync(path.join(seedDir, 'full', c.file), path.join(config.mediaDir, 'full', name));
        fs.copyFileSync(path.join(seedDir, 'thumb', c.file), path.join(config.mediaDir, 'thumb', name));
      }
      if (existing) { update.run(existing.image_full === name ? c.width : existing.width, existing.image_full === name ? c.height : existing.height, author, artistId, existing.id); continue; }
      if (db.prepare('SELECT 1 FROM cards WHERE number = ?').get(c.number)) continue;
      stmt.insert.run({ code: codeFor(c.number), number: c.number, author, image_full: name, image_thumb: name, image_original: null,
        width: c.width, height: c.height, source: 'seed', published_at: publishedAt, artist_id: artistId, is_demo: 0 });
      added += 1;
    }
  })();
  if (added) console.log(`Seeded ${added} cards from seed/cards`);
}

module.exports = { codeFor, mediaUrl, publicCard, listPublished, getPublished, mediaInfo, processImage, copyWorkImage, insertCard, createFromImage, syncSeed, demoFilter };
