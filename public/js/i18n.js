// Тексты интерфейса на русском и английском.
// Тексты главной страницы — черновик, требуют согласования с владельцем проекта.
const dict = {
  ru: {
    'nav.library': 'Карты',
    'nav.meetings': 'Встречи',
    'nav.admin': 'Управление',
    'lang.switch': 'EN',
    'lang.switchLabel': 'Switch to English',

    'home.eyebrow': 'Dialogue Cards',
    'home.title': 'Иллюстрации для живого разговора',
    'home.lead': 'Карты помогают замечать собственные ассоциации и говорить о жизненном опыте. Разные люди могут увидеть в одной иллюстрации похожие или совсем разные смыслы.',
    'home.ctaLibrary': 'Смотреть карты',
    'home.ctaMeetings': 'Встречи Dialogue Flow',
    'home.flowTitle': 'Встречи Dialogue Flow',
    'home.flowText': 'Встреча — возможность для содержательного человеческого общения. Фасилитатор знакомит с форматом, создаёт условия для разговора и проводит завершающий круг. Основное общение происходит между участниками, часто в парах.',
    'home.howTitle': 'Как проходит встреча с картами',
    'home.how1': 'Фасилитатор заранее составляет подборку карт.',
    'home.how2': 'Участники открывают её по QR-коду на своём телефоне — без регистрации.',
    'home.how3': 'Каждый рассматривает карты и выбирает одну для обсуждения.',
    'home.platform': 'Dialogue Cards объединяет художников, кураторов, фасилитаторов и участников встреч.',
    'home.draft': 'Черновик текста — видно только владельцу',

    'library.title': 'Галерея карт',
    'library.lead': 'Нажмите на карту, чтобы рассмотреть её крупно.',
    'library.count': ['{n} карта', '{n} карты', '{n} карт'],
    'library.empty': 'В галерее пока нет карт.',

    'viewer.close': 'Закрыть',
    'viewer.info': 'О карте',
    'viewer.prev': 'Предыдущая карта',
    'viewer.next': 'Следующая карта',
    'viewer.code': 'Код',
    'viewer.author': 'Автор',
    'viewer.authorUnknown': 'будет указан',
    'viewer.published': 'В библиотеке с',
    'viewer.selectedCount': ['Выбрали для разговора {n} раз', 'Выбрали для разговора {n} раза', 'Выбрали для разговора {n} раз'],
    'viewer.selectedNone': 'Для разговора эту карту ещё не выбирали',
    'viewer.zoomHint': 'Двойное касание или щипок — увеличить',
    'viewer.choose': 'Выбрать для обсуждения',
    'viewer.chooseInstead': 'Выбрать эту карту',
    'viewer.chooseInsteadHint': 'Она заменит ваш прежний выбор в этом раунде',
    'viewer.chosen': 'Выбрано для обсуждения',
    'viewer.cancel': 'Отменить выбор',
    'viewer.testNoCount': 'Тестовая подборка: выбор не идёт в общую статистику',

    'col.badge': 'Подборка для встречи',
    'col.hint': 'Рассмотрите карты и выберите одну для обсуждения.',
    'col.saveNote': 'Выбор сохраняется на этом устройстве. Если страница закроется, откройте ту же ссылку или QR-код снова.',
    'col.yourChoice': 'Ваш выбор',
    'col.round': 'Раунд {n}',
    'col.nextRound': 'Следующий раунд',
    'col.nextRoundConfirm': 'Начать следующий раунд? Выбор этого раунда сохранится, и вы сможете выбрать новую карту.',
    'col.noChoice': 'Карта пока не выбрана',
    'col.test': 'Тестовая подборка',
    'col.notFound': 'Подборка не найдена. Проверьте ссылку или попросите фасилитатора показать QR-код ещё раз.',
    'col.empty': 'В этой подборке пока нет карт.',
    'col.saved': 'Выбор сохранён',
    'col.cancelled': 'Выбор отменён',
    'col.roundStarted': 'Раунд {n}: выберите карту',

    'meetings.title': 'Встречи Dialogue Flow',
    'meetings.text': 'Здесь появится расписание встреч по странам и городам, с языком встречи и временем в понятном часовом поясе. Раздел в разработке.',

    'admin.loginTitle': 'Вход для владельца проекта',
    'admin.password': 'Пароль',
    'admin.signIn': 'Войти',
    'admin.wrongPassword': 'Неверный пароль',
    'admin.tooMany': 'Слишком много попыток. Попробуйте через 5 минут.',
    'admin.devHint': 'Режим разработки: пароль dcards-dev (задайте ADMIN_PASSWORD на сервере).',
    'admin.logout': 'Выйти',
    'admin.tabCollections': 'Подборки',
    'admin.tabCards': 'Карты и статистика',

    'cols.title': 'Подборки',
    'cols.lead': 'Подборка — до 40 карт из библиотеки. Участники открывают её по ссылке или QR-коду без регистрации.',
    'cols.newPlaceholder': 'Название, например «Встреча 20 ноября»',
    'cols.create': 'Создать подборку',
    'cols.empty': 'Подборок пока нет.',
    'cols.cards': ['{n} карта', '{n} карты', '{n} карт'],
    'cols.visitors': 'открывали: {n}',
    'cols.selections': 'выборов: {n}',
    'cols.unavailable': 'недоступно: {n}',

    'ed.back': '← Все подборки',
    'ed.titleLabel': 'Название подборки',
    'ed.saving': 'Сохранение…',
    'ed.saved': 'Сохранено',
    'ed.saveError': 'Не сохранено. Повторить',
    'ed.link': 'Ссылка для участников',
    'ed.copy': 'Копировать',
    'ed.copied': 'Ссылка скопирована',
    'ed.showQr': 'Показать QR',
    'ed.downloadQr': 'Скачать QR',
    'ed.openAsParticipant': 'Открыть как участник',
    'ed.liveNote': 'Ссылка всегда показывает текущий состав подборки: изменения сразу видны участникам.',
    'ed.test': 'Тестовая подборка',
    'ed.testHint': 'Выборы в тестовой подборке не попадают в общую статистику карт.',
    'ed.inCollection': 'В подборке {n} из {max}',
    'ed.emptyCollection': 'Добавьте карты из библиотеки ниже.',
    'ed.library': 'Библиотека',
    'ed.libraryHint': 'Нажмите на карту, чтобы добавить её в подборку или убрать.',
    'ed.full': 'В подборке уже {max} карт — уберите одну, чтобы добавить другую.',
    'ed.remove': 'Убрать',
    'ed.view': 'Рассмотреть',
    'ed.unavailableTitle': 'Недоступные карты',
    'ed.unavailableText': 'Эти карты сняты с публикации. Участники их не видят. Можно убрать их из подборки.',
    'ed.removeUnavailable': 'Убрать недоступные',
    'ed.delete': 'Удалить подборку',
    'ed.deleteConfirm': 'Удалить подборку «{title}»? Ссылка и QR-код перестанут работать. Статистика выборов этой подборки тоже будет удалена.',
    'ed.statSel': 'выбрали {n}',
    'ed.visitors': 'Подборку открывали на {n} устройствах',
    'ed.notFound': 'Подборка не найдена.',

    'qr.hint': 'Наведите камеру телефона на QR-код',
    'qr.close': 'Закрыть',

    'cards.title': 'Карты и статистика',
    'cards.uploadTitle': 'Добавить карты',
    'cards.uploadHint': 'JPG, PNG, WebP или TIFF. Каждая карта получит постоянный код автоматически. Исходный файл хранится отдельно от экранной версии.',
    'cards.files': 'Изображения',
    'cards.author': 'Автор',
    'cards.upload': 'Загрузить',
    'cards.uploading': 'Загрузка…',
    'cards.uploaded': 'Добавлено карт: {n}',
    'cards.failed': 'Не удалось обработать: {files}',
    'cards.bulkAuthor': 'Указать автора для всех карт без автора',
    'cards.apply': 'Применить',
    'cards.bulkDone': 'Обновлено карт: {n}',
    'cards.sort': 'Сортировка',
    'cards.sortNumber': 'по номеру',
    'cards.sortPopular': 'по числу выборов',
    'cards.sortRate': 'по доле выборов',
    'cards.stats': 'выбрали {sel} · предложена {off}',
    'cards.rate': 'доля {r}%',
    'cards.testSel': '+{n} в тестовых',
    'cards.inCollections': 'в подборках: {n}',
    'cards.authorPlaceholder': 'Автор не указан',
    'cards.remove': 'Снять с публикации',
    'cards.removeConfirm': 'Снять карту {code} с публикации? Она исчезнет из библиотеки и всех подборок. Вернуть можно в любой момент.',
    'cards.restore': 'Вернуть в библиотеку',
    'cards.removed': 'Снята с публикации',
    'cards.statsNote': '«Выбрали» — сколько раз участники нажали «Выбрать для обсуждения» (текущие выборы, без отменённых). «Предложена» — сколько раз карта была в подборке, которую открыл участник. Без регистрации участник определяется по браузеру: один человек с двух устройств считается дважды. Тестовые подборки считаются отдельно.',
    'cards.savedAuthor': 'Автор сохранён',

    'err.network': 'Не удалось связаться с сервером. Проверьте интернет и попробуйте ещё раз.',
    'err.generic': 'Что-то пошло не так. Попробуйте ещё раз.',
    'err.notFound': 'Страница не найдена.',
    'common.loading': 'Загрузка…',
    'common.retry': 'Повторить',
  },
  en: {
    'nav.library': 'Cards',
    'nav.meetings': 'Meetings',
    'nav.admin': 'Manage',
    'lang.switch': 'RU',
    'lang.switchLabel': 'Переключить на русский',

    'home.eyebrow': 'Dialogue Cards',
    'home.title': 'Illustrations for real conversation',
    'home.lead': 'The cards help people notice their own associations and talk about life experience. Different people may see similar or entirely different meanings in the same illustration.',
    'home.ctaLibrary': 'Browse the cards',
    'home.ctaMeetings': 'Dialogue Flow meetings',
    'home.flowTitle': 'Dialogue Flow meetings',
    'home.flowText': 'A meeting is a chance for meaningful human conversation. The facilitator introduces the format, creates the conditions for talking and leads the closing circle. Most of the conversation happens between participants, often in pairs.',
    'home.howTitle': 'How a card meeting works',
    'home.how1': 'The facilitator prepares a selection of cards in advance.',
    'home.how2': 'Participants open it on their phones via a QR code — no sign-up needed.',
    'home.how3': 'Everyone looks through the cards and picks one to talk about.',
    'home.platform': 'Dialogue Cards brings together artists, curators, facilitators and meeting participants.',
    'home.draft': 'Draft text — visible to the owner only',

    'library.title': 'Card gallery',
    'library.lead': 'Tap a card to see it up close.',
    'library.count': ['{n} card', '{n} cards'],
    'library.empty': 'There are no cards in the gallery yet.',

    'viewer.close': 'Close',
    'viewer.info': 'About this card',
    'viewer.prev': 'Previous card',
    'viewer.next': 'Next card',
    'viewer.code': 'Code',
    'viewer.author': 'Artist',
    'viewer.authorUnknown': 'to be added',
    'viewer.published': 'In the library since',
    'viewer.selectedCount': ['Chosen for a conversation {n} time', 'Chosen for a conversation {n} times'],
    'viewer.selectedNone': 'Not chosen for a conversation yet',
    'viewer.zoomHint': 'Double-tap or pinch to zoom',
    'viewer.choose': 'Choose for discussion',
    'viewer.chooseInstead': 'Choose this card',
    'viewer.chooseInsteadHint': 'It will replace your previous choice in this round',
    'viewer.chosen': 'Chosen for discussion',
    'viewer.cancel': 'Cancel choice',
    'viewer.testNoCount': 'Test selection: choices are not counted in the statistics',

    'col.badge': 'Cards for the meeting',
    'col.hint': 'Look through the cards and choose one to talk about.',
    'col.saveNote': 'Your choice is saved on this device. If the page closes, open the same link or QR code again.',
    'col.yourChoice': 'Your choice',
    'col.round': 'Round {n}',
    'col.nextRound': 'Next round',
    'col.nextRoundConfirm': 'Start the next round? This round’s choice will be kept and you can choose a new card.',
    'col.noChoice': 'No card chosen yet',
    'col.test': 'Test selection',
    'col.notFound': 'Selection not found. Check the link or ask the facilitator to show the QR code again.',
    'col.empty': 'There are no cards in this selection yet.',
    'col.saved': 'Choice saved',
    'col.cancelled': 'Choice cancelled',
    'col.roundStarted': 'Round {n}: choose a card',

    'meetings.title': 'Dialogue Flow meetings',
    'meetings.text': 'The meeting schedule will appear here, by country and city, with the meeting language and time in a clear time zone. This section is in progress.',

    'admin.loginTitle': 'Project owner sign-in',
    'admin.password': 'Password',
    'admin.signIn': 'Sign in',
    'admin.wrongPassword': 'Wrong password',
    'admin.tooMany': 'Too many attempts. Try again in 5 minutes.',
    'admin.devHint': 'Development mode: password dcards-dev (set ADMIN_PASSWORD on the server).',
    'admin.logout': 'Sign out',
    'admin.tabCollections': 'Selections',
    'admin.tabCards': 'Cards & statistics',

    'cols.title': 'Selections',
    'cols.lead': 'A selection holds up to 40 cards from the library. Participants open it via a link or QR code without signing up.',
    'cols.newPlaceholder': 'Title, e.g. “Meeting on 20 November”',
    'cols.create': 'Create selection',
    'cols.empty': 'No selections yet.',
    'cols.cards': ['{n} card', '{n} cards'],
    'cols.visitors': 'opened: {n}',
    'cols.selections': 'choices: {n}',
    'cols.unavailable': 'unavailable: {n}',

    'ed.back': '← All selections',
    'ed.titleLabel': 'Selection title',
    'ed.saving': 'Saving…',
    'ed.saved': 'Saved',
    'ed.saveError': 'Not saved. Retry',
    'ed.link': 'Link for participants',
    'ed.copy': 'Copy',
    'ed.copied': 'Link copied',
    'ed.showQr': 'Show QR',
    'ed.downloadQr': 'Download QR',
    'ed.openAsParticipant': 'Open as participant',
    'ed.liveNote': 'The link always shows the current cards in the selection: changes are visible to participants right away.',
    'ed.test': 'Test selection',
    'ed.testHint': 'Choices made in a test selection do not count towards card statistics.',
    'ed.inCollection': '{n} of {max} cards in the selection',
    'ed.emptyCollection': 'Add cards from the library below.',
    'ed.library': 'Library',
    'ed.libraryHint': 'Tap a card to add it to the selection or remove it.',
    'ed.full': 'The selection already has {max} cards — remove one to add another.',
    'ed.remove': 'Remove',
    'ed.view': 'View',
    'ed.unavailableTitle': 'Unavailable cards',
    'ed.unavailableText': 'These cards were removed from the library. Participants cannot see them. You can remove them from the selection.',
    'ed.removeUnavailable': 'Remove unavailable',
    'ed.delete': 'Delete selection',
    'ed.deleteConfirm': 'Delete the selection “{title}”? Its link and QR code will stop working, and its choice statistics will be deleted too.',
    'ed.statSel': 'chosen {n}',
    'ed.visitors': 'Opened on {n} devices',
    'ed.notFound': 'Selection not found.',

    'qr.hint': 'Point your phone camera at the QR code',
    'qr.close': 'Close',

    'cards.title': 'Cards & statistics',
    'cards.uploadTitle': 'Add cards',
    'cards.uploadHint': 'JPG, PNG, WebP or TIFF. Each card gets a permanent code automatically. The original file is stored separately from the screen version.',
    'cards.files': 'Images',
    'cards.author': 'Artist',
    'cards.upload': 'Upload',
    'cards.uploading': 'Uploading…',
    'cards.uploaded': 'Cards added: {n}',
    'cards.failed': 'Could not process: {files}',
    'cards.bulkAuthor': 'Set the artist for all cards without one',
    'cards.apply': 'Apply',
    'cards.bulkDone': 'Cards updated: {n}',
    'cards.sort': 'Sort',
    'cards.sortNumber': 'by number',
    'cards.sortPopular': 'by choices',
    'cards.sortRate': 'by choice rate',
    'cards.stats': 'chosen {sel} · offered {off}',
    'cards.rate': 'rate {r}%',
    'cards.testSel': '+{n} in test',
    'cards.inCollections': 'in selections: {n}',
    'cards.authorPlaceholder': 'No artist yet',
    'cards.remove': 'Remove from library',
    'cards.removeConfirm': 'Remove card {code} from the library? It will disappear from the library and all selections. You can restore it at any time.',
    'cards.restore': 'Restore to library',
    'cards.removed': 'Removed',
    'cards.statsNote': '“Chosen” counts how many times participants pressed “Choose for discussion” (current choices, cancelled ones excluded). “Offered” counts how many times the card was in a selection a participant opened. Without sign-up a participant is identified by their browser, so one person on two devices counts twice. Test selections are counted separately.',
    'cards.savedAuthor': 'Artist saved',

    'err.network': 'Could not reach the server. Check your connection and try again.',
    'err.generic': 'Something went wrong. Please try again.',
    'err.notFound': 'Page not found.',
    'common.loading': 'Loading…',
    'common.retry': 'Retry',
  },
};

function detect() {
  try {
    const saved = localStorage.getItem('dc_lang');
    if (saved === 'ru' || saved === 'en') return saved;
  } catch { /* storage unavailable */ }
  const langs = navigator.languages || [navigator.language || 'ru'];
  return langs.some((l) => /^(ru|uk|be|kk)/i.test(l)) ? 'ru' : 'en';
}

export let lang = detect();

export function setLang(l) {
  lang = l;
  try { localStorage.setItem('dc_lang', l); } catch { /* ignore */ }
  document.documentElement.lang = l;
}
document.documentElement.lang = lang;

function plural(forms, n) {
  if (lang === 'ru') {
    const m10 = n % 10; const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return forms[0];
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
    return forms[2];
  }
  return n === 1 ? forms[0] : forms[1];
}

export function t(key, vars = {}) {
  let s = dict[lang][key] ?? dict.ru[key] ?? key;
  if (Array.isArray(s)) s = plural(s, Number(vars.n) || 0);
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
}

export function monthLabel(iso) {
  const s = new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-GB', { month: 'long', year: 'numeric' }).format(new Date(iso));
  const clean = s.replace(/\s?г\.$/, '');
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

export function dateLabel(iso) {
  return new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
}
