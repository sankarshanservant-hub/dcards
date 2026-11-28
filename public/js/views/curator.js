// Кураторы: работы на рассмотрении (общий список), проверка по критериям, сравнение версий, обсуждение с коллегами и голоса, история.
import { esc, tt, u, api, errorText, toast, fmtDate } from '../util.js';
import { openViewer } from '../viewer.js';
import { session, hasRole, needLogin, noRole, loading, failed, WORK_STATUS, statusPill, demoPill, ic } from '../ui.js';
import { historyRow } from './artist.js';

export async function queue(ctx) {
  if (!session.user) return needLogin(ctx.main, tt('Раздел кураторов.', 'Curators’ section.'));
  if (!hasRole('curator')) return noRole(ctx.main, tt('куратор', 'curator'));
  loading(ctx.main);
  let d;
  try { d = await api('/api/curation/queue'); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  const tab = ['all', 'discussion', 'recent'].includes(ctx.query.get('tab')) ? ctx.query.get('tab') : 'all';
  const disc = d.queue.filter((w) => w.status === 'discussion');
  const list = tab === 'discussion' ? disc : tab === 'recent' ? d.recent : d.queue;
  const placeholders = d.criteria.some((c) => c.placeholder);
  const TABS = [['all', 'На рассмотрении', 'Under review', d.queue.length], ['discussion', 'На обсуждении у кураторов', 'Discussed by curators', disc.length], ['recent', 'Принятые решения', 'Decisions made', d.recent.length]];
  const head = tab === 'all'
    ? [tt('Работы на рассмотрении', 'Works under review'), tt(`Ожидают решения: ${d.queue.length}`, `Awaiting a decision: ${d.queue.length}`), tt('Список общий для всех кураторов.', 'The list is shared by all curators.')]
    : tab === 'discussion'
      ? [tt('На обсуждении у кураторов', 'Discussed by curators'), tt(`Работ: ${disc.length}`, `Works: ${disc.length}`), tt('Работы, вынесенные в чат кураторов за советом. Окончательного решения по ним ещё нет.', 'Works brought to the curators’ chat for advice. No final decision yet.')]
      : [tt('Принятые решения', 'Decisions made'), tt(`За последние 30 дней: ${d.recent.length}`, `In the last 30 days: ${d.recent.length}`), tt('Опубликованные, возвращённые на доработку и отклонённые работы.', 'Published, returned and declined works.')];
  const DEC = { recommended: tt('Рекомендована к публикации', 'Recommended for publication'), published: tt('Опубликована', 'Published'), approved: tt('Опубликована', 'Published'), needs_changes: tt('Возвращена на доработку', 'Returned for changes'), rejected: tt('Отклонена', 'Declined') };
  ctx.main.innerHTML = `<div class="wrap page stack">
    <div class="page-head"><h1>${esc(tt('Кабинет куратора', 'Curator space'))}</h1></div>
    <div class="row"><a class="btn light sm chat-btn" href="${u('/team/curators')}">${ic.chat}<span>${esc(tt('Чат кураторов', 'Curators’ chat'))}</span></a></div>
    <nav class="cur-tabs" role="tablist" aria-label="${esc(tt('Списки работ', 'Work lists'))}">${TABS.map(([k, ru, en, n]) => `<a role="tab" aria-selected="${tab === k}" class="${tab === k ? 'on' : ''}" href="${u('/curator?tab=' + k)}"><span>${esc(tt(ru, en))}</span><b class="n">${n}</b></a>`).join('')}</nav>
    <div><h2 style="margin:0">${esc(head[0])}</h2><p style="margin:4px 0 0;font-weight:600">${esc(head[1])}</p><p class="small muted" style="margin:2px 0 0">${esc(head[2])}</p></div>
    ${placeholders ? `<div class="notice demo small">${esc(tt('Критерии пока временные: формулировки будут перенесены из PDF владельца проекта. Номера и механика выбора уже работают.', 'Criteria are placeholders for now: wording will be taken from the owner’s PDF. Numbers and selection already work.'))}</div>` : ''}
    ${list.length ? `<div class="list">${list.map((w) => `<a class="work" href="${u('/curator/works/' + w.id)}" style="text-decoration:none;color:inherit">
        <div class="thumb">${w.version ? `<img src="${esc(w.version.thumb)}" alt="" loading="lazy">` : ''}</div>
        <div class="body"><div class="row" style="gap:6px">${tab === 'recent' ? `<span class="pill">${esc(DEC[w.status] || w.status)}</span>` : statusPill(WORK_STATUS, w.status)}${demoPill(w.isDemo)}${w.kind === 'replacement' ? `<span class="pill">${esc(tt('Новая версия', 'New version'))} ${esc(w.targetCard.code)}</span>` : ''}</div>
          <b>${esc(tt('Работа', 'Work'))} №${w.id} · ${esc(w.artist)}</b><span class="small muted">${esc(tt('версия', 'version'))} ${w.versionsCount} · ${esc(tab === 'recent' ? tt('решение', 'decided') : tt('обновлено', 'updated'))} ${esc(fmtDate(w.updatedAt, { day: 'numeric', month: 'long', year: 'numeric' }))}</span></div></a>`).join('')}</div>`
      : `<p class="empty">${esc(tab === 'all' ? tt('Сейчас работ на рассмотрении нет.', 'No works are waiting now.') : tab === 'discussion' ? tt('На обсуждении работ нет.', 'No works under discussion.') : tt('За последние 30 дней решений не было.', 'No decisions in the last 30 days.'))}</p>`}
  </div>`;
}

export async function review(ctx, id) {
  if (!session.user) return needLogin(ctx.main, '');
  if (!hasRole('curator')) return noRole(ctx.main, tt('куратор', 'curator'));
  loading(ctx.main);
  let w; let q;
  try { [w, q] = await Promise.all([api(`/api/works/${id}`), api('/api/curation/queue')]); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  // свою работу куратор не рассматривает — решение, обсуждение и голос у других кураторов
  const own = w.artistId === session.user.id;
  const inReview = ['submitted', 'discussion'].includes(w.status) && !own;
  const versions = w.versions;
  const cur = versions[versions.length - 1];
  const prev = versions.length > 1 ? versions[versions.length - 2] : null;
  const compareA = w.kind === 'replacement' ? { label: tt(`Сейчас опубликовано (${w.targetCard.code})`, `Currently published (${w.targetCard.code})`), thumb: w.targetCard.thumb, full: w.targetCard.full, width: w.targetCard.width, height: w.targetCard.height }
    : prev ? { label: tt(`Предыдущая версия (${prev.n})`, `Previous version (${prev.n})`), ...prev } : null;
  const tally = ['approve', 'return', 'reject'].map((v) => [v, w.votes.filter((x) => x.vote === v).length]);
  const VOTE = { approve: tt('одобрить', 'approve'), return: tt('вернуть', 'return'), reject: tt('отклонить', 'decline') };
  ctx.main.innerHTML = `<div class="wrap page stack">
    <a href="${u('/curator')}" class="small">← ${esc(tt('К работам', 'To works'))}</a>
    <div class="page-head"><h1>${esc(tt('Работа', 'Work'))} №${w.id}</h1><p class="sub">${esc(w.artist)} · ${esc(tt('версия', 'version'))} ${cur.n} · ${esc(tt('подана', 'submitted'))} ${esc(fmtDate(cur.createdAt || w.createdAt, { day: 'numeric', month: 'long', year: 'numeric' }))}${w.targetCard ? ` · ${esc(tt('карта', 'card'))} ${esc(w.targetCard.code)}` : ''}</p></div>
    ${(() => { const ret = (w.history || []).filter((h) => h.action === 'return').pop(); return ret && versions.length > 1 ? `<div class="notice small"><b>${esc(tt(`Повторная подача. Причины прошлого возврата (версия ${ret.versionN}):`, `Resubmission. Reasons for the previous return (version ${ret.versionN}):`))}</b><ul class="reasons">${ret.criteria.map((c) => `<li><b>${c.number}.</b>${esc(c.text)}</li>`).join('')}</ul>${ret.comment ? `<p style="margin:6px 0 0">${esc(tt('Комментарий:', 'Comment:'))} ${esc(ret.comment)}</p>` : ''}</div>` : ''; })()}
    <div class="row" style="gap:8px">${statusPill(WORK_STATUS, w.status)}${demoPill(w.isDemo)}${w.kind === 'replacement' ? `<span class="pill navy">${esc(tt('Новая версия опубликованной карты', 'New version of a published card'))}</span>` : ''}</div>
    ${w.status === 'recommended' ? `<div class="notice small">${esc(tt(`Рекомендована к публикации (${w.recommendedBy || 'куратор'}). Окончательное решение — за администратором; до него работа не в галерее.`, `Recommended for publication (${w.recommendedBy || 'curator'}). The administrator makes the final decision; until then the work is not in the gallery.`))}</div>` : ''}
    <div class="review-layout"><div class="stack">
    ${compareA ? `<div class="seg ba-toggle" role="group" aria-label="${esc(tt('Сравнение версий', 'Compare versions'))}">
        <button type="button" class="on" data-ba="a" aria-pressed="true">${esc(tt('Было', 'Before'))}</button><button type="button" data-ba="b" aria-pressed="false">${esc(tt('Стало', 'After'))}</button></div>` : ''}
    <div class="compare same-scale ${compareA ? 'pair show-a' : ''}" id="cmp">
      ${compareA ? `<figure class="ba-a"><div class="frame"><img src="${esc(compareA.full)}" data-full="${esc(compareA.full)}" data-w="${compareA.width}" data-h="${compareA.height}" alt="${esc(compareA.label)}"></div><figcaption><b>${esc(tt('Было', 'Before'))}:</b> ${esc(compareA.label)}</figcaption></figure>` : ''}
      <figure class="ba-b"><div class="frame"><img src="${esc(cur.full)}" data-full="${esc(cur.full)}" data-w="${cur.width}" data-h="${cur.height}" alt=""></div><figcaption>${compareA ? `<b>${esc(tt('Стало', 'After'))}:</b> ` : ''}${esc(tt(`Новая версия (${cur.n})`, `New version (${cur.n})`))}${cur.note ? ' · ' + esc(cur.note) : ''}</figcaption></figure>
    </div>
    </div><div class="decide stack">
    ${inReview ? `<form class="card-ui stack" id="df">
      <h2>${esc(tt('Решение', 'Decision'))}</h2>
      <div class="chips" id="acts">${[['approve', 'Рекомендовать к публикации', 'Recommend for publication'], ['return', 'Вернуть на доработку', 'Return for changes'], ['reject', 'Отклонить', 'Decline']].map(([k, ru, en], i) => `<label class="chip ${i === 0 ? 'on' : ''}"><input type="radio" name="action" value="${k}" ${i === 0 ? 'checked' : ''} hidden>${esc(tt(ru, en))}</label>`).join('')}</div>
      ${w.kind === 'replacement' ? `<fieldset class="stack" id="rtype" style="border:0;padding:0;margin:0"><b>${esc(tt('Тип изменения', 'Type of change'))}</b>
        <p class="small muted" style="margin:0">${esc(tt('При небольших доработках изображения номер карты сохраняется. Новая работа получает новый номер.', 'Small refinements of the image keep the card number. A new work gets a new number.'))}</p>
        <label class="check"><input type="radio" name="rt" value="fix"> <span><b>${esc(tt('Новая версия', 'New version'))}</b> — ${esc(tt('доработка цвета, деталей, качества; сюжет и основная метафора те же. Номер карты сохраняется, прежняя версия уходит в историю', 'refined colour, details or quality; the same subject and core metaphor. The card number is kept, the previous version goes to history'))}</span></label>
        <label class="check"><input type="radio" name="rt" value="new"> <span><b>${esc(tt('Новая карта', 'New card'))}</b> — ${esc(tt('другая работа, изменён сюжет или основная метафора. Новый номер; прежняя карта остаётся в коллекции, пока её не снимут отдельно', 'a different work, or the subject or core metaphor changed. A new number; the previous card stays in the collection unless it is removed separately'))}</span></label></fieldset>` : ''}
      <div id="crit-wrap" hidden><b>${esc(tt('Причины — критерии (обязательно хотя бы один)', 'Reasons — criteria (at least one is required)'))}</b>
        <div class="crit">${q.criteria.map((c) => `<label><input type="checkbox" name="crit" value="${c.number}"><span class="num">${c.number}</span><span>${esc(c.text)}${c.placeholder ? ` <span class="pill demo">${esc(tt('временный текст', 'placeholder'))}</span>` : ''}</span></label>`).join('')}</div></div>
      <label class="field">${esc(tt('Комментарий для автора', 'Comment for the author'))} <span class="hint" id="chint">${esc(tt('по желанию', 'optional'))}</span><textarea name="comment" maxlength="2000"></textarea></label>
      <p class="form-error" id="err" role="alert"></p>
      <p class="small muted" id="dhint" style="margin:0">${esc(tt('Рекомендация уходит администратору: работа появится в галерее после его решения. Возврат и отклонение — сразу, автор увидит причины.', 'A recommendation goes to the administrator: the work appears in the gallery after their decision. Return and decline apply at once; the author sees the reasons.'))}</p>
      <button class="btn yellow" type="submit" id="dsubmit">${esc(tt('Рекомендовать к публикации', 'Recommend for publication'))}</button>
    </form>
    <div class="card-ui flat stack" id="disc"><h3>${esc(tt('Обсуждение с коллегами', 'Discussion with colleagues'))}</h3>
        ${w.status === 'submitted' ? `<p class="small muted" style="margin:0">${esc(tt('Сложную работу можно обсудить с коллегами: ваш вопрос появится в чате кураторов со ссылкой на эту работу.', 'A difficult work can be discussed with colleagues: your question appears in the curators’ chat with a link to this work.'))}</p>
          <div id="dbox"><button class="btn" type="button" id="dopen">${esc(tt('Вынести на обсуждение', 'Bring to discussion'))}</button></div>`
        : `<p class="small" style="margin:0">${tally.map(([v, n]) => `${esc(VOTE[v])}: <b>${n}</b>`).join(' · ')}</p>
          <a class="small" href="${u('/team/curators?work=' + w.id)}">${esc(tt('Открыть обсуждение в чате кураторов →', 'Open the discussion in the curators’ chat →'))}</a>
          <p class="small muted" style="margin:0">${esc(tt('Коллеги открывают работу по ссылке и оставляют голоса и комментарии здесь. Пороги голосования не согласованы: голоса видны всем кураторам, окончательное решение принимает куратор.', 'Colleagues open the work from the link and leave votes and comments here. Voting thresholds are not agreed: votes are visible to all curators; a curator makes the final decision.'))}</p>
          <div class="chips">${['approve', 'return', 'reject'].map((v) => `<button class="chip" type="button" data-vote="${v}">${esc(VOTE[v])}</button>`).join('')}</div>
          <input type="text" id="vcomment" placeholder="${esc(tt('Комментарий к голосу', 'Comment on your vote'))}">`}
    </div>
` : own && ['submitted', 'discussion'].includes(w.status) ? `<div class="notice">${esc(tt('Это ваша работа: её рассматривают другие кураторы.', 'This is your own work: other curators review it.'))}</div>` : `<div class="notice">${esc(tt('Решение по работе уже принято — см. историю.', 'A decision has been made — see the history.'))}${w.card ? ` <a href="${u('/cards/' + w.card.code)}">${esc(w.card.code)}</a>` : ''}</div>`}
    </div></div>
    <h2>${esc(tt('История решений', 'Decision history'))}</h2>
    <div class="list">${w.history.map(historyRow).join('')}</div>
    ${w.targetCardOldVersions && w.targetCardOldVersions.length ? `<h3>${esc(tt('Прежние изображения карты', 'Previous images of the card'))}</h3><div class="cells">${w.targetCardOldVersions.map((v) => `<div class="cell"><div class="tile"><img src="${esc(v.thumb)}" alt=""></div><small>${esc(fmtDate(v.replacedAt))}</small></div>`).join('')}</div>` : ''}
  </div>`;
  const cmp = ctx.main.querySelector('#cmp');
  ctx.main.querySelectorAll('[data-ba]').forEach((b) => b.addEventListener('click', () => {
    cmp.classList.toggle('show-a', b.dataset.ba === 'a'); cmp.classList.toggle('show-b', b.dataset.ba === 'b');
    ctx.main.querySelectorAll('[data-ba]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
  }));
  ctx.main.querySelectorAll('.compare img').forEach((img) => img.addEventListener('click', () => openViewer({ cards: [{ code: '', thumb: img.src, full: img.dataset.full, width: +img.dataset.w, height: +img.dataset.h }], index: 0, mode: 'admin' })));
  const df = ctx.main.querySelector('#df');
  if (!df) return;
  const sync = () => {
    const a = df.action.value;
    df.querySelectorAll('#acts .chip').forEach((c) => c.classList.toggle('on', c.querySelector('input').checked));
    ctx.main.querySelector('#crit-wrap').hidden = a === 'approve';
    const rt = ctx.main.querySelector('#rtype'); if (rt) rt.hidden = a !== 'approve';
    // Кнопка называет выбранное действие; решение применяется только по нажатию, не от смены переключателя.
    const btn = ctx.main.querySelector('#dsubmit');
    btn.textContent = a === 'approve' ? tt('Рекомендовать к публикации', 'Recommend for publication') : a === 'return' ? tt('Вернуть на доработку', 'Return for changes') : tt('Отклонить', 'Decline');
    btn.className = 'btn ' + (a === 'reject' ? 'danger' : 'yellow');
    ctx.main.querySelector('#chint').textContent = a === 'approve' ? tt('по желанию', 'optional') : tt('Достаточно выбрать причины. Комментарий — по желанию.', 'Choosing the reasons is enough. A comment is optional.');
  };
  df.addEventListener('change', sync); sync();
  df.addEventListener('submit', async (e) => {
    e.preventDefault();
    const action = df.action.value;
    const criteria = [...df.querySelectorAll('input[name=crit]:checked')].map((x) => Number(x.value));
    const replacementType = df.rt ? (df.querySelector('input[name=rt]:checked') || {}).value : undefined;
    try {
      const r = await api(`/api/curation/works/${id}/decide`, { method: 'POST', body: { action, criteria, comment: df.comment.value, replacementType } });
      toast(action === 'approve' ? tt('Рекомендовано — работа ушла администратору', 'Recommended — the work went to the administrator') : tt('Решение сохранено, автор увидит причины', 'Decision saved; the author will see the reasons'));
      ctx.rerender();
    } catch (x) { ctx.main.querySelector('#err').textContent = errorText(x); }
  });
  const dopen = ctx.main.querySelector('#dopen');
  if (dopen) dopen.addEventListener('click', () => {
    const box = ctx.main.querySelector('#dbox');
    box.innerHTML = `<label class="field">${esc(tt('Что хотите обсудить с коллегами?', 'What would you like to discuss with colleagues?'))}<textarea id="dq" maxlength="2000" rows="3"></textarea></label>
      <p class="form-error" id="derr" role="alert"></p>
      <div class="row"><button class="btn dark" type="button" id="dsend">${esc(tt('Опубликовать в чате кураторов', 'Post to the curators’ chat'))}</button><button class="linkbtn" type="button" id="dcancel">${esc(tt('Отмена', 'Cancel'))}</button></div>`;
    box.querySelector('#dq').focus();
    box.querySelector('#dcancel').onclick = () => ctx.rerender();
    box.querySelector('#dsend').onclick = async () => {
      const text = box.querySelector('#dq').value.trim();
      if (!text) { box.querySelector('#derr').textContent = tt('Напишите вопрос для коллег.', 'Write a question for your colleagues.'); return; }
      try { await api(`/api/curation/works/${id}/discuss`, { method: 'POST', body: { question: text } }); toast(tt('Вопрос опубликован в чате кураторов', 'Question posted in the curators’ chat')); ctx.rerender(); } catch (x) { box.querySelector('#derr').textContent = errorText(x); }
    };
  });
  ctx.main.querySelectorAll('[data-vote]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/curation/works/${id}/vote`, { method: 'POST', body: { vote: b.dataset.vote, comment: ctx.main.querySelector('#vcomment').value } }); toast(tt('Голос учтён', 'Vote recorded')); ctx.rerender(); } catch (x) { toast(errorText(x)); }
  }));
}
