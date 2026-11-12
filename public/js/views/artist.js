// Кабинет художника: подача работ (согласие → файлы), статусы каждой работы, причины решения, исправление в ту же заявку,
// новая версия опубликованной карты, снятие своей карты.
import { esc, tt, u, api, errorText, toast, fmtDate } from '../util.js';
import { openViewer } from '../viewer.js';
import { session, needLogin, loading, failed, WORK_STATUS, statusPill, demoPill, timeline, stepsBar, ic } from '../ui.js';

const critHtml = (c) => `<li><b>${c.number}.</b>${esc(c.text)}${c.placeholder ? ` <span class="pill demo">${esc(tt('временная формулировка', 'placeholder wording'))}</span>` : ''}</li>`;
const reasonsHtml = (d) => (d && d.criteria.length ? `<ul class="reasons">${d.criteria.map(critHtml).join('')}</ul>` : '')
  + (d && d.comment ? `<p class="small" style="margin:6px 0 0">${esc(tt('Комментарий куратора:', 'Curator’s comment:'))} ${esc(d.comment)}</p>` : '');

function workCard(w) {
  const returned = w.status === 'needs_changes';
  return `<div class="work" data-work="${w.id}">
    <a class="thumb" href="${u('/artist/works/' + w.id)}" aria-label="${esc(tt(`Работа №${w.id}`, `Work #${w.id}`))}">${w.version ? `<img src="${esc(w.version.thumb)}" alt="" loading="lazy">` : ''}</a>
    <div class="body"><div class="row" style="gap:6px">${statusPill(WORK_STATUS, w.status)}${demoPill(w.isDemo)}
      ${w.kind === 'replacement' ? `<span class="pill">${esc(tt('Новая версия', 'New version'))} ${esc(w.targetCard ? w.targetCard.code : '')}</span>` : ''}</div>
      <a class="small muted" href="${u('/artist/works/' + w.id)}" style="color:inherit">${esc(tt('Работа', 'Work'))} №${w.id} · ${esc(tt('версий', 'versions'))}: ${w.versionsCount} · ${esc(fmtDate(w.updatedAt, { day: 'numeric', month: 'short' }))} →</a>
      ${w.card ? `<span class="small">${esc(tt('Карта', 'Card'))} <b>${esc(w.card.code)}</b></span>` : ''}
      ${['needs_changes', 'rejected'].includes(w.status) ? `<div class="small"><b>${esc(returned ? tt('Почему возвращена:', 'Why it was returned:') : tt('Причина решения:', 'Reason:'))}</b></div>${reasonsHtml(w.lastResult)}` : ''}
      ${returned ? `<form class="work-fix" data-fix="${w.id}">
        <label class="field small">${esc(tt('Что исправлено (по желанию)', 'What was fixed (optional)'))}<input type="text" name="note" maxlength="300"></label>
        <div class="row"><label class="btn yellow sm">${ic.plus} ${esc(tt('Загрузить исправленную версию', 'Upload corrected version'))}<input type="file" name="image" accept="image/*" hidden></label></div>
      </form>` : ''}</div></div>`;
}

export async function cabinet(ctx) {
  if (!session.user) return needLogin(ctx.main, tt('Кабинет художника доступен после входа по email.', 'Sign in with email to open the artist space.'));
  loading(ctx.main);
  let data;
  try { data = await api('/api/artist/works'); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  const bySub = new Map();
  for (const w of data.works) { if (!bySub.has(w.submissionId)) bySub.set(w.submissionId, []); bySub.get(w.submissionId).push(w); }
  ctx.main.innerHTML = `<section class="hero"><div class="wrap" style="padding-block:30px">
      <div><p class="eyebrow">${esc(tt('Кабинет художника', 'Artist space'))}</p><h1>${esc(session.user.publicName)}</h1>
      <p class="lead">${esc(tt('Каждая работа рассматривается отдельно и получает свой статус. При возврате вы увидите номера и расшифровку критериев.', 'Each work is reviewed separately and gets its own status. If a work is returned, you see the criteria numbers and their text.'))}</p>
      <a class="btn yellow" href="${u('/artist/submit')}">${ic.plus} ${esc(tt('Подать работы', 'Submit works'))}</a></div></div></section>
    <div class="wrap page stack">
      <h2>${esc(tt('Мои работы', 'My works'))}</h2>
      ${data.works.length ? [...bySub.entries()].map(([sid, ws]) => `<div class="stack" style="gap:8px"><p class="small muted" style="margin:6px 0 0">${esc(tt('Отправка', 'Submission'))} №${sid} · ${esc(tt('работ', 'works'))}: ${ws.length}</p>${ws.map(workCard).join('')}</div>`).join('')
        : `<p class="empty">${esc(tt('Вы ещё не подавали работ.', 'You have not submitted any works yet.'))}</p>`}
      <h2 style="margin-top:20px">${esc(tt('Мои опубликованные карты', 'My published cards'))}</h2>
      <div class="list" id="mycards">${data.cards.length ? data.cards.map((c) => `<div class="item">
          <span class="thumb"><img src="${esc(c.thumb)}" alt=""></span>
          <span class="body"><b>${esc(c.code)}</b><span class="small">${c.status === 'published' ? esc(tt('В библиотеке', 'In the library')) : esc(tt('Снята с сайта', 'Removed from the site'))}${c.pendingReplacement ? ' · ' + esc(tt('новая версия на рассмотрении', 'new version in review')) : ''}</span></span>
          ${c.status === 'published' ? `<span class="row" style="gap:6px"><label class="btn sm">${esc(tt('Новая версия', 'New version'))}<input type="file" accept="image/*" data-replace="${esc(c.code)}" hidden></label>
            <button class="btn sm danger" type="button" data-withdraw="${esc(c.code)}">${esc(tt('Убрать', 'Remove'))}</button></span>` : ''}
        </div>`).join('') : `<p class="empty">${esc(tt('Опубликованных карт пока нет.', 'No published cards yet.'))}</p>`}</div>
      <div id="ask"></div>
    </div>`;
  const ask = ctx.main.querySelector('#ask');
  ctx.main.querySelectorAll('[data-fix]').forEach((f) => f.image.addEventListener('change', async () => {
    if (!f.image.files.length) return;
    const fd = new FormData(); fd.append('image', f.image.files[0]); fd.append('note', f.note.value);
    f.querySelector('label.btn').classList.add('busy');
    try { await api(`/api/artist/works/${f.dataset.fix}/versions`, { method: 'POST', form: fd }); toast(tt('Исправленная версия отправлена кураторам', 'Corrected version sent to curators')); ctx.rerender(); }
    catch (x) { toast(errorText(x)); f.querySelector('label.btn').classList.remove('busy'); f.image.value = ''; }
  }));
  ctx.main.querySelector('#mycards').addEventListener('click', (e) => {
    const w = e.target.closest('[data-withdraw]'); if (!w) return;
    const code = w.dataset.withdraw;
    ask.innerHTML = `<div class="notice red stack"><b>${esc(tt(`Убрать карту ${code} с сайта?`, `Remove card ${code} from the site?`))}</b>
      <span>${esc(tt('Она исчезнет из библиотеки и из всех подборок фасилитаторов, обсуждение перестанет быть публичным. Одобрение куратора не нужно. Печатное использование регулируется отдельно.', 'It will disappear from the library and all facilitator selections; its discussion will no longer be public. No curator approval is needed. Print use is governed separately.'))}</span>
      <div class="row"><button class="btn danger" type="button" data-yes>${esc(tt('Да, убрать', 'Yes, remove'))}</button><button class="linkbtn" type="button" data-no>${esc(tt('Отмена', 'Cancel'))}</button></div></div>`;
    ask.scrollIntoView({ behavior: 'smooth', block: 'center' });
    ask.querySelector('[data-no]').onclick = () => { ask.innerHTML = ''; };
    ask.querySelector('[data-yes]').onclick = async () => {
      try { await api(`/api/artist/cards/${code}/withdraw`, { method: 'POST' }); toast(tt('Карта убрана с сайта', 'Card removed')); ctx.rerender(); } catch (x) { toast(errorText(x)); }
    };
  });
  ctx.main.querySelector('#mycards').addEventListener('change', (e) => {
    const inp = e.target.closest('[data-replace]'); if (!inp || !inp.files[0]) return;
    const code = inp.dataset.replace;
    ask.innerHTML = `<div class="notice stack"><b>${esc(tt(`Новая версия карты ${code}`, `New version of card ${code}`))}</b>
      <span>${esc(tt('Опубликованная версия остаётся видна, пока куратор не одобрит замену. Куратор решит: это исправление той же карты (номер и обсуждение сохранятся) или новая карта (новый номер и своё обсуждение).', 'The published version stays visible until a curator approves the replacement. The curator decides: a fix of the same card (number and discussion kept) or a new card (new number and its own discussion).'))}</span>
      <label class="field">${esc(tt('Что изменилось', 'What changed'))}<input type="text" id="rnote" maxlength="300"></label>
      <label class="check"><input type="checkbox" id="rterms"> <span>${esc(tt('Я принимаю условия публикации', 'I accept the publication terms'))} (<a href="${u('/terms')}" target="_blank">${esc(tt('условия', 'terms'))}</a>)</span></label>
      <div class="row"><button class="btn dark" type="button" data-send>${esc(tt('Отправить на рассмотрение', 'Send for review'))}</button><button class="linkbtn" type="button" data-no>${esc(tt('Отмена', 'Cancel'))}</button></div></div>`;
    ask.scrollIntoView({ behavior: 'smooth', block: 'center' });
    ask.querySelector('[data-no]').onclick = () => { ask.innerHTML = ''; inp.value = ''; };
    ask.querySelector('[data-send]').onclick = async () => {
      const fd = new FormData();
      fd.append('image', inp.files[0]); fd.append('note', ask.querySelector('#rnote').value);
      fd.append('termsAccepted', String(ask.querySelector('#rterms').checked)); fd.append('termsVersion', session.config.termsVersion);
      try { const r = await api(`/api/artist/cards/${code}/replace`, { method: 'POST', form: fd }); toast(tt('Новая версия отправлена', 'New version sent')); ctx.navigate('/artist/works/' + r.id); } catch (x) { toast(errorText(x)); }
    };
  });
}

export function submit(ctx) {
  if (!session.user) return needLogin(ctx.main, tt('Чтобы подать работы, войдите по email: имя и email, без пароля.', 'To submit works, sign in with email: name and email, no password.'));
  let step = 1; let files = []; let accepted = false;
  const draw = () => {
    ctx.main.innerHTML = `<div class="wrap page narrow stack"><div class="card-ui ${step === 3 ? 'navy' : ''} stack">
      <div class="row between"><a href="${u('/artist')}" class="small">← ${esc(tt('Кабинет', 'Back'))}</a><span class="small muted">${esc(tt(`Шаг ${step} из 3`, `Step ${step} of 3`))}</span></div>
      ${stepsBar(step, 3)}
      ${step === 1 ? `<h1>${esc(tt('Условия публикации', 'Publication terms'))}</h1>
        <p>${esc(tt('Публикация добровольная. Прочитайте короткое условие и отметьте галочку.', 'Publishing is voluntary. Read the short condition and tick the box.'))}</p>
        <label class="check card-ui flat"><input type="checkbox" id="terms" ${accepted ? 'checked' : ''}>
          <span>${esc(tt('Я принимаю условия публикации и разрешаю бесплатно показывать эту работу в библиотеке Dialogue Cards и в подборках для встреч Dialogue Flow. Использование работы в печатной колоде согласуется со мной отдельно.', 'I accept the publication terms and allow this work to be shown free of charge in the Dialogue Cards library and in selections for Dialogue Flow meetings. Use of the work in a printed deck will be agreed with me separately.'))}
          <a href="${u('/terms')}" target="_blank">${esc(tt('Полные условия', 'Full terms'))}</a> <span class="pill demo">${esc(tt('черновик текста', 'draft text'))}</span></span></label>
        <button class="btn dark" type="button" id="next" ${accepted ? '' : 'disabled'}>${esc(tt('Дальше', 'Next'))}</button>`
      : step === 2 ? `<h1>${esc(tt('Ваши работы', 'Your works'))}</h1>
        <p>${esc(tt('Можно добавить одно или несколько изображений (JPG, PNG, WebP, TIFF). Каждая работа получит свой статус и решение; код карты присваивается автоматически при публикации.', 'Add one or more images (JPG, PNG, WebP, TIFF). Each work gets its own status and decision; the card code is assigned automatically on publication.'))}</p>
        <input type="file" id="files" accept="image/jpeg,image/png,image/webp,image/tiff" multiple>
        <div class="cells" id="prev">${files.map((f, i) => `<div class="cell"><div class="tile" style="cursor:default"><img src="${URL.createObjectURL(f)}" alt=""></div><small>${esc(f.name)}</small><button class="mini-btn r" type="button" data-rm="${i}">${ic.x}</button></div>`).join('')}</div>
        <p class="small muted" style="margin:0">${esc(tt('Автор в карточке:', 'Artist name on cards:'))} <b>${esc(session.user.publicName)}</b> (${esc(tt('меняется в профиле', 'change it in your profile'))})</p>
        <p class="form-error" id="err" role="alert"></p>
        <div class="row"><button class="btn" type="button" id="back">${esc(tt('Назад', 'Back'))}</button><button class="btn dark" type="button" id="send" ${files.length ? '' : 'disabled'}>${esc(tt(`Отправить на рассмотрение (${files.length})`, `Send for review (${files.length})`))}</button></div>`
      : `<h1 style="color:var(--on-navy)">${esc(tt('Работы на рассмотрении', 'Works in review'))}</h1>
        ${timeline([
          { title: tt('Отправка получена', 'Submission received'), note: esc(tt('Согласие с условиями записано', 'Consent recorded')), state: 'done' },
          { title: tt('Проверка кураторами', 'Curators’ review'), note: esc(tt('Каждая работа отдельно, по критериям', 'Each work separately, by criteria')), state: 'now' },
          { title: tt('Решение', 'Decision'), note: esc(tt('Опубликовано — или причины и возможность исправить', 'Published — or reasons and a chance to fix')), state: 'todo' },
        ])}
        <a class="btn yellow" href="${u('/artist')}">${esc(tt('К моим работам', 'To my works'))}</a>`}
    </div></div>`;
    const t = ctx.main.querySelector('#terms');
    if (t) { t.onchange = () => { accepted = t.checked; ctx.main.querySelector('#next').disabled = !accepted; }; ctx.main.querySelector('#next').onclick = () => { step = 2; draw(); }; }
    const fi = ctx.main.querySelector('#files');
    if (fi) {
      fi.onchange = () => { files = files.concat([...fi.files]).slice(0, 20); draw(); };
      ctx.main.querySelector('#prev').onclick = (e) => { const r = e.target.closest('[data-rm]'); if (r) { files.splice(Number(r.dataset.rm), 1); draw(); } };
      ctx.main.querySelector('#back').onclick = () => { step = 1; draw(); };
      ctx.main.querySelector('#send').onclick = async (e) => {
        e.target.disabled = true; e.target.textContent = tt('Отправка…', 'Sending…');
        const fd = new FormData();
        for (const f of files) fd.append('images', f);
        fd.append('termsAccepted', String(accepted)); fd.append('termsVersion', session.config.termsVersion);
        try { await api('/api/artist/works', { method: 'POST', form: fd }); step = 3; files = []; draw(); }
        catch (x) { ctx.main.querySelector('#err').textContent = errorText(x); e.target.disabled = false; }
      };
    }
  };
  draw();
}

export async function work(ctx, id) {
  if (!session.user) return needLogin(ctx.main, '');
  loading(ctx.main);
  let w;
  try { w = await api(`/api/works/${id}`); } catch (e) {
    if (!ctx.alive()) return;
    if (e.status === 404) { ctx.main.innerHTML = `<div class="wrap page narrow"><p class="empty">${esc(tt('Работа не найдена.', 'Work not found.'))}</p></div>`; return; }
    return failed(ctx.main, e, ctx.rerender);
  }
  if (!ctx.alive()) return;
  const r = w.lastResult;
  const steps = [
    { title: tt('Отправлено', 'Sent'), note: esc(fmtDate(w.createdAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })), state: 'done' },
    { title: w.status === 'discussion' ? tt('На обсуждении кураторов', 'Curators are discussing') : tt('Проверка куратором', 'Curator review'),
      note: w.assignedTo ? esc(tt('Ответственный:', 'Assigned to:') + ' ' + w.assignedTo.name) : '', state: ['submitted', 'discussion'].includes(w.status) ? 'now' : 'done' },
    { title: w.status === 'published' ? tt('Опубликовано', 'Published') : w.status === 'needs_changes' ? tt('Возвращено на доработку', 'Returned for changes') : w.status === 'rejected' ? tt('Отклонено', 'Declined') : tt('Решение', 'Decision'),
      note: w.status === 'published' && w.card ? `${esc(tt('Карта', 'Card'))} <a href="${u('/cards/' + w.card.code)}">${esc(w.card.code)}</a>` : '',
      state: w.status === 'published' ? 'done' : ['needs_changes', 'rejected'].includes(w.status) ? 'bad' : 'todo' },
  ];
  ctx.main.innerHTML = `<div class="wrap page stack">
    <a href="${u('/artist')}" class="small">← ${esc(tt('Мои работы', 'My works'))}</a>
    <div class="row" style="gap:8px">${statusPill(WORK_STATUS, w.status)}${demoPill(w.isDemo)}${w.kind === 'replacement' ? `<span class="pill">${esc(tt('Новая версия карты', 'New version of card'))} ${esc(w.targetCard.code)}</span>` : ''}</div>
    <h1>${esc(tt('Работа', 'Work'))} №${w.id}</h1>
    <div class="cols-2">
      <div class="card-ui stack">${timeline(steps)}
        ${['needs_changes', 'rejected'].includes(w.status) && r ? `<div><b>${esc(tt('Причины решения', 'Reasons'))}</b>${reasonsHtml(r)}</div>` : ''}
        ${['needs_changes', 'submitted'].includes(w.status) && w.artistId === session.user.id ? `<form class="form" id="vf"><b>${esc(w.status === 'needs_changes' ? tt('Отправить исправление в ту же заявку', 'Send a fix in the same submission') : tt('Заменить файл до решения', 'Replace the file before the decision'))}</b>
          <input type="file" name="image" accept="image/*" required><label class="field">${esc(tt('Что исправлено', 'What was fixed'))}<input type="text" name="note" maxlength="300"></label>
          <button class="btn dark" type="submit">${esc(tt('Отправить новую версию', 'Send new version'))}</button></form>` : ''}
      </div>
      <div class="stack"><h3>${esc(tt('Версии', 'Versions'))}</h3><div class="compare">${w.versions.slice().reverse().map((v) => `<figure><img src="${esc(v.thumb)}" data-full="${esc(v.full)}" data-w="${v.width}" data-h="${v.height}" alt=""><figcaption>${esc(tt('Версия', 'Version'))} ${v.n}${v.note ? ' · ' + esc(v.note) : ''}</figcaption></figure>`).join('')}</div></div>
    </div>
    <h3>${esc(tt('История', 'History'))}</h3>
    <div class="list">${w.history.map((h) => historyRow(h)).join('')}</div>
  </div>`;
  ctx.main.querySelectorAll('.compare img').forEach((img) => img.addEventListener('click', () => openViewer({ cards: [{ code: '', thumb: img.src, full: img.dataset.full, width: +img.dataset.w, height: +img.dataset.h }], index: 0, mode: 'admin' })));
  const vf = ctx.main.querySelector('#vf');
  if (vf) vf.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api(`/api/artist/works/${id}/versions`, { method: 'POST', form: new FormData(vf) }); toast(tt('Новая версия отправлена', 'New version sent')); ctx.rerender(); } catch (x) { toast(errorText(x)); }
  });
}

export const ACTION_LABEL = {
  submitted: ['Отправлено', 'Submitted'], resubmitted: ['Отправлена новая версия', 'New version sent'], approve: ['Одобрено', 'Approved'],
  return: ['Возвращено на доработку', 'Returned for changes'], reject: ['Отклонено', 'Declined'], assign: ['Передано куратору', 'Assigned to curator'],
  discuss: ['Вынесено на обсуждение', 'Moved to discussion'], vote: ['Голос куратора', 'Curator vote'],
};
export function historyRow(h) {
  const [ru, en] = ACTION_LABEL[h.action] || [h.action, h.action];
  const rt = h.replacementType === 'fix' ? tt(' · исправление той же карты', ' · fix of the same card') : h.replacementType === 'new' ? tt(' · новая карта', ' · new card') : '';
  return `<div class="item" style="align-items:flex-start"><span class="body"><b>${esc(tt(ru, en))}${esc(rt)}</b>
    <span class="small">${esc(h.actor)} · ${esc(tt('версия', 'version'))} ${h.versionN} · ${esc(fmtDate(h.createdAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}${h.toUser ? ' → ' + esc(h.toUser) : ''}</span>
    ${h.criteria.length ? `<ul class="reasons">${h.criteria.map(critHtml).join('')}</ul>` : ''}
    ${h.comment ? `<span class="small">${esc(h.comment)}</span>` : ''}</span></div>`;
}
