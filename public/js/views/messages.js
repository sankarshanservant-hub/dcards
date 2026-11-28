// Личная переписка с администрацией (28.11.2026): у каждого вошедшего — «Написать администрации», у администратора —
// раздел «Сообщения» со всеми переписками. Хранение, вложения, прочитанность — общими механизмами чатов (комната dm-<id>).
// Права — на сервере: переписку видит только сам участник и администраторы. Без тикетов, категорий и статусов.
import { esc, tt, u, api, errorText, toast, fmtDate } from '../util.js';
import { session, needLogin, loading, failed, ic, rolesText } from '../ui.js';

const when = (iso) => fmtDate(iso, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const MAX_FILES = 6;
export const ADMIN_EMAIL = 'dialogue.cards@gmail.com';
const refreshBadge = () => { if (window.dcRefreshUnread) window.dcRefreshUnread(true); };

/**
 * Переписка в контейнере host. load() → { messages }; сообщения с fromAdmin — со стороны администрации.
 * adminView: администратор видит имена коллег, участник — подпись «Администрация».
 */
function thread(ctx, host, { room, load, adminView, intro = '', empty = '' }) {
  let d = { messages: [] }; const files = []; let sending = false; let clientId = ''; let text = '';
  const author = (m) => (m.fromAdmin ? (adminView ? `${m.author} · ${tt('администрация', 'team')}` : tt('Администрация Dialogue Cards', 'Dialogue Cards team')) : (adminView ? m.author : tt('Вы', 'You')));
  const mine = (m) => (adminView ? m.fromAdmin : !m.fromAdmin);
  const msg = (m) => `<article class="dm-msg ${mine(m) ? 'me' : ''}" id="m-${m.id}">
      <div class="dm-head"><b>${esc(author(m))}</b><time datetime="${esc(m.createdAt)}">${esc(when(m.createdAt))}</time></div>
      ${m.deleted ? `<p class="msg-hidden">${esc(tt('Сообщение удалено.', 'Message deleted.'))}</p>` : `${m.text ? `<p>${esc(m.text)}</p>` : ''}
      ${m.attachments.length ? `<div class="msg-imgs">${m.attachments.map((a) => `<a class="msg-img" href="${esc(u(a.full))}" target="_blank" rel="noopener" aria-label="${esc(tt('Открыть изображение', 'Open image'))}"><img src="${esc(u(a.thumb))}" alt="" loading="lazy"></a>`).join('')}</div>` : ''}
      ${m.userId === session.user.id ? `<button class="linkbtn small" type="button" data-del="${m.id}">${esc(tt('Удалить', 'Delete'))}</button>` : ''}`}
    </article>`;
  const draw = () => {
    host.innerHTML = `${intro}
      <div class="dm-list" aria-live="polite">${d.messages.length ? d.messages.map(msg).join('') : `<p class="muted small dm-empty">${esc(empty)}</p>`}</div>
      <form class="dm-form" id="dmform" novalidate>
        <label class="sr-only" for="dmtext">${esc(tt('Сообщение', 'Message'))}</label>
        <textarea id="dmtext" rows="3" maxlength="4000" placeholder="${esc(tt('Ваше сообщение', 'Your message'))}">${esc(text)}</textarea>
        ${files.length ? `<div class="dm-files">${files.map((f, i) => `<span class="dm-file"><img src="${f.url}" alt=""><button type="button" class="icon-btn" data-rmf="${i}" aria-label="${esc(tt('Убрать изображение', 'Remove image'))}">${ic.close}</button></span>`).join('')}</div>` : ''}
        <div class="dm-acts"><label class="btn light sm dm-attach">${ic.picPlus} ${esc(tt('Изображение', 'Image'))}<input type="file" id="dmfile" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple hidden></label>
          <button class="btn yellow" type="submit" id="dmsend" ${sending ? 'disabled aria-busy="true"' : ''}>${esc(sending ? tt('Отправляем…', 'Sending…') : tt('Отправить', 'Send'))}</button></div>
        <p class="form-error" role="alert" id="dmerr"></p>
      </form>`;
    wire();
  };
  const markRead = async () => {
    const last = d.messages.length ? d.messages[d.messages.length - 1].id : 0; if (!last) return;
    try { await api(`/api/chats/${room}/read`, { method: 'POST', body: { lastId: last } }); refreshBadge(); } catch { /* позже */ }
  };
  const refresh = async (scroll = false) => {
    const before = d.messages.length ? d.messages[d.messages.length - 1].id : 0;
    d = await load(); if (!ctx.alive()) return;
    const after = d.messages.length ? d.messages[d.messages.length - 1].id : 0;
    if (after !== before || scroll) { const focused = document.activeElement && document.activeElement.id === 'dmtext'; draw(); if (focused) host.querySelector('#dmtext').focus({ preventScroll: true }); }
    if (scroll) { const l = host.querySelector('.dm-list .dm-msg:last-child'); if (l) l.scrollIntoView({ block: 'nearest' }); }
    markRead();
  };
  const wire = () => {
    const $ = (q) => host.querySelector(q);
    $('#dmtext').addEventListener('input', (e) => { text = e.target.value; });
    $('#dmfile').addEventListener('change', (e) => {
      for (const f of e.target.files) { if (files.length >= MAX_FILES) { toast(tt(`Не больше ${MAX_FILES} изображений`, `Up to ${MAX_FILES} images`)); break; } files.push({ file: f, url: URL.createObjectURL(f) }); }
      draw();
    });
    host.querySelectorAll('[data-rmf]').forEach((b) => b.addEventListener('click', () => { const [x] = files.splice(Number(b.dataset.rmf), 1); if (x) URL.revokeObjectURL(x.url); draw(); }));
    host.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm(tt('Удалить сообщение?', 'Delete the message?'))) return;
      try { await api(`/api/chats/${room}/messages/${b.dataset.del}`, { method: 'DELETE' }); await refresh(); } catch (e) { toast(errorText(e)); }
    }));
    $('#dmform').addEventListener('submit', async (e) => {
      e.preventDefault(); if (sending) return;
      text = $('#dmtext').value.trim();
      if (!text && !files.length) { $('#dmerr').textContent = tt('Напишите сообщение или добавьте изображение.', 'Write a message or add an image.'); return; }
      // один clientId на попытку: повторное нажатие после сбоя сети не создаёт второе сообщение
      if (!clientId) clientId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).slice(0, 64);
      const fd = new FormData(); fd.append('text', text); fd.append('clientId', clientId);
      for (const x of files) fd.append('images', x.file, x.file.name);
      sending = true; draw();
      try {
        await api(`/api/chats/${room}`, { method: 'POST', form: fd });
        files.splice(0).forEach((x) => URL.revokeObjectURL(x.url)); text = ''; clientId = '';
        sending = false; await refresh(true);
      } catch (x) { sending = false; draw(); host.querySelector('#dmerr').textContent = `${errorText(x)} ${tt('Сообщение не отправлено — попробуйте ещё раз.', 'The message was not sent — please try again.')}`; }
    });
  };
  const start = async () => {
    await refresh(true);
    const t = setInterval(() => { if (!ctx.alive()) return clearInterval(t); if (!sending && document.visibilityState === 'visible') refresh().catch(() => {}); }, 15000);
  };
  return { start };
}

// ---------- участник: «Написать администрации» ----------
export async function mine(ctx) {
  if (!session.user) {
    // гостю — понятный способ связи без аккаунта и вход для переписки в приложении
    ctx.main.innerHTML = `<div class="wrap page narrow stack"><div class="page-head"><h1>${esc(tt('Написать администрации', 'Contact the administration'))}</h1></div>
      <p>${esc(tt('Переписка с администрацией доступна после входа: так ответ придёт прямо в приложение.', 'Messages to the administration are available after signing in, so the reply comes right in the app.'))}</p>
      <div><a class="btn yellow" href="${u('/login?next=' + encodeURIComponent('/me/messages'))}">${esc(tt('Войти', 'Sign in'))}</a></div>
      <p class="small muted">${esc(tt('Без входа можно написать на почту проекта:', 'Without signing in, you can email the project:'))} <a href="mailto:${ADMIN_EMAIL}">${ADMIN_EMAIL}</a></p></div>`;
    return;
  }
  loading(ctx.main);
  const room = 'dm-' + session.user.id;
  const load = () => api('/api/messages');
  try { await load(); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  ctx.main.innerHTML = `<div class="wrap page narrow stack dm-page"><div class="page-head"><h1>${esc(tt('Написать администрации', 'Contact the administration'))}</h1>
    <p class="sub">${esc(tt('Сообщите об ошибке, задайте вопрос, предложите улучшение или просто поблагодарите. Ответ придёт сюда.', 'Report a problem, ask a question, suggest an improvement or just say thank you. The reply will come here.'))}</p></div><div id="dm"></div></div>`;
  thread(ctx, ctx.main.querySelector('#dm'), { room, load, adminView: false,
    empty: tt('Переписка пока пуста. Переписку видите только вы и администрация проекта.', 'No messages yet. Only you and the project administration can see this conversation.') }).start();
}

// ---------- администратор: раздел «Сообщения» ----------
export async function adminList(ctx, el) {
  const d = await api('/api/admin/messages'); if (!ctx.alive()) return;
  const unread = d.threads.filter((t) => t.unread).length;
  el.innerHTML = `<div class="stack">
    <div class="row" style="justify-content:space-between;align-items:center"><p class="muted small" style="margin:0">${esc(tt(`Переписок: ${d.threads.length}${unread ? ` · с новыми сообщениями: ${unread}` : ''}`, `Conversations: ${d.threads.length}${unread ? ` · with new messages: ${unread}` : ''}`))}</p>
      <button class="btn light sm" type="button" id="dmnew">${ic.plus || '＋'} ${esc(tt('Написать участнику', 'Message a member'))}</button></div>
    <div id="dmpick" hidden></div>
    ${d.threads.length ? `<div class="list adm-rows">${d.threads.map((t) => `<a class="item ${t.unread ? 'unread' : ''}" href="${u('/admin/messages/' + t.userId)}">
        <span class="body"><b>${esc(t.name)}${t.unread ? ` <span class="room-badge">${t.unread}</span>` : ''}</b>
        <span class="small muted">${esc(rolesText(t.roles))} · ${esc(when(t.lastAt))}</span>
        <span class="small">${t.lastFromUser ? '' : esc(tt('Вы: ', 'You: '))}${esc(t.lastText)}</span></span></a>`).join('')}</div>`
    : `<p class="muted">${esc(tt('Сообщений пока нет. Участники пишут из меню профиля — «Написать администрации».', 'No messages yet. Members write from the profile menu — “Contact the administration”.'))}</p>`}</div>`;
  el.querySelector('#dmnew').addEventListener('click', async () => {
    const box = el.querySelector('#dmpick'); box.hidden = false;
    box.innerHTML = `<label class="field">${esc(tt('Кому написать', 'Who to message'))}<input id="dmq" type="search" placeholder="${esc(tt('Имя или email', 'Name or email'))}" autocomplete="off"></label><div class="list" id="dmres"></div>`;
    let users = [];
    try { users = (await api('/api/admin/users')).users; } catch (e) { toast(errorText(e)); return; }
    const q = box.querySelector('#dmq'); const res = box.querySelector('#dmres');
    const show = () => { const v = q.value.trim().toLowerCase(); const list = users.filter((x) => !v || [x.publicName, x.name, x.email].some((s) => String(s || '').toLowerCase().includes(v))).slice(0, 20);
      res.innerHTML = list.map((x) => `<a class="item" href="${u('/admin/messages/' + x.id)}"><span class="body"><b>${esc(x.publicName || x.name || x.email)}</b><span class="small muted">${esc(rolesText(x.roles))}</span></span></a>`).join('') || `<p class="small muted">${esc(tt('Никого не нашли', 'Nobody found'))}</p>`; };
    q.addEventListener('input', show); show(); q.focus();
  });
}
export async function adminThread(ctx, el, uid) {
  const load = () => api('/api/admin/messages/' + uid);
  const first = await load(); if (!ctx.alive()) return;
  const usr = first.user;
  // назад к списку — стандартная стрелка над страницей (app.js, PARENTS: /admin/messages/<id> → /admin/messages)
  el.innerHTML = `<div class="stack dm-page">
    <div class="card-ui flat"><b>${esc(usr.name)}</b> <span class="small muted">· ${esc(rolesText(usr.roles))}${usr.email ? ` · ${esc(usr.email)}` : ''}</span></div><div id="dm"></div></div>`;
  thread(ctx, el.querySelector('#dm'), { room: first.room, load, adminView: true,
    empty: tt('Переписки ещё нет — можно написать первым. Участник увидит сообщение в приложении.', 'No messages yet — you can write first. The member will see it in the app.') }).start();
}
