// Тексты под картой — в одном месте. Правьте здесь.
//
// QUESTION_FORMATS — панель «Вопросы» под открытой картой (галерея и подборка фасилитатора — один источник).
//   Три формата предусмотрены; в меню показываются только те, у которых есть списки (lists).
//   «Для себя» и «В группе» подключить, когда будут готовы вопросы: добавить lists — пункт появится сам.
//   «В паре»: тексты владельца проекта (14.11.2026), порядок и формулировки — дословно, без нумерации.
export const QUESTION_FORMATS = [
  { key: 'self', title: { ru: 'Для себя', en: 'On your own' }, lists: null },
  {
    key: 'pair',
    title: { ru: 'В паре', en: 'In pairs' },
    lists: [
      {
        key: 'partner',
        title: { ru: 'Спрашивает собеседник', en: 'The partner asks' },
        items: {
          ru: [
            'Что на карте первым привлекло твоё внимание?',
            'Как думаешь, что здесь происходит?',
            'Почему ты сегодня выбрал(а) именно эту карту?',
            'Есть ли на карте что-то, что напоминает тебе о твоей жизни?',
            'Если бы карта могла задать тебе один вопрос, что бы она спросила?',
          ],
          en: [
            'What caught your attention first?',
            'What do you think is happening in the picture?',
            'What made you choose this card today?',
            'Does anything on the card remind you of something in your life?',
            'If this card could ask you one question, what would it ask?',
          ],
        },
      },
      {
        key: 'holder',
        title: { ru: 'Спрашивает тот, кто выбрал карту', en: 'The card holder asks' },
        items: {
          ru: [
            'Что тебе запомнилось из моих слов?',
            'Что ещё ты заметил(а) на карте, о чём я не говорил(а)?',
            'После моих слов ты видишь эту карту по-другому?',
            'Мои слова напомнили тебе о чём-нибудь из твоей жизни?',
            'Хочешь меня о чём-нибудь спросить?',
          ],
          en: [
            'What stayed with you from what I shared?',
            'What did you notice on the card that I didn’t mention?',
            'Do you see the card differently after hearing what I shared?',
            'Did anything I shared remind you of something from your own life?',
            'Is there anything you’d like to ask me?',
          ],
        },
      },
    ],
  },
  { key: 'group', title: { ru: 'В группе', en: 'In a group' }, lists: null },
];

// START_GUIDES — «С чего начать?» (показывается под картой в общей галерее).
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
    choose: true, // в сценарии есть необязательное действие «Выбрать для обсуждения»
    hints: {
      ru: ['Если вы с другом, карта может напомнить историю из жизни.', 'Если только познакомились, начните с картинки: «Как ты думаешь, что здесь происходит?»'],
      en: ['If you are with a friend, the card may bring back a story from your life.', 'If you have just met, start with the picture: “What do you think is happening here?”'],
    },
  },
  {
    key: 'group',
    title: { ru: 'В группе', en: 'In a group' },
    choose: true,
    text: {
      ru: 'Покажите одну карту всем. Кто хочет, называет деталь или ассоциацию. Если чья-то мысль заинтересовала других, продолжите разговор с неё.',
      en: 'Show one card to everyone. Whoever wants to names a detail or an association. If someone’s thought catches the others’ interest, carry the conversation on from there.',
    },
  },
];
