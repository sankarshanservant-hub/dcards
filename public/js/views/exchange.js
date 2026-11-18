// Обмен с другом (/x/<ссылка>), колокольчик (/bell), «Мои обмены», «Мои подборки» (18.11.2026).
import { lang } from '../i18n.js';
import { esc, tt, u, api, errorText, toast, storage, fmtDate } from '../util.js';
import { ic, loading, failed, session } from '../ui.js';
import { openViewer } from '../viewer.js';
import { shareInvite, friendText, storyText } from '../share.js';
import { storyCanvas } from '../story.js';
import * as personal from '../personal.js';

const when = (iso) => fmtDate(iso, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const shareRow = (prefix) => `<div class="share-row"><button class="btn sm" type="button" data-${prefix}="tg">Telegram</button><button class="btn sm" type="button" data-${prefix}="wa">WhatsApp</button>${navigator.share ? `<button class="btn sm" type="button" data-${prefix}="sys">${esc(tt('Другие приложения', 'Other apps'))}</button>` : ''}<button class="btn sm light" type="button" data-${prefix}="copy">${esc(tt('Скопировать ссылку', 'Copy link'))}</button></div>`;
const cardBtn = (c) => `<button type="button" class="live-card-btn" data-zoom aria-label="${esc(tt('Рассмотреть карту', 'View card'))} ${esc(c.code)}"><img class="live-card" src="${esc(c.full || c.thumb)}" alt="${esc(c.code)}" width="${c.width || 910}" height="${c.height || 1560}"></button>`;
const authorLine = (c) => `<p class="small muted" style="margin:0;text-align:center">${esc(c.code)}${c.author ? ` · ${esc(tt('художник', 'artist'))}: ${esc(c.author)}` : ''}</p>`;
const cardShareUrl = (c) => `${location.origin}${u('/library?card=' + encodeURIComponent(c.code))}`;
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
      inner = `${img}<p class="small" style="margin:0">${ic.check} ${esc(tt('Вы оба согласились. Опубликовать могут один или оба — по желанию.', 'You both agreed. Either or both of you may post it.'))}</p>
        <div class="row"><button class="btn yellow" type="button" data-save-story>${esc(tt('Сохранить для сторис', 'Save for stories'))}</button></div>
        <p class="vb-note">${esc(tt('Ссылка для стикера или подписи — ведёт к новой игре с этой картой, без ваших ответов:', 'Link for a sticker or caption — it starts a new game with this card, without your answers:'))}</p>
        <div class="row"><button class="btn sm light" type="button" data-copy-play>${esc(tt('Скопировать ссылку', 'Copy link'))}</button></div>`;
    } else if (s.me === 'agreed') {
      inner = `${img}<p style="margin:0"><b>${esc(tt('Ждём согласия друга', 'Waiting for your friend to agree'))}</b>${s.other === 'declined' ? ` · ${esc(tt('друг решил не публиковать', 'your friend chose not to post'))}` : ''}</p>
        <p class="vb-note">${esc(tt('Отправь другу ссылку на этот макет — он сможет согласиться или отказаться. Пока согласия нет, можно поделиться только картой.', 'Send your friend a link to this layout — they can agree or decline. Until then you can share only the card.'))}</p>${shareRow('sst')}`;
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
    return `<section class="card-ui stack" id="story" aria-labelledby="st-h"><h2 id="st-h" style="margin:0;font-size:1.15rem">${esc(tt('Сторис с двумя ответами', 'Stories with both answers'))}</h2>${inner}</section>`;
  }
  function draw() {
    clearInterval(poll);
    const c = v.card; let body;
    if (v.role === 'stranger') {
      body = `${cardBtn(c)}${authorLine(c)}<div class="notice">${esc(tt('Это приглашение уже использовано или открыто в другом браузере. Если это ваш обмен — войдите в аккаунт или откройте свою личную ссылку.', 'This invitation has already been used or opened in another browser. If it is your exchange, sign in or open your personal link.'))}</div>
        <a class="btn yellow" href="${u('/play/' + c.code)}">${esc(tt('Начать свой обмен с этой картой', 'Start your own exchange with this card'))}</a>`;
    } else if (v.role === 'invitee') {
      const dr = storage.get(TKEY) || '';
      body = `<h1 class="x-h">${esc(tt(`${v.fromName} спрашивает: что ты здесь видишь?`, `${v.fromName} asks: what do you see here?`))}</h1>${cardBtn(c)}${authorLine(c)}
        <div class="locked">${ic.lock} ${esc(tt(`Ответ ${v.fromName} откроется, когда ответишь ты`, `${v.fromName}’s answer opens once you answer`))}</div>
        <form class="form" id="xa"><label class="field" for="xt">${esc(tt('Что тебе откликнулось в этой карте?', 'What speaks to you in this card?'))}</label>
          <textarea id="xt" maxlength="300" rows="3" placeholder="${esc(tt('Напиши пару слов', 'Write a few words'))}" required>${esc(dr)}</textarea>
          ${session.user ? '' : `<label class="field small">${esc(tt('Твоё имя', 'Your name'))} <span class="hint">${esc(tt('по желанию — его увидит друг', 'optional — your friend will see it'))}</span><input id="xn" maxlength="40" value="${esc(storage.get('dc_live_name') || '')}" autocomplete="given-name"></label>`}
          ${ui.err ? `<p class="field-error" role="alert">${esc(ui.err)}</p>` : ''}
          <button class="btn yellow big" type="submit" ${ui.busy ? 'disabled' : ''}>${esc(ui.busy ? tt('Отправляем…', 'Sending…') : tt('Ответить и увидеть', 'Answer and see'))}</button></form>
        <p class="vb-note">${esc(tt('Регистрация не нужна. Обмен сохранится в этом браузере.', 'No sign-up needed. The exchange is kept in this browser.'))}</p>`;
    } else if (!v.answered) {
      body = `<h1 class="x-h">${esc(tt('Ждём ответа друга', 'Waiting for your friend'))}</h1>${cardBtn(c)}${authorLine(c)}
        <div class="pair one"><div><b>${esc(tt('Твой ответ', 'Your answer'))}</b>${esc(v.myText)}</div></div>
        <p class="vb-note">${esc(tt('Друг увидит твой ответ, когда напишет свой. Когда он ответит, здесь появятся оба ответа, а в колокольчике — уведомление.', 'Your friend will see your answer once they write theirs. Then both answers appear here and in the bell.'))}</p>
        <b>${esc(tt('Отправить приглашение ещё раз', 'Send the invitation again'))}</b>${shareRow('sinv')}
        ${backLinkHtml()}`;
      poll = setInterval(async () => { if (!ctx.alive()) return clearInterval(poll); if (document.visibilityState !== 'visible' || navigator.onLine === false) return; try { await load(); if (v.answered) draw(); } catch { /* */ } }, 15000);
    } else {
      body = `<h1 class="x-h">${esc(tt('Одна карта — два взгляда', 'One card — two views'))}</h1>${cardBtn(c)}${authorLine(c)}
        <div class="pair"><div><b>${esc(v.myName || tt('Ты', 'You'))}</b>${esc(v.myText)}</div><div><b>${esc(v.otherName || tt('Друг', 'Friend'))}</b>${esc(v.otherText)}</div></div>
        ${storyHtml()}
        <div class="row"><a class="btn" href="${u('/library?play=friend')}">${esc(tt('Новый раунд с другой картой', 'New round with another card'))}</a><button class="btn light" type="button" data-share-card>${esc(tt('Поделиться картой', 'Share the card'))}</button></div>
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
    ctx.main.querySelectorAll('[data-sinv]').forEach((b) => b.onclick = () => shareInvite(b.dataset.sinv, `${location.origin}${u('/x/' + v.invite)}`, friendText()));
    ctx.main.querySelectorAll('[data-sst]').forEach((b) => b.onclick = () => shareInvite(b.dataset.sst, `${location.origin}${u('/x/' + v.story.otherDoor + '?story=1')}`, storyText()));
    const cb = $('[data-copy-back]'); if (cb) cb.onclick = () => shareInvite('copy', `${location.origin}${u('/x/' + v.secret)}`, '', tt('Личная ссылка скопирована — сохраните её', 'Personal link copied — keep it'));
    const sc = $('[data-share-card]'); if (sc) sc.onclick = () => shareInvite(navigator.share ? 'sys' : 'copy', cardShareUrl(v.card), `${v.card.code}${v.card.author ? ' · ' + v.card.author : ''}`);
    const sp = $('[data-show-preview]'); if (sp) sp.onclick = async () => { sp.disabled = true; await preview(); draw(); const st = $('#story'); if (st) st.scrollIntoView({ block: 'start' }); };
    const hp = $('[data-hide-preview]'); if (hp) hp.onclick = () => { ui.preview = null; draw(); };
    const pr = $('[data-propose]'); if (pr) pr.onclick = () => storyAct('propose');
    const ag = $('[data-agree]'); if (ag) ag.onclick = () => storyAct('agree');
    const dc = $('[data-decline]'); if (dc) dc.onclick = () => storyAct('decline');
    const cp = $('[data-copy-play]'); if (cp) cp.onclick = () => shareInvite('copy', playUrl(v.card), '');
    const ss = $('[data-save-story]');
    if (ss) ss.onclick = async () => {
      await preview();
      const blob = await new Promise((res) => ui.canvas.toBlob(res, 'image/png'));
      const file = new File([blob], `d-cards-${v.card.code}.png`, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch { /* отмена */ } }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
      toast(tt('Картинка сохранена', 'Image saved'));
    };
  }
  if (v.story && (ui.wantStory || v.story.ready || v.story.me === 'agreed' || v.story.proposedBy === 'other')) { try { await preview(); } catch { /* без макета */ } }
  if (!ctx.alive()) return;
  draw();
  if (ui.wantStory) { const st = ctx.main.querySelector('#story'); if (st) st.scrollIntoView({ block: 'start' }); }
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
      : `<p class="empty">${esc(tt('Обменов пока нет. Выбери карту и отправь её другу.', 'No exchanges yet. Choose a card and send it to a friend.'))}</p><a class="btn yellow" href="${u('/library?play=friend')}">${esc(tt('Сыграть с другом', 'Play with a friend'))}</a>`}</div>`;
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
