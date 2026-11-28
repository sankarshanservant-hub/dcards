// Аудит 28.11 (п.38): цифры «Подключения и данные» считают те же множества, что и списки (с демо-данными в базе).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcards-audit-'));
process.env.DATA_DIR = dataDir;
process.env.ADMIN_PASSWORD = 'test-password';
process.env.DEMO_MODE = '1';
const app = require('../server/index.js');

let server; let base; let admin;
async function call(method, url, body, cookie) {
  const headers = {}; if (body) headers['Content-Type'] = 'application/json'; if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}
before(async () => {
  server = app.listen(0); await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  admin = (await call('POST', '/api/auth/owner', { password: 'test-password' })).cookie;
});
after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('показатели совпадают со списками галереи, очереди куратора и встреч — и с демо-данными в базе', async () => {
  assert.equal((await call('POST', '/api/admin/demo/seed', null, admin)).status, 200);
  const o = (await call('GET', '/api/admin/overview', null, admin)).json;
  const gallery = (await call('GET', '/api/cards', null, admin)).json.cards.length;
  const queue = (await call('GET', '/api/curation/queue', null, admin)).json.queue.length;
  const toPublish = (await call('GET', '/api/admin/works', null, admin)).json.recommended.length;
  const ms = (await call('GET', '/api/admin/meetings', null, admin)).json.meetings.filter((m) => m.status === 'published').length;
  assert.equal(o.cards.published || 0, gallery, 'карт в галерее');
  assert.equal(o.worksCurators, queue, 'работ у кураторов');
  assert.equal(o.worksToPublish, toPublish, 'работ ждут публикации');
  assert.equal(o.meetings.published || 0, ms, 'встреч опубликовано');
  assert.ok(o.demoScope !== undefined);
});
