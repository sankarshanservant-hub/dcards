// Пакет 26.11.2026 для фасилитаторов: предварительные заявки на печатные колоды; «новая версия» / «новая карта» при замене;
// история изменений коллекции (было vN → стало vM, непросмотренные). Своя папка данных.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcards-fac-'));
process.env.DATA_DIR = dataDir;
process.env.ADMIN_PASSWORD = 'test-password';
process.env.DEMO_MODE = '1';
const app = require('../server/index.js');
const db = require('../server/db');
const config = require('../server/config');

let server; let base;
async function call(method, url, body, { cookie, form } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + url, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}
async function emailLogin(email, name) {
  const r1 = await call('POST', '/api/auth/request', { email });
  const r2 = await call('POST', '/api/auth/verify', { email, code: r1.json.demoCode, name });
  return { cookie: r2.cookie, user: r2.json.user };
}
const png = (color) => sharp({ create: { width: 700, height: 1200, channels: 3, background: color } }).png().toBuffer();
async function form(fields, files = []) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  for (const [field, buf, name] of files) f.append(field, new Blob([buf], { type: 'image/png' }), name);
  return f;
}
let owner; let artist; let cur; let fac; let other;
before(async () => {
  server = app.listen(0); await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const o = await call('POST', '/api/auth/owner', { password: 'test-password' }); owner = { cookie: o.cookie, user: o.json.user };
  artist = await emailLogin('a@example.org', 'Автор'); cur = await emailLogin('c@example.org', 'Куратор');
  fac = await emailLogin('f@example.org', 'Фасилитатор'); other = await emailLogin('o@example.org', 'Участник');
  for (const [u, role] of [[cur, 'curator'], [fac, 'facilitator']]) await call('POST', `/api/admin/users/${u.user.id}/roles`, { role, grant: true }, { cookie: owner.cookie });
});
after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('заявка на печатные колоды: проверка полей, одна заявка, исправление, доступ', async () => {
  assert.equal((await call('POST', '/api/fac/print-request', { count: 2, country: 'Таиланд', city: 'Чиангмай' }, { cookie: other.cookie })).status, 403, 'не фасилитатор — нельзя');
  assert.equal((await call('GET', '/api/fac/print-request', null, { cookie: fac.cookie })).json.request, null);
  for (const [b, err] of [[{ country: 'Т', city: 'Ч' }, 'count_invalid'], [{ count: 0, country: 'Т', city: 'Ч' }, 'count_invalid'], [{ count: 2.5, country: 'Т', city: 'Ч' }, 'count_invalid'],
    [{ count: '-3', country: 'Т', city: 'Ч' }, 'count_invalid'], [{ count: 2, city: 'Ч' }, 'country_required'], [{ count: 2, country: ' ', city: 'Ч' }, 'country_required'], [{ count: 2, country: 'Т' }, 'city_required']]) {
    const r = await call('POST', '/api/fac/print-request', b, { cookie: fac.cookie }); assert.equal(r.status, 400); assert.equal(r.json.error, err, JSON.stringify(b));
  }
  const r1 = await call('POST', '/api/fac/print-request', { count: '3', country: 'Таиланд', city: 'Чиангмай', comment: 'на осень' }, { cookie: fac.cookie });
  assert.equal(r1.status, 201); assert.equal(r1.json.created, true); assert.equal(r1.json.request.count, 3);
  const r2 = await call('POST', '/api/fac/print-request', { count: 5, country: 'Таиланд', city: 'Бангкок' }, { cookie: fac.cookie });
  assert.equal(r2.json.updated, true, 'повтор — исправление той же заявки, не вторая');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM print_requests WHERE user_id = ?').get(fac.user.id).n, 1);
  const mine = (await call('GET', '/api/fac/print-request', null, { cookie: fac.cookie })).json.request;
  assert.deepEqual([mine.count, mine.city, mine.country, mine.status], [5, 'Бангкок', 'Таиланд', 'new']);
  assert.equal((await call('GET', '/api/admin/print-requests', null, { cookie: fac.cookie })).status, 403, 'список — только администратору');
  const list = (await call('GET', '/api/admin/print-requests', null, { cookie: owner.cookie })).json.requests;
  const row = list.find((x) => x.userId === fac.user.id);
  assert.ok(row && row.count === 5 && row.city === 'Бангкок' && row.country === 'Таиланд' && row.name === 'Фасилитатор' && row.createdAt && row.status === 'new');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'print_decks'").get().n, 0, 'о колодах сейчас никому не сообщаем');
});

test('замена карты: «новая версия» — тот же номер, «новая карта» — новый номер; история и непросмотренные', async () => {
  const sub = await call('POST', '/api/artist/works', null, { cookie: artist.cookie, form: await form({ termsAccepted: 'true', termsVersion: config.termsVersion }, [['images', await png('#a44'), 'a.png']]) });
  assert.equal(sub.status, 201);
  const wid = sub.json.ids ? sub.json.ids[0] : sub.json.id;
  await call('POST', `/api/curation/works/${wid}/decide`, { action: 'approve' }, { cookie: cur.cookie });
  const code = (await call('POST', `/api/admin/works/${wid}/decide`, { action: 'publish' }, { cookie: owner.cookie })).json.cardCode;
  assert.match(code, /^DC-\d+$/);
  const seen0 = (await call('GET', '/api/fac/changes', null, { cookie: fac.cookie })).json;
  assert.ok(seen0.unseen >= 1, 'новая карта — непросмотренное изменение');
  assert.equal((await call('POST', '/api/fac/changes/seen', null, { cookie: fac.cookie })).status, 200);
  assert.equal((await call('GET', '/api/fac/changes', null, { cookie: fac.cookie })).json.unseen, 0, 'после просмотра точка гаснет');

  // новая версия
  const rep = await call('POST', `/api/artist/cards/${code}/replace`, null, { cookie: artist.cookie, form: await form({ termsAccepted: 'true', termsVersion: config.termsVersion, note: 'цвет' }, [['image', await png('#4a4'), 'v2.png']]) });
  assert.equal(rep.status, 201, JSON.stringify(rep.json));
  assert.equal((await call('GET', '/api/fac/changes', null, { cookie: fac.cookie })).json.unseen, 0, 'загрузка новой версии — ещё не изменение коллекции');
  assert.equal((await call('POST', `/api/curation/works/${rep.json.id}/decide`, { action: 'approve' }, { cookie: cur.cookie })).json.error, 'replacement_type_required', 'куратор обязан выбрать: новая версия или новая карта');
  await call('POST', `/api/curation/works/${rep.json.id}/decide`, { action: 'approve', replacementType: 'fix' }, { cookie: cur.cookie });
  const p2 = (await call('POST', `/api/admin/works/${rep.json.id}/decide`, { action: 'publish' }, { cookie: owner.cookie })).json;
  assert.equal(p2.cardCode, code, 'новая версия — прежний номер');
  let ch = (await call('GET', '/api/fac/changes', null, { cookie: fac.cookie })).json;
  const up = ch.changes.find((x) => x.kind === 'updated' && x.code === code);
  assert.ok(up && up.version === 'v2' && up.prevVersion === 'v1', 'обновление: было v1 → стало v2');
  assert.equal(ch.unseen, 1);

  // новая карта
  const rep2 = await call('POST', `/api/artist/cards/${code}/replace`, null, { cookie: artist.cookie, form: await form({ termsAccepted: 'true', termsVersion: config.termsVersion }, [['image', await png('#44a'), 'other.png']]) });
  await call('POST', `/api/curation/works/${rep2.json.id}/decide`, { action: 'approve', replacementType: 'new' }, { cookie: cur.cookie });
  const p3 = (await call('POST', `/api/admin/works/${rep2.json.id}/decide`, { action: 'publish' }, { cookie: owner.cookie })).json;
  assert.notEqual(p3.cardCode, code, 'другая работа — новый номер');
  const oldCard = db.prepare('SELECT status FROM cards WHERE code = ?').get(code);
  assert.equal(oldCard.status, 'published', 'прежняя карта не подменена и остаётся в коллекции');
  ch = (await call('GET', '/api/fac/changes', null, { cookie: fac.cookie })).json;
  assert.ok(ch.changes.some((x) => x.kind === 'added' && x.code === p3.cardCode), 'новая карта — «добавлена» в истории');
  assert.ok(!ch.changes.some((x) => x.kind === 'updated' && x.code === p3.cardCode));
});

test('номер удалённой (стёртой из базы) карты не переиспользуется', async () => {
  const cards = require('../server/cards');
  const a = cards.insertCard({ author: 'x', image_full: 'x.webp', image_thumb: 'x.webp', width: 10, height: 10 });
  db.prepare("INSERT INTO collection_changes (kind, card_id, code, version_label, event_key) VALUES ('removed', ?, ?, '', ?)").run(a.id, a.code, 'test:' + a.id);
  db.prepare('DELETE FROM cards WHERE id = ?').run(a.id);
  const b = cards.insertCard({ author: 'y', image_full: 'y.webp', image_thumb: 'y.webp', width: 10, height: 10 });
  assert.ok(b.number > a.number, `${b.code} после ${a.code}`);
});
