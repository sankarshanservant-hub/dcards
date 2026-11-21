// Обмен с другом (/x/<ссылка>), колокольчик (/bell), «Мои обмены», «Мои подборки» (18.11.2026).
import { lang } from '../i18n.js';
import { esc, tt, u, api, errorText, toast, storage, fmtDate, cityCase } from '../util.js';
import { ic, loading, failed, session } from '../ui.js';
import { openViewer } from '../viewer.js';
import { shareInvite, friendText, storyText, SLOGAN, sendButton, send, STORY_APPS, saveImage, openStoryApp } from '../share.js';
import { pushSupport, enablePush } from '../push.js';
import { storyCanvas } from '../story.js';
import * as personal from '../personal.js';
import { bellText } from '../bell-i18n.js';

// «для Ани», «для Бориса»: простые правила склонения одного слова; не вышло — без имени
const forName = (n) => { const g = n && /^[А-ЯЁ][а-яё]+$/.test(n) ? cityCase(n, 'gen') : null; return g || (n && /^[A-Z][a-z]+$/.test(n) ? n : null); };
const when = (iso) => fmtDate(iso, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
// значок раскрытия: только две головки стрелок по диагонали (вверх-вправо и вниз-влево), без стержней
const ZOOM = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5M10 19H5v-5"/></svg>';
const cardBtn = (c, cls = '') => `<button type="button" class="live-card-btn ${cls}" data-zoom aria-label="${esc(tt('Рассмотреть карту на весь экран', 'View the card full screen'))} ${esc(c.code)}"><img class="live-card" src="${esc(c.full || c.thumb)}" alt="${esc(c.code)}" width="${c.width || 910}" height="${c.height || 1560}"><span class="zoom-ic" aria-hidden="true">${ZOOM}</span></button>`;
// сведения о карте (художник, номер) — не главная информация: компактно, за значком ⓘ
// вопрос другу (20.11.2026): стандартный — на языке интерфейса, изменённый — как написал отправитель
// 23.11.2026: вопрос по умолчанию — как на главной («Что ты здесь видишь?»); «Что тебе откликается…» остаётся среди вопросов «Для себя»
const DEFAULT_Q = 'Что ты здесь видишь?';
const defaultQ = () => tt(DEFAULT_Q, 'What do you see here?');
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
  // старые ссылки «?story=1» (уведомления о сторис) ведут на отдельный экран сторис
  if (new URL(location.href).searchParams.get('story') === '1' && v.kind !== 'group' && v.story) { ctx.navigate(`/x/${token}/story`, { replace: true }); return; }
  const ui = { busy: false, err: '' };
  const AKEY = `dc_ans_${token}`; const TKEY = `dc_ansdraft_${token}`;
  let poll = null;
  const isGroup = v.kind === 'group';

  const answerForm = (groupNote) => `<form class="form" id="xa"><label class="field" for="xt">${esc(tt('Твой ответ', 'Your answer'))}</label>
      ${groupNote ? `<p class="vb-note" style="margin:0" id="xt-h">${esc(groupNote)}</p>` : ''}
      <textarea id="xt" maxlength="300" rows="3" placeholder="${esc(tt('Напиши пару слов', 'Write a few words'))}" required ${groupNote ? 'aria-describedby="xt-h"' : ''}>${esc(storage.get(TKEY) || '')}</textarea>
      ${session.user ? '' : `<label class="field small">${esc(tt('Твоё имя', 'Your name'))}<input id="xn" maxlength="40" value="${esc(storage.get('dc_live_name') || '')}" autocomplete="given-name"></label>`}
      ${ui.err ? `<p class="field-error" role="alert">${esc(ui.err)}</p>` : ''}
      <button class="btn yellow big" type="submit" ${ui.busy ? 'disabled' : ''}>${esc(ui.busy ? tt('Отправляем…', 'Sending…') : groupNote ? tt('Ответить и увидеть ответы', 'Answer and see the answers') : tt('Ответить и увидеть ответ друга', 'Answer and see your friend’s answer'))}</button></form>`;
  const asks = () => `<p class="x-asks">${esc(v.fromName && v.fromName !== 'Друг' ? tt(`${v.fromName} спрашивает:`, `${v.fromName} asks:`) : tt('Тебя спрашивают:', 'You are asked:'))}</p><h1 class="x-h x-question">${esc(questionText(v.question))}</h1>`;
  const signinHint = () => (session.user ? '' : `<a class="x-signin" href="${u('/login?next=' + encodeURIComponent(location.pathname))}">${esc(tt('Войти, чтобы видеть свои обмены на других устройствах', 'Sign in to see your exchanges on other devices'))}</a>`);
  const storyBtn = () => `<a class="btn yellow big x-story-btn" href="${u(`/x/${token}/story`)}">${esc(tt('Создать картинку для Stories', 'Create an image for Stories'))}</a>`;
  // 21.11.2026: «ещё кому-то» — одному или нескольким (выбор в форме); «новая карта» — выбор карты для нового обмена
  const moreBtns = (c, secret) => `<div class="x-next">
      <a class="btn light" href="${u('/play/' + c.code + '?origin=forward')}">${esc(tt('Отправить эту карту ещё кому-то', 'Send this card to someone else'))}</a>
      <a class="btn light" href="${u(secret ? '/play?reply=' + encodeURIComponent(secret) : '/library?play=friend')}">${esc(tt('Отправить новую карту', 'Send a new card'))}</a></div>`;

  function draw() {
    clearInterval(poll);
    const c = v.card; let body;
    if (isGroup) body = groupBody(c);
    else if (v.role === 'stranger') {
      body = `${withInfo(c)}<div class="notice">${esc(tt('Это приглашение уже использовано или открыто в другом браузере. Если это ваш обмен — войдите в аккаунт или откройте его в «Моих обменах» того браузера.', 'This invitation has already been used or opened in another browser. If it is your exchange, sign in or open it in “My exchanges” in that browser.'))}</div>
        <a class="btn yellow" href="${u('/play/' + c.code)}">${esc(tt('Начать свой обмен с этой картой', 'Start your own exchange with this card'))}</a>${navRow()}`;
    } else if (v.role === 'invitee') {
      body = `${v.round > 1 ? `<p class="eyebrow" style="margin:0">${esc(tt(`Ответная карта · раунд ${v.round}`, `A card in reply · round ${v.round}`))}</p>` : ''}${asks()}${withInfo(c, 'sm')}
        <div class="locked">${ic.lock} ${esc(tt('Ответ друга откроется, когда ответишь ты', 'Your friend’s answer opens once you answer'))}</div>
        ${answerForm('')}
        <p class="vb-note">${esc(SLOGAN())}. ${esc(tt('Регистрация не нужна.', 'No sign-up needed.'))}</p>`;
    } else if (!v.answered) {
      body = `<h1 class="x-h">${esc(tt('Ждём ответа друга', 'Waiting for your friend'))}</h1>${withInfo(c)}
        <div class="pair one"><div><b>${esc(tt('Твой ответ', 'Your answer'))}</b>${esc(v.myText)}</div></div>
        <p class="vb-note">${esc(tt('Друг увидит твой ответ, когда напишет свой. Тогда здесь появятся оба ответа и придёт уведомление.', 'Your friend will see your answer once they write theirs. Then both answers appear here and you get a notification.'))}</p>
        ${sendButton('data-sinv-send', tt('Отправить приглашение ещё раз', 'Send the invitation again'))}
        ${notifyHtml()}${signinHint()}${navRow()}`;
      poll = setInterval(async () => { if (!ctx.alive()) return clearInterval(poll); if (document.visibilityState !== 'visible' || navigator.onLine === false) return; try { await load(); if (v.answered) draw(); } catch { /* */ } }, 15000);
    } else {
      const nextRound = (v.rounds || []).some((r) => r.round > v.round);
      const rounds = (v.rounds || []).length > 1 ? `<nav class="rounds small" aria-label="${esc(tt('Раунды разговора', 'Rounds of the conversation'))}">${v.rounds.map((r) => r.current ? `<b>${esc(tt(`Раунд ${r.round}`, `Round ${r.round}`))}</b>` : r.secret ? `<a href="${u('/x/' + r.secret)}">${esc(tt(`Раунд ${r.round}`, `Round ${r.round}`))}${r.answered ? '' : ' · ' + esc(tt('ждёт ответа', 'waiting'))}</a>` : `<span class="muted">${esc(tt(`Раунд ${r.round}`, `Round ${r.round}`))}</span>`).join(' · ')}</nav>` : '';
      body = `${rounds}<div class="x-result"><h1 class="x-h">${esc(tt('Одна карта, два взгляда', 'One card, two views'))}</h1>${withInfo(c, 'sm')}
        <p class="x-asked"><span class="muted">${esc(tt('Вопрос', 'Question'))}:</span> ${esc(questionText(v.question))}</p>
        <div class="pair"><div><b>${esc(v.myName || tt('Ты', 'You'))}</b>${esc(v.myText)}</div><div><b>${esc(v.otherName || tt('Друг', 'Friend'))}</b>${esc(v.otherText)}</div></div></div>
        ${storyBtn()}
        ${moreBtns(c, nextRound ? null : v.secret)}${signinHint()}${navRow()}`;
    }
    ctx.main.innerHTML = `<div class="wrap page narrow stack x-page">${body}</div>`;
    wire();
  }
  function groupBody(c) {
    if (v.role === 'invitee') {
      return `${asks()}${withInfo(c, 'sm')}
        <div class="locked">${ic.lock} ${esc(tt('Ответы других откроются, когда ответишь ты', 'The others’ answers open once you answer'))}</div>
        ${answerForm(tt('Твой ответ увидят те, кто ответил на эту карту по этой ссылке.', 'Everyone who answered this card via this link will see your answer.'))}
        <p class="vb-note">${esc(SLOGAN())}. ${esc(tt('Регистрация не нужна.', 'No sign-up needed.'))}</p>`;
    }
    poll = setInterval(async () => { if (!ctx.alive()) return clearInterval(poll); if (document.visibilityState !== 'visible' || navigator.onLine === false) return; try { const n = v.answers.length; await load(); if (v.answers.length !== n) draw(); } catch { /* */ } }, 20000);
    const owner = v.role === 'owner';
    return `<div class="x-result"><h1 class="x-h">${esc(tt('Одна карта, разные взгляды', 'One card, different views'))}</h1>${withInfo(c, 'sm')}
        <p class="x-asked"><span class="muted">${esc(tt('Вопрос', 'Question'))}:</span> ${esc(questionText(v.question))}</p>
        <div class="pair many">${v.answers.map((a) => `<div class="${a.me ? 'me' : ''}"><b>${esc(a.me ? tt('Ты', 'You') : a.name || tt('Участник', 'Participant'))}</b>${esc(a.text)}</div>`).join('')}</div>
        ${owner && !v.count ? `<p class="vb-note" style="text-align:center">${esc(tt('Пока никто не ответил. Ответы появятся здесь, и придёт уведомление.', 'No answers yet. They will appear here, and you will get a notification.'))}</p>` : ''}</div>
      ${owner ? `<div class="x-invite"><button class="btn yellow big" type="button" data-copy-invite>${esc(tt('Скопировать ссылку-приглашение', 'Copy the invitation link'))}</button>
        ${sendButton('data-sinv-send', tt('Отправить', 'Send'))}</div>` : ''}
      ${v.count ? storyBtn() : ''}
      ${moreBtns(c, null)}${signinHint()}${navRow()}`;
  }
  function wire() {
    const $ = (q) => ctx.main.querySelector(q);
    const z = $('[data-zoom]'); if (z) z.onclick = () => openViewer({ cards: [v.card], index: 0, mode: 'admin', simple: true });
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
    const si = $('[data-sinv-send]'); if (si) si.onclick = async () => { const k = await send(`${location.origin}${u('/x/' + v.invite)}`, friendText()); if (k && !isGroup) markSent(v.secret, k); };
    const ci = $('[data-copy-invite]'); if (ci) ci.onclick = () => shareInvite('copy', `${location.origin}${u('/x/' + v.invite)}`, friendText(), tt('Ссылка-приглашение скопирована', 'Invitation link copied'));
    wireNotify(ctx.main);
  }
  draw();
}

// Нижняя навигация страниц обмена (21.11.2026): «Мои обмены», «О проекте», «Найти встречу» — в одну строку и на телефоне.
const navRow = () => (!session.user && storage.get('dc_via_invite') === '1' ? '' : `<nav class="x-nav" aria-label="${esc(tt('Дальше', 'More'))}"><a class="x-nav-main" href="${u('/me/exchanges')}">${esc(tt('Мои обмены', 'My exchanges'))}</a><a href="${u('/about')}">${esc(tt('О проекте', 'About'))}</a><a href="${u('/meetings')}">${esc(tt('Найти встречу', 'Find a meeting'))}</a></nav>`);

// ---------- «Поделиться в Instagram Stories» (21.11.2026): отдельный экран ----------
// С ответами — только после согласия обоих на показанный макет (с выбранными фрагментами). До этого и в общем обмене —
// вариант с самой картой без личных ответов. Уход с экрана ничего не подтверждает и никому ничего не отправляет.
const STICKER_HANDLE = '@dialogue.cards';
const FRAG_MAX = 180;
/** Варианты короткого фрагмента длинного ответа: по предложениям, иначе по словам. */
function fragments(text) {
  const t = String(text || '').trim(); if (t.length <= FRAG_MAX) return [t];
  const sent = t.match(/[^.!?…]+[.!?…]*\s*/g) || [t]; const out = [];
  for (let i = 0; i < sent.length; i++) { let s = ''; for (let j = i; j < sent.length && (s + sent[j]).trim().length <= FRAG_MAX; j++) s += sent[j]; s = s.trim(); if (s.length >= 3 && !out.includes(s)) out.push(s); }
  if (!out.length) { const words = t.split(/\s+/); let s = ''; for (const w of words) { if ((s + ' ' + w).trim().length > FRAG_MAX) { out.push(s.trim()); s = ''; } s += ' ' + w; } if (s.trim()) out.push(s.trim()); }
  return out.slice(0, 6);
}
export async function storyPage(ctx, token) {
  loading(ctx.main);
  let v;
  try { v = await api(`/api/x/${encodeURIComponent(token)}`); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  const isGroup = v.kind === 'group';
  if (!isGroup && (!v.answered || !['a', 'b'].includes(v.role))) { ctx.navigate(`/x/${token}`, { replace: true }); return; }
  const ui = { cardOnly: isGroup || ctx.query.get('card') === '1', busy: false, canvas: null, preview: '', frag: null, sentAsk: false, copied: '' };
  const s = () => v.story || {};
  const sentKey = () => `dc_story_sent_${v.id}`;
  // фрагменты: свои и друга — из предложения; если предлагаю я — выбираю сам (по умолчанию первый вариант)
  const initFrag = () => {
    const st = s(); const mine = v.myText; const other = v.otherText;
    ui.frag = { mine: (st.frag && st.frag.mine) || fragments(mine)[0], other: (st.frag && st.frag.other) || fragments(other)[0] };
  };
  if (!isGroup) initFrag();
  const canChoose = () => !isGroup && !ui.cardOnly && !s().ready && !s().me && s().proposedBy !== 'other';
  async function render() {
    const me = v.role;
    const aName = me === 'a' ? v.myName : v.otherName; const bName = me === 'a' ? v.otherName : v.myName;
    const aText = me === 'a' ? ui.frag && ui.frag.mine : ui.frag && ui.frag.other; const bText = me === 'a' ? ui.frag && ui.frag.other : ui.frag && ui.frag.mine;
    const full = { a: me === 'a' ? v.myText : v.otherText, b: me === 'a' ? v.otherText : v.myText };
    const cut = (f, t) => (f && t && f !== t ? `${t.startsWith(f) ? '' : '… '}${f}${t.endsWith(f) ? '' : ' …'}` : f);
    // язык макета — как у предложившего (у обоих участников одна и та же картинка); до предложения — свой
    const L = s().proposedBy ? (s().lang || 'ru') : lang;
    ui.L = L;
    ui.canvas = await storyCanvas(ui.cardOnly ? { card: v.card, author: v.card.author, L } : { card: v.card, author: v.card.author, question: v.question, aName, aText: cut(aText, full.a), bName, bText: cut(bText, full.b), L });
    ui.preview = ui.canvas.toDataURL('image/png');
    ui.blob = null; ui.canvas.toBlob((b) => { ui.blob = b; }, 'image/png'); // готово заранее: меню на iPhone открывается только сразу по нажатию
    if (!ctx.alive()) return;
    const st = s();
    const ready = ui.cardOnly || st.ready;
    let acts;
    if (ready) {
      acts = `<p class="st-lead">${esc(tt('Сохрани картинку и добавь её в Instagram Stories', 'Save the image and add it to your Instagram Story'))}</p>
        <button class="btn yellow big" type="button" data-save-story>${esc(tt('Сохранить картинку для Stories', 'Save image for Stories'))}</button>
        <p class="vb-note st-hint" role="status"></p>
        <div class="st-rows">
          <div class="st-row"><button class="st-act" type="button" data-copy-sticker>${esc(tt('Создать стикер-ссылку на карту для Stories', 'Create a link sticker to the card for Stories'))}</button>${ui.copied === 'sticker' ? `<p class="st-tip">${esc(tt('Ссылка скопирована. В Instagram Stories открой стикеры, выбери «Ссылка» и вставь адрес.', 'Link copied. In Instagram Stories open stickers, choose “Link” and paste the address.'))}</p>` : ''}</div>
          <div class="st-row"><button class="st-act" type="button" data-copy-handle>${esc(tt('Передать привет создателям', 'Say hello to the creators'))}</button>${ui.copied === 'handle' ? `<p class="st-tip">${esc(tt('В Instagram открой «Стикеры» → «Упоминание», вставь @dialogue.cards и выбери наш профиль. Так мы сможем увидеть твою сторис.', 'In Instagram open “Stickers” → “Mention”, paste @dialogue.cards and choose our profile. That way we can see your story.'))}</p>` : ''}</div>
        </div>
        ${!isGroup && ui.cardOnly && !st.ready ? `<button class="link-btn" type="button" data-with-answers>${esc(tt('Вернуться к варианту с ответами', 'Back to the version with answers'))}</button>` : ''}`;
    } else if (st.me === 'agreed') {
      acts = `<p class="st-wait"><b>${esc(tt('Ждём согласия друга', 'Waiting for your friend to agree'))}</b>${st.other === 'declined' ? ` · ${esc(tt('друг решил не публиковать', 'your friend chose not to post'))}` : ''}</p>
        <button class="btn light" type="button" data-resend>${esc(tt('Отправить ссылку на согласование ещё раз', 'Send the approval link again'))}</button>
        <button class="link-btn" type="button" data-card-only>${esc(tt('Поделиться только картой без текста', 'Share only the card without text'))}</button>`;
    } else if (st.proposedBy === 'other') {
      acts = `<button class="btn yellow big" type="button" data-agree ${ui.busy ? 'disabled' : ''}>${esc(tt('Согласен поделиться', 'I agree to share'))}</button>
        <button class="link-btn" type="button" data-decline>${esc(tt('Не публиковать мой ответ', 'Do not post my answer'))}</button>
        <button class="link-btn" type="button" data-card-only>${esc(tt('Поделиться только картой без текста', 'Share only the card without text'))}</button>`;
    } else {
      acts = `<button class="btn yellow big" type="button" data-propose ${ui.busy ? 'disabled' : ''}>${esc(tt('Подтвердить и предложить другу', 'Confirm and invite your friend'))}</button>
        <button class="link-btn" type="button" data-card-only>${esc(tt('Поделиться только картой без текста', 'Share only the card without text'))}</button>`;
    }
    const pick = (who, text) => {
      const opts = fragments(text); if (opts.length < 2 && opts[0] === String(text).trim()) return '';
      return `<fieldset class="st-frag"><legend>${esc(who === 'mine' ? tt('Твой ответ длинный — выбери фрагмент для сторис', 'Your answer is long — choose a fragment for stories') : tt('Ответ друга длинный — выбери фрагмент для сторис', 'Your friend’s answer is long — choose a fragment for stories'))}</legend>
        ${opts.map((o, i) => `<label class="check"><input type="radio" name="fr-${who}" value="${i}" ${ui.frag[who] === o ? 'checked' : ''} data-frag="${who}"> <span>${esc(o)}</span></label>`).join('')}</fieldset>`;
    };
    ctx.main.innerHTML = `<div class="wrap page narrow stack st-page">
      <h1 class="st-title">${esc(tt('Картинка для Instagram Stories', 'Image for Instagram Stories'))}</h1>
      ${ready ? '' : `<p class="st-lead">${esc(tt('Так будет выглядеть ваша история. Когда вы оба согласитесь, картинку можно будет сохранить и добавить в Instagram Stories.', 'Here’s how your Story will look. Once you both agree, you can save the image and add it to Instagram Stories.'))}</p>`}
      <img class="story-prev" src="${ui.preview}" alt="${esc(ui.cardOnly ? tt('Макет для сторис: карта без ответов', 'Story layout: the card without answers') : tt('Макет для сторис: карта и два ответа', 'Story layout: the card and two answers'))}">
      ${canChoose() ? `${pick('mine', v.myText)}${pick('other', v.otherText)}` : ''}
      <div class="st-acts">${acts}</div>
    </div>`;
    wire();
  }
  const otherLink = () => `${location.origin}${u(`/x/${v.story.otherDoor}/story`)}`;
  async function act(action, extra = {}) {
    ui.busy = true;
    try { const r = await api(`/api/x/${encodeURIComponent(token)}/story`, { method: 'POST', body: { action, hash: v.story.hash, ...extra } }); v = r.exchange; }
    catch (x) { toast(x.code === 'story_changed' ? tt('Макет изменился — посмотрите его ещё раз', 'The layout changed — please look at it again') : errorText(x)); v = await api(`/api/x/${encodeURIComponent(token)}`); initFrag(); }
    ui.busy = false;
  }
  function wire() {
    const $ = (q) => ctx.main.querySelector(q);
    ctx.main.querySelectorAll('[data-frag]').forEach((r) => r.onchange = () => { const who = r.dataset.frag; ui.frag[who] = fragments(who === 'mine' ? v.myText : v.otherText)[Number(r.value)]; render(); });
    const co = $('[data-card-only]'); if (co) co.onclick = () => { ui.cardOnly = true; render(); };
    const wa = $('[data-with-answers]'); if (wa) wa.onclick = () => { ui.cardOnly = false; render(); };
    const pr = $('[data-propose]');
    if (pr) pr.onclick = async () => {
      // одно нажатие: согласие на этот макет и сразу системное меню отправки ссылки на согласование (без второго «Отправить»)
      const link = otherLink(); const frag = { mine: ui.frag.mine, other: ui.frag.other };
      const body = { ...(v.role === 'a' ? { a: frag.mine, b: frag.other } : { a: frag.other, b: frag.mine }), lang: ui.L || lang };
      const sending = send(link, storyText()); // меню открывается сразу по нажатию; согласие сохраняется параллельно
      await act('propose', { frag: body });
      const k = await sending; if (k) { storage.set(sentKey(), v.story.hash); }
      render();
    };
    const rs = $('[data-resend]'); if (rs) rs.onclick = async () => { const k = await send(otherLink(), storyText()); if (k) storage.set(sentKey(), v.story.hash); };
    const ag = $('[data-agree]'); if (ag) ag.onclick = async () => { await act('agree'); render(); };
    const dc = $('[data-decline]'); if (dc) dc.onclick = async () => { await act('decline'); ui.cardOnly = true; render(); };
    const ss = $('[data-save-story]');
    if (ss) ss.onclick = async () => {
      const blob = ui.blob || await new Promise((res) => ui.canvas.toBlob(res, 'image/png'));
      const r = await saveImage(blob, `dialogue-cards-${v.card.code}-stories.png`, () => {});
      // подтверждаем только то, что произошло; Instagram человек открывает сам
      const h = $('.st-hint'); if (!h) return;
      h.textContent = r === 'menu' ? tt('Если выбрал «Сохранить изображение», картинка в «Фото» — выбери её при создании Stories в Instagram.', 'If you chose “Save Image”, it is in Photos — pick it when you create a Story in Instagram.')
        : r === 'cancel' ? tt('Сохранение отменено. Можно попробовать ещё раз.', 'Saving was cancelled. You can try again.')
        : r === 'overlay' ? tt('Нажми и удерживай картинку, выбери «Сохранить в Фото», затем выбери её при создании Stories.', 'Press and hold the image, choose “Save to Photos”, then pick it when you create a Story.')
        : tt('Картинка скачана в «Загрузки» — выбери её при создании Stories в Instagram.', 'The image is in Downloads — pick it when you create a Story in Instagram.');
    };
    const cs = $('[data-copy-sticker]'); if (cs) cs.onclick = async () => { if (await copyText(playUrl(v.card))) { ui.copied = 'sticker'; render(); } };
    const ch = $('[data-copy-handle]'); if (ch) ch.onclick = async () => { if (await copyText(STICKER_HANDLE)) { ui.copied = 'handle'; render(); } };
  }
  await render();
}
async function copyText(t) { try { await navigator.clipboard.writeText(t); return true; } catch { prompt(tt('Скопируйте:', 'Copy:'), t); return true; } }

// Поле в одну строку; при фокусе — две; дальше растёт по тексту (ввод, вставка, черновик).
function autogrow(t) {
  const fit = () => {
    t.style.height = 'auto'; const cs = getComputedStyle(t);
    const lh = parseFloat(cs.lineHeight) || 22; const pv = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom); const bd = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    let h = t.scrollHeight + bd; if (document.activeElement === t) h = Math.max(h, lh * 2 + pv + bd);
    t.style.height = `${Math.ceil(h)}px`;
  };
  ['input', 'focus', 'blur'].forEach((ev) => t.addEventListener(ev, fit)); requestAnimationFrame(fit);
}

const markSent = (secret, via) => api(`/api/x/${encodeURIComponent(secret)}/sent`, { method: 'POST', body: { via } }).catch(() => {});

// «Сообщить, когда друг ответит?» — только по действию человека и с учётом того, что умеет браузер
function notifyHtml() {
  const sup = pushSupport();
  let inner;
  if (!session.user) inner = `<p class="vb-note">${esc(tt('Ответ появится здесь и в уведомлениях этого браузера. Чтобы получать уведомление на телефон, войдите — займёт минуту.', 'The answer will appear here and in this browser’s notifications. To get a phone notification, sign in — it takes a minute.'))}</p><a class="btn sm light" href="${u('/login?next=' + encodeURIComponent(location.pathname))}">${esc(tt('Войти', 'Sign in'))}</a>`;
  else if (sup === 'ios-home') inner = `<p class="vb-note">${esc(tt('На iPhone уведомления приходят, если добавить D-Cards на экран «Домой» (Поделиться → На экран «Домой») и открыть оттуда. Без этого ответ будет в уведомлениях приложения.', 'On iPhone, notifications work if you add D-Cards to the Home Screen (Share → Add to Home Screen) and open it from there. Otherwise the answer will be in the app’s notifications.'))}</p>`;
  else if (sup === 'unsupported') inner = `<p class="vb-note">${esc(tt('Этот браузер не умеет уведомления на телефон — ответ будет в уведомлениях приложения.', 'This browser cannot show notifications — the answer will be in the app’s notifications.'))}</p>`;
  else if (sup === 'granted') inner = `<p class="vb-note">${esc(tt('Уведомления включены — сообщим, когда друг ответит.', 'Notifications are on — we will let you know when your friend answers.'))}</p>`;
  else if (sup === 'denied') inner = `<p class="vb-note">${esc(tt('Уведомления запрещены в настройках браузера — ответ будет в уведомлениях приложения.', 'Notifications are blocked in browser settings — the answer will be in the app’s notifications.'))}</p>`;
  else inner = `<button class="btn sm" type="button" data-notify-on>${ic.bell} ${esc(tt('Включить уведомления', 'Turn on notifications'))}</button>`;
  return `<div class="x-notify"><b>${esc(tt('Сообщить, когда друг ответит?', 'Let you know when your friend answers?'))}</b>${inner}</div>`;
}
function wireNotify(root) {
  const b = root.querySelector('[data-notify-on]'); if (!b) return;
  b.onclick = async () => {
    b.disabled = true;
    try { const k = await api('/api/push'); const r = await enablePush(k.publicKey); toast(r === 'on' ? tt('Уведомления включены', 'Notifications on') : tt('Уведомления не включены', 'Notifications not enabled')); }
    catch { toast(tt('Не удалось включить уведомления — ответ будет в уведомлениях приложения.', 'Could not turn on notifications — the answer will be in the app’s notifications.')); }
    const box = b.closest('.x-notify'); if (box) box.outerHTML = notifyHtml();
  };
}

// ---------- «Сыграть с другом»: сразу случайная (или выбранная) карта, отклик и отправка ----------
// /play — случайная карта; /play/<код> — эта карта (публичная ссылка); ?reply=<личная ссылка> — «Твоя очередь» в том же
// разговоре; ?origin=forward — эту карту ещё кому-то (отдельный обмен). Черновик принадлежит своей карте.
const PKEY = 'dc_play_drafts';
export async function playPage(ctx, code) {
  const reply = ctx.query.get('reply');
  // кому: одному другу (личный обмен) или нескольким людям (общий обмен по одной ссылке) — выбирается в этой же форме
  let multi = !reply && ctx.query.get('multi') === '1';
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
  let card = (code && cards.find((c) => c.code === code)) || pick();
  if (!card) { ctx.main.innerHTML = `<div class="wrap page narrow"><p class="empty">${esc(tt('В галерее пока нет карт.', 'No cards yet.'))}</p></div>`; return; }
  const other = parent && parent.otherName && parent.otherName !== 'Друг' ? parent.otherName : '';
  const ui = { sending: false, err: '', cancelled: false };
  const newToken = () => { const a = new Uint8Array(18); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9_-]/g, '');
  const draw = () => {
    const dr = drafts[card.code] || {};
    ctx.main.innerHTML = `<div class="wrap page narrow stack x-page">
      ${reply ? `<p class="eyebrow x-center" style="margin:0">${esc(tt('Новая карта', 'A new card'))}</p>` : ''}
      <h1 class="x-h x-center">${esc(reply ? (other && forName(other) ? tt(`Карта для ${forName(other)}`, `A card for ${other}`) : tt('Отправь новую карту', 'Send a new card')) : tt('Вопрос другу', 'Question to a friend'))}</h1>
      ${withInfo(card, 'md')}
      <div class="row" style="justify-content:center"><button class="btn sm light" type="button" data-other>${esc(tt('Другая карта', 'Another card'))}</button><a class="btn sm light" href="${u('/library?play=friend' + (reply ? '&reply=' + encodeURIComponent(reply) : ''))}">${esc(tt('Все карты', 'All cards'))}</a></div>
      <form class="form" id="pf">
        ${reply ? '' : `<div class="seg x-who" role="radiogroup" aria-label="${esc(tt('Кому', 'To whom'))}"><button type="button" role="radio" data-who="one" aria-checked="${!multi}">${esc(tt('Одному другу', 'One friend'))}</button><button type="button" role="radio" data-who="many" aria-checked="${multi}">${esc(tt('Нескольким людям', 'Several people'))}</button></div>`}
        <label class="field" for="pq">${esc(tt('Твой вопрос', 'Your question'))}</label>
        <textarea id="pq" class="ask-q autogrow" maxlength="200" rows="1">${esc(dr.q != null ? dr.q : defaultQ())}</textarea>
        <label class="field" for="pt">${esc(tt('Твой ответ', 'Your answer'))}</label>
        <p class="vb-note" style="margin:-4px 0 0" id="pt-h">${esc(multi ? tt('Каждый увидит твой ответ, когда напишет свой.', 'Everyone will see your answer once they write theirs.') : tt('Друг увидит твой ответ, когда напишет свой.', 'Your friend will see your answer once they write theirs.'))}</p>
        <textarea id="pt" class="autogrow" maxlength="300" rows="1" placeholder="${esc(tt('Напиши пару слов', 'Write a few words'))}" aria-describedby="pt-h">${esc(dr.text || '')}</textarea>
        ${session.user || reply ? '' : `<label class="field small">${esc(tt('Твоё имя для друга', 'Your name for your friend'))}<input id="pn" maxlength="40" value="${esc(storage.get('dc_live_name') || '')}" autocomplete="given-name"></label>`}
        ${ui.err ? `<p class="field-error" role="alert">${esc(ui.err)}</p>` : ''}
        ${ui.cancelled && dr.tok ? `<p class="vb-note x-cancelled" role="status">${esc(tt('Отправка отменена. Текст и ссылка сохранены — можно отправить ещё раз или скопировать ссылку.', 'Sending was cancelled. Your text and link are kept — send again or copy the link.'))} <button class="link-btn" type="button" data-copy-link>${esc(tt('Скопировать ссылку', 'Copy the link'))}</button></p>` : ''}
        <button class="btn yellow big send-btn" type="submit" ${ui.sending || !String(dr.text || '').trim() ? 'disabled' : ''}>${esc(reply ? tt('Отправить карту', 'Send the card') : multi ? tt('Отправить', 'Send') : tt('Отправить другу', 'Send to a friend'))}</button></form></div>`;
    const f = ctx.main.querySelector('#pf');
    const upd = (k, v) => { drafts[card.code] = { ...(drafts[card.code] || {}), [k]: v }; keep(); };
    f.pt.addEventListener('input', () => { upd('text', f.pt.value); f.querySelector('[type=submit]').disabled = ui.sending || !f.pt.value.trim(); });
    f.querySelectorAll('.autogrow').forEach(autogrow);
    f.pq.addEventListener('input', () => upd('q', f.pq.value));
    f.pt.addEventListener('focus', () => setTimeout(() => f.pt.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250)); // клавиатура не закрывает поле
    f.querySelectorAll('[data-who]').forEach((b) => { b.onclick = () => { const m = b.dataset.who === 'many'; if (m === multi) return; multi = m; const d = drafts[card.code]; if (d) { delete d.tok; delete d.key; keep(); } ui.cancelled = false; draw(); }; });
    ctx.main.querySelector('[data-zoom]').onclick = () => openViewer({ cards: [card], index: 0, mode: 'admin', simple: true });
    if (!card.author) api(`/api/cards/${encodeURIComponent(card.code)}`).then((d) => { if (d.author) { card.author = d.author; const al = ctx.main.querySelector('.x-page .card-info'); if (al) al.outerHTML = authorLine(card); } }).catch(() => {});
    ctx.main.querySelector('[data-other]').onclick = () => { card = pick(card.code); ui.cancelled = false; draw(); }; // черновик остаётся у своей карты
    const cl = ctx.main.querySelector('[data-copy-link]'); if (cl) cl.onclick = () => shareInvite('copy', `${location.origin}${u('/x/' + drafts[card.code].tok)}`, friendText(), tt('Ссылка-приглашение скопирована', 'Invitation link copied'));
    // одно нажатие: ссылка готова заранее, системное меню открывается сразу, обмен сохраняется параллельно
    f.onsubmit = async (e) => {
      e.preventDefault(); if (ui.sending) return; // двойной тап — без второго обмена
      const d = drafts[card.code] || {}; const text = String(d.text || '').trim(); if (!text) return;
      const name = f.pn ? f.pn.value.trim() : ''; if (name) storage.set('dc_live_name', name);
      // пустой вопрос или из пробелов — стандартный; стандартный на любом языке хранится как стандартный
      const q0 = f.pq.value.replace(/\s+/g, ' ').trim(); const question = !q0 || q0 === defaultQ() ? '' : q0;
      d.key = d.key || newKey(); d.tok = d.tok || newToken(); drafts[card.code] = d; keep();
      ui.sending = true; ui.err = ''; f.querySelector('[type=submit]').disabled = true;
      const sending = send(`${location.origin}${u('/x/' + d.tok)}`, friendText());
      let r = null;
      try {
        r = reply ? await api(`/api/x/${encodeURIComponent(reply)}/reply`, { method: 'POST', body: { code: card.code, text, question, clientKey: d.key, inviteToken: d.tok } })
          : await api('/api/exchanges', { method: 'POST', body: { code: card.code, text, name, question, clientKey: d.key, inviteToken: d.tok, origin, multi } });
      } catch (x) { ui.err = `${errorText(x)} ${tt('Текст сохранён — попробуйте ещё раз.', 'Your text is kept — try again.')}`; }
      const k = await sending;
      ui.sending = false;
      if (!r) { ui.cancelled = false; draw(); return; }
      if (!k) { ui.cancelled = true; draw(); return; } // отмена меню: тот же экран, тот же обмен
      if (!r.group) markSent(r.secret, k);
      delete drafts[card.code]; keep();
      ctx.navigate('/x/' + r.secret, { replace: true }); window.scrollTo(0, 0);
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
    ${d.items.length ? `<ul class="bell-list">${d.items.map((n) => `<li><a class="bell-item ${n.read ? '' : 'unread'}" href="${esc(u(/^\/(?![/\\])/.test(n.url || '') ? n.url : '/'))}" data-n="${esc(n.id)}">
        <span class="x-dot ${n.read ? '' : 'on'}" aria-hidden="true"></span>
        <span class="grow"><b>${esc(bellText(n).title)}</b>${n.body ? `<span class="small">${esc(bellText(n).body)}</span>` : ''}${n.resolved ? `<span class="small muted">${esc(tt('решено', 'resolved'))}</span>` : ''}</span>
        <time class="small muted" datetime="${esc(n.updatedAt)}">${esc(when(n.updatedAt))}</time><span class="sr-only">${esc(n.read ? tt('прочитано', 'read') : tt('не прочитано', 'unread'))}</span></a></li>`).join('')}</ul>`
      : !upd ? `<p class="empty">${esc(tt('Здесь появятся ответы друзей и другие важные события.', 'Your friends’ answers and other important events will appear here.'))}</p>` : ''}
    <div class="bell-foot"><p class="small muted" style="margin:0">${esc(tt('Пуш-уведомления на телефон настраиваются отдельно', 'Phone push notifications are set up separately'))}</p><a class="btn sm light" href="${u(session.user ? '/me/notifications' : '/login?next=' + encodeURIComponent('/me/notifications'))}">${esc(tt('Настройки', 'Settings'))}</a></div>
  </div>`;
  const ar = ctx.main.querySelector('#allread');
  // «Отметить все как прочитанные»: строки меняются на месте — без перезагрузки списка, мигания и потери прокрутки
  if (ar) ar.onclick = async () => {
    ar.disabled = true;
    try { await api('/api/bell/read', { method: 'POST', body: { all: true } }); }
    catch (x) { ar.disabled = false; toast(errorText(x)); return; }
    ctx.main.querySelectorAll('.bell-item.unread[data-n]').forEach(markRow);
    ar.textContent = tt('Все прочитаны', 'All read'); // кнопка остаётся на месте — строки ниже не сдвигаются
    window.dcRefreshBell && window.dcRefreshBell(true);
  };
  const rl = ctx.main.querySelector('#reload'); if (rl) rl.onclick = () => location.reload();
  ctx.main.querySelectorAll('[data-n]').forEach((a) => a.addEventListener('click', () => { markRow(a); api('/api/bell/read', { method: 'POST', body: { ids: [Number(a.dataset.n)] } }).then(() => window.dcRefreshBell && window.dcRefreshBell(true)).catch(() => {}); }));
}
function markRow(a) {
  a.classList.remove('unread'); const d = a.querySelector('.x-dot'); if (d) d.classList.remove('on');
  const sr = a.querySelector('.sr-only'); if (sr) sr.textContent = tt('прочитано', 'read');
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
      <span class="body"><b>${esc(x.kind === 'group' ? (x.count ? tt(`Разные взгляды · ответов: ${x.count}`, `Different views · answers: ${x.count}`) : tt('Общий обмен · ждём ответов', 'Shared exchange · waiting for answers')) : x.answered ? (x.storyAsk ? tt('Предложили сторис', 'Stories invitation') : tt('Два взгляда', 'Two views')) : tt('Ждём ответа', 'Waiting for an answer'))}</b>
      <span class="small">${esc(x.code)}${x.otherName ? ` · ${esc(x.otherName)}` : ''} · ${esc(when(x.createdAt))}${x.role === 'b' || x.role === 'member' ? ` · ${esc(tt('вас пригласили', 'you were invited'))}` : ''}</span></span><span aria-hidden="true">→</span></a>`).join('')}</div>`
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
        ${cur.favorites ? `<a class="item pc-fav-link" href="${u('/me/postcards')}"><span class="ic">${ic.mail || ic.cards}</span><span class="body"><b>${esc(tt('Мои открытки', 'My postcards'))}</b><span class="small">${(s.postcards || []).length}</span></span><span aria-hidden="true">→</span></a>` : ''}
        <div class="row">${list.length >= 2 ? `<a class="btn yellow sm" href="${u('/group?collection=' + encodeURIComponent(cur.id))}">${ic.people} ${esc(tt('Играть компанией', 'Play with friends'))}</a>` : ''}
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
        <span class="body"><b>${esc(c.favorites ? tt('Избранное', 'Favourites') : c.title)}</b><span class="small">${c.codes.length} ${esc(tt('карт', 'cards'))}${c.favorites ? ` · ${esc(tt('открыток', 'postcards'))}: ${(s.postcards || []).length}` : ''}</span></span><span aria-hidden="true">→</span></a>${c.favorites ? `<a class="item sub-item" href="${u('/me/postcards')}"><span class="body"><b>${esc(tt('Мои открытки', 'My postcards'))}</b><span class="small">${(s.postcards || []).length}</span></span><span aria-hidden="true">→</span></a>` : ''}`).join('')}<a class="item" href="${u('/me/images')}"><span class="mini-strip" aria-hidden="true"></span><span class="body"><b>${esc(tt('Мои образы', 'My images'))}</b><span class="small">${(s.images || []).length}</span></span><span aria-hidden="true">→</span></a></div></div>`;
    ctx.main.querySelector('#nc').onsubmit = async (e) => { e.preventDefault(); const t0 = ctx.main.querySelector('#nct').value; if (!t0.trim()) return; await personal.createCollection(t0); draw(); };
  };
  draw();
}
