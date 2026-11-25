// Кабинет автора: подача работ (согласие → файлы), статусы каждой работы, причины решения, исправление в ту же заявку,
// новая версия опубликованной карты, снятие своей карты.
import { lang } from '../i18n.js';
import { esc, tt, u, api, upload, errorText, toast, fmtDate } from '../util.js';
import { openViewer } from '../viewer.js';
import { session, needLogin, loading, failed, WORK_STATUS, statusPill, demoPill, timeline, stepsBar, ic, hasRole } from '../ui.js';
import { loadTerms, resetTermsCache, stepHtml, miniHtml, openFull, accept, fullHtml } from '../author-terms.js';

const critHtml = (c) => `<li><b>${c.number}.</b>${esc(c.text)}${c.placeholder ? ` <span class="pill demo">${esc(tt('временная формулировка', 'placeholder wording'))}</span>` : ''}</li>`;
const reasonsHtml = (d) => (d && d.criteria.length ? `<ul class="reasons">${d.criteria.map(critHtml).join('')}</ul>` : '')
  + (d && d.comment ? `<p class="small" style="margin:6px 0 0">${esc(tt('Комментарий куратора:', 'Curator’s comment:'))} ${esc(d.comment)}</p>` : '');

let termsEd = null; // действующая редакция соглашения (если включена) — для форм новой версии и исправления
function workCard(w) {
  const returned = w.status === 'needs_changes';
  const canWithdraw = ['submitted', 'discussion', 'needs_changes', 'recommended'].includes(w.status);
  return `<div class="work" data-work="${w.id}">
    <a class="thumb" href="${u('/artist/works/' + w.id)}" aria-label="${esc(tt(`Работа №${w.id}`, `Work #${w.id}`))}">${w.version && w.version.thumb ? `<img src="${esc(w.version.thumb)}" alt="" loading="lazy">` : ''}</a>
    <div class="body"><div class="row" style="gap:6px">${statusPill(WORK_STATUS, w.status)}${demoPill(w.isDemo)}
      ${w.kind === 'replacement' ? `<span class="pill">${esc(tt('Новая версия', 'New version'))} ${esc(w.targetCard ? w.targetCard.code : '')}</span>` : ''}</div>
      <a class="small muted" href="${u('/artist/works/' + w.id)}" style="color:inherit">${esc(tt('Работа', 'Work'))} №${w.id} · ${esc(tt('версий', 'versions'))}: ${w.versionsCount} · ${esc(fmtDate(w.updatedAt, { day: 'numeric', month: 'short' }))} →</a>
      ${w.card ? `<span class="small">${esc(tt('Карта', 'Card'))} <b>${esc(w.card.code)}</b></span>` : ''}
      ${['needs_changes', 'rejected'].includes(w.status) ? `<div class="small"><b>${esc(returned ? tt('Почему возвращена:', 'Why it was returned:') : tt('Причина решения:', 'Reason:'))}</b></div>${reasonsHtml(w.lastResult)}` : ''}
      ${returned ? `<form class="work-fix" data-fix="${w.id}">
        <label class="field small">${esc(tt('Что исправлено (по желанию)', 'What was fixed (optional)'))}<input type="text" name="note" maxlength="300"></label>
        ${termsEd ? miniHtml(termsEd, `fixterms-${w.id}`) : ''}
        <div class="row"><label class="btn yellow sm">${ic.plus} ${esc(tt('Загрузить новую версию', 'Upload a new version'))}<input type="file" name="image" accept="image/jpeg,image/png" hidden></label></div>
      </form>` : ''}
      ${canWithdraw ? `<button class="linkbtn small" type="button" data-wwithdraw="${w.id}" style="justify-self:start">${esc(tt('Снять с рассмотрения', 'Withdraw from review'))}</button>` : ''}</div></div>`;
}

export async function cabinet(ctx) {
  if (!session.user) return needLogin(ctx.main, tt('Кабинет автора доступен после входа по email.', 'Sign in with email to open the author space.'));
  loading(ctx.main);
  let data; let consents = [];
  try {
    data = await api('/api/artist/works');
    termsEd = session.config.authorTerms && session.config.authorTerms.active ? (await loadTerms()).edition : null;
    consents = (await api('/api/artist/consents')).consents;
  } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  // Порядок по полезности: «Нужно доработать» → «На рассмотрении» (и на обсуждении) → «В галерее» (карточки карт); отклонённые — ниже, свёрнуто.
  // Одобренные работы показываются как опубликованные карты, без повторного списка.
  const need = data.works.filter((w) => w.status === 'needs_changes');
  const review = data.works.filter((w) => ['submitted', 'discussion', 'recommended'].includes(w.status));
  const other = data.works.filter((w) => !['needs_changes', 'submitted', 'discussion', 'recommended', 'approved'].includes(w.status));
  const showAll = ctx.query.get('all') === '1';
  const group = (title, list, open = true) => (list.length ? `<section class="stack" style="gap:8px"><h2 style="margin:10px 0 0">${esc(title)} <span class="muted" style="font-size:1rem">· ${list.length}</span></h2>${list.map(workCard).join('')}</section>` : '');
  ctx.main.innerHTML = `<div class="wrap page stack">
    <div class="page-head"><h1>${esc(tt('Мои работы', 'My works'))}</h1><p class="sub">${esc(session.user.publicName)} · ${esc(tt('кабинет автора', 'author space'))}</p></div>
    <div class="row"><a class="btn yellow" href="${u('/artist/submit')}">${ic.plus} ${esc(tt('Предложить иллюстрацию', 'Suggest an illustration'))}</a>
      <span class="small muted" style="max-width:34em">${esc(tt('При возврате на доработку вы увидите причину.', 'If a work is returned for changes, you will see the reason.'))}</span></div>
    <span id="works"></span>
    ${!data.works.length && !data.cards.length ? `<p class="empty">${esc(tt('Вы ещё не предлагали иллюстраций.', 'You have not suggested any illustrations yet.'))}</p>` : ''}
    ${group(tt('Нужно доработать', 'Needs changes'), need)}
    ${group(tt('На рассмотрении', 'Under review'), review)}
      ${data.cards.length ? `<h2 style="margin:10px 0 0">${esc(tt('В галерее', 'In the gallery'))} <span class="muted" style="font-size:1rem">· ${data.cards.filter((c) => c.status === 'published').length}</span></h2>` : ''}
      <div class="my-cards" id="mycards">${data.cards.length ? data.cards.map((c) => `<article class="my-card" data-card="${esc(c.code)}">
          <div class="mc-head"><b>${esc(c.code)}</b> · <span>${c.status === 'published' ? esc(tt('В галерее', 'In the gallery')) : esc(tt('Снята с сайта', 'Removed from the site'))}</span>${c.pendingReplacement ? `<span class="small muted"> · ${esc(tt('новая версия на рассмотрении', 'new version in review'))}</span>` : ''}</div>
          <div class="mc-img"><img src="${esc(c.thumb)}" alt="${esc(c.code)}" loading="lazy"></div>
          ${c.status === 'published' ? `<p class="small muted" style="margin:0">${esc(tt('Выбрали для разговора', 'Chosen for a conversation'))}: <b>${c.selectedCount || 0}</b></p>` : ''}
          ${c.status === 'published' ? `<div class="mc-actions"><label class="btn sm">${esc(tt('Новая версия', 'New version'))}<input type="file" accept="image/jpeg,image/png" data-replace="${esc(c.code)}" hidden></label>
            <button class="linkbtn mc-remove" type="button" data-withdraw="${esc(c.code)}">${esc(tt('Убрать', 'Remove'))}</button></div>` : ''}
          ${c.status === 'published' && (c.oldVersions || []).length ? `<div class="mc-vers small"><span class="muted">${esc(tt(`Сейчас в галерее: ${c.version}. Прежние версии:`, `In the gallery now: ${c.version}. Earlier versions:`))}</span>
            ${c.oldVersions.map((v) => (v.revoked ? `<span class="muted">${esc(v.label)} — ${esc(tt('разрешение отозвано', 'permission withdrawn'))}</span>` : `<button class="linkbtn small" type="button" data-revoke="${esc(c.code)}" data-vid="${v.id}" data-vl="${esc(v.label)}">${esc(tt(`Отозвать разрешение на ${v.label}`, `Withdraw permission for ${v.label}`))}</button>`)).join(' ')}</div>` : ''}
          <div class="mc-ask"></div>
        </article>`).join('') : ''}</div>
      ${consents.length ? `<section class="stack" style="gap:6px"><h2 style="margin:14px 0 0">${esc(tt('Мои согласия с условиями', 'My consents to the terms'))}</h2>
        <ul class="at-consents">${consents.map((x) => `<li><a href="${u('/terms/authors/' + x.editionId)}">${esc(tt(`Редакция ${x.version}`, `Version ${x.version}`))}</a> · ${esc(fmtDate(x.acceptedAt, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}${x.workId ? ` · ${esc(tt('работа', 'work'))} №${x.workId}` : ''}</li>`).join('')}</ul></section>` : ''}
      ${showAll ? group(tt('Отклонённые и снятые', 'Declined and withdrawn'), other) : other.length ? `<p class="small" style="margin:6px 0 0"><a href="${u('/artist?all=1')}">${esc(tt('Показать все работы, включая отклонённые', 'Show all works, including declined'))}</a></p>` : ''}
      <div id="ask"></div>
    </div>`;
  const ask = ctx.main.querySelector('#ask');
  // полный текст соглашения, снятие работы с рассмотрения, отзыв разрешения на прежнюю версию карты
  ctx.main.addEventListener('click', async (e) => {
    if (e.target.closest('[data-full]') && termsEd) { openFull(termsEd); return; }
    const ww = e.target.closest('[data-wwithdraw]');
    if (ww) {
      if (!confirm(tt('Снять работу с рассмотрения? Кураторы перестанут её видеть, изображение будет удалено.', 'Withdraw the work from review? Curators will no longer see it and the image will be deleted.'))) return;
      try { await api(`/api/artist/works/${ww.dataset.wwithdraw}/withdraw`, { method: 'POST' }); toast(tt('Работа снята с рассмотрения', 'The work was withdrawn from review')); ctx.rerender(); } catch (x) { toast(errorText(x)); }
      return;
    }
    const rv = e.target.closest('[data-revoke]');
    if (rv) {
      if (!confirm(tt(`Отозвать разрешение на версию ${rv.dataset.vl} карты ${rv.dataset.revoke}? Эта версия больше не будет использоваться, её файлы будут удалены, фасилитаторы получат уведомление. Текущая версия остаётся в галерее.`, `Withdraw permission for version ${rv.dataset.vl} of card ${rv.dataset.revoke}? This version will no longer be used, its files will be deleted and facilitators will be notified. The current version stays in the gallery.`))) return;
      try { await api(`/api/artist/cards/${rv.dataset.revoke}/versions/${rv.dataset.vid}/revoke`, { method: 'POST' }); toast(tt('Разрешение на прежнюю версию отозвано', 'Permission for the earlier version withdrawn')); ctx.rerender(); } catch (x) { toast(errorText(x)); }
    }
  });
  ctx.main.querySelectorAll('[data-fix]').forEach((f) => f.image.addEventListener('change', async () => {
    if (!f.image.files.length) return;
    const fd = new FormData(); fd.append('image', f.image.files[0]); fd.append('note', f.note.value);
    if (termsEd) {
      const cb = f.querySelector(`#fixterms-${f.dataset.fix}`);
      if (!cb.checked) { toast(termsEd.short.check); f.image.value = ''; cb.focus(); return; }
      try { fd.append('consentId', String(await accept(termsEd.id, 'resubmit', 'work:' + f.dataset.fix))); } catch (x) { toast(errorText(x)); return; }
    }
    f.querySelector('label.btn').classList.add('busy');
    try { await api(`/api/artist/works/${f.dataset.fix}/versions`, { method: 'POST', form: fd }); toast(tt('Исправленная версия отправлена кураторам', 'Corrected version sent to curators')); ctx.rerender(); }
    catch (x) { toast(errorText(x)); f.querySelector('label.btn').classList.remove('busy'); f.image.value = ''; }
  }));
  ctx.main.querySelector('#mycards').addEventListener('click', (e) => {
    const w = e.target.closest('[data-withdraw]'); if (!w) return;
    const code = w.dataset.withdraw; // номер — именно той карты, на которой нажали
    const slot = w.closest('.my-card').querySelector('.mc-ask');
    ctx.main.querySelectorAll('.mc-ask').forEach((x) => { if (x !== slot) x.innerHTML = ''; });
    slot.innerHTML = `<div class="notice red stack"><b>${esc(tt(`Убрать карту ${code} с сайта?`, `Remove card ${code} from the site?`))}</b>
      <span>${esc(tt('Вы отзываете разрешение на её использование. Карта сразу исчезнет из галереи, игр и подборок, её файлы будут удалены с сайта. Фасилитаторы получат уведомление с номером карты — без вашего имени и без изображения. Копии, ранее сохранённые или распечатанные другими людьми, могут остаться у них.', 'You withdraw permission to use it. The card will disappear from the gallery, games and collections at once, and its files will be deleted from the site. Facilitators will get a notice with the card number — without your name or the image. Copies saved or printed earlier by other people may remain with them.'))}</span>
      <div class="row"><button class="btn danger" type="button" data-yes>${esc(tt('Да, убрать', 'Yes, remove'))}</button><button class="linkbtn" type="button" data-no>${esc(tt('Отмена', 'Cancel'))}</button></div></div>`;
    slot.scrollIntoView({ behavior: 'smooth', block: 'center' });
    slot.querySelector('[data-no]').onclick = () => { slot.innerHTML = ''; };
    slot.querySelector('[data-yes]').onclick = async () => {
      try { await api(`/api/artist/cards/${code}/withdraw`, { method: 'POST' }); toast(tt('Карта убрана с сайта', 'Card removed')); ctx.rerender(); } catch (x) { toast(errorText(x)); }
    };
  });
  ctx.main.querySelector('#mycards').addEventListener('change', (e) => {
    const inp = e.target.closest('[data-replace]'); if (!inp || !inp.files[0]) return;
    const code = inp.dataset.replace;
    ask.innerHTML = `<div class="notice stack"><b>${esc(tt(`Новая версия карты ${code}`, `New version of card ${code}`))}</b>
      <span>${esc(tt('Опубликованная версия остаётся видна, пока куратор не одобрит замену. Куратор решит: это исправление той же карты (номер и обсуждение сохранятся) или новая карта (новый номер и своё обсуждение).', 'The published version stays visible until a curator approves the replacement. The curator decides: a fix of the same card (number and discussion kept) or a new card (new number and its own discussion).'))}</span>
      <label class="field">${esc(tt('Что изменилось', 'What changed'))}<input type="text" id="rnote" maxlength="300"></label>
      ${termsEd ? miniHtml(termsEd, 'rterms') : `<label class="check"><input type="checkbox" id="rterms"> <span>${esc(tt('Я принимаю условия публикации', 'I accept the publication terms'))} (<a href="${u('/terms')}" target="_blank">${esc(tt('условия', 'terms'))}</a>)</span></label>`}
      <div class="row"><button class="btn dark" type="button" data-send>${esc(tt('Отправить на рассмотрение', 'Send for review'))}</button><button class="linkbtn" type="button" data-no>${esc(tt('Отмена', 'Cancel'))}</button></div></div>`;
    ask.scrollIntoView({ behavior: 'smooth', block: 'center' });
    ask.querySelector('[data-no]').onclick = () => { ask.innerHTML = ''; inp.value = ''; };
    ask.querySelector('[data-send]').onclick = async () => {
      const fd = new FormData();
      fd.append('image', inp.files[0]); fd.append('note', ask.querySelector('#rnote').value);
      fd.append('termsAccepted', String(ask.querySelector('#rterms').checked)); fd.append('termsVersion', session.config.termsVersion);
      if (termsEd) {
        if (!ask.querySelector('#rterms').checked) { toast(termsEd.short.check); return; }
        try { fd.append('consentId', String(await accept(termsEd.id, 'replacement', code))); } catch (x) { toast(errorText(x)); return; }
      }
      try { const r = await api(`/api/artist/cards/${code}/replace`, { method: 'POST', form: fd }); toast(tt('Новая версия отправлена', 'New version sent')); ctx.navigate('/artist/works/' + r.id); } catch (x) { toast(errorText(x)); }
    };
  });
}

// Подача работы — 4 шага (17.11.2026): условия использования → руководство для автора → изображения → отправка.
// Руководства автора владелец пришлёт позже: здесь — явная временная заглушка (содержание не придумываем).
// Отправка показывает ход загрузки и обработку; при сбое файлы остаются, «Повторить» безопасен — у отправки свой ключ,
// и повтор не создаёт вторую подачу.
const TERMS_KEY = 'dc_terms_ok';
export async function submit(ctx) {
  if (!session.user) return needLogin(ctx.main, tt('Чтобы подать работы, войдите по email: имя и email, без пароля.', 'To submit works, sign in with email: name and email, no password.'));
  let step = 1; let files = []; let guideOk = false; let result = null;
  let accepted = false; try { accepted = localStorage.getItem(TERMS_KEY) === session.config.termsVersion; } catch { /* */ }
  // Новая редакция соглашения (25.11.2026): включается только после публикации администрацией. Администрация видит
  // предпросмотр по ?terms=preview — согласие в предпросмотре не записывается.
  const newTerms = !!(session.config.authorTerms && session.config.authorTerms.active);
  const preview = !newTerms && ctx.query.get('terms') === 'preview' && hasRole('admin');
  let ed = null; let consentId = null; let checked = false; let termsMsg = '';
  if (newTerms || preview) {
    try {
      if (newTerms) ed = (await loadTerms()).edition;
      else { const d = (await api('/api/admin/terms')).drafts; ed = d.find((x) => x.lang === 'ru'); }
    } catch (e) { return failed(ctx.main, e, ctx.rerender); }
    if (!ctx.alive()) return;
  }
  const send = { state: 'idle', progress: 0, error: '', key: null }; // idle | uploading | processing | error
  let gAssets = null; api('/api/guides/artist/assets').then((x) => { gAssets = x; if (step === 2 && !result) draw(); }).catch(() => {});
  const TITLES = [ed ? ed.short.title : tt('Условия использования работы', 'Terms of use of the work'), tt('Руководство для автора', 'Guide for the author'), tt('Загрузите изображение', 'Upload the image'), tt('Отправка', 'Sending')];
  const urls = new Map(); const urlOf = (f) => { if (!urls.has(f)) urls.set(f, URL.createObjectURL(f)); return urls.get(f); };
  const head = () => `<div class="row between"><a href="${u('/artist')}" class="small">← ${esc(tt('Кабинет', 'Back'))}</a><span class="small muted">${esc(tt(`Шаг ${step} из 4`, `Step ${step} of 4`))}</span></div>${stepsBar(step, 4)}<h1>${esc(TITLES[step - 1])}</h1>`;
  const thumbs = (rm) => `<div class="cells" id="prev">${files.map((f, i) => `<div class="cell"><div class="tile" style="cursor:default"><img src="${urlOf(f)}" alt=""></div><small>${esc(f.name)}</small>${rm ? `<button class="mini-btn r" type="button" data-rm="${i}" aria-label="${esc(tt('Убрать', 'Remove'))} ${esc(f.name)}">${ic.x}</button>` : ''}</div>`).join('')}</div>`;
  const draw = () => {
    let body;
    if (result) {
      const many = result.ids.length > 1;
      body = `<h1 style="color:var(--on-navy)">${esc(many ? tt('Изображения отправлены', 'Images sent') : tt('Изображение отправлено', 'Image sent'))}</h1>
        ${result.failed && result.failed.length ? `<div class="notice small">${esc(tt('Не удалось принять:', 'Could not be accepted:'))} ${esc(result.failed.join(', '))}</div>` : ''}
        ${timeline([
          { title: tt('Согласие с условиями записано', 'Consent to the terms recorded'), state: 'done' },
          { title: tt('Проверка кураторами', 'Curators’ review'), note: tt('Каждая работа рассматривается отдельно по критериям', 'Each work is reviewed separately by criteria'), state: 'now' },
          { title: tt('Решение', 'Decision'), note: tt('Возможны три исхода: работа опубликована; отклонена с указанием причины; возвращена на доработку с указанием причины.', 'Three outcomes are possible: the work is published; declined with a reason; returned for changes with a reason.'), state: 'todo' },
        ])}
        <p class="small" style="margin:0;color:var(--on-navy)">${esc(tt('Статус каждой работы виден в «Моих работах». Если включены уведомления, о решении придёт сообщение на телефон.', 'The status of each work is shown in “My works”. If notifications are on, you will get a message on your phone about the decision.'))}</p>
        <div class="row"><a class="btn yellow" href="${u('/artist')}">${esc(tt('В кабинет', 'To my space'))}</a><a class="btn light" href="${u('/artist#works')}">${esc(tt('Мои работы', 'My works'))}</a></div>`;
    } else if (step === 1 && ed) {
      // шаг 1 по новой редакции: тексты — дословно с сервера; галочка не отмечена; кнопка — после галочки
      body = `<div class="row between"><a href="${u('/artist')}" class="small">← ${esc(tt('Кабинет', 'Back'))}</a><span class="small muted">${esc(tt(`Шаг ${step} из 4`, `Step ${step} of 4`))}</span></div>${stepsBar(step, 4)}
        ${preview ? `<p class="notice demo small">${esc(tt('Предпросмотр для администрации: новая редакция ещё не включена в приём работ, согласие здесь не записывается.', 'Administration preview: the new version is not yet enabled for submissions; consent is not recorded here.'))}</p>` : ''}
        <div class="at-step">${stepHtml(ed, { checked })}</div>
        ${termsMsg ? `<p class="form-error" role="alert">${esc(termsMsg)}</p>` : ''}
        <div><button class="btn yellow" type="button" id="tnext" ${checked ? '' : 'disabled'}>${esc(ed.short.cta)}</button></div>`;
    } else if (step === 1) {
      body = `${head()}
        <p>${esc(tt('Публикация добровольная. Прочитайте короткое условие и отметьте галочку — согласие запомнится для следующих подач.', 'Publishing is voluntary. Read the short condition and tick the box — your consent is remembered for next submissions.'))}</p>
        <label class="check card-ui flat"><input type="checkbox" id="terms" ${accepted ? 'checked' : ''}>
          <span>${esc(tt('Я принимаю условия публикации и разрешаю бесплатно показывать эту работу в галерее Dialogue Cards и в подборках для встреч Dialogue Flow. Использование работы в печатной колоде согласуется со мной отдельно.', 'I accept the publication terms and allow this work to be shown free of charge in the Dialogue Cards gallery and in selections for Dialogue Flow meetings. Use of the work in a printed deck will be agreed with me separately.'))}
          <a href="${u('/terms')}" target="_blank">${esc(tt('Полные условия', 'Full terms'))}</a> <span class="pill demo">${esc(tt('черновик текста', 'draft text'))}</span></span></label>
        <div><button class="btn yellow" type="button" id="next" ${accepted ? '' : 'disabled'}>${esc(tt('Дальше', 'Next'))}</button></div>`;
    } else if (step === 2) {
      body = `${head()}
        <section class="card-ui flat stack" aria-labelledby="g-short"><h2 id="g-short" style="margin:0">${esc(tt('Краткое руководство', 'Short guide'))} <span class="small muted">· ${esc(tt('обязательно', 'required'))}</span></h2>
          <div class="notice demo small">${esc(tt('Временная заглушка: текст краткого руководства подготовит владелец проекта.', 'Temporary placeholder: the project owner will provide the short guide text.'))}</div>
          <ul style="margin:0;padding-left:1.2em" class="small">
            <li>${esc(tt('JPEG или PNG, до 60 МБ, до 20 файлов за одну отправку.', 'JPEG or PNG, up to 60 MB, up to 20 files per submission.'))}</li>
            <li>${esc(tt('Вертикальное изображение, соотношение сторон 7:12.', 'A vertical image with a 7:12 aspect ratio.'))}</li>
            <li>${esc(tt('Формат печатной карты — 70 × 120 мм.', 'The printed card is 70 × 120 mm.'))}</li></ul>
          <p class="small muted" style="margin:0">${esc(tt('Имя автора под картами берётся из профиля. Его можно изменить там.', 'The author name under the cards comes from your profile. You can change it there.'))}</p>
          <label class="check"><input type="checkbox" id="gok" ${guideOk ? 'checked' : ''}> <span>${esc(tt('Я ознакомился(ась) с кратким руководством', 'I have read the short guide'))}</span></label></section>
        <section class="card-ui flat stack" aria-labelledby="g-full"><h2 id="g-full" style="margin:0">${esc(tt('Полное руководство', 'Full guide'))}</h2>
          ${gAssets && gAssets.pdf ? `<p style="margin:0"><a class="btn sm light" href="${u('/guides/artist/guide.pdf')}" target="_blank" rel="noopener">${esc(tt('Открыть полное руководство (PDF)', 'Open the full guide (PDF)'))}</a></p>` : `<p class="small muted" style="margin:0">${esc(tt('Появится здесь, когда владелец проекта его передаст.', 'It will appear here once the project owner provides it.'))}</p>`}</section>
        <div class="row"><button class="btn light" type="button" id="back">${esc(tt('Назад', 'Back'))}</button><button class="btn yellow" type="button" id="next" ${guideOk ? '' : 'disabled'}>${esc(tt('Дальше', 'Next'))}</button></div>`;
    } else if (step === 3) {
      body = `${head()}
        <p>${esc(tt('Можно добавить одно или несколько изображений (JPEG или PNG). Каждая работа получит свой статус и решение; код карты присваивается автоматически при публикации.', 'Add one or more images (JPEG or PNG). Each work gets its own status and decision; the card code is assigned automatically on publication.'))}</p>
        <label class="btn light" style="justify-self:start">${ic.plus || ''} ${esc(files.length ? tt('Добавить ещё', 'Add more') : tt('Выбрать изображения', 'Choose images'))}<input type="file" id="files" accept="image/jpeg,image/png" multiple class="sr-only"></label>
        ${thumbs(true)}
        <p class="form-error" id="err" role="alert"></p>
        <div class="row"><button class="btn light" type="button" id="back">${esc(tt('Назад', 'Back'))}</button><button class="btn yellow" type="button" id="next" ${files.length ? '' : 'disabled'}>${esc(tt('Дальше', 'Next'))}</button></div>`;
    } else {
      const busy = send.state === 'uploading' || send.state === 'processing';
      const pct = Math.round(send.progress * 100);
      body = `${head()}
        <p style="margin:0">${esc(tt('Отправьте работу и дождитесь решения.', 'Send your work and wait for the decision.'))}</p>
        ${thumbs(false)}
        <p class="small muted" style="margin:0">${esc(tt('Автор в карточке:', 'Author name on cards:'))} <b>${esc(session.user.publicName)}</b></p>
        ${busy ? `<div class="upl" role="status" aria-live="polite"><div class="upl-bar"><i style="width:${send.state === 'processing' ? 100 : pct}%"></i></div>
          <span class="small">${esc(send.state === 'uploading' ? tt(`Загрузка файлов: ${pct}%`, `Uploading files: ${pct}%`) : tt('Файлы получены, сервер готовит изображения…', 'Files received, the server is preparing the images…'))}</span></div>` : ''}
        ${send.state === 'error' ? `<div class="notice small" role="alert"><b>${esc(tt('Не отправлено.', 'Not sent.'))}</b> ${esc(send.error)} ${esc(tt('Файлы на месте — можно повторить: вторая подача не создастся.', 'Your files are still here — you can retry: no duplicate submission will be created.'))}</div>` : ''}
        <div class="row"><button class="btn light" type="button" id="back" ${busy ? 'disabled' : ''}>${esc(tt('Назад', 'Back'))}</button>
          <button class="btn yellow" type="button" id="send" ${busy || !files.length ? 'disabled' : ''}>${esc(busy ? tt('Отправляем…', 'Sending…') : send.state === 'error' ? tt('Повторить отправку', 'Retry sending') : tt('Отправить на рассмотрение', 'Send for review'))}${!busy && files.length > 1 ? ` (${files.length})` : ''}</button></div>`;
    }
    ctx.main.innerHTML = `<div class="wrap page narrow stack"><div class="card-ui ${result ? 'navy' : ''} stack">${body}</div></div>`;
    wire();
  };
  const wire = () => {
    const $ = (q) => ctx.main.querySelector(q);
    const fl = $('[data-full]'); if (fl && ed) fl.onclick = () => openFull(ed);
    const tn = $('#tnext');
    if (tn) {
      const tc = $('#terms'); tc.onchange = () => { checked = tc.checked; tn.disabled = !checked; };
      tn.onclick = async () => {
        if (!checked) return;
        if (preview) { step++; draw(); window.scrollTo(0, 0); return; }
        tn.disabled = true;
        try { consentId = await accept(ed.id, 'submit'); termsMsg = ''; step++; draw(); window.scrollTo(0, 0); }
        catch (x) { tn.disabled = false; termsMsg = errorText(x); if (x.code === 'terms_changed') { resetTermsCache(); ed = (await loadTerms()).edition; checked = false; } draw(); }
      };
      return;
    }
    const t = $('#terms');
    if (t) t.onchange = () => { accepted = t.checked; try { if (accepted) localStorage.setItem(TERMS_KEY, session.config.termsVersion); else localStorage.removeItem(TERMS_KEY); } catch { /* */ } $('#next').disabled = !accepted; };
    const g = $('#gok'); if (g) g.onchange = () => { guideOk = g.checked; $('#next').disabled = !guideOk; };
    const nx = $('#next'); if (nx) nx.onclick = () => { step++; draw(); window.scrollTo(0, 0); };
    const bk = $('#back'); if (bk) bk.onclick = () => { step--; draw(); };
    const fi = $('#files');
    if (fi) fi.onchange = () => {
      const add = [...fi.files].filter((f) => /^image\/(jpeg|png)$/.test(f.type));
      const skipped = fi.files.length - add.length;
      files = files.concat(add).slice(0, 20); send.key = null; draw();
      if (skipped) $('#err').textContent = tt('Часть файлов пропущена: подходят только JPEG и PNG.', 'Some files were skipped: only JPEG and PNG are accepted.');
    };
    const pv = $('#prev'); if (pv) pv.onclick = (e) => { const r = e.target.closest('[data-rm]'); if (r) { files.splice(Number(r.dataset.rm), 1); send.key = null; draw(); } };
    const sd = $('#send');
    if (sd) sd.onclick = async () => {
      if (!send.key) send.key = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9_-]/g, '');
      const fd = new FormData();
      for (const f of files) fd.append('images', f);
      fd.append('termsAccepted', String(accepted)); fd.append('termsVersion', session.config.termsVersion); fd.append('clientKey', send.key);
      if (consentId) fd.append('consentId', String(consentId));
      Object.assign(send, { state: 'uploading', progress: 0, error: '' }); draw();
      let last = 0;
      try {
        result = await upload('/api/artist/works', fd, (p) => {
          send.progress = p; if (p >= 1 && send.state === 'uploading') { send.state = 'processing'; draw(); }
          else if (p - last > 0.04) { last = p; draw(); }
        });
        files = []; consentId = null; checked = false; urls.forEach((x) => URL.revokeObjectURL(x)); urls.clear(); draw(); window.scrollTo(0, 0);
      } catch (x) {
        // редакция изменилась или согласие не принято — вернуть к условиям: прежнее согласие к новой редакции не привязывается
        if (ed && (x.code === 'terms_changed' || x.code === 'terms_required')) { resetTermsCache(); try { ed = (await loadTerms()).edition; } catch { /* */ } consentId = null; checked = false; step = 1; termsMsg = x.code === 'terms_changed' ? tt('Условия обновились — ознакомьтесь и подтвердите их ещё раз.', 'The terms have been updated — please read and confirm them again.') : errorText(x); Object.assign(send, { state: 'idle', error: '' }); draw(); window.scrollTo(0, 0); return; }
        Object.assign(send, { state: 'error', error: errorText(x) }); draw();
      }
    };
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
    { title: tt('Отправлено', 'Sent'), note: fmtDate(w.createdAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), state: 'done' },
    { title: w.status === 'discussion' ? tt('На обсуждении кураторов', 'Curators are discussing') : w.status === 'recommended' ? tt('Кураторы рекомендовали — ждёт решения администратора', 'Recommended by curators — awaiting the administrator') : tt('Проверка куратором', 'Curator review'),
      note: '', state: ['submitted', 'discussion', 'recommended'].includes(w.status) ? 'now' : 'done' },
    { title: w.status === 'published' ? tt('Опубликовано', 'Published') : w.status === 'needs_changes' ? tt('Возвращено на доработку', 'Returned for changes') : w.status === 'rejected' ? tt('Отклонено', 'Declined') : tt('Решение', 'Decision'),
      note: w.status === 'published' && w.card ? `${tt('Карта', 'Card')} ${w.card.code}` : '', href: w.status === 'published' && w.card ? u('/cards/' + w.card.code) : '',
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
          <input type="file" name="image" accept="image/jpeg,image/png" required><label class="field">${esc(tt('Что исправлено', 'What was fixed'))}<input type="text" name="note" maxlength="300"></label>
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
  submitted: ['Отправлено', 'Submitted'], resubmitted: ['Отправлена новая версия', 'New version sent'], approve: ['Опубликовано', 'Published'], recommend: ['Рекомендовано к публикации', 'Recommended for publication'],
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

// ---------- вводная страница автора (22.11.2026): открыта всем, перед входом и подачей работы ----------
// Окончательный текст страницы автор проекта пришлёт отдельно. Пока — только то, что уже согласовано и есть в приложении:
// путь работы (условия → руководство → загрузка → решение кураторов и администратора). Место для текста — AUTHOR_INTRO.
// Материалы для страницы (нужны от владельца): вступление от автора проекта; кому подходит (кого ждём); требования к работе
// (формат, размер, права, собственная работа); как проходит отбор и сроки; что получает автор (подпись, статистика выборов);
// 2–4 примера опубликованных карт с согласия их авторов; контакт для вопросов.
const AUTHOR_INTRO = null; // { ru: ['абзац', …], en: [...] } — вставить, когда текст будет готов
export function about(ctx) {
  const intro = AUTHOR_INTRO ? (lang === 'en' ? AUTHOR_INTRO.en : AUTHOR_INTRO.ru).map((p) => `<p>${esc(p)}</p>`).join('') : '';
  ctx.main.innerHTML = `<div class="wrap page narrow stack">
    <div class="page-head"><p class="eyebrow">Dialogue Cards</p><h1>${esc(tt('Стать автором карты', 'Become a card author'))}</h1></div>
    <p class="lead" style="margin:0">${esc(tt('Есть работа, с которой может начаться разговор? Покажите её кураторам.', 'Have a work that could start a conversation? Show it to the curators.'))}</p>
    ${intro}
    <h2>${esc(tt('Как это устроено', 'How it works'))}</h2>
    <ol class="steps">
      <li>${esc(tt('Вы знакомитесь с условиями использования работы и руководством для автора.', 'You read the terms of use of the work and the guide for authors.'))}</li>
      <li>${esc(tt('Загружаете иллюстрацию — после входа по email.', 'You upload the illustration — after signing in with email.'))}</li>
      <li>${esc(tt('Кураторы рассматривают работу: рекомендуют к публикации или возвращают с объяснением. Окончательно публикует администратор.', 'Curators review the work: they recommend it for publication or return it with an explanation. The administrator publishes it.'))}</li>
      <li>${esc(tt('Статус каждой работы виден в кабинете автора.', 'The status of each work is shown in the author space.'))}</li>
    </ol>
    <div class="row"><a class="btn yellow" href="${u('/artist/submit')}">${esc(tt('Предложить иллюстрацию', 'Suggest an illustration'))}</a></div>
  </div>`;
}
