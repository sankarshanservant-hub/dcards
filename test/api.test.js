// Проверки из раздела 16 задания (для функций, вошедших в первую сборку).
// Запуск: npm test. Использует временную папку данных, рабочую базу не трогает.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcards-test-'));
process.env.DATA_DIR = dataDir;
process.env.ADMIN_PASSWORD = 'test-password';
const app = require('../server/index.js');

let server; let base; let cookie = '';
const visitorA = 'a'.repeat(32);
const visitorB = 'b'.repeat(32);

async function call(method, url, body, { auth = false, form } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (auth) headers.Cookie = cookie;
  const res = await fetch(base + url, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, headers: res.headers };
}

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await call('POST', '/api/admin/login', { password: 'test-password' });
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie').split(';')[0];
});
after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('первая колода загружена: 40 карт с постоянными кодами', async () => {
  const r = await call('GET', '/api/cards');
  assert.equal(r.json.cards.length, 40);
  assert.ok(r.json.cards.every((c) => /^DC-\d{4}$/.test(c.code)));
  assert.equal((await call('GET', '/api/cards/DC-0001')).json.author, 'Ананда Майя');
});

test('служебные действия без входа запрещены', async () => {
  assert.equal((await call('GET', '/api/admin/collections')).status, 401);
  assert.equal((await call('POST', '/api/admin/collections', { title: 'x' })).status, 401);
  assert.equal((await call('POST', '/api/admin/cards/DC-0001/remove')).status, 401);
  assert.equal((await call('POST', '/api/admin/login', { password: 'wrong' })).status, 401);
});

test('библиотека принимает новые карты сверх существующих', async () => {
  const png = await sharp({ create: { width: 600, height: 1000, channels: 3, background: '#88aacc' } }).png().toBuffer();
  const form = new FormData();
  form.append('images', new Blob([png], { type: 'image/png' }), 'new.png');
  form.append('author', 'Тестовый автор');
  const r = await call('POST', '/api/admin/cards', null, { auth: true, form });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.created, ['DC-0041']);
  const c = await call('GET', '/api/cards/DC-0041');
  assert.equal(c.json.author, 'Тестовый автор');
  assert.equal((await call('GET', '/api/cards')).json.cards.length, 41);
});

let slug; let colId;
test('подборка: максимум 40 карт, без дубликатов', async () => {
  colId = (await call('POST', '/api/admin/collections', { title: 'Встреча' }, { auth: true })).json.id;
  const codes = Array.from({ length: 41 }, (_, i) => `DC-${String(i + 1).padStart(4, '0')}`);
  const tooMany = await call('PUT', `/api/admin/collections/${colId}/cards`, { codes }, { auth: true });
  assert.equal(tooMany.status, 400);
  assert.equal(tooMany.json.error, 'too_many_cards');
  const dup = await call('PUT', `/api/admin/collections/${colId}/cards`, { codes: ['DC-0001', 'DC-0001', 'DC-0002', 'DC-0003'] }, { auth: true });
  assert.equal(dup.status, 200);
  const d = await call('GET', `/api/admin/collections/${colId}`, null, { auth: true });
  assert.deepEqual(d.json.cards.map((c) => c.code), ['DC-0001', 'DC-0002', 'DC-0003']);
  slug = d.json.slug;
  const forty = await call('PUT', `/api/admin/collections/${colId}/cards`, { codes: codes.slice(0, 40) }, { auth: true });
  assert.equal(forty.status, 200);
  await call('PUT', `/api/admin/collections/${colId}/cards`, { codes: ['DC-0001', 'DC-0002', 'DC-0003'] }, { auth: true });
});

test('подборка открывается по ссылке без аккаунта, QR отдаётся', async () => {
  const r = await call('GET', `/api/c/${slug}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.cards.length, 3);
  const qr = await fetch(`${base}/api/c/${slug}/qr.svg`);
  assert.equal(qr.status, 200);
  assert.match(await qr.text(), /<svg/);
  assert.equal((await call('GET', '/api/c/nonexistent')).status, 404);
});

test('просмотры и повторные открытия не добавляют выборов', async () => {
  await call('POST', `/api/c/${slug}/visit`, { visitorId: visitorA });
  await call('POST', `/api/c/${slug}/visit`, { visitorId: visitorA });
  await call('GET', '/api/cards/DC-0001');
  assert.equal((await call('GET', '/api/cards/DC-0001')).json.selectedCount, 0);
  const stats = await call('GET', '/api/admin/cards', null, { auth: true });
  const c1 = stats.json.cards.find((c) => c.code === 'DC-0001');
  assert.equal(c1.offers, 1, 'карта предложена одному участнику один раз');
});

test('выбор: повторное нажатие не увеличивает счётчик, смена и отмена работают, выбор сохраняется', async () => {
  const sel = (code, round = 1, v = visitorA) => call('POST', `/api/c/${slug}/select`, { visitorId: v, code, round });
  await sel('DC-0001');
  await sel('DC-0001');
  assert.equal((await call('GET', '/api/cards/DC-0001')).json.selectedCount, 1);
  // смена выбора в том же раунде
  await sel('DC-0002');
  assert.equal((await call('GET', '/api/cards/DC-0001')).json.selectedCount, 0);
  assert.equal((await call('GET', '/api/cards/DC-0002')).json.selectedCount, 1);
  // после «перезагрузки» выбор возвращается
  const state = await call('POST', `/api/c/${slug}/visit`, { visitorId: visitorA });
  assert.deepEqual(state.json.selections, [{ round: 1, code: 'DC-0002' }]);
  assert.equal(state.json.counts['DC-0002'], 1);
  // второй раунд не стирает первый
  await sel('DC-0003', 2);
  const s2 = await call('POST', `/api/c/${slug}/visit`, { visitorId: visitorA });
  assert.equal(s2.json.selections.length, 2);
  // отмена
  await call('POST', `/api/c/${slug}/unselect`, { visitorId: visitorA, round: 2 });
  assert.equal((await call('GET', '/api/cards/DC-0003')).json.selectedCount, 0);
  // другой участник
  await sel('DC-0002', 1, visitorB);
  assert.equal((await call('GET', '/api/cards/DC-0002')).json.selectedCount, 2);
  // карту не из подборки выбрать нельзя
  assert.equal((await sel('DC-0010')).status, 400);
});

test('выборы в тестовой подборке не попадают в общую статистику', async () => {
  const testId = (await call('POST', '/api/admin/collections', { title: 'Тест', isTest: true }, { auth: true })).json.id;
  await call('PUT', `/api/admin/collections/${testId}/cards`, { codes: ['DC-0005'] }, { auth: true });
  const tSlug = (await call('GET', `/api/admin/collections/${testId}`, null, { auth: true })).json.slug;
  await call('POST', `/api/c/${tSlug}/select`, { visitorId: visitorA, code: 'DC-0005', round: 1 });
  assert.equal((await call('GET', '/api/cards/DC-0005')).json.selectedCount, 0);
  const stats = (await call('GET', '/api/admin/cards', null, { auth: true })).json.cards.find((c) => c.code === 'DC-0005');
  assert.equal(stats.selections, 0);
  assert.equal(stats.testSelections, 1);
});

test('снятие карты убирает её из библиотеки и подборок, остальные карты не ломаются', async () => {
  const full = (await call('GET', '/api/cards/DC-0002')).json.full;
  assert.equal((await call('POST', '/api/admin/cards/DC-0002/remove', null, { auth: true })).status, 200);
  assert.equal((await call('GET', '/api/cards/DC-0002')).status, 404);
  assert.ok(!(await call('GET', '/api/cards')).json.cards.some((c) => c.code === 'DC-0002'));
  const col = await call('GET', `/api/c/${slug}`);
  assert.deepEqual(col.json.cards.map((c) => c.code), ['DC-0001', 'DC-0003']);
  assert.equal((await fetch(base + full)).status, 404, 'изображение снятой карты недоступно посетителям');
  const d = await call('GET', `/api/admin/collections/${colId}`, null, { auth: true });
  assert.equal(d.json.cards.find((c) => c.code === 'DC-0002').status, 'removed', 'владелец видит недоступную карту');
  // в подборку снятую карту добавить заново нельзя, но можно оставить
  const other = (await call('POST', '/api/admin/collections', { title: 'Другая' }, { auth: true })).json.id;
  assert.equal((await call('PUT', `/api/admin/collections/${other}/cards`, { codes: ['DC-0002'] }, { auth: true })).status, 400);
  assert.equal((await call('POST', '/api/admin/cards/DC-0002/restore', null, { auth: true })).status, 200);
  assert.equal((await call('GET', '/api/cards/DC-0002')).status, 200);
});
