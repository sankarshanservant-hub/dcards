// Инструмент встречи: подборка по QR/ссылке, без аккаунта. Выбор карты для обсуждения, раунды, случайная карта.
import { t, lang } from '../i18n.js';
import { esc, tt, api, errorText, storage, visitorId, toast } from '../util.js';
import { openViewer, refreshViewer, icons, notCountedText, demoSavedText } from '../viewer.js';
import { tileHtml, loading, failed, diceButtonHtml, wireDice } from '../ui.js';
// Памятка участника — дословно из «Руководства фасилитатора Dialogue Flow» (приложение 5).
const MEMO = { ru: ["Сегодня вы участвуете в Dialogue Flow — формате для разговора чуть более глубокого, чем это обычно бывает при первой встрече.", "Карта, которую вы выберете, — не тест и не предсказание. У неё нет правильного значения: то, что вы в ней увидите, то она и означает. Она нужна лишь для того, чтобы разговору было с чего начать — и если через несколько минут вы забудете о самой карте, значит, она уже выполнила свою работу.", "Карточка с вопросами — это помощь, а не экзамен. Можно идти по вопросам по порядку, можно пропускать, можно вообще отложить её в сторону, если разговор потёк сам.", "Никто не обязан отвечать на каждый вопрос или рассказывать больше, чем хочется. Если какая-то тема пока не хочется — вполне достаточно сказать: «Я пока не готов об этом говорить».", "Всё, чем вы поделитесь друг с другом, остаётся между вами — если вы сами не договоритесь иначе.", "Если что-то понадобится — фасилитатор всегда рядом, его можно позвать в любой момент."], en: ["Today you are taking part in Dialogue Flow — a format for a conversation a little deeper than usual when people first meet.", "The card you choose is not a test or a prediction. It has no correct meaning: whatever you see in it is what it means. It is only there so the conversation has somewhere to start — and if after a few minutes you forget about the card itself, it has done its job.", "The question card is a help, not an exam. You can go through the questions in order, skip some, or put the card aside altogether if the conversation flows on its own.", "Nobody has to answer every question or share more than they want to. If you would rather not talk about something yet, it is enough to say: “I’m not ready to talk about this yet.”", "Everything you share with each other stays between you — unless you agree otherwise.", "If you need anything, the facilitator is always nearby — you can call them at any moment."] };

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
        ${cards.length ? diceButtonHtml() : ''}</div>
      ${cards.length ? '<div class="grid" id="col-grid"></div>' : `<p class="empty">${esc(t('col.empty'))}</p>`}
      <details class="about-df card-ui flat" style="margin-top:22px"><summary><span class="grow">${esc(tt('Памятка участника', 'Participant notes'))}</span><span class="chev" aria-hidden="true">▾</span></summary>
        <div class="about-body">${(lang === 'en' ? MEMO.en : MEMO.ru).map((x) => `<p>${esc(x)}</p>`).join('')}</div></details>
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
      ? `<span class="bar-thumb" aria-hidden="true"><img src="${esc(card.thumb)}" alt=""></span>
        <div class="bar-text"><strong>${esc(t('col.yourChoice'))}</strong>${roundLabel}</div>
        <button class="btn yellow sm" type="button" data-open="${esc(card.code)}">${esc(tt('К выбранной карте', 'To the chosen card'))}</button>
        <button class="link-btn" type="button" data-next-round>${esc(t('col.nextRound'))}</button>`
      : `<div class="bar-text"><strong>${esc(t('col.noChoice'))}</strong>${roundLabel}</div>`;
  }
  const redraw = () => { drawGrid(); drawBar(); refreshViewer(); };
  const collectionApi = {
    isTest: col.isTest, isDemo: col.isDemo,
    state: () => ({ choice: choiceIn(st.round), round: st.round }),
    countFor: (code) => st.counts[code],
    notCountedFor: (code) => (st.selections.find((x) => x.round === st.round && x.code === code) || {}).notCounted || null,
    async choose(code) {
      // Ошибку отдаём просмотру карты: он покажет её у кнопки и даст повторить; успех объявляем только после ответа сервера.
      try {
        const r = await api(`/api/c/${slug}/select`, { method: 'POST', body: { visitorId: vid, code, round: st.round } });
        applyState(r);
        toast(col.isDemo ? demoSavedText() : r.notCounted === 'own_card' ? notCountedText('own_card') : t('col.saved'));
      } finally { redraw(); }
    },
    async cancel() {
      try { applyState(await api(`/api/c/${slug}/unselect`, { method: 'POST', body: { visitorId: vid, round: st.round } })); toast(t('col.cancelled')); } finally { redraw(); }
    },
  };
  const openAt = (i) => openViewer({ cards, index: i, mode: 'collection', collection: collectionApi, onClose: () => {} });
  if (grid) grid.addEventListener('click', (e) => { const b = e.target.closest('.tile'); if (b) openAt(Number(b.dataset.i)); });
  wireDice(ctx.main.querySelector('#rnd'), () => openAt(Math.floor(Math.random() * cards.length)), ctx.alive);
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
