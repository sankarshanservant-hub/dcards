import { t, lang } from './i18n.js';

// Адрес приложения (если оно стоит в подпапке, сервер подставляет её в <meta name="dc-base">).
export const BASE = (document.querySelector('meta[name="dc-base"]')?.content || '').replace(/\/$/, '');
export const u = (p) => BASE + p;

/** Текст на текущем языке: tt('по-русски', 'in English'). */
export const tt = (ru, en) => (lang === 'en' ? en : ru);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export class ApiError extends Error {
  constructor(status, code, data) { super(code); this.status = status; this.code = code; this.data = data; }
}

export async function api(path, { method = 'GET', body, form } = {}) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: form || (body ? JSON.stringify(body) : undefined),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  let data = null;
  try { data = await res.json(); } catch { /* пустой ответ */ }
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || 'server_error', data);
  return data;
}

const ERRORS = {
  network: ['Не удалось связаться с сервером. Проверьте интернет и попробуйте ещё раз.', 'Could not reach the server. Check your connection and try again.'],
  auth_required: ['Нужно войти.', 'Please sign in.'],
  forbidden: ['У этой роли нет доступа к действию.', 'This role has no access to this action.'],
  criteria_required: ['Выберите хотя бы один критерий — это причина решения.', 'Choose at least one criterion as the reason.'],
  replacement_type_required: ['Укажите тип изменения: исправление той же карты или новая карта.', 'Choose the change type: fix of the same card or a new card.'],
  terms_required: ['Нужно принять условия публикации.', 'Please accept the publication terms.'],
  no_images: ['Добавьте хотя бы одно изображение.', 'Add at least one image.'],
  bad_images: ['Файлы не похожи на изображения.', 'These files do not look like images.'],
  full: ['Места на эту дату закончились.', 'No seats left for this date.'],
  already_registered: ['Этот email уже записан на эту дату.', 'This email is already registered for this date.'],
  closed: ['Запись на эту встречу закрыта.', 'Registration for this meeting is closed.'],
  past: ['Эта дата уже прошла.', 'This date has passed.'],
  contact_required: ['Укажите контакт для связи.', 'Please add a way to reach you.'],
  motivation_required: ['Расскажите коротко, почему хотите участвовать.', 'Tell us briefly why you want to take part.'],
  already_submitted: ['Заявка уже отправлена и ждёт решения.', 'Your application has already been sent and awaits a decision.'],
  already_curator: ['Вы уже куратор.', 'You are already a curator.'],
  question_required: ['Напишите вопрос для коллег.', 'Write a question for your colleagues.'],
  price_required: ['Укажите стоимость участия для платной встречи.', 'Enter the price for a paid meeting.'],
  currency_required: ['Выберите валюту.', 'Choose a currency.'],
  bad_duration: ['Продолжительность — от 15 минут до 12 часов.', 'Duration must be between 15 minutes and 12 hours.'],
  bad_docx: ['Не удалось прочитать файл: нужен документ Word (.docx).', 'Could not read the file: a Word document (.docx) is needed.'],
  no_chapters: ['В документе не найдены главы «Глава 1…» (заголовки первого уровня).', 'No “Глава 1…” chapters (level-1 headings) found in the document.'],
  file_required: ['Выберите файл.', 'Choose a file.'],
  name_required: ['Укажите имя.', 'Please enter your name.'],
  email_required: ['Укажите email.', 'Please enter your email.'],
  bad_email: ['Проверьте email.', 'Check the email address.'],
  wrong_code: ['Код не подходит.', 'Wrong code.'],
  code_expired: ['Код устарел — запросите новый.', 'The code has expired — request a new one.'],
  too_many_attempts: ['Слишком много попыток. Подождите несколько минут.', 'Too many attempts. Wait a few minutes.'],
  wrong_password: ['Неверный пароль.', 'Wrong password.'],
  bad_timezone: ['Не удалось определить часовой пояс города.', 'Could not determine the city’s time zone.'],
  city_unresolved: ['Уточните город и страну встречи — по ним определяется местное время.', 'Specify the meeting city and country — the local time depends on them.'],
  required_fields: ['Заполните название, страну и город.', 'Fill in the title, country and city.'],
  date_required: ['Добавьте дату встречи.', 'Add a meeting date.'],
  bad_date: ['Проверьте дату и время.', 'Check the date and time.'],
  capacity_required: ['Укажите число мест.', 'Enter the number of seats.'],
  capacity_below_registrations: ['Записей уже больше, чем новое число мест.', 'There are already more registrations than the new capacity.'],
  course_not_finished: ['Отметьте все главы курса.', 'Mark all course chapters as read.'],
  quiz_not_passed: ['Ответы на вопросы проверки пока не верны.', 'Some quiz answers are not correct yet.'],
  not_editable: ['Эту работу сейчас нельзя изменить.', 'This work cannot be changed now.'],
  too_many_cards: ['В подборке не больше 40 карт.', 'A selection holds at most 40 cards.'],
  empty: ['Напишите текст.', 'Please write something.'],
  cannot_revoke_own_admin: ['Нельзя снять роль администратора у самого себя.', 'You cannot remove your own admin role.'],
  demo_readonly: ['Демо-роль меняет только демо-данные. Настоящие карты, работы и встречи ей доступны для просмотра.', 'A demo role can only change demo data. Real cards, works and meetings are view-only for it.'],
  mail_not_configured: ['Вход по email заработает после подключения почты. Пока можно посмотреть роли через демо-режим.', 'Email sign-in will work once email is connected. For now, try the roles in demo mode.'],
  email_taken: ['Этот email уже у другого пользователя.', 'This email belongs to another user.'],
};
export function errorText(e) {
  const m = e && ERRORS[e.code];
  if (m) return lang === 'en' ? m[1] : m[0];
  return t('err.generic');
}

export const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } },
};

/** Случайный идентификатор браузера участника. Не содержит личных данных. */
export function visitorId() {
  let v = storage.get('dc_visitor');
  if (!v || !/^[A-Za-z0-9-]{16,64}$/.test(v)) {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    v = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    storage.set('dc_visitor', v);
  }
  return v;
}

let toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2800);
}

const loc = () => (lang === 'en' ? 'en-GB' : 'ru-RU');
export const fmtDate = (iso, opts = { day: 'numeric', month: 'long', year: 'numeric' }) => new Intl.DateTimeFormat(loc(), opts).format(new Date(iso));
export const fmtDateTime = (iso, tz) => new Intl.DateTimeFormat(loc(), { dateStyle: 'medium', timeStyle: 'short', ...(tz ? { timeZone: tz } : {}) }).format(new Date(iso));
export const fmtTz = (iso, tz, opts) => new Intl.DateTimeFormat(loc(), { ...opts, timeZone: tz }).format(new Date(iso));

/** Русское склонение после числа: ruPlural(2, 'место', 'места', 'мест') → «места». */
export const ruPlural = (n, one, few, many) => { const a = Math.abs(n) % 100; const b = a % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many; };

// ---------- падежи названий городов (для «по времени Чиангмая», «по Чиангмаю») ----------
// Простые правила для одного русского слова (или «Санкт-Петербург», «Ростов-на-Дону»). Если правило не подходит —
// возвращается null, и интерфейс использует нейтральную формулировку без падежа.
const RU_WORD = /^[А-ЯЁ][а-яё]+$/;
const INDECL = /[оеэиыуюё]$|[аоеиуыэюя]а$/i; // Сочи, Тбилиси, Баку, Гоа…
function declineWord(w, kase) {
  if (!RU_WORD.test(w) || INDECL.test(w)) return INDECL.test(w) && RU_WORD.test(w) ? w : null;
  if (/(ий|ый|ой|ая|ое|ые)$/.test(w)) return null; // прилагательные (Нижний, Великий) — без правил
  const gen = kase === 'gen';
  if (/ь$/.test(w)) return w.slice(0, -1) + 'и';
  if (/й$/.test(w)) return w.slice(0, -1) + (gen ? 'я' : 'ю');
  if (/ия$/.test(w)) return w.slice(0, -1) + 'и';
  if (/я$/.test(w)) return w.slice(0, -1) + (gen ? 'и' : 'е');
  if (/а$/.test(w)) return w.slice(0, -1) + (gen ? (/[гкхжшщч]а$/.test(w) ? 'и' : 'ы') : 'е');
  if (/[бвгджзклмнпрстфхцчшщ]$/.test(w)) return w + (gen ? 'а' : 'у');
  return null;
}
export function cityCase(city, kase) {
  const c = String(city || '').trim();
  if (!c || /\s/.test(c)) return null;
  const parts = c.split('-');
  if (parts.length === 1) return declineWord(c, kase);
  const naIdx = parts.indexOf('на');
  if (naIdx === 1) { const w = declineWord(parts[0], kase); return w ? [w, ...parts.slice(1)].join('-') : null; }
  if (parts.length === 2 && ['Санкт', 'Улан', 'Нью', 'Сан', 'Лос'].includes(parts[0])) { const w = declineWord(parts[1], kase); return w ? `${parts[0]}-${w}` : null; }
  return null;
}
/** «18:30 по времени Чиангмая» / «18:30, местное время (Chiang Mai)» / «18:30 Chiang Mai time». */
export function timeInCity(time, city) {
  const g = cityCase(city, 'gen');
  return tt(g ? `${time} по времени ${g}` : `${time}, местное время (${city})`, `${time} ${city} time`);
}
/** «Укажите время по Чиангмаю» / «… в городе Chiang Mai». */
export function enterTimeHint(city) {
  const d = cityCase(city, 'dat');
  return tt(d ? `Укажите время по ${d} — так его увидят участники` : `Укажите местное время в городе ${city} — так его увидят участники`, `Enter the time in ${city}, as participants will see it`);
}
/** Продолжительность: 90 → «1 ч 30 мин». */
export function durationText(min) {
  if (!min) return '';
  const h = Math.floor(min / 60); const m = min % 60;
  return tt([h ? `${h} ч` : '', m ? `${m} мин` : ''].filter(Boolean).join(' '), [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' '));
}
