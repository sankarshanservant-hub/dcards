// Игры компанией (аудит 28.11): опоздавший не блокирует круг, чей ход в «Истории по кругу». Своя папка данных.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcards-groups-'));
process.env.DATA_DIR = dataDir;
process.env.DEMO_MODE = '1';
const app = require('../server/index.js');

let server; let base;
async function call(method, url, body) {
  const res = await fetch(base + url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const dev = (n) => `device-${n}-aaaaaaaaaaaaaaaa`;
const act = (code, d, action, extra = {}) => call('POST', `/api/group/${code}/act`, { deviceId: d, action, ...extra });
const st = async (code, d) => (await call('GET', `/api/group/${code}/state?device=${d}`)).json;
async function roomOf(format, names) {
  const r = (await call('POST', '/api/group', { format, deviceId: dev(names[0]), name: names[0] })).json;
  for (const n of names.slice(1)) await call('POST', `/api/group/${r.code}/join`, { deviceId: dev(n), name: n });
  return r.code;
}
before(async () => { server = app.listen(0); await new Promise((r) => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('«Карта для друга»: вошедший после раздачи адресатов не блокирует круг и играет со следующего', async () => {
  const code = await roomOf('friend', ['h', 'a']);
  await act(code, dev('h'), 'start');
  await call('POST', `/api/group/${code}/join`, { deviceId: dev('late'), name: 'Лев' });
  const late = await st(code, dev('late'));
  assert.equal(late.late, true); assert.equal(late.players.length, 2);
  const g = (await st(code, dev('h'))).gallery.map((c) => c.code);
  assert.equal((await act(code, dev('late'), 'pick', { code: g[0] })).json.error, 'group_next_round');
  await act(code, dev('h'), 'pick', { code: g[0] }); await act(code, dev('a'), 'pick', { code: g[1] });
  assert.equal((await act(code, dev('h'), 'reveal')).status, 200, 'раскрытие без опоздавшего, без force');
  assert.equal((await st(code, dev('a'))).shown.length, 2);
  await act(code, dev('h'), 'again');
  const next = await st(code, dev('late'));
  assert.ok(next.target && !next.late, 'в следующем круге — свой адресат');
});

test('онлайн «Карта для соседа» и «Чья это карта?»: опоздавший не задерживает переход', async () => {
  let code = await roomOf('gift', ['h', 'a']);
  await act(code, dev('h'), 'start');
  await call('POST', `/api/group/${code}/join`, { deviceId: dev('late'), name: 'Лев' });
  assert.equal((await st(code, dev('late'))).late, true);
  const g = (await st(code, dev('h'))).gallery.map((c) => c.code);
  await act(code, dev('h'), 'pick', { code: g[0], text: 'Вопрос?' }); await act(code, dev('a'), 'pick', { code: g[1], text: 'Вопрос 2?' });
  assert.equal((await st(code, dev('h'))).phase, 'answer');
  code = await roomOf('whose', ['h', 'a']);
  await act(code, dev('h'), 'start');
  await call('POST', `/api/group/${code}/join`, { deviceId: dev('late'), name: 'Лев' });
  for (const d of [dev('h'), dev('a')]) { const s = await st(code, d); await act(code, d, 'pick', { code: s.hand[0].code, text: 'потому что' }); }
  const s = await st(code, dev('h'));
  assert.equal(s.phase, 'guess'); assert.deepEqual(s.players.length, 2);
});

test('очная «История по кругу»: рассказчик меняется с каждой новой картой', async () => {
  const code = await roomOf('story', ['h', 'a', 'b']);
  await act(code, dev('h'), 'start');
  const names = [];
  for (let i = 0; i < 4; i++) { names.push((await st(code, dev('a'))).narrator.name); await act(code, dev('h'), 'next_card'); }
  assert.deepEqual(names, ['h', 'a', 'b', 'h']);
});
