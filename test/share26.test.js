// 26.11.2026: отправленная открытка (ссылка, превью без послания) и единое согласие на сторис (встречное предложение — не дубль)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcards-share26-'));
process.env.DATA_DIR = dataDir;
process.env.DEMO_MODE = '1';
const app = require('../server/index.js');

let server; let base;
async function call(method, url, body, visitor) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (visitor) headers['X-DC-Visitor'] = visitor;
  const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text };
}
const VA = 'visitor-aaaaaaaaaaaaaaaa'; const VB = 'visitor-bbbbbbbbbbbbbbbb';
before(async () => { server = app.listen(0); await new Promise((r) => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('открытка: ссылка открывает карту и послание; превью — «Вам открытка!» без текста послания; повтор не создаёт дубль', async () => {
  const code = (await call('GET', '/api/cards')).json.cards[0].code;
  const token = 'Tok_' + 'x'.repeat(24);
  const r1 = await call('POST', '/api/postcards/shared', { code, token, clientKey: 'k1', design: { text: 'Секретное послание', font: 'serif', color: '#ffffff', layout: 'frame', evil: '<script>' } }, VA);
  assert.equal(r1.status, 201); assert.equal(r1.json.token, token);
  const r2 = await call('POST', '/api/postcards/shared', { code, token: 'Other_' + 'y'.repeat(24), clientKey: 'k1', design: {} }, VA);
  assert.equal(r2.json.token, token, 'тот же clientKey — та же открытка');
  const g = await call('GET', `/api/postcards/shared/${token}`);
  assert.equal(g.json.card.code, code); assert.equal(g.json.design.text, 'Секретное послание'); assert.equal(g.json.design.evil, undefined);
  assert.equal((await call('GET', '/api/postcards/shared/' + 'z'.repeat(24))).status, 404);
  const html = (await call('GET', `/pc/${token}`)).text;
  assert.match(html, /<meta property="og:title" content="Вам открытка!">/);
  assert.match(html, /<meta property="og:description" content="Откройте, чтобы увидеть карту и прочитать послание\.">/);
  assert.match(html, /<meta property="og:site_name" content="Dialogue Cards">/);
  assert.match(html, /<title>Вам открытка!<\/title>/);
  assert.ok(!html.includes('Секретное послание'), 'послание в превью не попадает');
  assert.ok(!/Встреча Dialogue Flow/.test(html));
});

test('сторис: друг уже предложил — встречное «предложить» означает согласие, второй запрос не создаётся', async () => {
  const code = (await call('GET', '/api/cards')).json.cards[1].code;
  const x = await call('POST', '/api/exchanges', { code, text: 'Мой ответ', name: 'Аня', clientKey: 'c1' }, VA);
  assert.equal(x.status, 201);
  const ans = await call('POST', `/api/x/${x.json.invite}/answer`, { text: 'Ответ друга', name: 'Борис', answerKey: 'ak1' }, VB);
  assert.ok(ans.status < 300, JSON.stringify(ans.json));
  const bSecret = ans.json.exchange.secret;
  const vb = (await call('GET', `/api/x/${bSecret}`, null, VB)).json;
  const pb = await call('POST', `/api/x/${bSecret}/story`, { action: 'propose', hash: vb.story.hash, frag: { a: 'Мой ответ', b: 'Ответ друга', lang: 'ru' } }, VB);
  assert.equal(pb.json.exchange.story.me, 'agreed'); assert.equal(pb.json.exchange.story.proposedBy, 'me');
  const va = (await call('GET', `/api/x/${x.json.secret}`, null, VA)).json;
  assert.equal(va.story.proposedBy, 'other'); assert.equal(va.story.me, null);
  // встречное предложение с другим языком макета (иначе — новый отпечаток) — засчитывается как согласие на предложенный
  const pa = await call('POST', `/api/x/${x.json.secret}/story`, { action: 'propose', hash: va.story.hash, frag: { a: 'Мой ответ', b: 'Ответ друга', lang: 'en' } }, VA);
  assert.equal(pa.json.exchange.story.hash, va.story.hash); assert.equal(pa.json.exchange.story.proposedBy, 'other'); assert.equal(pa.json.exchange.story.ready, true);
});
