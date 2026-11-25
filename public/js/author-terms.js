// Соглашение с авторами в интерфейсе (25.11.2026): краткие условия, полный текст в окне (форма под ним не теряется),
// согласие — запись на сервере с его временем. Тексты приходят с сервера (утверждённая редакция), здесь не переписываются.
import { lang } from './i18n.js';
import { esc, tt, api } from './util.js';

let cache = null;
export async function loadTerms() {
  if (cache) return cache;
  cache = await api(`/api/terms/authors?lang=${lang === 'en' ? 'en' : 'ru'}`);
  return cache;
}
export const resetTermsCache = () => { cache = null; };
/** Абзацы и списки полного текста: строки «— …» — пункты списка, строки «N. …» — заголовки разделов. */
export function fullHtml(body) {
  const blocks = String(body).split(/\n\s*\n/);
  let out = ''; let first = true;
  for (const b of blocks) {
    const lines = b.split('\n').map((l) => l.trim()).filter(Boolean); if (!lines.length) continue;
    if (first) { out += `<h2 class="at-doc-title">${esc(lines[0])}</h2>${lines.slice(1).map((l) => `<p class="small muted">${esc(l)}</p>`).join('')}`; first = false; continue; }
    if (lines.every((l) => l.startsWith('—'))) { out += `<ul class="at-list">${lines.map((l) => `<li>${esc(l.replace(/^—\s*/, ''))}</li>`).join('')}</ul>`; continue; }
    if (lines.length === 1 && /^\d+\.\s/.test(lines[0])) { out += `<h3>${esc(lines[0])}</h3>`; continue; }
    out += lines.map((l) => (/^Редакция|^Version/.test(l) ? `<p class="small muted">${esc(l)}</p>` : `<p>${esc(l)}</p>`)).join('');
  }
  return out;
}
/** Полный текст поверх формы: закрытие возвращает к тому же месту с тем же состоянием. */
export function openFull(edition) {
  const opener = document.activeElement; const y = window.scrollY;
  const el = document.createElement('div'); el.className = 'at-pop'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', edition.title);
  el.innerHTML = `<div class="at-pop-in"><div class="at-pop-bar"><button class="btn light sm" type="button" data-x>← ${esc(tt('Вернуться к условиям', 'Back to the terms'))}</button></div>
    ${edition.translationPending ? `<p class="notice small">${esc('The English translation is under review. The original Russian text is shown.')}</p>` : ''}
    <article class="at-doc" tabindex="-1">${fullHtml(edition.body)}</article>
    <div class="at-pop-foot"><button class="btn yellow" type="button" data-x>${esc(tt('Вернуться к условиям', 'Back to the terms'))}</button></div></div>`;
  const done = () => { el.remove(); document.removeEventListener('keydown', onKey); document.body.classList.remove('no-scroll'); window.scrollTo({ top: y, behavior: 'instant' }); if (opener && opener.focus) opener.focus({ preventScroll: true }); };
  const onKey = (e) => { if (e.key === 'Escape') done(); };
  el.addEventListener('click', (e) => { if (e.target.closest('[data-x]') || e.target === el) done(); });
  document.addEventListener('keydown', onKey); document.body.appendChild(el); document.body.classList.add('no-scroll');
  el.querySelector('.at-doc').focus({ preventScroll: true });
}
/** Первый шаг: заголовок, вступление, шесть блоков, ссылка на полный текст, галочка (не отмечена), кнопка. */
export function stepHtml(ed, { checked = false } = {}) {
  const s = ed.short;
  return `<h1 class="at-title">${esc(s.title)}</h1>
    ${ed.translationPending ? `<p class="notice small">${esc('The English translation of the terms is under review. The original Russian text is shown below.')}</p>` : ''}
    <p class="at-intro">${esc(s.intro)}</p>
    <ol class="at-blocks">${s.blocks.map(([h, p]) => `<li><h2>${esc(h)}</h2><p>${esc(p)}</p></li>`).join('')}</ol>
    <p class="at-link"><button class="link-btn at-full" type="button" data-full>${esc(s.link)}</button></p>
    <label class="check at-check"><input type="checkbox" id="terms" ${checked ? 'checked' : ''}> <span>${esc(s.check)}</span></label>`;
}
/** Короткий блок согласия для новой версии карты и исправления: ссылка на полный текст и та же галочка. */
export function miniHtml(ed, id) {
  return `<p class="small" style="margin:0"><button class="link-btn at-full" type="button" data-full>${esc(ed.short.link)}</button></p>
    <label class="check at-check"><input type="checkbox" id="${id}"> <span>${esc(ed.short.check)}</span></label>`;
}
export async function accept(editionId, purpose = 'submit', target = null) {
  const r = await api('/api/artist/consent', { method: 'POST', body: { editionId, purpose, target } });
  return r.consentId;
}
