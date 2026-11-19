// Ограничения частоты для записей без входа (обмены, комнаты, выбор карт, запись на встречу, поиск места).
// Счётчики — в памяти процесса: окно фиксированной длины на ключ (IP, браузер, аккаунт). После перезапуска службы
// счёт начинается заново — это защита от потока запросов, а не учёт. IP — адрес из X-Forwarded-For, который дописал
// nginx этого сервера (trust proxy в index.js), подставить его клиент не может.
const all = [];

/** Окно: не больше max событий за windowMs на ключ. */
function win(windowMs, max) {
  const m = new Map();
  const lim = {
    windowMs, max,
    entry(key, now = Date.now()) {
      let e = m.get(key);
      if (!e || e.reset <= now) { e = { n: 0, reset: now + windowMs }; m.set(key, e); }
      return e;
    },
    /** Осталось ли место (не расходует). */
    ok(key) { return lim.entry(key).n < max; },
    /** Расходует одно место; false — окно исчерпано. */
    hit(key) { const e = lim.entry(key); if (e.n >= max) return false; e.n += 1; return true; },
    retryAfter(key) { return Math.max(1, Math.ceil((lim.entry(key).reset - Date.now()) / 1000)); },
    sweep(now = Date.now()) { for (const [k, e] of m) if (e.reset <= now) m.delete(k); },
    clear() { m.clear(); },
    get size() { return m.size; },
  };
  all.push(lim);
  return lim;
}

/**
 * Проверяет все пары [окно, ключ] и только если везде есть место — расходует по одному в каждом
 * (отклонённый запрос не съедает чужие окна). Пустой ключ пропускается. Возвращает null или число секунд до повтора.
 */
function take(pairs) {
  const list = pairs.filter(([, key]) => key);
  const full = list.find(([lim, key]) => !lim.ok(key));
  if (full) return full[0].retryAfter(full[1]);
  for (const [lim, key] of list) lim.hit(key);
  return null;
}
/** Ответ 429 с Retry-After. */
function tooMany(res, retryAfter) {
  res.set('Retry-After', String(retryAfter || 60));
  return res.status(429).json({ error: 'too_many_requests' });
}
/** Промежуточный обработчик: pairsOf(req) → список [окно, ключ]. */
const guard = (pairsOf) => (req, res, next) => {
  const wait = take(pairsOf(req));
  return wait ? tooMany(res, wait) : next();
};

const MIN = 60 * 1000; const HOUR = 60 * MIN; const DAY = 24 * HOUR;
const timer = setInterval(() => { const now = Date.now(); for (const l of all) l.sweep(now); }, 5 * MIN);
timer.unref();

module.exports = { win, take, guard, tooMany, reset: () => all.forEach((l) => l.clear()), MIN, HOUR, DAY };
