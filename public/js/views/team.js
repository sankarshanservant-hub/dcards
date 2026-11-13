// Командные чаты (кураторы, фасилитаторы) и печатное направление.
import { esc, tt, u, api, errorText, toast, fmtDate } from '../util.js';
import { session, hasRole, needLogin, noRole, loading, failed, ROLE_LABEL } from '../ui.js';

export async function chat(ctx, room) {
  if (!session.user) return needLogin(ctx.main, '');
  const role = room === 'curators' ? 'curator' : 'facilitator';
  if (!hasRole(role)) return noRole(ctx.main, ROLE_LABEL[role]());
  loading(ctx.main);
  let d;
  const load = async () => { d = await api(`/api/chats/${room}`); };
  try { await load(); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  const title = room === 'curators' ? tt('Чат кураторов', 'Curators’ chat') : tt('Чат фасилитаторов', 'Facilitators’ chat');
  const draw = () => {
    ctx.main.innerHTML = `<div class="wrap page narrow stack">
      <p class="eyebrow">${esc(tt('Командный чат', 'Team chat'))}</p><h1>${esc(title)}</h1>
      <div class="notice small"><b>${esc(tt('Кто видит переписку:', 'Who can read this chat:'))}</b> ${esc(room === 'curators' ? tt('кураторы и администраторы проекта', 'curators and project administrators') : tt('фасилитаторы и администраторы проекта', 'facilitators and project administrators'))}.
        ${esc(tt('Сейчас в доступе:', 'Currently:'))} ${d.members.map((m) => esc(m.name)).join(', ')}.</div>
      <div class="chat card-ui flat" id="msgs">${d.messages.map((m) => `<div class="msg ${m.userId === session.user.id ? 'me' : ''}"><div class="meta">${esc(m.author)} · ${esc(fmtDate(m.createdAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</div><p>${esc(m.text)}</p>${m.workId ? `<a class="btn sm yellow" href="${u('/curator/works/' + m.workId)}">${esc(tt(`Открыть работу №${m.workId}`, `Open work #${m.workId}`))} →</a>` : ''}</div>`).join('') || `<p class="muted">${esc(tt('Сообщений пока нет.', 'No messages yet.'))}</p>`}</div>
      <form class="row" id="cf"><textarea name="text" maxlength="4000" required style="flex:1 1 260px;min-height:52px" placeholder="${esc(tt('Сообщение', 'Message'))}"></textarea><button class="btn dark" type="submit">${esc(tt('Отправить', 'Send'))}</button></form>
      <p class="small muted">${esc(tt('Перевод сообщений пока не подключён. Правила модерации уточняются.', 'Message translation is not connected yet. Moderation rules are being agreed.'))}</p></div>`;
    const box = ctx.main.querySelector('#msgs'); box.scrollTop = box.scrollHeight;
    ctx.main.querySelector('#cf').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api(`/api/chats/${room}`, { method: 'POST', body: { text: e.target.text.value } }); await load(); draw(); } catch (x) { toast(errorText(x)); }
    });
  };
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
