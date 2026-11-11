// Проверки по заданию (разделы 01–20 и «Проверка полноты»). Запуск: npm test.
// Используется временная папка данных; почта не подключена (код входа и письма возвращаются как демо).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcards-test-'));
process.env.DATA_DIR = dataDir;
process.env.ADMIN_PASSWORD = 'test-password';
process.env.DEMO_MODE = '1';
const app = require('../server/index.js');

let server; let base;
const visitorA = 'a'.repeat(32);
const visitorB = 'b'.repeat(32);

async function call(method, url, body, { cookie, form } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + url, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}
/** Вход по email: запрос кода (в демо код приходит в ответе) и подтверждение. */
async function emailLogin(email, name) {
  const r1 = await call('POST', '/api/auth/request', { email });
  assert.equal(r1.status, 200);
  assert.ok(r1.json.demo && /^\d{6}$/.test(r1.json.demoCode), 'без почты код показывается как демо');
  const r2 = await call('POST', '/api/auth/verify', { email, code: r1.json.demoCode, name });
  assert.equal(r2.status, 200);
  return { cookie: r2.cookie, user: r2.json.user };
}
const png = (color = '#88aacc', w = 600, h = 1000) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
async function form(fields, files = []) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  for (const [field, buf, name] of files) f.append(field, new Blob([buf], { type: 'image/png' }), name);
  return f;
}

let owner; let artist; let curatorU; let facil; let visitor;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const o = await call('POST', '/api/auth/owner', { password: 'test-password' });
  assert.equal(o.status, 200);
  owner = { cookie: o.cookie, user: o.json.user };
  artist = await emailLogin('artist@example.org', 'Художник Тест');
  curatorU = await emailLogin('curator@example.org', 'Куратор Тест');
  facil = await emailLogin('fac@example.org', 'Фасилитатор Тест');
  visitor = await emailLogin('reader@example.org', 'Читатель');
  // администратор выдаёт роли
  for (const [u, role] of [[curatorU, 'curator'], [facil, 'facilitator']]) {
    const r = await call('POST', `/api/admin/users/${u.user.id}/roles`, { role, grant: true }, { cookie: owner.cookie });
    assert.equal(r.status, 200);
  }
});
after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

// ---------- 03 вход и роли, серверные права ----------
test('03: вход по email без пароля, неверный код отклоняется, права проверяются на сервере', async () => {
  const r1 = await call('POST', '/api/auth/request', { email: 'x@example.org' });
  const bad = await call('POST', '/api/auth/verify', { email: 'x@example.org', code: r1.json.demoCode === '000000' ? '111111' : '000000', name: 'X' });
  assert.equal(bad.status, 401);
  assert.equal((await call('GET', '/api/curation/queue')).status, 401);
  assert.equal((await call('GET', '/api/curation/queue', null, { cookie: artist.cookie })).status, 403, 'художник не видит очередь кураторов');
  assert.equal((await call('GET', '/api/admin/users', null, { cookie: curatorU.cookie })).status, 403, 'куратор не администратор');
  assert.equal((await call('POST', '/api/collections', { title: 'x' }, { cookie: artist.cookie })).status, 403, 'художник не создаёт подборки');
  assert.equal((await call('GET', '/api/chats/curators', null, { cookie: facil.cookie })).status, 403, 'фасилитатор не видит чат кураторов');
  const me = await call('GET', '/api/me', null, { cookie: curatorU.cookie });
  assert.deepEqual(me.json.user.roles, ['curator']);
});

// ---------- 04 библиотека ----------
test('04: первая колода — 40 карт с кодами и автором, библиотека растёт', async () => {
  const r = await call('GET', '/api/cards');
  assert.equal(r.json.cards.length, 40);
  assert.equal((await call('GET', '/api/cards/DC-0001')).json.author, 'Ананда Майя');
  const f = await form({ author: 'Загружено владельцем' }, [['images', await png(), 'a.png']]);
  const up = await call('POST', '/api/admin/cards', null, { cookie: owner.cookie, form: f });
  assert.deepEqual(up.json.created, ['DC-0041']);
});

// ---------- Сценарий 1: художник → возврат по критерию → исправление → одобрение → библиотека ----------
let publishedCode;
test('Сценарий 1: подача, возврат по критерию, исправление в ту же заявку, публикация', async () => {
  const noTerms = await call('POST', '/api/artist/works', null, { cookie: artist.cookie, form: await form({ termsAccepted: 'false', termsVersion: 'draft-2026-11-11' }, [['images', await png(), 'w.png']]) });
  assert.equal(noTerms.json.error, 'terms_required', 'без согласия подать нельзя');
  const files = [];
  for (const c of ['#a33', '#3a3', '#33a', '#aa3', '#3aa']) files.push(['images', await png(c), 'w.png']);
  const sub = await call('POST', '/api/artist/works', null, { cookie: artist.cookie, form: await form({ termsAccepted: 'true', termsVersion: 'draft-2026-11-11' }, files) });
  assert.equal(sub.status, 201);
  const [w1, w2, w3, w4, w5] = sub.json.ids;
  const decide = (id, body, cookie = curatorU.cookie) => call('POST', `/api/curation/works/${id}/decide`, body, { cookie });
  // возврат без критерия нельзя
  assert.equal((await decide(w4, { action: 'return' })).json.error, 'criteria_required');
  // три одобрены, две возвращены — статусы независимы
  for (const id of [w1, w2, w3]) assert.equal((await decide(id, { action: 'approve' })).status, 200);
  assert.equal((await decide(w4, { action: 'return', criteria: [2], comment: 'Поправьте поля' })).status, 200);
  assert.equal((await decide(w5, { action: 'reject', criteria: [1, 3] })).status, 200);
  const mine = await call('GET', '/api/artist/works', null, { cookie: artist.cookie });
  const st = Object.fromEntries(mine.json.works.map((w) => [w.id, w.status]));
  assert.deepEqual([st[w1], st[w2], st[w3], st[w4], st[w5]], ['published', 'published', 'published', 'needs_changes', 'rejected']);
  const w4data = mine.json.works.find((w) => w.id === w4);
  assert.equal(w4data.lastResult.criteria[0].number, 2, 'художник видит номер критерия');
  assert.ok(w4data.lastResult.criteria[0].text.length > 0, 'и его расшифровку');
  // исправление в ту же заявку → снова на рассмотрении
  const fix = await call('POST', `/api/artist/works/${w4}/versions`, null, { cookie: artist.cookie, form: await form({ note: 'исправил' }, [['image', await png('#123456'), 'fix.png']]) });
  assert.equal(fix.status, 200);
  const d = await call('GET', `/api/works/${w4}`, null, { cookie: curatorU.cookie });
  assert.equal(d.json.status, 'submitted');
  assert.equal(d.json.versions.length, 2, 'куратор видит обе версии для сравнения');
  assert.equal(d.json.submissionId, w4data.submissionId);
  const ok = await decide(w4, { action: 'approve' });
  publishedCode = ok.json.cardCode;
  const lib = await call('GET', '/api/cards');
  assert.ok(lib.json.cards.some((c) => c.code === publishedCode), 'карта появилась в библиотеке');
  assert.equal((await call('GET', `/api/cards/${publishedCode}`)).json.author, 'Художник Тест');
  // изображения работ на рассмотрении не видны посторонним
  const thumb = d.json.versions[0].thumb;
  assert.equal((await call('GET', thumb)).status, 404);
  assert.equal((await call('GET', thumb, null, { cookie: artist.cookie })).status, 200);
});

// ---------- 08: передача, обсуждение, голоса ----------
test('08: передать другому куратору, вынести на обсуждение, голосовать — работа остаётся в очереди', async () => {
  const c2 = await emailLogin('curator2@example.org', 'Второй куратор');
  await call('POST', `/api/admin/users/${c2.user.id}/roles`, { role: 'curator', grant: true }, { cookie: owner.cookie });
  const sub = await call('POST', '/api/artist/works', null, { cookie: artist.cookie, form: await form({ termsAccepted: 'true', termsVersion: 'draft-2026-11-11' }, [['images', await png('#777'), 'q.png']]) });
  const id = sub.json.ids[0];
  assert.equal((await call('POST', `/api/curation/works/${id}/assign`, { to: c2.user.id }, { cookie: curatorU.cookie })).status, 200);
  assert.equal((await call('POST', `/api/curation/works/${id}/discuss`, { comment: 'сложно' }, { cookie: c2.cookie })).status, 200);
  await call('POST', `/api/curation/works/${id}/vote`, { vote: 'approve' }, { cookie: curatorU.cookie });
  await call('POST', `/api/curation/works/${id}/vote`, { vote: 'return', comment: 'поля' }, { cookie: c2.cookie });
  const q = await call('GET', '/api/curation/queue', null, { cookie: curatorU.cookie });
  const w = q.json.queue.find((x) => x.id === id);
  assert.equal(w.status, 'discussion');
  assert.equal(w.assignedTo.id, c2.user.id);
  const d = await call('GET', `/api/works/${id}`, null, { cookie: c2.cookie });
  assert.equal(d.json.votes.length, 2);
  assert.deepEqual(d.json.history.map((h) => h.action), ['submitted', 'assign', 'discuss', 'vote', 'vote']);
});

// ---------- Сценарий 4: новая версия опубликованной карты ----------
test('Сценарий 4: новая версия — «исправление» сохраняет код и обсуждение, «новая карта» — новый код', async () => {
  await call('POST', `/api/cards/${publishedCode}/comments`, { text: 'Мне это напомнило детство' }, { cookie: visitor.cookie });
  const before = await call('GET', `/api/cards/${publishedCode}`);
  const rep = await call('POST', `/api/artist/cards/${publishedCode}/replace`, null, { cookie: artist.cookie, form: await form({ termsAccepted: 'true', termsVersion: 'draft-2026-11-11', note: 'цвет' }, [['image', await png('#abcdef'), 'v2.png']]) });
  assert.equal(rep.status, 201);
  // до одобрения опубликована старая версия
  assert.equal((await call('GET', `/api/cards/${publishedCode}`)).json.full, before.json.full);
  assert.equal((await call('POST', `/api/curation/works/${rep.json.id}/decide`, { action: 'approve' }, { cookie: curatorU.cookie })).json.error, 'replacement_type_required');
  const fixed = await call('POST', `/api/curation/works/${rep.json.id}/decide`, { action: 'approve', replacementType: 'fix' }, { cookie: curatorU.cookie });
  assert.equal(fixed.json.cardCode, publishedCode, 'номер сохранён');
  const after = await call('GET', `/api/cards/${publishedCode}`);
  assert.notEqual(after.json.full, before.json.full, 'изображение обновлено');
  assert.equal((await call('GET', `/api/cards/${publishedCode}/comments`)).json.comments.length, 1, 'обсуждение сохранено');
  // существенно новая работа
  const rep2 = await call('POST', `/api/artist/cards/${publishedCode}/replace`, null, { cookie: artist.cookie, form: await form({ termsAccepted: 'true', termsVersion: 'draft-2026-11-11' }, [['image', await png('#fedcba'), 'v3.png']]) });
  const asNew = await call('POST', `/api/curation/works/${rep2.json.id}/decide`, { action: 'approve', replacementType: 'new' }, { cookie: curatorU.cookie });
  assert.notEqual(asNew.json.cardCode, publishedCode, 'новый номер');
  assert.equal((await call('GET', `/api/cards/${asNew.json.cardCode}/comments`)).json.comments.length, 0, 'своё обсуждение');
  assert.equal((await call('GET', `/api/cards/${publishedCode}`)).status, 200, 'прежняя карта осталась');
});

// ---------- 05 обсуждение и 09 снятие автором ----------
test('05 и 09: обсуждение читают все, пишут вошедшие; автор убирает карту — она и обсуждение исчезают', async () => {
  assert.equal((await call('POST', `/api/cards/${publishedCode}/comments`, { text: 'аноним' })).status, 401);
  assert.equal((await call('GET', `/api/cards/${publishedCode}/comments`)).status, 200);
  assert.equal((await call('POST', `/api/artist/cards/${publishedCode}/withdraw`, null, { cookie: visitor.cookie })).json.error, 'not_your_card');
  assert.equal((await call('POST', `/api/artist/cards/${publishedCode}/withdraw`, null, { cookie: artist.cookie })).status, 200);
  assert.equal((await call('GET', `/api/cards/${publishedCode}`)).status, 404);
  assert.equal((await call('GET', `/api/cards/${publishedCode}/comments`)).status, 404, 'обсуждение перестаёт быть публичным');
  assert.ok(!(await call('GET', '/api/cards')).json.cards.some((c) => c.code === publishedCode));
});

// ---------- Сценарий 2: подборка → QR → выбор → статистика ----------
let slug; let colId;
test('Сценарий 2: фасилитатор собирает подборку, участник открывает и выбирает, выбор виден в статистике', async () => {
  colId = (await call('POST', '/api/collections', { title: 'Встреча' }, { cookie: facil.cookie })).json.id;
  const codes = Array.from({ length: 41 }, (_, i) => `DC-${String(i + 1).padStart(4, '0')}`);
  assert.equal((await call('PUT', `/api/collections/${colId}/cards`, { codes }, { cookie: facil.cookie })).json.error, 'too_many_cards');
  assert.equal((await call('PUT', `/api/collections/${colId}/cards`, { codes: ['DC-0001', 'DC-0001', 'DC-0002', 'DC-0003'] }, { cookie: facil.cookie })).status, 200);
  const d = await call('GET', `/api/collections/${colId}`, null, { cookie: facil.cookie });
  assert.deepEqual(d.json.cards.map((c) => c.code), ['DC-0001', 'DC-0002', 'DC-0003'], 'без дубликатов');
  slug = d.json.slug;
  // чужой фасилитатор не видит подборку
  const other = await emailLogin('fac2@example.org', 'Другой');
  await call('POST', `/api/admin/users/${other.user.id}/roles`, { role: 'facilitator', grant: true }, { cookie: owner.cookie });
  assert.equal((await call('GET', `/api/collections/${colId}`, null, { cookie: other.cookie })).status, 404);
  // участник без аккаунта
  assert.equal((await call('GET', `/api/c/${slug}`)).json.cards.length, 3);
  assert.match(await (await fetch(`${base}/api/c/${slug}/qr.svg`)).text(), /<svg/);
  await call('POST', `/api/c/${slug}/visit`, { visitorId: visitorA });
  await call('POST', `/api/c/${slug}/visit`, { visitorId: visitorA });
  assert.equal((await call('GET', '/api/cards/DC-0002')).json.selectedCount, 0, 'просмотры не добавляют выборов');
  const sel = (code, round = 1, v = visitorA) => call('POST', `/api/c/${slug}/select`, { visitorId: v, code, round });
  await sel('DC-0002'); await sel('DC-0002');
  assert.equal((await call('GET', '/api/cards/DC-0002')).json.selectedCount, 1, 'повтор не увеличивает счётчик');
  await sel('DC-0003');
  assert.equal((await call('GET', '/api/cards/DC-0002')).json.selectedCount, 0, 'смена выбора в раунде');
  await sel('DC-0002', 2);
  const state = await call('POST', `/api/c/${slug}/visit`, { visitorId: visitorA });
  assert.deepEqual(state.json.selections, [{ round: 1, code: 'DC-0003' }, { round: 2, code: 'DC-0002' }], 'выбор сохраняется, раунды не стирают друг друга');
  await sel('DC-0003', 1, visitorB);
  const stats = await call('GET', '/api/admin/cards', null, { cookie: owner.cookie });
  const c3 = stats.json.cards.find((c) => c.code === 'DC-0003');
  assert.equal(c3.selections, 2);
  assert.equal(c3.offers, 1, 'предложена одному участнику (второй не открывал подборку)');
});

// ---------- 10/12: снятие карты владельцем, недоступная карта в подборке ----------
test('10: снятая карта исчезает из подборок без поломки остальных; владелец подборки видит её как недоступную', async () => {
  assert.equal((await call('POST', '/api/admin/cards/DC-0002/remove', null, { cookie: owner.cookie })).status, 200);
  assert.deepEqual((await call('GET', `/api/c/${slug}`)).json.cards.map((c) => c.code), ['DC-0001', 'DC-0003']);
  const d = await call('GET', `/api/collections/${colId}`, null, { cookie: facil.cookie });
  assert.equal(d.json.cards.find((c) => c.code === 'DC-0002').status, 'removed');
  await call('POST', '/api/admin/cards/DC-0002/restore', null, { cookie: owner.cookie });
});

// ---------- Сценарий 3: встреча → запись → подтверждение → отмена → место освобождается ----------
test('Сценарий 3: публикация встречи, поиск, запись на последнее место, закрытие, отмена освобождает место', async () => {
  const day = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const r = await call('POST', '/api/fac/meetings', { title: 'Тестовая встреча', country: 'Россия', city: 'Казань', venue: 'Кафе', language: 'ru',
    timezone: 'Europe/Moscow', priceType: 'paid', priceNote: '500 ₽ на месте', capacity: 2, askContact: true, firstDate: `${day}T19:00`, repeatWeekly: 3 }, { cookie: facil.cookie });
  assert.equal(r.status, 201);
  const places = await call('GET', '/api/meetings/places');
  assert.ok(places.json.places.some((p) => p.country === 'Россия' && p.cities.some((c) => c.city === 'Казань' && c.count === 3)), 'страна → город, три даты');
  const list = await call('GET', '/api/meetings?country=Россия&city=Казань');
  const first = list.json.dates[0];
  assert.equal(first.startsAt, `${day}T16:00:00.000Z`, 'местное время 19:00 в Москве = 16:00 UTC');
  assert.equal(list.json.dates[1].capacity, 2, 'у каждой даты свои места');
  const reg = (name, email) => call('POST', `/api/meetings/dates/${first.id}/register`, { name, email, contact: '@tg' });
  assert.equal((await reg('', 'a@b.org')).json.error, 'name_required');
  const r1 = await reg('Аня', 'anya@example.org');
  assert.equal(r1.status, 201);
  assert.ok(r1.json.letter.demo && /Вы записаны/.test(r1.json.letter.subject), 'текст подтверждения');
  assert.match(r1.json.letter.body, /\/r\//, 'в письме ссылка на отмену');
  assert.equal((await reg('Аня', 'anya@example.org')).json.error, 'already_registered');
  const r2 = await reg('Борис', 'boris@example.org');
  assert.equal(r2.status, 201, 'запись на последнее свободное место');
  assert.equal((await reg('Вера', 'vera@example.org')).json.error, 'full', 'запись закрывается при заполнении');
  assert.equal((await call('GET', `/api/meetings/dates/${list.json.dates[1].id}`)).json.left, 2, 'другие даты не затронуты');
  assert.equal((await call('POST', `/api/registrations/${r2.json.token}/cancel`)).status, 200);
  assert.equal((await call('GET', `/api/meetings/dates/${first.id}`)).json.left, 1, 'отмена освобождает место');
  assert.equal((await reg('Вера', 'vera@example.org')).status, 201);
  // фасилитатор видит записи своей встречи, чужой — нет
  const ed = await call('GET', `/api/fac/meetings/${r.json.id}`, null, { cookie: facil.cookie });
  assert.equal(ed.json.dates[0].registrations.length, 3);
  assert.equal(ed.json.dates[0].registrations.find((x) => x.name === 'Аня').contact, '@tg');
  const other = await emailLogin('fac2@example.org', 'Другой');
  assert.equal((await call('GET', `/api/fac/meetings/${r.json.id}`, null, { cookie: other.cookie })).status, 404);
});

// ---------- Сценарий 5: администратор снимает встречу и меняет роль ----------
test('Сценарий 5: администратор снимает встречу и меняет роль — результат виден в интерфейсе', async () => {
  const mine = await call('GET', '/api/fac/meetings', null, { cookie: facil.cookie });
  const mid = mine.json.meetings[0].id;
  assert.equal((await call('POST', `/api/admin/meetings/${mid}/remove`, { reason: 'Формат не соответствует' }, { cookie: facil.cookie })).status, 403);
  assert.equal((await call('POST', `/api/admin/meetings/${mid}/remove`, { reason: 'Формат не соответствует' }, { cookie: owner.cookie })).status, 200);
  assert.ok(!(await call('GET', '/api/meetings/places')).json.places.some((p) => p.cities.some((c) => c.city === 'Казань')), 'встреча исчезла из поиска');
  const ed = await call('GET', `/api/fac/meetings/${mid}`, null, { cookie: facil.cookie });
  assert.equal(ed.json.status, 'removed'); assert.equal(ed.json.removedReason, 'Формат не соответствует');
  // смена роли
  assert.equal((await call('POST', `/api/admin/users/${curatorU.user.id}/roles`, { role: 'curator', grant: false }, { cookie: owner.cookie })).status, 200);
  assert.equal((await call('GET', '/api/curation/queue', null, { cookie: curatorU.cookie })).status, 403, 'доступ пропал сразу');
  await call('POST', `/api/admin/users/${curatorU.user.id}/roles`, { role: 'curator', grant: true }, { cookie: owner.cookie });
  assert.equal((await call('GET', '/api/curation/queue', null, { cookie: curatorU.cookie })).status, 200);
});

// ---------- 16, 17: путь фасилитатора, чаты ----------
test('16: курс, проверка, заявка, одобрение администратором выдаёт роль', async () => {
  const u = await emailLogin('newfac@example.org', 'Новый');
  await call('POST', '/api/fac/application', null, { cookie: u.cookie });
  assert.equal((await call('POST', '/api/fac/application/submit', null, { cookie: u.cookie })).json.error, 'course_not_finished');
  await call('PUT', '/api/fac/application', { courseDone: [0, 1, 2, 3, 4, 5, 6, 7], answers: { q1: 1, q2: 1, q3: 1 }, about: 'Провожу клубы', city: 'Пермь' }, { cookie: u.cookie });
  assert.equal((await call('POST', '/api/fac/application/submit', null, { cookie: u.cookie })).status, 200);
  const apps = await call('GET', '/api/admin/applications', null, { cookie: owner.cookie });
  assert.equal(apps.json.applications.find((a) => a.userId === u.user.id).status, 'submitted');
  await call('POST', `/api/admin/applications/${u.user.id}/decide`, { approve: true }, { cookie: owner.cookie });
  assert.ok((await call('GET', '/api/me', null, { cookie: u.cookie })).json.user.roles.includes('facilitator'));
});
test('17: чаты — сообщения в своём пространстве, доступ по ролям, администратор видит оба', async () => {
  assert.equal((await call('POST', '/api/chats/curators', { text: 'Коллеги, привет' }, { cookie: curatorU.cookie })).status, 201);
  assert.equal((await call('POST', '/api/chats/facilitators', { text: 'Всем привет' }, { cookie: facil.cookie })).status, 201);
  assert.equal((await call('GET', '/api/chats/curators', null, { cookie: owner.cookie })).json.messages.length, 1);
  assert.equal((await call('GET', '/api/chats/facilitators', null, { cookie: owner.cookie })).json.messages.length, 1);
  assert.equal((await call('GET', '/api/chats/facilitators', null, { cookie: curatorU.cookie })).status, 403);
});

// ---------- демо-данные отделены от реальных ----------
test('Демо-данные видны только в демо-режиме и не попадают в реальную статистику', async () => {
  const before = (await call('GET', '/api/cards')).json.cards.length;
  const adm = await call('POST', '/api/demo/login', { as: 'admin' });
  assert.equal((await call('POST', '/api/admin/demo/seed', null, { cookie: adm.cookie })).status, 200);
  assert.equal((await call('GET', '/api/cards')).json.cards.length, before, 'обычный посетитель не видит демо-карт');
  const demoCards = (await call('GET', '/api/cards', null, { cookie: adm.cookie })).json.cards.filter((c) => c.isDemo);
  assert.equal(demoCards.length, 3, 'в демо-режиме видны три опубликованные демо-работы');
  assert.ok(!(await call('GET', '/api/meetings/places')).json.places.some((p) => p.country === 'Таиланд'), 'демо-встречи скрыты от посетителей');
  await call('POST', '/api/admin/demo/clear', null, { cookie: adm.cookie });
  assert.equal((await call('GET', '/api/cards', null, { cookie: adm.cookie })).json.cards.filter((c) => c.isDemo).length, 0);
});

// ---------- демо-роли на публичном сервере не трогают настоящие данные ----------
test('Демо-роли: изменения только над демо-объектами', async () => {
  const adm = await call('POST', '/api/demo/login', { as: 'admin' });
  const cur = await call('POST', '/api/demo/login', { as: 'curator' });
  assert.equal((await call('POST', '/api/admin/cards/DC-0001/remove', null, { cookie: adm.cookie })).json.error, 'demo_readonly');
  assert.equal((await call('POST', `/api/admin/users/${artist.user.id}/roles`, { role: 'admin', grant: true }, { cookie: adm.cookie })).json.error, 'demo_readonly');
  assert.equal((await call('GET', '/api/admin/outbox', null, { cookie: adm.cookie })).status, 403, 'демо-админ не видит журнал писем');
  const users = await call('GET', '/api/admin/users', null, { cookie: adm.cookie });
  assert.ok(users.json.users.every((u) => u.isDemo), 'демо-админ видит только демо-пользователей');
  assert.equal((await call('POST', '/api/admin/cards', null, { cookie: adm.cookie, form: await form({}, [['images', await png(), 'x.png']]) })).json.error, 'demo_readonly');
  // настоящая работа в очереди
  const sub = await call('POST', '/api/artist/works', null, { cookie: artist.cookie, form: await form({ termsAccepted: 'true', termsVersion: 'draft-2026-11-11' }, [['images', await png('#999'), 'r.png']]) });
  assert.equal((await call('POST', `/api/curation/works/${sub.json.ids[0]}/decide`, { action: 'approve' }, { cookie: cur.cookie })).json.error, 'demo_readonly');
  assert.equal((await call('GET', '/api/cards/DC-0001')).status, 200);
});
