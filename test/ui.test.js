// Проверки разметки интерфейса без браузера (отдельный процесс: здесь подставлены минимальные document/localStorage).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

globalThis.document = { documentElement: { lang: 'ru', dataset: {} }, querySelector: () => null, addEventListener() {}, cookie: '' };
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.location = { pathname: '/', search: '', hash: '', href: 'http://localhost/' };

test('timeline: подпись — обычный текст, ссылка экранируется', async () => {
  const ui = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'ui.js')).href);
  const html = ui.timeline([{ title: 'A<b>', note: '<img src=x>', state: 'done' }, { title: 'B', note: 'Карта DC-1', href: '/cards/DC-1"x', state: 'todo' }, { title: 'C', note: '', state: 'now' }]);
  assert.ok(html.includes('<b>A&lt;b&gt;</b>'));
  assert.ok(html.includes('&lt;img src=x&gt;') && !html.includes('<img'), 'подпись не превращается в разметку');
  assert.ok(html.includes('<a href="/cards/DC-1&quot;x">Карта DC-1</a>'));
  assert.equal((html.match(/class="small"/g) || []).length, 2, 'пустая подпись не выводится');
});
