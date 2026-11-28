// «Общение»: общий чат и закрытые чаты команды. Список чатов (слева / сверху), непрочитанные, замок у закрытых,
// ответы и упоминания, изображения и «Медиа», модерация (скрыть / восстановить) и режим уведомлений для чата.
import { shareLink, esc, tt, u, api, errorText, toast, fmtDate } from '../util.js';
import { session, hasRole, needLogin, noRole, loading, failed, ROLE_LABEL, ic } from '../ui.js';
import { MODE_LABEL } from './notify.js';

const ROOM_TITLE = { general: ['Общий чат', 'General chat'], curators: ['Чат кураторов', 'Curators’ chat'], facilitators: ['Чат фасилитаторов', 'Facilitators’ chat'] };
const ROOM_NOTE = { general: ['Для всех участников проекта: вопросы, знакомство, предложения, впечатления.', 'For everyone in the project: questions, introductions, ideas, impressions.'], curators: ['Закрытый: кураторы и администраторы.', 'Private: curators and administrators.'], facilitators: ['Закрытый: фасилитаторы и администраторы.', 'Private: facilitators and administrators.'] };
const CAT = { '': ['Все', 'All'], meetings: ['Фото со встреч', 'Meeting photos'], illustrations: ['Иллюстрации', 'Illustrations'], inspiration: ['Вдохновение', 'Inspiration'] };
const rt = (r) => tt(...ROOM_TITLE[r]);
const initial = (n) => { const m = String(n || '').match(/[\p{L}\p{N}]/u); return m ? m[0].toLocaleUpperCase() : '·'; };
const when = (iso) => fmtDate(iso, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const refreshBadge = () => { if (window.dcRefreshUnread) window.dcRefreshUnread(true); };

function roomLinks(rooms, current) {
  return `<nav class="room-side" aria-label="${esc(tt('Чаты', 'Chats'))}"><h2>${esc(tt('Чаты', 'Chats'))}</h2><div class="room-list">${rooms.map((r) => `<a href="${u('/team/' + r.room)}" ${r.room === current ? 'aria-current="page"' : ''}>
      ${r.closed ? `<span title="${esc(tt('Закрытый чат', 'Private chat'))}">${ic.lock}</span><span class="sr-only">${esc(tt('закрытый', 'private'))}</span>` : ic.chat}
      <span class="grow">${esc(rt(r.room))}</span>
      ${r.unread && r.room !== current ? `<span class="room-badge ${r.mentions ? 'at' : ''}" aria-label="${esc(tt(`непрочитанных: ${r.unread}`, `unread: ${r.unread}`))}">${r.mentions ? '@' : ''}${r.unread > 99 ? '99+' : r.unread}</span>` : ''}</a>`).join('')}</div></nav>`;
}

// ---------- «Написать в чат» / «Общение»: доступные чаты; если доступен только общий — сразу он ----------
export async function rooms(ctx) {
  if (!session.user) return needLogin(ctx.main, tt('Чтобы общаться с участниками, войдите. После входа вы вернётесь к чатам.', 'Sign in to talk with participants. You will come back to the chats after signing in.'));
  loading(ctx.main);
  let d;
  try { d = await api('/api/chats'); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  if (d.rooms.length === 1) { ctx.navigate('/team/' + d.rooms[0].room, { replace: true }); return; }
  ctx.main.innerHTML = `<div class="wrap page narrow stack"><div class="page-head"><h1>${esc(tt('Общение', 'Community'))}</h1><p class="sub">${esc(tt('Ваши чаты. Закрытые отмечены замком.', 'Your chats. Private ones are marked with a lock.'))}</p></div>
    <div class="list">${d.rooms.map((r) => `<a class="item" href="${u('/team/' + r.room)}"><span class="ic">${r.closed ? ic.lock : ic.chat}</span><span class="body"><b>${esc(rt(r.room))}${r.unread ? ` <span class="room-badge ${r.mentions ? 'at' : ''}">${r.mentions ? '@' : ''}${r.unread}</span>` : ''}</b><span class="small">${esc(tt(...ROOM_NOTE[r.room]))}${r.lastAt ? ` · ${esc(tt('последнее', 'last'))} ${esc(when(r.lastAt))}` : ''}</span></span><span aria-hidden="true">→</span></a>`).join('')}</div>
    <p class="small muted"><a href="${u('/me/notifications')}">${esc(tt('Уведомления на телефон', 'Phone notifications'))}</a></p></div>`;
}

// ---------- комната: сообщения и «Медиа» ----------
export async function chat(ctx, room) {
  if (!session.user) return needLogin(ctx.main, tt('Чат доступен после входа. После входа вы вернётесь сюда.', 'Sign in to open the chat. You will come back here after signing in.'));
  loading(ctx.main);
  let d;
  const load = async () => { d = await api(`/api/chats/${room}`); };
  try { await load(); } catch (e) {
    if (!ctx.alive()) return;
    if (e.status === 403) return noRole(ctx.main, room === 'curators' ? ROLE_LABEL.curator() : ROLE_LABEL.facilitator());
    return failed(ctx.main, e, ctx.rerender);
  }
  if (!ctx.alive()) return;
  const isAdmin = session.user.roles.includes('admin');
  let tab = ctx.query.get('tab') === 'media' ? 'media' : 'msgs';
  let cat = '';
  const draft = { text: '', files: [], category: '', clientId: '', replyTo: null, mentions: [] };
  const focusWork = Number(ctx.query.get('work')) || null;
  let focusMsg = Number(ctx.query.get('m')) || null;
  // Граница «Новые сообщения»: сколько чужих непрочитанных было при входе.
  const unreadAtOpen = ((d.rooms || []).find((r) => r.room === room) || {}).unread || 0;
  const firstUnreadId = (() => { if (!unreadAtOpen) return null; const others = d.messages.filter((m) => m.userId !== session.user.id && !m.deleted); return (others[others.length - unreadAtOpen] || {}).id || null; })();
  const markRead = async () => {
    const last = d.messages.length ? d.messages[d.messages.length - 1].id : 0;
    if (!last) return;
    try { await api(`/api/chats/${room}/read`, { method: 'POST', body: { lastId: last } }); (d.rooms.find((r) => r.room === room) || {}).unread = 0; refreshBadge(); } catch { /* счётчик обновится позже */ }
  };
  // Текст с выделенными упоминаниями (@Имя тех, кого упомянули в этом сообщении).
  const textHtml = (m) => {
    let h = esc(m.text);
    for (const p of m.mentions || []) { const tag = esc('@' + p.name); h = h.split(tag).join(`<span class="ment">${tag}</span>`); }
    return h;
  };
  const toMe = (m) => (m.mentions || []).some((p) => p.id === session.user.id) || (m.replyTo && d.messages.some((x) => x.id === m.replyTo.id && x.userId === session.user.id));
  const msgHtml = (m) => `${m.id === firstUnreadId ? `<div class="unread-line" role="separator">${esc(tt('Новые сообщения', 'New messages'))}</div>` : ''}<article class="msg ${m.userId === session.user.id ? 'me' : ''} ${toMe(m) ? 'to-me' : ''}" id="m-${m.id}" tabindex="-1">
      <div class="msg-head"><span class="msg-ava" aria-hidden="true">${esc(initial(m.author))}</span><b>${esc(m.author)}</b><time datetime="${esc(m.createdAt)}">${esc(when(m.createdAt))}</time></div>
      ${m.deleted ? `<p class="msg-hidden">${esc(m.moderated ? tt('Сообщение скрыто модератором.', 'Message hidden by a moderator.') : tt('Сообщение удалено автором.', 'Message deleted by its author.'))}${isAdmin && m.hiddenText != null ? `<br><span class="small">${esc(tt('Видно только администратору:', 'Visible to admins only:'))} «${esc(m.hiddenText)}»</span>` : ''}</p>
        ${isAdmin && m.moderated ? `<div class="msg-acts"><button class="linkbtn" type="button" data-restore="${m.id}">${esc(tt('Восстановить', 'Restore'))}</button></div>` : ''}`
      : `${m.forwardOf ? `<a class="msg-fwd small" href="${esc(u('/team/' + encodeURIComponent(m.forwardOf.room) + '?m=' + encodeURIComponent(m.forwardOf.id)))}">${ic.reply} ${esc(tt('Переслано из общего чата', 'Forwarded from the general chat'))} · <b>${esc(m.forwardOf.author)}</b>${m.forwardOf.deleted ? ` · ${esc(tt('оригинал удалён', 'original deleted'))}` : ''}</a>` : ''}
      ${m.replyTo ? `<button type="button" class="msg-quote" data-goto="${m.replyTo.id}"><b>${esc(m.replyTo.author)}</b> · ${esc(m.replyTo.deleted ? tt('сообщение удалено', 'message deleted') : m.replyTo.text || tt('изображение', 'image'))}</button>` : ''}
      ${m.text ? `<p>${textHtml(m)}</p>` : ''}
      ${m.attachments.length ? `<div class="msg-imgs">${m.attachments.map((a) => `<button type="button" class="msg-img" data-att="${m.id}:${a.id}" aria-label="${esc(tt('Открыть изображение', 'Open image'))}"><img src="${esc(u(a.thumb))}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
      ${m.workId ? `<a class="btn sm" href="${u('/curator/works/' + m.workId)}">${esc(tt(`Открыть работу №${m.workId}`, `Open work #${m.workId}`))} →</a>` : ''}
      <div class="msg-acts"><button class="linkbtn" type="button" data-reply="${m.id}">${esc(tt('Ответить', 'Reply'))}</button>
        ${room === 'general' && fwdTargets.length ? `<button class="linkbtn" type="button" data-fwd="${m.id}">${esc(tt('Переслать', 'Forward'))}</button>` : ''}
        ${m.userId !== session.user.id ? `<button class="linkbtn" type="button" data-mention="${m.userId}">${esc(tt('Упомянуть', 'Mention'))}</button>` : ''}
        ${m.userId === session.user.id ? `<button class="linkbtn" type="button" data-del="${m.id}">${esc(tt('Удалить', 'Delete'))}</button>` : isAdmin ? `<button class="linkbtn" type="button" data-hide="${m.id}">${esc(tt('Скрыть (модерация)', 'Hide (moderation)'))}</button>` : ''}</div>`}
    </article>`;
  const zoomUrl = shareLink('/chat'); // ссылка для других людей — на нейтральный адрес
  // куда можно переслать из общего чата: закрытые чаты, доступные этому человеку (сервер проверяет права ещё раз)
  const fwdTargets = (d.rooms || []).map((r) => r.room).filter((r) => r !== 'general');
  const draw = async () => {
    const tabs = `<div class="seg" role="tablist" aria-label="${esc(tt('Раздел чата', 'Chat section'))}"><button role="tab" type="button" data-tab="msgs" aria-selected="${tab === 'msgs'}">${esc(tt('Сообщения', 'Messages'))}</button><button role="tab" type="button" data-tab="media" aria-selected="${tab === 'media'}">${esc(tt('Медиа', 'Media'))}</button></div>`;
    let body = '';
    if (tab === 'msgs') {
      const rep = draft.replyTo && d.messages.find((m) => m.id === draft.replyTo);
      const ppl = (d.people || []).filter((p) => p.id !== session.user.id);
      body = `<div class="chat card-ui flat" id="msgs" aria-live="polite">${d.messages.map(msgHtml).join('') || `<p class="muted">${esc(tt('Сообщений пока нет. Напишите первым — представьтесь или задайте вопрос.', 'No messages yet. Be the first — introduce yourself or ask a question.'))}</p>`}</div>
        <form class="composer" id="cf" novalidate>
          ${rep ? `<div class="reply-strip">${ic.reply}<span class="grow">${esc(tt('Ответ', 'Reply to'))} <b>${esc(rep.author)}</b>: ${esc((rep.text || '').slice(0, 80))}</span><button type="button" class="mini-btn" data-unreply aria-label="${esc(tt('Отменить ответ', 'Cancel reply'))}">${ic.x}</button></div>` : ''}
          ${draft.mentions.length ? `<div class="ment-chips">${draft.mentions.map((id) => { const p = ppl.find((x) => x.id === id); return p ? `<span class="chip on">@${esc(p.name)} <button type="button" class="mini-btn" data-unment="${id}" aria-label="${esc(tt('Убрать упоминание', 'Remove mention'))}">${ic.x}</button></span>` : ''; }).join('')}</div>` : ''}
          <label class="sr-only" for="ct">${esc(tt('Сообщение', 'Message'))}</label>
          <div class="cf-main"><label class="cf-photo" title="${esc(tt('Фото', 'Photos'))}">${ic.plus}<span>${esc(tt('Фото', 'Photos'))}</span><input type="file" id="cfile" accept="image/jpeg,image/png,image/webp" multiple hidden></label>
            <textarea id="ct" name="text" maxlength="4000" placeholder="${esc(tt('Сообщение', 'Message'))}" rows="2">${esc(draft.text)}</textarea>
            <button class="btn yellow" type="submit" id="csend">${esc(tt('Отправить', 'Send'))}</button></div>
          <div class="cf-files" id="cf-files">${draft.files.map((f, i) => `<span class="cf-file"><img src="${esc(f.url)}" alt=""><button type="button" class="mini-btn r" data-unfile="${i}" aria-label="${esc(tt('Убрать изображение', 'Remove image'))}">${ic.x}</button></span>`).join('')}</div>
          ${draft.files.length ? `<label class="field small">${esc(tt('Категория изображений', 'Image category'))} <span class="hint">${esc(tt('необязательно', 'optional'))}</span><select name="category">${Object.entries(CAT).map(([k, v]) => `<option value="${k}" ${k === draft.category ? 'selected' : ''}>${esc(k ? tt(...v) : tt('Без категории', 'No category'))}</option>`).join('')}</select></label>
            ${draft.category === 'meetings' ? `<p class="small muted" style="margin:0">${esc(tt('Публикуйте фото со встреч только с согласия тех, кто на них есть. Сами разговоры не снимаются — фото показывают атмосферу встречи.', 'Post meeting photos only with the consent of the people in them. The conversations themselves are not recorded — photos show the atmosphere.'))}</p>` : ''}
            ${draft.category === 'illustrations' ? `<p class="small muted" style="margin:0">${esc(tt('Изображения из чата не публикуются в галерее. Чтобы предложить карту, используйте «Предложить иллюстрацию».', 'Chat images are not published in the gallery. To suggest a card, use “Suggest an illustration”.'))}</p>` : ''}` : ''}
          <p class="form-error" id="cerr" role="alert"></p>
          <div class="cf-sub">${ppl.length ? `<label class="sr-only" for="cment">${esc(tt('Упомянуть участника', 'Mention someone'))}</label><select id="cment" class="cf-ment"><option value="">@ ${esc(tt('Упомянуть', 'Mention'))}</option>${ppl.filter((p) => !draft.mentions.includes(p.id)).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>` : ''}
            <span class="small muted">${esc(tt('Фото: JPEG, PNG или WebP, до 6, каждое до 15 МБ. Видно ваше публичное имя, email — нет.', 'Photos: JPEG, PNG or WebP, up to 6, up to 15 MB each. Your public name is shown, not your email.'))}</span></div></form>`;
    } else {
      let media = [];
      try { ({ media } = await api(`/api/chats/${room}/media${cat ? '?category=' + cat : ''}`)); } catch (e) { body = `<p class="error-box">${esc(errorText(e))}</p>`; }
      if (!body) body = `<div class="chips" role="group" aria-label="${esc(tt('Фильтр', 'Filter'))}">${Object.entries(CAT).map(([k, v]) => `<button class="chip" type="button" data-cat="${k}" aria-pressed="${k === cat}">${esc(tt(...v))}</button>`).join('')}</div>
        ${media.length ? `<div class="media-grid">${media.map((a) => `<button type="button" class="msg-img" data-media="${a.id}"><img src="${esc(u(a.thumb))}" alt="" loading="lazy"></button>`).join('')}</div>` : `<p class="empty">${esc(tt('Здесь пока нет изображений.', 'No images here yet.'))}</p>`}`;
      ctx._media = media;
    }
    const canShareZoom = room === 'general' && (hasRole('facilitator') || isAdmin);
    ctx.main.innerHTML = `<div class="wrap page stack">
      <div class="chat-layout">
        ${d.rooms.length > 1 ? roomLinks(d.rooms, room) : '<div></div>'}
        <div class="stack" style="min-width:0">
          <div class="page-head"><h1>${ROOM_TITLE[room] && room !== 'general' ? `${ic.lock} ` : ''}${esc(rt(room))}</h1><p class="sub">${esc(tt(...ROOM_NOTE[room]))}${d.members ? ` ${esc(tt('Сейчас в доступе:', 'Currently:'))} ${d.members.map((m) => esc(m.name)).join(', ')}.` : ''}</p></div>
          <div class="chat-tools">${tabs}
            <label class="small cnotify">${ic.bell} <span>${esc(tt('Уведомления для этого чата', 'Notifications for this chat'))}</span><select id="cnotify">${Object.entries(MODE_LABEL).map(([k, v]) => `<option value="${k}" ${d.notify === k ? 'selected' : ''}>${esc(tt(...v))}</option>`).join('')}</select>
              </label><a class="small" href="${u('/me/notifications')}">${esc(tt('Настройки', 'Settings'))}</a></div>
          <p class="small muted" style="margin:-4px 0 0">${esc(tt('Это только о том, что приходит на телефон: в ленте видны все сообщения при любом выборе.', 'This only affects what reaches your phone: the feed shows all messages whatever you choose.'))}</p>
          ${canShareZoom ? `<details class="small zoom-link"><summary>${esc(tt('Ссылка на общий чат для участников Zoom', 'General chat link for Zoom participants'))}</summary><input type="text" readonly value="${esc(zoomUrl)}" id="zoomurl"><span class="muted">${esc(tt('Гость увидит вход и после него вернётся в общий чат.', 'A guest sees sign-in and returns to the general chat afterwards.'))}</span></details>` : ''}
          ${body}</div></div></div>`;
    wire();
  };
  function openImage(src, w, h, msgId, caption) {
    const el = document.createElement('div'); el.className = 'picker-wrap'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', tt('Изображение', 'Image'));
    const opener = document.activeElement;
    el.innerHTML = `<div class="picker"><div class="picker-head"><button class="icon-btn" type="button" data-x aria-label="${esc(tt('Закрыть', 'Close'))}">${ic.close}</button><div class="grow small">${caption}</div>
      ${msgId ? `<button class="btn sm" type="button" data-go>${esc(tt('К сообщению', 'To the message'))}</button>` : ''}</div>
      <div class="picker-body" style="display:grid;place-items:center"><img src="${esc(src)}" alt="" style="max-width:100%;max-height:78vh;border-radius:12px" width="${w}" height="${h}"></div></div>`;
    document.getElementById('overlay-root').appendChild(el); document.body.classList.add('no-scroll');
    const close = () => { el.remove(); document.body.classList.remove('no-scroll'); document.removeEventListener('keydown', onKey); if (opener && document.contains(opener)) opener.focus({ preventScroll: true }); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    el.querySelector('[data-x]').onclick = close; el.addEventListener('click', (e) => { if (e.target === el) close(); });
    const go = el.querySelector('[data-go]'); if (go) go.onclick = async () => { close(); tab = 'msgs'; focusMsg = msgId; await draw(); };
    el.querySelector('[data-x]').focus();
  }
  const flash = (id) => { const t = ctx.main.querySelector('#m-' + id); if (t) { t.scrollIntoView({ block: 'center' }); t.classList.add('flash'); t.focus({ preventScroll: true }); return true; } return false; };
  function wire() {
    ctx.main.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; draw(); }));
    ctx.main.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => { cat = b.dataset.cat; draw(); }));
    ctx.main.querySelectorAll('[data-media]').forEach((b) => b.addEventListener('click', () => { const a = ctx._media.find((x) => String(x.id) === b.dataset.media); openImage(u(a.full), a.width, a.height, a.messageId, `<b>${esc(a.author)}</b> · ${esc(when(a.createdAt))}${a.text ? `<br>${esc(a.text.slice(0, 160))}` : ''}`); }));
    const nsel = ctx.main.querySelector('#cnotify');
    nsel.addEventListener('change', async () => { try { await api(`/api/chats/${room}/notify`, { method: 'PUT', body: { mode: nsel.value } }); d.notify = nsel.value; toast(tt('Режим уведомлений сохранён', 'Notification mode saved')); } catch (e) { toast(errorText(e)); nsel.value = d.notify; } });
    const zu = ctx.main.querySelector('#zoomurl'); if (zu) zu.addEventListener('focus', () => zu.select());
    const box = ctx.main.querySelector('#msgs');
    if (!box) return;
    box.scrollTop = box.scrollHeight;
    if (focusMsg) { flash(focusMsg); focusMsg = null; }
    else if (focusWork) { const t = [...d.messages].reverse().find((m) => m.workId === focusWork); if (t) flash(t.id); }
    else if (firstUnreadId) { const t = ctx.main.querySelector('#m-' + firstUnreadId); if (t) box.scrollTop = t.offsetTop - box.offsetTop - 40; }
    box.addEventListener('click', async (e) => {
      const at = e.target.closest('[data-att]');
      if (at) { const [mid, aid] = at.dataset.att.split(':').map(Number); const m = d.messages.find((x) => x.id === mid); const a = m.attachments.find((x) => x.id === aid); openImage(u(a.full), a.width, a.height, null, `<b>${esc(m.author)}</b> · ${esc(when(m.createdAt))}`); return; }
      const gt = e.target.closest('[data-goto]'); if (gt) { if (!flash(gt.dataset.goto)) toast(tt('Исходное сообщение старше показанных.', 'The original message is older than those shown.')); return; }
      const rp = e.target.closest('[data-reply]'); if (rp) { draft.replyTo = Number(rp.dataset.reply); await draw(); ctx.main.querySelector('#ct').focus(); return; }
      const mn = e.target.closest('[data-mention]'); if (mn) { addMention(Number(mn.dataset.mention)); return; }
      const fw = e.target.closest('[data-fwd]');
      if (fw) {
        const msg = fw.closest('.msg'); const old = msg.querySelector('.fwd-pick'); if (old) { old.remove(); return; }
        msg.insertAdjacentHTML('beforeend', `<div class="fwd-pick" role="group" aria-label="${esc(tt('Куда переслать', 'Forward to'))}"><span class="small">${esc(tt('Переслать в:', 'Forward to:'))}</span>${fwdTargets.map((r) => `<button class="btn sm light" type="button" data-fwd-to="${r}" data-fwd-id="${fw.dataset.fwd}">${ic.lock} ${esc(rt(r))}</button>`).join('')}<button class="linkbtn small" type="button" data-fwd-x>${esc(tt('Отмена', 'Cancel'))}</button></div>`);
        return;
      }
      if (e.target.closest('[data-fwd-x]')) { e.target.closest('.fwd-pick').remove(); return; }
      const ft = e.target.closest('[data-fwd-to]');
      if (ft) {
        const m = d.messages.find((x) => x.id === Number(ft.dataset.fwdId));
        if (!confirm(tt(`Переслать сообщение ${m ? m.author : ''} в «${rt(ft.dataset.fwdTo)}»? Оригинал останется здесь.`, `Forward ${m ? m.author : ''}’s message to “${rt(ft.dataset.fwdTo)}”? The original stays here.`))) return;
        try { await api(`/api/chats/${room}/messages/${ft.dataset.fwdId}/forward`, { method: 'POST', body: { to: ft.dataset.fwdTo } }); toast(tt(`Переслано в «${rt(ft.dataset.fwdTo)}»`, `Forwarded to “${rt(ft.dataset.fwdTo)}”`)); ft.closest('.fwd-pick').remove(); }
        catch (x) { toast(errorText(x)); }
        return;
      }
      const del = e.target.closest('[data-del]');
      if (del) { if (!confirm(tt('Удалить сообщение? Текст и изображения скроются у всех.', 'Delete the message? Its text and images will be hidden for everyone.'))) return; try { await api(`/api/chats/${room}/messages/${del.dataset.del}`, { method: 'DELETE' }); await load(); draw(); } catch (x) { toast(errorText(x)); } return; }
      const hide = e.target.closest('[data-hide]');
      if (hide) {
        const reason = prompt(tt('Скрыть сообщение как модератор? Автор и время останутся, текст увидит только администратор; можно восстановить. Причина (необязательно):', 'Hide this message as a moderator? Author and time stay, only admins see the text; it can be restored. Reason (optional):'), '');
        if (reason === null) return;
        try { await api(`/api/chats/${room}/messages/${hide.dataset.hide}?reason=${encodeURIComponent(reason)}`, { method: 'DELETE' }); toast(tt('Скрыто. Действие записано в журнал.', 'Hidden. The action is logged.')); await load(); draw(); } catch (x) { toast(errorText(x)); }
        return;
      }
      const rs = e.target.closest('[data-restore]');
      if (rs) { try { await api(`/api/chats/${room}/messages/${rs.dataset.restore}/restore`, { method: 'POST' }); toast(tt('Сообщение восстановлено', 'Message restored')); await load(); draw(); } catch (x) { toast(errorText(x)); } }
    });
    const f = ctx.main.querySelector('#cf');
    f.text.addEventListener('input', () => { draft.text = f.text.value; });
    if (f.category) f.category.addEventListener('change', () => { draft.category = f.category.value; draw(); });
    const cm = ctx.main.querySelector('#cment'); if (cm) cm.addEventListener('change', () => { if (cm.value) addMention(Number(cm.value)); });
    const ur = ctx.main.querySelector('[data-unreply]'); if (ur) ur.addEventListener('click', () => { draft.replyTo = null; draw(); });
    ctx.main.querySelectorAll('[data-unment]').forEach((b) => b.addEventListener('click', () => { draft.mentions = draft.mentions.filter((x) => x !== Number(b.dataset.unment)); draw(); }));
    ctx.main.querySelector('#cfile').addEventListener('change', (e) => {
      const add = [...e.target.files].filter((x) => /^image\/(jpeg|png|webp)$/.test(x.type));
      if (add.length < e.target.files.length) toast(tt('Подходят только JPEG, PNG или WebP.', 'Only JPEG, PNG or WebP.'));
      draft.files = [...draft.files, ...add.map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(0, 6); draft.clientId = ''; draw();
    });
    ctx.main.querySelectorAll('[data-unfile]').forEach((b) => b.addEventListener('click', () => { draft.files.splice(Number(b.dataset.unfile), 1); draft.clientId = ''; draw(); }));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = ctx.main.querySelector('#cerr'); const btn = ctx.main.querySelector('#csend');
      if (!draft.text.trim() && !draft.files.length) { err.textContent = tt('Напишите сообщение или добавьте фото.', 'Write a message or add photos.'); return; }
      // одна и та же попытка (текст + файлы) отправляется с одним clientId: повтор после ошибки не создаст дубль
      if (!draft.clientId) draft.clientId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
      const fd = new FormData(); fd.append('text', draft.text); fd.append('category', draft.category); fd.append('clientId', draft.clientId);
      if (draft.replyTo) fd.append('replyTo', String(draft.replyTo));
      if (draft.mentions.length) fd.append('mentions', draft.mentions.join(','));
      for (const x of draft.files) fd.append('images', x.file, x.file.name);
      btn.disabled = true; btn.textContent = draft.files.length ? tt('Загружаем…', 'Uploading…') : tt('Отправляем…', 'Sending…'); err.textContent = '';
      try {
        await api(`/api/chats/${room}`, { method: 'POST', form: fd });
        draft.files.forEach((x) => URL.revokeObjectURL(x.url)); Object.assign(draft, { text: '', files: [], category: '', clientId: '', replyTo: null, mentions: [] });
        await load(); draw(); markRead();
      } catch (x) { btn.disabled = false; btn.textContent = tt('Повторить отправку', 'Retry sending'); err.textContent = `${errorText(x)} ${tt('Текст и фото сохранены.', 'Your text and photos are kept.')}`; }
    });
  }
  // Упоминание: участник попадает в список упомянутых, в текст добавляется @Имя.
  function addMention(id) {
    const p = (d.people || []).find((x) => x.id === id);
    if (!p) { toast(tt('Этого участника нельзя упомянуть в этом чате.', 'This person cannot be mentioned in this chat.')); return; }
    if (!draft.mentions.includes(id)) draft.mentions.push(id);
    const tag = '@' + p.name;
    if (!draft.text.includes(tag)) draft.text = (draft.text ? draft.text.replace(/\s*$/, ' ') : '') + tag + ' ';
    draw().then(() => { const t = ctx.main.querySelector('#ct'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } });
  }
  await draw();
  markRead();
}

export async function print(ctx) {
  if (!session.user) return needLogin(ctx.main, '');
  if (!hasRole('curator', 'artist')) return noRole(ctx.main, tt('куратор или автор', 'curator or author'));
  loading(ctx.main);
  let d;
  try { d = await api('/api/print'); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  const PERM = { not_set: [tt('Разрешение автора не получено', 'No permission from the author yet'), ''], allowed: [tt('Автор разрешил печать', 'Author allows printing'), 'mint'], denied: [tt('Автор не разрешил печать', 'Author does not allow printing'), 'red'] };
  ctx.main.innerHTML = `<section class="hero"><div class="wrap" style="padding-block:30px;grid-template-columns:1fr"><div>
      <p class="eyebrow">${esc(tt('Печатное направление · будущий этап', 'Print direction · future stage'))}</p><h1>${esc(tt('Печатная колода', 'Printed deck'))}</h1>
      <p class="lead">${esc(tt('Печатная колода — 40 карт. Статистика выборов на встречах помогает отбору. Доступ к файлам для печати планируется только одобренным фасилитаторам и только с разрешения автора каждой карты.', 'The printed deck is 40 cards. Choice statistics from meetings help with selection. Access to print files is planned only for approved facilitators and only with each artist’s permission.'))}</p></div></div></section>
    <div class="wrap page stack">
      <div class="notice"><b>${esc(tt('Статус:', 'Status:'))}</b> ${esc(tt('выдача оригиналов выключена до согласования прав с авторами. Продажи и цена колоды — будущий этап, магазин не подключается.', 'distribution of originals is off until rights are agreed with the authors. Sales and deck price are a future stage; no shop is connected.'))}</div>
      <h2>${esc(tt('Карты по числу выборов на встречах', 'Cards by number of choices at meetings'))}</h2>
      <div class="list">${d.cards.map((c, i) => `<div class="item"><span class="thumb"><img src="${esc(c.thumb)}" alt="" loading="lazy"></span>
        <span class="body"><b>${i + 1}. ${esc(c.code)}</b><span class="small">${esc(c.author || '—')} · ${esc(tt('выбрали', 'chosen'))}: ${c.selections}</span></span>
        <span class="pill ${PERM[c.printPermission][1]}">${esc(PERM[c.printPermission][0])}</span>
        <button class="btn sm" type="button" disabled title="${esc(tt('Выдача файлов выключена', 'File access is off'))}">${esc(tt('Файл для печати', 'Print file'))}</button></div>`).join('')}</div>
    </div>`;
}
