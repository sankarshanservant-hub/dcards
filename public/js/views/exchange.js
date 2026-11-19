// Обмен с другом (/x/<ссылка>), колокольчик (/bell), «Мои обмены», «Мои подборки» (18.11.2026).
import { lang } from '../i18n.js';
import { esc, tt, u, api, errorText, toast, storage, fmtDate, cityCase } from '../util.js';
import { ic, loading, failed, session } from '../ui.js';
import { openViewer } from '../viewer.js';
import { shareInvite, friendText, storyText, SLOGAN, sendButton, send, STORY_APPS, saveImage, openStoryApp } from '../share.js';
import { pushSupport, enablePush } from '../push.js';
import { storyCanvas } from '../story.js';
import * as personal from '../personal.js';

// «для Ани», «для Бориса»: простые правила склонения одного слова; не вышло — без имени
const forName = (n) => { const g = n && /^[А-ЯЁ][а-яё]+$/.test(n) ? cityCase(n, 'gen') : null; return g || (n && /^[A-Z][a-z]+$/.test(n) ? n : null); };
const when = (iso) => fmtDate(iso, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const cardBtn = (c, cls = '') => `<button type="button" class="live-card-btn ${cls}" data-zoom aria-label="${esc(tt('Рассмотреть карту', 'View card'))} ${esc(c.code)}"><img class="live-card" src="${esc(c.full || c.thumb)}" alt="${esc(c.code)}" width="${c.width || 910}" height="${c.height || 1560}"></button>`;
// сведения о карте (художник, номер) — не главная информация: компактно, за значком ⓘ
// вопрос другу (20.11.2026): стандартный — на языке интерфейса, изменённый — как написал отправитель
const DEFAULT_Q = 'Что тебе откликается в этой карте?';
const defaultQ = () => tt(DEFAULT_Q, 'What resonates with you in this card?');
const questionText = (q) => (!q || q === DEFAULT_Q ? defaultQ() : q);
const withInfo = (c, cls) => `<div class="card-with-info">${cardBtn(c, cls)}${authorLine(c)}</div>`;
const authorLine = (c) => `<details class="card-info"><summary aria-label="${esc(tt('Сведения о карте', 'About the card'))}" title="${esc(tt('Сведения о карте', 'About the card'))}"><span aria-hidden="true">i</span></summary><p class="small muted">${c.author ? `${esc(tt('Художник', 'Artist'))}: ${esc(c.author)} · ` : ''}${esc(c.code)}</p></details>`;
const cardShareUrl = (c) => `${location.origin}${u('/play/' + c.code)}`; // публичная ссылка карты: каждый начинает свой обмен
const playUrl = (c) => `${location.origin}${u('/play/' + c.code)}`;

export async function page(ctx, token) {
  loading(ctx.main);
  let v;
  const load = async () => { v = await api(`/api/x/${encodeURIComponent(token)}`); };
  try { await load(); } catch (e) {
    if (e.status === 404) { ctx.main.innerHTML = `<div class="wrap page narrow stack"><p class="empty">${esc(tt('Такого обмена нет. Возможно, ссылка скопирована не полностью.', 'There is no such exchange. The link may be incomplete.'))}</p><a class="btn yellow" href="${u('/library')}">${esc(tt('Выбрать карту', 'Choose a card'))}</a></div>`; return; }
    return failed(ctx.main, e, ctx.rerender);
  }
  if (!ctx.alive()) return;
  const ui = { preview: null, busy: false, err: '', wantStory: new URL(location.href).searchParams.get('story') === '1' };
  const AKEY = `dc_ans_${token}`; const TKEY = `dc_ansdraft_${token}`;
  let poll = null;

  async function preview() {
    if (ui.preview) return ui.preview;
    const me = v.role; const aName = me === 'a' ? v.myName : v.otherName; const bName = me === 'a' ? v.otherName : v.myName;
    const aText = me === 'a' ? v.myText : v.otherText; const bText = me === 'a' ? v.otherText : v.myText;
    const cv = await storyCanvas({ card: v.card, author: v.card.author, aName, aText, bName, bText });
    ui.preview = cv.toDataURL('image/png'); ui.canvas = cv; return ui.preview;
  }
  function storyHtml() {
    const s = v.story; if (!s) return '';
    const img = ui.preview ? `<img class="story-prev" src="${ui.preview}" alt="${esc(tt('Макет для сторис: карта и два ответа', 'Story layout: the card and two answers'))}">` : '';
    let inner;
    if (s.ready) {
      inner = `${img}<p style="margin:0"><b>${esc(tt('Поделиться в сторис', 'Share in stories'))}</b></p><p class="small" style="margin:0">${esc(tt('Вы оба согласились. Опубликовать могут один или оба — по желанию.', 'You both agreed. Either or both of you may post it.'))}</p>
        <ol class="story-steps">
          <li><span>${esc(tt('Сохрани картинку в «Фото»', 'Save the image to Photos'))}</span><button class="btn yellow" type="button" data-save-story>${esc(tt('Сохранить картинку', 'Save the image'))}</button>
            <span class="vb-note">${esc(tt('В открывшемся меню выбери «Сохранить изображение».', 'In the menu that opens, choose “Save Image”.'))}</span></li>
          <li><span>${esc(tt('Открой сторис и выбери эту картинку', 'Open stories and pick this image'))}</span><div class="story-apps">${STORY_APPS.map((a) => `<button class="story-app" type="button" data-story-app="${a.key}">${a.icon}<span>${esc(a.name)}</span></button>`).join('')}</div>
            <span class="vb-note">${esc(tt('Ссылка для стикера «Ссылка» скопируется сама: вставь её в стикер. Она ведёт к новой игре с этой картой, без ваших ответов.', 'The link for the “Link” sticker is copied automatically: paste it into the sticker. It starts a new game with this card, without your answers.'))}</span></li>
        </ol>
        <button class="link-btn" type="button" data-copy-play>${esc(tt('Скопировать ссылку для стикера', 'Copy the sticker link'))}</button>`;
    } else if (s.me === 'agreed') {
      const sentAsk = storage.get(`dc_story_sent_${v.id}`) === s.hash;
      inner = sentAsk
        ? `${img}<p style="margin:0"><b>${esc(tt('Ждём согласия друга', 'Waiting for your friend to agree'))}</b>${s.other === 'declined' ? ` · ${esc(tt('друг решил не публиковать', 'your friend chose not to post'))}` : ''}</p>
          <p class="vb-note">${esc(tt('Пока согласия нет, можно поделиться только картой.', 'Until your friend agrees, you can share only the card.'))}</p><button class="link-btn" type="button" data-sst-send>${esc(tt('Отправить ссылку ещё раз', 'Send the link again'))}</button>`
        : `${img}<p style="margin:0"><b>${esc(tt('Отправь другу ссылку на этот макет', 'Send your friend a link to this layout'))}</b></p>
          <p class="vb-note">${esc(tt('Друг посмотрит макет и решит, согласен ли он. Сторис с ответами можно будет сохранить после согласия обоих.', 'Your friend will see the layout and decide. Stories with your answers can be saved once you both agree.'))}</p>${sendButton('data-sst-send', tt('Отправить другу', 'Send to your friend'))}`;
    } else if (s.proposedBy === 'other' && !s.me) {
      inner = `${img || `<button class="btn" type="button" data-show-preview>${esc(tt('Показать макет', 'Show layout'))}</button>`}
        <p style="margin:0"><b>${esc(tt('Тебе предложили поделиться ответами в сторис', 'You were invited to share your answers in stories'))}</b></p>
        <div class="row"><button class="btn yellow" type="button" data-agree ${img ? '' : 'disabled'}>${esc(tt('Согласен поделиться в сторис', 'I agree to share in stories'))}</button><button class="btn light" type="button" data-decline>${esc(tt('Не сейчас', 'Not now'))}</button></div>`;
    } else if (s.me === 'declined') {
      inner = `<p class="vb-note" style="margin:0">${esc(tt('Вы решили не делиться ответами в сторис. Поделиться можно только картой.', 'You chose not to share your answers. You can share just the card.'))}</p><button class="link-btn" type="button" data-show-preview>${esc(tt('Передумали? Посмотреть макет', 'Changed your mind? See the layout'))}</button>${img ? `${img}<div class="row"><button class="btn yellow" type="button" data-agree>${esc(tt('Согласен поделиться в сторис', 'I agree to share in stories'))}</button></div>` : ''}`;
    } else {
      inner = ui.preview ? `${img}<p class="vb-note">${esc(tt('Так увидят люди. Подтверждая, вы соглашаетесь именно на этот макет; друг тоже должен согласиться.', 'This is what people will see. By confirming you agree to exactly this layout; your friend must agree too.'))}</p>
        <div class="row"><button class="btn yellow" type="button" data-propose>${esc(tt('Подтвердить и предложить другу', 'Confirm and invite your friend'))}</button><button class="link-btn" type="button" data-hide-preview>${esc(tt('Отмена', 'Cancel'))}</button></div>`
        : `<button class="btn" type="button" data-show-preview>${esc(tt('Предложить поделиться в сторис', 'Suggest sharing in stories'))}</button>`;
    }
    return `<details class="card-ui stack x-story" id="story" ${ui.preview || ui.wantStory || s.ready || s.proposedBy === 'other' ? 'open' : ''}><summary><b>${esc(tt('Сторис с двумя ответами', 'Stories with both answers'))}</b> <span class="small muted">· ${esc(tt('по желанию', 'optional'))}</span></summary>${inner}
      ${s.ready ? '' : `<button class="link-btn" type="button" data-share-card>${esc(tt('Поделиться только картой', 'Share just the card'))}</button>`}</details>`;
  }
  function draw() {
    clearInterval(poll);
    const c = v.card; let body;
    if (v.role === 'stranger') {
      body = `${withInfo(c)}<div class="notice">${esc(tt('Это приглашение уже использовано или открыто в другом браузере. Если это ваш обмен — войдите в аккаунт или откройте свою личную ссылку.', 'This invitation has already been used or opened in another browser. If it is your exchange, sign in or open your personal link.'))}</div>
        <a class="btn yellow" href="${u('/play/' + c.code)}">${esc(tt('Начать свой обмен с этой картой', 'Start your own exchange with this card'))}</a>`;
    } else if (v.role === 'invitee') {
      const dr = storage.get(TKEY) || '';
      body = `${v.round > 1 ? `<p class="eyebrow" style="margin:0">${esc(tt(`Ответная карта · раунд ${v.round}`, `A card in reply · round ${v.round}`))}</p>` : ''}<p class="x-asks">${esc(v.fromName && v.fromName !== 'Друг' ? tt(`${v.fromName} спрашивает:`, `${v.fromName} asks:`) : tt('Тебя спрашивают:', 'You are asked:'))}</p><h1 class="x-h x-question">${esc(questionText(v.question))}</h1>${withInfo(c, 'sm')}
        <div class="locked">${ic.lock} ${esc(tt('Ответ друга откроется, когда ответишь ты', 'Your friend’s answer opens once you answer'))}</div>
        <form class="form" id="xa"><label class="field" for="xt">${esc(tt('Твой ответ', 'Your answer'))}</label>
          <textarea id="xt" maxlength="300" rows="3" placeholder="${esc(tt('Напиши пару слов', 'Write a few words'))}" required>${esc(dr)}</textarea>
          ${session.user ? '' : `<label class="field small">${esc(tt('Твоё имя', 'Your name'))} <span class="hint">${esc(tt('по желанию — его увидит друг', 'optional — your friend will see it'))}</span><input id="xn" maxlength="40" value="${esc(storage.get('dc_live_name') || '')}" autocomplete="given-name"></label>`}
          ${ui.err ? `<p class="field-error" role="alert">${esc(ui.err)}</p>` : ''}
          <button class="btn yellow big" type="submit" ${ui.busy ? 'disabled' : ''}>${esc(ui.busy ? tt('Отправляем…', 'Sending…') : tt('Ответить и увидеть ответ друга', 'Answer and see your friend’s answer'))}</button></form>
        <p class="vb-note">${esc(SLOGAN())} ${esc(tt('Регистрация не нужна.', 'No sign-up needed.'))}</p>`;
    } else if (!v.answered) {
      body = `<h1 class="x-h">${esc(tt('Ждём ответа друга', 'Waiting for your friend'))}</h1>${withInfo(c)}
        <div class="pair one"><div><b>${esc(tt('Твой ответ', 'Your answer'))}</b>${esc(v.myText)}</div></div>
        <p class="vb-note">${esc(tt('Друг увидит твой ответ, когда напишет свой. Когда он ответит, здесь появятся оба ответа, а в колокольчике — уведомление.', 'Your friend will see your answer once they write theirs. Then both answers appear here and in the bell.'))}</p>
        ${sendButton('data-sinv-send', tt('Отправить приглашение ещё раз', 'Send the invitation again'))}
        ${notifyHtml()}
        ${backLinkHtml()}`;
      poll = setInterval(async () => { if (!ctx.alive()) return clearInterval(poll); if (document.visibilityState !== 'visible' || navigator.onLine === false) return; try { await load(); if (v.answered) draw(); } catch { /* */ } }, 15000);
    } else {
      const other = v.otherName && v.otherName !== 'Друг' ? v.otherName : '';
      const nextRound = (v.rounds || []).some((r) => r.round > v.round); // следующий раунд уже начат — кнопка не нужна
      const rounds = (v.rounds || []).length > 1 ? `<nav class="rounds small" aria-label="${esc(tt('Раунды разговора', 'Rounds of the conversation'))}">${v.rounds.map((r) => r.current ? `<b>${esc(tt(`Раунд ${r.round}`, `Round ${r.round}`))}</b>` : r.secret ? `<a href="${u('/x/' + r.secret)}">${esc(tt(`Раунд ${r.round}`, `Round ${r.round}`))}${r.answered ? '' : ' · ' + esc(tt('ждёт ответа', 'waiting'))}</a>` : `<span class="muted">${esc(tt(`Раунд ${r.round}`, `Round ${r.round}`))}</span>`).join(' · ')}</nav>` : '';
      body = `${rounds}<h1 class="x-h">${esc(tt('Одна карта — два взгляда', 'One card — two views'))}</h1>${withInfo(c, 'sm')}<p class="x-asked"><span class="muted">${esc(tt('Вопрос', 'Question'))}:</span> ${esc(questionText(v.question))}</p>
        <div class="pair"><div><b>${esc(v.myName || tt('Ты', 'You'))}</b>${esc(v.myText)}</div><div><b>${esc(v.otherName || tt('Друг', 'Friend'))}</b>${esc(v.otherText)}</div></div>
        <div class="x-next">
          ${v.role === 'b' && !nextRound ? `<a class="btn yellow big" href="${u('/play?reply=' + encodeURIComponent(v.secret))}">${esc(other && forName(other) ? tt(`Твоя очередь — выбрать карту для ${forName(other)}`, `Your turn — choose a card for ${other}`) : tt('Твоя очередь — ответить своей картой', 'Your turn — reply with your card'))}</a>`
            : !nextRound ? `<p class="vb-note" style="margin:0">${esc(other ? tt(`Теперь очередь собеседника (${other}): он может ответить своей картой — она придёт сюда и в колокольчик.`, `Now it is ${other}’s turn: they can reply with their own card — it will arrive here and in the bell.`) : tt('Теперь очередь собеседника: он может ответить своей картой — она придёт сюда и в колокольчик.', 'Now it is your partner’s turn: they can reply with their own card — it will arrive here and in the bell.'))}</p>` : ''}
          <a class="btn" href="${u('/play/' + c.code + '?origin=forward')}">${esc(tt('Отправить эту карту ещё кому-то', 'Send this card to someone else'))}</a>
        </div>
        ${storyHtml()}
        <nav class="x-more"><a href="${u('/about')}">${esc(tt('Что такое Dialogue Cards?', 'What is Dialogue Cards?'))}</a><a href="${u('/meetings')}">${esc(tt('Найти встречу в своём городе', 'Find a meeting in your city'))}</a><a href="${u('/me/exchanges')}">${esc(tt('Мои обмены', 'My exchanges'))}</a></nav>
        ${backLinkHtml()}`;
    }
    ctx.main.innerHTML = `<div class="wrap page narrow stack x-page">${body}</div>`;
    wire();
  }
  const backLinkHtml = () => (v.secret ? `<details class="small"><summary>${esc(tt('Моя ссылка, чтобы вернуться', 'My link to come back'))}</summary><p class="vb-note">${esc(tt('Личная ссылка — откроет этот обмен в любом браузере. Не пересылайте её. Без неё обмен виден в этом браузере, а после входа — на всех ваших устройствах.', 'A personal link — it opens this exchange in any browser. Do not forward it. Without it the exchange is visible in this browser, and after sign-in on all your devices.'))}</p><button class="btn sm light" type="button" data-copy-back>${esc(tt('Скопировать мою ссылку', 'Copy my link'))}</button></details>` : '');
  async function storyAct(action) {
    ui.busy = true;
    try { const r = await api(`/api/x/${encodeURIComponent(token)}/story`, { method: 'POST', body: { action, hash: v.story.hash } }); v = r.exchange; }
    catch (x) { toast(x.code === 'story_changed' ? tt('Макет изменился — посмотрите его ещё раз', 'The layout changed — please look at it again') : errorText(x)); ui.preview = null; await load(); }
    ui.busy = false; draw();
    const st = ctx.main.querySelector('#story'); if (st) st.scrollIntoView({ block: 'start' });
  }
  function wire() {
    const $ = (q) => ctx.main.querySelector(q);
    const z = $('[data-zoom]'); if (z) z.onclick = () => openViewer({ cards: [v.card], index: 0, mode: 'admin' });
    const f = $('#xa');
    if (f) {
      f.xt.addEventListener('input', () => storage.set(TKEY, f.xt.value));
      f.onsubmit = async (e) => {
        e.preventDefault(); const text = f.xt.value.trim(); if (!text) return;
        const name = f.xn ? f.xn.value.trim() : ''; if (name) storage.set('dc_live_name', name);
        let key = storage.get(AKEY); if (!key) { key = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/[^A-Za-z0-9_-]/g, ''); storage.set(AKEY, key); }
        ui.busy = true; ui.err = ''; draw();
        try { const r = await api(`/api/x/${encodeURIComponent(token)}/answer`, { method: 'POST', body: { text, name, answerKey: key } }); v = r.exchange; storage.set(TKEY, ''); window.dcRefreshBell && window.dcRefreshBell(true); }
        catch (x) { ui.err = x.code === 'exchange_taken' ? tt('На это приглашение уже ответил другой человек.', 'Someone else has already answered this invitation.') : `${errorText(x)} ${tt('Ответ сохранён — нажмите ещё раз.', 'Your answer is kept — press again.')}`; if (x.code === 'exchange_taken') await load(); }
        ui.busy = false; draw(); window.scrollTo(0, 0);
      };
    }
    const si = $('[data-sinv-send]'); if (si) si.onclick = async () => { const k = await send(`${location.origin}${u('/x/' + v.invite)}`, friendText()); if (k) markSent(v.secret, k); };
    const ss2 = $('[data-sst-send]'); if (ss2) ss2.onclick = async () => { const k = await send(`${location.origin}${u('/x/' + v.story.otherDoor + '?story=1')}`, storyText()); if (k) { storage.set(`dc_story_sent_${v.id}`, v.story.hash); draw(); } };
    ctx.main.querySelectorAll('[data-story-app]').forEach((b) => b.onclick = async () => { try { await navigator.clipboard.writeText(playUrl(v.card)); toast(tt('Ссылка для стикера скопирована', 'Sticker link copied')); } catch { /* */ } setTimeout(() => openStoryApp(b.dataset.storyApp), 400); });
    const cb = $('[data-copy-back]'); if (cb) cb.onclick = () => shareInvite('copy', `${location.origin}${u('/x/' + v.secret)}`, '', tt('Личная ссылка скопирована — сохраните её', 'Personal link copied — keep it'));
    const sc = $('[data-share-card]'); if (sc) sc.onclick = () => shareInvite(navigator.share ? 'sys' : 'copy', cardShareUrl(v.card), `${SLOGAN()} ${v.card.code}${v.card.author ? ' · ' + v.card.author : ''}`);
    wireNotify(ctx.main);
    const sp = $('[data-show-preview]'); if (sp) sp.onclick = async () => { sp.disabled = true; await preview(); draw(); const st = $('#story'); if (st) st.scrollIntoView({ block: 'start' }); };
    const hp = $('[data-hide-preview]'); if (hp) hp.onclick = () => { ui.preview = null; draw(); };
    const pr = $('[data-propose]'); if (pr) pr.onclick = () => storyAct('propose');
    const ag = $('[data-agree]'); if (ag) ag.onclick = () => storyAct('agree');
    const dc = $('[data-decline]'); if (dc) dc.onclick = () => storyAct('decline');
    const cp = $('[data-copy-play]'); if (cp) cp.onclick = () => shareInvite('copy', playUrl(v.card), '', tt('Ссылка для стикера скопирована', 'Sticker link copied'));
    const ss = $('[data-save-story]');
    if (ss) ss.onclick = async () => {
      await preview();
      const blob = await new Promise((res) => ui.canvas.toBlob(res, 'image/png'));
      await saveImage(blob, `d-cards-${v.card.code}.png`); // только картинка, без текста — так в меню больше приложений
    };
  }
  if (v.story && (ui.wantStory || v.story.ready || v.story.me === 'agreed' || v.story.proposedBy === 'other')) { try { await preview(); } catch { /* без макета */ } }
  if (!ctx.alive()) return;
  draw();
  if (ui.wantStory) { const st = ctx.main.querySelector('#story'); if (st) st.scrollIntoView({ block: 'start' }); }
}

const markSent = (secret, via) => api(`/api/x/${encodeURIComponent(secret)}/sent`, { method: 'POST', body: { via } }).catch(() => {});

// «Сообщить, когда друг ответит?» — только по действию человека и с учётом того, что умеет браузер
function notifyHtml() {
  const sup = pushSupport();
  let inner;
  if (!session.user) inner = `<p class="vb-note">${esc(tt('Ответ появится здесь и в колокольчике этого браузера. Чтобы получать уведомление на телефон, войдите — займёт минуту.', 'The answer will appear here and in this browser’s bell. To get a phone notification, sign in — it takes a minute.'))}</p><a class="btn sm light" href="${u('/login?next=' + encodeURIComponent(location.pathname))}">${esc(tt('Войти', 'Sign in'))}</a>`;
  else if (sup === 'ios-home') inner = `<p class="vb-note">${esc(tt('На iPhone уведомления приходят, если добавить D-Cards на экран «Домой» (Поделиться → На экран «Домой») и открыть оттуда. Без этого ответ будет в колокольчике.', 'On iPhone, notifications work if you add D-Cards to the Home Screen (Share → Add to Home Screen) and open it from there. Otherwise the answer will be in the bell.'))}</p>`;
  else if (sup === 'unsupported') inner = `<p class="vb-note">${esc(tt('Этот браузер не умеет уведомления — ответ будет в колокольчике.', 'This browser cannot show notifications — the answer will be in the bell.'))}</p>`;
  else if (sup === 'granted') inner = `<p class="vb-note">${esc(tt('Уведомления включены — сообщим, когда друг ответит.', 'Notifications are on — we will let you know when your friend answers.'))}</p>`;
  else if (sup === 'denied') inner = `<p class="vb-note">${esc(tt('Уведомления запрещены в настройках браузера — ответ будет в колокольчике.', 'Notifications are blocked in browser settings — the answer will be in the bell.'))}</p>`;
  else inner = `<button class="btn sm" type="button" data-notify-on>${ic.bell} ${esc(tt('Включить уведомления', 'Turn on notifications'))}</button>`;
  return `<div class="x-notify"><b>${esc(tt('Сообщить, когда друг ответит?', 'Let you know when your friend answers?'))}</b>${inner}</div>`;
}
function wireNotify(root) {
  const b = root.querySelector('[data-notify-on]'); if (!b) return;
  b.onclick = async () => {
    b.disabled = true;
    try { const k = await api('/api/push'); const r = await enablePush(k.publicKey); toast(r === 'on' ? tt('Уведомления включены', 'Notifications on') : tt('Уведомления не включены', 'Notifications not enabled')); }
    catch { toast(tt('Не удалось включить уведомления — ответ будет в колокольчике.', 'Could not turn on notifications — the answer will be in the bell.')); }
    const box = b.closest('.x-notify'); if (box) box.outerHTML = notifyHtml();
  };
}

// ---------- «Сыграть с другом»: сразу случайная (или выбранная) карта, отклик и отправка ----------
// /play — случайная карта; /play/<код> — эта карта (публичная ссылка); ?reply=<личная ссылка> — «Твоя очередь» в том же
// разговоре; ?origin=forward — эту карту ещё кому-то (отдельный обмен). Черновик принадлежит своей карте.
const PKEY = 'dc_play_drafts';
export async function playPage(ctx, code) {
  const reply = ctx.query.get('reply');
  // без выбранной карты — вся галерея в режиме «Вопрос другу» (случайную карту не подставляем)
  if (!code) { ctx.navigate('/library?play=friend' + (reply ? '&reply=' + encodeURIComponent(reply) : ''), { replace: true }); return; }
  loading(ctx.main);
  let cards; let parent = null; const origin = ctx.query.get('origin') === 'forward' ? 'forward' : code ? 'public' : 'fresh';
  try {
    ({ cards } = await api('/api/cards'));
    if (reply) parent = await api(`/api/x/${encodeURIComponent(reply)}`);
  } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  cards = cards.filter((c) => !c.isDemo || session.showDemo);
  const drafts = (() => { try { return JSON.parse(sessionStorage.getItem(PKEY) || '{}'); } catch { return {}; } })();
  const keep = () => { try { sessionStorage.setItem(PKEY, JSON.stringify(drafts)); } catch { /* */ } };
  const pick = (avoid) => { const pool = cards.filter((c) => c.code !== avoid); return pool[Math.floor(Math.random() * pool.length)]; };
  let card = (code && cards.find((c) => c.code === code)) || (sessionStorage.getItem('dc_play_card') && cards.find((c) => c.code === sessionStorage.getItem('dc_play_card'))) || pick();
  if (!card) { ctx.main.innerHTML = `<div class="wrap page narrow"><p class="empty">${esc(tt('В галерее пока нет карт.', 'No cards yet.'))}</p></div>`; return; }
  const other = parent && parent.otherName && parent.otherName !== 'Друг' ? parent.otherName : '';
  const ui = { sending: false, err: '', sent: null };
  const draw = () => {
    try { sessionStorage.setItem('dc_play_card', card.code); } catch { /* */ }
    const dr = drafts[card.code] || {};
    if (ui.sent) {
      const s = ui.sent;
      ctx.main.innerHTML = `<div class="wrap page narrow stack x-page">
        <h1 class="x-h">${esc(reply ? tt('Карта отправлена', 'Card sent') : tt('Отправь приглашение другу', 'Send the invitation to your friend'))}</h1>
        <div class="row" style="justify-content:center">${cardBtn(card, 'xs')}</div>
        ${reply ? `<p>${esc(other ? tt(`${other} увидит новую карту в колокольчике и в «Моих обменах».`, `${other} will see the new card in the bell and in “My exchanges”.`) : tt('Собеседник увидит новую карту в колокольчике и в «Моих обменах».', 'Your partner will see the new card in the bell and in “My exchanges”.'))}</p>
          <p class="vb-note">${esc(tt('Можно также отправить её в ваш прежний чат:', 'You can also send it to your previous chat:'))}</p>`
          : `<p class="vb-note">${esc(tt('Выбери, где отправить, и подтверди отправку там. Друг увидит твой ответ, когда напишет свой.', 'Choose where to send it and confirm there. Your friend will see your answer once they write theirs.'))}</p>`}
        ${sendButton('data-psh-send', reply ? tt('Отправить в наш чат', 'Send to our chat') : tt('Отправить другу', 'Send to a friend'))}
        ${notifyHtml()}
        <details class="small"><summary>${esc(tt('Моя ссылка, чтобы вернуться', 'My link to come back'))}</summary><p class="vb-note">${esc(tt('Личная ссылка — не пересылай её другу.', 'A personal link — do not forward it.'))}</p><button class="btn sm light" type="button" data-pback>${esc(tt('Скопировать мою ссылку', 'Copy my link'))}</button></details>
        <div class="row"><a class="btn" href="${u('/x/' + s.secret)}">${esc(tt('Открыть обмен', 'Open the exchange'))}</a><a class="btn light" href="${u('/')}">${esc(tt('На главную', 'Home'))}</a></div></div>`;
      ctx.main.querySelector('[data-psh-send]').onclick = async () => { const k = await send(`${location.origin}${u('/x/' + s.invite)}`, friendText()); if (k) markSent(s.secret, k); };
      ctx.main.querySelector('[data-pback]').onclick = () => shareInvite('copy', `${location.origin}${u('/x/' + s.secret)}`, '', tt('Личная ссылка скопирована — сохраните её', 'Personal link copied — keep it'));
      wireNotify(ctx.main); return;
    }
    ctx.main.innerHTML = `<div class="wrap page narrow stack x-page">
      ${reply ? `<p class="eyebrow" style="margin:0">${esc(tt('Твоя очередь', 'Your turn'))}</p>` : ''}
      <h1 class="x-h">${esc(reply ? (other && forName(other) ? tt(`Карта для ${forName(other)}: что ты здесь видишь?`, `A card for ${other}: what do you see here?`) : tt('Ответь своей картой: что ты здесь видишь?', 'Reply with your card: what do you see here?')) : tt('Что ты здесь видишь?', 'What do you see here?'))}</h1>
      ${withInfo(card, 'sm')}
      <div class="row" style="justify-content:center"><button class="btn sm light" type="button" data-other>${esc(tt('Другая карта', 'Another card'))}</button><a class="btn sm light" href="${u('/library?play=friend' + (reply ? '&reply=' + encodeURIComponent(reply) : ''))}">${esc(tt('Все карты', 'All cards'))}</a></div>
      <form class="form" id="pf"><label class="field" for="pq">${esc(tt('Вопрос другу', 'Question to your friend'))} <span class="hint">${esc(tt('можно изменить', 'you can edit it'))}</span></label>
        <textarea id="pq" class="ask-q" maxlength="200" rows="2">${esc(dr.q != null ? dr.q : defaultQ())}</textarea>
        <label class="field" for="pt">${esc(tt('Твой ответ', 'Your answer'))}</label>
        <textarea id="pt" maxlength="300" rows="3" placeholder="${esc(tt('Напиши пару слов', 'Write a few words'))}">${esc(dr.text || '')}</textarea>
        ${session.user || reply ? '' : `<label class="field small">${esc(tt('Твоё имя для друга', 'Your name for your friend'))} <span class="hint">${esc(tt('по желанию', 'optional'))}</span><input id="pn" maxlength="40" value="${esc(storage.get('dc_live_name') || '')}" autocomplete="given-name"></label>`}
        <p class="vb-note" style="margin:0">${esc(tt('Друг увидит твой ответ, когда напишет свой.', 'Your friend will see your answer once they write theirs.'))}</p>
        ${ui.err ? `<p class="field-error" role="alert">${esc(ui.err)}</p>` : ''}
        <button class="btn yellow big" type="submit" ${ui.sending || !String(dr.text || '').trim() ? 'disabled' : ''}>${esc(ui.sending ? tt('Готовим приглашение…', 'Preparing…') : reply ? tt('Отправить карту', 'Send the card') : tt('Отправить другу', 'Send to a friend'))}</button></form></div>`;
    const f = ctx.main.querySelector('#pf');
    f.pt.addEventListener('input', () => { drafts[card.code] = { ...(drafts[card.code] || {}), text: f.pt.value }; keep(); f.querySelector('[type=submit]').disabled = ui.sending || !f.pt.value.trim(); });
    f.pq.addEventListener('input', () => { drafts[card.code] = { ...(drafts[card.code] || {}), q: f.pq.value }; keep(); });
    f.pt.addEventListener('focus', () => setTimeout(() => f.pt.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250)); // клавиатура не закрывает поле
    ctx.main.querySelector('[data-zoom]').onclick = () => openViewer({ cards: [card], index: 0, mode: 'admin' });
    // автор иллюстрации: в списке галереи его нет — берём из сведений карты
    if (!card.author) api(`/api/cards/${encodeURIComponent(card.code)}`).then((d) => { if (d.author) { card.author = d.author; const al = ctx.main.querySelector('.x-page .card-info'); if (al) al.outerHTML = authorLine(card); } }).catch(() => {});
    ctx.main.querySelector('[data-other]').onclick = () => { card = pick(card.code); draw(); }; // черновик остаётся у своей карты
    f.onsubmit = async (e) => {
      e.preventDefault(); const d = drafts[card.code] || {}; const text = String(d.text || '').trim(); if (!text) return;
      const name = f.pn ? f.pn.value.trim() : ''; if (name) storage.set('dc_live_name', name);
      // пустой вопрос или из пробелов — стандартный; стандартный на любом языке хранится как стандартный
      const q0 = f.pq.value.replace(/\s+/g, ' ').trim(); const question = !q0 || q0 === defaultQ() ? '' : q0;
      d.key = d.key || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9_-]/g, '');
      drafts[card.code] = d; keep(); ui.sending = true; ui.err = ''; draw();
      try {
        const r = reply ? await api(`/api/x/${encodeURIComponent(reply)}/reply`, { method: 'POST', body: { code: card.code, text, question, clientKey: d.key } })
          : await api('/api/exchanges', { method: 'POST', body: { code: card.code, text, name, question, clientKey: d.key, origin } });
        ui.sent = r; delete drafts[card.code]; keep(); try { sessionStorage.removeItem('dc_play_card'); } catch { /* */ }
      } catch (x) { ui.err = `${errorText(x)} ${tt('Текст сохранён — попробуйте ещё раз.', 'Your text is kept — try again.')}`; }
      ui.sending = false; draw(); window.scrollTo(0, 0);
    };
  };
  draw();
}

// ---------- колокольчик ----------
export async function bellPage(ctx) {
  loading(ctx.main);
  let d;
  try { d = await api('/api/bell'); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  const upd = session.update;
  ctx.main.innerHTML = `<div class="wrap page narrow stack">
    <div class="row between"><h1 style="margin:0">${esc(tt('Уведомления', 'Notifications'))}</h1>${d.unread ? `<button class="btn sm light" type="button" id="allread">${esc(tt('Отметить все как прочитанные', 'Mark all as read'))}</button>` : ''}</div>
    ${session.user ? '' : `<p class="vb-note">${esc(tt('Это история этого браузера. Войдите, чтобы видеть её на всех своих устройствах.', 'This is this browser’s history. Sign in to see it on all your devices.'))}</p>`}
    ${upd ? `<div class="bell-item unread"><span class="x-dot on" aria-hidden="true"></span><span class="grow"><b>${esc(tt('Доступно обновление приложения', 'An app update is available'))}</b></span><button class="btn sm yellow" type="button" id="reload">${esc(tt('Обновить', 'Update'))}</button></div>` : ''}
    ${d.items.length ? `<ul class="bell-list">${d.items.map((n) => `<li><a class="bell-item ${n.read ? '' : 'unread'}" href="${u(n.url || '/')}" data-n="${n.id}">
        <span class="x-dot ${n.read ? '' : 'on'}" aria-hidden="true"></span>
        <span class="grow"><b>${esc(n.title)}</b>${n.body ? `<span class="small">${esc(n.body)}</span>` : ''}${n.resolved ? `<span class="small muted">${esc(tt('решено', 'resolved'))}</span>` : ''}</span>
        <time class="small muted" datetime="${esc(n.updatedAt)}">${esc(when(n.updatedAt))}</time><span class="sr-only">${esc(n.read ? tt('прочитано', 'read') : tt('не прочитано', 'unread'))}</span></a></li>`).join('')}</ul>`
      : !upd ? `<p class="empty">${esc(tt('Здесь появятся ответы друзей и другие важные события.', 'Your friends’ answers and other important events will appear here.'))}</p>` : ''}
    <p class="small muted">${esc(tt('Push-уведомления на телефон настраиваются отдельно — история здесь ведётся и без них.', 'Phone push notifications are set up separately — this history is kept without them.'))} ${session.user ? `<a href="${u('/me/notifications')}">${esc(tt('Настройки', 'Settings'))}</a>` : ''}</p>
  </div>`;
  const ar = ctx.main.querySelector('#allread');
  if (ar) ar.onclick = async () => { await api('/api/bell/read', { method: 'POST', body: { all: true } }).catch(() => {}); window.dcRefreshBell && window.dcRefreshBell(true); ctx.rerender(); };
  const rl = ctx.main.querySelector('#reload'); if (rl) rl.onclick = () => location.reload();
  ctx.main.querySelectorAll('[data-n]').forEach((a) => a.addEventListener('click', () => { api('/api/bell/read', { method: 'POST', body: { ids: [Number(a.dataset.n)] } }).then(() => window.dcRefreshBell && window.dcRefreshBell(true)).catch(() => {}); }));
}

// ---------- мои обмены ----------
export async function myExchanges(ctx) {
  loading(ctx.main);
  let d;
  try { d = await api('/api/exchanges'); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  ctx.main.innerHTML = `<div class="wrap page narrow stack"><h1 style="margin:0">${esc(tt('Мои обмены', 'My exchanges'))}</h1>
    ${session.user ? '' : `<p class="vb-note">${esc(tt('Обмены этого браузера. Если очистить данные браузера, они пропадут отсюда; войдите, чтобы видеть их на других устройствах.', 'Exchanges of this browser. Clearing browser data removes them from here; sign in to see them on other devices.'))}</p>`}
    ${d.exchanges.length ? `<div class="list">${d.exchanges.map((x) => `<a class="item" href="${u('/x/' + x.secret)}"><img src="${esc(x.thumb)}" alt="" width="44" height="75" style="border-radius:8px;flex:none">
      <span class="body"><b>${esc(x.answered ? (x.storyAsk ? tt('Предложили сторис', 'Stories invitation') : tt('Два взгляда', 'Two views')) : tt('Ждём ответа', 'Waiting for an answer'))}</b>
      <span class="small">${esc(x.code)}${x.otherName ? ` · ${esc(x.otherName)}` : ''} · ${esc(when(x.createdAt))}${x.role === 'b' ? ` · ${esc(tt('вас пригласили', 'you were invited'))}` : ''}</span></span><span aria-hidden="true">→</span></a>`).join('')}</div>`
      : `<p class="empty">${esc(tt('Обменов пока нет. Выбери карту и отправь её другу.', 'No exchanges yet. Choose a card and send it to a friend.'))}</p><a class="btn yellow" href="${u('/library?play=friend')}">${esc(tt('Отправить другу с вопросом', 'Send to a friend with a question'))}</a>`}</div>`;
}

// ---------- мои подборки ----------
export async function myCollections(ctx) {
  loading(ctx.main);
  let s; let cards;
  try { [s, { cards }] = await Promise.all([personal.load(true), api('/api/cards')]); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  const by = new Map(cards.map((c) => [c.code, c]));
  const open = ctx.query.get('c');
  const draw = () => {
    const cur = open && s.collections.find((c) => String(c.id) === open);
    if (cur) {
      const list = cur.codes.map((k) => by.get(k)).filter(Boolean);
      ctx.main.innerHTML = `<div class="wrap page stack"><a class="small" href="${u('/me/collections')}">← ${esc(tt('Мои подборки', 'My collections'))}</a>
        <div class="row between"><h1 style="margin:0">${esc(cur.favorites ? tt('Избранное', 'Favourites') : cur.title)}</h1><span class="muted">${list.length} / ${personal.MAX_CARDS}</span></div>
        <div class="row">${list.length >= 2 ? `<a class="btn yellow sm" href="${u('/group?collection=' + encodeURIComponent(cur.id))}">${ic.people} ${esc(tt('Играть с друзьями', 'Play with friends'))}</a>` : ''}
          ${cur.favorites ? '' : `<button class="btn sm light" type="button" id="ren">${esc(tt('Переименовать', 'Rename'))}</button><button class="btn sm light" type="button" id="del">${esc(tt('Удалить подборку', 'Delete collection'))}</button>`}</div>
        ${list.length ? `<div class="grid">${list.map((c, i) => `<div class="cell"><button class="tile" type="button" data-i="${i}" aria-label="${esc(c.code)}"><img src="${esc(c.thumb)}" alt="" loading="lazy"></button>
          <button class="mini-btn r" type="button" data-rm="${esc(c.code)}" aria-label="${esc(cur.favorites ? tt('Убрать из избранного', 'Remove from favourites') : tt('Убрать из этой подборки', 'Remove from this collection'))}" title="${esc(cur.favorites ? tt('Убрать из избранного', 'Remove from favourites') : tt('Убрать из подборки', 'Remove from collection'))}">${ic.x}</button></div>`).join('')}</div>`
          : `<p class="empty">${esc(tt('Здесь пока пусто. Нажми на сердце у карты в галерее.', 'Empty for now. Tap the heart on a card in the gallery.'))}</p>`}</div>`;
      ctx.main.querySelectorAll('[data-i]').forEach((b) => b.onclick = () => openViewer({ cards: list, index: Number(b.dataset.i), mode: 'library' }));
      ctx.main.querySelectorAll('[data-rm]').forEach((b) => b.onclick = async () => { await personal.toggle(cur.id, b.dataset.rm, false).catch((x) => toast(errorText(x))); draw(); });
      const rn = ctx.main.querySelector('#ren'); if (rn) rn.onclick = async () => { const t0 = prompt(tt('Новое название', 'New name'), cur.title); if (t0 && t0.trim()) { await personal.renameCollection(cur.id, t0); draw(); } };
      const dl = ctx.main.querySelector('#del'); if (dl) dl.onclick = async () => { if (confirm(tt('Удалить подборку? Карты останутся в галерее и в избранном.', 'Delete the collection? The cards stay in the gallery and in favourites.'))) { await personal.deleteCollection(cur.id); ctx.navigate('/me/collections'); } };
      return;
    }
    ctx.main.innerHTML = `<div class="wrap page stack"><h1 style="margin:0">${esc(tt('Мои подборки', 'My collections'))}</h1>
      ${s.server ? '' : `<p class="vb-note">${esc(tt('Сохранено в этом браузере. Войдите, чтобы видеть на других устройствах.', 'Saved in this browser. Sign in to see them on other devices.'))}</p>`}
      <form class="row" id="nc"><label class="sr-only" for="nct">${esc(tt('Название новой подборки', 'New collection name'))}</label><input id="nct" maxlength="80" placeholder="${esc(tt('Новая подборка…', 'New collection…'))}" style="flex:1;min-width:0"><button class="btn sm" type="submit">${esc(tt('Создать', 'Create'))}</button></form>
      <div class="list">${s.collections.map((c) => `<a class="item" href="${u('/me/collections?c=' + encodeURIComponent(c.id))}"><span class="mini-strip">${c.codes.slice(0, 4).map((k) => by.get(k)).filter(Boolean).map((k) => `<img src="${esc(k.thumb)}" alt="">`).join('') || `<span class="muted small">—</span>`}</span>
        <span class="body"><b>${esc(c.favorites ? tt('Избранное', 'Favourites') : c.title)}</b><span class="small">${c.codes.length} ${esc(tt('карт', 'cards'))}</span></span><span aria-hidden="true">→</span></a>`).join('')}</div></div>`;
    ctx.main.querySelector('#nc').onsubmit = async (e) => { e.preventDefault(); const t0 = ctx.main.querySelector('#nct').value; if (!t0.trim()) return; await personal.createCollection(t0); draw(); };
  };
  draw();
}
