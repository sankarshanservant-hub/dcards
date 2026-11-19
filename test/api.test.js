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
// Поддельный API сайта (harekrishna.info /api/seva?api=me) для проверки входа общим аккаунтом.
const http = require('http');
const siteApi = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const s = u.searchParams.get('session');
  res.setHeader('Content-Type', 'application/json');
  if (u.searchParams.get('api') === 'me' && s === 'good-session-token-1') res.end(JSON.stringify({ ok: true, user: { uid: 'g:123', name: 'Майя', displayName: 'Майя', email: 'maya@example.org' } }));
  else res.end(JSON.stringify({ ok: false }));
}).listen(0);
process.env.SITE_AUTH_URL = `http://127.0.0.1:${siteApi.address().port}/api/seva`;
const app = require('../server/index.js');

let server; let base;
const visitorA = 'a'.repeat(32);
const visitorB = 'b'.repeat(32);

async function call(method, url, body, { cookie, form, visitor } = {}) {
  const headers = {};
  if (visitor) headers['X-DC-Visitor'] = visitor;
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
after(() => { server.close(); siteApi.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

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
  const publish = (id, body = {}) => call('POST', `/api/admin/works/${id}/decide`, { action: 'publish', ...body }, { cookie: owner.cookie });
  // возврат без критерия нельзя
  assert.equal((await decide(w4, { action: 'return' })).json.error, 'criteria_required');
  // три одобрены, две возвращены — статусы независимы
  // куратор только рекомендует: работа уходит в очередь администратора и в галерею пока не попадает
  for (const id of [w1, w2, w3]) assert.equal((await decide(id, { action: 'recommend' })).status, 200);
  assert.equal((await decide(w1, { action: 'recommend' })).json.error, 'already_recommended');
  assert.equal((await call('GET', `/api/artist/works`, null, { cookie: artist.cookie })).json.works.find((w) => w.id === w1).status, 'recommended');
  assert.equal((await call('POST', `/api/admin/works/${w1}/decide`, { action: 'publish' }, { cookie: curatorU.cookie })).status, 403, 'куратор не публикует напрямую');
  const aq = (await call('GET', '/api/admin/works', null, { cookie: owner.cookie })).json;
  assert.deepEqual(aq.recommended.map((w) => w.id).sort(), [w1, w2, w3].sort(), 'в очереди администратора — только рекомендации');
  assert.ok(!(await call('GET', '/api/curation/queue', null, { cookie: curatorU.cookie })).json.queue.some((w) => w.id === w1), 'из очереди кураторов ушла');
  const sentPush = []; require('../server/push').setSender(async (sub, payload) => { sentPush.push(JSON.parse(payload)); });
  for (const id of [w1, w2, w3]) assert.equal((await publish(id)).status, 200);
  assert.equal((await decide(w4, { action: 'return', criteria: [2], comment: 'Поправьте поля' })).status, 200);
  assert.equal((await decide(w5, { action: 'reject', criteria: [1, 3] })).status, 200);
  const mine = await call('GET', '/api/artist/works', null, { cookie: artist.cookie });
  const st = Object.fromEntries(mine.json.works.map((w) => [w.id, w.status]));
  assert.deepEqual([st[w1], st[w2], st[w3], st[w4], st[w5]], ['published', 'published', 'published', 'needs_changes', 'rejected']);
  const w4data = mine.json.works.find((w) => w.id === w4);
  const log = (await call('GET', '/api/admin/works', null, { cookie: owner.cookie })).json.decisions;
  assert.ok(log.some((x) => x.workId === w4 && x.action === 'return' && x.criteria[0].number === 2 && x.artist), 'администратор видит возвраты с причиной и автором');
  assert.ok(log.some((x) => x.workId === w5 && x.action === 'reject'), 'и отклонения');
  assert.equal(w4data.lastResult.criteria[0].number, 2, 'художник видит номер критерия');
  assert.ok(w4data.lastResult.criteria[0].text.length > 0, 'и его расшифровку');
  // исправление в ту же заявку → снова на рассмотрении
  const fix = await call('POST', `/api/artist/works/${w4}/versions`, null, { cookie: artist.cookie, form: await form({ note: 'исправил' }, [['image', await png('#123456'), 'fix.png']]) });
  assert.equal(fix.status, 200);
  const d = await call('GET', `/api/works/${w4}`, null, { cookie: curatorU.cookie });
  assert.equal(d.json.status, 'submitted');
  assert.equal(d.json.versions.length, 2, 'куратор видит обе версии для сравнения');
  assert.equal(d.json.submissionId, w4data.submissionId);
  await decide(w4, { action: 'approve' }); // прежнее название действия — тоже рекомендация
  assert.ok(!(await call('GET', '/api/cards')).json.cards.some((c) => c.author === 'Художник Тест' && c.code === 'DC-0045'), 'до решения администратора в галерее нет');
  const ok = await publish(w4);
  publishedCode = ok.json.cardCode;
  const lib = await call('GET', '/api/cards');
  assert.ok(lib.json.cards.some((c) => c.code === publishedCode), 'карта появилась в библиотеке');
  assert.equal((await call('GET', `/api/cards/${publishedCode}`)).json.author, 'Художник Тест');
  // автору — уведомления о решениях (только если у него есть подписка; здесь — проверка через журнал, без сети)
  assert.ok(require('../server/db').prepare('SELECT COUNT(*) AS n FROM push_work_log').get().n >= 5, 'по одному уведомлению на решение: 4 публикации, возврат, отклонение');
  // изображения работ на рассмотрении не видны посторонним
  const thumb = d.json.versions[0].thumb;
  assert.equal((await call('GET', thumb)).status, 404);
  assert.equal((await call('GET', thumb, null, { cookie: artist.cookie })).status, 200);
});

// ---------- 08: передача, обсуждение, голоса ----------
test('08: общий список кураторов; вынести на обсуждение публикует вопрос в чате со ссылкой; голоса коллег', async () => {
  const c2 = await emailLogin('curator2@example.org', 'Второй куратор');
  await call('POST', `/api/admin/users/${c2.user.id}/roles`, { role: 'curator', grant: true }, { cookie: owner.cookie });
  const sub = await call('POST', '/api/artist/works', null, { cookie: artist.cookie, form: await form({ termsAccepted: 'true', termsVersion: 'draft-2026-11-11' }, [['images', await png('#777'), 'q.png']]) });
  const id = sub.json.ids[0];
  assert.equal((await call('POST', `/api/curation/works/${id}/assign`, { to: c2.user.id }, { cookie: curatorU.cookie })).status, 404, 'персональной передачи больше нет');
  assert.equal((await call('POST', `/api/curation/works/${id}/discuss`, { question: '  ' }, { cookie: c2.cookie })).json.error, 'question_required', 'без вопроса обсуждение не открыть');
  assert.equal((await call('POST', `/api/curation/works/${id}/discuss`, { question: 'Не уверен насчёт цвета — как вам?' }, { cookie: c2.cookie })).status, 200);
  const chat = (await call('GET', '/api/chats/curators', null, { cookie: curatorU.cookie })).json.messages;
  const posted = chat.find((m) => m.workId === id);
  assert.ok(posted && posted.text === 'Не уверен насчёт цвета — как вам?', 'вопрос в чате кураторов со ссылкой на работу');
  assert.equal((await call('POST', `/api/curation/works/${id}/discuss`, { question: 'ещё раз' }, { cookie: c2.cookie })).json.error, 'not_in_review');
  await call('POST', `/api/curation/works/${id}/vote`, { vote: 'approve' }, { cookie: curatorU.cookie });
  await call('POST', `/api/curation/works/${id}/vote`, { vote: 'return', comment: 'поля' }, { cookie: c2.cookie });
  const q = await call('GET', '/api/curation/queue', null, { cookie: curatorU.cookie });
  const w = q.json.queue.find((x) => x.id === id);
  assert.equal(w.status, 'discussion');
  const d = await call('GET', `/api/works/${id}`, null, { cookie: c2.cookie });
  assert.equal(d.json.votes.length, 2);
  assert.deepEqual(d.json.history.map((h) => h.action), ['submitted', 'discuss', 'vote', 'vote']);
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
  await call('POST', `/api/curation/works/${rep.json.id}/decide`, { action: 'recommend', replacementType: 'fix' }, { cookie: curatorU.cookie });
  assert.equal((await call('GET', `/api/cards/${publishedCode}`)).json.full, before.json.full, 'после рекомендации — всё ещё прежняя версия');
  const fixed = await call('POST', `/api/admin/works/${rep.json.id}/decide`, { action: 'publish' }, { cookie: owner.cookie });
  assert.equal(fixed.json.cardCode, publishedCode, 'номер сохранён');
  const after = await call('GET', `/api/cards/${publishedCode}`);
  assert.notEqual(after.json.full, before.json.full, 'изображение обновлено');
  assert.equal((await call('GET', `/api/cards/${publishedCode}/comments`)).json.comments.length, 1, 'обсуждение сохранено');
  // существенно новая работа
  const rep2 = await call('POST', `/api/artist/cards/${publishedCode}/replace`, null, { cookie: artist.cookie, form: await form({ termsAccepted: 'true', termsVersion: 'draft-2026-11-11' }, [['image', await png('#fedcba'), 'v3.png']]) });
  await call('POST', `/api/curation/works/${rep2.json.id}/decide`, { action: 'approve', replacementType: 'new' }, { cookie: curatorU.cookie });
  const asNew = await call('POST', `/api/admin/works/${rep2.json.id}/decide`, { action: 'publish' }, { cookie: owner.cookie });
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
  assert.deepEqual(state.json.selections.map(({ round, code }) => ({ round, code })), [{ round: 1, code: 'DC-0003' }, { round: 2, code: 'DC-0002' }], 'выбор сохраняется, раунды не стирают друг друга');
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
    timezone: 'Europe/Moscow', priceType: 'paid', priceAmount: 500, currency: 'RUB', priceNote: 'наличными на месте', capacity: 2, askContact: true, firstDate: `${day}T19:00`, repeatWeekly: 3 }, { cookie: facil.cookie });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const places = await call('GET', '/api/meetings/places');
  assert.ok(places.json.places.some((p) => p.country === 'Россия' && p.cities.some((c) => c.city === 'Казань' && c.count === 3)), 'страна → город, три даты');
  const list = await call('GET', '/api/meetings?country=Россия&city=Казань');
  const first = list.json.dates[0];
  assert.equal(first.meeting.priceAmount, 500); assert.equal(first.meeting.currency, 'RUB'); assert.equal(first.meeting.priceType, 'paid');
  const noPrice = await call('POST', '/api/fac/meetings', { title: 'Платная без цены', country: 'Россия', city: 'Казань', language: 'ru', priceType: 'paid', capacity: 5, firstDate: `${day}T19:00` }, { cookie: facil.cookie });
  assert.equal(noPrice.json.error, 'price_required', 'у платной встречи цена обязательна');
  assert.equal((await call('POST', '/api/fac/meetings', { title: 'Платная без валюты', country: 'Россия', city: 'Казань', language: 'ru', priceType: 'paid', priceAmount: 100, capacity: 5, firstDate: `${day}T19:00` }, { cookie: facil.cookie })).json.error, 'currency_required');
  assert.equal(first.startsAt, `${day}T16:00:00.000Z`, 'местное время 19:00 в Москве = 16:00 UTC');
  assert.equal(list.json.dates[1].capacity, 2, 'у каждой даты свои места');
  const reg = (name, email) => call('POST', `/api/meetings/dates/${first.id}/register`, { name, email, contact: '@tg' });
  assert.equal((await reg('', 'a@b.org')).json.error, 'name_required');
  const r1 = await reg('Аня', 'anya@example.org');
  assert.equal(r1.status, 201);
  assert.ok(r1.json.letter.demo && /Вы записаны/.test(r1.json.letter.subject), 'текст подтверждения');
  assert.match(r1.json.letter.body, /\/r\//, 'в письме ссылка на отмену');
  assert.match(r1.json.letter.body, /\/ics/, 'в письме ссылка «Добавить в календарь»');
  assert.match(r1.json.letter.body, /500 RUB за участника/, 'в письме стоимость участия');
  assert.match(r1.json.letter.body, /Кафе, Казань, Россия/, 'в письме место');
  // файл календаря: время в UTC, место, ссылка на запись
  const ics = await fetch(`${base}/api/registrations/${r1.json.token}/ics`);
  assert.equal(ics.status, 200);
  assert.match(ics.headers.get('content-type'), /text\/calendar/);
  const icsText = await ics.text();
  assert.match(icsText, new RegExp(`DTSTART:${day.replace(/-/g, '')}T160000Z`), '19:00 Москвы = 16:00 UTC');
  assert.match(icsText, /LOCATION:Кафе\\, Казань\\, Россия/);
  assert.match(icsText.replace(/\r\n /g, ''), new RegExp(`/r/${r1.json.token}`));
  assert.equal((await fetch(`${base}/api/registrations/nope/ics`)).status, 404);
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
  // «Повторить встречу»: новая встреча с теми же полями и новой датой — записи не переносятся
  const src = ed.json;
  const day2 = new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10);
  const copy = await call('POST', '/api/fac/meetings', { title: src.title, description: src.description, country: src.country, city: src.city, venue: src.venue, language: src.language,
    timezone: src.timezone, priceType: src.priceType, priceAmount: src.priceAmount, currency: src.currency, priceNote: src.priceNote, capacity: src.capacity, askContact: src.askContact, firstDate: `${day2}T19:00`, repeatWeekly: 1 }, { cookie: facil.cookie });
  assert.equal(copy.status, 201, JSON.stringify(copy.json));
  const cm = (await call('GET', `/api/fac/meetings/${copy.json.id}`, null, { cookie: facil.cookie })).json;
  assert.equal(cm.dates.length, 1);
  assert.equal(cm.dates[0].registrations.length, 0, 'записи не копируются');
  assert.equal(cm.askContact, true);
  assert.equal(cm.priceAmount, 500, 'цена копируется при повторе');
  const unknown = await call('POST', '/api/fac/meetings', { ...src, city: 'Неведомск', country: '', firstDate: `${day2}T19:00` }, { cookie: facil.cookie });
  assert.equal(unknown.json.error, 'city_unresolved', 'город не определён — встречу не опубликовать, просим уточнить');
  assert.equal((await call('POST', `/api/fac/meetings/${copy.json.id}/publish`, { published: false }, { cookie: facil.cookie })).status, 200, 'копию можно скрыть');
});

// ---------- Сценарий 5: администратор снимает встречу и меняет роль ----------
test('Сценарий 5: администратор снимает встречу и меняет роль — результат виден в интерфейсе', async () => {
  const mine = await call('GET', '/api/fac/meetings', null, { cookie: facil.cookie });
  const mid = mine.json.meetings.find((m) => m.status === 'published').id;
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
  await call('PUT', '/api/fac/application', { courseDone: [0, 1, 2, 3, 4, 5, 6, 7], answers: Object.fromEntries(require('../server/community').QUESTIONS.map((q) => [q.id, q.answer])), about: 'Провожу клубы', city: 'Пермь' }, { cookie: u.cookie });
  assert.equal((await call('POST', '/api/fac/application/submit', null, { cookie: u.cookie })).status, 200);
  const apps = await call('GET', '/api/admin/applications', null, { cookie: owner.cookie });
  assert.equal(apps.json.applications.find((a) => a.userId === u.user.id).status, 'submitted');
  await call('POST', `/api/admin/applications/${u.user.id}/decide`, { approve: true }, { cookie: owner.cookie });
  assert.ok((await call('GET', '/api/me', null, { cookie: u.cookie })).json.user.roles.includes('facilitator'));
});
test('Проверка фасилитатора: попытки, номера ошибок, главы, ручная проверка; роль только после одобрения', async () => {
  const u = await emailLogin('quizfac@example.org', 'Квиз');
  const Q = require('../server/community').QUESTIONS;
  await call('POST', '/api/fac/application', null, { cookie: u.cookie });
  const wrongAns = Object.fromEntries(Q.map((q, i) => [q.id, i === 1 ? (q.answer + 1) % q.options.length : q.answer]));
  assert.equal((await call('POST', '/api/fac/application/quiz', { answers: wrongAns }, { cookie: u.cookie })).json.error, 'course_not_finished', 'сначала руководство');
  await call('PUT', '/api/fac/application', { courseDone: [0, 1, 2, 3, 4, 5, 6, 7] }, { cookie: u.cookie });
  const tryQ = () => call('POST', '/api/fac/application/quiz', { answers: wrongAns }, { cookie: u.cookie }).then((r) => r.json.quiz);
  let q = await tryQ(); assert.equal(q.correct, 9); assert.equal(q.wrongNumbers, undefined, '1-я: только сколько верно');
  q = await tryQ(); assert.equal(q.wrongNumbers, undefined, '2-я: только сколько верно');
  q = await tryQ(); assert.deepEqual(q.wrongNumbers, [2], '3-я неудачная: номера вопросов'); assert.ok(q.chapters['2'].length, 'и главы к ним');
  assert.equal((await call('POST', '/api/fac/application/manual', {}, { cookie: u.cookie })).json.error, 'manual_not_available');
  q = await tryQ(); assert.equal(q.canManual, true, '4-я: ручная проверка, даже при одной ошибке');
  const me = (await call('GET', '/api/fac/application', null, { cookie: u.cookie })).json.application;
  assert.equal(me.quiz.attempts, 4, 'состояние переживает перезагрузку'); assert.equal(me.answers[Q[1].id], wrongAns[Q[1].id], 'ответы сохранены');
  assert.equal((await call('POST', '/api/fac/application/submit', null, { cookie: u.cookie })).json.error, 'quiz_not_passed');
  assert.equal((await call('POST', '/api/fac/application/manual', { city: 'Казань', about: 'Хочу проводить' }, { cookie: u.cookie })).status, 200);
  assert.ok(!(await call('GET', '/api/me', null, { cookie: u.cookie })).json.user.roles.includes('facilitator'), 'ручная отправка роль не даёт');
  const app = (await call('GET', '/api/admin/applications', null, { cookie: owner.cookie })).json.applications.find((a) => a.userId === u.user.id);
  assert.equal(app.status, 'submitted'); assert.ok(app.manualReview); assert.equal(app.answers.filter((x) => !x.right).length, 1, 'администратор видит ответы');
  // успешная проверка у другого — сразу к заявке, роль тоже только после одобрения
  const v = await emailLogin('quizfac2@example.org', 'Квиз2');
  await call('POST', '/api/fac/application', null, { cookie: v.cookie });
  await call('PUT', '/api/fac/application', { courseDone: [0, 1, 2, 3, 4, 5, 6, 7] }, { cookie: v.cookie });
  const ok = (await call('POST', '/api/fac/application/quiz', { answers: Object.fromEntries(Q.map((x) => [x.id, x.answer])) }, { cookie: v.cookie })).json.quiz;
  assert.ok(ok.passed);
  assert.equal((await call('POST', '/api/fac/application/submit', null, { cookie: v.cookie })).status, 200);
  assert.ok(!(await call('GET', '/api/me', null, { cookie: v.cookie })).json.user.roles.includes('facilitator'));
});
test('17: чаты — сообщения в своём пространстве, доступ по ролям, администратор видит оба', async () => {
  assert.equal((await call('POST', '/api/chats/curators', { text: 'Коллеги, привет' }, { cookie: curatorU.cookie })).status, 201);
  assert.equal((await call('POST', '/api/chats/facilitators', { text: 'Всем привет' }, { cookie: facil.cookie })).status, 201);
  assert.ok((await call('GET', '/api/chats/curators', null, { cookie: owner.cookie })).json.messages.some((m) => m.text === 'Коллеги, привет'));
  assert.equal((await call('GET', '/api/chats/facilitators', null, { cookie: owner.cookie })).json.messages.length, 1);
  assert.equal((await call('GET', '/api/chats/facilitators', null, { cookie: curatorU.cookie })).status, 403);
});

test('Переслать: из общего — в доступный закрытый чат, автор и ссылка на оригинал; закрытое в общий не пересылается', async () => {
  const m = await call('POST', '/api/chats/general', { text: 'Кто знает хороший зал в Казани?' }, { cookie: visitor.cookie });
  const id = m.json.id;
  assert.equal((await call('POST', `/api/chats/general/messages/${id}/forward`, { to: 'curators' }, { cookie: visitor.cookie })).status, 403, 'без роли — нельзя');
  const f = await call('POST', `/api/chats/general/messages/${id}/forward`, { to: 'facilitators' }, { cookie: facil.cookie });
  assert.equal(f.status, 201);
  const fm = (await call('GET', '/api/chats/facilitators', null, { cookie: facil.cookie })).json.messages.find((x) => x.id === f.json.id);
  assert.equal(fm.text, 'Кто знает хороший зал в Казани?'); assert.equal(fm.forwardOf.id, id); assert.equal(fm.forwardOf.room, 'general');
  assert.ok((await call('GET', '/api/chats/general', null, { cookie: facil.cookie })).json.messages.some((x) => x.id === id), 'оригинал на месте');
  assert.equal((await call('POST', `/api/chats/facilitators/messages/${f.json.id}/forward`, { to: 'general' }, { cookie: facil.cookie })).json.error, 'forward_not_allowed', 'закрытое в общий — нет');
  assert.equal((await call('POST', `/api/chats/general/messages/${id}/forward`, { to: 'general' }, { cookie: facil.cookie })).json.error, 'bad_room');
});


// ---------- 18.11: обмен с другом, сторис, единый счётчик, колокольчик, личные данные ----------
test('Обмен: два независимых браузера, скрытый ответ, возврат, повтор, посторонний; сторис с двумя согласиями; счётчик', async () => {
  const VA = 'visitor-aaaa-0000-1111-2222'; const VB = 'visitor-bbbb-0000-1111-2222'; const VC = 'visitor-cccc-0000-1111-2222';
  const code = (await call('GET', '/api/cards')).json.cards.find((c) => !c.isDemo).code;
  const total = async () => (await call('GET', `/api/cards/${code}`)).json.selectedCount;
  const t0 = await total();
  const x = await call('POST', '/api/exchanges', { code, text: 'Вижу дорогу домой', name: 'Аня', clientKey: 'k1' }, { visitor: VA });
  assert.equal(x.status, 201);
  const again = await call('POST', '/api/exchanges', { code, text: 'Вижу дорогу домой', clientKey: 'k1' }, { visitor: VA });
  assert.equal(again.json.id, x.json.id, 'повтор создания — тот же обмен');
  const inv = x.json.invite; const secA = x.json.secret;
  assert.notEqual(inv, secA, 'приглашение и личный доступ А — разные ссылки');
  // Б видит карту и вопрос, ответ А скрыт — сервер его не отдаёт
  const vb = await call('GET', `/api/x/${inv}`, null, { visitor: VB });
  assert.equal(vb.json.role, 'invitee'); assert.ok(!JSON.stringify(vb.json).includes('дорогу'), 'текст А не отдаётся до ответа');
  assert.equal(await total(), t0, 'приглашение без ответа — не выбор');
  // А видит «ждём ответа»
  let mine = (await call('GET', `/api/exchanges?card=${code}`, null, { visitor: VA })).json.exchanges;
  assert.equal(mine.length, 1); assert.equal(mine[0].answered, false);
  assert.equal((await call('POST', `/api/x/${inv}/answer`, { text: 'сам себе' }, { visitor: VA })).json.error, 'exchange_own');
  const ans = await call('POST', `/api/x/${inv}/answer`, { text: 'Вижу утро и тишину', name: 'Борис', answerKey: 'b1' }, { visitor: VB });
  assert.equal(ans.status, 201); assert.equal(ans.json.exchange.otherText, 'Вижу дорогу домой', 'после ответа Б видит ответ А');
  const rep = await call('POST', `/api/x/${inv}/answer`, { text: 'Вижу утро и тишину', answerKey: 'b1' }, { visitor: VB });
  assert.ok(rep.json.repeated, 'повтор отправки (обрыв сети) — без второй записи');
  assert.equal(await total(), t0 + 1, 'обмен: один выбор после второго ответа');
  // А вернулся: колокольчик гостя и сама карта
  const bA = (await call('GET', '/api/bell', null, { visitor: VA })).json;
  assert.ok(bA.unread >= 1 && bA.items[0].url === `/x/${secA}`, 'А: «Друг ответил на карту» ведёт в его обмен');
  assert.equal((await call('GET', '/api/bell', null, { visitor: VC })).json.items.length, 0, 'другой гость чужих событий не видит');
  mine = (await call('GET', `/api/exchanges?card=${code}`, null, { visitor: VA })).json.exchanges; assert.ok(mine[0].answered, '«Друг ответил» на карте');
  const va = (await call('GET', `/api/x/${secA}`)).json; assert.equal(va.otherText, 'Вижу утро и тишину', 'личная ссылка А работает из любого браузера');
  // посторонний по пересланной ссылке-приглашению после использования — ничего личного
  const st = (await call('GET', `/api/x/${inv}`, null, { visitor: VC })).json;
  assert.equal(st.role, 'stranger'); assert.ok(!JSON.stringify(st).includes('утро') && !JSON.stringify(st).includes('дорогу'));
  assert.equal((await call('POST', `/api/x/${inv}/answer`, { text: 'и я' }, { visitor: VC })).json.error, 'exchange_taken');
  // Б вернулся по той же ссылке в своём браузере
  assert.equal((await call('GET', `/api/x/${inv}`, null, { visitor: VB })).json.role, 'b');
  // сторис: макет, предложение А, согласие Б
  const h = va.story.hash;
  assert.equal((await call('POST', `/api/x/${secA}/story`, { action: 'propose', hash: 'other' })).json.error, 'story_changed', 'согласие только на точный макет');
  assert.equal((await call('POST', `/api/x/${inv}/story`, { action: 'agree', hash: h }, { visitor: VC })).json.error, 'forbidden', 'посторонний не подтверждает');
  const p1 = (await call('POST', `/api/x/${secA}/story`, { action: 'propose', hash: h })).json.exchange;
  assert.equal(p1.story.me, 'agreed'); assert.equal(p1.story.ready, false, 'до второго согласия — только карта');
  const bB = (await call('GET', '/api/bell', null, { visitor: VB })).json;
  assert.ok(bB.items.some((n) => n.kind === 'story_proposed'), 'Б: «Тебе предложили поделиться в сторис»');
  assert.ok(!(await call('GET', '/api/bell', null, { visitor: VA })).json.items.some((n) => n.kind === 'story_proposed'), 'своё предложение себя не уведомляет');
  const p2 = (await call('POST', `/api/x/${p1.story.otherDoor}/story`, { action: 'agree', hash: h }, { visitor: VB })).json.exchange;
  assert.equal(p2.story.ready, true, 'два согласия — можно сохранить сторис');
  assert.ok((await call('GET', '/api/bell', null, { visitor: VA })).json.items.some((n) => n.kind === 'story_agreed'), 'А: «Друг согласился»');
  assert.equal(await total(), t0 + 1, 'сторис и согласия счётчик не меняют');
  // второй независимый обмен с той же картой — честно ещё один выбор; два приглашения видны списком
  const x2 = (await call('POST', '/api/exchanges', { code, text: 'Второй раз', clientKey: 'k2' }, { visitor: VA })).json;
  await call('POST', `/api/x/${x2.invite}/answer`, { text: 'ответ два' }, { visitor: VC });
  assert.equal(await total(), t0 + 2, 'две независимые пары — 2');
  assert.equal((await call('GET', `/api/exchanges?card=${code}`, null, { visitor: VA })).json.exchanges.length, 2);
  // вход гостя: обмены и колокольчик переходят в аккаунт
  const u = await emailLogin('guest-a@example.org', 'Аня');
  const cl = await call('POST', '/api/me/claim', null, { cookie: u.cookie, visitor: VA });
  assert.ok(cl.json.exchanges >= 2 && cl.json.notifications >= 1);
  assert.equal((await call('GET', '/api/exchanges', null, { cookie: u.cookie })).json.exchanges.length, 2, 'на другом устройстве после входа');
  assert.equal((await call('GET', '/api/bell', null, { visitor: VA })).json.items.length, 0, 'у гостя этого браузера больше не показывается');
  // прочтение
  const bu = (await call('GET', '/api/bell', null, { cookie: u.cookie })).json;
  assert.ok(bu.unread > 0, 'открытие списка не помечает прочитанным');
  await call('POST', '/api/bell/read', { all: true }, { cookie: u.cookie });
  assert.equal((await call('GET', '/api/bell', null, { cookie: u.cookie })).json.unread, 0, '«Отметить все как прочитанные»');
});

test('Счётчик в играх: одна карта на всех — 1 на раунд, двадцать телефонов — 1; своя карта — по одной; пары — замена на месте', async () => {
  const D = (i) => `device-cnt-${String(i).padStart(4, '0')}-abc`;
  const act = (c, i, action, body = {}) => call('POST', `/api/group/${c}/act`, { deviceId: D(i), action, ...body });
  const st = (c, i) => call('GET', `/api/group/${c}/state?device=${D(i)}`).then((r) => r.json);
  const tot = async (code) => (await call('GET', `/api/cards/${code}`)).json.selectedCount;
  let c = (await call('POST', '/api/group', { format: 'one', deviceId: D(1), name: 'В' })).json.code;
  for (let i = 2; i <= 20; i++) await call('POST', `/api/group/${c}/join`, { deviceId: D(i), name: 'И' + i });
  await act(c, 1, 'start'); await act(c, 1, 'start');
  const card = (await st(c, 7)).card.code; const before = await tot(card);
  for (let i = 1; i <= 20; i++) await st(c, i); // все телефоны открыли карту
  assert.equal(await tot(card), before, 'просмотр с двадцати телефонов ничего не добавляет');
  // «Другая карта» сразу — замена в том же раунде
  await act(c, 1, 'next_card'); const card2 = (await st(c, 2)).card.code;
  assert.equal(await tot(card), before - 1, 'замена: первая карта больше не считается'); assert.ok(await tot(card2) >= 1);
  // своя карта: по одной на показанную карту каждого
  c = (await call('POST', '/api/group', { format: 'own', deviceId: D(1), name: 'В' })).json.code;
  await call('POST', `/api/group/${c}/join`, { deviceId: D(2), name: 'Б' });
  await act(c, 1, 'start'); const g = (await st(c, 1)).gallery;
  const k = g[5].code; const k0 = await tot(k);
  await act(c, 1, 'pick', { code: g[4].code }); await act(c, 1, 'pick', { code: k }); await act(c, 2, 'pick', { code: k });
  assert.equal(await tot(k), k0, 'до раскрытия — не считается');
  await act(c, 1, 'reveal'); await act(c, 1, 'reveal');
  assert.equal(await tot(k), k0 + 2, 'двое выбрали одну карту — 2; передумавший учтён только финальной картой');
  await act(c, 2, 'spot', { on: true }); await act(c, 2, 'spot', { on: false });
  assert.equal(await tot(k), k0 + 2, 'общий показ не добавляет');
  // история по кругу — без выборов
  c = (await call('POST', '/api/group', { format: 'story', deviceId: D(1), name: 'В' })).json.code;
  await act(c, 1, 'start'); const sc = (await st(c, 1)).cards[0].code; const s0 = await tot(sc); await act(c, 1, 'next_card');
  assert.equal(await tot(sc), s0, 'история по кругу не даёт выборов');
  // игра своей подборкой
  const codes = g.slice(0, 3).map((x) => x.code);
  c = (await call('POST', '/api/group', { format: 'own', deviceId: D(1), name: 'В', codes })).json.code;
  await act(c, 1, 'start'); assert.deepEqual((await st(c, 1)).gallery.map((x) => x.code).sort(), [...codes].sort(), 'карты из своей подборки');
});

test('Личное: заметки, избранное, подборки; перенос гостя без дублей; чужой аккаунт не видит', async () => {
  const u = await emailLogin('notes@example.org', 'Заметки');
  const cards = (await call('GET', '/api/cards')).json.cards.filter((c) => !c.isDemo);
  const [c1, c2] = [cards[0].code, cards[1].code];
  await call('PUT', `/api/me/notes/${c1}`, { text: 'Своё' }, { cookie: u.cookie });
  await call('POST', '/api/me/collections/favorites/cards', { code: c1 }, { cookie: u.cookie });
  const m = await call('POST', '/api/me/merge', { notes: { [c1]: { text: 'С телефона' }, [c2]: { text: 'Новая' } }, favorites: [c1, c2], collections: [{ title: 'Для мамы', codes: [c1, c2, c2] }] }, { cookie: u.cookie });
  assert.equal(m.status, 200);
  const s = (await call('GET', '/api/me/personal', null, { cookie: u.cookie })).json;
  assert.ok(s.notes[c1].text.includes('Своё') && s.notes[c1].text.includes('С телефона'), 'разные заметки не перезаписаны');
  assert.equal(s.notes[c2].text, 'Новая');
  assert.deepEqual(s.collections.find((x) => x.favorites).codes, [c1, c2], 'избранное без дублей');
  assert.deepEqual(s.collections.find((x) => x.title === 'Для мамы').codes, [c1, c2]);
  await call('POST', '/api/me/merge', { favorites: [c1], collections: [{ title: 'Для мамы', codes: [c1] }] }, { cookie: u.cookie });
  assert.equal((await call('GET', '/api/me/personal', null, { cookie: u.cookie })).json.collections.length, 2, 'повторный перенос не плодит подборки');
  const other = await emailLogin('other@example.org', 'Другой');
  const o = (await call('GET', '/api/me/personal', null, { cookie: other.cookie })).json;
  assert.equal(Object.keys(o.notes).length, 0); assert.equal(o.collections.length, 1, 'у другого — только своё пустое «Избранное»');
  const col = s.collections.find((x) => x.title === 'Для мамы').id;
  assert.equal((await call('PATCH', `/api/me/collections/${col}`, { title: 'Чужое' }, { cookie: other.cookie })).status, 404);
});

test('Колокольчик по ролям: художник, куратор, администратор, фасилитатор, участник; задачи закрываются; без утечек', async () => {
  const bellOf = (cookie) => call('GET', '/api/bell', null, { cookie }).then((r) => r.json.items);
  const sub = await call('POST', '/api/artist/works', null, { cookie: artist.cookie, form: await form({ termsAccepted: 'true', termsVersion: 'draft-2026-11-11' }, [['images', await png('#246'), 'n.png']]) });
  const wid = sub.json.ids[0];
  assert.ok((await bellOf(curatorU.cookie)).some((n) => n.kind === 'curator_queue' && /очереди: \d+/.test(n.body)), 'куратору — одна обновляемая запись об очереди');
  assert.ok(!(await bellOf(visitor.cookie)).some((n) => n.kind === 'curator_queue'), 'участнику — нет');
  // возврат — задачи администратору нет
  const sub2 = await call('POST', '/api/artist/works', null, { cookie: artist.cookie, form: await form({ termsAccepted: 'true', termsVersion: 'draft-2026-11-11' }, [['images', await png('#642'), 'r.png']]) });
  await call('POST', `/api/curation/works/${sub2.json.ids[0]}/decide`, { action: 'return', criteria: [1] }, { cookie: curatorU.cookie });
  assert.ok(!(await bellOf(owner.cookie)).some((n) => n.kind === 'admin_recommendation' && n.body.includes(`№${sub2.json.ids[0]}`)), 'возврат не создаёт администратору задачу');
  assert.ok((await bellOf(artist.cookie)).some((n) => n.kind === 'work_returned'), 'художнику — «Работа возвращена»');
  await call('POST', `/api/curation/works/${wid}/decide`, { action: 'recommend' }, { cookie: curatorU.cookie });
  const rec = (await bellOf(owner.cookie)).find((n) => n.kind === 'admin_recommendation' && n.body.includes(`№${wid}`));
  assert.ok(rec && !rec.resolved, 'администратору — «Иллюстрацию рекомендуют к публикации»');
  await call('POST', `/api/admin/works/${wid}/decide`, { action: 'publish' }, { cookie: owner.cookie });
  assert.ok((await bellOf(owner.cookie)).find((n) => n.id === rec.id).resolved, 'после решения задача показывает итог');
  assert.ok((await bellOf(artist.cookie)).some((n) => n.kind === 'work_published'), 'художнику — «Работа опубликована» после решения администратора');
  // чат: ответ и упоминание — одна запись; обычное сообщение — ничего
  const m1 = await call('POST', '/api/chats/general', { text: 'Привет всем' }, { cookie: visitor.cookie });
  await call('POST', '/api/chats/general', { text: 'Просто так' }, { cookie: facil.cookie });
  const vb0 = (await bellOf(visitor.cookie)).filter((n) => n.kind === 'chat').length;
  await call('POST', '/api/chats/general', { text: 'Ответ и упоминание', replyTo: String(m1.json.id), mentions: String(visitor.user.id) }, { cookie: facil.cookie });
  assert.equal((await bellOf(visitor.cookie)).filter((n) => n.kind === 'chat').length, vb0 + 1, 'ответ + упоминание — одна запись');
  // заявка куратора → администратору; решение → заявителю
  const ap = await emailLogin('want-cur@example.org', 'Хочу');
  await call('POST', '/api/curator/application', { name: 'Хочу', contact: 'tg', motivation: 'нравится' }, { cookie: ap.cookie });
  assert.ok((await bellOf(owner.cookie)).some((n) => n.kind === 'admin_application' && !n.resolved), 'администратору — новая заявка');
  assert.ok(!(await bellOf(curatorU.cookie)).some((n) => n.kind === 'admin_application'), 'куратору чужие заявки не видны');
  await call('POST', `/api/admin/curator-applications/${ap.user.id}/decide`, { approve: true }, { cookie: owner.cookie });
  const an = (await bellOf(ap.cookie)).find((n) => n.kind === 'application');
  assert.ok(an && an.url === '/curator', 'одобрение — ведёт в открывшийся кабинет');
});


test('19.11: раунды разговора, отдельный обмен, превью без ответов, аналитика по этапам', async () => {
  const VA = 'visitor-r1aa-0000-1111-2222'; const VB = 'visitor-r1bb-0000-1111-2222'; const VC = 'visitor-r1cc-0000-1111-2222';
  const codes = (await call('GET', '/api/cards')).json.cards.filter((c) => !c.isDemo).map((c) => c.code);
  const x = (await call('POST', '/api/exchanges', { code: codes[3], text: 'Первый раунд', name: 'Аня', clientKey: 'r1' }, { visitor: VA })).json;
  assert.equal((await call('POST', `/api/x/${x.invite}/sent`, { via: 'tg' }, { visitor: VB })).json.error, 'forbidden', 'отметку отправки ставит только отправитель');
  await call('POST', `/api/x/${x.secret}/sent`, { via: 'tg' });
  // превью мессенджера: картинка карты и вопрос, ни ответов, ни имени; не считается открытием
  const html = await fetch(base + `/x/${x.invite}`, { headers: { 'User-Agent': 'TelegramBot (like TwitterBot)' } }).then((r) => r.text());
  assert.ok(html.includes('og:image') && html.includes(`/og/${codes[3]}.jpg`) && html.includes('Что тебе откликается в этой карте?'));
  assert.ok(!html.includes('Первый раунд') && !html.includes('Аня'), 'в превью нет ответа и имени');
  const img = await fetch(base + `/og/${codes[3]}.jpg`); assert.equal(img.status, 200); assert.match(img.headers.get('content-type'), /jpeg/);
  await fetch(base + `/api/x/${x.invite}`, { headers: { 'User-Agent': 'WhatsApp/2.23', 'X-DC-Visitor': VC } });
  await call('GET', `/api/x/${x.invite}`, null, { visitor: VA }); // сам отправитель
  let st = (await call('GET', '/api/admin/exchange-stats', null, { cookie: owner.cookie })).json;
  const opened0 = st.personal.all.opened;
  await call('GET', `/api/x/${x.invite}`, null, { visitor: VB }); await call('GET', `/api/x/${x.invite}`, null, { visitor: VB });
  st = (await call('GET', '/api/admin/exchange-stats', null, { cookie: owner.cookie })).json;
  assert.equal(st.personal.all.opened, opened0 + 1, 'открытие человеком — один раз; превью и сам отправитель не считаются');
  await call('POST', `/api/x/${x.invite}/answer`, { text: 'Ответ Б', name: 'Борис', answerKey: 'ra' }, { visitor: VB });
  const vb = (await call('GET', `/api/x/${x.invite}`, null, { visitor: VB })).json;
  // Твоя очередь: Б отвечает своей картой — следующий раунд того же разговора, Аня получает в колокольчик
  const r2 = await call('POST', `/api/x/${vb.secret}/reply`, { code: codes[4], text: 'Раунд два', clientKey: 'rb' }, { visitor: VB });
  assert.equal(r2.status, 201);
  const bellA = (await call('GET', '/api/bell', null, { visitor: VA })).json.items.find((n) => n.kind === 'exchange_round');
  assert.ok(bellA, 'Ане — «Тебе прислали ответную карту»');
  const inv2 = (await call('GET', bellA.url.replace('/x/', '/api/x/'), null, { visitor: VA })).json;
  assert.equal(inv2.role, 'invitee'); assert.equal(inv2.round, 2); assert.ok(!JSON.stringify(inv2).includes('Раунд два'), 'новый раунд — свой скрытый текст');
  const ans2 = (await call('POST', `/api/x/${r2.json.invite}/answer`, { text: 'Ответ Ани во втором', answerKey: 'rc' }, { visitor: VA })).json.exchange;
  assert.equal(ans2.rounds.length, 2, 'у участника видны оба раунда разговора');
  assert.ok((await call('GET', '/api/exchanges', null, { visitor: VA })).json.exchanges.every((e) => e.conv === x.id), 'оба — один разговор');
  // Б отправляет исходную карту третьему — отдельный обмен без доступа к прежним ответам
  const f = (await call('POST', '/api/exchanges', { code: codes[3], text: 'Новому человеку', origin: 'forward', clientKey: 'rf' }, { visitor: VB })).json;
  await call('POST', `/api/x/${f.secret}/sent`, { via: 'copy' });
  const vc = (await call('GET', `/api/x/${f.invite}`, null, { visitor: VC })).json;
  assert.ok(!JSON.stringify(vc).includes('Первый раунд') && !JSON.stringify(vc).includes('Ответ Б'), 'третий не видит прежние ответы');
  st = (await call('GET', '/api/admin/exchange-stats', null, { cookie: owner.cookie })).json;
  assert.ok(st.personal.reply.created >= 1 && st.personal.forward.created >= 1, 'ответная карта и независимое приглашение — раздельно');
  assert.ok(st.onwardNew >= 1, 'ответивший отправил своё приглашение (ответ следующего не нужен)');
  assert.ok(st.personal.all.sent >= 2 && st.days === 30);
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

// ---------- «Посмотреть демо»: данные создаются сами, демо-встреча не шлёт писем ----------
test('Демо: первый вход создаёт тестовую встречу с местами, подборку и работу в очереди', async () => {
  const adm = await call('POST', '/api/demo/login', { as: 'admin' });
  await call('POST', '/api/admin/demo/clear', null, { cookie: adm.cookie });
  const fac = await call('POST', '/api/demo/login', { as: 'facilitator' });
  const mts = (await call('GET', '/api/fac/meetings', null, { cookie: fac.cookie })).json.meetings;
  const now = new Date().toISOString();
  const open = mts.flatMap((m) => m.dates).find((d) => d.startsAt > now && d.left > 0);
  assert.ok(open, 'есть будущая демо-дата со свободными местами');
  assert.ok((await call('GET', '/api/collections', null, { cookie: fac.cookie })).json.collections.some((c) => c.isDemo), 'есть сохранённая демо-подборка');
  const cur = await call('POST', '/api/demo/login', { as: 'curator' });
  const q = await call('GET', '/api/curation/queue', null, { cookie: cur.cookie });
  assert.ok(JSON.stringify(q.json).includes('"isDemo":true'), 'в очереди куратора есть демо-работа');
  const reg = await call('POST', `/api/meetings/dates/${open.id}/register`, { name: 'Гость', email: 'guest@example.org' }, { cookie: fac.cookie });
  assert.equal(reg.status, 201);
  assert.equal(reg.json.isDemo, true);
  assert.equal(reg.json.letter.sent, false, 'демо-встреча: письмо не отправляется');
  assert.equal((await call('GET', '/api/meetings/places')).json.places.some((p) => p.country === 'Таиланд'), false, 'демо скрыто от посетителей');
});

// ---------- местное время города встречи ----------
test('Встреча: пояс определяется по городу, время сохраняется местным для города, откуда бы её ни создавали', async () => {
  const r1 = await call('GET', '/api/places/resolve?city=' + encodeURIComponent('Чиангмай'), null, { cookie: facil.cookie });
  assert.equal(r1.json.status, 'ok');
  assert.equal(r1.json.place.timezone, 'Asia/Bangkok');
  assert.equal(r1.json.place.country, 'Таиланд', 'страна подставляется по городу');
  const amb = await call('GET', '/api/places/resolve?city=Springfield', null, { cookie: facil.cookie });
  assert.equal(amb.json.status, 'ambiguous', 'несколько городов с разными поясами — просим уточнить');
  assert.ok(amb.json.options.length >= 2);
  assert.equal((await call('GET', '/api/places/resolve?city=' + encodeURIComponent('Неведомск'), null, { cookie: facil.cookie })).json.status, 'not_found');
  assert.equal((await call('GET', '/api/places/resolve?city=' + encodeURIComponent('Пай') + '&country=' + encodeURIComponent('Таиланд'), null, { cookie: facil.cookie })).json.place.timezone, 'Asia/Bangkok', 'небольшой город в стране с одним поясом');
  // Фасилитатор из Нью-Йорка: браузер прислал бы свой пояс — сервер его не использует.
  const day = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const c = await call('POST', '/api/fac/meetings', { title: 'Вечер в Чиангмае', city: 'Чиангмай', country: '', venue: 'Ниммань', language: 'ru',
    timezone: 'America/New_York', priceType: 'free', capacity: 8, firstDate: `${day}T16:30`, repeatWeekly: 1 }, { cookie: facil.cookie });
  assert.equal(c.status, 201);
  const ed = (await call('GET', `/api/fac/meetings/${c.json.id}`, null, { cookie: facil.cookie })).json;
  assert.equal(ed.timezone, 'Asia/Bangkok');
  assert.equal(ed.country, 'Таиланд');
  assert.equal(ed.dates[0].startsAt, `${day}T09:30:00.000Z`, '16:30 в Чиангмае = 09:30 UTC');
  const pub = (await call('GET', `/api/meetings/dates/${ed.dates[0].id}`)).json;
  assert.equal(new Intl.DateTimeFormat('ru-RU', { timeZone: pub.meeting.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(pub.startsAt)), '16:30', 'участники видят 16:30');
  // Повтор: город исходной встречи, новая дата
  const day2 = new Date(Date.now() + 24 * 86400000).toISOString().slice(0, 10);
  const rep = await call('POST', '/api/fac/meetings', { title: ed.title, city: ed.city, country: ed.country, venue: ed.venue, language: ed.language, priceType: ed.priceType,
    capacity: ed.capacity, sameAs: ed.id, firstDate: `${day2}T16:30` }, { cookie: facil.cookie });
  const repEd = (await call('GET', `/api/fac/meetings/${rep.json.id}`, null, { cookie: facil.cookie })).json;
  assert.equal(repEd.timezone, 'Asia/Bangkok');
  assert.equal(repEd.dates[0].startsAt, `${day2}T09:30:00.000Z`);
  // Сменили город на Москву: будущая дата остаётся «16:30», но уже по Москве
  const up = await call('PUT', `/api/fac/meetings/${c.json.id}`, { ...ed, city: 'Москва', country: '' }, { cookie: facil.cookie });
  assert.equal(up.status, 200);
  const moved = (await call('GET', `/api/fac/meetings/${c.json.id}`, null, { cookie: facil.cookie })).json;
  assert.equal(moved.timezone, 'Europe/Moscow');
  assert.equal(moved.dates[0].startsAt, `${day}T13:30:00.000Z`, '16:30 в Москве = 13:30 UTC');
  for (const id of [c.json.id, rep.json.id]) await call('POST', `/api/fac/meetings/${id}/publish`, { published: false }, { cookie: facil.cookie });
});

// ---------- единый счётчик «Выбрали для обсуждения» ----------
test('Счётчик выборов: библиотека и подборки дают одно число; автор, демо и обновление страницы его не меняют', async () => {
  const db = require('../server/db');
  const code = 'DC-0007';
  const total = async () => (await call('GET', `/api/cards/${code}`)).json.selectedCount;
  const t0 = await total();
  // Подборка фасилитатора с этой картой
  const cid = (await call('POST', '/api/collections', { title: 'Счётчик' }, { cookie: facil.cookie })).json.id;
  await call('PUT', `/api/collections/${cid}/cards`, { codes: [code, 'DC-0008'] }, { cookie: facil.cookie });
  const cslug = (await call('GET', `/api/collections/${cid}`, null, { cookie: facil.cookie })).json.slug;
  const vLib = 'l'.repeat(32); const vCol = 'c'.repeat(32);
  // 1. Другой участник выбирает карту в библиотеке (сценарий «Вдвоём»)
  const lib = await call('POST', `/api/cards/${code}/choose`, { visitorId: vLib });
  assert.equal(lib.json.selectedCount, t0 + 1, 'выбор из библиотеки прибавляет один');
  assert.equal((await call('POST', `/api/cards/${code}/choose`, { visitorId: vLib })).json.selectedCount, t0 + 1, 'повторное нажатие не добавляет');
  assert.equal((await call('GET', `/api/cards/${code}?visitor=${vLib}`)).json.chosenByMe, true, 'после обновления страницы выбор виден, число то же');
  assert.equal(await total(), t0 + 1);
  // 2. Участник выбирает ту же карту в подборке
  await call('POST', `/api/c/${cslug}/visit`, { visitorId: vCol });
  const sel = await call('POST', `/api/c/${cslug}/select`, { visitorId: vCol, code, round: 1 });
  assert.equal(sel.json.counts[code], t0 + 2, 'в подборке видно общее число');
  await call('POST', `/api/c/${cslug}/select`, { visitorId: vCol, code, round: 1 });
  await call('POST', `/api/c/${cslug}/visit`, { visitorId: vCol });
  assert.equal(await total(), t0 + 2, 'в библиотеке то же общее число; повтор и обновление не добавляют');
  const inEditor = (await call('GET', `/api/collections/${cid}`, null, { cookie: facil.cookie })).json.cards.find((c) => c.code === code);
  assert.equal(inEditor.selectedCount, t0 + 2, 'в подборке фасилитатора — то же число');
  // 3. Автор выбирает свою карту: выбор сохраняется, число не меняется
  const prevArtist = db.prepare('SELECT artist_id FROM cards WHERE code = ?').get(code).artist_id;
  db.prepare('UPDATE cards SET artist_id = ? WHERE code = ?').run(artist.user.id, code);
  const own = await call('POST', `/api/cards/${code}/choose`, { visitorId: 'o'.repeat(32) }, { cookie: artist.cookie });
  assert.equal(own.json.chosen, true);
  assert.equal(own.json.notCounted, 'own_card');
  const ownCol = await call('POST', `/api/c/${cslug}/select`, { visitorId: 'p'.repeat(32), code, round: 1 }, { cookie: artist.cookie });
  assert.equal(ownCol.json.notCounted, 'own_card');
  assert.deepEqual(ownCol.json.selections.map((x) => [x.code, x.notCounted]), [[code, 'own_card']], 'выбор автора сохранён — подсказки показываются');
  assert.equal(await total(), t0 + 2, 'выбор автором своей карты не увеличивает число');
  // гость без входа на том же устройстве: авторство не определить — обычные правила
  // 4. Демо-выбор
  const demoGuest = await call('POST', '/api/demo/login', { as: 'guest' });
  assert.equal((await call('POST', `/api/cards/${code}/choose`, { visitorId: 'd'.repeat(32) }, { cookie: demoGuest.cookie })).json.notCounted, 'demo');
  await call('POST', `/api/c/${cslug}/select`, { visitorId: 'e'.repeat(32), code, round: 1 }, { cookie: demoGuest.cookie });
  assert.equal(await total(), t0 + 2, 'демо-выборы вне общей статистики');
  // 5. Отмена выбора в библиотеке
  assert.equal((await call('POST', `/api/cards/${code}/unchoose`, { visitorId: vLib })).json.selectedCount, t0 + 1);
  db.prepare('UPDATE cards SET artist_id = ? WHERE code = ?').run(prevArtist, code);
});

test('Администратор привязывает карты к аккаунту автора — после этого сервер узнаёт автора', async () => {
  const users = (await call('GET', '/api/admin/users', null, { cookie: owner.cookie })).json.users;
  const seed = users.find((u) => u.cardCount >= 40);
  assert.ok(seed, 'у служебной записи первой колоды 40 карт');
  const adm = await call('POST', '/api/demo/login', { as: 'admin' });
  assert.equal((await call('POST', `/api/admin/users/${seed.id}/transfer-cards`, { to: artist.user.id }, { cookie: adm.cookie })).status, 403, 'демо-админ не может');
  const t = await call('POST', `/api/admin/users/${seed.id}/transfer-cards`, { to: artist.user.id }, { cookie: owner.cookie });
  assert.ok(t.json.moved >= 40);
  const before = (await call('GET', '/api/cards/DC-0001')).json.selectedCount;
  assert.equal((await call('POST', '/api/cards/DC-0001/choose', { visitorId: 'q'.repeat(32) }, { cookie: artist.cookie })).json.notCounted, 'own_card');
  assert.equal((await call('GET', '/api/cards/DC-0001')).json.selectedCount, before);
  await call('POST', `/api/admin/users/${artist.user.id}/transfer-cards`, { to: seed.id }, { cookie: owner.cookie });
});

// ---------- заявка на роль куратора и запрос печатной колоды ----------
test('Заявка куратора доходит до администратора, одобрение выдаёт роль; запрос печатной колоды; права', async () => {
  const cand = await emailLogin('cand.curator@example.org', 'Кандидат');
  assert.equal((await call('POST', '/api/curator/application', { name: 'К', contact: 'tg', motivation: 'x' })).status, 401, 'без входа нельзя');
  assert.equal((await call('POST', '/api/curator/application', { name: 'Кандидат', contact: '', motivation: 'хочу' }, { cookie: cand.cookie })).json.error, 'contact_required');
  assert.equal((await call('POST', '/api/curator/application', { name: 'Кандидат', contact: '@cand', motivation: '' }, { cookie: cand.cookie })).json.error, 'motivation_required');
  assert.equal((await call('POST', '/api/curator/application', { name: 'Кандидат', contact: '@cand', motivation: 'Люблю иллюстрации' }, { cookie: cand.cookie })).status, 201);
  assert.equal((await call('POST', '/api/curator/application', { name: 'Кандидат', contact: '@cand', motivation: 'ещё' }, { cookie: cand.cookie })).json.error, 'already_submitted');
  assert.equal((await call('GET', '/api/admin/curator-applications', null, { cookie: cand.cookie })).status, 403, 'заявки видит только администратор');
  const list = (await call('GET', '/api/admin/curator-applications', null, { cookie: owner.cookie })).json.applications;
  const mine = list.find((a) => a.userId === cand.user.id);
  assert.ok(mine && mine.status === 'submitted' && mine.contact === '@cand' && mine.motivation === 'Люблю иллюстрации', 'заявка у администратора');
  assert.equal((await call('GET', '/api/curation/queue', null, { cookie: cand.cookie })).status, 403, 'кабинет куратора закрыт до одобрения');
  assert.equal((await call('POST', `/api/admin/curator-applications/${cand.user.id}/decide`, { approve: true }, { cookie: cand.cookie })).status, 403);
  assert.equal((await call('POST', `/api/admin/curator-applications/${cand.user.id}/decide`, { approve: true, note: 'Добро пожаловать' }, { cookie: owner.cookie })).status, 200);
  assert.equal((await call('GET', '/api/curation/queue', null, { cookie: cand.cookie })).status, 200, 'после одобрения кабинет открыт');
  assert.equal((await call('GET', '/api/curator/application', null, { cookie: cand.cookie })).json.isCurator, true);
  // запрос печатной колоды: фасилитатор отправляет, видит администратор; печатный отбор фасилитатору недоступен
  assert.equal((await call('POST', '/api/fac/print-request', { note: '2 колоды' }, { cookie: cand.cookie })).status, 403, 'только фасилитатор');
  assert.equal((await call('POST', '/api/fac/print-request', { note: '2 колоды для встречи в Казани' }, { cookie: facil.cookie })).status, 201);
  assert.equal((await call('POST', '/api/fac/print-request', { note: 'ещё' }, { cookie: facil.cookie })).json.already, true, 'повторно не дублируется');
  const reqs = (await call('GET', '/api/admin/print-requests', null, { cookie: owner.cookie })).json.requests;
  assert.ok(reqs.some((r) => r.note === '2 колоды для встречи в Казани'));
  assert.equal((await call('GET', '/api/print', null, { cookie: facil.cookie })).status, 403, 'фасилитатор не отбирает карты для печати');
  assert.equal((await call('GET', '/api/print', null, { cookie: artist.cookie })).status, 200, 'доступ художника сохранён');
});

// ---------- 14.11: длительность, одновременная запись, руководство фасилитатора ----------
test('Встреча: длительность и время окончания, одновременная запись на последнее место, повтор отправки', async () => {
  const day = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
  assert.equal((await call('POST', '/api/fac/meetings', { title: 'Длинная', city: 'Казань', language: 'ru', priceType: 'free', capacity: 2, durationMin: 5, firstDate: `${day}T18:00` }, { cookie: facil.cookie })).json.error, 'bad_duration', 'окончание должно быть позже начала (мин. 15 мин)');
  const c = await call('POST', '/api/fac/meetings', { title: 'Два места', city: 'Казань', language: 'ru', priceType: 'free', capacity: 2, durationMin: 90, firstDate: `${day}T18:00` }, { cookie: facil.cookie });
  assert.equal(c.status, 201);
  const ed = (await call('GET', `/api/fac/meetings/${c.json.id}`, null, { cookie: facil.cookie })).json;
  assert.equal(ed.durationMin, 90);
  const dateId = ed.dates[0].id;
  const pub = (await call('GET', `/api/meetings/dates/${dateId}`)).json;
  assert.equal(pub.endsAt, `${day}T16:30:00.000Z`, '18:00 + 1 ч 30 мин в Москве = 16:30 UTC');
  // пять человек одновременно на два места — записаны ровно двое
  const rs = await Promise.all([1, 2, 3, 4, 5].map((i) => call('POST', `/api/meetings/dates/${dateId}/register`, { name: 'Гость ' + i, email: `g${i}@example.org` })));
  assert.equal(rs.filter((r) => r.status === 201).length, 2);
  assert.ok(rs.filter((r) => r.status !== 201).every((r) => r.json.error === 'full'));
  assert.equal((await call('GET', `/api/meetings/dates/${dateId}`)).json.left, 0);
  // повторная отправка той же формы не создаёт вторую запись
  const ok1 = rs.find((r) => r.status === 201);
  const ics = await (await fetch(`${base}/api/registrations/${ok1.json.token}/ics`)).text();
  assert.match(ics, new RegExp(`DTEND:${day.replace(/-/g, '')}T163000Z`), 'в календаре есть время окончания');
  await call('POST', `/api/registrations/${ok1.json.token}/cancel`);
  const again = await call('POST', `/api/meetings/dates/${dateId}/register`, { name: 'Гость 9', email: 'g9@example.org' });
  assert.equal(again.status, 201);
  assert.equal((await call('POST', `/api/meetings/dates/${dateId}/register`, { name: 'Гость 9', email: 'g9@example.org' })).json.error, 'full');
  await call('POST', `/api/fac/meetings/${c.json.id}/publish`, { published: false }, { cookie: facil.cookie });
});

/** Простейший .docx (zip без сжатия) с document.xml — для проверки загрузки руководства. */
function tinyDocx(xml) {
  const name = Buffer.from('word/document.xml'); const data = Buffer.from(xml);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(0, 42);
  const body = Buffer.concat([local, name, data]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(cen.length + name.length, 12); end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, cen, name, end]);
}
test('Руководство фасилитатора: администратор загружает .docx, главы курса с текстом, отметка «прочитано» отдельно', async () => {
  const para = (style, text) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;
  let xml = para('Title', 'Dialogue Flow');
  for (let i = 1; i <= 8; i++) xml += para('Heading1', `Глава ${i}. Тестовая глава`) + para('Heading2', 'Раздел') + para('', `Текст главы ${i} &amp; пример`);
  xml += para('Heading1', 'Приложения') + para('', 'Чек-лист');
  const doc = tinyDocx(`<w:document><w:body>${xml}</w:body></w:document>`);
  const fd = () => { const f = new FormData(); f.append('file', new Blob([doc]), 'guide.docx'); return f; };
  assert.equal((await call('POST', '/api/admin/guide', null, { cookie: facil.cookie, form: fd() })).status, 403, 'только администратор');
  const adm = await call('POST', '/api/demo/login', { as: 'admin' });
  assert.equal((await call('POST', '/api/admin/guide', null, { cookie: adm.cookie, form: fd() })).status, 403, 'демо-администратор не может');
  const bad = new FormData(); bad.append('file', new Blob([Buffer.from('not a zip')]), 'x.docx');
  assert.equal((await call('POST', '/api/admin/guide', null, { cookie: owner.cookie, form: bad })).json.error, 'bad_docx');
  const up = await call('POST', '/api/admin/guide', null, { cookie: owner.cookie, form: fd() });
  assert.equal(up.status, 201); assert.equal(up.json.chapters, 8); assert.equal(up.json.extra, 1);
  const cand = await emailLogin('future.fac@example.org', 'Будущий фасилитатор');
  const app = (await call('GET', '/api/fac/application', null, { cookie: cand.cookie })).json;
  assert.equal(app.guideMissing, false);
  assert.equal(app.course[0], 'Глава 1. Тестовая глава');
  assert.equal(app.chapters[2][1].text, 'Текст главы 3 & пример', 'текст главы доступен для чтения');
  assert.equal(app.extra[0].title, 'Приложения');
  await call('POST', '/api/fac/application', null, { cookie: cand.cookie });
  assert.deepEqual((await call('GET', '/api/fac/application', null, { cookie: cand.cookie })).json.application.courseDone, [], 'открытие курса не отмечает прочтение');
  await call('PUT', '/api/fac/application', { courseDone: [0, 1] }, { cookie: cand.cookie });
  assert.deepEqual((await call('GET', '/api/fac/application', null, { cookie: cand.cookie })).json.application.courseDone, [0, 1], 'прогресс сохраняется');
});

// ---------- вход общим аккаунтом сайта ----------
test('03: вход аккаунтом сайта — сессия проверяется у сайта, аккаунт создаётся и связывается', async () => {
  assert.equal((await call('POST', '/api/auth/site', { session: 'bad-session-token-xx' })).status, 401);
  const r1 = await call('POST', '/api/auth/site', { session: 'good-session-token-1' });
  assert.equal(r1.status, 200);
  assert.equal(r1.json.user.name, 'Майя');
  assert.equal(r1.json.user.email, 'maya@example.org');
  const r2 = await call('POST', '/api/auth/site', { session: 'good-session-token-1' });
  assert.equal(r2.json.user.id, r1.json.user.id, 'повторный вход — тот же пользователь');
  const me = await call('GET', '/api/me', null, { cookie: r1.cookie });
  assert.equal(me.json.user.id, r1.json.user.id);
  assert.equal((await call('GET', '/api/config')).json.siteLogin, true);
});

test('Общение: непрочитанные, ответы и упоминания, доступ к закрытым, модерация с восстановлением и журналом', async () => {
  const dima = await emailLogin('dima-chat@example.org', 'Дима');
  const rooms0 = (await call('GET', '/api/chats', null, { cookie: dima.cookie })).json.rooms;
  assert.deepEqual(rooms0.map((r) => r.room), ['general'], 'обычному участнику доступен только общий чат');
  // куратор видит общий и закрытый, закрытый помечен
  const cr = (await call('GET', '/api/chats', null, { cookie: curatorU.cookie })).json.rooms;
  assert.ok(cr.some((r) => r.room === 'general') && cr.find((r) => r.room === 'curators').closed, 'куратор: общий и закрытый чат кураторов');
  const m1 = await call('POST', '/api/chats/general', { text: 'Всем привет, я Дима' }, { cookie: dima.cookie });
  assert.equal(m1.status, 201);
  // непрочитанное у куратора, после чтения — 0
  const unread = (c) => call('GET', '/api/chats', null, { cookie: c }).then((r) => r.json.rooms.find((x) => x.room === 'general').unread);
  assert.ok(await unread(curatorU.cookie) >= 1, 'непрочитанное у другого участника');
  assert.equal(await unread(dima.cookie), 0, 'своё сообщение не считается непрочитанным');
  await call('POST', '/api/chats/general/read', {}, { cookie: curatorU.cookie });
  assert.equal(await unread(curatorU.cookie), 0, 'после чтения непрочитанных нет');
  // ответ с упоминанием → у Димы непрочитанное с отметкой «для вас»
  const r2 = await call('POST', '/api/chats/general', { text: '@Дима привет!', replyTo: m1.json.id, mentions: String(dima.user.id) }, { cookie: curatorU.cookie });
  const g = (await call('GET', '/api/chats/general', null, { cookie: dima.cookie })).json;
  const msg = g.messages.find((m) => m.id === r2.json.id);
  assert.equal(msg.replyTo.id, m1.json.id); assert.equal(msg.mentions[0].id, dima.user.id);
  assert.equal(g.rooms.find((r) => r.room === 'general').mentions, 1, 'ответ/упоминание отмечены');
  // упомянуть в закрытом чате того, у кого нет доступа, нельзя
  const r3 = await call('POST', '/api/chats/curators', { text: 'секрет', mentions: String(dima.user.id) }, { cookie: curatorU.cookie });
  const cm = (await call('GET', '/api/chats/curators', null, { cookie: curatorU.cookie })).json.messages.find((m) => m.id === r3.json.id);
  assert.equal(cm.mentions.length, 0, 'постороннего нельзя упомянуть в закрытом чате');
  assert.equal((await call('GET', '/api/chats/curators', null, { cookie: dima.cookie })).status, 403, 'закрытый чат по прямому API — 403');
  // ответ в другой комнате на сообщение общего чата не принимается
  const r4 = await call('POST', '/api/chats/curators', { text: 'x', replyTo: m1.json.id }, { cookie: curatorU.cookie });
  assert.equal((await call('GET', '/api/chats/curators', null, { cookie: curatorU.cookie })).json.messages.find((m) => m.id === r4.json.id).replyTo, null);
  // модерация: участник не может скрыть чужое; администратор скрывает с причиной, видит текст, восстанавливает
  assert.equal((await call('DELETE', `/api/chats/general/messages/${m1.json.id}`, null, { cookie: curatorU.cookie })).status, 403);
  assert.equal((await call('DELETE', `/api/chats/general/messages/${m1.json.id}?reason=спам`, null, { cookie: owner.cookie })).json.moderated, true);
  const hid = (await call('GET', '/api/chats/general', null, { cookie: dima.cookie })).json.messages.find((m) => m.id === m1.json.id);
  assert.ok(hid.deleted && hid.moderated && hid.text === '' && hid.hiddenText === undefined, 'участник не видит скрытый текст');
  const hidA = (await call('GET', '/api/chats/general', null, { cookie: owner.cookie })).json.messages.find((m) => m.id === m1.json.id);
  assert.equal(hidA.hiddenText, 'Всем привет, я Дима', 'администратор видит исходный текст');
  assert.equal((await call('POST', `/api/chats/general/messages/${m1.json.id}/restore`, {}, { cookie: curatorU.cookie })).status, 403, 'восстановить может только администратор');
  assert.equal((await call('POST', `/api/chats/general/messages/${m1.json.id}/restore`, {}, { cookie: owner.cookie })).status, 200);
  const back = (await call('GET', '/api/chats/general', null, { cookie: dima.cookie })).json.messages.find((m) => m.id === m1.json.id);
  assert.equal(back.text, 'Всем привет, я Дима', 'автор и текст восстановлены без изменений');
  const log = (await call('GET', '/api/admin/chat-log', null, { cookie: owner.cookie })).json.log;
  assert.deepEqual(log.filter((l) => l.messageId === m1.json.id).map((l) => l.action), ['restore', 'hide']);
  assert.equal(log.find((l) => l.action === 'hide' && l.messageId === m1.json.id).reason, 'спам');
  // своё удалённое сообщение не восстанавливается
  const own = await call('POST', '/api/chats/general', { text: 'удалю' }, { cookie: dima.cookie });
  await call('DELETE', `/api/chats/general/messages/${own.json.id}`, null, { cookie: dima.cookie });
  assert.equal((await call('POST', `/api/chats/general/messages/${own.json.id}/restore`, {}, { cookie: owner.cookie })).status, 400);
});

test('Push: подписка по согласию, адресаты по ответам/упоминаниям/режиму чата, одно уведомление, права и выключение', async () => {
  const push = require('../server/push');
  const sent = [];
  push.setSender(async (sub, payload) => { sent.push({ endpoint: sub.endpoint, ...JSON.parse(payload) }); });
  const ann = await emailLogin('ann-push@example.org', 'Анна');
  const bob = await emailLogin('bob-push@example.org', 'Борис');
  const sub = (n) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${n}`, keys: { p256dh: 'BPk' + n, auth: 'au' + n } });
  assert.equal((await call('POST', '/api/push/subscribe', { subscription: { endpoint: 'http://bad' } }, { cookie: ann.cookie })).status, 400, 'неверная подписка');
  // только службы push браузеров
  for (const endpoint of ['https://push.example.org/x', 'https://127.0.0.1/x', 'https://fcm.googleapis.com.example.org/x', 'https://fcm.googleapis.com:8443/x', 'https://user@fcm.googleapis.com/x', 'https://push.apple.com.evil.org/x']) {
    assert.equal((await call('POST', '/api/push/subscribe', { subscription: { endpoint, keys: { p256dh: 'BPk', auth: 'au' } } }, { cookie: ann.cookie })).json.error, 'bad_subscription', endpoint);
  }
  assert.ok(push.pushEndpointOk('https://web.push.apple.com/abc') && push.pushEndpointOk('https://updates.push.services.mozilla.com/wpush/v2/x') && push.pushEndpointOk('https://wns2-par02p.notify.windows.com/w/?token=x'));
  assert.equal((await call('POST', '/api/push/subscribe', { subscription: sub('ann') }, { cookie: ann.cookie })).status, 200);
  assert.equal((await call('POST', '/api/push/subscribe', { subscription: sub('bob') }, { cookie: bob.cookie })).status, 200);
  // чужой адрес подписки без её ключа не переходит к другому человеку; с тем же ключом (тот же браузер) — переходит
  assert.equal((await call('POST', '/api/push/subscribe', { subscription: { endpoint: sub('ann').endpoint, keys: { p256dh: 'BPkX', auth: 'other' } } }, { cookie: bob.cookie })).json.error, 'bad_subscription');
  const pdb = require('../server/db');
  assert.equal(pdb.prepare('SELECT user_id FROM push_subscriptions WHERE endpoint = ?').get(sub('ann').endpoint).user_id, ann.user.id);
  assert.equal((await call('POST', '/api/push/subscribe', { subscription: sub('ann') }, { cookie: ann.cookie })).status, 200, 'повторная подписка того же человека');
  const st = (await call('GET', '/api/push', null, { cookie: ann.cookie })).json;
  assert.ok(st.publicKey && st.devices === 1 && st.prefs.replies && st.prefs.mentions, 'ключ VAPID, одно устройство, по умолчанию ответы и упоминания');
  const wait = () => new Promise((r) => setTimeout(r, 120));
  // обычное сообщение без ответа — никому (режим по умолчанию «Ответы и упоминания»)
  const a1 = await call('POST', '/api/chats/general', { text: 'Анна пишет в общий' }, { cookie: ann.cookie }); await wait();
  assert.equal(sent.length, 0, 'обычное сообщение не уведомляет при режиме по умолчанию');
  // ответ + упоминание одного человека → одно уведомление со ссылкой на сообщение
  const b1 = await call('POST', '/api/chats/general', { text: '@Анна да!', replyTo: a1.json.id, mentions: String(ann.user.id) }, { cookie: bob.cookie }); await wait();
  assert.equal(sent.length, 1, 'ответ и упоминание — одно уведомление');
  assert.ok(sent[0].endpoint.endsWith('/ann') && sent[0].url.endsWith(`/team/general?m=${b1.json.id}`) && sent[0].title.includes('Борис'), 'уведомление ведёт к конкретному сообщению');
  // выключили ответы и упоминания → ответ не приходит
  await call('PUT', '/api/push/prefs', { replies: false, mentions: false }, { cookie: ann.cookie });
  await call('POST', '/api/chats/general', { text: 'ещё ответ', replyTo: a1.json.id }, { cookie: bob.cookie }); await wait();
  assert.equal(sent.length, 1, 'категории выключены — уведомления нет');
  // режим «Все сообщения» для чата — приходит любое; «Без уведомлений» — ничего
  await call('PUT', '/api/chats/general/notify', { mode: 'all' }, { cookie: ann.cookie });
  await call('POST', '/api/chats/general', { text: 'просто новость' }, { cookie: bob.cookie }); await wait();
  assert.equal(sent.length, 2, '«Все сообщения» — уведомление о любом сообщении');
  await call('PUT', '/api/chats/general/notify', { mode: 'none' }, { cookie: ann.cookie });
  await call('PUT', '/api/push/prefs', { replies: true, mentions: true }, { cookie: ann.cookie });
  await call('POST', '/api/chats/general', { text: 'ответ в тихом чате', replyTo: a1.json.id }, { cookie: bob.cookie }); await wait();
  assert.equal(sent.length, 2, '«Без уведомлений» для чата — тишина');
  assert.equal((await call('PUT', '/api/chats/general/notify', { mode: 'loud' }, { cookie: ann.cookie })).status, 400);
  // закрытый чат: посторонний не получает уведомление даже с режимом «все»
  await call('PUT', '/api/chats/general/notify', { mode: 'mentions' }, { cookie: ann.cookie });
  assert.equal((await call('PUT', '/api/chats/curators/notify', { mode: 'all' }, { cookie: ann.cookie })).status, 403, 'режим для чужого закрытого чата не задать');
  await call('POST', '/api/chats/curators', { text: 'закрытое обсуждение' }, { cookie: curatorU.cookie }); await wait();
  assert.ok(!sent.slice(2).some((x) => /закрытое/.test(x.body)), 'содержимое закрытого чата не уходит постороннему');
  // общий выключатель
  await call('PUT', '/api/push/prefs', { enabled: false }, { cookie: ann.cookie });
  await call('POST', '/api/chats/general', { text: '@Анна', mentions: String(ann.user.id) }, { cookie: bob.cookie }); await wait();
  assert.equal(sent.length, 2, 'общий переключатель выключен — уведомлений нет');
  // ответ службы не сохраняется — только код
  push.setSender(async () => { const e = new Error('<b>remote text</b>'); e.statusCode = 500; e.body = '<html>remote body</html>'; throw e; });
  await call('PUT', '/api/push/prefs', { enabled: true }, { cookie: ann.cookie });
  await call('POST', '/api/chats/general', { text: '@Анна сбой', mentions: String(ann.user.id) }, { cookie: bob.cookie }); await wait();
  assert.equal((await call('GET', '/api/push', null, { cookie: ann.cookie })).json.subscriptions[0].lastError, 'HTTP 500');
  // недействительная подписка удаляется
  push.setSender(async () => { const e = new Error('gone'); e.statusCode = 410; throw e; });
  await call('POST', '/api/chats/general', { text: '@Анна снова', mentions: String(ann.user.id) }, { cookie: bob.cookie }); await wait();
  assert.equal((await call('GET', '/api/push', null, { cookie: ann.cookie })).json.devices, 0, 'подписка с ответом 410 удалена');
  // демо-аккаунт подписаться не может
  const demo = await call('POST', '/api/demo/login', { as: 'guest' });
  assert.equal((await call('POST', '/api/push/subscribe', { subscription: sub('demo') }, { cookie: demo.cookie })).json.error, 'push_demo');
});

test('Встреча по телефонам: вход по QR, деление пополам, нечётная группа — играет фасилитатор, выбор, знак пары, раунды, отзыв', async () => {
  const cid = (await call('POST', '/api/collections', { title: 'Телефонная встреча' }, { cookie: facil.cookie })).json.id;
  await call('PUT', `/api/collections/${cid}/cards`, { codes: ['DC-0010', 'DC-0011', 'DC-0012', 'DC-0013'] }, { cookie: facil.cookie });
  const slug = (await call('GET', '/api/collections', null, { cookie: facil.cookie })).json.collections.find((c) => c.id === cid).slug;
  const dev = (i) => `device-live-${String(i).padStart(4, '0')}-xyz`;
  const FAC = 'device-live-facilitator-01';
  const st = (d) => call('GET', `/api/live/${slug}/state?device=${typeof d === 'number' ? dev(d) : d}`).then((r) => r.json.live);
  assert.equal(await st(1), null, 'без встречи QR работает как обычная подборка');
  assert.equal((await call('POST', `/api/live/${slug}/join`, { deviceId: dev(1), name: 'А' })).json.error, 'live_not_active');
  assert.equal((await call('POST', '/api/fac/live', { collectionId: cid }, { cookie: curatorU.cookie })).status, 403, 'встречу открывает фасилитатор');
  const sid = (await call('POST', '/api/fac/live', { collectionId: cid }, { cookie: facil.cookie })).json.id;
  assert.equal((await call('POST', '/api/fac/live', { collectionId: cid }, { cookie: facil.cookie })).json.id, sid, 'по одной подборке — одна идущая встреча');
  await call('GET', `/api/fac/live/${sid}?device=${FAC}`, null, { cookie: facil.cookie }); // пульт открыт с телефона фасилитатора
  const act = (a, body = {}) => call('POST', `/api/fac/live/${sid}/${a}`, body, { cookie: facil.cookie });
  assert.equal((await call('POST', `/api/live/${slug}/join`, { deviceId: dev(1), name: ' ' })).json.error, 'live_name_required');
  for (const [i, n] of [[1, 'Аня'], [2, 'Борис'], [3, 'Вера'], [4, 'Гоша'], [5, 'Дина']]) assert.equal((await call('POST', `/api/live/${slug}/join`, { deviceId: dev(i), name: n })).status, 200);
  assert.equal((await st(1)).status, 'lobby');
  // раунд 1: 5 участников — нечётно, фасилитатор входит сам: 3 держателя, 3 собеседника
  let p = (await act('start_round')).json;
  assert.equal(p.status, 'holders'); assert.equal(p.progress.holders, 3); assert.equal(p.progress.listeners, 3, 'фасилитатор включён в распределение');
  assert.ok(p.facRole, 'у фасилитатора своя роль в раунде');
  const ids = [1, 2, 3, 4, 5, FAC];
  const role = (d) => st(d).then((x) => x.me.role);
  const roles = new Map(); for (const d of ids) roles.set(d, await role(d));
  const H = ids.filter((d) => roles.get(d) === 'holder'); const L = ids.filter((d) => roles.get(d) === 'listener');
  const D = (d) => (typeof d === 'number' ? dev(d) : d);
  assert.equal((await call('POST', `/api/live/${slug}/pick`, { deviceId: D(L[0]), code: 'DC-0010' })).json.error, 'live_not_holder', 'собеседник не выбирает в очереди держателей');
  assert.equal((await call('POST', `/api/live/${slug}/pick`, { deviceId: D(H[0]), code: 'DC-0099' })).json.error, 'card_not_in_collection');
  // два держателя могут выбрать одну и ту же карту
  await call('POST', `/api/live/${slug}/pick`, { deviceId: D(H[0]), code: 'DC-0010' });
  await call('POST', `/api/live/${slug}/pick`, { deviceId: D(H[1]), code: 'DC-0010' });
  assert.equal((await st(L[0])).status, 'holders', 'ждём всех держателей');
  await call('POST', `/api/live/${slug}/pick`, { deviceId: D(H[2]), code: 'DC-0011' });
  const ls = await st(L[0]);
  assert.equal(ls.status, 'listeners'); assert.equal(ls.slots.length, 3, 'одна карта у двух держателей — две отдельные пары');
  assert.ok(ls.slots.every((x) => !('holder' in x)), 'собеседник не видит, кто выбрал карту');
  assert.equal((await call('POST', `/api/live/${slug}/partner`, { deviceId: D(L[0]), slotId: ls.slots[0].id })).status, 200);
  assert.ok((await st(L[1])).slots.find((x) => x.id === ls.slots[0].id).taken, 'занятая карта отмечена у остальных');
  assert.equal((await call('POST', `/api/live/${slug}/partner`, { deviceId: D(L[1]), slotId: ls.slots[0].id })).json.error, 'live_taken');
  await call('POST', `/api/live/${slug}/partner`, { deviceId: D(L[1]), slotId: ls.slots[1].id });
  await call('POST', `/api/live/${slug}/partner`, { deviceId: D(L[2]), slotId: ls.slots[2].id });
  const all = []; for (const d of ids) all.push(await st(d));
  assert.equal(all[0].status, 'pairs');
  assert.ok(all.every((x) => x.me.pair && x.me.pair.partners.length === 1), 'все в парах, у каждого ровно один собеседник');
  const bySign = new Map(); for (const x of all) { const k = JSON.stringify(x.me.pair.sign); bySign.set(k, (bySign.get(k) || 0) + 1); }
  assert.ok([...bySign.values()].every((n) => n === 2) && bySign.size === 3, 'три пары, у пары одинаковый знак, у разных пар — разные');
  // разговор, сигнал, конец раунда
  p = (await act('talk', { minutes: 30 })).json;
  assert.equal(p.status, 'talk'); assert.ok(Date.parse(p.talkEndsAt) - Date.now() > 29 * 60000);
  await act('add_time', { minutes: 5 });
  assert.ok(Date.parse((await st(1)).talkEndsAt) - Date.now() > 34 * 60000, '+5 минут');
  p = (await act('end_round')).json; assert.equal(p.status, 'break');
  p = (await act('recall')).json; assert.ok(p.recallAt, '«Позвать всех»');
  // в перерыве Дина ушла, пришёл опоздавший Женя и ещё Зоя ушла бы — 5 → проверим чётную группу: Дина ушла, итого 4
  await call('POST', `/api/live/${slug}/leave`, { deviceId: dev(5) });
  p = (await act('start_round')).json; assert.equal(p.round, 2);
  assert.equal(p.facRole, null, 'чётная группа — фасилитатор в раунде не играет');
  assert.equal(p.progress.holders + p.progress.listeners, 4);
  const prevL = L.filter((d) => d !== 5 && d !== FAC);
  let became = 0; for (const d of prevL) if (await role(d) === 'holder') became++;
  assert.equal(became, Math.min(prevL.length, 2), 'держатели второго раунда — прежние собеседники (сколько их есть)');
  // опоздавший во время раунда ждёт следующего
  await call('POST', `/api/live/${slug}/join`, { deviceId: dev(6), name: 'Женя' });
  assert.equal((await st(6)).me.role, null, 'опоздавший присоединится со следующего раунда');
  // «Дальше, не дожидаясь»
  const H2 = []; for (const d of [1, 2, 3, 4]) if (await role(d) === 'holder') H2.push(d);
  await call('POST', `/api/live/${slug}/pick`, { deviceId: dev(H2[0]), code: 'DC-0012' });
  await act('advance'); await act('advance');
  p = (await call('GET', `/api/fac/live/${sid}`, null, { cookie: facil.cookie })).json;
  assert.equal(p.status, 'pairs'); assert.equal(p.pairs.length, 1);
  await act('end_round');
  // раунд 3: 4 + Женя = 5 — снова нечётно, фасилитатор возвращается
  p = (await act('start_round')).json; assert.ok(p.facRole, 'нечётно — фасилитатор снова участник');
  await act('remove', { memberId: p.members.find((m) => m.name === 'Женя').id });
  p = (await call('GET', `/api/fac/live/${sid}`, null, { cookie: facil.cookie })).json;
  assert.ok(!p.members.some((m) => m.name === 'Женя'));
  // чужой фасилитатор пульт не видит
  const other = await emailLogin('fac-other@example.org', 'Другой');
  assert.equal((await call('GET', `/api/fac/live/${sid}`, null, { cookie: other.cookie })).status, 403);
  // завершение: экран благодарности, отзыв, QR свободен для новой группы
  await act('end');
  const fin = await st(1);
  assert.equal(fin.status, 'ended');
  assert.ok(/^DC-\d+$/.test(fin.lastCard), 'в конце встречи — карта, которую участник фактически выбрал (для «Отправить карту»)');
  assert.equal((await call('POST', `/api/live/feedback/${fin.id}`, { deviceId: dev(1) })).json.error, 'feedback_empty');
  assert.equal((await call('POST', `/api/live/feedback/${fin.id}`, { deviceId: dev(1), text: 'Было тепло', mayPublish: true })).status, 201);
  assert.equal((await st(1)).feedbackSent, true);
  assert.equal((await call('GET', `/api/fac/live/${sid}`, null, { cookie: facil.cookie })).json.feedback[0].text, 'Было тепло');
  // отзыв: только участники встречи; файл проверяется до записи на диск, расширение — по типу, не по имени
  const fbDir = path.join(dataDir, 'media', 'feedback');
  const fbFiles = () => fs.readdirSync(fbDir).sort();
  const before0 = fbFiles();
  const media = (buf, type, name) => { const f = new FormData(); f.append('text', 'запись'); f.append('media', new Blob([buf], { type }), name); return f; };
  const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(200, 1)]);
  const fbPost = (d, f) => call('POST', `/api/live/feedback/${fin.id}?device=${d}`, null, { form: f });
  let rr = await fbPost('device-not-in-meeting-0001', media(mp3, 'audio/mpeg', 'a.mp3'));
  assert.equal(rr.status, 403); assert.equal(rr.json.error, 'live_not_member');
  rr = await fbPost(dev(6), media(mp3, 'audio/mpeg', 'a.mp3'));
  assert.equal(rr.json.error, 'live_not_member', 'удалённый участник отзыв не оставляет');
  assert.equal((await call('POST', '/api/live/feedback/999999', { deviceId: dev(1), text: 'x' })).status, 404);
  assert.deepEqual(fbFiles(), before0, 'посторонний запрос не оставляет файлов');
  rr = await fbPost(dev(2), media(await png(), 'audio/mpeg', 'a.mp3'));
  assert.equal(rr.json.error, 'bad_media_type', 'содержимое не совпадает с типом');
  rr = await fbPost(dev(2), media(mp3, 'image/png', 'a.png'));
  assert.equal(rr.json.error, 'bad_media_type');
  assert.deepEqual(fbFiles(), before0, 'отклонённый файл удалён');
  rr = await fbPost(dev(2), (() => { const f = media(mp3, 'audio/mpeg', 'a.mp3'); f.append('deviceId', dev(3)); return f; })());
  assert.equal(rr.json.error, 'bad_visitor', 'устройство в форме и в адресе должно совпадать');
  assert.deepEqual(fbFiles(), before0);
  rr = await fbPost(dev(2), media(mp3, 'audio/mpeg', 'evil.html'));
  assert.equal(rr.status, 201);
  const added = fbFiles().filter((x) => !before0.includes(x));
  assert.equal(added.length, 1); assert.ok(/^[0-9a-f]{24}\.mp3$/.test(added[0]), 'расширение по типу файла');
  // не больше трёх отзывов от участника
  for (let i = 0; i < 2; i++) assert.equal((await call('POST', `/api/live/feedback/${fin.id}`, { deviceId: dev(2), text: 'ещё ' + i })).status, 201);
  rr = await fbPost(dev(2), media(mp3, 'audio/mpeg', 'a.mp3'));
  assert.equal(rr.status, 429); assert.equal(rr.json.error, 'feedback_limit');
  assert.equal(fbFiles().length, before0.length + 1);
  // через 12 часов после завершения отзывы не принимаются
  const ldb = require('../server/db');
  const endedAt = ldb.prepare('SELECT ended_at FROM live_sessions WHERE id = ?').get(fin.id).ended_at;
  ldb.prepare('UPDATE live_sessions SET ended_at = ? WHERE id = ?').run(new Date(Date.now() - 13 * 3600e3).toISOString(), fin.id);
  assert.equal((await call('POST', `/api/live/feedback/${fin.id}`, { deviceId: dev(3), text: 'поздно' })).json.error, 'live_feedback_closed');
  ldb.prepare('UPDATE live_sessions SET ended_at = ? WHERE id = ?').run(endedAt, fin.id);
  const sid2 = (await call('POST', '/api/fac/live', { collectionId: cid }, { cookie: facil.cookie })).json.id;
  assert.ok(sid2 && sid2 !== sid, 'после завершения по тому же QR — новая встреча');
  assert.equal((await st(1)).me, null, 'в новой встрече прежние участники заходят заново');
  await call('POST', `/api/fac/live/${sid2}/end`, {}, { cookie: facil.cookie });
});

test('Игры компанией: комната по коду, одна карта на всех, своя карта, угадай, карта для друга, история, вопрос от карты', async () => {
  const D = (i) => `device-group-${String(i).padStart(4, '0')}-abc`;
  const st = (code, i) => call('GET', `/api/group/${code}/state?device=${D(i)}`).then((r) => r.json);
  const act = (code, i, action, body = {}) => call('POST', `/api/group/${code}/act`, { deviceId: D(i), action, ...body });
  const room = async (format, n = 3) => {
    const r = await call('POST', '/api/group', { format, deviceId: D(1), name: 'Ведущий' });
    assert.equal(r.status, 201, format);
    for (let i = 2; i <= n; i++) assert.equal((await call('POST', `/api/group/${r.json.code}/join`, { deviceId: D(i), name: 'Друг ' + i })).status, 200);
    return r.json.code;
  };
  assert.equal((await call('POST', '/api/group', { format: 'nope', deviceId: D(1), name: 'x' })).json.error, 'group_bad_format');
  // одна карта на всех: у всех одна и та же, «другая карта» — только ведущий
  let c = await room('one');
  assert.equal((await act(c, 2, 'start')).json.error, 'group_host_only');
  await act(c, 1, 'start');
  const a1 = (await st(c, 1)).card.code; assert.equal((await st(c, 3)).card.code, a1, 'одна карта у всех');
  await act(c, 1, 'next_card'); assert.notEqual((await st(c, 2)).card.code, a1, 'другая карта');
  // каждому своя карта: выбор скрыт, пока все не выбрали
  c = await room('own');
  await act(c, 1, 'start');
  const g = (await st(c, 2)).gallery; assert.ok(g.length >= 3);
  await act(c, 1, 'pick', { code: g[0].code }); await act(c, 2, 'pick', { code: g[0].code });
  assert.equal((await st(c, 3)).shown, undefined, 'чужие карты скрыты до общего раскрытия');
  assert.deepEqual((await st(c, 1)).ready.length, 2, 'ведущий видит готовность');
  assert.equal((await act(c, 1, 'reveal')).json.error, 'group_not_all_picked', 'раньше времени не открыть');
  await act(c, 3, 'pick', { code: g[1].code });
  assert.equal((await st(c, 2)).phase, 'pick', 'сами карты не открываются — открывает ведущий');
  assert.equal((await act(c, 2, 'reveal')).json.error, 'group_host_only');
  await act(c, 1, 'reveal');
  const sh = (await st(c, 2)).shown; assert.equal(sh.length, 3, 'ведущий открыл — карты видны');
  assert.ok(sh.every((x) => x.name && x.card));
  // общий показ: одна карта за раз, снимает автор или ведущий
  await act(c, 2, 'spot', { on: true });
  assert.equal((await st(c, 3)).spot.name, 'Друг 2', 'карта видна крупно всем');
  assert.equal((await act(c, 3, 'spot', { on: true })).json.error, 'group_spot_busy', 'не два показа сразу');
  assert.equal((await act(c, 3, 'spot', { on: false })).json.error, 'group_host_only');
  await act(c, 2, 'spot', { on: false }); assert.equal((await st(c, 1)).spot, null);
  await act(c, 3, 'spot', { on: true }); await act(c, 1, 'again');
  const nr = await st(c, 3); assert.equal(nr.phase, 'pick'); assert.equal(nr.myCard, null, 'новый круг — новый выбор'); assert.equal(nr.members.length, 3, 'состав тот же');
  // угадай, кто выбрал: по одной, автор открывается по кнопке
  c = await room('guess');
  await act(c, 1, 'start');
  for (const i of [1, 2, 3]) await act(c, i, 'pick', { code: g[i - 1].code });
  await act(c, 1, 'reveal');
  let s2 = await st(c, 2); assert.equal(s2.phase, 'guess'); assert.ok(s2.current && !s2.author, 'автор скрыт');
  await act(c, 1, 'reveal'); s2 = await st(c, 2); assert.ok(s2.author, 'автор открыт');
  await act(c, 1, 'next'); await act(c, 1, 'next'); await act(c, 1, 'next');
  assert.equal((await st(c, 3)).phase, 'done');
  // карта для друга: один не начнёт; у каждого свой адресат, не он сам
  c = await room('friend', 1);
  assert.equal((await act(c, 1, 'start')).json.error, 'live_too_few', 'для друга нужно хотя бы двое');
  c = await room('friend', 4);
  await act(c, 1, 'start');
  const targets = []; for (const i of [1, 2, 3, 4]) { const x = await st(c, i); assert.ok(x.target && x.target !== x.me.name, 'адресат — другой человек'); targets.push(x.target); }
  assert.equal(new Set(targets).size, 4, 'каждый получает карту ровно от одного');
  for (const i of [1, 2, 3, 4]) await act(c, i, 'pick', { code: g[0].code });
  await act(c, 1, 'reveal');
  assert.ok((await st(c, 1)).shown.every((x) => x.for), 'видно, кому какая карта');
  // история по кругу
  c = await room('story');
  await act(c, 1, 'start'); await act(c, 1, 'next_card'); await act(c, 1, 'next_card');
  assert.equal((await st(c, 2)).cards.length, 3);
  // вопрос от карты: каждый получает чужой вопрос
  c = await room('question');
  await act(c, 1, 'start');
  for (const i of [1, 2, 3]) await act(c, i, 'write', { text: `Вопрос ${i}` });
  await act(c, 1, 'reveal');
  for (const i of [1, 2, 3]) { const x = await st(c, i); assert.ok(x.question && x.question !== `Вопрос ${i}`, 'чужой вопрос'); }
  // завершение
  await act(c, 1, 'end'); assert.equal((await st(c, 2)).status, 'ended');
  assert.equal((await call('POST', `/api/group/${c}/join`, { deviceId: D(9), name: 'Поздно' })).json.error, 'group_not_found');
});

test('Игры компанией: разговор в парах — роли, тайный выбор, занятые карты, тройка при нечётной компании, знак, таймер, смена ролей', async () => {
  const D = (i) => `device-gpairs-${String(i).padStart(4, '0')}-abc`;
  const st = (i) => call('GET', `/api/group/${code}/state?device=${D(i)}`).then((r) => r.json);
  const act = (i, action, body = {}) => call('POST', `/api/group/${code}/act`, { deviceId: D(i), action, ...body });
  const code = (await call('POST', '/api/group', { format: 'pairs', deviceId: D(1), name: 'Ведущий' })).json.code;
  for (let i = 2; i <= 5; i++) await call('POST', `/api/group/${code}/join`, { deviceId: D(i), name: 'Друг ' + i });
  assert.equal((await act(2, 'start')).json.error, 'group_host_only');
  await act(1, 'start');
  const all = [1, 2, 3, 4, 5]; const role = {}; for (const i of all) role[i] = (await st(i)).role;
  const H = all.filter((i) => role[i] === 'holder'); const L = all.filter((i) => role[i] === 'listener');
  assert.equal(H.length, 2); assert.equal(L.length, 3);
  const gal = (await st(H[0])).gallery; assert.ok(gal.length > 2, 'держателю — вся галерея');
  assert.equal((await st(L[0])).gallery, undefined, 'собеседник галерею пока не видит');
  await act(H[0], 'pick', { code: gal[0].code }); await act(H[1], 'pick', { code: gal[0].code }); // одна карта у двоих — можно
  const ls = await st(L[0]); assert.equal(ls.phase, 'listeners'); assert.equal(ls.slots.length, 2);
  await act(L[0], 'partner', { slotId: ls.slots[0].id });
  assert.equal((await act(L[1], 'partner', { slotId: ls.slots[0].id })).json.error, 'live_taken', 'занятая карта');
  await act(L[1], 'partner', { slotId: ls.slots[1].id });
  await act(L[2], 'partner', { slotId: ls.slots[0].id }); // нечётно — третьим
  const states = []; for (const i of all) states.push(await st(i));
  assert.ok(states.every((x) => x.phase === 'pairs' && x.pair), 'все в парах');
  assert.equal(states.filter((x) => x.pair.partners.length === 2).length, 3, 'одна тройка: у троих по два собеседника');
  const signs = new Set(states.map((x) => JSON.stringify(x.pair.sign))); assert.equal(signs.size, 2, 'две пары — два знака');
  await act(1, 'talk', { minutes: 15 });
  assert.ok(Date.parse((await st(3)).talkEndsAt) - Date.now() > 14 * 60000);
  await act(1, 'end_round'); assert.equal((await st(2)).phase, 'break');
  await act(1, 'again');
  let swapped = 0; for (const i of L) if ((await st(i)).role === 'holder') swapped++;
  assert.equal(swapped, 2, 'во втором раунде прежние собеседники выбирают карты');
});

test('Установка на «Домой»: у Dialogue Cards своя область, имя и значки — не сайта harekrishna.info', async () => {
  const fs2 = require('fs');
  const m = JSON.parse(fs2.readFileSync(path.join(__dirname, '..', 'public', 'manifest.webmanifest'), 'utf8'));
  // манифест лежит в /dialogue-cards/: относительные scope и start_url остаются внутри этой папки
  const at = (v) => new URL(v, 'https://harekrishna.info/dialogue-cards/manifest.webmanifest').pathname;
  assert.equal(at(m.scope), '/dialogue-cards/', 'область — только приложение, не весь сайт');
  assert.ok(at(m.start_url).startsWith('/dialogue-cards/'), 'запуск внутри приложения');
  assert.ok(m.name && m.short_name && !/Сарасват/.test(m.name + m.short_name), 'своё название');
  for (const i of m.icons) assert.ok(fs2.existsSync(path.join(__dirname, '..', 'public', i.src)), 'значок есть: ' + i.src);
  const html = await (await fetch(base + '/')).text();
  assert.match(html, /<link rel="manifest" href="[^"]*\/manifest\.webmanifest">/, 'страница ссылается на свой манифест');
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="D-Cards">/, 'имя под значком на iPhone');
  assert.match(html, /<link rel="apple-touch-icon" href="[^"]*\/img\/icon-180\.png/, 'свой значок для iPhone');
  assert.ok(!/<title>[^<]*Сарасват/.test(html));
});

test('Демо-роли не видят настоящих людей: заявки, email, работы на рассмотрении, встречи, подборки', async () => {
  // Демо-роль может взять любой посетитель — в служебных разделах ему показываются только демо-записи.
  const adm = await call('POST', '/api/demo/login', { as: 'admin' });
  const cur = await call('POST', '/api/demo/login', { as: 'curator' });
  await call('POST', '/api/admin/demo/seed', null, { cookie: adm.cookie });
  const real = await call('GET', '/api/admin/applications', null, { cookie: owner.cookie });
  assert.ok(real.json.applications.some((a) => !a.isDemo), 'у владельца есть настоящие заявки — проверка не пустая');
  for (const url of ['/api/admin/applications', '/api/admin/curator-applications', '/api/admin/meetings', '/api/admin/comments', '/api/admin/cards', '/api/admin/print-requests', '/api/admin/users']) {
    const r = await call('GET', url, null, { cookie: adm.cookie });
    assert.equal(r.status, 200, url);
    const list = Object.values(r.json).find(Array.isArray) || [];
    assert.ok(list.every((x) => x.isDemo), `${url}: демо-администратор видит только демо-записи`);
  }
  const pr = (await call('GET', '/api/admin/print-requests', null, { cookie: adm.cookie })).json.requests;
  assert.ok(pr.every((p) => !p.email || !/@/.test(p.email) || p.isDemo), 'настоящие email не показываются');
  const w = (await call('GET', '/api/admin/works', null, { cookie: adm.cookie })).json;
  assert.ok([...w.recommended, ...w.decisions].every((x) => x.isDemo), 'решения и очередь — только демо');
  const col = (await call('GET', '/api/collections', null, { cookie: adm.cookie })).json.collections;
  assert.ok(col.every((c) => c.isDemo), 'подборки — только демо');
  const qd = (await call('GET', '/api/curation/queue', null, { cookie: cur.cookie })).json;
  assert.ok([...qd.queue, ...qd.recent].every((x) => x.isDemo), 'демо-куратор видит только демо-работы');
  const mine = (await call('GET', '/api/artist/works', null, { cookie: artist.cookie })).json.works;
  assert.ok(mine.length, 'у настоящего художника есть работы');
  assert.equal((await call('GET', `/api/works/${mine[0].id}`, null, { cookie: cur.cookie })).status, 404, 'чужую настоящую работу демо-куратор не открывает');
  assert.equal((await call('GET', `/api/works/${mine[0].id}`, null, { cookie: owner.cookie })).status, 200, 'владелец открывает');
  // Номер в другой записи (0x…, 1e1) не обходит проверку «только демо-объекты».
  const hex = '0x' + artist.user.id.toString(16);
  for (const [m, u, b] of [['POST', `/api/admin/users/${hex}/roles`, { role: 'admin', grant: true }], ['PATCH', `/api/admin/users/${hex}`, { email: 'evil@example.org' }],
    ['POST', `/api/admin/users/${artist.user.id}e0/roles`, { role: 'admin', grant: true }]]) {
    assert.equal((await call(m, u, b, { cookie: adm.cookie })).json.error, 'demo_readonly', `${m} ${u}`);
  }
  // Демо на боевом сервере выключено даже при DEMO_MODE=1.
  const { execFileSync } = require('child_process');
  const prodDemo = (extra) => execFileSync(process.execPath, ['-e', "process.stdout.write(String(require('./server/config').demoMode))"],
    { cwd: path.join(__dirname, '..'), env: { ...process.env, NODE_ENV: 'production', DEMO_MODE: '1', ...extra } }).toString();
  assert.equal(prodDemo({}), 'false');
  assert.equal(prodDemo({ DEMO_MODE_IN_PRODUCTION: '1' }), 'true');
});
