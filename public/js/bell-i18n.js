// Уведомления на языке читателя (21.11.2026). Сервер хранит системное событие по-русски по постоянным шаблонам;
// здесь шаблон распознаётся и собирается на выбранном языке. Авторский текст (имена, вопросы, названия встреч) — как есть.
// Работает и для уже полученных уведомлений: после смены языка вся история показывается на новом языке.
import { lang } from './i18n.js';

const ROOMS = { 'общем чате': 'the general chat', 'чате кураторов': 'the curators’ chat', 'чате фасилитаторов': 'the facilitators’ chat', 'чате': 'the chat' };
const NAME = (n) => ({ 'Друг': 'Your friend', 'Собеседник': 'Your partner', 'Участник': 'A participant' }[n] || n);
const DEFAULT_Q = { 'что ты здесь видишь?': 'what do you see here?', 'что тебе откликается в этой карте?': 'what resonates with you in this card?' };

const TITLES = [
  [/^Друг ответил на карту$/, () => 'Your friend answered the card'],
  [/^Друг ответил в «Глаз-алмазе»$/, () => 'Your friend answered in Eagle Eye'],
  [/^Новый ответ на карту$/, () => 'A new answer to your card'],
  [/^Новая онлайн-встреча$/, () => 'A new online meeting'],
  [/^Новая встреча в городе (.+)$/, (m) => `A new meeting in ${m[1]}`],
  [/^Тебе прислали ответную карту$/, () => 'You got a card in reply'],
  [/^Тебе предложили поделиться ответами в сторис$/, () => 'You were invited to share your answers in Instagram Stories'],
  [/^Друг согласился поделиться в сторис$/, () => 'Your friend agreed to share in Instagram Stories'],
  [/^Тебя упомянули в (.+)$/, (m) => `You were mentioned in ${ROOMS[m[1]] || m[1]}`],
  [/^Тебе ответили в (.+)$/, (m) => `Someone replied to you in ${ROOMS[m[1]] || m[1]}`],
  [/^Вы записаны на встречу$/, () => 'You are registered for the meeting'],
  [/^Дата встречи отменена организатором$/, () => 'The organizer cancelled the meeting date'],
  [/^Изменилось место встречи$/, () => 'The meeting place has changed'],
  [/^Администратор отменил дату вашей встречи$/, () => 'An administrator cancelled a date of your meeting'],
  [/^Администратор изменил вашу встречу$/, () => 'An administrator changed your meeting'],
  [/^Администратор снял встречу с публикации$/, () => 'An administrator unpublished your meeting'],
  [/^Записи на «(.+)»$/, (m) => `Registrations for “${m[1]}”`],
  [/^Ручная проверка ответов фасилитатора$/, () => 'Manual review of facilitator answers'],
  [/^Новая заявка на роль фасилитатора$/, () => 'New facilitator application'],
  [/^Новая заявка на роль куратора$/, () => 'New curator application'],
  [/^Заявка на роль (фасилитатора|куратора) одобрена$/, (m) => `Your ${m[1] === 'куратора' ? 'curator' : 'facilitator'} application was approved`],
  [/^Заявка на роль (фасилитатора|куратора) не одобрена$/, (m) => `Your ${m[1] === 'куратора' ? 'curator' : 'facilitator'} application was not approved`],
  [/^Новые работы на проверке$/, () => 'New works to review'],
  [/^Работу вынесли на обсуждение$/, () => 'A work was put up for discussion'],
  [/^Иллюстрацию рекомендуют к публикации$/, () => 'An illustration is recommended for publication'],
  [/^Рекомендованная вами работа опубликована$/, () => 'A work you recommended was published'],
  [/^Работа опубликована( \(решение принято\))?$/, (m) => `Work published${m[1] ? ' (decided)' : ''}`],
  [/^Работа возвращена на доработку( \(решение принято\))?$/, (m) => `Work returned for changes${m[1] ? ' (decided)' : ''}`],
  [/^Работа отклонена( \(решение принято\))?$/, (m) => `Work declined${m[1] ? ' (decided)' : ''}`],
];
const BODIES = [
  [/^(.+) написал\(а\), что видит в карте$/, (m) => `${NAME(m[1])} wrote what they see in the card`],
  [/^(.+) ответил\(а\) в общем обмене$/, (m) => `${NAME(m[1])} answered in the shared exchange`],
  [/^Посмотри макет и реши$/, () => 'Look at the layout and decide'],
  [/^Можно сохранить картинку для сторис$/, () => 'You can save the image for Stories'],
  [/^В общей очереди: (\d+)$/, (m) => `In the shared queue: ${m[1]}`],
  [/^Работа №(\d+), версия (\d+)$/, (m) => `Work #${m[1]}, version ${m[2]}`],
  [/^Работа №(\d+) · (.+)$/, (m) => `Work #${m[1]} · ${m[2]}`],
  [/^Работа №(\d+)$/, (m) => `Work #${m[1]}`],
  [/^Сейчас записано: (\d+) из (\d+)$/, (m) => `Registered now: ${m[1]} of ${m[2]}`],
  // «Аня: что ты здесь видишь?» — имя и вопрос авторские; стандартный вопрос переводится
  [/^([^:]+): (.+)$/, (m) => `${NAME(m[1])}: ${DEFAULT_Q[m[2].toLowerCase()] || m[2]}`],
];
const tr = (s, rules) => { for (const [re, f] of rules) { const m = String(s || '').match(re); if (m) return f(m); } return s; };

/** Заголовок и текст уведомления на языке интерфейса. */
export function bellText(n) {
  if (lang !== 'en') return { title: n.title, body: n.body };
  return { title: tr(n.title, TITLES), body: n.body ? tr(n.body, BODIES) : '' };
}
