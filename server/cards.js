const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const db = require('./db');
const config = require('./config');

const FULL_HEIGHT = 1600;
const THUMB_WIDTH = 360;

for (const d of ['full', 'thumb', 'originals']) fs.mkdirSync(path.join(config.mediaDir, d), { recursive: true });

const codeFor = (n) => `DC-${String(n).padStart(4, '0')}`;

function publicCard(row, { withDetails = false } = {}) {
  const c = {
    code: row.code,
    thumb: `/media/thumb/${row.image_thumb}`,
    full: `/media/full/${row.image_full}`,
    width: row.width,
    height: row.height,
    publishedAt: row.published_at,
  };
  if (withDetails) {
    c.number = row.number;
    c.author = row.author;
  }
  return c;
}

const stmt = {
  published: db.prepare(`SELECT * FROM cards WHERE status = 'published' ORDER BY published_at DESC, number ASC`),
  byCode: db.prepare(`SELECT * FROM cards WHERE code = ?`),
  byMedia: db.prepare(`SELECT status FROM cards WHERE image_full = ? OR image_thumb = ?`),
  maxNumber: db.prepare(`SELECT COALESCE(MAX(number), 0) AS n FROM cards`),
  insert: db.prepare(`INSERT INTO cards (code, number, author, image_full, image_thumb, image_original, width, height, source, published_at)
                      VALUES (@code, @number, @author, @image_full, @image_thumb, @image_original, @width, @height, @source, @published_at)`),
  publicCount: db.prepare(`SELECT COUNT(*) AS n FROM selections WHERE card_id = ? AND cancelled_at IS NULL AND is_test = 0`),
};

function listPublished() {
  return stmt.published.all().map((r) => publicCard(r));
}

function getPublished(code) {
  const row = stmt.byCode.get(code);
  if (!row || row.status !== 'published') return null;
  return { ...publicCard(row, { withDetails: true }), selectedCount: stmt.publicCount.get(row.id).n };
}

function mediaStatus(file) {
  const row = stmt.byMedia.get(file, file);
  return row ? row.status : null;
}

/** Создаёт карту из загруженного изображения. Оригинал хранится отдельно от экранных версий. */
async function createFromImage(buffer, { author = '', originalName = '' } = {}) {
  const meta = await sharp(buffer).metadata(); // бросит ошибку, если это не изображение
  if (!meta.width || !meta.height) throw new Error('not_an_image');
  const id = crypto.randomBytes(9).toString('base64url');
  const ext = (path.extname(originalName) || `.${meta.format || 'bin'}`).toLowerCase().replace(/[^.a-z0-9]/g, '');
  const original = `${id}${ext}`;
  const name = `${id}.webp`;
  fs.writeFileSync(path.join(config.mediaDir, 'originals', original), buffer);
  const full = await sharp(buffer).rotate().toColorspace('srgb')
    .resize({ height: FULL_HEIGHT, withoutEnlargement: true })
    .webp({ quality: 84 }).toFile(path.join(config.mediaDir, 'full', name));
  await sharp(buffer).rotate().toColorspace('srgb').resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .webp({ quality: 80 }).toFile(path.join(config.mediaDir, 'thumb', name));
  const insert = db.transaction(() => {
    const number = stmt.maxNumber.get().n + 1;
    const row = {
      code: codeFor(number), number, author: String(author).trim().slice(0, 200),
      image_full: name, image_thumb: name, image_original: original,
      width: full.width, height: full.height, source: 'upload', published_at: new Date().toISOString(),
    };
    stmt.insert.run(row);
    return row.code;
  });
  return insert();
}

/** При пустой базе загружает первую колоду из seed/cards (подготовлена scripts/import-cards.js). */
function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM cards').get().n;
  if (count > 0) return false;
  const seedDir = path.join(config.root, 'seed', 'cards');
  const manifestFile = path.join(seedDir, 'manifest.json');
  if (!fs.existsSync(manifestFile)) return false;
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const publishedAt = new Date().toISOString();
  const run = db.transaction(() => {
    for (const c of manifest.cards) {
      const name = `seed-${c.file}`;
      fs.copyFileSync(path.join(seedDir, 'full', c.file), path.join(config.mediaDir, 'full', name));
      fs.copyFileSync(path.join(seedDir, 'thumb', c.file), path.join(config.mediaDir, 'thumb', name));
      stmt.insert.run({
        code: codeFor(c.number), number: c.number, author: '',
        image_full: name, image_thumb: name, image_original: null,
        width: c.width, height: c.height, source: 'seed', published_at: publishedAt,
      });
    }
  });
  run();
  console.log(`Seeded ${manifest.cards.length} cards from seed/cards`);
  return true;
}

module.exports = { codeFor, publicCard, listPublished, getPublished, mediaStatus, createFromImage, seedIfEmpty };
