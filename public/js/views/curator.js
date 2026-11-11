// Кураторы: очередь, проверка работы по критериям, сравнение версий, передача, обсуждение и голоса, история.
import { esc, tt, u, api, errorText, toast, fmtDate } from '../util.js';
import { openViewer } from '../viewer.js';
import { session, hasRole, needLogin, noRole, loading, failed, WORK_STATUS, statusPill, demoPill } from '../ui.js';
import { historyRow } from './artist.js';

export async function queue(ctx) {
  if (!session.user) return needLogin(ctx.main, tt('Раздел кураторов.', 'Curators’ section.'));
  if (!hasRole('curator')) return noRole(ctx.main, tt('куратор', 'curator'));
  loading(ctx.main);
  let d;
  try { d = await api('/api/curation/queue'); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  const tab = ctx.query.get('tab') || 'all';
  const list = tab === 'mine' ? d.queue.filter((w) => w.assignedTo && w.assignedTo.id === d.me)
    : tab === 'discussion' ? d.queue.filter((w) => w.status === 'discussion') : tab === 'recent' ? d.recent : d.queue;
  const placeholders = d.criteria.some((c) => c.placeholder);
  ctx.main.innerHTML = `<section class="hero"><div class="wrap" style="padding-block:30px"><div>
      <p class="eyebrow">${esc(tt('Кураторы', 'Curators'))}</p><h1>${esc(tt('Очередь проверки', 'Review queue'))}</h1>
      <p class="lead">${esc(tt(`В очереди: ${d.queue.length}. Работа не исчезает из очереди без понятного статуса и ответственного.`, `In the queue: ${d.queue.length}. A work never leaves the queue without a clear status and owner.`))}</p>
      <div class="row"><a class="btn light sm" href="${u('/team/curators')}">${esc(tt('Чат кураторов', 'Curators’ chat'))}</a></div></div></div></section>
    <div class="wrap page stack">
      ${placeholders ? `<div class="notice demo">${esc(tt('Критерии пока временные: формулировки будут перенесены из PDF владельца проекта. Номера и механика выбора уже работают.', 'Criteria are placeholders for now: wording will be taken from the owner’s PDF. Numbers and the selection flow already work.'))}</div>` : ''}
      <div class="chips">${[['all', 'Все в очереди', 'All in queue', d.queue.length], ['mine', 'Назначены мне', 'Assigned to me', d.queue.filter((w) => w.assignedTo && w.assignedTo.id === d.me).length], ['discussion', 'На обсуждении', 'In discussion', d.queue.filter((w) => w.status === 'discussion').length], ['recent', 'Недавние решения', 'Recent decisions', d.recent.length]]
        .map(([k, ru, en, n]) => `<a class="chip ${tab === k ? 'on' : ''}" href="${u('/curator?tab=' + k)}">${esc(tt(ru, en))} · ${n}</a>`).join('')}</div>
      ${list.length ? `<div class="list">${list.map((w) => `<a class="work" href="${u('/curator/works/' + w.id)}" style="text-decoration:none;color:inherit">
          <div class="thumb">${w.version ? `<img src="${esc(w.version.thumb)}" alt="" loading="lazy">` : ''}</div>
          <div class="body"><div class="row" style="gap:6px">${statusPill(WORK_STATUS, w.status)}${demoPill(w.isDemo)}${w.kind === 'replacement' ? `<span class="pill">${esc(tt('Новая версия', 'New version'))} ${esc(w.targetCard.code)}</span>` : ''}</div>
            <b>${esc(w.artist)}</b><span class="small muted">${esc(tt('Работа', 'Work'))} №${w.id} · ${esc(tt('версия', 'version'))} ${w.versionsCount} · ${esc(fmtDate(w.updatedAt, { day: 'numeric', month: 'short' }))}</span>
            <span class="small">${esc(tt('Ответственный:', 'Owner:'))} ${esc(w.assignedTo ? w.assignedTo.name : tt('любой куратор', 'any curator'))}</span></div></a>`).join('')}</div>`
        : `<p class="empty">${esc(tt('Здесь пусто.', 'Nothing here.'))}</p>`}
    </div>`;
}

export async function review(ctx, id) {
  if (!session.user) return needLogin(ctx.main, '');
  if (!hasRole('curator')) return noRole(ctx.main, tt('куратор', 'curator'));
  loading(ctx.main);
  let w; let q;
  try { [w, q] = await Promise.all([api(`/api/works/${id}`), api('/api/curation/queue')]); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  const inReview = ['submitted', 'discussion'].includes(w.status);
  const versions = w.versions;
  const cur = versions[versions.length - 1];
  const prev = versions.length > 1 ? versions[versions.length - 2] : null;
  const compareA = w.kind === 'replacement' ? { label: tt(`Сейчас опубликовано (${w.targetCard.code})`, `Currently published (${w.targetCard.code})`), thumb: w.targetCard.thumb, full: w.targetCard.full, width: w.targetCard.width, height: w.targetCard.height }
    : prev ? { label: tt(`Предыдущая версия (${prev.n})`, `Previous version (${prev.n})`), ...prev } : null;
  const tally = ['approve', 'return', 'reject'].map((v) => [v, w.votes.filter((x) => x.vote === v).length]);
  const VOTE = { approve: tt('одобрить', 'approve'), return: tt('вернуть', 'return'), reject: tt('отклонить', 'decline') };
  ctx.main.innerHTML = `<div class="wrap page stack">
    <a href="${u('/curator')}" class="small">← ${esc(tt('Очередь', 'Queue'))}</a>
    <div class="row" style="gap:8px">${statusPill(WORK_STATUS, w.status)}${demoPill(w.isDemo)}${w.kind === 'replacement' ? `<span class="pill navy">${esc(tt('Новая версия опубликованной карты', 'New version of a published card'))}</span>` : ''}</div>
    <h1>${esc(w.artist)} · №${w.id}</h1>
    <p class="muted">${esc(tt('Ответственный:', 'Owner:'))} <b>${esc(w.assignedTo ? w.assignedTo.name : tt('любой куратор', 'any curator'))}</b></p>
    <div class="compare">
      ${compareA ? `<figure><img src="${esc(compareA.thumb)}" data-full="${esc(compareA.full)}" data-w="${compareA.width}" data-h="${compareA.height}" alt=""><figcaption>${esc(compareA.label)}</figcaption></figure>` : ''}
      <figure><img src="${esc(cur.thumb)}" data-full="${esc(cur.full)}" data-w="${cur.width}" data-h="${cur.height}" alt=""><figcaption>${esc(tt(`Новая версия (${cur.n})`, `New version (${cur.n})`))}${cur.note ? ' · ' + esc(cur.note) : ''}</figcaption></figure>
    </div>
    ${inReview ? `<form class="card-ui stack" id="df">
      <h2>${esc(tt('Решение', 'Decision'))}</h2>
      <div class="chips" id="acts">${[['approve', 'Одобрить и опубликовать', 'Approve and publish'], ['return', 'Вернуть на доработку', 'Return for changes'], ['reject', 'Отклонить', 'Decline']].map(([k, ru, en], i) => `<label class="chip ${i === 0 ? 'on' : ''}"><input type="radio" name="action" value="${k}" ${i === 0 ? 'checked' : ''} hidden>${esc(tt(ru, en))}</label>`).join('')}</div>
      ${w.kind === 'replacement' ? `<fieldset class="stack" id="rtype" style="border:0;padding:0;margin:0"><b>${esc(tt('Тип изменения', 'Type of change'))}</b>
        <label class="check"><input type="radio" name="rt" value="fix"> <span><b>${esc(tt('Исправление той же карты', 'Fix of the same card'))}</b> — ${esc(tt('номер и обсуждение сохраняются, прежнее изображение уходит в историю', 'number and discussion are kept, the old image goes to history'))}</span></label>
        <label class="check"><input type="radio" name="rt" value="new"> <span><b>${esc(tt('Существенно новая карта', 'A substantially new card'))}</b> — ${esc(tt('новый номер и своё обсуждение, прежняя карта остаётся', 'new number and its own discussion; the old card stays'))}</span></label></fieldset>` : ''}
      <div id="crit-wrap" hidden><b>${esc(tt('Причины — критерии (обязательно хотя бы один)', 'Reasons — criteria (at least one is required)'))}</b>
        <div class="crit">${q.criteria.map((c) => `<label><input type="checkbox" name="crit" value="${c.number}"><span class="num">${c.number}</span><span>${esc(c.text)}${c.placeholder ? ` <span class="pill demo">${esc(tt('временный текст', 'placeholder'))}</span>` : ''}</span></label>`).join('')}</div></div>
      <label class="field">${esc(tt('Комментарий для художника', 'Comment for the artist'))} <span class="hint">${esc(tt('по желанию', 'optional'))}</span><textarea name="comment" maxlength="2000"></textarea></label>
      <p class="form-error" id="err" role="alert"></p>
      <button class="btn dark" type="submit">${esc(tt('Принять решение', 'Make the decision'))}</button>
    </form>
    <div class="cols-2">
      <div class="card-ui flat stack"><h3>${esc(tt('Передать другому куратору', 'Hand over to another curator'))}</h3>
        <select id="to">${q.curators.filter((c) => c.id !== q.me).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
        <button class="btn" type="button" id="assign">${esc(tt('Передать', 'Hand over'))}</button></div>
      <div class="card-ui flat stack"><h3>${esc(tt('Обсуждение кураторов', 'Curators’ discussion'))}</h3>
        ${w.status === 'submitted' ? `<p class="small muted" style="margin:0">${esc(tt('Сложную работу можно вынести на обсуждение: коллеги оставят голоса и комментарии.', 'A difficult work can be moved to discussion: colleagues leave votes and comments.'))}</p>
          <input type="text" id="dcomment" placeholder="${esc(tt('Что обсудить', 'What to discuss'))}"><button class="btn" type="button" id="discuss">${esc(tt('Вынести на обсуждение', 'Move to discussion'))}</button>`
        : `<p class="small" style="margin:0">${tally.map(([v, n]) => `${esc(VOTE[v])}: <b>${n}</b>`).join(' · ')}</p>
          <p class="small muted" style="margin:0">${esc(tt('Пороги голосования ещё не согласованы: голоса видны всем кураторам, окончательное решение принимает куратор выше.', 'Voting thresholds are not agreed yet: votes are visible to all curators; a curator makes the final decision above.'))}</p>
          <div class="chips">${['approve', 'return', 'reject'].map((v) => `<button class="chip" type="button" data-vote="${v}">${esc(VOTE[v])}</button>`).join('')}</div>
          <input type="text" id="vcomment" placeholder="${esc(tt('Комментарий к голосу', 'Comment on your vote'))}">`}
      </div></div>` : `<div class="notice">${esc(tt('Решение по работе уже принято — см. историю.', 'A decision has been made — see the history.'))}${w.card ? ` <a href="${u('/cards/' + w.card.code)}">${esc(w.card.code)}</a>` : ''}</div>`}
    <h2>${esc(tt('История решений', 'Decision history'))}</h2>
    <div class="list">${w.history.map(historyRow).join('')}</div>
    ${w.targetCardOldVersions && w.targetCardOldVersions.length ? `<h3>${esc(tt('Прежние изображения карты', 'Previous images of the card'))}</h3><div class="cells">${w.targetCardOldVersions.map((v) => `<div class="cell"><div class="tile"><img src="${esc(v.thumb)}" alt=""></div><small>${esc(fmtDate(v.replacedAt))}</small></div>`).join('')}</div>` : ''}
  </div>`;
  ctx.main.querySelectorAll('.compare img').forEach((img) => img.addEventListener('click', () => openViewer({ cards: [{ code: '', thumb: img.src, full: img.dataset.full, width: +img.dataset.w, height: +img.dataset.h }], index: 0, mode: 'admin' })));
  const df = ctx.main.querySelector('#df');
  if (!df) return;
  const sync = () => {
    const a = df.action.value;
    df.querySelectorAll('#acts .chip').forEach((c) => c.classList.toggle('on', c.querySelector('input').checked));
    ctx.main.querySelector('#crit-wrap').hidden = a === 'approve';
    const rt = ctx.main.querySelector('#rtype'); if (rt) rt.hidden = a !== 'approve';
  };
  df.addEventListener('change', sync); sync();
  df.addEventListener('submit', async (e) => {
    e.preventDefault();
    const action = df.action.value;
    const criteria = [...df.querySelectorAll('input[name=crit]:checked')].map((x) => Number(x.value));
    const replacementType = df.rt ? (df.querySelector('input[name=rt]:checked') || {}).value : undefined;
    try {
      const r = await api(`/api/curation/works/${id}/decide`, { method: 'POST', body: { action, criteria, comment: df.comment.value, replacementType } });
      toast(action === 'approve' ? tt(`Опубликовано: ${r.cardCode}`, `Published: ${r.cardCode}`) : tt('Решение сохранено, художник увидит причины', 'Decision saved; the artist will see the reasons'));
      ctx.rerender();
    } catch (x) { ctx.main.querySelector('#err').textContent = errorText(x); }
  });
  const as = ctx.main.querySelector('#assign');
  if (as) as.addEventListener('click', async () => { try { await api(`/api/curation/works/${id}/assign`, { method: 'POST', body: { to: Number(ctx.main.querySelector('#to').value) } }); toast(tt('Передано', 'Handed over')); ctx.rerender(); } catch (x) { toast(errorText(x)); } });
  const ds = ctx.main.querySelector('#discuss');
  if (ds) ds.addEventListener('click', async () => { try { await api(`/api/curation/works/${id}/discuss`, { method: 'POST', body: { comment: ctx.main.querySelector('#dcomment').value } }); toast(tt('Вынесено на обсуждение', 'Moved to discussion')); ctx.rerender(); } catch (x) { toast(errorText(x)); } });
  ctx.main.querySelectorAll('[data-vote]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/curation/works/${id}/vote`, { method: 'POST', body: { vote: b.dataset.vote, comment: ctx.main.querySelector('#vcomment').value } }); toast(tt('Голос учтён', 'Vote recorded')); ctx.rerender(); } catch (x) { toast(errorText(x)); }
  }));
}
