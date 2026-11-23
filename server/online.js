// «Играть компанией онлайн» (22.11.2026): игры на расстоянии — каждый со своего телефона, разговор в созвоне или переписке.
// Комната, вход по ссылке и обновления — общие с играми компанией (server/group.js); здесь — только ход игр.
// Очков, победителей и рейтингов нет. Чужие ответы и выбор до раскрытия не показываются.
//   see    — «Что видишь ты?»: одна карта и вопрос, каждый пишет ответ, ответы открываются вместе;
//   whose  — «Чья это карта?»: тема, у каждого 4 карты, тайный выбор + «почему», догадки, раскрытие;
//   chain  — «История по кругу»: по очереди — одна из трёх карт и одна-две фразы к общей истории;
//   gift   — «Карта для соседа»: карта и свой вопрос для одного человека, ответы видны всей комнате;
//   bridge — «Мост между картами»: две карты, «что их связывает?», отметка «удивило».
//   eagle  — «Глаз-алмаз» (23.11.2026): одна карта на всех; каждый в своём темпе «Запомнил» → вопрос → обязательный ответ;
//            когда ответили (или пропустили) все в комнате — карта, правильный ответ и ответы всех с именами.
const ONLINE = ['see', 'whose', 'chain', 'gift', 'bridge', 'eagle'];
const MIN2 = ['whose', 'gift'];
const DEFAULT_SEE = { ru: 'Что ты здесь видишь?', en: 'What do you see here?' };
const CHAIN_MAX = 8;
const clean = (s, n) => String(s || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().replace(/[ \t]+/g, ' ').slice(0, n);

module.exports = function makeOnline(h) {
  const { db, R, dataOf, save, setRoom, pool, randomCard, cardOut, count, shuffle, derange } = h;
  const card = (code) => db.prepare("SELECT code FROM cards WHERE code = ? AND status = 'published'").get(String(code || ''));
  const members = (r) => R.members.all(r.id);
  const picks = (r) => R.picks.all(r.id, r.step);
  const upsert = (r, memberId, fields) => {
    const ex = db.prepare('SELECT * FROM group_picks WHERE room_id = ? AND step = ? AND member_id = ?').get(r.id, r.step, memberId);
    const row = { code: null, target_id: null, text: null, ...(ex || {}), ...fields };
    db.prepare('INSERT OR REPLACE INTO group_picks (room_id, step, member_id, code, target_id, text) VALUES (?, ?, ?, ?, ?, ?)')
      .run(r.id, r.step, memberId, row.code, row.target_id, row.text);
  };
  const fresh = (r) => R.byCode.get(r.code);
  const eagleBank = require('./eagle');
  /** Несколько разных случайных карт (без уже показанных в этой комнате, пока они есть). */
  function some(r, n, showDemo, avoid = []) {
    const all = pool(showDemo || r.is_demo, r).map((c) => c.code);
    const a = shuffle(all.filter((c) => !avoid.includes(c)));
    const b = shuffle(all.filter((c) => avoid.includes(c)));
    return [...a, ...b].slice(0, n);
  }

  // ---------- новый раунд ----------
  function round(r, body, showDemo) {
    const ms = members(r);
    if (MIN2.includes(r.format) && ms.length < 2) return { error: 'live_too_few' };
    const d = dataOf(r);
    const seen = d.seen || [];
    const step = r.step + 1;
    let patch;
    if (r.format === 'see') {
      const c = randomCard(showDemo || r.is_demo, seen, r);
      patch = { phase: 'write', card: c, question: clean(body.question, 200) || null, seen: [...seen, c].slice(-40) };
    } else if (r.format === 'bridge') {
      const two = some(r, 2, showDemo, seen);
      if (two.length < 2) return { error: 'collection_too_small' };
      patch = { phase: 'write', cards: two, hearts: {}, seen: [...seen, ...two].slice(-40) };
    } else if (r.format === 'whose') {
      const hands = {}; let used = [...seen];
      for (const m of ms) { const hand = some(r, 4, showDemo, used); hands[m.id] = hand; used = [...used, ...hand]; }
      patch = { phase: 'pick', theme: clean(body.theme, 200) || null, hands, order: [], guesses: {}, seen: used.slice(-60) };
    } else if (r.format === 'gift') {
      patch = { phase: 'pick', answers: {} };
    } else if (r.format === 'chain') {
      patch = { phase: 'turn', story: [], turn: 0, offer: some(r, 3, showDemo, seen), seen };
    } else if (r.format === 'eagle') {
      // только карты с заданиями из банка; вопрос и правильный ответ — один на раунд, снимок (переживает обновление банка)
      const codes = pool(showDemo || r.is_demo, r).map((c) => c.code);
      const items = eagleBank.forCards(codes).items; const withTasks = Object.keys(items);
      if (!withTasks.length) return { error: 'eagle_no_tasks' };
      const fresh0 = withTasks.filter((c) => !seen.includes(c)); const from = fresh0.length ? fresh0 : withTasks;
      const code = from[Math.floor(Math.random() * from.length)]; const list = items[code]; const it = list[Math.floor(Math.random() * list.length)];
      patch = { phase: 'play', card: code, qid: it.id, q: it.q, a: it.a, looked: {}, skipped: {}, seen: [...seen, code].slice(-40) };
    }
    setRoom(r, { status: 'play', step });
    if (r.format === 'gift') {
      const m = derange(ms.map((x) => x.id));
      for (const x of ms) db.prepare('INSERT OR REPLACE INTO group_picks (room_id, step, member_id, target_id) VALUES (?, ?, ?, ?)').run(r.id, step, x.id, m.get(x.id));
    }
    save(fresh(r), patch);
    return { ok: true, id: r.id };
  }

  /** Все ли (из тех, кто сейчас в комнате) уже сделали ход — тогда игра идёт дальше сама. */
  function advance(r) {
    r = fresh(r); const d = dataOf(r); const ids = members(r).map((m) => m.id); const ps = picks(r);
    const done = (pred) => ids.length > 0 && ids.every((id) => ps.some((p) => p.member_id === id && pred(p)));
    if (['see', 'bridge'].includes(r.format) && d.phase === 'write' && done((p) => p.text)) save(r, { phase: 'open' });
    if (r.format === 'whose' && d.phase === 'pick' && done((p) => p.code)) toGuess(r);
    if (r.format === 'whose' && d.phase === 'guess') {
      const order = d.order || []; const g = d.guesses || {};
      // каждый отметил догадку у каждой чужой карты
      if (ids.every((id) => order.every((owner) => owner === id || !ids.includes(owner) || (g[owner] && g[owner][id]))) && order.length) save(r, { phase: 'open' });
    }
    if (r.format === 'gift' && d.phase === 'pick' && done((p) => p.code && p.text)) save(r, { phase: 'answer' });
    if (r.format === 'eagle' && d.phase === 'play') {
      const sk = d.skipped || {};
      if (ids.length && ids.every((id) => sk[id] || ps.some((p) => p.member_id === id && p.text))) save(r, { phase: 'open' });
    }
    if (r.format === 'gift' && d.phase === 'answer') {
      const a = d.answers || {}; const got = ps.filter((p) => p.code && p.text).map((p) => p.target_id);
      if (got.length && got.filter((id) => ids.includes(id)).every((id) => a[id])) save(r, { phase: 'open' });
    }
  }
  function toGuess(r) {
    const ps = picks(r).filter((p) => p.code);
    for (const p of ps) count(r, `${r.step}:m:${p.member_id}`, p.code);
    save(r, { phase: 'guess', order: shuffle(ps.map((p) => p.member_id)), guesses: {} });
  }

  function act(r, me, host, action, body, showDemo) {
    const d = dataOf(r);
    const hostOnly = host ? null : { error: 'group_host_only' };
    const ids = members(r).map((m) => m.id);
    const ok = () => ({ ok: true, id: r.id });
    if (r.format === 'eagle' && !['start', 'again'].includes(action)) return eagleAct(r, me, host, action, body, d, ok);
    switch (action) {
      case 'start': case 'again': return hostOnly || round(r, body || {}, showDemo);
      case 'write': { // see, bridge: свой ответ (можно поправить до раскрытия)
        if (!['see', 'bridge'].includes(r.format) || d.phase !== 'write') return { error: 'live_bad_state' };
        const t = clean(body.text, 500); if (!t) return { error: 'answer_required' };
        upsert(r, me.id, { text: t }); advance(r); return ok();
      }
      case 'pick': { // whose: карта из своей руки + «почему»; gift: карта из галереи + вопрос
        if (!['whose', 'gift'].includes(r.format) || d.phase !== 'pick') return { error: 'live_bad_state' };
        const c = card(body.code); if (!c) return { error: 'not_found' };
        if (r.format === 'whose' && !((d.hands || {})[me.id] || []).includes(c.code)) return { error: 'not_found' };
        const t = clean(body.text, 300); if (!t) return { error: r.format === 'gift' ? 'gift_question_required' : 'why_required' };
        upsert(r, me.id, { code: c.code, text: t }); advance(r); return ok();
      }
      case 'guess': { // whose: «эта карта — чья?» (место в общей галерее → имя)
        if (r.format !== 'whose' || d.phase !== 'guess') return { error: 'live_bad_state' };
        const owner = (d.order || [])[Number(body.slot)]; const who = Number(body.who);
        if (!owner || owner === me.id || !ids.includes(who)) return { error: 'live_bad_state' };
        const g = d.guesses || {}; g[owner] = { ...(g[owner] || {}), [me.id]: who };
        save(r, { guesses: g }); advance(r); return ok();
      }
      case 'answer': { // gift: ответ на карту, которую подготовили для меня
        if (r.format !== 'gift' || d.phase !== 'answer') return { error: 'live_bad_state' };
        if (!picks(r).some((p) => p.target_id === me.id && p.code && p.text)) return { error: 'live_bad_state' };
        const t = clean(body.text, 500); if (!t) return { error: 'answer_required' };
        save(r, { answers: { ...(d.answers || {}), [me.id]: t } }); advance(r); return ok();
      }
      case 'add': { // chain: ход того, чья очередь
        if (r.format !== 'chain' || d.phase !== 'turn') return { error: 'live_bad_state' };
        const cur = ids.length ? ids[d.turn % ids.length] : null;
        if (cur !== me.id) return { error: 'group_not_your_turn' };
        const c = card(body.code); if (!c || !(d.offer || []).includes(c.code)) return { error: 'not_found' };
        const t = clean(body.text, 300); if (!t) return { error: 'answer_required' };
        const story = [...(d.story || []), { member: me.id, name: me.name, code: c.code, text: t }];
        count(r, `${r.step}:t:${story.length}`, c.code);
        const seen = [...(d.seen || []), ...(d.offer || [])].slice(-60);
        if (story.length >= CHAIN_MAX) save(r, { story, phase: 'done', seen });
        else save(r, { story, turn: d.turn + 1, offer: some(r, 3, showDemo, seen), seen });
        return ok();
      }
      case 'skip': { // chain: ведущий передаёт ход дальше (человек отошёл)
        if (hostOnly) return hostOnly;
        if (r.format !== 'chain' || d.phase !== 'turn') return { error: 'live_bad_state' };
        save(r, { turn: d.turn + 1 }); return ok();
      }
      case 'finish': { // chain: закончить историю раньше
        if (hostOnly) return hostOnly;
        if (r.format !== 'chain' || d.phase !== 'turn' || (d.story || []).length < 2) return { error: 'live_bad_state' };
        save(r, { phase: 'done' }); return ok();
      }
      case 'reveal': { // ведущий: открыть, не дожидаясь всех
        if (hostOnly) return hostOnly;
        const ps = picks(r);
        if (['see', 'bridge'].includes(r.format) && d.phase === 'write') { if (!ps.some((p) => p.text)) return { error: 'group_nobody_yet' }; save(r, { phase: 'open' }); return ok(); }
        if (r.format === 'whose' && d.phase === 'pick') { if (ps.filter((p) => p.code).length < 2) return { error: 'group_need_two_cards' }; toGuess(r); return ok(); }
        if (r.format === 'whose' && d.phase === 'guess') { save(r, { phase: 'open' }); return ok(); }
        if (r.format === 'gift' && d.phase === 'pick') { if (!ps.some((p) => p.code && p.text)) return { error: 'group_nobody_yet' }; save(r, { phase: 'answer' }); return ok(); }
        if (r.format === 'gift' && d.phase === 'answer') { save(r, { phase: 'open' }); return ok(); }
        return { error: 'live_bad_state' };
      }
      case 'heart': { // bridge: «удивило» — отметить чужой ответ или снять отметку
        if (r.format !== 'bridge' || d.phase !== 'open') return { error: 'live_bad_state' };
        const to = Number(body.to); if (to === me.id || !picks(r).some((p) => p.member_id === to && p.text)) return { error: 'live_bad_state' };
        const hs = d.hearts || {}; const set = new Set(hs[to] || []);
        if (set.has(me.id)) set.delete(me.id); else set.add(me.id);
        hs[to] = [...set]; save(r, { hearts: hs }); return ok();
      }
      default: return { error: 'live_bad_state' };
    }
  }

  // ---------- «Глаз-алмаз» в компании ----------
  function eagleAct(r, me, host, action, body, d, ok) {
    if (d.phase !== 'play') return { error: 'live_bad_state' };
    const mine = picks(r).find((p) => p.member_id === me.id);
    switch (action) {
      case 'look': save(r, { looked: { ...(d.looked || {}), [me.id]: true } }); return ok();
      case 'answer': {
        if (!(d.looked || {})[me.id]) return { error: 'eagle_look_first' };
        if (mine && mine.text) return ok(); // ответ записан для раунда — повтор ничего не меняет
        const t = clean(body.text, 300); if (!t) return { error: 'answer_required' };
        const sk = { ...(d.skipped || {}) }; delete sk[me.id];
        save(r, { skipped: sk }); upsert(r, me.id, { text: t }); advance(r); return ok();
      }
      case 'skip': {
        if (mine && mine.text) return { error: 'live_bad_state' };
        save(r, { skipped: { ...(d.skipped || {}), [me.id]: true } }); advance(r); return ok();
      }
      case 'reveal': {
        if (!host) return { error: 'group_host_only' };
        if (!picks(r).some((p) => p.text)) return { error: 'group_nobody_yet' };
        save(r, { phase: 'open' }); return ok();
      }
      default: return { error: 'live_bad_state' };
    }
  }
  function eagleState(r, me, out, d, ps, ms) {
    const looked = d.looked || {}; const sk = d.skipped || {};
    const stage = (id) => (ps.some((p) => p.member_id === id && p.text) ? 'answered' : sk[id] ? 'skipped' : looked[id] ? 'ask' : 'look');
    out.card = cardOut(d.card);
    out.stages = Object.fromEntries(ms.map((m) => [m.id, stage(m.id)])); // кто где — без содержания ответов
    out.answeredCount = ms.filter((m) => ['answered', 'skipped'].includes(stage(m.id))).length;
    if (d.phase === 'open') {
      out.question = d.q; out.answer = d.a;
      // ответы всех, кто ответил (и уже вышедших), и пометка «пропустил(а)» у тех, кто в комнате
      const nm = (id) => (ms.find((m) => m.id === id) || db.prepare('SELECT name FROM group_members WHERE id = ?').get(id) || {}).name || '—';
      out.answers = [...ps.filter((p) => p.text).map((p) => ({ id: p.member_id, name: nm(p.member_id), text: p.text })),
        ...ms.filter((m) => sk[m.id] && !ps.some((p) => p.member_id === m.id && p.text)).map((m) => ({ id: m.id, name: m.name, skipped: true }))];
      return out;
    }
    if (!me) return out;
    const st = stage(me.id); out.myStage = st;
    if (st === 'ask' || st === 'answered') out.question = d.q; // вопрос — только после своего «Запомнил»
    if (st === 'answered') out.myText = ps.find((p) => p.member_id === me.id).text;
    return out;
  }

  function state(r, me, out, showDemo) {
    const d = dataOf(r); const ps = picks(r); const ms = members(r); const ids = ms.map((m) => m.id);
    const name = (id) => (ms.find((m) => m.id === id) || db.prepare('SELECT name FROM group_members WHERE id = ?').get(id) || {}).name || '—';
    const mine = me ? ps.find((p) => p.member_id === me.id) : null;
    if (r.format === 'eagle') return eagleState(r, me, out, d, ps, ms);
    out.ready = ps.filter((p) => (r.format === 'whose' ? p.code : r.format === 'gift' ? p.code && p.text : p.text)).map((p) => p.member_id);
    if (r.format === 'see' || r.format === 'bridge') {
      if (r.format === 'see') { out.card = cardOut(d.card); out.question = d.question || null; out.defaultQuestion = DEFAULT_SEE; }
      else out.cards = (d.cards || []).map(cardOut).filter(Boolean);
      out.myText = mine ? mine.text : null;
      if (d.phase === 'open') {
        const hs = d.hearts || {};
        out.answers = ps.filter((p) => p.text).map((p) => ({ id: p.member_id, name: name(p.member_id), text: p.text,
          ...(r.format === 'bridge' ? { hearts: (hs[p.member_id] || []).map(name), mine: me ? (hs[p.member_id] || []).includes(me.id) : false } : {}) }));
      }
    }
    if (r.format === 'whose') {
      out.theme = d.theme || null;
      if (me && d.phase === 'pick') out.hand = ((d.hands || {})[me.id] || []).map(cardOut).filter(Boolean);
      out.myCard = mine && mine.code ? cardOut(mine.code) : null; out.myText = mine ? mine.text : null;
      if (d.phase === 'guess' || d.phase === 'open') {
        const g = d.guesses || {};
        out.slots = (d.order || []).map((owner, i) => {
          const p = ps.find((x) => x.member_id === owner); if (!p) return null;
          const base = { slot: i, card: cardOut(p.code), mine: me ? owner === me.id : false };
          if (d.phase === 'guess') return { ...base, myGuess: me && g[owner] ? g[owner][me.id] || null : null };
          return { ...base, author: name(owner), why: p.text,
            guesses: Object.entries(g[owner] || {}).map(([who, said]) => ({ who: name(Number(who)), said: name(Number(said)) })) };
        }).filter(Boolean);
        out.choices = ms.map((m) => ({ id: m.id, name: m.name }));
        if (d.phase === 'guess') out.guessed = ids.filter((id) => (d.order || []).every((o) => o === id || (g[o] && g[o][id])));
      }
    }
    if (r.format === 'gift') {
      if (mine) out.target = name(mine.target_id);
      out.myCard = mine && mine.code ? cardOut(mine.code) : null; out.myText = mine ? mine.text : null;
      if (d.phase === 'pick' && me) out.gallery = pool(showDemo || r.is_demo, r).map((k) => h.publicCard(k));
      const forMe = me ? ps.find((p) => p.target_id === me.id && p.code && p.text) : null;
      if (forMe && (d.phase === 'answer' || d.phase === 'open')) out.forMe = { from: name(forMe.member_id), card: cardOut(forMe.code), question: forMe.text, answer: (d.answers || {})[me.id] || null };
      if (d.phase === 'answer') out.answered = Object.keys(d.answers || {}).map(Number).filter((id) => ids.includes(id));
      if (d.phase === 'answer') out.waitingFor = ps.filter((p) => p.code && p.text && ids.includes(p.target_id)).map((p) => p.target_id);
      if (d.phase === 'open') out.feed = ps.filter((p) => p.code && p.text).map((p) => ({ from: name(p.member_id), to: name(p.target_id), card: cardOut(p.code), question: p.text, answer: (d.answers || {})[p.target_id] || null }));
    }
    if (r.format === 'chain') {
      out.story = (d.story || []).map((x) => ({ name: x.name, text: x.text, card: cardOut(x.code) }));
      out.max = CHAIN_MAX;
      if (d.phase === 'turn' && ids.length) {
        const cur = ids[d.turn % ids.length]; out.turnName = name(cur); out.myTurn = me ? cur === me.id : false;
        if (out.myTurn) out.offer = (d.offer || []).map(cardOut).filter(Boolean);
      }
    }
    return out;
  }

  return { ONLINE, act, state, advance };
};
