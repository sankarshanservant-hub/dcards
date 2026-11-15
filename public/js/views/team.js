// Чаты (общий, кураторов, фасилитаторов) с изображениями и разделом «Медиа»; печатное направление.
import { esc, tt, u, api, errorText, toast, fmtDate } from '../util.js';
import { session, hasRole, needLogin, noRole, loading, failed, ROLE_LABEL, ic } from '../ui.js';

const ROOM_TITLE = { general: ['Общий чат', 'General chat'], curators: ['Чат кураторов', 'Curators’ chat'], facilitators: ['Чат фасилитаторов', 'Facilitators’ chat'] };
const ROOM_NOTE = { general: ['Для всех участников проекта.', 'For everyone in the project.'], curators: ['Закрытый: кураторы и администраторы.', 'Private: curators and administrators.'], facilitators: ['Закрытый: фасилитаторы и администраторы.', 'Private: facilitators and administrators.'] };
const CAT = { '': ['Все', 'All'], meetings: ['Фото со встреч', 'Meeting photos'], illustrations: ['Иллюстрации', 'Illustrations'], inspiration: ['Вдохновение', 'Inspiration'] };
const rt = (r) => tt(...ROOM_TITLE[r]);
const initial = (n) => { const m = String(n || '').match(/[\p{L}\p{N}]/u); return m ? m[0].toLocaleUpperCase() : '·'; };

// ---------- список доступных чатов ----------
export async function rooms(ctx) {
  if (!session.user) return needLogin(ctx.main, tt('Чтобы общаться с участниками, войдите. После входа вы вернётесь к чатам.', 'Sign in to talk with participants. You will come back to the chats after signing in.'));
  loading(ctx.main);
  let d;
  try { d = await api('/api/chats'); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  if (d.rooms.length === 1) { ctx.navigate('/team/' + d.rooms[0].room, { replace: true }); return; }
  ctx.main.innerHTML = `<div class="wrap page narrow stack"><div class="page-head"><h1>${esc(tt('Чаты', 'Chats'))}</h1></div>
    <div class="list">${d.rooms.map((r) => `<a class="item" href="${u('/team/' + r.room)}"><span class="ic">${ic.chat}</span><span class="body"><b>${esc(rt(r.room))}</b><span class="small">${esc(tt(...ROOM_NOTE[r.room]))}${r.lastAt ? ` · ${esc(tt('последнее', 'last'))} ${esc(fmtDate(r.lastAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}` : ''}</span></span><span aria-hidden="true">→</span></a>`).join('')}</div></div>`;
}

// ---------- комната: сообщения и «Медиа» ----------
export async function chat(ctx, room) {
  if (!session.user) return needLogin(ctx.main, tt('Чат доступен после входа. После входа вы вернётесь сюда.', 'Sign in to open the chat. You will come back here after signing in.'));
  loading(ctx.main);
  let d; let list;
  const load = async () => { d = await api(`/api/chats/${room}`); };
  try { [, list] = await Promise.all([load(), api('/api/chats')]); } catch (e) {
    if (!ctx.alive()) return;
    if (e.status === 403) return noRole(ctx.main, room === 'curators' ? ROLE_LABEL.curator() : ROLE_LABEL.facilitator());
    return failed(ctx.main, e, ctx.rerender);
  }
  if (!ctx.alive()) return;
  let tab = ctx.query.get('tab') === 'media' ? 'media' : 'msgs';
  let cat = '';
  const draft = { text: '', files: [], category: '', clientId: '' };
  const focusWork = Number(ctx.query.get('work')) || null;
  const msgHtml = (m) => `<article class="msg ${m.userId === session.user.id ? 'me' : ''}" id="m-${m.id}">
      <div class="msg-head"><span class="msg-ava" aria-hidden="true">${esc(initial(m.author))}</span><b>${esc(m.author)}</b><time datetime="${esc(m.createdAt)}">${esc(fmtDate(m.createdAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</time>
        ${!m.deleted && (m.userId === session.user.id || hasRole('admin') && session.user.roles.includes('admin')) ? `<button class="linkbtn msg-del" type="button" data-del="${m.id}" aria-label="${esc(tt('Удалить сообщение', 'Delete message'))}">${esc(tt('Удалить', 'Delete'))}</button>` : ''}</div>
      ${m.deleted ? `<p class="muted small">${esc(tt('Сообщение удалено.', 'Message deleted.'))}</p>` : `${m.text ? `<p>${esc(m.text)}</p>` : ''}
      ${m.attachments.length ? `<div class="msg-imgs">${m.attachments.map((a) => `<button type="button" class="msg-img" data-att="${m.id}:${a.id}" aria-label="${esc(tt('Открыть изображение', 'Open image'))}"><img src="${esc(u(a.thumb))}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
      ${m.workId ? `<a class="btn sm" href="${u('/curator/works/' + m.workId)}">${esc(tt(`Открыть работу №${m.workId}`, `Open work #${m.workId}`))} →</a>` : ''}`}
    </article>`;
  const draw = async () => {
    const tabs = `<div class="seg" role="tablist" aria-label="${esc(tt('Раздел чата', 'Chat section'))}"><button role="tab" type="button" data-tab="msgs" aria-selected="${tab === 'msgs'}">${esc(tt('Сообщения', 'Messages'))}</button><button role="tab" type="button" data-tab="media" aria-selected="${tab === 'media'}">${esc(tt('Медиа', 'Media'))}</button></div>`;
    let body = '';
    if (tab === 'msgs') {
      body = `<div class="chat card-ui flat" id="msgs">${d.messages.map(msgHtml).join('') || `<p class="muted">${esc(tt('Сообщений пока нет.', 'No messages yet.'))}</p>`}</div>
        <form class="card-ui flat stack composer" id="cf" novalidate>
          <label class="sr-only" for="ct">${esc(tt('Сообщение', 'Message'))}</label>
          <textarea id="ct" name="text" maxlength="4000" placeholder="${esc(tt('Сообщение', 'Message'))}" style="min-height:64px">${esc(draft.text)}</textarea>
          <div class="cf-files" id="cf-files">${draft.files.map((f, i) => `<span class="cf-file"><img src="${esc(f.url)}" alt=""><button type="button" class="mini-btn r" data-unfile="${i}" aria-label="${esc(tt('Убрать изображение', 'Remove image'))}">${ic.x}</button></span>`).join('')}</div>
          ${draft.files.length ? `<label class="field small">${esc(tt('Категория изображений', 'Image category'))} <span class="hint">${esc(tt('необязательно', 'optional'))}</span><select name="category">${Object.entries(CAT).map(([k, v]) => `<option value="${k}" ${k === draft.category ? 'selected' : ''}>${esc(k ? tt(...v) : tt('Без категории', 'No category'))}</option>`).join('')}</select></label>
            ${draft.category === 'illustrations' ? `<p class="small muted" style="margin:0">${esc(tt('Изображения из чата не публикуются в галерее. Чтобы предложить карту, используйте «Предложить иллюстрацию».', 'Chat images are not published in the gallery. To suggest a card, use “Suggest an illustration”.'))}</p>` : ''}` : ''}
          <p class="form-error" id="cerr" role="alert"></p>
          <div class="row between"><label class="btn sm light" style="cursor:pointer">${ic.plus} ${esc(tt('Добавить фото', 'Add photos'))}<input type="file" id="cfile" accept="image/jpeg,image/png,image/webp" multiple hidden></label>
            <button class="btn yellow" type="submit" id="csend">${esc(tt('Отправить', 'Send'))}</button></div>
          <p class="small muted" style="margin:0">${esc(tt('JPEG, PNG или WebP, до 6 изображений, каждое до 15 МБ.', 'JPEG, PNG or WebP, up to 6 images, up to 15 MB each.'))}</p></form>`;
    } else {
      let media = [];
      try { ({ media } = await api(`/api/chats/${room}/media${cat ? '?category=' + cat : ''}`)); } catch (e) { body = `<p class="error-box">${esc(errorText(e))}</p>`; }
      if (!body) body = `<div class="chips" role="group" aria-label="${esc(tt('Фильтр', 'Filter'))}">${Object.entries(CAT).map(([k, v]) => `<button class="chip" type="button" data-cat="${k}" aria-pressed="${k === cat}">${esc(tt(...v))}</button>`).join('')}</div>
        ${media.length ? `<div class="media-grid">${media.map((a) => `<button type="button" class="msg-img" data-media="${a.id}"><img src="${esc(u(a.thumb))}" alt="" loading="lazy"></button>`).join('')}</div>` : `<p class="empty">${esc(tt('Здесь пока нет изображений.', 'No images here yet.'))}</p>`}`;
      ctx._media = media;
    }
    ctx.main.innerHTML = `<div class="wrap page narrow stack">
      <div class="crumbs"><a class="small" href="${u('/chats')}">← ${esc(tt('Чаты', 'Chats'))}</a></div>
      <div class="page-head"><h1>${esc(rt(room))}</h1><p class="sub">${esc(tt(...ROOM_NOTE[room]))}${d.members ? ` ${esc(tt('Сейчас в доступе:', 'Currently:'))} ${d.members.map((m) => esc(m.name)).join(', ')}.` : ''}</p></div>
      ${list.rooms.length > 1 ? `<div class="chips">${list.rooms.map((r) => `<a class="chip ${r.room === room ? 'on' : ''}" href="${u('/team/' + r.room)}" ${r.room === room ? 'aria-current="page"' : ''}>${esc(rt(r.room))}</a>`).join('')}</div>` : ''}
      ${tabs}${body}</div>`;
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
    const go = el.querySelector('[data-go]'); if (go) go.onclick = async () => { close(); tab = 'msgs'; await draw(); const t = ctx.main.querySelector('#m-' + msgId); if (t) { t.scrollIntoView({ block: 'center' }); t.classList.add('flash'); } };
    el.querySelector('[data-x]').focus();
  }
  function wire() {
    ctx.main.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; draw(); }));
    ctx.main.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => { cat = b.dataset.cat; draw(); }));
    ctx.main.querySelectorAll('[data-media]').forEach((b) => b.addEventListener('click', () => { const a = ctx._media.find((x) => String(x.id) === b.dataset.media); openImage(u(a.full), a.width, a.height, a.messageId, `<b>${esc(a.author)}</b> · ${esc(fmtDate(a.createdAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}${a.text ? `<br>${esc(a.text.slice(0, 160))}` : ''}`); }));
    const box = ctx.main.querySelector('#msgs');
    if (!box) return;
    box.scrollTop = box.scrollHeight;
    if (focusWork) { const t = [...d.messages].reverse().find((m) => m.workId === focusWork); const el = t && ctx.main.querySelector('#m-' + t.id); if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); } }
    box.addEventListener('click', async (e) => {
      const at = e.target.closest('[data-att]');
      if (at) { const [mid, aid] = at.dataset.att.split(':').map(Number); const m = d.messages.find((x) => x.id === mid); const a = m.attachments.find((x) => x.id === aid); openImage(u(a.full), a.width, a.height, null, `<b>${esc(m.author)}</b> · ${esc(fmtDate(m.createdAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}`); return; }
      const del = e.target.closest('[data-del]');
      if (del) { if (!confirm(tt('Удалить сообщение? Текст и изображения скроются у всех.', 'Delete the message? Its text and images will be hidden for everyone.'))) return; try { await api(`/api/chats/${room}/messages/${del.dataset.del}`, { method: 'DELETE' }); await load(); draw(); } catch (x) { toast(errorText(x)); } }
    });
    const f = ctx.main.querySelector('#cf');
    f.text.addEventListener('input', () => { draft.text = f.text.value; });
    if (f.category) f.category.addEventListener('change', () => { draft.category = f.category.value; draw(); });
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
      for (const x of draft.files) fd.append('images', x.file, x.file.name);
      btn.disabled = true; btn.textContent = draft.files.length ? tt('Загружаем…', 'Uploading…') : tt('Отправляем…', 'Sending…'); err.textContent = '';
      try {
        await api(`/api/chats/${room}`, { method: 'POST', form: fd });
        draft.files.forEach((x) => URL.revokeObjectURL(x.url)); Object.assign(draft, { text: '', files: [], category: '', clientId: '' });
        await load(); draw();
      } catch (x) { btn.disabled = false; btn.textContent = tt('Повторить отправку', 'Retry sending'); err.textContent = `${errorText(x)} ${tt('Текст и фото сохранены.', 'Your text and photos are kept.')}`; }
    });
  }
  draw();
}

export async function print(ctx) {
  if (!session.user) return needLogin(ctx.main, '');
  if (!hasRole('curator', 'artist')) return noRole(ctx.main, tt('куратор или художник', 'curator or artist'));
  loading(ctx.main);
  let d;
  try { d = await api('/api/print'); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  const PERM = { not_set: [tt('Разрешение автора не получено', 'No permission from the artist yet'), ''], allowed: [tt('Автор разрешил печать', 'Artist allows printing'), 'mint'], denied: [tt('Автор не разрешил печать', 'Artist does not allow printing'), 'red'] };
  ctx.main.innerHTML = `<section class="hero"><div class="wrap" style="padding-block:30px;grid-template-columns:1fr"><div>
      <p class="eyebrow">${esc(tt('Печатное направление · будущий этап', 'Print direction · future stage'))}</p><h1>${esc(tt('Печатная колода', 'Printed deck'))}</h1>
      <p class="lead">${esc(tt('Печатная колода — 40 карт. Статистика выборов на встречах помогает отбору. Доступ к файлам для печати планируется только одобренным фасилитаторам и только с разрешения автора каждой карты.', 'The printed deck is 40 cards. Choice statistics from meetings help with selection. Access to print files is planned only for approved facilitators and only with each artist’s permission.'))}</p></div></div></section>
    <div class="wrap page stack">
      <div class="notice"><b>${esc(tt('Статус:', 'Status:'))}</b> ${esc(tt('выдача оригиналов выключена до согласования прав с авторами. Продажи и цена колоды — будущий этап, магазин не подключается.', 'distribution of originals is off until rights are agreed with the artists. Sales and deck price are a future stage; no shop is connected.'))}</div>
      <h2>${esc(tt('Карты по числу выборов на встречах', 'Cards by number of choices at meetings'))}</h2>
      <div class="list">${d.cards.map((c, i) => `<div class="item"><span class="thumb"><img src="${esc(c.thumb)}" alt="" loading="lazy"></span>
        <span class="body"><b>${i + 1}. ${esc(c.code)}</b><span class="small">${esc(c.author || '—')} · ${esc(tt('выбрали', 'chosen'))}: ${c.selections}</span></span>
        <span class="pill ${PERM[c.printPermission][1]}">${esc(PERM[c.printPermission][0])}</span>
        <button class="btn sm" type="button" disabled title="${esc(tt('Выдача файлов выключена', 'File access is off'))}">${esc(tt('Файл для печати', 'Print file'))}</button></div>`).join('')}</div>
    </div>`;
}
