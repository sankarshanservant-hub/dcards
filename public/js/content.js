// Тексты под картой — в одном месте. Правьте здесь.
//
// QUESTION_FORMATS — панель «Вопросы» под открытой картой (галерея и подборка фасилитатора — один источник).
//   Три формата видны всегда. Пока у формата нет списков (lists: null), показывается честное состояние pending:
//   «Для себя» — вопросы владелец ещё пришлёт; «Для группы» — групповой сценарий не утверждён.
//   Когда тексты будут готовы — добавить lists (как у «Для двоих»), pending убрать.
//   «Для двоих»: тексты владельца проекта (14.11.2026, подтверждены 15.11.2026), порядок и формулировки — дословно, без нумерации.
export const QUESTION_FORMATS = [
  { key: 'self', title: { ru: 'Для себя', en: 'For yourself' }, lists: null,
    pending: { ru: 'Вопросы для самостоятельного размышления готовятся.', en: 'Questions for reflecting on your own are being prepared.' } },
  {
    key: 'pair',
    title: { ru: 'Для двоих', en: 'For two' },
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
  { key: 'group', title: { ru: 'Для группы', en: 'For a group' }, lists: null,
    pending: { ru: 'Групповой сценарий готовится.', en: 'The group scenario is being prepared.' } },
];

// START_GUIDES — «С чего начать?» (показывается под картой в общей галерее).
// Тексты — из задания владельца (12.11.2026). hints — короткие подсказки внутри сценария.
// {слово} в тексте — ссылка на вопросы этого сценария (15.11.2026: «воспользуйтесь списком вопросов»).
export const START_GUIDES = [
  {
    key: 'self',
    title: { ru: 'Для себя', en: 'For yourself' },
    text: {
      ru: 'Рассмотри карту. Заметь деталь, к которой возвращается взгляд. О чём она тебе напоминает? Можно просто подумать, записать пару слов для себя или воспользоваться списком {вопросов}.',
      en: 'Look at the card. Notice the detail your eyes keep coming back to. What does it remind you of? You can just think about it, jot down a few words for yourself or use the list of {questions}.',
    },
  },
  {
    key: 'pair',
    title: { ru: 'Для двоих', en: 'For two' },
    text: {
      ru: 'Посмотрите на одну карту и по очереди расскажите, что каждый заметил. Чтобы начать разговор, воспользуйтесь списком {вопросов}.',
      en: 'Look at one card together and take turns saying what each of you noticed. To get the conversation going, use the list of {questions}.',
    },
    choose: true, // в сценарии есть необязательное действие «Выбрать для обсуждения»
    hints: {
      ru: ['Если вы с другом, карта может напомнить историю из жизни.', 'Если только познакомились, начните с картинки: «Как ты думаешь, что здесь происходит?»'],
      en: ['If you are with a friend, the card may bring back a story from your life.', 'If you have just met, start with the picture: “What do you think is happening here?”'],
    },
  },
  {
    key: 'group',
    title: { ru: 'Для группы', en: 'For a group' },
    choose: true,
    text: {
      ru: 'Покажите одну карту всем. Кто хочет, называет деталь или ассоциацию. Если чья-то мысль заинтересовала других, продолжите разговор с неё. Для разговора можно воспользоваться списком {вопросов}.',
      en: 'Show one card to everyone. Whoever wants to names a detail or an association. If someone’s thought catches the others’ interest, carry the conversation on from there. You can also use the list of {questions}.',
    },
  },
];

// Памятка участника — дословно из «Руководства фасилитатора Dialogue Flow» (приложение 5).
export const MEMO = { ru: ["Сегодня вы участвуете в Dialogue Flow — формате для разговора чуть более глубокого, чем это обычно бывает при первой встрече.", "Карта, которую вы выберете, — не тест и не предсказание. У неё нет правильного значения: то, что вы в ней увидите, то она и означает. Она нужна лишь для того, чтобы разговору было с чего начать — и если через несколько минут вы забудете о самой карте, значит, она уже выполнила свою работу.", "Карточка с вопросами — это помощь, а не экзамен. Можно идти по вопросам по порядку, можно пропускать, можно вообще отложить её в сторону, если разговор потёк сам.", "Никто не обязан отвечать на каждый вопрос или рассказывать больше, чем хочется. Если какая-то тема пока не хочется — вполне достаточно сказать: «Я пока не готов об этом говорить».", "Всё, чем вы поделитесь друг с другом, остаётся между вами — если вы сами не договоритесь иначе.", "Если что-то понадобится — фасилитатор всегда рядом, его можно позвать в любой момент."], en: ["Today you are taking part in Dialogue Flow — a format for a conversation a little deeper than usual when people first meet.", "The card you choose is not a test or a prediction. It has no correct meaning: whatever you see in it is what it means. It is only there so the conversation has somewhere to start — and if after a few minutes you forget about the card itself, it has done its job.", "The question card is a help, not an exam. You can go through the questions in order, skip some, or put the card aside altogether if the conversation flows on its own.", "Nobody has to answer every question or share more than they want to. If you would rather not talk about something yet, it is enough to say: “I’m not ready to talk about this yet.”", "Everything you share with each other stays between you — unless you agree otherwise.", "If you need anything, the facilitator is always nearby — you can call them at any moment."] };
