// Демонстрационные данные: всё помечено is_demo и видно только в демо-режиме. Настоящие карты и статистику не смешиваем.
const sharp = require('sharp');
const db = require('./db');
const auth = require('./auth');
const works = require('./works');
const meetings = require('./meetings');
const community = require('./community');
const collections = require('./collections');

/** Изображение-заглушка с надписью «ДЕМО» (не художественная работа). */
function placeholder(i, label = 'ДЕМО') {
  const hues = [[30, 64, 175], [180, 83, 9], [21, 128, 61], [147, 51, 234], [190, 18, 60], [8, 145, 178]];
  const [r, g, b] = hues[i % hues.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="1200">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgb(${r},${g},${b})"/><stop offset="1" stop-color="#0f1430"/></linearGradient></defs>
    <rect width="700" height="1200" fill="url(#g)"/>
    <circle cx="350" cy="520" r="${150 + (i % 3) * 40}" fill="rgba(255,255,255,0.12)"/>
    <text x="350" y="1040" font-family="sans-serif" font-size="72" font-weight="700" fill="#ffd45a" text-anchor="middle">${label}</text>
    <text x="350" y="1110" font-family="sans-serif" font-size="34" fill="#ffffff" text-anchor="middle">демонстрационное изображение</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function seed() {
  const artist = auth.demoUser('artist');
  const curator = auth.demoUser('curator');
  auth.demoUser('curator2');
  const fac = auth.demoUser('facilitator');
  const guest = auth.demoUser('guest');
  auth.demoUser('admin');
  if (db.prepare('SELECT COUNT(*) AS n FROM works WHERE is_demo = 1').get().n) return { already: true };

  // Отправка из пяти работ: три одобрены, две возвращены на доработку (пример из задания).
  const files = [];
  for (let i = 0; i < 5; i++) files.push({ buffer: await placeholder(i), originalname: `demo-${i + 1}.png` });
  const r = await works.submit(artist, files, { termsAccepted: true, termsVersion: require('./config').termsVersion });
  const [w1, w2, w3, w4, w5] = r.ids;
  works.decide(curator, w1, { action: 'approve' });
  works.decide(curator, w2, { action: 'approve' });
  works.decide(curator, w3, { action: 'approve' });
  works.decide(curator, w4, { action: 'return', criteria: [2], comment: 'Пример возврата: укажите, что нужно поправить.' });
  works.decide(curator, w5, { action: 'return', criteria: [1, 3] });
  // Ещё две работы в очереди: одна новая, одна вынесена на обсуждение кураторов.
  const more = await works.submit(artist, [{ buffer: await placeholder(5), originalname: 'demo-6.png' }, { buffer: await placeholder(6), originalname: 'demo-7.png' }],
    { termsAccepted: true, termsVersion: require('./config').termsVersion });
  works.discuss(curator, more.ids[1], 'Пример: сложная работа, хочу услышать коллег.');
  works.vote(curator, more.ids[1], 'approve', 'Мне нравится неоднозначность образа.');

  // Встречи демо-фасилитатора в двух городах, по несколько дат.
  const day = (offset, hh = '19:00') => { const d = new Date(Date.now() + offset * 86400000); return `${d.toISOString().slice(0, 10)}T${hh}`; };
  const m1 = meetings.create(fac, { title: 'Dialogue Flow в кафе (демо)', description: 'Демонстрационная встреча: два раунда разговора в парах, завершающий круг.',
    country: 'Россия', city: 'Москва', venue: 'Кафе на Покровке (демо-адрес)', language: 'ru', timezone: 'Europe/Moscow', priceType: 'free', durationMin: 120, capacity: 12, askContact: true,
    firstDate: day(5), repeatWeekly: 3 });
  meetings.create(fac, { title: 'Dialogue Flow evening (demo)', description: 'Demo meeting in English.', country: 'Таиланд', city: 'Чиангмай',
    venue: 'Nimman, coworking (demo address)', language: 'en', timezone: 'Asia/Bangkok', priceType: 'paid', priceAmount: 300, currency: 'THB', durationMin: 90, priceNote: 'Оплата фасилитатору на месте (демо).', capacity: 2,
    firstDate: day(3, '18:30') });
  const firstDate = db.prepare('SELECT id FROM meeting_dates WHERE meeting_id = ? ORDER BY starts_at LIMIT 1').get(m1.id);
  await meetings.register(firstDate.id, { name: 'Иван (демо)', email: 'ivan.demo@example.org' }, 'http://localhost', 'ru');

  // Подборка фасилитатора, обсуждения и чаты.
  const colId = collections.create('Встреча в кафе (демо)', false, fac.id, true);
  const codes = db.prepare(`SELECT code FROM cards WHERE status = 'published' AND is_demo = 0 ORDER BY number LIMIT 12`).all().map((c) => c.code);
  collections.setCards(colId, codes);
  const firstCard = db.prepare(`SELECT id FROM cards WHERE status = 'published' AND is_demo = 0 ORDER BY number LIMIT 1`).get();
  if (firstCard) {
    community.addComment(firstCard.id, guest, 'Пример комментария: мне эта карта напомнила дорогу домой из школы.');
    community.addComment(firstCard.id, fac, 'Пример: на встрече эту карту выбрали трое — и у всех разные истории.');
  }
  community.post('curators', curator, 'Пример: коллеги, посмотрите работу на обсуждении — она в очереди со статусом «на обсуждении».');
  community.post('facilitators', fac, 'Пример: кто проводил встречу в библиотеке? Поделитесь, как расставляли столы.');
  community.startApplication(guest);
  return { ok: true };
}

/** Для кнопки «Посмотреть демо»: создаёт демо-данные, если их нет, и добавляет будущие даты демо-встречам, если старые прошли. */
let ensuring = null;
async function ensure() {
  if (ensuring) return ensuring;
  ensuring = (async () => {
    try {
      const r = await seed();
      if (!r.already) return r;
      // Демо-примеры прежних версий: полный сценарий — длительность и цена платной встречи.
      db.prepare('UPDATE meetings SET duration_min = 120 WHERE is_demo = 1 AND duration_min IS NULL').run();
      db.prepare(`UPDATE meetings SET price_amount = 300, currency = 'THB' WHERE is_demo = 1 AND price_type = 'paid' AND (price_amount IS NULL OR currency = '')`).run();
      const now = new Date().toISOString();
      const ms = db.prepare('SELECT id, timezone FROM meetings WHERE is_demo = 1').all();
      let added = 0;
      for (const m of ms) {
        const future = db.prepare(`SELECT 1 FROM meeting_dates WHERE meeting_id = ? AND status = 'active' AND starts_at >= ?`).get(m.id, now);
        if (future) continue;
        const d = new Date(Date.now() + 4 * 86400000);
        meetings.addDates(m.id, { firstDate: `${d.toISOString().slice(0, 10)}T19:00`, repeatWeekly: 2 });
        added++;
      }
      return { already: true, datesAdded: added };
    } finally { ensuring = null; }
  })();
  return ensuring;
}

/** Удаляет демо-данные (демо-пользователи остаются, чтобы можно было войти снова). */
function clear() {
  db.transaction(() => {
    const demoCards = db.prepare('SELECT id FROM cards WHERE is_demo = 1').all().map((c) => c.id);
    for (const id of demoCards) {
      db.prepare('DELETE FROM collection_cards WHERE card_id = ?').run(id);
      db.prepare('DELETE FROM selections WHERE card_id = ?').run(id);
      db.prepare('DELETE FROM card_offers WHERE card_id = ?').run(id);
      db.prepare('DELETE FROM comments WHERE card_id = ?').run(id);
      db.prepare('DELETE FROM card_versions WHERE card_id = ?').run(id);
    }
    db.prepare('DELETE FROM chat_messages WHERE is_demo = 1').run(); // сообщения со ссылкой на демо-работу — до удаления работ
    db.prepare('UPDATE works SET card_id = NULL WHERE is_demo = 1').run();
    db.prepare('DELETE FROM works WHERE is_demo = 1').run();
    db.prepare('DELETE FROM submissions WHERE is_demo = 1').run();
    for (const id of demoCards) db.prepare('DELETE FROM cards WHERE id = ?').run(id);
    db.prepare('DELETE FROM comments WHERE is_demo = 1').run();
    db.prepare('DELETE FROM chat_messages WHERE is_demo = 1').run();
    db.prepare('DELETE FROM meetings WHERE is_demo = 1').run();
    db.prepare('DELETE FROM collections WHERE is_demo = 1').run();
    db.prepare('DELETE FROM fac_applications WHERE is_demo = 1').run();
    db.prepare('DELETE FROM curator_applications WHERE is_demo = 1').run();
    db.prepare('DELETE FROM print_requests WHERE is_demo = 1').run();
  })();
  return { ok: true };
}

module.exports = { seed, ensure, clear, placeholder };
