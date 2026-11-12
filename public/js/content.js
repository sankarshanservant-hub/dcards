// Тексты под картой — в одном месте. Правьте здесь.
//
// PARTNER_QUESTIONS — «Вопросы для собеседника» (показываются в подборке после выбора карты).
//   Сейчас ВРЕМЕННЫЕ вопросы для теста (placeholder: true — интерфейс помечает их как временные).
//   Когда придёт список проекта: заменить ru и en целиком, сохранив авторские формулировки и порядок,
//   и поставить placeholder: false.
export const PARTNER_QUESTIONS = {
  placeholder: true,
  ru: [
    'Что первым привлекло твоё внимание?',
    'Почему ты выбрал именно эту карту?',
    'Что из твоей жизни она тебе напомнила?',
  ],
  en: [
    'What caught your eye first?',
    'Why did you choose this card?',
    'What from your life does it remind you of?',
  ],
};

// START_GUIDES — «С чего начать?» (показывается под картой в общей библиотеке).
// Тексты — из задания владельца (12.11.2026). hints — короткие подсказки внутри сценария.
export const START_GUIDES = [
  {
    key: 'self',
    title: { ru: 'Для себя', en: 'On your own' },
    text: {
      ru: 'Рассмотри карту. Заметь деталь, к которой возвращается взгляд. О чём она тебе напоминает? Можно просто подумать или записать пару слов для себя.',
      en: 'Look at the card. Notice the detail your eyes keep coming back to. What does it remind you of? You can just think about it, or jot down a few words for yourself.',
    },
  },
  {
    key: 'pair',
    title: { ru: 'Вдвоём', en: 'With someone' },
    text: {
      ru: 'Посмотрите на одну карту и по очереди расскажите, что каждый заметил.',
      en: 'Look at one card together and take turns saying what each of you noticed.',
    },
    hints: {
      ru: ['Если вы с другом, карта может напомнить историю из жизни.', 'Если только познакомились, начните с картинки: «Как ты думаешь, что здесь происходит?»'],
      en: ['If you are with a friend, the card may bring back a story from your life.', 'If you have just met, start with the picture: “What do you think is happening here?”'],
    },
  },
  {
    key: 'group',
    title: { ru: 'В группе', en: 'In a group' },
    text: {
      ru: 'Покажите одну карту всем. Кто хочет, называет деталь или ассоциацию. Если чья-то мысль заинтересовала других, продолжите разговор с неё.',
      en: 'Show one card to everyone. Whoever wants to names a detail or an association. If someone’s thought catches the others’ interest, carry the conversation on from there.',
    },
  },
];
