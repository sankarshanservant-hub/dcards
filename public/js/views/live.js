// Экран участника встречи по телефонам: вход по имени → ожидание → выбор карты (держатель) или карты держателя (собеседник)
// → знак пары во весь экран → разговор с вопросами и таймером → перерыв → … → благодарность, отзыв, приглашение в сообщество.
import { lang } from '../i18n.js';
import { esc, tt, u, api, errorText, toast, visitorId, storage } from '../util.js';
import { ic } from '../ui.js';
import { openViewer } from '../viewer.js';
import { QUESTION_FORMATS, MEMO } from '../content.js';
import { signHtml, unlockSound, soundsReady, play, clock, left, mmss, bellsFor, keepAwake, subscribe } from '../live-common.js';

const pairLists = () => (QUESTION_FORMATS.find((f) => f.key === 'pair') || {}).lists || [];
const items = (key) => { const l = pairLists().find((x) => x.key === key); return l ? (l.items[lang] || l.items.ru) : []; };
const listTitle = (key) => { const l = pairLists().find((x) => x.key === key); return l ? (l.title[lang] || l.title.ru) : ''; };

/** st — ответ /api/live/:slug/state с live != null. col — подборка (карты). */
export function participant(ctx, slug, col, first) {
  const dev = visitorId();
  let st = first.live; let skew = clock(first.serverNow);
  const ui = { found: {}, preview: null, sending: false, fbSent: false, list: null, showSign: false };
  const fired = new Set(); let lastRecall = null; let tick = null;
  const cardBy = new Map(col.cards.map((c) => [c.code, c]));
  document.body.classList.add('live-mode');

  const refresh = async () => {
    try { const r = await api(`/api/live/${slug}/state?device=${encodeURIComponent(dev)}`); if (!ctx.alive()) return; skew = clock(r.serverNow); if (!r.live) { ctx.rerender(); return; } st = r.live; draw(); } catch { /* следующая попытка */ }
  };
  const unsub = subscribe(`/api/live/${slug}/events`, refresh, ctx.alive);
  const cleanup = setInterval(() => { if (!ctx.alive()) { clearInterval(cleanup); clearInterval(tick); unsub(); document.body.classList.remove('live-mode'); } }, 1000);

  const frame = (body, cls = '') => `<div class="live ${cls}"><div class="live-in">${body}</div></div>`;
  const soundRow = () => (soundsReady() ? '' : `<button class="btn light sm" type="button" data-sound>${ic.bell} ${esc(tt('Включить звуковые сигналы', 'Turn on sound signals'))}</button>`);
  const tile = (c, attrs = '', extra = '') => `<button type="button" class="live-tile" ${attrs}><img src="${esc(c.thumb)}" alt="${esc(c.code)}" loading="lazy">${extra}</button>`;

  function draw() {
    const s = st; const me = s.me;
    // напоминание «соберёмся» — со звуком, один раз
    if (s.recallAt && s.recallAt !== lastRecall) { if (lastRecall !== null || Date.now() + skew - Date.parse(s.recallAt) < 90e3) play('gather'); lastRecall = s.recallAt; }
    if (lastRecall === null) lastRecall = s.recallAt || '';
    const recall = s.recallAt && ['break', 'lobby'].includes(s.status) && Date.now() + skew - Date.parse(s.recallAt) < 5 * 60e3
      ? `<div class="live-recall" role="alert">${ic.bell}<span>${esc(tt('Через минуту начинаем следующий раунд. Давайте снова соберёмся вместе.', 'The next round starts in a minute. Let’s gather together again.'))}</span></div>` : '';
    let html;
    if (s.status === 'ended') html = finalScreen(s);
    else if (!me) html = joinScreen(s);
    else if (s.status === 'lobby') html = frame(`${recall}<p class="eyebrow">Dialogue Flow · ${esc(col.title)}</p><h1>${esc(tt(`${me.name}, вы в группе`, `${me.name}, you are in the group`))}</h1>
      <p class="lead">${esc(tt('Ждём остальных. Фасилитатор начнёт, когда все соберутся.', 'Waiting for the others. The facilitator will start when everyone is here.'))}</p>
      <p class="live-count">${esc(tt(`В группе: ${s.count}`, `In the group: ${s.count}`))}</p>${soundRow()}${memoHtml()}
      <button class="linkbtn" type="button" data-leave>${esc(tt('Выйти из встречи', 'Leave the meeting'))}</button>`);
    else if (!me.role) html = frame(`${recall}<h1>${esc(tt('Раунд уже идёт', 'A round is in progress'))}</h1><p class="lead">${esc(tt('Вы присоединитесь со следующего раунда. Подождите немного или подойдите к фасилитатору.', 'You will join from the next round. Please wait a little or ask the facilitator.'))}</p>${soundRow()}`);
    else if (s.status === 'holders') html = me.role === 'holder' ? holderPick(s, me) : frame(`<p class="eyebrow">${esc(tt(`Раунд ${s.round}`, `Round ${s.round}`))}</p><h1>${esc(tt('Вы — собеседник', 'You are the partner'))}</h1>
      <p class="lead">${esc(tt('Сейчас карты выбирают держатели. Следом вы выберете одну из их карт — так сложится пара.', 'The card holders are choosing cards now. Next you will choose one of their cards — that is how pairs are formed.'))}</p>${soundRow()}`);
    else if (s.status === 'listeners') html = me.role === 'listener' ? listenerPick(s, me) : frame(`<p class="eyebrow">${esc(tt(`Раунд ${s.round}`, `Round ${s.round}`))}</p><h1>${esc(tt('Ваша карта выбрана', 'Your card is chosen'))}</h1>
      ${me.card && cardBy.get(me.card) ? `<img class="live-card" src="${esc(cardBy.get(me.card).thumb)}" alt="">` : ''}
      <p class="lead">${esc(tt('Пока не показывайте её никому. Собеседники выбирают карты — скоро вы увидите знак своей пары.', 'Do not show it to anyone yet. Partners are choosing cards — soon you will see your pair sign.'))}</p>`);
    else if (['pairs', 'talk', 'break'].includes(s.status)) html = me.pair ? pairScreen(s, me, recall) : frame(`${recall}<h1>${esc(s.status === 'break' ? tt('Раунд закончен', 'The round is over') : tt('В этом раунде вы без пары', 'You have no pair this round'))}</h1>
      <p class="lead">${esc(s.status === 'break' ? tt('Перерыв. Фасилитатор позовёт всех к следующему раунду.', 'Break. The facilitator will call everyone for the next round.') : tt('Подойдите к фасилитатору — он поможет присоединиться к разговору.', 'Please go to the facilitator — they will help you join a conversation.'))}</p>${s.status === 'break' ? `<button class="linkbtn" type="button" data-leave>${esc(tt('Выйти из встречи', 'Leave the meeting'))}</button>` : ''}`);
    else html = frame('<p class="muted">…</p>');
    ctx.main.innerHTML = html;
    wire();
    runTimer();
  }

  function joinScreen(s) {
    return frame(`<p class="eyebrow">Dialogue Flow</p><h1>${esc(col.title)}</h1>
      <p class="lead">${esc(tt('Встреча идёт. Напишите, как к вам обращаться, — это имя увидит ваш собеседник.', 'The meeting is on. Tell us your name — your partner will see it.'))}</p>
      <form class="form" id="jf"><label class="field" for="jn">${esc(tt('Ваше имя', 'Your name'))}</label>
        <input id="jn" name="name" maxlength="40" autocomplete="given-name" required value="${esc(storage.get('dc_live_name') || '')}">
        <p class="form-error" id="jerr" role="alert"></p>
        <button class="btn yellow wide big" type="submit">${esc(tt('Войти во встречу', 'Join the meeting'))}</button></form>
      <p class="small muted">${esc(tt(`Уже в группе: ${s.count}. Регистрация не нужна.`, `Already in the group: ${s.count}. No sign-up needed.`))}</p>${memoHtml()}`);
  }
  function holderPick(s, me) {
    const chosen = me.card && cardBy.get(me.card);
    return frame(`<p class="eyebrow">${esc(tt(`Раунд ${s.round}`, `Round ${s.round}`))}</p><h1>${esc(tt('Вы выбираете карту', 'You choose a card'))}</h1>
      <p class="lead">${esc(chosen ? tt('Карта выбрана. Пока держатели выбирают, её можно поменять. Никому её не показывайте.', 'Card chosen. You can change it while the other holders choose. Do not show it to anyone.') : tt('Выберите карту, которая откликается вам: сюжет, цвет, настроение — правильного выбора нет.', 'Choose the card that speaks to you: the scene, the colour, the mood — there is no right choice.'))}</p>
      ${chosen ? `<div class="live-chosen"><img src="${esc(chosen.thumb)}" alt=""><span>${ic.check} ${esc(tt('Ваша карта', 'Your card'))}</span></div>` : ''}
      <div class="live-grid">${col.cards.map((c) => tile(c, `data-pick="${esc(c.code)}" aria-label="${esc(tt('Рассмотреть карту', 'View card'))} ${esc(c.code)}"`, c.code === me.card ? `<span class="lt-mark">${ic.check}</span>` : '')).join('')}</div>${previewHtml()}`);
  }
  function listenerPick(s, me) {
    if (me.card) return frame(`<h1>${esc(tt('Карта выбрана', 'Card chosen'))}</h1><p class="lead">${esc(tt('Ждём, пока выберут остальные. Сейчас появится знак вашей пары.', 'Waiting for the others to choose. Your pair sign will appear in a moment.'))}</p>`);
    const free = (s.slots || []).filter((x) => !x.taken).length;
    return frame(`<p class="eyebrow">${esc(tt(`Раунд ${s.round}`, `Round ${s.round}`))}</p><h1>${esc(tt('Выберите карту', 'Choose a card'))}</h1>
      <p class="lead">${esc(tt('Это карты, которые выбрали держатели. Кто выбрал карту, станет вашим собеседником. Занятые карты становятся недоступны.', 'These are the cards the holders chose. Whoever chose your card becomes your partner. Taken cards become unavailable.'))}</p>
      <p class="live-count" aria-live="polite">${esc(tt(`Свободно: ${free}`, `Available: ${free}`))}</p>
      <div class="live-grid">${(s.slots || []).map((x) => { const c = cardBy.get(x.code); return c ? tile(c, `data-slot="${x.id}" ${x.taken ? 'disabled aria-disabled="true"' : ''} aria-label="${esc(x.taken ? tt('Занята', 'Taken') : tt('Рассмотреть карту', 'View card'))}"`, x.taken ? `<span class="lt-taken">${esc(tt('занята', 'taken'))}</span>` : '') : ''; }).join('')}</div>${previewHtml()}`);
  }
  function previewHtml() {
    const p = ui.preview; if (!p) return '';
    const c = cardBy.get(p.code);
    return `<div class="live-preview" role="dialog" aria-modal="true" aria-label="${esc(tt('Карта', 'Card'))}"><div class="lp-in">
      <img src="${esc(c.full || c.thumb)}" alt="${esc(c.code)}">
      <div class="lp-acts"><button class="btn light" type="button" data-pv-close>${esc(tt('Назад', 'Back'))}</button>
        <button class="btn yellow" type="button" data-pv-ok ${ui.sending ? 'disabled aria-busy="true"' : ''}>${esc(ui.sending ? tt('Сохраняем…', 'Saving…') : tt('Выбрать эту карту', 'Choose this card'))}</button></div></div></div>`;
  }
  function pairScreen(s, me, recall) {
    const key = `${s.id}:${s.round}`;
    const names = me.pair.partners.join(tt(' и ', ' and '));
    if (!ui.found[key] || ui.showSign) {
      return `<div class="live-sign">${signHtml(me.pair.sign)}
        <div class="ls-text"><b>${esc(tt('Найдите человека с таким же знаком', 'Find the person with the same sign'))}</b>
          <span>${esc(me.pair.partners.length > 1 ? tt('Ваши собеседники', 'Your partners') : tt('Ваш собеседник', 'Your partner'))}: ${esc(names || '—')}</span></div>
        <button class="btn yellow big wide" type="button" data-found>${esc(ui.found[key] ? tt('К вопросам', 'To the questions') : tt('Мы нашли друг друга', 'We found each other'))}</button></div>`;
    }
    const c = cardBy.get(me.card);
    const holder = me.role === 'holder';
    const mineKey = holder ? 'holder' : 'partner';
    const cur = ui.list || mineKey;
    const time = s.status === 'talk' && s.talkEndsAt ? `<div class="live-timer" data-timer aria-live="off">${esc(mmss(left(s.talkEndsAt, skew)))}</div>`
      : s.status === 'break' ? `<div class="live-timer done">${esc(tt('Раунд закончен', 'Round over'))}</div>` : `<div class="live-timer wait">${esc(tt('Скоро фасилитатор запустит время разговора', 'The facilitator will start the timer soon'))}</div>`;
    return frame(`${recall}<div class="live-talk-head">${time}<button class="sign-btn" type="button" data-sign aria-label="${esc(tt('Показать знак пары', 'Show pair sign'))}">${signHtml(me.pair.sign, { big: false })}</button></div>
      <p class="small muted" style="margin:0">${esc(me.pair.partners.length > 1 ? tt('Собеседники', 'Partners') : tt('Собеседник', 'Partner'))}: <b>${esc(names)}</b></p>
      ${c ? `<button type="button" class="live-card-btn" data-zoom><img class="live-card" src="${esc(c.thumb)}" alt="${esc(c.code)}"></button>` : ''}
      <p class="lead live-role">${esc(holder ? tt('Вы выбрали эту карту первым. Расскажите, почему она привлекла ваше внимание. Потом спросите собеседника — вопросы ниже.', 'You chose this card first. Tell your partner why it caught your attention. Then ask your partner — the questions are below.') : tt('Сначала послушайте, почему собеседника привлекла эта карта, и задавайте вопросы — они ниже.', 'First listen to why the card caught your partner’s attention, and ask the questions below.'))}</p>
      <div class="qtabs" role="tablist" aria-label="${esc(tt('Кто задаёт вопросы', 'Who asks'))}">${['partner', 'holder'].map((k) => `<button type="button" role="tab" aria-selected="${k === cur}" data-list="${k}">${esc(listTitle(k))}${k === mineKey ? ` · ${esc(tt('вы', 'you'))}` : ''}</button>`).join('')}</div>
      <ul class="qlist">${items(cur).map((q) => `<li>${esc(q)}</li>`).join('')}</ul>
      <p class="small muted">${esc(tt('Вопросы — помощь, а не маршрут: можно пропускать, задавать свои или просто говорить.', 'Questions are a help, not a route: skip them, ask your own or just talk.'))}</p>${soundRow()}${s.status === 'break' ? `<button class="linkbtn" type="button" data-leave>${esc(tt('Выйти из встречи', 'Leave the meeting'))}</button>` : ''}`, 'talk');
  }
  function finalScreen(s) {
    const sent = ui.fbSent || s.feedbackSent;
    const links = [['/team/general', ic.chat, 'Общий чат сообщества', 'Community chat', 'Остаться на связи, поделиться впечатлениями', 'Stay in touch, share impressions'],
      ['/artist/submit', ic.picPlus, 'Создать свою карту', 'Create your own card', 'Попробуйте себя как иллюстратор', 'Try yourself as an illustrator'],
      ['/facilitator/about', ic.people, 'Проводить такие встречи', 'Host meetings like this', 'В своём городе', 'In your city'],
      ['/meetings', ic.calendar, 'Найти следующую встречу', 'Find the next meeting', '', '']];
    return frame(`<p class="eyebrow">Dialogue Flow</p><h1>${esc(tt('Спасибо за встречу!', 'Thank you for the meeting!'))}</h1>
      <p class="lead">${esc(tt('Спасибо за доверие и за разговор. Каждый разговор сегодня был непохож на остальные — именно это делает Dialogue Flow живым.', 'Thank you for your trust and for the conversation. Every conversation today was unlike the others — that is what keeps Dialogue Flow alive.'))}</p>
      ${sent ? `<div class="notice green">${ic.check} ${esc(tt('Спасибо за отзыв!', 'Thank you for your feedback!'))}</div>` : `<form class="card-ui flat form" id="fb">
        <h2 style="margin:0;font-size:1.15rem">${esc(tt('Отзыв о встрече', 'Feedback on the meeting'))}</h2>
        <p class="small muted" style="margin:0">${esc(tt('Что понравилось, что было трудно, что можно сделать лучше? Критика здесь — помощь.', 'What did you like, what was hard, what could be better? Criticism helps here.'))}</p>
        <label class="sr-only" for="fbt">${esc(tt('Текст отзыва', 'Feedback text'))}</label><textarea id="fbt" name="text" maxlength="4000" placeholder="${esc(tt('Несколько слов', 'A few words'))}"></textarea>
        <div class="row"><label class="btn light sm" style="cursor:pointer">${ic.mic} ${esc(tt('Аудио', 'Audio'))}<input type="file" name="audio" accept="audio/*" capture hidden></label>
          <label class="btn light sm" style="cursor:pointer">${ic.video} ${esc(tt('Видео', 'Video'))}<input type="file" name="video" accept="video/*" capture="user" hidden></label>
          <span class="small muted" id="fbfile"></span></div>
        <label class="check"><input type="checkbox" name="mayPublish"> <span>${esc(tt('Можно показать мой отзыв на сайте', 'My feedback may be shown on the site'))}</span></label>
        <p class="small muted" style="margin:0">${esc(tt('Отзыв увидят фасилитатор и команда проекта. На сайте — только с вашего согласия.', 'The facilitator and the project team will see it. On the site — only with your consent.'))}</p>
        <p class="form-error" id="fberr" role="alert"></p>
        <button class="btn yellow" type="submit" ${ui.sending ? 'disabled' : ''}>${esc(ui.sending ? tt('Отправляем…', 'Sending…') : tt('Отправить отзыв', 'Send feedback'))}</button></form>`}
      <h2 style="margin:10px 0 0;font-size:1.15rem">${esc(tt('Станьте частью сообщества', 'Become part of the community'))}</h2>
      <div class="list">${links.map(([href, icon, ru, en, dru, den]) => `<a class="item" href="${u(href)}"><span class="ic">${icon}</span><span class="body"><b>${esc(tt(ru, en))}</b>${dru ? `<span class="small">${esc(tt(dru, den))}</span>` : ''}</span><span aria-hidden="true">→</span></a>`).join('')}</div>`);
  }
  const memoHtml = () => `<details class="about-df card-ui flat"><summary><span class="grow">${esc(tt('Памятка участника', 'Participant notes'))}</span><span class="chev" aria-hidden="true">▾</span></summary><div class="about-body">${(lang === 'en' ? MEMO.en : MEMO.ru).map((x) => `<p>${esc(x)}</p>`).join('')}</div></details>`;

  function runTimer() {
    clearInterval(tick);
    const s = st; if (!s || s.status !== 'talk' || !s.talkEndsAt) return;
    const step = () => {
      const ms = left(s.talkEndsAt, skew);
      const el = ctx.main.querySelector('[data-timer]'); if (el) el.textContent = mmss(ms);
      bellsFor(s.id, s.round, ms, fired);
      if (ms <= 0) { clearInterval(tick); setTimeout(refresh, 1500); }
    };
    step(); tick = setInterval(step, 1000);
  }

  function wire() {
    const $ = (q) => ctx.main.querySelector(q);
    const snd = $('[data-sound]'); if (snd) snd.onclick = () => { unlockSound(); setTimeout(draw, 300); };
    const jf = $('#jf');
    if (jf) jf.onsubmit = async (e) => {
      e.preventDefault(); unlockSound(); keepAwake(true);
      const name = jf.name.value.trim(); if (!name) { $('#jerr').textContent = tt('Напишите имя.', 'Enter your name.'); return; }
      storage.set('dc_live_name', name);
      try { await api(`/api/live/${slug}/join`, { method: 'POST', body: { deviceId: dev, name } }); await refresh(); } catch (x) { $('#jerr').textContent = errorText(x); }
    };
    const lv = $('[data-leave]'); if (lv) lv.onclick = async () => { if (!confirm(tt('Выйти из встречи?', 'Leave the meeting?'))) return; await api(`/api/live/${slug}/leave`, { method: 'POST', body: { deviceId: dev } }).catch(() => {}); refresh(); };
    ctx.main.querySelectorAll('[data-pick]').forEach((b) => b.onclick = () => { unlockSound(); ui.preview = { code: b.dataset.pick, kind: 'pick' }; draw(); });
    ctx.main.querySelectorAll('[data-slot]:not([disabled])').forEach((b) => b.onclick = () => { unlockSound(); const x = st.slots.find((y) => String(y.id) === b.dataset.slot); ui.preview = { code: x.code, slot: x.id, kind: 'slot' }; draw(); });
    const pc = $('[data-pv-close]'); if (pc) { pc.onclick = () => { ui.preview = null; draw(); }; pc.focus(); }
    const po = $('[data-pv-ok]');
    if (po) po.onclick = async () => {
      const p = ui.preview; ui.sending = true; draw();
      try {
        if (p.kind === 'pick') await api(`/api/live/${slug}/pick`, { method: 'POST', body: { deviceId: dev, code: p.code } });
        else await api(`/api/live/${slug}/partner`, { method: 'POST', body: { deviceId: dev, slotId: p.slot } });
        ui.preview = null;
      } catch (x) {
        ui.preview = null;
        toast(x.code === 'live_taken' ? tt('Эту карту только что выбрал другой собеседник — выберите другую.', 'Another partner has just taken this card — please choose another.') : errorText(x));
      }
      ui.sending = false; await refresh();
    };
    const fd = $('[data-found]'); if (fd) fd.onclick = () => { ui.found[`${st.id}:${st.round}`] = true; ui.showSign = false; draw(); window.scrollTo(0, 0); };
    const sg = $('[data-sign]'); if (sg) sg.onclick = () => { ui.showSign = true; draw(); };
    ctx.main.querySelectorAll('[data-list]').forEach((b) => b.onclick = () => { ui.list = b.dataset.list; draw(); });
    const zm = $('[data-zoom]'); if (zm) zm.onclick = () => { const c = cardBy.get(st.me.card); if (c) openViewer({ cards: [c], index: 0, mode: 'admin' }); };
    const fb = $('#fb');
    if (fb) {
      const showFile = () => { const f = (fb.audio.files[0] || fb.video.files[0]); $('#fbfile').textContent = f ? f.name : ''; };
      fb.audio.onchange = () => { fb.video.value = ''; showFile(); }; fb.video.onchange = () => { fb.audio.value = ''; showFile(); };
      fb.onsubmit = async (e) => {
        e.preventDefault();
        const file = fb.audio.files[0] || fb.video.files[0];
        if (!fb.text.value.trim() && !file) { $('#fberr').textContent = tt('Напишите пару слов или приложите запись.', 'Write a few words or attach a recording.'); return; }
        const f = new FormData(); f.append('deviceId', dev); f.append('text', fb.text.value); f.append('mayPublish', fb.mayPublish.checked ? '1' : '');
        if (file) f.append('media', file, file.name);
        ui.sending = true; const keep = fb.text.value; draw();
        try { await api(`/api/live/feedback/${st.id}`, { method: 'POST', form: f }); ui.fbSent = true; ui.sending = false; draw(); }
        catch (x) { ui.sending = false; draw(); const t = ctx.main.querySelector('#fbt'); if (t) t.value = keep; ctx.main.querySelector('#fberr').textContent = errorText(x); }
      };
    }
  }
  draw();
  if (st.me) keepAwake(true);
}
