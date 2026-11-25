// Соглашение с авторами и изменения в коллекции (25.11.2026): своя папка данных, чтобы публикация редакции не влияла на остальные проверки.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcards-terms-'));
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
  return { status: res.status, json, cookie: (res.headers.get('set-cookie') || '').split(';')[0], text };
}
async function emailLogin(email, name) {
  const r1 = await call('POST', '/api/auth/request', { email });
  const r2 = await call('POST', '/api/auth/verify', { email, code: r1.json.demoCode, name });
  return { cookie: r2.cookie, user: r2.json.user };
}
const png = (color = '#88aacc') => sharp({ create: { width: 700, height: 1200, channels: 3, background: color } }).png().toBuffer();
async function form(fields, files = []) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  for (const [field, buf, name] of files) f.append(field, new Blob([buf], { type: 'image/png' }), name);
  return f;
}
let owner; let artist; let curatorU; let fac1; let fac2;
before(async () => {
  server = app.listen(0); await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const o = await call('POST', '/api/auth/owner', { password: 'test-password' }); owner = { cookie: o.cookie, user: o.json.user };
  artist = await emailLogin('author@example.org', 'Автор');
  curatorU = await emailLogin('cur@example.org', 'Куратор');
  fac1 = await emailLogin('f1@example.org', 'Фасилитатор 1'); fac2 = await emailLogin('f2@example.org', 'Фасилитатор 2');
  for (const [u, role] of [[curatorU, 'curator'], [fac1, 'facilitator'], [fac2, 'facilitator']]) await call('POST', `/api/admin/users/${u.user.id}/roles`, { role, grant: true }, { cookie: owner.cookie });
});
after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

const publishWork = async (id) => {
  assert.equal((await call('POST', `/api/curation/works/${id}/decide`, { action: 'approve' }, { cookie: curatorU.cookie })).status, 200);
  const r = await call('POST', `/api/admin/works/${id}/decide`, { action: 'publish' }, { cookie: owner.cookie }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json.cardCode;
};

test('соглашение: до публикации администрацией действуют прежние условия; черновик не публичный', async () => {
  const t = (await call('GET', '/api/terms/authors')).json; assert.equal(t.active, false); assert.equal(t.edition, null);
  assert.equal((await call('GET', '/api/config')).json.authorTerms.active, false);
  const old = await call('POST', '/api/artist/works', null, { cookie: artist.cookie, form: await form({ termsAccepted: 'true', termsVersion: config.termsVersion }, [['images', await png('#a44'), 'a.png']]) });
  assert.equal(old.status, 201, 'прежний процесс подачи не изменился');
  const dr = (await call('GET', '/api/admin/terms', null, { cookie: owner.cookie })).json;
  const ru = dr.drafts.find((d) => d.lang === 'ru');
  assert.ok(ru.body.includes('Редакция 1.0 от {{DATE}}') && ru.status === 'draft', 'дата не придумана — подставится при публикации');
  assert.equal((await call('GET', `/api/terms/editions/${ru.id}`)).status, 404, 'черновик закрыт для всех, кроме администрации');
  assert.equal((await call('POST', '/api/admin/terms/publish', { lang: 'ru' }, { cookie: owner.cookie })).json.error, 'confirm_required');
});

test('соглашение: публикация, обязательная галочка на сервере, привязка к работе, версии и редакции', async () => {
  const p = await call('POST', '/api/admin/terms/publish', { lang: 'ru', confirm: true }, { cookie: owner.cookie });
  assert.equal(p.status, 200); const ed = p.json.edition;
  const t = (await call('GET', '/api/terms/authors?lang=en')).json;
  assert.equal(t.active, true); assert.equal(t.edition.lang, 'ru', 'английский перевод не опубликован — показывается русский оригинал'); assert.equal(t.edition.translationPending, true);
  assert.ok(!t.edition.body.includes('{{DATE}}') && /Редакция 1\.0 от \d+ \S+ \d{4}/.test(t.edition.body), 'фактическая дата публикации');
  assert.equal(t.edition.short.blocks.length, 6); assert.equal(t.edition.short.check, 'Я ознакомился(-ась) с полным текстом соглашения и принимаю его условия.');
  // прямой запрос без согласия не проходит
  const noC = await call('POST', '/api/artist/works', null, { cookie: artist.cookie, form: await form({ termsAccepted: 'true', termsVersion: config.termsVersion }, [['images', await png('#4a4'), 'b.png']]) });
  assert.equal(noC.json.error, 'terms_required', 'старая галочка больше не принимается');
  const other = await emailLogin('other@example.org', 'Другой');
  const foreign = (await call('POST', '/api/artist/consent', { editionId: ed.id }, { cookie: other.cookie })).json.consentId;
  assert.equal((await call('POST', '/api/artist/works', null, { cookie: artist.cookie, form: await form({ consentId: String(foreign) }, [['images', await png('#4a4'), 'b.png']]) })).json.error, 'terms_required', 'чужое согласие не подходит');
  const c = await call('POST', '/api/artist/consent', { editionId: ed.id }, { cookie: artist.cookie }); assert.equal(c.status, 201);
  const acceptedAt = db.prepare('SELECT accepted_at FROM terms_consents WHERE id = ?').get(c.json.consentId).accepted_at;
  await new Promise((r) => setTimeout(r, 30));
  const sub = await call('POST', '/api/artist/works', null, { cookie: artist.cookie, form: await form({ consentId: String(c.json.consentId), clientKey: 'k1' }, [['images', await png('#4a4'), 'b.png'], ['images', await png('#44a'), 'c.png']]) });
  assert.equal(sub.status, 201); assert.equal(sub.json.ids.length, 2);
  const rows = db.prepare('SELECT * FROM terms_consents WHERE user_id = ? AND used_at IS NOT NULL ORDER BY id').all(artist.user.id);
  assert.equal(rows.length, 2, 'одна галочка на отправку — запись на каждую работу');
  for (const [i, r] of rows.entries()) {
    const v = db.prepare('SELECT * FROM work_versions WHERE id = ?').get(r.work_version_id);
    assert.equal(v.work_id, sub.json.ids[i]); assert.equal(r.edition_id, ed.id); assert.equal(r.lang, 'ru'); assert.equal(r.accepted_at, acceptedAt, 'время подтверждения — реальное, не время отправки');
    assert.equal(r.text_hash, db.prepare('SELECT hash FROM terms_editions WHERE id = ?').get(ed.id).hash);
  }
  // повтор той же отправки (оборвалась связь) — те же работы; новая подача тем же согласием — нельзя
  assert.deepEqual((await call('POST', '/api/artist/works', null, { cookie: artist.cookie, form: await form({ consentId: String(c.json.consentId), clientKey: 'k1' }, [['images', await png('#4a4'), 'b.png']]) })).json.ids, sub.json.ids);
  assert.equal((await call('POST', '/api/artist/works', null, { cookie: artist.cookie, form: await form({ consentId: String(c.json.consentId), clientKey: 'k2' }, [['images', await png('#4a4'), 'b.png']]) })).json.error, 'terms_required', 'согласие не переносится на следующую подачу');
  // автор видит свои согласия и именно принятую редакцию
  const mine = (await call('GET', '/api/artist/consents', null, { cookie: artist.cookie })).json.consents;
  assert.equal(mine.length, 2); const txt = (await call('GET', `/api/terms/editions/${mine[0].editionId}`, null, { cookie: artist.cookie })).json.edition;
  assert.equal(txt.id, ed.id); assert.ok(txt.body.startsWith('Условия участия авторов в проекте Dialogue Cards'));
  // новая версия опубликованной карты — отдельное согласие
  const code = await publishWork(sub.json.ids[0]);
  const noRep = await call('POST', `/api/artist/cards/${code}/replace`, null, { cookie: artist.cookie, form: await form({}, [['image', await png('#99a'), 'r.png']]) });
  assert.equal(noRep.json.error, 'terms_required');
  const c2 = (await call('POST', '/api/artist/consent', { editionId: ed.id, purpose: 'replacement', target: code }, { cookie: artist.cookie })).json.consentId;
  const rep = await call('POST', `/api/artist/cards/${code}/replace`, null, { cookie: artist.cookie, form: await form({ consentId: String(c2) }, [['image', await png('#99a'), 'r.png']]) });
  assert.equal(rep.status, 201);
  const rc = db.prepare('SELECT * FROM terms_consents WHERE id = ?').get(c2); assert.equal(rc.work_id, rep.json.id); assert.ok(rc.card_id && rc.work_version_id);
  // смена редакции до отправки: прежнее согласие не привязывается к новой
  const c3 = (await call('POST', '/api/artist/consent', { editionId: ed.id }, { cookie: artist.cookie })).json.consentId;
  const bodyNew = 'Условия участия авторов в проекте Dialogue Cards\n\nРедакция 1.1\n';
  db.prepare("INSERT INTO terms_editions (doc, version, lang, title, body, short, hash, status, published_at) VALUES ('authors','1.1','ru','Условия',?, ?, 'h', 'published', ?)").run(bodyNew, JSON.stringify({ blocks: [] }), new Date(Date.now() + 1000).toISOString());
  assert.equal((await call('POST', '/api/artist/works', null, { cookie: artist.cookie, form: await form({ consentId: String(c3) }, [['images', await png('#4a4'), 'b.png']]) })).json.error, 'terms_changed', 'при новой редакции — подтвердить заново');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM terms_consents WHERE edition_id = ? AND used_at IS NOT NULL').get(ed.id).n, 3, 'прежние согласия сохранены и не перенесены на новую редакцию');
  assert.equal((await call('GET', `/api/terms/editions/${ed.id}`)).json.edition.version, '1.0', 'прежняя редакция доступна');
  db.prepare("DELETE FROM terms_editions WHERE version = '1.1'").run();
});

test('удаление и обновление карт: доступ прекращается, фасилитаторам — уведомление без изображения и без дублей, история остаётся', async () => {
  const ed = (await call('GET', '/api/terms/authors')).json.edition;
  const cons = async () => String((await call('POST', '/api/artist/consent', { editionId: ed.id }, { cookie: artist.cookie })).json.consentId);
  const sub = await call('POST', '/api/artist/works', null, { cookie: artist.cookie, form: await form({ consentId: await cons() }, [['images', await png('#c55'), 'x.png']]) });
  const code = await publishWork(sub.json.ids[0]);
  let h = (await call('GET', '/api/fac/changes', null, { cookie: fac1.cookie })).json.changes;
  assert.ok(h.some((x) => x.kind === 'added' && x.code === code), 'добавление — в истории');
  assert.equal((await call('GET', '/api/fac/changes', null, { cookie: artist.cookie })).status, 403);
  // обновление карты: уведомление только после публикации новой версии
  const rc = (await call('POST', '/api/artist/consent', { editionId: ed.id, purpose: 'replacement' }, { cookie: artist.cookie })).json.consentId;
  const rep = await call('POST', `/api/artist/cards/${code}/replace`, null, { cookie: artist.cookie, form: await form({ consentId: String(rc) }, [['image', await png('#5c5'), 'y.png']]) });
  const bellOf = async (u) => (await call('GET', '/api/bell', null, { cookie: u.cookie })).json.items;
  assert.ok(!(await bellOf(fac1)).some((n) => /обновлено/.test(n.title)), 'при загрузке новой версии — без уведомления');
  assert.equal((await call('POST', `/api/curation/works/${rep.json.id}/decide`, { action: 'approve', replacementType: 'fix' }, { cookie: curatorU.cookie })).status, 200);
  assert.equal((await call('POST', `/api/admin/works/${rep.json.id}/decide`, { action: 'publish' }, { cookie: owner.cookie })).status, 200);
  const upd = (await bellOf(fac1)).find((n) => /обновлено/.test(n.title)); assert.ok(upd && upd.url.includes(code), 'обновление: обычное уведомление со ссылкой на карту');
  assert.ok(!(await bellOf(fac1)).some((n) => /удален/.test(n.title)), 'обновление — не удаление');
  // отзыв прежней версии v1
  const myCard = (await call('GET', '/api/artist/works', null, { cookie: artist.cookie })).json.cards.find((c) => c.code === code);
  assert.equal(myCard.version, 'v2'); assert.equal(myCard.oldVersions[0].label, 'v1');
  assert.equal((await call('POST', `/api/artist/cards/${code}/versions/${myCard.oldVersions[0].id}/revoke`, null, { cookie: artist.cookie })).status, 200);
  const rv = (await bellOf(fac2)).find((n) => /Версия v1 карты/.test(n.title)); assert.ok(rv, 'отзыв версии — важное уведомление с номером версии');
  // удаление автором
  const card = db.prepare('SELECT * FROM cards WHERE code = ?').get(code);
  const thumbUrl = `/media/thumb/${card.image_thumb}`;
  assert.equal((await call('GET', thumbUrl)).status, 200);
  assert.equal((await call('POST', `/api/artist/cards/${code}/withdraw`, null, { cookie: artist.cookie })).status, 200);
  assert.equal((await call('POST', `/api/artist/cards/${code}/withdraw`, null, { cookie: artist.cookie })).json.error, 'already_removed', 'повтор не создаёт второе событие');
  assert.equal((await call('GET', thumbUrl)).status, 404, 'файл больше не отдаётся');
  assert.equal((await call('GET', thumbUrl, null, { cookie: owner.cookie })).status, 404, 'и не хранится (удалён)');
  assert.ok(!(await call('GET', '/api/cards')).json.cards.some((c) => c.code === code), 'нет в галерее');
  assert.equal((await call('GET', `/api/cards/${code}`)).status, 404, 'прямая ссылка — нет карты');
  assert.ok(!Object.keys((await call('GET', '/api/eagle/bank')).json.items).includes(code));
  for (const f of [fac1, fac2]) {
    const n = (await bellOf(f)).filter((x) => x.title === `Карта №${code.slice(3)} удалена из коллекции`);
    assert.equal(n.length, 1, 'одно уведомление каждому фасилитатору');
    assert.equal(n[0].body, `Карта №${code.slice(3)} удалена из коллекции Dialogue Cards. Если вы используете её распечатанную версию, пожалуйста, исключите её из своих рабочих материалов.`);
    assert.ok(!/media|thumb|\.webp|\.jpg|Автор/.test(JSON.stringify(n[0])), 'без изображения, ссылки на файл и данных автора');
  }
  const mails = db.prepare("SELECT status FROM fac_mail m JOIN collection_changes c ON c.id = m.change_id WHERE c.kind = 'removed' AND c.code = ?").all(code);
  assert.equal(mails.length, 2); assert.ok(mails.every((m) => m.status === 'not_connected'), 'почта не подключена — честный статус, без имитации отправки');
  h = (await call('GET', '/api/fac/changes', null, { cookie: fac2.cookie })).json.changes.filter((x) => x.code === code);
  assert.deepEqual(h.map((x) => x.kind).sort(), ['added', 'removed', 'updated', 'version_revoked'], 'история остаётся после удаления файлов');
  assert.ok(h.find((x) => x.kind === 'removed').current === false);
  // администрация: задачи по внешним материалам, отметка выполнения
  const rm = (await call('GET', '/api/admin/removals', null, { cookie: owner.cookie })).json.removals.find((x) => x.code === code && x.kind === 'removed');
  assert.ok(rm.tasks.find((t) => t.item === 'site').status === 'done' && rm.tasks.find((t) => t.item === 'ads').status === 'open');
  assert.ok(Date.parse(rm.tasks[0].dueAt) - Date.parse(rm.at.replace(' ', 'T')) <= 30 * 86400e3 + 5000, 'срок — 30 дней');
  assert.equal((await call('POST', `/api/admin/removal-tasks/${rm.tasks.find((t) => t.item === 'ads').id}`, { status: 'done', note: 'кампания остановлена' }, { cookie: owner.cookie })).status, 200);
  assert.equal((await call('POST', `/api/admin/cards/${code}/restore`, null, { cookie: owner.cookie })).json.error, 'card_purged', 'окончательно удалённую карту не вернуть');
});

test('снятие с рассмотрения и окончательное отклонение: файлы удаляются, фасилитаторам ничего не уходит; исключение администрацией', async () => {
  const ed = (await call('GET', '/api/terms/authors')).json.edition;
  const cons = async () => String((await call('POST', '/api/artist/consent', { editionId: ed.id }, { cookie: artist.cookie })).json.consentId);
  const before = (await call('GET', '/api/bell', null, { cookie: fac1.cookie })).json.items.length;
  const s1 = await call('POST', '/api/artist/works', null, { cookie: artist.cookie, form: await form({ consentId: await cons() }, [['images', await png('#1aa'), 'z.png']]) });
  assert.equal((await call('POST', `/api/artist/works/${s1.json.ids[0]}/withdraw`, null, { cookie: artist.cookie })).status, 200);
  const w1 = (await call('GET', '/api/artist/works', null, { cookie: artist.cookie })).json.works.find((w) => w.id === s1.json.ids[0]);
  assert.equal(w1.status, 'withdrawn'); assert.equal(w1.version.thumb, null);
  const s2 = await call('POST', '/api/artist/works', null, { cookie: artist.cookie, form: await form({ consentId: await cons() }, [['images', await png('#a1a'), 'q.png']]) });
  const crit = db.prepare('SELECT number FROM criteria LIMIT 1').get().number;
  assert.equal((await call('POST', `/api/curation/works/${s2.json.ids[0]}/decide`, { action: 'reject', criteria: [crit] }, { cookie: curatorU.cookie })).status, 200);
  const v = db.prepare('SELECT * FROM work_versions WHERE work_id = ?').get(s2.json.ids[0]); assert.ok(v.purged_at, 'отклонённая работа — изображение удалено');
  assert.ok(!fs.existsSync(path.join(config.mediaDir, 'works', 'full', v.image_full)));
  assert.equal((await call('GET', '/api/bell', null, { cookie: fac1.cookie })).json.items.length, before, 'фасилитаторам — ничего');
  // администрация исключает карту окончательно — с подтверждением
  const s3 = await call('POST', '/api/artist/works', null, { cookie: artist.cookie, form: await form({ consentId: await cons() }, [['images', await png('#aa1'), 'e.png']]) });
  const code = await publishWork(s3.json.ids[0]);
  assert.equal((await call('POST', `/api/admin/cards/${code}/exclude`, {}, { cookie: owner.cookie })).json.error, 'confirm_required');
  assert.equal((await call('POST', `/api/admin/cards/${code}/exclude`, { confirm: true }, { cookie: owner.cookie })).status, 200);
  assert.equal((await call('POST', `/api/admin/cards/${code}/exclude`, { confirm: true }, { cookie: owner.cookie })).json.already, true);
  assert.equal((await call('GET', '/api/bell', null, { cookie: fac1.cookie })).json.items.filter((n) => n.title.includes(code.slice(3)) && /удалена/.test(n.title)).length, 1);
});
