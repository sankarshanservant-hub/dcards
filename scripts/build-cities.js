// Сборка справочника городов для определения часового пояса встречи по городу.
// Источник: GeoNames cities15000 (города от 15 тыс. жителей), лицензия CC BY 4.0, https://www.geonames.org/
// Запуск: node scripts/build-cities.js <путь к cities15000.txt>  →  server/data/cities.json.gz
// Формат строки: [id, русское название или '', название латиницей, код страны, часовой пояс, население, ключи поиска через '|'].
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { cityKey } = require('../server/places-key');

const src = process.argv[2];
if (!src) { console.error('Укажите путь к cities15000.txt'); process.exit(1); }
const RU = /^[А-Яа-яЁё][А-Яа-яЁё\s\-’'.()]*$/; // только русский алфавит (без і, ї, є, ґ, ў)
const LAT = /^[A-Za-z][A-Za-z\s\-’'.()]*$/;
const out = [];
for (const line of fs.readFileSync(src, 'utf8').split('\n')) {
  const f = line.split('\t');
  if (f.length < 18) continue;
  const [id, name, ascii, alts, , , fclass, , cc, , , , , , pop, , , tz] = f;
  if (fclass !== 'P' || !tz) continue;
  const alt = alts ? alts.split(',') : [];
  const ru = alt.filter((a) => RU.test(a));
  const lat = alt.filter((a) => LAT.test(a) && !/^[A-Z]{2,4}$/.test(a));
  const keys = [...new Set([name, ascii, ...ru, ...lat].map(cityKey).filter((k) => k.length >= 2))];
  out.push([Number(id), ru[0] || '', ascii || name, cc, tz, Number(pop) || 0, keys.join('|')]);
}
out.sort((a, b) => b[5] - a[5]);
const dest = path.join(__dirname, '..', 'server', 'data', 'cities.json.gz');
fs.writeFileSync(dest, zlib.gzipSync(JSON.stringify(out), { level: 9 }));
console.log(`городов: ${out.length}, файл: ${dest} (${Math.round(fs.statSync(dest).size / 1024)} КБ)`);
