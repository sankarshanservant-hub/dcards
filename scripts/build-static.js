#!/usr/bin/env node
/*
 * Собирает открытую статическую версию Dialogue Cards (без сервера) из static/app.html:
 *   dist/static/artifact/ — страница для claude.ai (без <html>/<head>: их добавляет публикация)
 *   dist/static/site/     — для harekrishna.info: public/apps/dialogue-cards/app/ (полный документ,
 *                           манифест, значки и приглашение установить — как у других приложений раздела /apps/)
 * В обеих: index.html + cards/{thumb,full}/NNN.webp + img/{logo,emblem}.webp. Пути относительные.
 *
 *   node scripts/build-static.js
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const seed = path.join(root, 'seed', 'cards');
const out = path.join(root, 'dist', 'static');
const APP_ID = 'dialogue-cards';
const APP_NAME = 'Dialogue Cards';

const manifest = JSON.parse(fs.readFileSync(path.join(seed, 'manifest.json'), 'utf8'));
const data = { author: manifest.author || '', cards: manifest.cards.map((c) => ({ n: c.number, w: c.width, h: c.height })) };
const qrLib = fs.readFileSync(require.resolve('qrcode-generator/qrcode.js'), 'utf8');

let body = fs.readFileSync(path.join(root, 'static', 'app.html'), 'utf8');
body = body.replace('/*CARDS_JSON*/', () => JSON.stringify(data)).replace('/*QRCODE_LIB*/', () => qrLib.replace(/<\/script/gi, '<\\/script'));

function copyAssets(dir) {
  for (const kind of ['thumb', 'full']) {
    fs.mkdirSync(path.join(dir, 'cards', kind), { recursive: true });
    for (const c of manifest.cards) fs.copyFileSync(path.join(seed, kind, c.file), path.join(dir, 'cards', kind, c.file));
  }
  fs.mkdirSync(path.join(dir, 'img'), { recursive: true });
  fs.copyFileSync(path.join(root, 'public', 'img', 'logo-gold.webp'), path.join(dir, 'img', 'logo.webp'));
  fs.copyFileSync(path.join(root, 'public', 'img', 'emblem-gold.webp'), path.join(dir, 'img', 'emblem.webp'));
}

fs.rmSync(out, { recursive: true, force: true });

// claude.ai: страница как есть
const art = path.join(out, 'artifact');
fs.mkdirSync(art, { recursive: true });
fs.writeFileSync(path.join(art, 'index.html'), body);
copyAssets(art);

// harekrishna.info: полный документ; <title> и подключения — в <head>
const site = path.join(out, 'site');
fs.mkdirSync(site, { recursive: true });
const titleMatch = body.match(/<title>[\s\S]*?<\/title>\n?/);
const headBits = body.match(/^(?:<title>[\s\S]*?<\/title>\n|<meta [^>]*>\n|<link [^>]*>\n)+/)[0];
const rest = body.slice(headBits.length);
const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${titleMatch ? '' : `<title>${APP_NAME}</title>\n`}${headBits}<!-- раздел «Приложения» harekrishna.info (docs/APPS.md): установка на устройство -->
<link rel="manifest" href="/apps/${APP_ID}/manifest.webmanifest">
<link rel="icon" href="/apps/${APP_ID}/icon-192.png">
<link rel="apple-touch-icon" href="/apps/${APP_ID}/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="${APP_NAME}">
<meta name="theme-color" content="#faf7f1">
<script src="/apps/install.js" data-app="${APP_ID}" data-name="${APP_NAME}" data-icon="/apps/${APP_ID}/icon-192.png" defer></script>
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}</style>
</head>
<body>
${rest}</body>
</html>
`;
fs.writeFileSync(path.join(site, 'index.html'), html);
copyAssets(site);

const size = (p) => fs.statSync(p).size;
console.log(`artifact/index.html ${(size(path.join(art, 'index.html')) / 1024).toFixed(0)} KB, site/index.html ${(size(path.join(site, 'index.html')) / 1024).toFixed(0)} KB, cards: ${manifest.cards.length}`);
