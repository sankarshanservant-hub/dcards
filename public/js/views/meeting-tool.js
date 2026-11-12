// Инструмент встречи: подборка по QR/ссылке, без аккаунта. Выбор карты для обсуждения, раунды, случайная карта.
import { t } from '../i18n.js';
import { esc, tt, api, errorText, storage, visitorId, toast } from '../util.js';
import { openViewer, refreshViewer, icons, notCountedText } from '../viewer.js';
import { ic, tileHtml, loading, failed } from '../ui.js';

export async function collection(ctx, slug) {
  loading(ctx.main);
  let col;
  try { col = await api(`/api/c/${slug}`); } catch (e) {
    if (!ctx.alive()) return;
    if (e.status === 404) { ctx.main.innerHTML = `<div class="wrap page narrow"><p class="error-box">${esc(t('col.notFound'))}</p></div>`; return; }
    return failed(ctx.main, e, ctx.rerender);
  }
  if (!ctx.alive()) return;
  const vid = visitorId();
  const roundKey = `dc_round_${slug}`;
  const st = { selections: [], counts: {}, round: Math.max(1, Number(storage.get(roundKey)) || 1) };
  const applyState = (s) => {
    st.selections = s.selections || [];
    st.counts = { ...st.counts, ...(s.counts || {}) };
    st.round = Math.max(st.round, st.selections.reduce((m, x) => Math.max(m, x.round), 1));
    storage.set(roundKey, String(st.round));
  };
  const choiceIn = (round) => (st.selections.find((x) => x.round === round) || {}).code || null;
  try { applyState(await api(`/api/c/${slug}/visit`, { method: 'POST', body: { visitorId: vid } })); } catch { /* выбор возможен и без этого */ }
  if (!ctx.alive()) return;

  const cards = col.cards;
  document.body.classList.add('has-choice-bar');
  ctx.main.innerHTML = `<div class="wrap page collection">
      <p class="eyebrow">${esc(t('col.badge'))}${col.isTest ? ` · <span class="pill demo">${esc(col.isDemo ? tt('демо', 'demo') : t('col.test'))}</span>` : ''}</p>
      <h1>${esc(col.title)}</h1>
      <div class="row between" style="margin-bottom:16px"><p class="muted" style="margin:0">${esc(t('col.hint'))}</p>
        ${cards.length ? `<button class="btn dark sm" type="button" id="rnd">${ic.dice} ${esc(tt('Случайная карта', 'Random card'))}</button>` : ''}</div>
      ${cards.length ? '<div class="grid" id="col-grid"></div>' : `<p class="empty">${esc(t('col.empty'))}</p>`}
      <p class="small muted" style="margin-top:22px;max-width:36em">${esc(t('col.saveNote'))}</p>
    </div>
    <div class="choice-bar"><div class="in" id="choice-bar"></div></div>`;
  const grid = ctx.main.querySelector('#col-grid');
  const bar = ctx.main.querySelector('#choice-bar');

  function drawGrid() {
    if (!grid) return;
    const current = choiceIn(st.round);
    grid.innerHTML = cards.map((c, i) => {
      const earlier = st.selections.filter((x) => x.code === c.code && x.round !== st.round).map((x) => x.round);
      let badge = '';
      if (c.code === current) badge = `<span class="tile-check">${icons.check}</span>`;
      else if (earlier.length) badge = `<span class="tile-round">${earlier.join(', ')}</span>`;
      return tileHtml(c, i, { extraClass: c.code === current ? 'chosen' : '', badge });
    }).join('');
  }
  function drawBar() {
    const current = choiceIn(st.round);
    const card = cards.find((c) => c.code === current);
    const roundLabel = st.round > 1 || st.selections.length ? `<span>${esc(t('col.round', { n: st.round }))}</span>` : '';
    bar.innerHTML = card
      ? `<button class="bar-thumb" type="button" data-open="${esc(card.code)}" aria-label="${esc(tt('К выбранной карте', 'To the chosen card'))}"><img src="${esc(card.thumb)}" alt=""></button>
        <div class="bar-text"><strong>${esc(t('col.yourChoice'))}</strong>${roundLabel}</div>
        <button class="btn yellow sm" type="button" data-open="${esc(card.code)}">${esc(tt('К выбранной карте', 'To the chosen card'))}</button>
        <button class="link-btn" type="button" data-next-round>${esc(t('col.nextRound'))}</button>`
      : `<div class="bar-text"><strong>${esc(t('col.noChoice'))}</strong>${roundLabel}</div>`;
  }
  const redraw = () => { drawGrid(); drawBar(); refreshViewer(); };
  const collectionApi = {
    isTest: col.isTest,
    state: () => ({ choice: choiceIn(st.round), round: st.round }),
    countFor: (code) => st.counts[code],
    notCountedFor: (code) => (st.selections.find((x) => x.round === st.round && x.code === code) || {}).notCounted || null,
    async choose(code) {
      try {
        const r = await api(`/api/c/${slug}/select`, { method: 'POST', body: { visitorId: vid, code, round: st.round } });
        applyState(r);
        toast(r.notCounted === 'own_card' ? notCountedText('own_card') : t('col.saved'));
      } catch (e) { toast(errorText(e)); }
      redraw();
    },
    async cancel() {
      try { applyState(await api(`/api/c/${slug}/unselect`, { method: 'POST', body: { visitorId: vid, round: st.round } })); toast(t('col.cancelled')); } catch (e) { toast(errorText(e)); }
      redraw();
    },
  };
  const openAt = (i) => openViewer({ cards, index: i, mode: 'collection', collection: collectionApi, onClose: () => {} });
  if (grid) grid.addEventListener('click', (e) => { const b = e.target.closest('.tile'); if (b) openAt(Number(b.dataset.i)); });
  const rnd = ctx.main.querySelector('#rnd');
  if (rnd) rnd.addEventListener('click', () => openAt(Math.floor(Math.random() * cards.length)));
  let asking = false;
  bar.addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    if (open) openAt(cards.findIndex((c) => c.code === open.dataset.open));
    if (e.target.closest('[data-next-round]')) {
      asking = true;
      bar.innerHTML = `<div class="bar-text"><strong>${esc(tt(`Начать раунд ${st.round + 1}?`, `Start round ${st.round + 1}?`))}</strong><span>${esc(tt('Выбор этого раунда сохранится.', 'This round’s choice is kept.'))}</span></div>
        <button class="btn yellow sm" type="button" data-yes>${esc(tt('Да', 'Yes'))}</button><button class="link-btn" type="button" data-no>${esc(tt('Отмена', 'Cancel'))}</button>`;
      return;
    }
    if (asking && e.target.closest('[data-no]')) { asking = false; drawBar(); }
    if (asking && e.target.closest('[data-yes]')) {
      asking = false; st.round = Math.min(st.round + 1, 20); storage.set(roundKey, String(st.round)); redraw(); toast(t('col.roundStarted', { n: st.round }));
    }
  });
  redraw();
  const code = new URL(location.href).searchParams.get('card');
  if (code) { const i = cards.findIndex((c) => c.code === code); if (i >= 0) openAt(i); else history.replaceState({}, '', location.pathname); }
}
