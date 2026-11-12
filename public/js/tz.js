// Подсказка часового пояса по городу и стране (если пояс определяется однозначно).
// Иначе фасилитатор выбирает пояс явно. Список — частые города; дополняйте при необходимости.
const CITY = {
  'москва': 'Europe/Moscow', moscow: 'Europe/Moscow', 'санкт-петербург': 'Europe/Moscow', 'петербург': 'Europe/Moscow', 'saint petersburg': 'Europe/Moscow', 'st petersburg': 'Europe/Moscow',
  'казань': 'Europe/Moscow', kazan: 'Europe/Moscow', 'нижний новгород': 'Europe/Moscow', 'ростов-на-дону': 'Europe/Moscow', 'краснодар': 'Europe/Moscow', 'сочи': 'Europe/Moscow', 'воронеж': 'Europe/Moscow',
  'калининград': 'Europe/Kaliningrad', 'самара': 'Europe/Samara', 'ижевск': 'Europe/Samara', 'екатеринбург': 'Asia/Yekaterinburg', yekaterinburg: 'Asia/Yekaterinburg', 'пермь': 'Asia/Yekaterinburg', 'челябинск': 'Asia/Yekaterinburg', 'уфа': 'Asia/Yekaterinburg', 'тюмень': 'Asia/Yekaterinburg',
  'омск': 'Asia/Omsk', 'новосибирск': 'Asia/Novosibirsk', novosibirsk: 'Asia/Novosibirsk', 'томск': 'Asia/Tomsk', 'барнаул': 'Asia/Barnaul', 'красноярск': 'Asia/Krasnoyarsk', 'иркутск': 'Asia/Irkutsk', 'улан-удэ': 'Asia/Irkutsk',
  'якутск': 'Asia/Yakutsk', 'владивосток': 'Asia/Vladivostok', vladivostok: 'Asia/Vladivostok', 'хабаровск': 'Asia/Vladivostok', 'магадан': 'Asia/Magadan', 'петропавловск-камчатский': 'Asia/Kamchatka',
  'киев': 'Europe/Kyiv', kyiv: 'Europe/Kyiv', kiev: 'Europe/Kyiv', 'минск': 'Europe/Minsk', minsk: 'Europe/Minsk', 'тбилиси': 'Asia/Tbilisi', tbilisi: 'Asia/Tbilisi', 'батуми': 'Asia/Tbilisi',
  'ереван': 'Asia/Yerevan', yerevan: 'Asia/Yerevan', 'баку': 'Asia/Baku', 'алматы': 'Asia/Almaty', almaty: 'Asia/Almaty', 'астана': 'Asia/Almaty', 'ташкент': 'Asia/Tashkent', 'бишкек': 'Asia/Bishkek',
  'стамбул': 'Europe/Istanbul', istanbul: 'Europe/Istanbul', 'анталья': 'Europe/Istanbul', 'берлин': 'Europe/Berlin', berlin: 'Europe/Berlin', 'лондон': 'Europe/London', london: 'Europe/London',
  'париж': 'Europe/Paris', paris: 'Europe/Paris', 'рига': 'Europe/Riga', 'вильнюс': 'Europe/Vilnius', 'таллин': 'Europe/Tallinn', 'варшава': 'Europe/Warsaw', 'прага': 'Europe/Prague', 'белград': 'Europe/Belgrade',
  'бангкок': 'Asia/Bangkok', bangkok: 'Asia/Bangkok', 'чиангмай': 'Asia/Bangkok', 'чиang mai': 'Asia/Bangkok', 'chiang mai': 'Asia/Bangkok', 'пхукет': 'Asia/Bangkok', 'паттайя': 'Asia/Bangkok',
  'бали': 'Asia/Makassar', bali: 'Asia/Makassar', 'денпасар': 'Asia/Makassar', 'дубай': 'Asia/Dubai', dubai: 'Asia/Dubai', 'дели': 'Asia/Kolkata', 'гоа': 'Asia/Kolkata', 'маяпур': 'Asia/Kolkata', 'вриндаван': 'Asia/Kolkata',
  'пекин': 'Asia/Shanghai', beijing: 'Asia/Shanghai', 'шанхай': 'Asia/Shanghai', shanghai: 'Asia/Shanghai', 'гуанчжоу': 'Asia/Shanghai', 'шэньчжэнь': 'Asia/Shanghai', 'чэнду': 'Asia/Shanghai',
  'гонконг': 'Asia/Hong_Kong', 'тайбэй': 'Asia/Taipei', 'сингапур': 'Asia/Singapore', singapore: 'Asia/Singapore', 'куала-лумпур': 'Asia/Kuala_Lumpur', 'хошимин': 'Asia/Ho_Chi_Minh', 'нячанг': 'Asia/Ho_Chi_Minh', 'дананг': 'Asia/Ho_Chi_Minh',
  'токио': 'Asia/Tokyo', tokyo: 'Asia/Tokyo', 'сеул': 'Asia/Seoul', seoul: 'Asia/Seoul', 'нью-йорк': 'America/New_York', 'new york': 'America/New_York', 'лос-анджелес': 'America/Los_Angeles', 'los angeles': 'America/Los_Angeles',
};
// Страны с одним часовым поясом.
const COUNTRY = {
  'таиланд': 'Asia/Bangkok', thailand: 'Asia/Bangkok', 'грузия': 'Asia/Tbilisi', georgia: 'Asia/Tbilisi', 'армения': 'Asia/Yerevan', armenia: 'Asia/Yerevan', 'азербайджан': 'Asia/Baku',
  'беларусь': 'Europe/Minsk', belarus: 'Europe/Minsk', 'украина': 'Europe/Kyiv', ukraine: 'Europe/Kyiv', 'турция': 'Europe/Istanbul', turkey: 'Europe/Istanbul', 'германия': 'Europe/Berlin', germany: 'Europe/Berlin',
  'франция': 'Europe/Paris', france: 'Europe/Paris', 'италия': 'Europe/Rome', italy: 'Europe/Rome', 'латвия': 'Europe/Riga', 'литва': 'Europe/Vilnius', 'эстония': 'Europe/Tallinn', 'польша': 'Europe/Warsaw',
  'чехия': 'Europe/Prague', 'сербия': 'Europe/Belgrade', 'великобритания': 'Europe/London', uk: 'Europe/London', 'оаэ': 'Asia/Dubai', uae: 'Asia/Dubai', 'индия': 'Asia/Kolkata', india: 'Asia/Kolkata',
  'китай': 'Asia/Shanghai', china: 'Asia/Shanghai', 'вьетнам': 'Asia/Ho_Chi_Minh', vietnam: 'Asia/Ho_Chi_Minh', 'япония': 'Asia/Tokyo', japan: 'Asia/Tokyo', 'корея': 'Asia/Seoul', 'южная корея': 'Asia/Seoul',
  'сингапур': 'Asia/Singapore', singapore: 'Asia/Singapore', 'узбекистан': 'Asia/Tashkent', 'киргизия': 'Asia/Bishkek', 'кыргызстан': 'Asia/Bishkek',
};
const norm = (s) => String(s || '').trim().toLowerCase().replace(/ё/g, 'е');

/** Пояс по городу (точно) или по стране (если пояс в стране один). null — нужно выбрать явно. */
export function suggestTz(country, city) {
  return CITY[norm(city)] || COUNTRY[norm(country)] || null;
}

function tzOffset(utcMs, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(utcMs)).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMs;
}
/** 'YYYY-MM-DDTHH:MM' в поясе tz → Date (UTC). */
export function zonedToDate(local, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local || '');
  if (!m || !tz) return null;
  try {
    const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    let utc = guess - tzOffset(guess, tz);
    utc = guess - tzOffset(utc, tz);
    return new Date(utc);
  } catch { return null; }
}
