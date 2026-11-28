// Администрирование: обзор состояний, роли, заявки фасилитаторов, встречи (снятие), карты и статистика,
// модерация обсуждений, критерии кураторов, журнал писем, демо-данные.
import { esc, tt, u, api, errorText, toast, fmtDate, storage } from '../util.js';
import { openViewer } from '../viewer.js';
import { session, hasRole, needLogin, noRole, loading, failed, ROLE_LABEL, rolesText, demoPill, WORK_STATUS, statusPill, refreshSession } from '../ui.js';
import { langName, whereText } from './meetings.js';

// Разделы кабинета (28.11.2026, согласовано с владельцем): «Требует внимания» — стартовый; затем Карты, Участники, Встречи,
// Общение, Настройки. На компьютере — меню слева, на телефоне — строка разделов и подразделов сверху.
const TABS = [['', 'Требует внимания', 'Needs attention'],
  ['works', 'Работы', 'Works'], ['cards', 'Карты и статистика', 'Cards & statistics'], ['decks', 'Печатные колоды', 'Printed decks'], ['removals', 'Удаления карт', 'Card removals'], ['criteria', 'Критерии', 'Criteria'], ['terms', 'Условия для авторов', 'Author terms'],
  ['users', 'Люди и роли', 'People & roles'], ['applications', 'Заявки на роли', 'Role applications'], ['workshops', 'Онлайн-занятия', 'Online workshops'],
  ['meetings', 'Встречи', 'Meetings'],
  ['messages', 'Сообщения', 'Messages'], ['comments', 'Обсуждения и модерация', 'Discussions & moderation'],
  ['settings', 'Подключения и данные', 'Connections & data'], ['guide', 'Материалы', 'Materials'], ['letters', 'Письма', 'Letters']];
const GROUPS = [
  ['Требует внимания', 'Needs attention', ['']],
  ['Карты', 'Cards', ['works', 'cards', 'decks', 'removals', 'criteria', 'terms']],
  ['Участники', 'People', ['users', 'applications', 'workshops']],
  ['Встречи', 'Meetings', ['meetings']],
  ['Общение', 'Communication', ['messages', 'comments']],
  ['Настройки', 'Settings', ['settings', 'guide', 'letters']],
];
// Счётчики «ждёт решения» у разделов (обновляются при каждом открытии раздела).
const BADGE = { '': (a) => (a.works + a.facApps + a.facManual + a.curApps + a.decks + a.messages + a.workshops), works: (a) => a.works, applications: (a) => a.facApps + a.facManual + a.curApps, decks: (a) => a.decks, messages: (a) => a.messages, workshops: (a) => a.workshops };
const groupOf = (k) => GROUPS.find((g) => g[2].includes(k)) || GROUPS[0];
const tabs = (cur) => {
  const g = groupOf(cur); const lbl = (k) => { const t = TABS.find((x) => x[0] === k); return tt(t[1], t[2]); };
  const href = (k) => u('/admin' + (k ? '/' + k : ''));
  return `<nav class="adm-side" aria-label="${esc(tt('Разделы администрирования', 'Administration sections'))}">
    <div class="adm-groups">${GROUPS.map(([ru, en, keys]) => `<a class="adm-gl ${g[2] === keys ? 'on' : ''}" ${g[2] === keys ? 'aria-current="true"' : ''} href="${href(keys[0])}">${esc(tt(ru, en))}<span class="adm-badge" data-badge-group="${keys.join(',')}" hidden></span></a>
      ${keys.length > 1 ? `<div class="adm-subs ${g[2] === keys ? 'open' : ''}">${keys.map((k) => `<a class="${cur === k ? 'on' : ''}" ${cur === k ? 'aria-current="page"' : ''} href="${href(k)}">${esc(lbl(k))}<span class="adm-badge" data-badge="${k}" hidden></span></a>`).join('')}</div>` : ''}`).join('')}</div></nav>`;
};
async function fillBadges(root) {
  let a; try { a = await api('/api/admin/attention'); } catch { return; }
  root.querySelectorAll('[data-badge]').forEach((b) => { const n = BADGE[b.dataset.badge] ? BADGE[b.dataset.badge](a) : 0; b.hidden = !n; b.textContent = n > 99 ? '99+' : String(n); });
  root.querySelectorAll('[data-badge-group]').forEach((b) => { const keys = b.dataset.badgeGroup.split(','); const n = keys.reduce((s, k) => s + (BADGE[k] && k !== '' ? BADGE[k](a) : 0), 0) || (keys[0] === '' ? BADGE[''](a) : 0); b.hidden = !n; b.textContent = n > 99 ? '99+' : String(n); });
  return a;
}
const guard = (ctx) => {
  if (!session.user) { needLogin(ctx.main, tt('Раздел администратора.', 'Administrator section.')); return false; }
  if (!hasRole('admin') || !session.user.roles.includes('admin')) { noRole(ctx.main, ROLE_LABEL.admin()); return false; }
  return true;
};
const shell = (ctx, cur, title, inner) => {
  ctx.main.innerHTML = `<div class="wrap page adm-page"><p class="eyebrow">${esc(tt('Кабинет администратора', 'Admin space'))}</p>
    <div class="adm-layout">${tabs(cur)}<div class="adm-main"><h1>${esc(title)}</h1><div id="sec">${inner}</div></div></div></div>`;
  fillBadges(ctx.main);
  return ctx.main.querySelector('#sec');
};

// «Требует внимания»: только то, что ждёт решения, со счётчиками; пустые группы не показываются.
export async function overview(ctx) {
  if (!guard(ctx)) return;
  loading(ctx.main);
  let a;
  try { a = await api('/api/admin/attention'); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  const items = [
    [a.works, '/admin/works', 'Работы к публикации', 'Works to publish', 'Кураторы рекомендовали — ждут вашего решения', 'Recommended by curators — awaiting your decision'],
    [a.messages, '/admin/messages', 'Новые сообщения', 'New messages', 'Переписки с непрочитанными сообщениями участников', 'Conversations with unread messages from members'],
    [a.facApps, '/admin/applications?type=fac', 'Заявки фасилитаторов', 'Facilitator applications', 'Курс и проверка пройдены', 'Course and quiz completed'],
    [a.facManual, '/admin/applications?type=fac-manual', 'Заявки на ручной проверке ответов', 'Applications for manual review', 'Ответы проверки — на ваше решение', 'Quiz answers — for your decision'],
    [a.curApps, '/admin/applications?type=cur', 'Заявки кураторов', 'Curator applications', '', ''],
    [a.workshops, '/admin/workshops', 'Заявки на онлайн-занятия', 'Online workshop requests', 'Новые, ещё не просмотренные', 'New, not yet reviewed'],
    [a.decks, '/admin/decks', 'Заявки на печатные колоды', 'Printed deck requests', 'Новые предварительные заявки', 'New preliminary requests'],
  ].filter((x) => x[0] > 0);
  shell(ctx, '', tt('Требует внимания', 'Needs attention'), items.length
    ? `<div class="list adm-rows">${items.map(([n, href, ru, en, hru, hen]) => `<a class="item" href="${u(href)}"><span class="adm-count">${n}</span><span class="body"><b>${esc(tt(ru, en))}</b>${hru ? `<span class="small muted">${esc(tt(hru, hen))}</span>` : ''}</span><span aria-hidden="true">→</span></a>`).join('')}</div>`
    : `<div class="card-ui flat"><b>${esc(tt('Всё разобрано', 'All done'))}</b><p class="small muted" style="margin:4px 0 0">${esc(tt('Новых работ, заявок и сообщений нет.', 'No new works, applications or messages.'))}</p></div>`);
}

async function settingsSection(ctx) {
  let o;
  try { o = await api('/api/admin/overview'); } catch (e) { throw e; }
  if (!ctx.alive()) return;
  const k = (n, ru, en, href) => (href ? `<a class="kpi" href="${u(href)}"><b>${n ?? 0}</b><span>${esc(tt(ru, en))}</span></a>` : `<div class="kpi"><b>${n ?? 0}</b><span>${esc(tt(ru, en))}</span></div>`);
  const sec = shell(ctx, 'settings', tt('Подключения и данные', 'Connections & data'), `
    <p class="small muted" style="margin:0 0 8px">${esc(o.demoScope === false ? tt('Без демо-данных — так же, как в списках разделов.', 'Without demo data — the same as the section lists.') : o.demoScope === 'only' ? tt('Только демо-данные (демо-роль).', 'Demo data only (demo role).') : tt('Включая демо-данные — так же, как в списках разделов.', 'Including demo data — the same as the section lists.'))}</p>
    <div class="kpis">${k(o.cards.published, 'карт в галерее', 'cards in the gallery', '/library')}${k(o.cards.removed, 'карт снято с публикации', 'cards taken down', '/admin/cards')}
      ${k(o.worksCurators, 'работ у кураторов', 'works with curators', '/curator')}${k(o.worksToPublish, 'работ ждут публикации', 'works awaiting publication', '/admin/works')}${k(o.works.needs_changes, 'возвращено на доработку', 'returned for changes')}
      ${k(o.meetings.published, 'встреч опубликовано', 'meetings published', '/admin/meetings')}${k(o.meetings.removed, 'встреч снято администратором', 'meetings taken down by an admin', '/admin/meetings')}
      ${k(o.registrations, 'активных записей на встречи', 'active meeting sign-ups')}${k(o.pendingApplications, 'заявок на роли ждут решения', 'role applications awaiting a decision', '/admin/applications')}
      ${k(o.users, 'пользователей', 'users', '/admin/users')}${k(o.comments, 'сообщений в обсуждениях карт', 'card discussion messages', '/admin/comments')}</div>
    <div class="cols-2" style="margin-top:16px">
      <div class="card-ui flat stack"><h3>${esc(tt('Подключения', 'Connections'))}</h3>
        <p style="margin:0">${esc(tt('Почта:', 'Email:'))} <b class="${o.mailConnected ? 'ok' : 'warn'}">${esc(o.mailConnected ? tt('подключена (SMTP)', 'connected (SMTP)') : tt('не подключена — письма показываются на экране (демо)', 'not connected — letters are shown on screen (demo)'))}</b></p>
        <p style="margin:0">${esc(tt('Перевод сообщений:', 'Message translation:'))} <b class="warn">${esc(tt('не подключён — ссылка на внешний переводчик', 'not connected — link to an external translator'))}</b></p>
        <p style="margin:0">${esc(tt('Оплата:', 'Payments:'))} <b>${esc(tt('не принимается на сайте', 'not taken on the site'))}</b></p></div>
      ${o.demoMode ? `<div class="card-ui flat stack"><h3>${esc(tt('Демо-данные', 'Demo data'))}</h3>
        <p class="small muted" style="margin:0">${esc(tt('Демо-работы, встречи, подборка, сообщения и заявка. Помечены «демо», видны только в демо-режиме и не смешиваются с реальной статистикой.', 'Demo works, meetings, a selection, messages and an application. Labelled “demo”, visible only in demo mode and kept apart from real statistics.'))}</p>
        <div class="row"><button class="btn dark sm" type="button" id="seed">${esc(tt('Заполнить демо-данными', 'Fill with demo data'))}</button><button class="btn sm danger" type="button" id="clear">${esc(tt('Удалить демо-данные', 'Delete demo data'))}</button></div></div>` : ''}
    </div>`);
  // обмены: этапы со знаменателями (без имён и текстов); ориентиры — гипотезы для проверки
  api('/api/admin/exchange-stats?days=30').then((x) => {
    // Знаменатель — рядом с каждым процентом (аудит 28.11, п.41). События — x_events обмена: sent (поделились или
    // скопировали ссылку), opened (открыл не автор), answered (друг ответил); считаются обмены, созданные за период.
    const p = x.personal;
    const pct = (a, b) => (b ? ` (${Math.round((a / b) * 100)}%)` : '');
    const of = (v, d, ru, en) => (d ? tt(`${v} из ${d} ${ru}`, `${v} of ${d} ${en}`) + pct(v, d) : tt(`${v} из 0 ${ru} — процент не считается`, `${v} of 0 ${en} — no percentage`));
    const row = (t0, v) => `<tr><td>${esc(t0)}</td><td><b>${esc(String(v))}</b></td></tr>`;
    sec.insertAdjacentHTML('beforeend', `<div class="card-ui flat stack" style="margin-top:16px"><h3 style="margin:0">${esc(tt('Обмены за 30 дней', 'Exchanges, last 30 days'))}</h3>
      <table class="small"><tbody>${row(tt('Создано приглашений', 'Invitations created'), p.all.created)}
      ${row(tt('Поделились или скопировали ссылку', 'Shared or copied the link'), of(p.all.sent, p.all.created, 'созданных', 'created'))}
      ${row(tt('Открыли', 'Opened'), of(p.all.opened, p.all.sent, 'отправленных приглашений', 'sent invitations'))}
      ${row(tt('Ответили', 'Answered'), of(p.all.answered, p.all.opened, 'открытых', 'opened'))}
      ${row(tt('Ответивших (уникальных людей)', 'Responders (unique people)'), x.responders)}
      ${row(tt('…из них отправили свою карту', '…of them sent their own card'), of(x.onwardAny, x.responders, 'ответивших', 'responders'))}
      ${row(tt('— ответной картой в том же разговоре', '— a reply card in the same conversation'), of(x.onwardReply, x.responders, 'ответивших', 'responders'))}
      ${row(tt('— новым людям (отдельный обмен)', '— to new people (separate exchange)'), of(x.onwardNew, x.responders, 'ответивших', 'responders'))}</tbody></table>
      <p class="small muted" style="margin:0">${esc(tt('Считаются приглашения, созданные за 30 дней. «Открыли» — открыл человек по ссылке (не автор приглашения).', 'Counts invitations created in the last 30 days. “Opened” means a person other than the sender opened the link.'))}</p>
      <p class="small muted" style="margin:0">${esc(tt('Ориентиры «ответили больше половины», «каждый третий отправил свою» — гипотезы. Гость на разных устройствах считается разными людьми; новый обмен не доказывает нового человека. Групповые ссылки будут считаться отдельно.', 'Targets “over half answered”, “one in three sent their own” are hypotheses. A guest on different devices counts as different people; a new exchange does not prove a new person. Group links will be counted separately.'))}</p></div>`);
  }).catch(() => {});
  const sd = sec.querySelector('#seed');
  if (sd) {
    sd.addEventListener('click', async () => { sd.disabled = true; try { const r = await api('/api/admin/demo/seed', { method: 'POST' }); toast(r.already ? tt('Демо-данные уже есть', 'Demo data already exists') : tt('Демо-данные добавлены', 'Demo data added')); ctx.rerender(); } catch (x) { toast(errorText(x)); sd.disabled = false; } });
    sec.querySelector('#clear').addEventListener('click', async () => { try { await api('/api/admin/demo/clear', { method: 'POST' }); toast(tt('Демо-данные удалены', 'Demo data deleted')); ctx.rerender(); } catch (x) { toast(errorText(x)); } });
  }
}


export async function section(ctx, name, arg) {
  if (!guard(ctx)) return;
  loading(ctx.main);
  try { await SECTIONS[name](ctx, arg); } catch (e) { if (ctx.alive()) failed(ctx.main, e, ctx.rerender); }
}

const ACTION_LABEL = { recommend: () => tt('Рекомендована кураторами', 'Recommended by curators'), approve: () => tt('Опубликована', 'Published'), return: () => tt('Возвращена на доработку', 'Returned for changes'), reject: () => tt('Отклонена', 'Declined') };
const SECTIONS = {
  settings: settingsSection,
  // Личные переписки участников с администрацией: список и переписка с одним человеком (/admin/messages/<id>)
  async messages(ctx, uid) {
    const msgs = await import('./messages.js');
    const sec = shell(ctx, 'messages', tt('Сообщения', 'Messages'), `<p class="muted">${esc(tt('Загрузка…', 'Loading…'))}</p>`);
    if (uid) await msgs.adminThread(ctx, sec, uid); else await msgs.adminList(ctx, sec);
    fillBadges(ctx.main);
  },
  // Предварительные заявки на онлайн-занятия: число уникальных, новых; статусы «Новая» / «Просмотрена»
  async workshops(ctx) {
    const d = await api('/api/admin/workshops'); if (!ctx.alive()) return;
    const ST = { new: tt('Новая', 'New'), seen: tt('Просмотрена', 'Reviewed') };
    const sec = shell(ctx, 'workshops', tt('Заявки на онлайн-занятия', 'Online workshop requests'), `
      <p class="muted" style="margin-top:0">${esc(tt(`Заявок: ${d.total} · новых: ${d.fresh}`, `Requests: ${d.total} · new: ${d.fresh}`))}</p>
      <p class="small muted">${esc(tt('Предварительные заявки: дат и программы ещё нет. Рассылки заявителям нет — о расписании сообщите сами по указанному контакту.', 'Preliminary requests: no dates or programme yet. Nothing is sent to applicants automatically — contact them yourself when the schedule is ready.'))}</p>
      ${d.requests.length ? `<div class="list adm-rows">${d.requests.map((r) => `<div class="item ${r.status === 'new' ? 'unread' : ''}" style="align-items:flex-start"><span class="body">
        <b>${esc(r.name)} ${demoPill(r.isDemo)} <span class="pill ${r.status === 'new' ? 'yellow' : ''}">${esc(ST[r.status])}</span></b>
        <span class="small">${esc(fmtDate(r.createdAt, { day: 'numeric', month: 'short', year: 'numeric' }))} · ${r.contactKind === 'email' ? `<a href="mailto:${esc(r.contact)}">${esc(r.contact)}</a>` : `<a href="https://t.me/${esc(r.contact.slice(1))}" target="_blank" rel="noopener">${esc(r.contact)}</a>`}
          ${r.userId ? ` · <a href="${u('/admin/messages/' + r.userId)}">${esc(tt('аккаунт', 'account'))}: ${esc(r.account || '')}</a>` : ` · ${esc(tt('без аккаунта', 'no account'))}`}</span>
        ${r.interest ? `<p class="small" style="margin:4px 0 0;white-space:pre-wrap">${esc(r.interest)}</p>` : ''}</span>
        <button class="btn light sm" type="button" data-ws="${r.id}" data-to="${r.status === 'new' ? 'seen' : 'new'}">${esc(r.status === 'new' ? tt('Просмотрена', 'Mark reviewed') : tt('Вернуть в новые', 'Mark as new'))}</button></div>`).join('')}</div>`
      : `<p class="empty">${esc(tt('Заявок пока нет.', 'No requests yet.'))}</p>`}`);
    sec.addEventListener('click', async (e) => { const b = e.target.closest('[data-ws]'); if (!b) return; b.disabled = true;
      try { await api(`/api/admin/workshops/${b.dataset.ws}/status`, { method: 'POST', body: { status: b.dataset.to } }); ctx.rerender(); } catch (x) { b.disabled = false; toast(errorText(x)); } });
  },
  // Предварительные заявки фасилитаторов на печатные колоды: сколько, куда; связь — в приложении
  async decks(ctx) {
    const { requests } = await api('/api/admin/print-requests'); if (!ctx.alive()) return;
    const total = requests.reduce((n, r) => n + (Number(r.count) || 0), 0);
    const sec = shell(ctx, 'decks', tt('Заявки на печатные колоды', 'Printed deck requests'), `
      <p class="muted" style="margin-top:0">${esc(tt(`Заявок: ${requests.length}${total ? ` · колод всего: ${total}` : ''}`, `Requests: ${requests.length}${total ? ` · decks in total: ${total}` : ''}`))}</p>
      <p class="small muted">${esc(tt('Предварительные заявки: печатных колод пока нет, сроки не определены. Ответить заявителю — через «Сообщения».', 'Preliminary requests: there are no printed decks yet and no dates. Reply to an applicant via “Messages”.'))}</p>
      ${requests.length ? `<div class="list adm-rows">${requests.map((r) => `<div class="item ${r.status === 'new' ? 'unread' : ''}" style="align-items:flex-start"><span class="body">
        <b>${esc(r.name)} ${demoPill(r.isDemo)}${r.count ? ` · ${esc(tt(`колод: ${r.count}`, `decks: ${r.count}`))}` : ''}</b>
        <span class="small">${esc([r.country, r.city].filter(Boolean).join(', ') || '—')} · ${esc(fmtDate(r.createdAt, { day: 'numeric', month: 'short', year: 'numeric' }))} · ${esc(r.status === 'new' ? tt('новая', 'new') : tt('обработана', 'done'))}</span>
        ${r.comment || r.note ? `<p class="small" style="margin:4px 0 0;white-space:pre-wrap">${esc(r.comment || r.note)}</p>` : ''}
        <div class="row" style="margin-top:6px">${r.userId || r.user_id ? `<a class="btn light sm" href="${u('/admin/messages/' + (r.userId || r.user_id))}">${esc(tt('Написать', 'Message'))}</a>` : ''}
          ${r.status === 'new' ? `<button class="btn light sm" type="button" data-pdone="${r.id}">${esc(tt('Отметить обработанной', 'Mark as done'))}</button>` : ''}</div></span></div>`).join('')}</div>`
      : `<p class="empty">${esc(tt('Заявок пока нет.', 'No requests yet.'))}</p>`}`);
    sec.addEventListener('click', async (e) => { const pd = e.target.closest('[data-pdone]'); if (!pd) return;
      try { await api(`/api/admin/print-requests/${pd.dataset.pdone}/done`, { method: 'POST' }); ctx.rerender(); } catch (x) { toast(errorText(x)); } });
  },
  // Условия для авторов (25.11.2026): черновик → предпросмотр → публикация по явному решению администрации
  async terms(ctx) {
    const d = await api('/api/admin/terms'); if (!ctx.alive()) return;
    const ru = d.drafts.find((x) => x.lang === 'ru'); const en = d.drafts.find((x) => x.lang === 'en');
    const n = (e) => (d.stats.find((x) => x.lang === e.lang && x.version === e.version) || {}).n || 0;
    const row = (e, label) => `<div class="item"><span class="body"><b>${esc(label)} · ${esc(tt('редакция', 'version'))} ${esc(e.version)}</b>
      <span class="small">${e.status === 'published' ? esc(tt(`опубликована ${fmtDate(e.publishedAt, { day: 'numeric', month: 'long', year: 'numeric' })} · согласий: ${n(e)}`, `published ${fmtDate(e.publishedAt, { day: 'numeric', month: 'long', year: 'numeric' })} · consents: ${n(e)}`)) : esc(tt('черновик — не показывается авторам', 'draft — not shown to authors'))}</span>
      <span class="row" style="gap:10px"><a class="small" href="${u('/terms/authors/' + e.id)}">${esc(tt('Читать текст', 'Read the text'))}</a>
        ${e.status !== 'published' ? `<button class="btn sm ${e.lang === 'ru' ? 'yellow' : 'light'}" type="button" data-pub="${e.lang}">${esc(tt('Опубликовать и включить', 'Publish and enable'))}</button>` : ''}</span></span></div>`;
    const sec = shell(ctx, 'terms', tt('Условия для авторов', 'Author terms'), `<div class="stack">
      <p class="small muted" style="margin:0">${esc(d.active ? tt('Новая редакция включена: авторы принимают её на первом шаге подачи работы.', 'The new version is enabled: authors accept it at the first step of submission.') : tt('Сейчас действуют прежние условия. Новая редакция включится только после вашей публикации.', 'The previous terms apply now. The new version is enabled only after you publish it.'))}</p>
      <div class="row"><a class="btn light sm" href="${u('/artist/submit?terms=preview')}">${esc(tt('Предпросмотр первого шага', 'Preview the first step'))}</a></div>
      <div class="list">${row(ru, 'Русский')}${row(en, 'English')}</div>
      <p class="small muted" style="margin:0">${esc(tt('Английский перевод — для проверки. Пока он не опубликован, автор с английским интерфейсом видит русский оригинал с пометкой.', 'The English translation is for review. Until it is published, an author with the English interface sees the Russian original with a note.'))}</p>
      <div id="ask"></div></div>`);
    sec.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-pub]'); if (!b) return;
      const ask = sec.querySelector('#ask');
      ask.innerHTML = `<div class="notice stack"><b>${esc(b.dataset.pub === 'ru' ? tt('Опубликовать русскую редакцию 1.0?', 'Publish Russian version 1.0?') : tt('Опубликовать английский перевод?', 'Publish the English translation?'))}</b>
        <span class="small">${esc(tt('С этого момента новые работы принимаются только с согласием по этой редакции. В текст подставится сегодняшняя дата, после публикации текст не меняется. Прежние согласия сохраняются.', 'From now on new works are accepted only with consent to this version. Today’s date is added to the text; it does not change after publishing. Earlier consents are kept.'))}</span>
        <div class="row"><button class="btn yellow sm" type="button" id="pubyes">${esc(tt('Опубликовать', 'Publish'))}</button><button class="linkbtn" type="button" id="pubno">${esc(tt('Отмена', 'Cancel'))}</button></div></div>`;
      ask.querySelector('#pubno').onclick = () => { ask.innerHTML = ''; };
      ask.querySelector('#pubyes').onclick = async () => { try { await api('/api/admin/terms/publish', { method: 'POST', body: { lang: b.dataset.pub, confirm: true } }); await refreshSession(); ctx.rerender(); } catch (x) { toast(errorText(x)); } };
    });
  },
  // Удаления карт: письма фасилитаторам и внешние материалы (соцсети, презентации, реклама) — срок 30 дней
  async removals(ctx) {
    const d = await api('/api/admin/removals'); if (!ctx.alive()) return;
    const ITEM = { site: tt('Файлы на сайте', 'Files on the site'), social: tt('Публикации в соцсетях', 'Social media posts'), presentations: tt('Презентации', 'Presentations'), ads: tt('Реклама', 'Advertising') };
    const MAIL = { sent: tt('отправлено', 'sent'), queued: tt('в очереди', 'queued'), failed: tt('ошибка, повтор', 'failed, retrying'), not_connected: tt('почта не подключена', 'mail not connected') };
    const sec = shell(ctx, 'removals', tt('Удаления карт', 'Card removals'), `<div class="stack">
      ${d.mailConnected ? '' : `<p class="notice small">${esc(tt('Почта на сервере не подключена: письма фасилитаторам ждут в очереди и уйдут после подключения. Уведомления в приложении доставлены.', 'Mail is not connected on the server: emails to facilitators wait in the queue and go out once it is connected. In-app notices are delivered.'))}</p>`}
      ${d.removals.length ? d.removals.map((r) => `<div class="card-ui flat stack" style="gap:6px"><b>${esc(r.code)}${r.version ? ' · ' + esc(r.version) : ''} · ${esc(r.kind === 'removed' ? tt('удалена', 'removed') : tt('версия отозвана', 'version withdrawn'))} · ${esc(fmtDate(r.at, { day: 'numeric', month: 'long' }))}</b>
        <span class="small muted">${esc(tt('Письма фасилитаторам', 'Emails to facilitators'))}: ${Object.entries(r.mail).map(([k, v]) => `${esc(MAIL[k] || k)} — ${v}`).join(', ') || '—'}</span>
        <ul class="rm-tasks">${r.tasks.map((t) => `<li><label class="check"><input type="checkbox" data-task="${t.id}" ${t.status !== 'open' ? 'checked' : ''} ${t.item === 'site' ? 'disabled' : ''}> <span>${esc(ITEM[t.item])}${t.status === 'open' ? ` · <span class="muted">${esc(tt('до', 'by'))} ${esc(fmtDate(t.dueAt, { day: 'numeric', month: 'long' }))}</span>` : ''}</span></label></li>`).join('')}</ul></div>`).join('') : `<p class="empty">${esc(tt('Удалений не было.', 'No removals yet.'))}</p>`}
      ${d.mailConnected ? `<button class="btn light sm" type="button" id="retry">${esc(tt('Повторить отправку писем', 'Retry sending emails'))}</button>` : ''}</div>`);
    sec.addEventListener('change', async (e) => { const t = e.target.closest('[data-task]'); if (!t) return; try { await api(`/api/admin/removal-tasks/${t.dataset.task}`, { method: 'POST', body: { status: t.checked ? 'done' : 'open' } }); toast(tt('Отмечено', 'Saved')); } catch (x) { toast(errorText(x)); } });
    const rt = sec.querySelector('#retry'); if (rt) rt.onclick = async () => { await api('/api/admin/removals/retry-mail', { method: 'POST' }); ctx.rerender(); };
  },
  // Работы: «Одобрено кураторами» — только рекомендации, окончательное решение здесь; ниже — все решения (автор, дата, причины).
  async works(ctx) {
    const d = await api('/api/admin/works');
    if (!ctx.alive()) return;
    const when = (x) => fmtDate(x, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const sec = shell(ctx, 'works', tt('Работы', 'Works'), `
      <h2 style="margin:0">${esc(tt('Одобрено кураторами', 'Approved by curators'))} · ${d.recommended.length}</h2>
      <p class="small muted" style="margin:4px 0 12px">${esc(tt('Кураторы рекомендовали эти работы к публикации. В галерее работа (или новая версия карты) появится только после вашего решения, тогда же автор получит уведомление.', 'Curators recommended these works for publication. A work (or a new card version) appears in the gallery only after your decision; the author is notified then.'))}</p>
      ${d.recommended.length ? `<div class="list">${d.recommended.map((w) => `<div class="work" data-w="${w.id}">
        <div class="thumb">${w.version ? `<img src="${esc(w.version.thumb)}" alt="" loading="lazy">` : ''}</div>
        <div class="body stack" style="gap:6px"><div class="row" style="gap:6px">${demoPill(w.isDemo)}${w.kind === 'replacement' ? `<span class="pill">${esc(tt('Новая версия', 'New version'))} ${esc(w.targetCard.code)} · ${esc(w.recommendedType === 'fix' ? tt('исправление той же карты', 'fix of the same card') : tt('новая карта', 'new card'))}</span>` : ''}</div>
          <b>${esc(tt('Работа', 'Work'))} №${w.id} · ${esc(w.artist)}</b>
          <span class="small muted">${esc(tt('рекомендовал(а)', 'recommended by'))} ${esc(w.recommendedBy || '—')} · ${esc(when(w.recommendedAt))}</span>
          <div class="row"><button class="btn yellow sm" type="button" data-publish="${w.id}">${esc(tt('Опубликовать', 'Publish'))}</button>
            <a class="btn light sm" href="${u('/curator/works/' + w.id)}">${esc(tt('Открыть работу и обсуждение', 'Open the work and discussion'))}</a></div></div></div>`).join('')}</div>`
        : `<p class="empty">${esc(tt('Рекомендаций, ждущих решения, нет.', 'No recommendations are waiting.'))}</p>`}
      <h2 style="margin:26px 0 0">${esc(tt('Решения по работам', 'Decisions on works'))}</h2>
      <p class="small muted" style="margin:4px 0 12px">${esc(tt('Рекомендации, публикации, возвраты и отклонения — последние 100. Возвраты и отклонения кураторы делают сами, подтверждать их не нужно.', 'Recommendations, publications, returns and declines — the last 100. Curators return and decline on their own; no confirmation is needed.'))}</p>
      ${d.decisions.length ? `<div class="list">${d.decisions.map((x) => `<a class="work" href="${u('/curator/works/' + x.workId)}" style="text-decoration:none;color:inherit">
        <div class="thumb">${x.thumb ? `<img src="${esc(x.thumb)}" alt="" loading="lazy">` : ''}</div>
        <div class="body"><div class="row" style="gap:6px"><span class="pill ${x.action === 'approve' ? 'mint' : x.action === 'recommend' ? 'yellow' : 'red'}">${esc((ACTION_LABEL[x.action] || (() => x.action))())}</span>${demoPill(x.isDemo)}</div>
          <b>${esc(tt('Работа', 'Work'))} №${x.workId} · ${esc(x.artist)}</b>
          <span class="small muted">${esc(x.actor)} · ${esc(when(x.createdAt))} · ${esc(tt('версия', 'version'))} ${x.versionN}</span>
          ${x.criteria.length ? `<ul class="reasons small">${x.criteria.map((c) => `<li><b>${c.number}.</b> ${esc(c.text)}</li>`).join('')}</ul>` : ''}
          ${x.comment ? `<span class="small">${esc(x.comment)}</span>` : ''}</div></a>`).join('')}</div>` : `<p class="empty">${esc(tt('Решений пока нет.', 'No decisions yet.'))}</p>`}`);
    sec.querySelectorAll('[data-publish]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try { const r = await api(`/api/admin/works/${b.dataset.publish}/decide`, { method: 'POST', body: { action: 'publish' } }); toast(tt(`Опубликовано: ${r.cardCode}`, `Published: ${r.cardCode}`)); ctx.rerender(); }
      catch (x) { b.disabled = false; toast(errorText(x)); }
    }));
  },
  async users(ctx) {
    const { users } = await api('/api/admin/users');
    if (!ctx.alive()) return;
    const sec = shell(ctx, 'users', tt('Люди и роли', 'People & roles'), `<p class="small muted">${esc(tt('Нажатие на роль выдаёт или снимает её после подтверждения. Изменение действует сразу: доступ к кабинету появится или пропадёт при следующем открытии страницы этим человеком. У одного человека может быть несколько ролей.', 'Tapping a role grants or removes it after confirmation. The change applies immediately: the person gains or loses the space the next time they open a page. One person may hold several roles.'))}</p>
      <div class="list">${users.map((x) => `<div class="item" style="align-items:flex-start"><span class="body"><b>${esc(x.publicName)}${x.publicName !== x.name ? ` <span class="small muted">(${esc(x.name)})</span>` : ''} ${demoPill(x.isDemo)}</b>
        <span class="small">${esc(x.email || tt('без email', 'no email'))} · ${esc(rolesText(x.roles))}</span>
        <div class="chips" style="margin-top:6px">${['artist', 'curator', 'facilitator', 'admin'].map((r) => `<button class="chip ${x.roles.includes(r) ? 'on' : ''}" type="button" data-u="${x.id}" data-r="${r}" data-g="${x.roles.includes(r) ? 0 : 1}">${esc(ROLE_LABEL[r]())}</button>`).join('')}</div>
        ${x.cardCount && !x.isDemo ? `<form class="row" data-transfer="${x.id}" style="margin-top:6px"><span class="small">${esc(tt(`Автор карт: ${x.cardCount}. Передать карты аккаунту:`, `Author of ${x.cardCount} cards. Transfer them to:`))}</span>
          <select name="to" style="max-width:240px" aria-label="${esc(tt('Кому передать карты', 'Who receives the cards'))}"><option value="">${esc(tt('Выберите автора', 'Choose an author'))}</option>${users.filter((y) => y.id !== x.id && !y.isDemo).map((y) => `<option value="${y.id}">${esc(y.publicName)}${y.email ? ' · ' + esc(y.email) : ''}</option>`).join('')}</select><button class="btn sm" type="submit">${esc(tt('Передать карты выбранному автору', 'Transfer the cards to the selected author'))}</button></form>` : ''}
        ${!x.email ? `<form class="row" data-email="${x.id}" style="margin-top:6px"><input type="email" name="email" placeholder="${esc(tt('Указать email для входа', 'Set an email for sign-in'))}" style="max-width:280px"><button class="btn sm" type="submit">${esc(tt('Сохранить email', 'Save email'))}</button></form>` : ''}</span></div>`).join('')}</div>`);
    sec.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-r]'); if (!b) return;
      const who = (users.find((y) => String(y.id) === b.dataset.u) || {}).publicName || '';
      const rl = ROLE_LABEL[b.dataset.r]();
      if (!confirm(b.dataset.g === '1' ? tt(`Выдать роль «${rl}» — ${who}? Доступ появится сразу.`, `Grant the “${rl}” role to ${who}? Access starts immediately.`) : tt(`Снять роль «${rl}» — ${who}? Доступ пропадёт сразу.`, `Remove the “${rl}” role from ${who}? Access ends immediately.`))) return;
      try { await api(`/api/admin/users/${b.dataset.u}/roles`, { method: 'POST', body: { role: b.dataset.r, grant: b.dataset.g === '1' } }); toast(tt('Роли обновлены', 'Roles updated')); ctx.rerender(); } catch (x) { toast(errorText(x)); }
    });
    sec.querySelectorAll('[data-transfer]').forEach((f) => f.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!f.to.value) { toast(tt('Выберите автора, которому передать карты', 'Choose the author to receive the cards')); return; }
      const from = users.find((y) => String(y.id) === f.dataset.transfer) || {}; const to = users.find((y) => String(y.id) === f.to.value) || {};
      if (!confirm(tt(`Передать карты автора «${from.publicName}» (${from.cardCount}) аккаунту «${to.publicName}»${to.email ? ` (${to.email})` : ''}?`, `Transfer ${from.cardCount} card(s) by “${from.publicName}” to the account “${to.publicName}”${to.email ? ` (${to.email})` : ''}?`))) return;
      try { const r = await api(`/api/admin/users/${f.dataset.transfer}/transfer-cards`, { method: 'POST', body: { to: Number(f.to.value) } }); toast(tt(`Карт передано: ${r.moved}`, `Cards transferred: ${r.moved}`)); ctx.rerender(); } catch (x) { toast(errorText(x)); }
    }));
    sec.querySelectorAll('[data-email]').forEach((f) => f.addEventListener('submit', async (e) => {
      e.preventDefault(); try { await api(`/api/admin/users/${f.dataset.email}`, { method: 'PATCH', body: { email: f.email.value } }); toast(tt('Email сохранён', 'Email saved')); ctx.rerender(); } catch (x) { toast(errorText(x)); }
    }));
  },

  async applications(ctx) {
    let [{ applications }, { applications: curApps }] = await Promise.all([api('/api/admin/applications'), api('/api/admin/curator-applications')]);
    if (!ctx.alive()) return;
    // фильтр по типу заявки (аудит 28.11, п.39): из «Требует внимания» приходят ?type=fac | fac-manual | cur
    const type = ['fac', 'fac-manual', 'cur'].includes(ctx.query.get('type')) ? ctx.query.get('type') : '';
    // счётчики совпадают с «Требует внимания»: ждут решения; «Все» — вся история заявок
    const nF = applications.filter((x) => x.status === 'submitted' && !x.manualReview).length; const nM = applications.filter((x) => x.status === 'submitted' && x.manualReview).length;
    const nC = curApps.filter((x) => x.status === 'submitted').length;
    if (type === 'fac-manual') applications = applications.filter((x) => x.manualReview && x.status === 'submitted');
    if (type === 'fac') applications = applications.filter((x) => !x.manualReview && x.status === 'submitted');
    if (type === 'cur') curApps = curApps.filter((x) => x.status === 'submitted');
    const showCur = !type || type === 'cur'; const showFac = !type || type !== 'cur';
    const chip = (k, ru, en, n) => `<a class="chip ${type === k ? 'on' : ''}" ${type === k ? 'aria-current="true"' : ''} href="${u('/admin/applications' + (k ? '?type=' + k : ''))}">${esc(tt(ru, en))}${n != null ? ` · ${n}` : ''}</a>`;

    const filters = `<nav class="chips" aria-label="${esc(tt('Тип заявок', 'Application type'))}" style="margin-bottom:12px">${chip('', 'Все', 'All')}${chip('fac', 'Фасилитаторы', 'Facilitators', nF)}${chip('fac-manual', 'Ручная проверка ответов', 'Manual review', nM)}${chip('cur', 'Кураторы', 'Curators', nC)}</nav>
      <p class="small muted" style="margin:0 0 10px">${esc(tt('Фильтры показывают заявки, ждущие решения; «Все» — всю историю.', 'Filters show applications awaiting a decision; “All” shows the full history.'))}</p>`;
    const ST = { in_progress: tt('проходит курс', 'taking the course'), submitted: tt('ждёт решения', 'awaiting decision'), approved: tt('одобрена', 'approved'), rejected: tt('не одобрена', 'not approved') };
    const decide = (kind, a, grant) => `${a.status === 'submitted' ? `<div class="row" style="margin-top:8px"><input type="text" placeholder="${esc(tt('Комментарий (по желанию)', 'Note (optional)'))}" data-note="${kind}${a.userId}" style="max-width:280px">
          <button class="btn dark sm" type="button" data-ok="${kind}${a.userId}">${esc(grant)}</button><button class="btn sm danger" type="button" data-no="${kind}${a.userId}">${esc(tt('Отклонить', 'Decline'))}</button></div>` : ''}`;
    const sec = shell(ctx, 'applications', tt('Заявки на роли', 'Role applications'), `${filters}
      ${showCur ? `<h3>${esc(tt('Заявки на роль куратора', 'Curator applications'))}</h3>
      ${curApps.length ? `<div class="list">${curApps.map((a) => `<div class="item" style="align-items:flex-start"><span class="body">
        <b>${esc(a.name)} ${demoPill(a.isDemo)}</b><span class="small">${esc(ST[a.status])} · ${esc(a.contact)}${a.accountName !== a.name ? ' · ' + esc(tt('аккаунт', 'account')) + ': ' + esc(a.accountName) : ''}</span>
        <p class="small" style="margin:4px 0 0;white-space:pre-wrap">${esc(a.motivation)}</p>
        ${decide('c', a, tt('Одобрить и выдать роль куратора', 'Approve and grant the curator role'))}</span></div>`).join('')}</div>` : `<p class="empty">${esc(tt('Заявок на роль куратора нет.', 'No curator applications.'))}</p>`}
      ` : ''}${showFac ? `<h3 style="margin-top:${showCur ? 22 : 0}px">${esc(tt(type === 'fac-manual' ? 'Заявки фасилитаторов на ручной проверке ответов' : 'Заявки на роль фасилитатора', type === 'fac-manual' ? 'Facilitator applications for manual review' : 'Facilitator applications'))}</h3>
      ${applications.length ? `<div class="list">${applications.map((a) => `<div class="item" style="align-items:flex-start"><span class="body">
        <b>${esc(a.name)} ${demoPill(a.isDemo)}</b><span class="small">${esc(ST[a.status])} · ${esc(a.city || '—')} · ${esc(tt('глав', 'chapters'))}: ${a.courseDone}/8 · ${esc(tt('проверка', 'quiz'))}: ${a.quizPassed ? '✓' : '—'}${a.quizAttempts ? ` · ${esc(tt('попыток', 'attempts'))}: ${a.quizAttempts}` : ''}</span>
        ${a.manualReview ? `<span class="pill demo" style="justify-self:start;margin-top:4px">${esc(tt('ручная проверка ответов', 'manual review of answers'))}</span>
          <ol class="small" style="margin:6px 0 0;padding-left:1.3em">${(a.answers || []).map((x) => `<li>${esc(x.text)}<br><span class="${x.right ? '' : 'warn'}">${x.right ? '✓' : '✗'} ${esc(x.chosen || tt('нет ответа', 'no answer'))}</span></li>`).join('')}</ol>` : ''}
        ${a.about ? `<p class="small" style="margin:4px 0 0">${esc(a.about)}</p>` : ''}
        ${decide('f', a, tt('Одобрить и выдать роль', 'Approve and grant role'))}</span></div>`).join('')}</div>` : `<p class="empty">${esc(tt('Заявок на роль фасилитатора нет.', 'No facilitator applications.'))}</p>`}` : ''}`);
    sec.addEventListener('click', async (e) => {
      const ok = e.target.closest('[data-ok]'); const no = e.target.closest('[data-no]'); const key = (ok || no)?.dataset.ok || (ok || no)?.dataset.no;
      if (!key) return;
      const kind = key[0]; const id = key.slice(1);
      const note = sec.querySelector(`[data-note="${key}"]`).value;
      const path = kind === 'c' ? 'curator-applications' : 'applications';
      try { await api(`/api/admin/${path}/${id}/decide`, { method: 'POST', body: { approve: !!ok, note } }); toast(ok ? (kind === 'c' ? tt('Роль куратора выдана', 'Curator role granted') : tt('Роль фасилитатора выдана', 'Facilitator role granted')) : tt('Заявка отклонена', 'Application declined')); ctx.rerender(); } catch (x) { toast(errorText(x)); }
    });
  },

  async meetings(ctx) {
    const { meetings } = await api('/api/admin/meetings');
    if (!ctx.alive()) return;
    const sec = shell(ctx, 'meetings', tt('Встречи', 'Meetings'), `<p class="small muted">${esc(tt('Администратор может снять встречу, если формат не соответствует проекту. Снятая встреча исчезает из поиска; фасилитатор видит причину.', 'An administrator can take a meeting down if it does not fit the project. It disappears from search; the facilitator sees the reason.'))}</p>
      <div class="list">${meetings.map((m) => `<div class="item" style="align-items:flex-start"><span class="body"><b>${esc(m.title)} ${demoPill(m.isDemo)}</b>
        <span class="small">${esc(m.facilitator)} · ${esc(whereText(m))} · ${esc(langName(m.language))} · ${esc(tt('ближайших дат', 'upcoming dates'))}: ${m.dates.length}</span>
        ${m.status === 'removed' ? `<span class="small warn">${esc(tt('Снята:', 'Taken down:'))} ${esc(m.removedReason || '—')}</span> <button class="linkbtn" type="button" data-restore="${m.id}">${esc(tt('Вернуть', 'Restore'))}</button>`
          : `<div class="row" style="margin-top:6px"><input type="text" placeholder="${esc(tt('Причина снятия', 'Reason'))}" data-reason="${m.id}" style="max-width:300px"><button class="btn sm danger" type="button" data-remove="${m.id}">${esc(tt('Снять с публикации', 'Take down'))}</button>
            ${m.dates[0] ? `<a class="btn sm" href="${u('/m/' + m.dates[0].id)}">${esc(tt('Страница', 'Page'))}</a>` : ''}</div>`}</span>
        <span class="pill ${m.status === 'published' ? 'mint' : m.status === 'removed' ? 'red' : ''}">${esc(m.status)}</span></div>`).join('') || `<p class="empty">${esc(tt('Встреч нет.', 'No meetings.'))}</p>`}</div>`);
    sec.addEventListener('click', async (e) => {
      const rm = e.target.closest('[data-remove]'); const rs = e.target.closest('[data-restore]');
      try {
        if (rm) { await api(`/api/admin/meetings/${rm.dataset.remove}/remove`, { method: 'POST', body: { reason: sec.querySelector(`[data-reason="${rm.dataset.remove}"]`).value } }); toast(tt('Встреча снята', 'Meeting taken down')); ctx.rerender(); }
        if (rs) { await api(`/api/admin/meetings/${rs.dataset.restore}/restore`, { method: 'POST' }); ctx.rerender(); }
      } catch (x) { toast(errorText(x)); }
    });
  },

  async cards(ctx) {
    const { cards } = await api('/api/admin/cards');
    if (!ctx.alive()) return;
    const sortKey = storage.get('dc_admin_sort') || 'number';
    const rate = (c) => (c.offers ? (c.colSelections ?? c.selections) / c.offers : 0);
    const sec = shell(ctx, 'cards', tt('Карты и статистика', 'Cards & statistics'), `
      <div class="cols-2"><form class="card-ui flat form" id="up"><h3>${esc(tt('Добавить карты', 'Add cards'))}</h3>
          <p class="small muted" style="margin:0">${esc(tt('Прямая загрузка владельцем (без кураторов). Код присваивается автоматически, исходник хранится отдельно.', 'Direct upload by the owner (no curation). Code is assigned automatically; the original is stored separately.'))}</p>
          <input type="file" name="images" accept="image/jpeg,image/png,image/webp,image/tiff" multiple required><label class="field">${esc(tt('Автор', 'Author'))}<input type="text" name="author" maxlength="200"></label>
          <button class="btn dark" type="submit">${esc(tt('Загрузить', 'Upload'))}</button></form>
        <div class="card-ui flat stack"><h3>${esc(tt('Как считается статистика', 'How statistics are counted'))}</h3>
          <p class="small muted" style="margin:0">${esc(tt('«Выбрали» — общее число выборов для обсуждения: в подборках и в библиотеке, без отменённых, без выбора автором своей карты. «Предложена» — сколько участников открыли подборку с этой картой; процент — выборы в подборках к предложениям. Без регистрации участник = браузер. Тестовые и демо-подборки считаются отдельно. Правила раундов ещё согласуются.', '“Chosen” — the total number of choices for discussion: in selections and in the library, cancelled and the author’s own choices excluded. “Offered” — how many participants opened a selection with this card; the percentage is selection choices to offers. Without sign-up a participant = a browser. Test and demo selections are counted separately. Round rules are still being agreed.'))}</p>
          <label class="field">${esc(tt('Сортировка', 'Sort'))}<select id="sort"><option value="number">${esc(tt('по номеру', 'by number'))}</option><option value="popular">${esc(tt('по числу выборов', 'by choices'))}</option><option value="rate">${esc(tt('по доле выборов', 'by choice rate'))}</option></select></label></div></div>
      <div class="list" id="rows" style="margin-top:14px"></div><div id="ask"></div>`);
    const sortSel = sec.querySelector('#sort'); sortSel.value = sortKey;
    let sorted = [];
    const PRINT = { not_set: tt('печать: нет разрешения', 'print: no permission'), allowed: tt('печать: разрешена', 'print: allowed'), denied: tt('печать: запрещена', 'print: denied') };
    const draw = () => {
      const k = sortSel.value;
      sorted = [...cards].sort((a, b) => (k === 'popular' ? b.selections - a.selections || a.number - b.number : k === 'rate' ? rate(b) - rate(a) || b.selections - a.selections : a.number - b.number));
      sec.querySelector('#rows').innerHTML = sorted.map((c, i) => `<div class="item" style="align-items:flex-start;${c.status === 'removed' ? 'opacity:.7' : ''}">
        ${c.purged ? `<span class="thumb" aria-hidden="true"></span>` : `<button class="thumb" type="button" data-i="${i}" style="border:0;padding:0;cursor:zoom-in"><img src="${esc(c.thumb)}" alt="" loading="lazy"></button>`}
        <span class="body"><b>${esc(c.code)} ${demoPill(c.isDemo)} ${c.status === 'removed' ? `<span class="pill red">${esc(tt('снята', 'removed'))}${c.removedBy ? ' · ' + esc(c.removedBy) : ''}</span>` : ''}</b>
          <input type="text" value="${esc(c.author)}" data-author="${esc(c.code)}" placeholder="${esc(tt('Автор не указан', 'No author'))}" style="min-height:38px;padding:6px 10px;max-width:320px">
          <span class="small">${esc(tt(`выбрали ${c.selections} · предложена ${c.offers}`, `chosen ${c.selections} · offered ${c.offers}`))}${c.offers ? ` · ${Math.round(rate(c) * 100)}%` : ''}${c.testSelections ? ` · +${c.testSelections} ${esc(tt('в тестовых', 'in test'))}` : ''} · ${esc(tt('в подборках', 'in selections'))}: ${c.inCollections} · ${esc(tt('сообщений', 'messages'))}: ${c.comments}</span>
          <span class="row" style="gap:8px"><select data-print="${esc(c.code)}" style="min-height:36px;padding:4px 8px;max-width:240px">${Object.entries(PRINT).map(([v, l]) => `<option value="${v}" ${c.printPermission === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
          ${!c.purged ? `<button class="linkbtn danger" type="button" data-exclude="${esc(c.code)}">${esc(tt('Исключить окончательно', 'Exclude permanently'))}</button>` : `<span class="small muted">${esc(tt('удалена окончательно', 'removed permanently'))}</span>`}
          ${c.purged ? '' : c.status === 'removed' ? `<button class="linkbtn" type="button" data-restore="${esc(c.code)}">${esc(tt('Вернуть в библиотеку', 'Restore'))}</button>` : `<button class="linkbtn danger" type="button" data-remove="${esc(c.code)}">${esc(tt('Снять с публикации', 'Remove'))}</button>`}</span></span></div>`).join('');
    };
    draw();
    sortSel.addEventListener('change', () => { storage.set('dc_admin_sort', sortSel.value); draw(); });
    const ask = sec.querySelector('#ask');
    sec.querySelector('#rows').addEventListener('click', async (e) => {
      const t = e.target.closest('[data-i]'); if (t) { openViewer({ cards: sorted, index: Number(t.dataset.i), mode: 'admin' }); return; }
      const rm = e.target.closest('[data-remove]'); const rs = e.target.closest('[data-restore]'); const ex = e.target.closest('[data-exclude]');
      if (ex) {
        // последствия — до действия: окончательно, без возврата; всем фасилитаторам уведомление и письмо
        ask.innerHTML = `<div class="notice red stack" style="position:sticky;bottom:12px"><b>${esc(tt(`Исключить ${ex.dataset.exclude} из коллекции окончательно?`, `Exclude ${ex.dataset.exclude} from the collection permanently?`))}</b>
          <span class="small">${esc(tt('Карта исчезнет из галереи, игр и подборок, её файлы будут удалены — вернуть её будет нельзя. Всем фасилитаторам уйдёт уведомление и письмо с номером карты. Автору сообщите отдельно. Для временного скрытия используйте «Снять с публикации».', 'The card will disappear from the gallery, games and collections and its files will be deleted — it cannot be restored. All facilitators will get a notice and an email with the card number. Tell the author separately. To hide it temporarily, use “Remove”.'))}</span>
          <div class="row"><button class="btn danger sm" type="button" id="exyes">${esc(tt('Исключить окончательно', 'Exclude permanently'))}</button><button class="linkbtn" type="button" id="exno">${esc(tt('Отмена', 'Cancel'))}</button></div></div>`;
        ask.querySelector('#exno').onclick = () => { ask.innerHTML = ''; };
        ask.querySelector('#exyes').onclick = async () => { try { await api(`/api/admin/cards/${ex.dataset.exclude}/exclude`, { method: 'POST', body: { confirm: true } }); toast(tt('Карта исключена, фасилитаторы уведомлены', 'Card excluded, facilitators notified')); ctx.rerender(); } catch (x) { toast(errorText(x)); } };
        return;
      }
      if (rm) {
        ask.innerHTML = `<div class="notice red row" style="position:sticky;bottom:12px"><span class="grow">${esc(tt(`Снять ${rm.dataset.remove}? Карта исчезнет из библиотеки и всех подборок.`, `Remove ${rm.dataset.remove}? It disappears from the library and all selections.`))}</span><button class="btn danger sm" type="button" id="yes">${esc(tt('Снять', 'Remove'))}</button><button class="linkbtn" type="button" id="no">${esc(tt('Отмена', 'Cancel'))}</button></div>`;
        ask.querySelector('#no').onclick = () => { ask.innerHTML = ''; };
        ask.querySelector('#yes').onclick = async () => { try { await api(`/api/admin/cards/${rm.dataset.remove}/remove`, { method: 'POST' }); ctx.rerender(); } catch (x) { toast(errorText(x)); } };
      }
      if (rs) { try { await api(`/api/admin/cards/${rs.dataset.restore}/restore`, { method: 'POST' }); ctx.rerender(); } catch (x) { toast(errorText(x)); } }
    });
    sec.querySelector('#rows').addEventListener('change', async (e) => {
      const a = e.target.closest('[data-author]'); const p = e.target.closest('[data-print]');
      try {
        if (a) { await api(`/api/admin/cards/${a.dataset.author}`, { method: 'PATCH', body: { author: a.value } }); toast(tt('Автор сохранён', 'Author saved')); }
        if (p) { await api(`/api/admin/cards/${p.dataset.print}/print`, { method: 'PATCH', body: { permission: p.value } }); toast(tt('Сохранено', 'Saved')); }
      } catch (x) { toast(errorText(x)); }
    });
    sec.querySelector('#up').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { const r = await api('/api/admin/cards', { method: 'POST', form: new FormData(e.target) }); toast(tt(`Добавлено: ${r.created.length}`, `Added: ${r.created.length}`)); ctx.rerender(); } catch (x) { toast(errorText(x)); }
    });
  },

  async comments(ctx) {
    const [{ comments }, { log }] = await Promise.all([api('/api/admin/comments'), api('/api/admin/chat-log')]);
    if (!ctx.alive()) return;
    const ROOM = { general: tt('Общий чат', 'General chat'), curators: tt('Чат кураторов', 'Curators’ chat'), facilitators: tt('Чат фасилитаторов', 'Facilitators’ chat') };
    const logHtml = `<h2 style="margin:22px 0 6px;font-size:1.15rem">${esc(tt('Журнал модерации чатов', 'Chat moderation log'))}</h2>
      <p class="small muted">${esc(tt('Скрыть чужое сообщение можно в самом чате («Скрыть (модерация)»); там же — «Восстановить». Текст не переписывается, автор и время сохраняются.', 'Hide someone’s message in the chat itself (“Hide (moderation)”); restore it there too. Text is never rewritten; author and time are kept.'))}</p>
      ${log.length ? `<div class="list">${log.map((l) => `<div class="comment"><header><b>${esc(l.action === 'hide' ? tt('Скрыто', 'Hidden') : tt('Восстановлено', 'Restored'))}</b><a href="${esc(u('/team/' + encodeURIComponent(l.room) + '?m=' + encodeURIComponent(l.messageId)))}">${esc(ROOM[l.room] || l.room)} · №${l.messageId}</a><span>${esc(fmtDate(l.at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</span></header>
        <p class="small">${esc(tt('Автор сообщения', 'Message author'))}: ${esc(l.author)} · ${esc(tt('модератор', 'moderator'))}: ${esc(l.by)}${l.reason ? ` · ${esc(tt('причина', 'reason'))}: ${esc(l.reason)}` : ''}</p></div>`).join('')}</div>` : `<p class="empty">${esc(tt('Действий модерации пока не было.', 'No moderation actions yet.'))}</p>`}`;
    const sec = shell(ctx, 'comments', tt('Обсуждения и модерация', 'Discussions & moderation'), `<p class="small muted">${esc(tt('Последние сообщения под картами. Жалобы и правила модерации ещё уточняются; удалять может администратор и сам автор сообщения.', 'Latest messages under cards. Reports and moderation rules are being agreed; an admin or the author can delete a message.'))}</p>
      <div class="list">${comments.map((c) => `<div class="comment"><header><b>${esc(c.author)}</b><a href="${u('/cards/' + c.code)}">${esc(c.code)}</a><span>${esc(fmtDate(c.createdAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</span>${demoPill(c.isDemo)}
        <button class="linkbtn danger" type="button" data-del="${c.id}">${esc(tt('Удалить', 'Delete'))}</button></header><p>${esc(c.text)}</p></div>`).join('') || `<p class="empty">${esc(tt('Сообщений нет.', 'No messages.'))}</p>`}</div>${logHtml}`);
    sec.addEventListener('click', async (e) => { const d = e.target.closest('[data-del]'); if (!d) return; try { await api(`/api/comments/${d.dataset.del}`, { method: 'DELETE' }); ctx.rerender(); } catch (x) { toast(errorText(x)); } });
  },

  async guide(ctx) {
    const g = await api('/api/admin/guide');
    if (!ctx.alive()) return;
    const course = g.chapters.filter((c) => c.course);
    const sec = shell(ctx, 'guide', tt('Руководство фасилитатора', 'Facilitator guide'), `
      <p class="small muted">${esc(tt('Текст глав вводного курса берётся из документа Word (.docx): заголовки первого уровня «Глава 1…» — главы курса, остальные заголовки первого уровня (например, «Приложения») — дополнительное чтение. Файл хранится на сервере, не в открытом репозитории. Загрузка нового файла заменяет прежний; отметки «прочитано» у будущих фасилитаторов сохраняются.', 'Chapter texts come from a Word document (.docx): level-1 headings “Глава 1…” are course chapters, other level-1 headings (e.g. appendices) are extra reading. The file is stored on the server, not in the public repository. Uploading a new file replaces the old one; readers’ progress is kept.'))}</p>
      <div class="card-ui flat stack">${g.uploadedAt || g.bundled ? `<b>${esc(g.title || tt('Руководство', 'Guide'))}</b><span class="small muted">${g.uploadedAt ? `${esc(tt('Загружено:', 'Uploaded:'))} ${esc(fmtDate(g.uploadedAt, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }))}` : esc(tt('Исходная версия из репозитория (открытое руководство)', 'Original version from the repository (public guide)'))} · ${esc(tt(`глав курса: ${course.length}`, `course chapters: ${course.length}`))}</span>
        <ol class="small" style="margin:0;padding-left:1.3em">${g.chapters.map((c) => `<li>${esc(c.title)}${c.course ? '' : ` <span class="muted">(${esc(tt('дополнительно', 'extra'))})</span>`}</li>`).join('')}</ol>` : `<div class="notice">${esc(tt('Руководство ещё не загружено: будущие фасилитаторы видят только названия глав.', 'The guide is not uploaded yet: future facilitators only see chapter titles.'))}</div>`}
        <a class="small" href="${u('/guide/dialogue-flow-guide.docx')}" download>${esc(tt('Скачать текущую версию (.docx)', 'Download the current version (.docx)'))}</a>
        <form class="row" id="gf"><input type="file" name="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required aria-label="${esc(tt('Файл руководства', 'Guide file'))}" style="flex:1 1 240px"><button class="btn dark" type="submit">${esc(tt('Загрузить', 'Upload'))}</button></form>
        <p class="form-error" id="gerr" role="alert"></p></div>
      <div class="card-ui flat stack" style="margin-top:14px"><h3 style="margin:0">${esc(tt('PDF и аудиозаписи глав', 'PDF and chapter audio'))}</h3>
        <p class="small muted" style="margin:0">${esc(tt('Пока файлов нет, у читателей ничего не показывается. Аудио глав записывает автор и присылает файлы; загрузите их сюда — у главы появится «Прослушать главу».', 'Until files are uploaded nothing is shown to readers. The author records the chapters and sends files; upload them here and the chapter gets “Listen to the chapter”.'))}</p>
        ${['facilitator', 'artist', 'project'].map((gk) => `<form class="row ga" data-g="${gk}"><b style="min-width:12em">${esc(gk === 'facilitator' ? tt('Руководство фасилитатора', 'Facilitator guide') : gk === 'artist' ? tt('Руководство для автора', 'Guide for authors') : tt('Документ о проекте («Что такое Dialogue Cards?»)', 'Project document (“What are Dialogue Cards?”)'))}</b>
          <select name="kind" aria-label="${esc(tt('Что загрузить', 'What to upload'))}"><option value="pdf">PDF</option>${Array.from({ length: 12 }, (_, i) => `<option value="audio:${i + 1}">${esc(tt(`Аудио, глава ${i + 1}`, `Audio, chapter ${i + 1}`))}</option>`).join('')}</select>
          <input type="file" name="file" accept="application/pdf,audio/*" required style="flex:1 1 200px"><button class="btn sm" type="submit">${esc(tt('Загрузить', 'Upload'))}</button></form>`).join('')}
        <p class="form-error" id="gaerr" role="alert"></p></div>`);
    sec.querySelectorAll('form.ga').forEach((f) => f.addEventListener('submit', async (e) => {
      e.preventDefault(); const [kind, n] = f.kind.value.split(':'); const fd = new FormData(); fd.append('file', f.file.files[0]);
      try { await api(`/api/admin/guides/${f.dataset.g}/${kind}${n ? '?chapter=' + n : ''}`, { method: 'POST', form: fd }); toast(tt('Загружено', 'Uploaded')); f.reset(); } catch (x) { sec.querySelector('#gaerr').textContent = errorText(x); }
    }));
    sec.querySelector('#gf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try { const r = await api('/api/admin/guide', { method: 'POST', form: fd }); toast(tt(`Загружено глав: ${r.chapters}`, `Chapters loaded: ${r.chapters}`)); ctx.rerender(); } catch (x) { sec.querySelector('#gerr').textContent = errorText(x); }
    });
  },

  async criteria(ctx) {
    const { criteria } = await api('/api/criteria');
    if (!ctx.alive()) return;
    const sec = shell(ctx, 'criteria', tt('Критерии кураторов', 'Curator criteria'), `<div class="notice demo">${esc(tt('Список критериев должен быть перенесён из PDF владельца проекта дословно по смыслу. Пока стоят временные пункты. Пришлите PDF — перенесём.', 'The criteria list must be taken from the owner’s PDF, keeping its meaning. Placeholders are used for now. Send the PDF and we will transfer it.'))}</div>
      <form class="form" id="cf" style="margin-top:14px"><div class="stack" id="lst">${criteria.map((c) => row(c)).join('')}</div>
        <div class="row"><button class="btn" type="button" id="add">${esc(tt('Добавить пункт', 'Add item'))}</button><button class="btn dark" type="submit">${esc(tt('Сохранить список', 'Save list'))}</button></div></form>`);
    function row(c) { return `<div class="row"><input type="number" min="1" name="n" value="${c.number}" style="width:80px"><input type="text" name="t" value="${esc(c.text)}" class="grow" style="flex:1 1 260px"></div>`; }
    sec.querySelector('#add').onclick = () => sec.querySelector('#lst').insertAdjacentHTML('beforeend', row({ number: sec.querySelectorAll('#lst .row').length + 1, text: '' }));
    sec.querySelector('#cf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const list = [...sec.querySelectorAll('#lst .row')].map((r) => ({ number: Number(r.querySelector('[name=n]').value), text: r.querySelector('[name=t]').value }));
      try { await api('/api/admin/criteria', { method: 'PUT', body: { criteria: list } }); toast(tt('Критерии сохранены', 'Criteria saved')); ctx.rerender(); } catch (x) { toast(errorText(x)); }
    });
  },

  async letters(ctx) {
    let letters;
    try { ({ letters } = await api('/api/admin/outbox')); } catch (e) {
      if (e.code !== 'demo_readonly') throw e;
      shell(ctx, 'letters', tt('Журнал писем', 'Letters log'), `<p class="notice">${esc(tt('Журнал писем содержит адреса настоящих людей, поэтому демо-роли он не показывается. Войдите как владелец.', 'The letters log holds real people’s addresses, so it is hidden from demo roles. Sign in as the owner.'))}</p>`);
      return;
    }
    if (!ctx.alive()) return;
    const ST = { sent: [tt('отправлено', 'sent'), 'mint'], demo: [tt('демо — не отправлено', 'demo — not sent'), ''], failed: [tt('ошибка', 'failed'), 'red'] };
    shell(ctx, 'letters', tt('Журнал писем', 'Letters log'), `<p class="small muted">${esc(tt('Коды входа и подтверждения записи. Пока почта не подключена, письма не уходят, а их текст показывается на экране.', 'Sign-in codes and registration confirmations. While email is not connected, letters are not sent and their text is shown on screen.'))}</p>
      <div class="scroll-x"><table class="tbl"><tr><th>${esc(tt('Когда', 'When'))}</th><th>${esc(tt('Кому', 'To'))}</th><th>${esc(tt('Тема', 'Subject'))}</th><th>${esc(tt('Статус', 'Status'))}</th></tr>
      ${letters.map((l) => `<tr><td>${esc(fmtDate(l.createdAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</td><td>${esc(l.to)}</td><td>${esc(l.subject.replace(/\d{6}/, '••••••'))}</td><td><span class="pill ${ST[l.status][1]}">${esc(ST[l.status][0])}</span></td></tr>`).join('')}</table></div>`);
  },
};
