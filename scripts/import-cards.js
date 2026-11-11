#!/usr/bin/env node
/*
 * Converts print files of cards (PDF or images) into web images for the seed set.
 *
 *   node scripts/import-cards.js <folder> [--out seed/cards] [--bleed-mm 3] [--dpi 330] [--author "Имя"]
 *
 * - Files named 1.pdf … 40.pdf (or 1.png, 1.jpg …) become cards in numeric order.
 * - A file whose name contains "back" is treated as the card back (рубашка).
 * - PDFs are rendered with poppler's `pdftoppm` (must be installed) at print resolution.
 * - --bleed-mm: срезать поля под обрез с каждой стороны (как при резке в типографии). Для PNG/JPG укажите --dpi
 *   их разрешение; PDF рендерятся в 330 dpi. Больше иллюстрация никак не меняется: только RGB WebP и размер.
 * - --author: автор всех карт этого набора (записывается в manifest.json).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const sharp = require('sharp');

const FULL_HEIGHT = 1600; // screen version for the large view
const THUMB_WIDTH = 360; // grid thumbnails

async function main() {
  const args = process.argv.slice(2);
  const inDir = args[0];
  const outIdx = args.indexOf('--out');
  const outDir = path.resolve(outIdx > -1 ? args[outIdx + 1] : 'seed/cards');
  const opt = (name, def) => { const i = args.indexOf(name); return i > -1 ? args[i + 1] : def; };
  const bleedMm = Number(opt('--bleed-mm', 0));
  const dpi = Number(opt('--dpi', 330));
  const author = opt('--author', '');
  const bleedPx = Math.round((bleedMm / 25.4) * dpi);
  if (!inDir) {
    console.error('Usage: node scripts/import-cards.js <folder> [--out seed/cards]');
    process.exit(1);
  }
  fs.mkdirSync(path.join(outDir, 'full'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'thumb'), { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dcards-'));

  const files = fs.readdirSync(inDir).filter((f) => /\.(pdf|png|jpe?g|webp|tiff?)$/i.test(f));
  const cards = [];
  let back = null;
  for (const f of files) {
    const base = path.parse(f).name;
    if (/back/i.test(base)) back = f;
    else if (/^\d+$/.test(base)) cards.push({ n: Number(base), file: f });
    else console.warn('Skipping (name is not a number):', f);
  }
  cards.sort((a, b) => a.n - b.n);

  const toRaster = (file) => {
    const src = path.join(inDir, file);
    if (!/\.pdf$/i.test(file)) return src;
    const target = path.join(tmp, path.parse(file).name);
    execFileSync('pdftoppm', ['-r', '330', '-png', '-singlefile', src, target]);
    return target + '.png';
  };

  // Срезаем поля под обрез одинаково со всех сторон.
  const trimmed = async (raster) => {
    if (!bleedPx) return sharp(raster).toColorspace('srgb');
    const m = await sharp(raster).metadata();
    const buf = await sharp(raster).extract({ left: bleedPx, top: bleedPx, width: m.width - 2 * bleedPx, height: m.height - 2 * bleedPx }).toBuffer();
    return sharp(buf).toColorspace('srgb');
  };

  const manifest = { generatedAt: new Date().toISOString(), bleedMm, author, cards: [], back: null };
  for (const c of cards) {
    const raster = toRaster(c.file);
    const name = String(c.n).padStart(3, '0') + '.webp';
    const full = await (await trimmed(raster))
      .resize({ height: FULL_HEIGHT, withoutEnlargement: true })
      .webp({ quality: 84 }).toFile(path.join(outDir, 'full', name));
    await (await trimmed(raster)).resize({ width: THUMB_WIDTH })
      .webp({ quality: 80 }).toFile(path.join(outDir, 'thumb', name));
    manifest.cards.push({ number: c.n, file: name, width: full.width, height: full.height, source: c.file });
    process.stdout.write('.');
  }
  if (back) {
    const raster = toRaster(back);
    const full = await (await trimmed(raster)).resize({ height: FULL_HEIGHT, withoutEnlargement: true })
      .webp({ quality: 84 }).toFile(path.join(outDir, 'back.webp'));
    manifest.back = { file: 'back.webp', width: full.width, height: full.height, source: back };
  }
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nDone: ${manifest.cards.length} cards${back ? ' + back side' : ''} → ${outDir}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
