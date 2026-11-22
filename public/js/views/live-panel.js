// Пульт фасилитатора для встречи по телефонам: QR для входа, участники, раунды, пары, таймер, перерыв, завершение, отзывы.
import { esc, tt, u, shareLink, api, errorText, toast, visitorId, fmtDate } from '../util.js';
import { session, hasRole, needLogin, noRole, loading, failed, ic, showQr, ROLE_LABEL } from '../ui.js';
import { participant } from './live.js';
import { signHtml, signWords, unlockSound, soundsReady, play, clock, left, mmss, bellsFor, keepAwake, subscribe } from '../live-common.js';

const STATUS = {
  lobby: ['Сбор группы', 'Gathering the group'], holders: ['Держатели выбирают карты', 'Holders are choosing cards'],
  listeners: ['Собеседники выбирают карты', 'Partners are choosing cards'], pairs: ['Пары находят друг друга', 'Pairs are finding each other'],
  talk: ['Идёт разговор', 'Conversation in progress'], break: ['Перерыв', 'Break'], ended: ['Встреча завершена', 'Meeting ended'],
};

/** Начать встречу по подборке (или открыть уже идущую) и перейти к пульту. */
export async function startFor(ctx, collectionId) {
  try { const r = await api('/api/fac/live', { method: 'POST', body: { collectionId } }); ctx.navigate('/facilitator/live/' + r.id); }
  catch (x) { toast(errorText(x)); }
}

export async function panel(ctx, id) {
  if (!session.user) return needLogin(ctx.main, tt('Пульт встречи — для фасилитатора.', 'The meeting console is for facilitators.'));
  if (!hasRole('facilitator')) return noRole(ctx.main, ROLE_LABEL.facilitator());
  loading(ctx.main);
  let p;
  const dev = visitorId();
  try { p = await api(`/api/fac/live/${id}?device=${encodeURIComponent(dev)}`); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  let skew = clock(p.serverNow); let tick = null; const fired = new Set(); let busy = false;
  let tab = 'panel'; let meMounted = false; let gen = 0;
  const url = shareLink('/s/' + p.slug);
  const refresh = async () => { try { const n = await api(`/api/fac/live/${id}?device=${encodeURIComponent(dev)}`); if (!ctx.alive()) return; p = n; skew = clock(n.serverNow); draw(); } catch { /* */ } };
  const unsub = subscribe(`/api/fac/live/${id}/events`, refresh, ctx.alive);
  keepAwake(true);
  const act = async (a, body = {}, confirmText = '') => {
    if (confirmText && !confirm(confirmText)) return;
    unlockSound(); busy = true; draw();
    try { p = await api(`/api/fac/live/${id}/${a}`, { method: 'POST', body }); skew = clock(p.serverNow); } catch (x) { toast(errorText(x)); }
    busy = false; draw();
  };

  function controls() {
    const n = p.members.length; const odd = n % 2 === 1;
    const b = (a, label, cls = 'yellow big', extra = '') => `<button class="btn ${cls}" type="button" data-act="${a}" ${busy ? 'disabled' : ''} ${extra}>${esc(label)}</button>`;
    switch (p.status) {
      case 'lobby': return `<p class="lead" style="margin:0">${esc(tt(`В группе: ${n}. Участники входят по QR — он справа.`, `In the group: ${n}. Participants join with the QR code.`))}</p>
        ${odd ? `<div class="notice">${esc(tt('Участников нечётное число — в этом раунде вы тоже участвуете: карта или собеседник появятся на вкладке «Я участник».', 'An odd number of participants — you take part in this round too: your card or partner will appear on the “Me as participant” tab.'))}</div>` : ''}
        ${b('start_round', tt('Группа собрана — начать раунд 1', 'Group is ready — start round 1'), 'yellow big', n < 2 ? 'disabled' : '')}`;
      case 'holders': return `<p class="lead" style="margin:0">${esc(tt(`Выбрали карты: ${p.progress.holdersDone} из ${p.progress.holders}`, `Cards chosen: ${p.progress.holdersDone} of ${p.progress.holders}`))}</p>
        ${b('advance', tt('Дальше, не дожидаясь остальных', 'Continue without waiting'), 'light', p.progress.holdersDone ? '' : 'disabled')}<p class="small muted" style="margin:0">${esc(tt('Кто не успел выбрать, станет собеседником.', 'Those who have not chosen become partners.'))}</p>`;
      case 'listeners': return `<p class="lead" style="margin:0">${esc(tt(`Собеседники выбрали: ${p.progress.listenersDone} из ${p.progress.listeners}`, `Partners chosen: ${p.progress.listenersDone} of ${p.progress.listeners}`))}</p>
        ${b('advance', tt('Распределить оставшихся', 'Assign the rest'), 'light')}`;
      case 'pairs': return `<p class="lead" style="margin:0">${esc(tt('Пары сложились. У каждой пары на телефонах одинаковый знак — по нему они находят друг друга.', 'Pairs are formed. Each pair has the same sign on their phones — that is how they find each other.'))}</p>
        <label class="field small">${esc(tt('Время разговора, минут', 'Conversation time, minutes'))}<input type="number" min="1" max="120" value="${p.roundMinutes}" id="mins" style="max-width:8em"></label>
        ${b('talk', tt('Все нашлись — начать разговор', 'Everyone found — start the conversation'))}`;
      case 'talk': return `<div class="live-timer big" data-timer>${esc(mmss(left(p.talkEndsAt, skew)))}</div>
        <p class="small muted" style="margin:0">${esc(tt('Сигналы у всех: один удар колокола за 3 минуты, два — за минуту, три — конец раунда.', 'Signals for everyone: one bell 3 minutes before, two at one minute, three at the end.'))}</p>
        <div class="row">${b('add_time', tt('+5 минут', '+5 minutes'), 'light')}${b('end_round', tt('Завершить раунд сейчас', 'End the round now'), 'light')}</div>`;
      case 'break': return `<p class="lead" style="margin:0">${esc(tt(`Раунд ${p.round} закончен. Перерыв — сколько нужно.`, `Round ${p.round} is over. Take as long a break as you need.`))}</p>
        ${p.recallAt ? `<p class="small muted" style="margin:0">${esc(tt('Напоминание отправлено', 'Reminder sent'))} ${esc(fmtDate(p.recallAt, { hour: '2-digit', minute: '2-digit' }))}</p>` : ''}
        <p class="small muted" style="margin:0">${esc(tt(`Сейчас в группе: ${p.members.length}. Опоздавшие могут войти по QR, ушедших можно убрать из списка — перед раундом группа распределится заново.${p.members.length % 2 ? ' Число нечётное — в следующем раунде вы участвуете.' : ''}`, `In the group now: ${p.members.length}. Latecomers can join with the QR code; remove those who left — the group is redistributed before the round.${p.members.length % 2 ? ' Odd number — you take part in the next round.' : ''}`))}</p>
        <div class="row">${b('recall', tt('Позвать всех: «через минуту начинаем»', 'Call everyone: “starting in a minute”'), 'light')}
        ${b('start_round', tt(`Начать раунд ${p.round + 1}`, `Start round ${p.round + 1}`))}</div>
        <p class="small muted" style="margin:0">${esc(tt('В новом раунде роли меняются: собеседники выбирают карты первыми.', 'In the next round roles swap: partners choose cards first.'))}</p>`;
      case 'ended': return `<p class="lead" style="margin:0">${esc(tt('Встреча завершена. QR свободен — по нему можно начать новую встречу.', 'The meeting has ended. The QR code is free for a new meeting.'))}</p>
        <a class="btn yellow" href="${u('/facilitator/collections')}">${esc(tt('К подборкам', 'To selections'))}</a>`;
      default: return '';
    }
  }

  // Каркас: вкладки «Пульт» и «Я участник» (если фасилитатор играет в раунде). Экран участника не перерисовывается вместе с пультом.
  ctx.main.innerHTML = '<div class="live-tabs-bar" id="ltb" hidden></div><div id="pb"></div><div id="mb" hidden></div>';
  const pb = ctx.main.querySelector('#pb'); const mb = ctx.main.querySelector('#mb'); const ltb = ctx.main.querySelector('#ltb');
  const playing = () => !!p.facRole && p.status !== 'ended';
  async function mountMe() {
    if (meMounted) return; meMounted = true; const my = ++gen;
    try {
      const [col, ls] = await Promise.all([api(`/api/c/${p.slug}`), api(`/api/live/${p.slug}/state?device=${encodeURIComponent(dev)}`)]);
      if (!ls.live) { meMounted = false; return; }
      const sub = { main: mb, alive: () => ctx.alive() && meMounted && gen === my, rerender: () => { meMounted = false; mountMe(); }, navigate: ctx.navigate, query: ctx.query };
      participant(sub, p.slug, col, ls);
    } catch { meMounted = false; }
  }
  function drawTabs() {
    ltb.hidden = !playing();
    if (!playing()) { if (tab === 'me') tab = 'panel'; meMounted = false; mb.innerHTML = ''; }
    else mountMe();
    ltb.innerHTML = `<div class="seg" role="tablist"><button type="button" role="tab" data-tab="panel" aria-selected="${tab === 'panel'}">${esc(tt('Пульт', 'Console'))}</button><button type="button" role="tab" data-tab="me" aria-selected="${tab === 'me'}">${esc(tt('Я участник', 'Me as participant'))} · ${esc(p.facRole === 'holder' ? tt('выбираю карту', 'choosing a card') : tt('собеседник', 'partner'))}</button></div>`;
    pb.hidden = tab !== 'panel'; mb.hidden = tab !== 'me';
    ltb.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { tab = b.dataset.tab; drawTabs(); window.scrollTo(0, 0); });
  }
  function draw() {
    const ended = p.status === 'ended';
    drawTabs();
    pb.innerHTML = `<div class="wrap page stack live-panel">
      <div class="page-head"><p class="eyebrow">${esc(tt('Встреча по телефонам', 'Phone meeting'))} · ${esc(p.title)}</p>
        <h1>${esc(tt(...STATUS[p.status]))}${p.round && !ended ? ` · ${esc(tt(`раунд ${p.round}`, `round ${p.round}`))}` : ''}</h1></div>
      <div class="cols-2" style="align-items:start;gap:20px">
        <div class="stack">
          <section class="card-ui stack">${controls()}</section>
          ${!soundsReady() && !ended ? `<button class="btn light sm" type="button" data-sound>${ic.bell} ${esc(tt('Включить звуковые сигналы на этом устройстве', 'Turn on sound signals on this device'))}</button>` : ''}
          ${p.pairs.length && !ended ? `<section class="card-ui flat stack"><h2 style="margin:0;font-size:1.1rem">${esc(tt('Пары', 'Pairs'))}</h2>
            <div class="live-pairs">${p.pairs.map((x) => `<div class="lp-row">${signHtml(x.sign, { big: false })}<span><b>${esc(x.holder)}</b> ${x.listeners.length ? `· ${x.listeners.map(esc).join(', ')}` : `<span class="muted">· ${esc(tt('ждёт собеседника', 'waiting for a partner'))}</span>`}<br><span class="small muted">${esc(x.card)} · ${esc(signWords(x.sign))}</span></span></div>`).join('')}</div></section>` : ''}
          ${ended || p.feedback.length ? `<section class="card-ui flat stack"><h2 style="margin:0;font-size:1.1rem">${esc(tt('Отзывы', 'Feedback'))} · ${p.feedback.length}</h2>
            ${p.feedback.map((f) => `<div class="comment"><header><b>${esc(f.name || tt('Без имени', 'No name'))}</b><span>${esc(fmtDate(f.createdAt, { hour: '2-digit', minute: '2-digit' }))}</span>${f.mayPublish ? `<span class="pill mint">${esc(tt('можно показать на сайте', 'may be shown on the site'))}</span>` : ''}</header>
              ${f.text ? `<p>${esc(f.text)}</p>` : ''}${f.file ? (/^video/.test(f.mime) ? `<video controls preload="metadata" src="${esc(u(f.file))}" style="max-width:100%"></video>` : `<audio controls preload="metadata" src="${esc(u(f.file))}"></audio>`) : ''}</div>`).join('') || `<p class="muted small">${esc(tt('Отзывов пока нет.', 'No feedback yet.'))}</p>`}</section>` : ''}
        </div>
        <div class="stack">
          ${ended ? '' : `<section class="card-ui stack live-qr"><img src="${u('/api/c/' + p.slug + '/qr.png?size=600')}" alt="${esc(tt('QR-код для входа во встречу', 'QR code to join the meeting'))}" width="300" height="300">
            <input type="text" readonly value="${esc(url)}" id="lurl" aria-label="${esc(tt('Ссылка для участников', 'Link for participants'))}">
            <div class="row"><button class="btn sm" type="button" data-qr>${ic.qr} ${esc(tt('QR на весь экран', 'Full-screen QR'))}</button></div></section>`}
          <section class="card-ui flat stack"><h2 style="margin:0;font-size:1.1rem">${esc(tt(`Участники · ${p.members.length}`, `Participants · ${p.members.length}`))}</h2>
            ${p.members.length ? `<ul class="live-members">${p.members.map((m) => `<li><span>${esc(m.name)}${m.role ? ` <span class="small muted">· ${esc(m.role === 'holder' ? tt('держатель карты', 'card holder') : tt('собеседник', 'partner'))}</span>` : ''}</span>
              ${ended ? '' : `<button class="linkbtn" type="button" data-remove="${m.id}" aria-label="${esc(tt('Убрать из группы', 'Remove from the group'))}: ${esc(m.name)}">${esc(tt('Убрать', 'Remove'))}</button>`}</li>`).join('')}</ul>` : `<p class="muted small">${esc(tt('Пока никого. Покажите QR — люди сканируют его телефоном.', 'Nobody yet. Show the QR code — people scan it with their phones.'))}</p>`}
            ${ended ? '' : p.facRole ? `<p class="small" style="margin:0">${esc(tt('Вы тоже участвуете в этом раунде — см. вкладку «Я участник».', 'You take part in this round too — see the “Me as participant” tab.'))}</p>` : `<p class="small muted" style="margin:0">${esc(tt('Если участников нечётное число, вы войдёте в раунд сами — на этом телефоне.', 'If the number is odd, you join the round yourself — on this phone.'))}</p>`}</section>
          ${ended ? '' : `<button class="btn danger" type="button" data-act="end">${esc(tt('Завершить встречу', 'End the meeting'))}</button>`}
        </div></div></div>`;
    wire(); runTimer();
  }
  function runTimer() {
    clearInterval(tick);
    if (p.status !== 'talk' || !p.talkEndsAt) return;
    const step = () => { const ms = left(p.talkEndsAt, skew); const el = pb.querySelector('[data-timer]'); if (el) el.textContent = mmss(ms); if (!playing()) bellsFor(p.id, p.round, ms, fired); if (ms <= 0) { clearInterval(tick); setTimeout(refresh, 1500); } };
    step(); tick = setInterval(step, 1000);
  }
  function wire() {
    pb.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.act;
      if (a === 'end') return act('end', {}, tt('Завершить встречу? Участники увидят благодарность и форму отзыва, QR освободится для новой группы.', 'End the meeting? Participants will see a thank-you and a feedback form; the QR code becomes free for a new group.'));
      if (a === 'talk') return act('talk', { minutes: Number(pb.querySelector('#mins').value) || p.roundMinutes });
      if (a === 'add_time') return act('add_time', { minutes: 5 });
      if (a === 'end_round') return act('end_round', {}, tt('Завершить раунд сейчас?', 'End the round now?'));
      act(a);
    }));
    pb.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => act('remove', { memberId: Number(b.dataset.remove) }, tt('Убрать участника из группы?', 'Remove this participant from the group?'))));
    const qr = pb.querySelector('[data-qr]'); if (qr) qr.addEventListener('click', () => showQr(p.slug, p.title, url));
    const lu = pb.querySelector('#lurl'); if (lu) lu.addEventListener('focus', () => lu.select());
    const sd = pb.querySelector('[data-sound]'); if (sd) sd.addEventListener('click', () => { unlockSound(); setTimeout(() => { draw(); play('b1'); }, 300); });
  }
  draw();
  void unsub;
}
