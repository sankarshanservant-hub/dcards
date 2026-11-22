// Два входа в одно приложение (server/site.js): dialogue.cards (корень) и портал harekrishna.info/dialogue-cards/.
// Отдельный файл — отдельный процесс node --test: здесь свои переменные окружения.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcards-entries-'));
process.env.DATA_DIR = dataDir;
process.env.ADMIN_PASSWORD = 'test-password';
process.env.DEMO_MODE = '0';
process.env.PUBLIC_URL = 'https://dialogue.cards';
process.env.SITE_URL = 'https://harekrishna.info';
const siteApi = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  res.setHeader('Content-Type', 'application/json');
  if (u.searchParams.get('api') === 'me' && u.searchParams.get('session') === 'good-session-token-1') {
    res.end(JSON.stringify({ ok: true, user: { uid: 'g:9', name: 'Гость портала', email: 'p@example.org', origin: u.searchParams.get('siteOrigin') } }));
  } else res.end(JSON.stringify({ ok: false }));
}).listen(0);
process.env.SITE_AUTH_URL = `http://127.0.0.1:${siteApi.address().port}/api/seva`;
const app = require('../server/index.js');

let server; let port;
before(async () => { server = app.listen(0); await new Promise((r) => server.once('listening', r)); port = server.address().port; });
after(() => { server.close(); siteApi.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

/** Запрос «как от nginx»: свой Host для каждого домена. */
function call(host, method, url, body, cookie) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ port, method, path: url, headers: { Host: host, ...(data ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) } }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => {
        let json = null; try { json = JSON.parse(t); } catch { /* */ }
        resolve({ status: res.statusCode, text: t, json, headers: res.headers, cookie: String((res.headers['set-cookie'] || [''])[0]) });
      });
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}

test('dialogue.cards: корень домена, без входа порталом', async () => {
  const c = await call('dialogue.cards', 'GET', '/api/config');
  assert.equal(c.status, 200);
  assert.equal(c.json.basePath, '');
  assert.equal(c.json.siteLogin, false, 'о портале на своём домене ничего нет');
  const html = await call('dialogue.cards', 'GET', '/');
  assert.equal(html.status, 200);
  assert.match(html.text, /<meta name="dc-base" content="">/);
  assert.doesNotMatch(html.text, /harekrishna/i);
  assert.equal((await call('dialogue.cards', 'POST', '/api/auth/site', { session: 'good-session-token-1' })).status, 401);
  const cards = await call('dialogue.cards', 'GET', '/api/cards');
  assert.ok(cards.json.cards.length > 0);
  assert.match(cards.json.cards[0].thumb, /^\/media\/thumb\//);
  // старые адреса с /dialogue-cards/ на своём домене — в корень
  const old = await call('dialogue.cards', 'GET', '/dialogue-cards/gallery?x=1');
  assert.equal(old.status, 301);
  assert.equal(old.headers.location, '/gallery?x=1');
});

test('портал: /dialogue-cards/, вход аккаунтом портала; данные общие', async () => {
  const c = await call('harekrishna.info', 'GET', '/dialogue-cards/api/config');
  assert.equal(c.json.basePath, '/dialogue-cards');
  assert.equal(c.json.siteLogin, true);
  const html = await call('harekrishna.info', 'GET', '/dialogue-cards/');
  assert.match(html.text, /<meta name="dc-base" content="\/dialogue-cards">/);
  // ссылки для других людей (поделиться, приглашения, QR) с портала — на нейтральный адрес
  assert.match(html.text, /<meta name="dc-share" content="https:\/\/dialogue\.cards">/);
  const cards = await call('harekrishna.info', 'GET', '/dialogue-cards/api/cards');
  assert.match(cards.json.cards[0].thumb, /^\/dialogue-cards\/media\/thumb\//);
  const p = await call('harekrishna.info', 'POST', '/dialogue-cards/api/auth/site', { session: 'good-session-token-1' });
  assert.equal(p.status, 200);
  assert.match(p.cookie, /Path=\/dialogue-cards/);
  // тот же человек, вошедший по паролю владельца на dialogue.cards, — та же база
  const o = await call('dialogue.cards', 'POST', '/api/auth/owner', { password: 'test-password' });
  assert.equal(o.status, 200);
  assert.match(o.cookie, /Path=\/(;|$)/);
  const users = await call('dialogue.cards', 'GET', '/api/admin/users', null, o.cookie.split(';')[0]);
  assert.ok(JSON.stringify(users.json).includes('Гость портала'), 'пользователь портала виден на dialogue.cards');
});
