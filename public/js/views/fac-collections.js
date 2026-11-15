// Подборки фасилитатора: «Мои подборки» → редактор одной подборки → окно выбора карт → «Готово» → ссылка и QR.
import { esc, tt, u, api, errorText, toast, ruPlural } from '../util.js';
import { openViewer, icons } from '../viewer.js';
import { session, hasRole, needLogin, noRole, loading, failed, demoPill, ic, showQr } from '../ui.js';

const MAX = 40;
const cardsWord = (n) => tt(`${n} ${ruPlural(n, 'карта', 'карты', 'карт')}`, `${n} ${n === 1 ? 'card' : 'cards'}`);
/** Стопка из 3–4 слегка перекрывающихся миниатюр (без сильного наклона). */
const stack = (covers) => `<span class="cstack" aria-hidden="true">${covers.length ? covers.map((t) => `<img src="${esc(t)}" alt="" loading="lazy">`).join('') : `<span class="cstack-empty">${ic.plus}</span>`}</span>`;

// ---------- Мои подборки ----------
export async function list(ctx) {
  if (!session.user) return needLogin(ctx.main, tt('Подборки фасилитатора.', 'Facilitator selections.'));
  if (!hasRole('facilitator')) return noRole(ctx.main, tt('фасилитатор', 'facilitator'));
  loading(ctx.main);
  let cols;
  try { cols = await api('/api/collections'); } catch (e) { return failed(ctx.main, e, ctx.rerender); }
  if (!ctx.alive()) return;
  ctx.main.innerHTML = `<div class="wrap page stack">
    <a class="small" href="${u('/facilitator')}">← ${esc(tt('Кабинет фасилитатора', 'Facilitator space'))}</a>
    <div class="page-head"><h1>${esc(tt('Мои подборки', 'My selections'))}</h1>
      <p class="sub">${esc(tt('До 40 карт из галереи. Участники открывают подборку по ссылке или QR-коду без регистрации; ссылка показывает актуальный состав.', 'Up to 40 cards from the gallery. Participants open a selection via link or QR code without signing up; the link always shows the current cards.'))}</p></div>
    <form class="card-ui flat form" id="newcol" style="padding:14px"><label class="field" for="newcol-title">${esc(tt('Название новой подборки', 'New selection title'))}</label>
      <div class="row"><input id="newcol-title" type="text" name="title" class="grow" maxlength="120" placeholder="${esc(tt('например, «Встреча 20 ноября»', 'e.g. “Meeting on 20 November”'))}" style="flex:1 1 220px"><button class="btn yellow" type="submit">${ic.plus} ${esc(tt('Создать подборку', 'Create selection'))}</button></div>
      <p class="field-error" id="newcol-err"></p></form>
    ${cols.collections.length ? `<div class="col-grid">${cols.collections.map((c) => `<article class="col-card">
        <a class="col-open" href="${u('/facilitator/c/' + c.id)}">${stack(c.covers || [])}<span class="col-meta"><b>${esc(c.title)} ${demoPill(c.isDemo)}</b>
          <span class="small muted">${c.cardCount ? esc(cardsWord(c.cardCount)) : esc(tt('Пока без карт — черновик', 'No cards yet — draft'))}${c.unavailableCount ? ` · <span class="warn">${esc(tt('недоступно: ', 'unavailable: '))}${c.unavailableCount}</span>` : ''}</span>
          ${c.cardCount ? `<span class="small muted">${esc(tt(`Открывали подборку: ${c.visitors} · выборов в этой подборке: ${c.selections}`, `Opened: ${c.visitors} · choices in this selection: ${c.selections}`))}</span>` : ''}</span></a>
        ${c.cardCount ? `<button class="btn sm light" type="button" data-share="${esc(c.slug)}" data-title="${esc(c.title)}">${ic.qr} ${esc(tt('Поделиться', 'Share'))}</button>` : ''}
      </article>`).join('')}</div>` : `<p class="empty">${esc(tt('Подборок пока нет. Создайте первую — название можно изменить позже.', 'No selections yet. Create the first one — you can rename it later.'))}</p>`}
  </div>`;
  const f = ctx.main.querySelector('#newcol');
  if (ctx.query.get('new') === '1') f.title.focus();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = ctx.main.querySelector('#newcol-err');
    if (!f.title.value.trim()) { err.textContent = tt('Введите название подборки.', 'Enter a selection title.'); f.title.setAttribute('aria-invalid', 'true'); f.title.focus(); return; }
    const btn = f.querySelector('button'); btn.disabled = true;
    try { const { id } = await api('/api/collections', { method: 'POST', body: { title: f.title.value } }); ctx.navigate('/facilitator/c/' + id + '?pick=1'); }
    catch (x) { btn.disabled = false; err.textContent = errorText(x); }
  });
  ctx.main.querySelectorAll('[data-share]').forEach((b) => b.addEventListener('click', () => showQr(b.dataset.share, b.dataset.title, `${cols.baseUrl}/s/${b.dataset.share}`)));
}

// ---------- Редактор одной подборки ----------
export async function editor(ctx, id) {
  if (!session.user) return needLogin(ctx.main, '');
  if (!hasRole('facilitator')) return noRole(ctx.main, tt('фасилитатор', 'facilitator'));
  loading(ctx.main);
  let detail; let library;
  try { [detail, { cards: library }] = await Promise.all([api(`/api/collections/${id}`), api('/api/cards')]); } catch (e) {
    if (!ctx.alive()) return;
    if (e.status === 404) { ctx.main.innerHTML = `<div class="wrap page narrow"><p class="empty">${esc(tt('Подборка не найдена или принадлежит другому фасилитатору.', 'Selection not found or belongs to another facilitator.'))}</p></div>`; return; }
    return failed(ctx.main, e, ctx.rerender);
  }
  if (!ctx.alive()) return;
  const known = new Map(detail.cards.map((c) => [c.code, c]));
  for (const c of library) if (!known.has(c.code)) known.set(c.code, { ...c, status: 'published', selections: 0 });
  let codes = detail.cards.map((c) => c.code); // сохранённый состав (на сервере)
  const isAvailable = (code) => known.get(code)?.status === 'published';
  let readyBanner = ctx.query.get('ready') === '1';
  const $ = (s) => ctx.main.querySelector(s);

  function shareBlock(title) {
    return `<div class="card-ui navy stack" id="share">
      <div class="row between"><h2 style="margin:0">${esc(title)}</h2>${readyBanner ? `<button class="linkbtn" type="button" id="share-close">${esc(tt('К подборке', 'Back to the selection'))}</button>` : ''}</div>
      <label class="field small" for="ed-url">${esc(tt('Ссылка для участников', 'Link for participants'))}</label>
      <input type="text" id="ed-url" readonly value="${esc(detail.url)}" style="font-family:ui-monospace,monospace">
      <div class="row"><button class="btn yellow sm" type="button" id="copy">${esc(tt('Скопировать ссылку', 'Copy link'))}</button>
        <button class="btn sm" type="button" id="qr">${ic.qr} ${esc(tt('QR на весь экран', 'Full-screen QR'))}</button>
        <a class="btn light sm" href="${u('/api/c/' + detail.slug + '/qr.png?size=1600&download=1')}" download>${esc(tt('Скачать QR', 'Download QR'))}</a>
        <a class="btn light sm" href="${u('/s/' + detail.slug)}" target="_blank" rel="noopener">${esc(tt('Открыть как участник', 'Open as participant'))} ↗</a></div>
      <p class="small muted" style="margin:0">${esc(tt('Ссылка постоянная и показывает актуальный состав подборки. Срока действия у QR нет.', 'The link is permanent and shows the current cards. The QR code does not expire.'))} ${esc(tt(`Открывали подборку: ${detail.visitors}.`, `Opened: ${detail.visitors}.`))}</p>
    </div>`;
  }
  function draw() {
    const av = codes.filter(isAvailable); const un = codes.filter((c) => !isAvailable(c));
    const empty = !av.length;
    ctx.main.innerHTML = `<div class="wrap page stack" id="ed">
      <a class="small" href="${u('/facilitator/collections')}">← ${esc(tt('К подборкам', 'To selections'))}</a>
      <div class="page-head"><h1>${esc(tt('Редактор подборки', 'Selection editor'))}</h1>
        <label class="small muted" for="ed-title">${esc(tt('Название подборки', 'Selection title'))}</label>
        <div class="row"><input type="text" id="ed-title" value="${esc(detail.title)}" maxlength="120" style="max-width:520px;font-weight:600"><span class="save-state" id="st" aria-live="polite"></span></div></div>
      ${readyBanner && !empty ? shareBlock(tt('Подборка готова', 'The selection is ready')) : ''}
      ${un.length ? `<div class="notice red stack"><b>${esc(tt('Недоступные карты:', 'Unavailable cards:'))} ${un.map(esc).join(', ')}</b><span>${esc(tt('Карты сняты с публикации, участники их не видят.', 'These cards were removed; participants do not see them.'))}</span><div><button class="btn sm" type="button" id="dropun">${esc(tt('Убрать их из подборки', 'Remove them from the selection'))}</button></div></div>` : ''}
      ${empty ? `<button class="add-zone" type="button" data-pick>${ic.plus}<b>${esc(tt('Добавьте карты из галереи', 'Add cards from the gallery'))}</b><span class="small muted">${esc(tt(`До ${MAX} карт`, `Up to ${MAX} cards`))}</span></button>
          <p class="small muted" style="margin:0">${esc(tt('Пока в подборке нет карт — это черновик. Ссылкой и QR можно будет поделиться, когда вы добавите карты.', 'The selection has no cards yet — it is a draft. You can share the link and QR once you add cards.'))}</p>`
        : `<div class="row between"><b>${esc(tt(`${av.length} из ${MAX} карт`, `${av.length} of ${MAX} cards`))}</b>
            <div class="row"><button class="btn yellow sm" type="button" data-pick>${ic.plus} ${esc(tt('Добавить карты', 'Add cards'))}</button>${readyBanner ? '' : `<button class="btn sm" type="button" id="share-open">${ic.qr} ${esc(tt('Поделиться', 'Share'))}</button>`}</div></div>
          <div id="share-slot"></div>
          <div class="cells" id="sel">${av.map((code) => { const c = known.get(code); return `<div class="cell"><button class="tile" type="button" data-view="${esc(code)}" aria-label="${esc(tt(`Рассмотреть карту ${code}`, `View card ${code}`))}"><img src="${esc(c.thumb)}" alt="" loading="lazy"></button>
            <small>${esc(code)}${c.selectedCount ? ' · ' + esc(tt('всего выбрали ', 'chosen ')) + c.selectedCount : ''}</small>
            <button class="pick-btn" type="button" data-remove="${esc(code)}" aria-label="${esc(tt(`Убрать из подборки ${code}`, `Remove ${code} from the selection`))}">${ic.x} ${esc(tt('Убрать', 'Remove'))}</button></div>`; }).join('')}</div>
          <p class="small muted" style="margin:0">${esc(tt('Удаление из подборки не удаляет карту из галереи.', 'Removing a card from the selection does not remove it from the gallery.'))}</p>`}
      <label class="check"><input type="checkbox" id="ed-test" ${detail.isTest ? 'checked' : ''}><span><b>${esc(tt('Тестовая подборка', 'Test selection'))}</b> — ${esc(tt('выборы не попадают в общую статистику карт', 'choices do not count in card statistics'))}</span></label>
      <div id="delwrap"><button class="btn danger sm" type="button" id="del">${esc(tt('Удалить подборку', 'Delete selection'))}</button></div>
    </div>`;
    wire();
  }
  const status = (txt, cls = '') => { const st = $('#st'); if (st) { st.className = 'save-state ' + cls; st.textContent = txt; } };
  async function saveCodes(next) {
    status(tt('Сохраняем…', 'Saving…'));
    await api(`/api/collections/${id}/cards`, { method: 'PUT', body: { codes: next } });
    codes = next; status(tt('Все изменения сохранены', 'All changes saved'), 'ok');
  }
  function wire() {
    $('#ed').addEventListener('click', async (e) => {
      const pk = e.target.closest('[data-pick]'); const rm = e.target.closest('[data-remove]'); const vw = e.target.closest('[data-view]');
      if (pk) return openPicker();
      if (vw) { const list = codes.filter(isAvailable).map((c) => known.get(c)); openViewer({ cards: list, index: Math.max(0, list.findIndex((c) => c.code === vw.dataset.view)), mode: 'admin' }); return; }
      if (rm) {
        rm.disabled = true;
        try { await saveCodes(codes.filter((x) => x !== rm.dataset.remove)); draw(); status(tt('Все изменения сохранены', 'All changes saved'), 'ok'); }
        catch (x) { rm.disabled = false; status(`${tt('Не сохранено:', 'Not saved:')} ${errorText(x)}`, 'err'); }
      }
    });
    const d = $('#dropun'); if (d) d.onclick = async () => { try { await saveCodes(codes.filter(isAvailable)); draw(); } catch (x) { status(errorText(x), 'err'); } };
    $('#ed-title').addEventListener('change', async (e) => { status(tt('Сохраняем…', 'Saving…')); try { await api(`/api/collections/${id}`, { method: 'PATCH', body: { title: e.target.value } }); detail.title = e.target.value; status(tt('Все изменения сохранены', 'All changes saved'), 'ok'); } catch (x) { status(`${tt('Не сохранено:', 'Not saved:')} ${errorText(x)}`, 'err'); } });
    $('#ed-test').addEventListener('change', async (e) => { status(tt('Сохраняем…', 'Saving…')); try { await api(`/api/collections/${id}`, { method: 'PATCH', body: { isTest: e.target.checked } }); detail.isTest = e.target.checked; status(tt('Все изменения сохранены', 'All changes saved'), 'ok'); } catch (x) { status(`${tt('Не сохранено:', 'Not saved:')} ${errorText(x)}`, 'err'); } });
    const so = $('#share-open'); if (so) so.onclick = () => { $('#share-slot').innerHTML = shareBlock(tt('Поделиться подборкой', 'Share the selection')); wireShare(); $('#share').scrollIntoView({ block: 'nearest' }); };
    wireShare();
    $('#del').addEventListener('click', () => {
      $('#delwrap').innerHTML = `<div class="notice red row"><span class="grow">${esc(tt('Удалить подборку? Ссылка и QR перестанут работать, статистика этой подборки удалится.', 'Delete the selection? Its link and QR stop working and its statistics are deleted.'))}</span>
        <button class="btn danger sm" type="button" id="yes">${esc(tt('Удалить', 'Delete'))}</button><button class="linkbtn" type="button" id="no">${esc(tt('Назад', 'Back'))}</button></div>`;
      $('#no').onclick = draw;
      $('#yes').onclick = async () => { try { await api(`/api/collections/${id}`, { method: 'DELETE' }); ctx.navigate('/facilitator/collections'); } catch (x) { toast(errorText(x)); } };
    });
  }
  function wireShare() {
    const cp = $('#copy'); if (!cp) return;
    cp.onclick = async () => { try { await navigator.clipboard.writeText(detail.url); toast(tt('Ссылка скопирована', 'Link copied')); } catch { const i = $('#ed-url'); i.focus(); i.select(); toast(tt('Скопируйте выделенную ссылку', 'Copy the selected link')); } };
    $('#qr').onclick = () => showQr(detail.slug, detail.title, detail.url);
    const cl = $('#share-close'); if (cl) cl.onclick = () => { readyBanner = false; history.replaceState({}, '', u('/facilitator/c/' + id)); draw(); };
  }

  // ---------- Окно выбора карт: на телефоне — на весь экран, на широком — модальное ----------
  function openPicker() {
    const opener = document.activeElement;
    let picked = codes.filter(isAvailable); // черновик выбора; сохранённый состав не меняется до «Готово»
    const wasEmpty = !picked.length;
    const el = document.createElement('div');
    el.className = 'picker-wrap'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'pk-title');
    document.getElementById('overlay-root').appendChild(el); document.body.classList.add('no-scroll');
    const close = () => { el.remove(); document.body.classList.remove('no-scroll'); document.removeEventListener('keydown', onKey); if (opener && document.contains(opener)) opener.focus({ preventScroll: true }); };
    const render = (errMsg = '') => {
      el.innerHTML = `<div class="picker">
        <div class="picker-head"><button class="icon-btn" type="button" data-cancel aria-label="${esc(tt('Отмена', 'Cancel'))}">${ic.close}</button>
          <div class="grow"><h2 id="pk-title" style="margin:0;font-size:1.15rem">${esc(tt('Выбор карт', 'Choose cards'))}</h2><span class="small" id="pk-count" aria-live="polite">${esc(tt(`Выбрано ${picked.length} из ${MAX}`, `Selected ${picked.length} of ${MAX}`))}</span></div>
          <button class="btn yellow" type="button" data-done>${esc(tt('Готово', 'Done'))}</button></div>
        ${errMsg ? `<p class="field-error" role="alert" style="padding:0 16px">${esc(errMsg)}</p>` : ''}
        <p class="small muted" style="margin:0;padding:0 16px">${esc(tt('Нажмите на карту, чтобы отметить; повторное нажатие снимает отметку. Значок ⤢ — рассмотреть крупно.', 'Tap a card to select it; tap again to unselect. The ⤢ icon opens it large.'))}</p>
        <div class="picker-body"><div class="cells">${library.map((c) => { const on = picked.includes(c.code); const full = !on && picked.length >= MAX; return `<div class="cell ${on ? 'in' : ''}">
          <button class="tile pk-tile" type="button" data-toggle="${esc(c.code)}" aria-pressed="${on}" ${full ? 'disabled' : ''} aria-label="${esc(on ? tt(`Снять отметку: ${c.code}`, `Unselect ${c.code}`) : tt(`Отметить: ${c.code}`, `Select ${c.code}`))}"><img src="${esc(c.thumb)}" alt="" loading="lazy">${on ? `<span class="tile-check">${icons.check}</span>` : ''}</button>
          <button class="mini-btn l" type="button" data-zoom="${esc(c.code)}" aria-label="${esc(tt(`Рассмотреть карту ${c.code}`, `View card ${c.code}`))}">${ic.expand}</button><small>${esc(c.code)}</small></div>`; }).join('')}</div>
          ${picked.length >= MAX ? `<p class="notice small" style="margin-top:12px">${esc(tt(`Выбрано ${MAX} карт — это предел одной подборки. Снимите отметку, чтобы выбрать другую.`, `${MAX} cards selected — the limit for one selection. Unselect one to choose another.`))}</p>` : ''}</div>
      </div>`;
    };
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.viewer.is-open')) close(); };
    document.addEventListener('keydown', onKey);
    el.addEventListener('click', async (e) => {
      if (e.target === el || e.target.closest('[data-cancel]')) return close();
      const tg = e.target.closest('[data-toggle]'); const zm = e.target.closest('[data-zoom]');
      if (zm) { openViewer({ cards: library, index: Math.max(0, library.findIndex((c) => c.code === zm.dataset.zoom)), mode: 'admin' }); return; }
      if (tg) {
        const c = tg.dataset.toggle; const scroll = el.querySelector('.picker-body').scrollTop;
        picked = picked.includes(c) ? picked.filter((x) => x !== c) : picked.length < MAX ? [...picked, c] : picked;
        render(); el.querySelector('.picker-body').scrollTop = scroll; const again = el.querySelector(`[data-toggle="${CSS.escape(c)}"]`); if (again) again.focus({ preventScroll: true });
        return;
      }
      if (e.target.closest('[data-done]')) {
        const b = e.target.closest('[data-done]'); b.disabled = true; b.textContent = tt('Сохраняем…', 'Saving…');
        try {
          // недоступные карты остаются в составе, пока их не уберут явно
          await saveCodes([...picked, ...codes.filter((x) => !isAvailable(x))]);
          close();
          if (wasEmpty && picked.length) { readyBanner = true; history.replaceState({}, '', u('/facilitator/c/' + id + '?ready=1')); }
          draw();
        } catch (x) { const scroll = el.querySelector('.picker-body').scrollTop; render(`${tt('Не сохранено:', 'Not saved:')} ${errorText(x)} ${tt('Отметки сохранены — нажмите «Готово» ещё раз.', 'Your selection is kept — press “Done” again.')}`); el.querySelector('.picker-body').scrollTop = scroll; }
      }
    });
    render();
    el.querySelector('[data-done]').focus();
  }

  draw();
  if (ctx.query.get('pick') === '1' && !codes.length) { history.replaceState({}, '', u('/facilitator/c/' + id)); openPicker(); }
}
