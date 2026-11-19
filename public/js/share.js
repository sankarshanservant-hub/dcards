// Отправка ссылок: Telegram, WhatsApp, системное меню, копирование. Человек сам подтверждает отправку в приложении —
// открытие меню не означает, что сообщение доставлено. Возвращает true, если человек воспользовался действием
// (для аналитики «приглашение отправлено/скопировано»); отменённое системное меню — false.
import { tt, toast } from './util.js';

export const SLOGAN = () => tt('Dialogue Cards — повод начать интересный диалог.', 'Dialogue Cards — a reason to start an interesting dialogue.');
export const friendText = () => tt('Мне интересно, что ты увидишь в этой карте. Напиши пару слов о том, что тебе откликнулось, и увидишь мой ответ.',
  'I wonder what you will see in this card. Write a few words about what speaks to you, and you will see my answer.');
export const storyText = () => tt('Хочешь поделиться нашими ответами в сторис? Открой эту ссылку и посмотри, как это будет выглядеть.',
  'Would you like to share our answers in stories? Open this link and see how it will look.');

export async function shareInvite(kind, url, text, copiedMsg) {
  const full = text ? `${text}\n${url}` : url;
  if (kind === 'tg') { window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text || '')}`, '_blank', 'noopener'); return true; }
  if (kind === 'wa') { window.open(`https://wa.me/?text=${encodeURIComponent(full)}`, '_blank', 'noopener'); return true; }
  if (kind === 'sys' && navigator.share) { try { await navigator.share({ title: 'Dialogue Cards', text: text || undefined, url }); return true; } catch { return false; } }
  try { await navigator.clipboard.writeText(full); toast(copiedMsg || tt('Ссылка скопирована', 'Link copied')); return true; }
  catch { prompt(tt('Скопируйте ссылку:', 'Copy the link:'), full); return true; }
}
