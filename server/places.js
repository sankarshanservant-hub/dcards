// Город встречи → часовой пояс. Справочник: GeoNames cities15000 (CC BY 4.0), собирается scripts/build-cities.js.
// Фасилитатор указывает город (и при необходимости страну); пояс определяется здесь, на сервере, вручную не выбирается.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { cityKey } = require('./places-key');

// Привычные русские названия, которых нет в справочнике или которые там записаны иначе.
const ALIASES = [
  { key: 'маяпур', ru: 'Маяпур', cc: 'IN', tz: 'Asia/Kolkata' },
  { key: 'шридхамамаяпур', ru: 'Маяпур', cc: 'IN', tz: 'Asia/Kolkata' },
  { key: 'вриндаван', ru: 'Вриндаван', cc: 'IN', tz: 'Asia/Kolkata' },
  { key: 'вриндавана', ru: 'Вриндаван', cc: 'IN', tz: 'Asia/Kolkata' },
  { key: 'гоа', ru: 'Гоа', cc: 'IN', tz: 'Asia/Kolkata' },
  { key: 'бали', ru: 'Бали', cc: 'ID', tz: 'Asia/Makassar' },
  { key: 'питер', ru: 'Санкт-Петербург', cc: 'RU', tz: 'Europe/Moscow' },
  { key: 'спб', ru: 'Санкт-Петербург', cc: 'RU', tz: 'Europe/Moscow' },
  { key: 'мск', ru: 'Москва', cc: 'RU', tz: 'Europe/Moscow' },
];
const COUNTRY_ALIASES = { сша: 'US', usa: 'US', us: 'US', америка: 'US', англия: 'GB', uk: 'GB', британия: 'GB', оаэ: 'AE', uae: 'AE', корея: 'KR', южнаякорея: 'KR', тайланд: 'TH', киргизия: 'KG', молдавия: 'MD', белоруссия: 'BY', чехия: 'CZ' };

let data = null;
function load() {
  if (data) return data;
  const file = path.join(__dirname, 'data', 'cities.json.gz');
  const rows = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
  const entries = rows.map(([id, ru, en, cc, tz, pop, keys]) => ({ id: String(id), ru, en, cc, tz, pop, keys: keys.split('|') }));
  const byKey = new Map(); const byId = new Map(); const zones = new Map();
  for (const e of entries) {
    byId.set(e.id, e);
    for (const k of e.keys) { if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(e); }
    if (!zones.has(e.cc)) zones.set(e.cc, new Set());
    zones.get(e.cc).add(e.tz);
  }
  ALIASES.forEach((a, i) => {
    const e = { id: 'a' + i, ru: a.ru, en: a.ru, cc: a.cc, tz: a.tz, pop: 0, keys: [a.key], alias: true };
    byId.set(e.id, e);
    if (!byKey.has(a.key)) byKey.set(a.key, []);
    byKey.get(a.key).push(e);
  });
  // Названия стран по-русски и по-английски (Intl), плюс разговорные варианты.
  const ru = new Intl.DisplayNames(['ru'], { type: 'region' }); const en = new Intl.DisplayNames(['en'], { type: 'region' });
  const countries = new Map();
  for (const cc of zones.keys()) {
    for (const n of [ru.of(cc), en.of(cc), cc]) if (n) countries.set(cityKey(n), cc);
  }
  for (const [k, cc] of Object.entries(COUNTRY_ALIASES)) countries.set(cityKey(k), cc);
  const SHORT = { US: 'США', GB: 'Великобритания', AE: 'ОАЭ', KR: 'Южная Корея' };
  data = { entries, byKey, byId, zones, countries, ruName: (cc) => SHORT[cc] || ru.of(cc) || cc };
  return data;
}

/** Код страны по названию; '' — страна не указана; null — не узнали. */
function countryCode(country) {
  const k = cityKey(country);
  if (!k) return '';
  return load().countries.get(k) || null;
}

const option = (e, typed) => {
  const d = load();
  const sameKey = typed && e.keys.includes(cityKey(typed));
  return { placeId: e.id, city: sameKey ? tidy(typed) : (e.ru || e.en), country: d.ruName(e.cc), cc: e.cc, timezone: e.tz, population: e.pop };
};
const tidy = (s) => { const t = String(s).trim().replace(/\s+/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };

/**
 * Определить город и его часовой пояс.
 * → { status: 'ok', place } | { status: 'ambiguous', options } (уточните город и страну) | { status: 'not_found', options? } | { status: 'empty' }
 */
function resolve({ city, country, placeId } = {}) {
  const d = load();
  if (placeId && d.byId.has(String(placeId))) {
    const e = d.byId.get(String(placeId));
    return { status: 'ok', place: option(e, city) };
  }
  const k = cityKey(city);
  if (!k) return { status: 'empty' };
  const cc = countryCode(country);
  if (cc === null) return { status: 'not_found', reason: 'country', options: [] };
  let list = (d.byKey.get(k) || []).filter((e) => !cc || e.cc === cc);
  list = [...list].sort((a, b) => b.pop - a.pop);
  if (!list.length) {
    // Небольшой город в стране с одним часовым поясом — пояс страны.
    if (cc && d.zones.get(cc) && d.zones.get(cc).size === 1) {
      const tz = [...d.zones.get(cc)][0];
      return { status: 'ok', place: { placeId: '', city: tidy(city), country: d.ruName(cc), cc, timezone: tz, population: 0 } };
    }
    return { status: 'not_found', options: suggest(k, cc) };
  }
  const first = list[0];
  const other = list.find((e) => e.tz !== first.tz);
  // Однозначно: у всех совпадений один пояс, или самый крупный город намного больше остальных (Москва, а не Moscow в Айдахо).
  if (!other || (first.pop && first.pop >= 20 * other.pop)) return { status: 'ok', place: option(first, city) };
  const seen = new Set();
  const options = list.filter((e) => { const key = e.cc + e.tz; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 6).map((e) => option(e, city));
  return { status: 'ambiguous', options };
}

/** Подсказки по началу названия (для «не нашли — может быть, …»). */
function suggest(k, cc) {
  if (k.length < 3) return [];
  const d = load();
  const out = []; const seen = new Set();
  for (const e of d.entries) {
    if (cc && e.cc !== cc) continue;
    if (!e.keys.some((x) => x.startsWith(k))) continue;
    if (seen.has(e.id)) continue;
    seen.add(e.id); out.push(option(e));
    if (out.length >= 6) break;
  }
  return out;
}

module.exports = { resolve, countryCode, load };
