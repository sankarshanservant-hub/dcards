// Администрирование: обзор состояний, роли, заявки фасилитаторов, встречи (снятие), карты и статистика,
// модерация обсуждений, критерии кураторов, журнал писем, демо-данные.
import { esc, tt, u, api, errorText, toast, fmtDate, storage } from '../util.js';
import { openViewer } from '../viewer.js';
import { session, hasRole, needLogin, noRole, loading, failed, ROLE_LABEL, rolesText, demoPill, WORK_STATUS, statusPill } from '../ui.js';
import { langName, whereText } from './meetings.js';

const TABS = [['', 'Обзор', 'Overview'], ['users', 'Люди и роли', 'People & roles'], ['works', 'Работы', 'Works'], ['applications', 'Заявки', 'Applications'], ['meetings', 'Встречи', 'Meetings'],
  ['cards', 'Карты и статистика', 'Cards & statistics'], ['comments', 'Обсуждения', 'Discussions'], ['criteria', 'Критерии', 'Criteria'], ['guide', 'Руководство', 'Guide'], ['letters', 'Письма', 'Letters']];
// Разделы сгруппированы по назначению (21.11.2026): обзор, люди, работы и карты, встречи и общение, служебное.
const GROUPS = [
  ['Обзор', 'Overview', ['']],
  ['Люди', 'People', ['users', 'applications']],
  ['Работы и карты', 'Works & cards', ['works', 'cards', 'criteria']],
  ['Встречи и общение', 'Meetings & talk', ['meetings', 'comments']],
  ['Материалы и почта', 'Materials & mail', ['guide', 'letters']],
];
const tabs = (cur) => `<nav class="adm-nav" aria-label="${esc(tt('Разделы администрирования', 'Administration sections'))}">${GROUPS.map(([gru, gen, keys]) => `<div class="adm-group"><span class="adm-g">${esc(tt(gru, gen))}</span><div class="adm-links">${keys.map((k) => { const t = TABS.find((x) => x[0] === k); return `<a class="${cur === k ? 'on' : ''}" ${cur === k ? 'aria-current="page"' : ''} href="${u('/admin' + (k ? '/' + k : ''))}">${esc(tt(t[1], t[2]))}</a>`; }).join('')}</div></div>`).join('')}</nav>`;
const guard = (ctx) => {
  if (!session.user) { needLogin(ctx.main, tt('Раздел администратора.', 'Administrator section.')); return false; }
  if (!hasRole('admin') || !session.user.roles.includes('admin')) { noRole(ctx.main, ROLE_LABEL.admin()); return false; }
  return true;
};
const shell = (ctx, cur, title, inner) => {
  ctx.main.innerHTML = `<div class="wrap page"><p class="eyebrow">${esc(tt('Администрирование', 'Administration'))}</p><h1>${esc(title)}</h1>${tabs(cur)}<div id="sec">${inner}</div></div>`;
  return ctx.main.querySelector('#sec');
};

export async function overview(ctx) {
  if (!guard(ctx)) return;
  loading(ctx.main);
  let o;
  try { o = await api('/api/admin/overview'); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  const k = (n, ru, en) => `<div class="kpi"><b>${n ?? 0}</b><span>${esc(tt(ru, en))}</span></div>`;
  const sec = shell(ctx, '', tt('Обзор проекта', 'Project overview'), `
    <div class="kpis">${k(o.cards.published, 'карт опубликовано', 'cards published')}${k(o.cards.removed, 'карт снято', 'cards removed')}
      ${k((o.works.submitted || 0) + (o.works.discussion || 0), 'работ в очереди', 'works in queue')}${k(o.works.needs_changes, 'на доработке', 'returned for changes')}
      ${k(o.meetings.published, 'встреч опубликовано', 'meetings published')}${k(o.meetings.removed, 'встреч снято', 'meetings taken down')}
      ${k(o.registrations, 'активных записей', 'active sign-ups')}${k(o.pendingApplications, 'заявок фасилитаторов', 'facilitator applications')}
      ${k(o.users, 'пользователей (без демо)', 'users (no demo)')}${k(o.comments, 'сообщений в обсуждениях', 'discussion messages')}</div>
    <div class="cols-2" style="margin-top:16px">
      <div class="card-ui flat stack"><h3>${esc(tt('Подключения', 'Connections'))}</h3>
        <p style="margin:0">${esc(tt('Почта:', 'Email:'))} <b class="${o.mailConnected ? 'ok' : 'warn'}">${esc(o.mailConnected ? tt('подключена (SMTP)', 'connected (SMTP)') : tt('не подключена — письма показываются на экране (демо)', 'not connected — letters are shown on screen (demo)'))}</b></p>
        <p style="margin:0">${esc(tt('Перевод сообщений:', 'Message translation:'))} <b class="warn">${esc(tt('не подключён — ссылка на внешний переводчик', 'not connected — link to an external translator'))}</b></p>
        <p style="margin:0">${esc(tt('Оплата:', 'Payments:'))} <b>${esc(tt('не принимается на сайте (по заданию)', 'not taken on the site (by design)'))}</b></p></div>
      ${o.demoMode ? `<div class="card-ui flat stack"><h3>${esc(tt('Демо-данные', 'Demo data'))}</h3>
        <p class="small muted" style="margin:0">${esc(tt('Демо-работы, встречи, подборка, сообщения и заявка. Помечены «демо», видны только в демо-режиме и не смешиваются с реальной статистикой.', 'Demo works, meetings, a selection, messages and an application. Labelled “demo”, visible only in demo mode and kept apart from real statistics.'))}</p>
        <div class="row"><button class="btn dark sm" type="button" id="seed">${esc(tt('Заполнить демо-данными', 'Fill with demo data'))}</button><button class="btn sm danger" type="button" id="clear">${esc(tt('Удалить демо-данные', 'Delete demo data'))}</button></div></div>` : ''}
    </div>`);
  // обмены: этапы со знаменателями (без имён и текстов); ориентиры — гипотезы для проверки
  api('/api/admin/exchange-stats?days=30').then((x) => {
    const p = x.personal; const pct = (a, b) => (b ? ` · ${Math.round((a / b) * 100)}%` : '');
    const row = (t0, v, d) => `<tr><td>${esc(t0)}</td><td><b>${v}</b>${d != null ? pct(v, d) : ''}</td></tr>`;
    sec.insertAdjacentHTML('beforeend', `<div class="card-ui flat stack" style="margin-top:16px"><h3 style="margin:0">${esc(tt('Обмены за 30 дней', 'Exchanges, last 30 days'))}</h3>
      <table class="small"><tbody>${row(tt('Создано приглашений', 'Invitations created'), p.all.created)}${row(tt('Отправлено или скопировано', 'Sent or copied'), p.all.sent, p.all.created)}
      ${row(tt('Открыто человеком', 'Opened by a person'), p.all.opened, p.all.sent)}${row(tt('Получили ответ', 'Answered'), p.all.answered, p.all.opened)}
      ${row(tt('Ответивших (уникальных)', 'Responders (unique)'), x.responders)}${row(tt('…из них отправили свою карту', '…of them sent their own card'), x.onwardAny, x.responders)}
      ${row(tt('— ответной картой в том же разговоре', '— a reply card in the same conversation'), x.onwardReply, x.responders)}${row(tt('— новым людям (отдельный обмен)', '— to new people (separate exchange)'), x.onwardNew, x.responders)}</tbody></table>
      <p class="small muted" style="margin:0">${esc(tt('Ориентиры «ответили больше половины», «каждый третий отправил свою» — гипотезы. Гость на разных устройствах считается разными людьми; новый обмен не доказывает нового человека. Групповые ссылки будут считаться отдельно.', 'Targets “over half answered”, “one in three sent their own” are hypotheses. A guest on different devices counts as different people; a new exchange does not prove a new person. Group links will be counted separately.'))}</p></div>`);
  }).catch(() => {});
  const sd = sec.querySelector('#seed');
  if (sd) {
    sd.addEventListener('click', async () => { sd.disabled = true; try { const r = await api('/api/admin/demo/seed', { method: 'POST' }); toast(r.already ? tt('Демо-данные уже есть', 'Demo data already exists') : tt('Демо-данные добавлены', 'Demo data added')); ctx.rerender(); } catch (x) { toast(errorText(x)); sd.disabled = false; } });
    sec.querySelector('#clear').addEventListener('click', async () => { try { await api('/api/admin/demo/clear', { method: 'POST' }); toast(tt('Демо-данные удалены', 'Demo data deleted')); ctx.rerender(); } catch (x) { toast(errorText(x)); } });
  }
}

export async function section(ctx, name) {
  if (!guard(ctx)) return;
  loading(ctx.main);
  try { await SECTIONS[name](ctx); } catch (e) { if (ctx.alive()) failed(ctx.main, e, ctx.rerender); }
}

const ACTION_LABEL = { recommend: () => tt('Рекомендована кураторами', 'Recommended by curators'), approve: () => tt('Опубликована', 'Published'), return: () => tt('Возвращена на доработку', 'Returned for changes'), reject: () => tt('Отклонена', 'Declined') };
const SECTIONS = {
  // Работы: «Одобрено кураторами» — только рекомендации, окончательное решение здесь; ниже — все решения (автор, дата, причины).
  async works(ctx) {
    const d = await api('/api/admin/works');
    if (!ctx.alive()) return;
    const when = (x) => fmtDate(x, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const sec = shell(ctx, 'works', tt('Работы', 'Works'), `
      <h2 style="margin:0">${esc(tt('Одобрено кураторами', 'Approved by curators'))} · ${d.recommended.length}</h2>
      <p class="small muted" style="margin:4px 0 12px">${esc(tt('Кураторы рекомендовали эти работы к публикации. В галерее работа (или новая версия карты) появится только после вашего решения, тогда же автор получит уведомление.', 'Curators recommended these works for publication. A work (or a new card version) appears in the gallery only after your decision; the artist is notified then.'))}</p>
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
    const sec = shell(ctx, 'users', tt('Люди и роли', 'People & roles'), `<p class="small muted">${esc(tt('Роль выдаётся и снимается сразу; права проверяются сервером при каждом действии. У одного человека может быть несколько ролей (техническое предложение).', 'Roles are granted and removed immediately; the server checks permissions on every action. One person may hold several roles (technical proposal).'))}</p>
      <div class="list">${users.map((x) => `<div class="item" style="align-items:flex-start"><span class="body"><b>${esc(x.publicName)}${x.publicName !== x.name ? ` <span class="small muted">(${esc(x.name)})</span>` : ''} ${demoPill(x.isDemo)}</b>
        <span class="small">${esc(x.email || tt('без email', 'no email'))} · ${esc(rolesText(x.roles))}</span>
        <div class="chips" style="margin-top:6px">${['artist', 'curator', 'facilitator', 'admin'].map((r) => `<button class="chip ${x.roles.includes(r) ? 'on' : ''}" type="button" data-u="${x.id}" data-r="${r}" data-g="${x.roles.includes(r) ? 0 : 1}">${esc(ROLE_LABEL[r]())}</button>`).join('')}</div>
        ${x.cardCount && !x.isDemo ? `<form class="row" data-transfer="${x.id}" style="margin-top:6px"><span class="small">${esc(tt(`Автор карт: ${x.cardCount}. Передать карты аккаунту:`, `Artist of ${x.cardCount} cards. Transfer them to:`))}</span>
          <select name="to" style="max-width:240px"><option value="">—</option>${users.filter((y) => y.id !== x.id && !y.isDemo).map((y) => `<option value="${y.id}">${esc(y.publicName)}${y.email ? ' · ' + esc(y.email) : ''}</option>`).join('')}</select><button class="btn sm" type="submit">OK</button></form>` : ''}
        ${!x.email ? `<form class="row" data-email="${x.id}" style="margin-top:6px"><input type="email" name="email" placeholder="${esc(tt('Указать email для входа', 'Set an email for sign-in'))}" style="max-width:280px"><button class="btn sm" type="submit">OK</button></form>` : ''}</span></div>`).join('')}</div>`);
    sec.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-r]'); if (!b) return;
      try { await api(`/api/admin/users/${b.dataset.u}/roles`, { method: 'POST', body: { role: b.dataset.r, grant: b.dataset.g === '1' } }); toast(tt('Роли обновлены', 'Roles updated')); ctx.rerender(); } catch (x) { toast(errorText(x)); }
    });
    sec.querySelectorAll('[data-transfer]').forEach((f) => f.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!f.to.value) return;
      try { const r = await api(`/api/admin/users/${f.dataset.transfer}/transfer-cards`, { method: 'POST', body: { to: Number(f.to.value) } }); toast(tt(`Карт передано: ${r.moved}`, `Cards transferred: ${r.moved}`)); ctx.rerender(); } catch (x) { toast(errorText(x)); }
    }));
    sec.querySelectorAll('[data-email]').forEach((f) => f.addEventListener('submit', async (e) => {
      e.preventDefault(); try { await api(`/api/admin/users/${f.dataset.email}`, { method: 'PATCH', body: { email: f.email.value } }); toast(tt('Email сохранён', 'Email saved')); ctx.rerender(); } catch (x) { toast(errorText(x)); }
    }));
  },

  async applications(ctx) {
    const [{ applications }, { applications: curApps }, { requests }] = await Promise.all([api('/api/admin/applications'), api('/api/admin/curator-applications'), api('/api/admin/print-requests')]);
    if (!ctx.alive()) return;
    const ST = { in_progress: tt('проходит курс', 'taking the course'), submitted: tt('ждёт решения', 'awaiting decision'), approved: tt('одобрена', 'approved'), rejected: tt('не одобрена', 'not approved') };
    const decide = (kind, a, grant) => `${a.status === 'submitted' ? `<div class="row" style="margin-top:8px"><input type="text" placeholder="${esc(tt('Комментарий (по желанию)', 'Note (optional)'))}" data-note="${kind}${a.userId}" style="max-width:280px">
          <button class="btn dark sm" type="button" data-ok="${kind}${a.userId}">${esc(grant)}</button><button class="btn sm danger" type="button" data-no="${kind}${a.userId}">${esc(tt('Отклонить', 'Decline'))}</button></div>` : ''}`;
    const sec = shell(ctx, 'applications', tt('Заявки', 'Applications'), `
      <h3>${esc(tt('Заявки на роль куратора', 'Curator applications'))}</h3>
      ${curApps.length ? `<div class="list">${curApps.map((a) => `<div class="item" style="align-items:flex-start"><span class="body">
        <b>${esc(a.name)} ${demoPill(a.isDemo)}</b><span class="small">${esc(ST[a.status])} · ${esc(a.contact)}${a.accountName !== a.name ? ' · ' + esc(tt('аккаунт', 'account')) + ': ' + esc(a.accountName) : ''}</span>
        <p class="small" style="margin:4px 0 0;white-space:pre-wrap">${esc(a.motivation)}</p>
        ${decide('c', a, tt('Одобрить и выдать роль куратора', 'Approve and grant the curator role'))}</span></div>`).join('')}</div>` : `<p class="empty">${esc(tt('Заявок на роль куратора нет.', 'No curator applications.'))}</p>`}
      <h3 style="margin-top:22px">${esc(tt('Заявки на роль фасилитатора', 'Facilitator applications'))}</h3>
      ${applications.length ? `<div class="list">${applications.map((a) => `<div class="item" style="align-items:flex-start"><span class="body">
        <b>${esc(a.name)} ${demoPill(a.isDemo)}</b><span class="small">${esc(ST[a.status])} · ${esc(a.city || '—')} · ${esc(tt('глав', 'chapters'))}: ${a.courseDone}/8 · ${esc(tt('проверка', 'quiz'))}: ${a.quizPassed ? '✓' : '—'}${a.quizAttempts ? ` · ${esc(tt('попыток', 'attempts'))}: ${a.quizAttempts}` : ''}</span>
        ${a.manualReview ? `<span class="pill demo" style="justify-self:start;margin-top:4px">${esc(tt('ручная проверка ответов', 'manual review of answers'))}</span>
          <ol class="small" style="margin:6px 0 0;padding-left:1.3em">${(a.answers || []).map((x) => `<li>${esc(x.text)}<br><span class="${x.right ? '' : 'warn'}">${x.right ? '✓' : '✗'} ${esc(x.chosen || tt('нет ответа', 'no answer'))}</span></li>`).join('')}</ol>` : ''}
        ${a.about ? `<p class="small" style="margin:4px 0 0">${esc(a.about)}</p>` : ''}
        ${decide('f', a, tt('Одобрить и выдать роль', 'Approve and grant role'))}</span></div>`).join('')}</div>` : `<p class="empty">${esc(tt('Заявок на роль фасилитатора нет.', 'No facilitator applications.'))}</p>`}
      <h3 style="margin-top:22px">${esc(tt('Запросы печатной колоды', 'Printed deck requests'))}</h3>
      ${requests.length ? `<div class="list">${requests.map((r) => `<div class="item" style="align-items:flex-start"><span class="body"><b>${esc(r.name)} ${demoPill(r.isDemo)}</b><span class="small">${esc(r.email || '—')} · ${esc(fmtDate(r.createdAt, { day: 'numeric', month: 'short' }))} · ${r.status === 'new' ? esc(tt('новый', 'new')) : esc(tt('обработан', 'done'))}</span>
        ${r.note ? `<p class="small" style="margin:4px 0 0;white-space:pre-wrap">${esc(r.note)}</p>` : ''}
        ${r.status === 'new' ? `<div class="row" style="margin-top:8px"><button class="btn sm" type="button" data-pdone="${r.id}">${esc(tt('Отметить обработанным', 'Mark as done'))}</button></div>` : ''}</span></div>`).join('')}</div>` : `<p class="empty">${esc(tt('Запросов нет.', 'No requests.'))}</p>`}`);
    sec.addEventListener('click', async (e) => {
      const pd = e.target.closest('[data-pdone]');
      if (pd) { try { await api(`/api/admin/print-requests/${pd.dataset.pdone}/done`, { method: 'POST' }); ctx.rerender(); } catch (x) { toast(errorText(x)); } return; }
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
          <input type="file" name="images" accept="image/jpeg,image/png,image/webp,image/tiff" multiple required><label class="field">${esc(tt('Автор', 'Artist'))}<input type="text" name="author" maxlength="200"></label>
          <button class="btn dark" type="submit">${esc(tt('Загрузить', 'Upload'))}</button></form>
        <div class="card-ui flat stack"><h3>${esc(tt('Как считается статистика', 'How statistics are counted'))}</h3>
          <p class="small muted" style="margin:0">${esc(tt('«Выбрали» — общее число выборов для обсуждения: в подборках и в библиотеке, без отменённых, без выбора автором своей карты. «Предложена» — сколько участников открыли подборку с этой картой; процент — выборы в подборках к предложениям. Без регистрации участник = браузер. Тестовые и демо-подборки считаются отдельно. Правила раундов ещё согласуются.', '“Chosen” — the total number of choices for discussion: in selections and in the library, cancelled and the artist’s own choices excluded. “Offered” — how many participants opened a selection with this card; the percentage is selection choices to offers. Without sign-up a participant = a browser. Test and demo selections are counted separately. Round rules are still being agreed.'))}</p>
          <label class="field">${esc(tt('Сортировка', 'Sort'))}<select id="sort"><option value="number">${esc(tt('по номеру', 'by number'))}</option><option value="popular">${esc(tt('по числу выборов', 'by choices'))}</option><option value="rate">${esc(tt('по доле выборов', 'by choice rate'))}</option></select></label></div></div>
      <div class="list" id="rows" style="margin-top:14px"></div><div id="ask"></div>`);
    const sortSel = sec.querySelector('#sort'); sortSel.value = sortKey;
    let sorted = [];
    const PRINT = { not_set: tt('печать: нет разрешения', 'print: no permission'), allowed: tt('печать: разрешена', 'print: allowed'), denied: tt('печать: запрещена', 'print: denied') };
    const draw = () => {
      const k = sortSel.value;
      sorted = [...cards].sort((a, b) => (k === 'popular' ? b.selections - a.selections || a.number - b.number : k === 'rate' ? rate(b) - rate(a) || b.selections - a.selections : a.number - b.number));
      sec.querySelector('#rows').innerHTML = sorted.map((c, i) => `<div class="item" style="align-items:flex-start;${c.status === 'removed' ? 'opacity:.7' : ''}">
        <button class="thumb" type="button" data-i="${i}" style="border:0;padding:0;cursor:zoom-in"><img src="${esc(c.thumb)}" alt="" loading="lazy"></button>
        <span class="body"><b>${esc(c.code)} ${demoPill(c.isDemo)} ${c.status === 'removed' ? `<span class="pill red">${esc(tt('снята', 'removed'))}${c.removedBy ? ' · ' + esc(c.removedBy) : ''}</span>` : ''}</b>
          <input type="text" value="${esc(c.author)}" data-author="${esc(c.code)}" placeholder="${esc(tt('Автор не указан', 'No artist'))}" style="min-height:38px;padding:6px 10px;max-width:320px">
          <span class="small">${esc(tt(`выбрали ${c.selections} · предложена ${c.offers}`, `chosen ${c.selections} · offered ${c.offers}`))}${c.offers ? ` · ${Math.round(rate(c) * 100)}%` : ''}${c.testSelections ? ` · +${c.testSelections} ${esc(tt('в тестовых', 'in test'))}` : ''} · ${esc(tt('в подборках', 'in selections'))}: ${c.inCollections} · ${esc(tt('сообщений', 'messages'))}: ${c.comments}</span>
          <span class="row" style="gap:8px"><select data-print="${esc(c.code)}" style="min-height:36px;padding:4px 8px;max-width:240px">${Object.entries(PRINT).map(([v, l]) => `<option value="${v}" ${c.printPermission === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
          ${c.status === 'removed' ? `<button class="linkbtn" type="button" data-restore="${esc(c.code)}">${esc(tt('Вернуть в библиотеку', 'Restore'))}</button>` : `<button class="linkbtn danger" type="button" data-remove="${esc(c.code)}">${esc(tt('Снять с публикации', 'Remove'))}</button>`}</span></span></div>`).join('');
    };
    draw();
    sortSel.addEventListener('change', () => { storage.set('dc_admin_sort', sortSel.value); draw(); });
    const ask = sec.querySelector('#ask');
    sec.querySelector('#rows').addEventListener('click', async (e) => {
      const t = e.target.closest('[data-i]'); if (t) { openViewer({ cards: sorted, index: Number(t.dataset.i), mode: 'admin' }); return; }
      const rm = e.target.closest('[data-remove]'); const rs = e.target.closest('[data-restore]');
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
        if (a) { await api(`/api/admin/cards/${a.dataset.author}`, { method: 'PATCH', body: { author: a.value } }); toast(tt('Автор сохранён', 'Artist saved')); }
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
    const sec = shell(ctx, 'comments', tt('Обсуждения', 'Discussions'), `<p class="small muted">${esc(tt('Последние сообщения под картами. Жалобы и правила модерации ещё уточняются; удалять может администратор и сам автор сообщения.', 'Latest messages under cards. Reports and moderation rules are being agreed; an admin or the author can delete a message.'))}</p>
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
        ${['facilitator', 'artist', 'project'].map((gk) => `<form class="row ga" data-g="${gk}"><b style="min-width:12em">${esc(gk === 'facilitator' ? tt('Руководство фасилитатора', 'Facilitator guide') : gk === 'artist' ? tt('Руководство для автора', 'Guide for artists') : tt('Документ о проекте («Что такое Dialogue Cards?»)', 'Project document (“What are Dialogue Cards?”)'))}</b>
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
