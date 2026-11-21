// Отправка ссылок и картинок (19.11.2026): одна крупная кнопка «Отправить» с самолётиком — дальше выбор приложения
// даёт само устройство (системное меню). Где системного меню нет (компьютер) — небольшой выбор: Telegram, WhatsApp,
// скопировать. Человек сам подтверждает отправку — открытие меню не означает доставку. Возвращает true, если человек
// воспользовался действием (для аналитики); отменённое системное меню — false.
import { tt, toast, esc, u } from './util.js';

// Подпись проекта (21.11.2026, окончательная): одна строка для интерфейса, сообщений и метаданных.
export const TAGLINE = () => tt('Повод для интересного разговора', 'A reason for an interesting conversation');
export const SLOGAN = () => tt('Dialogue Cards — повод для интересного разговора', 'Dialogue Cards — a reason for an interesting conversation');
// Приглашение к карте с вопросом (21.11.2026): готовое сообщение на языке отправителя — личная фраза, ссылка, подпись.
// Подходит к любому вопросу: сам вопрос открывается по ссылке.
export const friendText = () => tt('Посмотри на эту карту. Мне интересно, что ты ответишь.', 'Take a look at this card. I’m curious to hear your answer.');
const INVITE_SIGN = () => tt('Dialogue Cards — повод для интересного разговора.', 'Dialogue Cards — a reason for an interesting conversation.');
/** Полное приглашение: фраза, ссылка с новой строки, через пустую строку — подпись. */
export const inviteMessage = (url) => `${friendText()}\n${url}\n\n${INVITE_SIGN()}`;
export const storyText = () => tt('Хочешь поделиться нашими ответами в сторис? Открой эту ссылку и посмотри, как это будет выглядеть.',
  'Would you like to share our answers in stories? Open this link and see how it will look.');

const PLANE = '<svg viewBox="0 0 24 24" aria-hidden="true" class="ic-plane"><path d="M21.5 3.5 2.8 10.6c-.9.4-.9 1.6 0 1.9l4.7 1.6 1.8 5.6c.3.8 1.3 1 1.9.4l2.7-2.6 4.8 3.5c.7.5 1.7.1 1.9-.7l2.9-15.4c.2-.9-.7-1.7-1.6-1.3z"/><path d="M7.6 14.1 18.8 6.4l-8.5 9.4"/></svg>';
/** Крупная кнопка отправки. attr — data-атрибут для обработчика. */
export const sendButton = (attr, label) => `<button class="btn yellow big send-btn" type="button" ${attr}>${PLANE}<span>${esc(label || tt('Отправить', 'Send'))}</span></button>`;

export async function shareInvite(kind, url, text, copiedMsg) {
  const full = text ? `${text}\n${url}` : url;
  if (kind === 'tg') { window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text || '')}`, '_blank', 'noopener'); return true; }
  if (kind === 'wa') { window.open(`https://wa.me/?text=${encodeURIComponent(full)}`, '_blank', 'noopener'); return true; }
  if (kind === 'sys' && navigator.share) { try { await navigator.share({ title: 'Dialogue Cards', text: text || undefined, url }); return true; } catch { return false; } }
  try { await navigator.clipboard.writeText(full); toast(copiedMsg || tt('Ссылка скопирована', 'Link copied')); return true; }
  catch { prompt(tt('Скопируйте ссылку:', 'Copy the link:'), full); return true; }
}

/**
 * Одна кнопка «Отправить»: на телефоне — системное меню выбора приложения (там Telegram, WhatsApp и остальные);
 * без него — короткий выбор. Возвращает способ ('sys' | 'tg' | 'wa' | 'copy') или null, если человек передумал.
 */
export async function send(url, text) {
  const touch = matchMedia('(pointer: coarse)').matches;
  if (navigator.share && touch) { try { await navigator.share({ title: 'Dialogue Cards', text: text || undefined, url }); return 'sys'; } catch { return null; } }
  const kind = await chooser();
  if (!kind) return null;
  await shareInvite(kind, url, text);
  return kind;
}
/**
 * Приглашение к карте с вопросом: системное меню сразу с готовым сообщением (текст с ссылкой внутри — так его сохраняют
 * и мессенджеры, которые отбрасывают текст при отдельной ссылке). Без системного меню — выбор; «Скопировать» копирует
 * приглашение целиком. Возвращает способ или null.
 */
export async function sendInvite(url) {
  const full = inviteMessage(url);
  const touch = matchMedia('(pointer: coarse)').matches;
  if (navigator.share && touch) { try { await navigator.share({ text: full }); return 'sys'; } catch { return null; } }
  const kind = await chooser();
  if (!kind) return null;
  if (kind === 'tg') window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(`${friendText()}\n\n${INVITE_SIGN()}`)}`, '_blank', 'noopener');
  else if (kind === 'wa') window.open(`https://wa.me/?text=${encodeURIComponent(full)}`, '_blank', 'noopener');
  else if (kind === 'sys' && navigator.share) { try { await navigator.share({ text: full }); } catch { return null; } }
  else await copyInvite(url);
  return kind;
}
export async function copyInvite(url) {
  const full = inviteMessage(url);
  try { await navigator.clipboard.writeText(full); toast(tt('Приглашение скопировано', 'Invitation copied')); return true; }
  catch { prompt(tt('Скопируйте приглашение:', 'Copy the invitation:'), full); return true; }
}
function chooser() {
  return new Promise((resolve) => {
    const opener = document.activeElement;
    const el = document.createElement('div'); el.className = 'send-pop'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', tt('Куда отправить', 'Where to send'));
    el.innerHTML = `<div class="send-pop-in"><b>${esc(tt('Куда отправить?', 'Where to send?'))}</b>
      <button class="btn" type="button" data-k="tg">Telegram</button><button class="btn" type="button" data-k="wa">WhatsApp</button>
      ${navigator.share ? `<button class="btn" type="button" data-k="sys">${esc(tt('Другие приложения', 'Other apps'))}</button>` : ''}
      <button class="btn light" type="button" data-k="copy">${esc(tt('Скопировать ссылку', 'Copy link'))}</button>
      <button class="link-btn" type="button" data-k="">${esc(tt('Отмена', 'Cancel'))}</button></div>`;
    const done = (k) => { el.remove(); document.removeEventListener('keydown', onKey); if (opener && opener.focus) opener.focus({ preventScroll: true }); resolve(k || null); };
    const onKey = (e) => { if (e.key === 'Escape') done(null); };
    el.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) done(b.dataset.k); else if (e.target === el) done(null); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(el); el.querySelector('[data-k]').focus();
  });
}

// ---------- сторис: сохранить картинку, затем открыть сторис нужного приложения ----------
// Сайт не может сам опубликовать сторис: картинку сохраняют в «Фото», а приложение открывают на экране сторис,
// где выбирают последнее фото. Ссылку для стикера копируем заранее.
export const STORY_APPS = [
  { key: 'instagram', name: 'Instagram', app: 'instagram://story-camera', web: 'https://www.instagram.com/',
    icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.4" cy="6.6" r="1.1" class="dot"/></svg>' },
  { key: 'telegram', name: 'Telegram', app: 'tg://', web: 'https://web.telegram.org/',
    icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M6.5 11.6 17 7.4l-1.8 9.1-3.8-2.8-2 1.9.3-3.1 5.3-4.4-6.6 3.9z"/></svg>' },
  { key: 'vk', name: tt('ВКонтакте', 'VK'), app: 'vk://', web: 'https://vk.com/',
    icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><path d="M7 9c.3 3.6 2.2 6 5.4 6h.3v-2.2c1.2.1 2.1 1 2.5 2.2h1.6c-.4-1.5-1.5-2.5-2.3-2.9.8-.4 1.8-1.4 2.1-2.9h-1.5c-.3 1.1-1.3 2.1-2.4 2.2V9h-1.5v3.9C10.3 12.6 9.3 11 9.2 9z" class="dot"/></svg>' },
];
/**
 * Сохранить картинку (21.11.2026, исправлено): раньше на iPhone ссылка на файл открывала пустую страницу со значком файла.
 * Теперь: на телефоне с отправкой файлов — системное меню только с картинкой PNG (там «Сохранить изображение» → «Фото»,
 * «Сохранить в Файлы»); без неё — картинка во весь экран, её сохраняют долгим нажатием; на компьютере — скачивание.
 * Возвращает 'menu' (открылось меню — сохранено ли, неизвестно), 'cancel', 'overlay' или 'download'.
 * hint(text) — показать подсказку рядом с кнопкой (на телефоне подтверждения «сохранено» не показываем).
 */
export async function saveImage(blob, name, hint) {
  const file = new File([blob], name, { type: 'image/png' });
  const touch = matchMedia('(pointer: coarse)').matches;
  // Android: обычная загрузка надёжнее — файл попадает в «Загрузки» и сразу виден галерее и настройкам обоев
  const android = /Android/i.test(navigator.userAgent);
  if (touch && !android && navigator.canShare && navigator.canShare({ files: [file] })) {
    if (hint) hint(tt('В меню выбери «Сохранить изображение» — картинка попадёт в «Фото». Или «Сохранить в Файлы».', 'In the menu choose “Save Image” to put it in Photos, or “Save to Files”.'));
    try { await navigator.share({ files: [file] }); return 'menu'; } catch (e) { if (e && e.name === 'AbortError') return 'cancel'; }
  }
  if (touch && !android) { imageOverlay(blob); return 'overlay'; }
  const a = document.createElement('a'); const url = URL.createObjectURL(blob); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast(tt('Картинка скачана', 'Image downloaded'));
  return 'download';
}
/** Картинка во весь экран: долгое нажатие → «Сохранить в Фото». Закрытие возвращает к прежнему экрану. */
function imageOverlay(blob) {
  const url = URL.createObjectURL(blob); const opener = document.activeElement;
  const el = document.createElement('div'); el.className = 'img-pop'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', tt('Картинка для сохранения', 'Image to save'));
  el.innerHTML = `<div class="img-pop-in"><img src="${url}" alt="${esc(tt('Готовая картинка', 'The finished image'))}"><p>${esc(tt('Нажми и удерживай картинку, затем выбери «Сохранить в Фото».', 'Press and hold the image, then choose “Save to Photos”.'))}</p>
    <button class="btn" type="button" data-x>${esc(tt('Готово', 'Done'))}</button></div>`;
  const done = () => { el.remove(); URL.revokeObjectURL(url); document.removeEventListener('keydown', onKey); if (opener && opener.focus) opener.focus({ preventScroll: true }); };
  const onKey = (e) => { if (e.key === 'Escape') done(); };
  el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-x]')) done(); });
  document.addEventListener('keydown', onKey); document.body.appendChild(el); el.querySelector('[data-x]').focus();
}
/** Отправить готовую картинку: системное меню с файлом; подпись — слоган и ссылка на проект (личное пожелание уже на картинке). */
export async function sendImage(blob, name, caption) {
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], text: caption }); return 'menu'; } catch (e) { if (e && e.name === 'AbortError') return 'cancel'; }
  }
  return null; // отправка файлов недоступна — вызывающий предлагает сохранить картинку
}
export const projectUrl = () => `${location.origin}${u('/')}`;
export const postcardCaption = () => `${SLOGAN()}\n${projectUrl()}`;
export function openStoryApp(key) {
  const a = STORY_APPS.find((x) => x.key === key); if (!a) return;
  const touch = matchMedia('(pointer: coarse)').matches;
  if (!touch) { window.open(a.web, '_blank', 'noopener'); return; }
  location.href = a.app; // откроет приложение, если оно установлено
}
