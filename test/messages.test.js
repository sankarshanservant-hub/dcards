// Переписка с администрацией, заявки на онлайн-занятия, категории уведомлений (28.11.2026). Своя папка данных.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcards-dm-'));
process.env.DATA_DIR = dataDir;
process.env.ADMIN_PASSWORD = 'test-password';
process.env.DEMO_MODE = '1';
const app = require('../server/index.js');
const db = require('../server/db');
const push = require('../server/push');

let server; let base;
async function call(method, url, body, { cookie, form, visitor } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  if (visitor) headers['X-DC-Visitor'] = visitor;
  const res = await fetch(base + url, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, cookie: (res.headers.get('set-cookie') || '').split(';')[0], text };
}
async function emailLogin(email, name) {
  const r1 = await call('POST', '/api/auth/request', { email });
  const r2 = await call('POST', '/api/auth/verify', { email, code: r1.json.demoCode, name });
  return { cookie: r2.cookie, user: r2.json.user };
}
const sent = [];
let admin; let ann; let bob;
before(async () => {
  push.setSender(async (sub, payload) => { sent.push({ endpoint: sub.endpoint, ...JSON.parse(payload) }); });
  server = app.listen(0); await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const o = await call('POST', '/api/auth/owner', { password: 'test-password' }); admin = { cookie: o.cookie, user: o.json.user };
  ann = await emailLogin('ann@example.org', 'Анна'); bob = await emailLogin('bob@example.org', 'Борис');
  // push-подписки: у Анны и у администратора (адреса служб push — как у браузеров)
  for (const u of [ann, admin]) db.prepare('INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)').run(u.user.id, `https://fcm.googleapis.com/fcm/send/${u.user.id}`, 'k', 'a' + u.user.id);
});
after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
const wait = () => new Promise((r) => setTimeout(r, 60));

test('переписка: участник пишет с изображением, администратор видит и отвечает; другим недоступно', async () => {
  const room = 'dm-' + ann.user.id;
  const f = new FormData(); f.append('text', 'Не открывается карта'); f.append('clientId', 'c-1');
  f.append('images', new Blob([await sharp({ create: { width: 300, height: 200, channels: 3, background: '#a33' } }).png().toBuffer()], { type: 'image/png' }), 's.png');
  const p = await call('POST', `/api/chats/${room}`, null, { cookie: ann.cookie, form: f });
  assert.equal(p.status, 201, JSON.stringify(p.json));
  // повтор с тем же clientId — без дубля
  const f2 = new FormData(); f2.append('text', 'Не открывается карта'); f2.append('clientId', 'c-1');
  assert.equal((await call('POST', `/api/chats/${room}`, null, { cookie: ann.cookie, form: f2 })).json.duplicate, true);
  await wait();
  // приватность: другой участник не видит и не может писать, файлы вложений закрыты
  assert.equal((await call('GET', `/api/chats/${room}`, null, { cookie: bob.cookie })).status, 403);
  assert.equal((await call('POST', `/api/chats/${room}`, { text: 'x' }, { cookie: bob.cookie })).status, 403);
  const mine = (await call('GET', '/api/messages', null, { cookie: ann.cookie })).json;
  assert.equal(mine.messages.length, 1); const att = mine.messages[0].attachments[0];
  assert.equal((await call('GET', att.thumb, null, { cookie: bob.cookie })).status, 403);
  assert.equal((await call('GET', att.thumb)).status, 401);
  assert.equal((await call('GET', att.thumb, null, { cookie: ann.cookie })).status, 200);
  assert.equal((await call('GET', '/api/admin/messages', null, { cookie: bob.cookie })).status, 403);
  // администратор: список с ролями и непрочитанным, колокольчик, push без текста сообщения
  const th = (await call('GET', '/api/admin/messages', null, { cookie: admin.cookie })).json.threads;
  assert.equal(th.length, 1); assert.equal(th[0].userId, ann.user.id); assert.equal(th[0].unread, 1); assert.deepEqual(th[0].roles, []);
  assert.equal((await call('GET', '/api/admin/attention', null, { cookie: admin.cookie })).json.messages, 1);
  const bellA = (await call('GET', '/api/bell', null, { cookie: admin.cookie })).json.items;
  assert.ok(bellA.some((n) => n.kind === 'direct_admin' && n.url === `/admin/messages/${ann.user.id}`));
  const pa = sent.find((x) => x.endpoint.endsWith('/' + admin.user.id));
  assert.ok(pa && !JSON.stringify(pa).includes('Не открывается'), 'в push — без текста сообщения');
  // ответ администратора: участник видит «Администрация», без имени администратора; непрочитанное и push
  sent.length = 0;
  assert.equal((await call('POST', `/api/chats/${room}`, { text: 'Проверим, спасибо!' }, { cookie: admin.cookie })).status, 201);
  await wait();
  const after1 = (await call('GET', '/api/messages', null, { cookie: ann.cookie })).json;
  assert.equal(after1.unread, 1); const reply = after1.messages[1];
  assert.equal(reply.fromAdmin, true); assert.equal(reply.author, '');
  assert.equal((await call('GET', '/api/chats', null, { cookie: ann.cookie })).json.direct.unread, 1);
  const pu = sent.find((x) => x.endpoint.endsWith('/' + ann.user.id));
  assert.ok(pu && pu.url.endsWith('/me/messages'), JSON.stringify(sent));
  await call('POST', `/api/chats/${room}/read`, { lastId: reply.id }, { cookie: ann.cookie });
  assert.equal((await call('GET', '/api/messages', null, { cookie: ann.cookie })).json.unread, 0);
  // прочитал администратор — у него переписка без непрочитанного
  await call('POST', `/api/chats/${room}/read`, { lastId: reply.id }, { cookie: admin.cookie });
  assert.equal((await call('GET', '/api/admin/messages', null, { cookie: admin.cookie })).json.threads[0].unread, 0);
});

test('администратор пишет первым; категория «Сообщения администрации» выключает push, но не запись', async () => {
  const room = 'dm-' + bob.user.id;
  db.prepare('INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)').run(bob.user.id, `https://fcm.googleapis.com/fcm/send/b${bob.user.id}`, 'k', 'bb');
  const t = (await call('GET', `/api/admin/messages/${bob.user.id}`, null, { cookie: admin.cookie })).json;
  assert.equal(t.room, room); assert.equal(t.messages.length, 0);
  await call('PUT', '/api/push/prefs', { direct: false }, { cookie: bob.cookie });
  sent.length = 0;
  assert.equal((await call('POST', `/api/chats/${room}`, { text: 'Здравствуйте, Борис!' }, { cookie: admin.cookie })).status, 201);
  await wait();
  assert.equal(sent.filter((x) => x.endpoint.includes('/b' + bob.user.id)).length, 0, 'push выключен категорией');
  assert.equal((await call('GET', '/api/messages', null, { cookie: bob.cookie })).json.messages.length, 1);
  assert.ok((await call('GET', '/api/bell', null, { cookie: bob.cookie })).json.items.some((n) => n.kind === 'direct'));
  assert.equal((await call('GET', '/api/admin/messages/999999', null, { cookie: admin.cookie })).status, 404);
});

test('категории уведомлений: по ролям; «все» = все категории; частичный выбор сохраняется', async () => {
  const st = (await call('GET', '/api/push', null, { cookie: ann.cookie })).json;
  assert.ok(st.categories.includes('direct') && st.categories.includes('exchanges'));
  assert.ok(!st.categories.includes('works') && !st.categories.includes('collection') && !st.categories.includes('admin'), 'без ролей — без категорий автора, фасилитатора и администратора');
  const adm = (await call('GET', '/api/push', null, { cookie: admin.cookie })).json.categories;
  assert.ok(['works', 'collection', 'curation', 'admin'].every((c) => adm.includes(c)));
  const off = Object.fromEntries(st.categories.map((c) => [c, false]));
  let p = (await call('PUT', '/api/push/prefs', { enabled: true, ...off }, { cookie: ann.cookie })).json.prefs;
  assert.ok(st.categories.every((c) => p[c] === false));
  p = (await call('PUT', '/api/push/prefs', { enabled: true, ...off, meetings: true }, { cookie: ann.cookie })).json.prefs;
  assert.equal(p.meetings, true); assert.equal(p.exchanges, false);
  assert.equal((await call('GET', '/api/push', null, { cookie: ann.cookie })).json.prefs.exchanges, false, 'после перезагрузки — то же');
});

test('онлайн-занятия: гость и участник без регистрации-ради-заявки, без дублей, видны только администратору', async () => {
  const g = await call('POST', '/api/workshops', { name: 'Гость', contact: '@guest_name', interest: 'метафоры' }, { visitor: 'visitor-aaaaaaaaaaaaaaaa' });
  assert.equal(g.status, 201, JSON.stringify(g.json)); assert.equal(g.json.request.contactKind, 'telegram');
  const again = await call('POST', '/api/workshops', { name: 'Гость', contact: '@guest_name' }, { visitor: 'visitor-aaaaaaaaaaaaaaaa' });
  assert.equal(again.json.already, true);
  assert.equal((await call('POST', '/api/workshops', { name: 'Другой', contact: 't.me/Guest_Name' }, { visitor: 'visitor-bbbbbbbbbbbbbbbb' })).json.already, true, 'тот же контакт — та же заявка');
  assert.equal((await call('POST', '/api/workshops', { name: 'X', contact: 'не контакт' }, { visitor: 'visitor-cccccccccccccccc' })).json.error, 'contact_invalid');
  const m = await call('POST', '/api/workshops', { name: 'Анна', contact: 'ann@example.org' }, { cookie: ann.cookie });
  assert.equal(m.status, 201);
  assert.ok((await call('GET', '/api/workshops/mine', null, { cookie: ann.cookie })).json.request);
  assert.equal((await call('GET', '/api/admin/workshops', null, { cookie: ann.cookie })).status, 403);
  assert.equal((await call('GET', '/api/admin/workshops')).status, 401);
  const list = (await call('GET', '/api/admin/workshops', null, { cookie: admin.cookie })).json;
  assert.equal(list.total, 2); assert.equal(list.fresh, 2);
  assert.ok(list.requests.find((r) => r.userId === ann.user.id && r.account === 'Анна'));
  assert.ok((await call('GET', '/api/bell', null, { cookie: admin.cookie })).json.items.some((n) => n.kind === 'admin_workshop'));
  await call('POST', `/api/admin/workshops/${list.requests[0].id}/status`, { status: 'seen' }, { cookie: admin.cookie });
  assert.equal((await call('GET', '/api/admin/workshops', null, { cookie: admin.cookie })).json.fresh, 1);
  assert.equal((await call('GET', '/api/admin/attention', null, { cookie: admin.cookie })).json.workshops, 1);
});

test('город для подписки на встречи — из справочника, без встреч в нём', async () => {
  const r = (await call('GET', '/api/places/search?q=' + encodeURIComponent('Кострома'))).json.places;
  assert.deepEqual(r[0], { city: 'Кострома', country: 'Россия' });
  const s = await call('POST', '/api/meeting-subs', { mode: 'live', country: r[0].country, city: r[0].city }, { cookie: bob.cookie });
  assert.equal(s.status, 201, JSON.stringify(s.json));
  assert.equal((await call('GET', '/api/meeting-subs', null, { cookie: bob.cookie })).json.subs[0].city, 'Кострома');
});
