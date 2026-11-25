// Соглашение с авторами (25.11.2026): редакции, публикация администрацией, фиксация согласий.
// Пока редакция не опубликована администрацией, подача работ идёт по прежним условиям (config.termsVersion) —
// новая редакция не включается в публичный процесс автоматически.
// Каждая опубликованная редакция хранится полным неизменяемым текстом на своём языке (и отпечатком для проверки целостности).
// Согласие: галочка на первом шаге → запись с серверным временем (UTC); при отправке — привязка к работе и версии изображения.
// Английский перевод — на проверке администрации: в публичный процесс не идёт, пока его не опубликуют отдельно.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const DOC = 'authors';
const VERSION = '1.0';
const DIR = path.join(__dirname, 'data', 'agreements');
const sha = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');

// Краткое изложение для первого шага — дословно, как утверждено (RU). EN — перевод на проверку.
const SHORT = {
  ru: {
    title: 'Условия участия в коллекции',
    intro: 'Прежде чем загрузить свою работу, пожалуйста, ознакомьтесь с основными условиями участия в проекте.',
    blocks: [
      ['Ваши права остаются у вас', 'Вы сохраняете права на свою иллюстрацию и можете свободно использовать её за пределами проекта.'],
      ['Использование в рамках проекта', 'Ваша работа может использоваться в цифровой коллекции, играх, на встречах Dialogue Flow, в открытках, образовательных, информационных и рекламных материалах проекта, включая платную рекламу.'],
      ['Безвозмездное сотрудничество', 'Использование карт в рамках соглашения не предполагает выплаты вознаграждения, в том числе при проведении платных встреч Dialogue Flow. Фасилитаторы могут самостоятельно распечатывать карты для своих встреч без права их продажи.'],
      ['Указание авторства', 'Ваше имя или выбранный вами псевдоним обязательно указывается в библиотеке карт. В других материалах указание авторства зависит от формата использования.'],
      ['Соблюдение авторских прав', 'Загружая изображение, вы подтверждаете, что обладаете необходимыми правами на него, не нарушаете права третьих лиц и можете самостоятельно принять условия соглашения.'],
      ['Свобода участия', 'Ваше разрешение не требует периодического продления. Вы можете в любой момент удалить свою работу из коллекции. Проект прекратит её использование и удалит связанные с ней материалы со своих ресурсов. Ранее сохранённые или распечатанные другими людьми копии могут остаться у них.'],
    ],
    link: 'Читать полный текст соглашения',
    check: 'Я ознакомился(-ась) с полным текстом соглашения и принимаю его условия.',
    cta: 'Продолжить',
  },
  en: {
    title: 'Terms of participation in the collection',
    intro: 'Before you upload your work, please read the main terms of participation in the project.',
    blocks: [
      ['Your rights stay with you', 'You keep the rights to your illustration and may freely use it outside the project.'],
      ['Use within the project', 'Your work may be used in the digital collection, games, at Dialogue Flow meetings, in postcards and in the project’s educational, informational and advertising materials, including paid advertising.'],
      ['Royalty-free cooperation', 'Use of the cards under the agreement does not involve payment of remuneration, including when paid Dialogue Flow meetings are held. Facilitators may print the cards themselves for their meetings, without the right to sell them.'],
      ['Attribution', 'Your name or a pseudonym of your choice is always shown in the card library. In other materials, attribution depends on the format of use.'],
      ['Respect for copyright', 'By uploading an image, you confirm that you hold the necessary rights to it, do not infringe the rights of third parties and can accept the terms of the agreement on your own.'],
      ['Freedom to take part', 'Your permission does not need periodic renewal. You can remove your work from the collection at any time. The project will stop using it and delete the related materials from its resources. Copies saved or printed earlier by other people may remain with them.'],
    ],
    link: 'Read the full text of the agreement',
    check: 'I have read the full text of the agreement and accept its terms.',
    cta: 'Continue',
  },
};

db.exec(`
CREATE TABLE IF NOT EXISTS terms_editions (
  id INTEGER PRIMARY KEY, doc TEXT NOT NULL, version TEXT NOT NULL, lang TEXT NOT NULL,
  title TEXT NOT NULL, body TEXT NOT NULL, short TEXT NOT NULL, hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')), published_at TEXT, published_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), UNIQUE (doc, version, lang)
);
CREATE TABLE IF NOT EXISTS terms_consents (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), edition_id INTEGER NOT NULL REFERENCES terms_editions(id),
  lang TEXT NOT NULL, accepted_at TEXT NOT NULL, text_hash TEXT NOT NULL, purpose TEXT NOT NULL DEFAULT 'submit', target TEXT,
  submission_id INTEGER, work_id INTEGER, work_version_id INTEGER, card_id INTEGER, used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS tc_user ON terms_consents(user_id);`);

/** Черновики редакции 1.0 (RU — утверждённый текст, EN — перевод на проверку). Опубликованный текст не перезаписывается. */
for (const lang of ['ru', 'en']) {
  const body = fs.readFileSync(path.join(DIR, `authors-${VERSION}.${lang}.txt`), 'utf8');
  const title = body.split('\n')[0].trim();
  const ex = db.prepare('SELECT * FROM terms_editions WHERE doc = ? AND version = ? AND lang = ?').get(DOC, VERSION, lang);
  if (!ex) db.prepare('INSERT INTO terms_editions (doc, version, lang, title, body, short, hash) VALUES (?,?,?,?,?,?,?)').run(DOC, VERSION, lang, title, body, JSON.stringify(SHORT[lang]), sha(body));
  else if (ex.status === 'draft') db.prepare('UPDATE terms_editions SET title = ?, body = ?, short = ?, hash = ? WHERE id = ?').run(title, body, JSON.stringify(SHORT[lang]), sha(body), ex.id);
}

const dateText = (iso, lang) => new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso)).replace(/\s?г\.$/, '');
const edOut = (e, { full = false } = {}) => e && ({ id: e.id, doc: e.doc, version: e.version, lang: e.lang, title: e.title, status: e.status, publishedAt: e.published_at, hash: e.hash,
  short: JSON.parse(e.short), ...(full ? { body: e.body } : {}) });
/** Действующая редакция на языке (только опубликованная). */
const current = (lang = 'ru') => db.prepare("SELECT * FROM terms_editions WHERE doc = ? AND lang = ? AND status = 'published' ORDER BY published_at DESC LIMIT 1").get(DOC, lang);
/** Новые условия включены, когда администрация опубликовала русскую редакцию. */
const active = () => !!current('ru');
/** Редакция для показа автору: на его языке, если перевод опубликован, иначе — русский оригинал. */
function forReader(lang) {
  const e = (lang === 'en' && current('en')) || current('ru');
  return e ? { ...edOut(e, { full: true }), translationPending: lang === 'en' && e.lang !== 'en' } : null;
}
const byId = (id) => db.prepare('SELECT * FROM terms_editions WHERE id = ?').get(Number(id));
/** Черновики для администрации (предпросмотр до публикации). */
const drafts = () => db.prepare('SELECT * FROM terms_editions WHERE doc = ? ORDER BY version, lang').all(DOC).map((e) => edOut(e, { full: true }));

/** Публикация редакции администрацией: дата подставляется фактическая, текст с этого момента не меняется. */
function publish(admin, lang) {
  const e = db.prepare("SELECT * FROM terms_editions WHERE doc = ? AND version = ? AND lang = ?").get(DOC, VERSION, lang === 'en' ? 'en' : 'ru');
  if (!e) return { error: 'not_found' };
  if (e.status === 'published') return { ok: true, already: true, edition: edOut(e) };
  if (e.lang === 'en' && !current('ru')) return { error: 'terms_ru_first' };
  const at = new Date().toISOString();
  const body = e.body.replace('{{DATE}}', dateText(at, e.lang));
  db.prepare("UPDATE terms_editions SET status = 'published', published_at = ?, published_by = ?, body = ?, hash = ? WHERE id = ?").run(at, admin.id, body, sha(body), e.id);
  return { ok: true, edition: edOut(byId(e.id)) };
}

/** Галочка на первом шаге: запись с реальным серверным временем. Связь с работой — при отправке. */
function accept(user, { editionId, purpose = 'submit', target = null }) {
  const e = byId(editionId);
  if (!e || e.status !== 'published' || e.doc !== DOC) return { error: 'terms_changed' };
  const cur = current(e.lang); if (!cur || cur.id !== e.id) return { error: 'terms_changed' };
  const p = ['submit', 'replacement', 'resubmit', 'reaccept'].includes(purpose) ? purpose : 'submit';
  const info = db.prepare('INSERT INTO terms_consents (user_id, edition_id, lang, accepted_at, text_hash, purpose, target) VALUES (?,?,?,?,?,?,?)')
    .run(user.id, e.id, e.lang, new Date().toISOString(), e.hash, p, target ? String(target).slice(0, 40) : null);
  return { ok: true, consentId: Number(info.lastInsertRowid), acceptedAt: new Date().toISOString() };
}
/**
 * Проверка согласия при отправке (сервер — прямой запрос к API без галочки не проходит).
 * Согласие должно быть этого автора, по действующей редакции, ещё не использованное и для этой цели.
 */
function check(user, consentId, purpose) {
  const c = db.prepare('SELECT * FROM terms_consents WHERE id = ?').get(Number(consentId));
  if (!c || c.user_id !== user.id || c.used_at) return { error: 'terms_required' };
  if (c.purpose !== purpose) return { error: 'terms_required' };
  const cur = current(c.lang); if (!cur || cur.id !== c.edition_id) return { error: 'terms_changed' };
  return { ok: true, consent: c };
}
/** Привязка к фактически отправленной работе и версии изображения (одна галочка — одна отправка; несколько работ — по записи на каждую). */
function bind(consent, links) {
  const now = new Date().toISOString();
  links.forEach((l, i) => {
    if (i === 0) db.prepare('UPDATE terms_consents SET submission_id = ?, work_id = ?, work_version_id = ?, card_id = ?, used_at = ? WHERE id = ?').run(l.submissionId || null, l.workId || null, l.versionId || null, l.cardId || null, now, consent.id);
    else db.prepare('INSERT INTO terms_consents (user_id, edition_id, lang, accepted_at, text_hash, purpose, target, submission_id, work_id, work_version_id, card_id, used_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(consent.user_id, consent.edition_id, consent.lang, consent.accepted_at, consent.text_hash, consent.purpose, consent.target, l.submissionId || null, l.workId || null, l.versionId || null, l.cardId || null, now);
  });
}
/** Согласия автора — для кабинета: какая редакция, когда, к какой работе. */
function mine(userId) {
  return db.prepare(`SELECT c.*, e.version, e.title, e.published_at FROM terms_consents c JOIN terms_editions e ON e.id = c.edition_id
    WHERE c.user_id = ? AND c.used_at IS NOT NULL ORDER BY c.accepted_at DESC`).all(userId)
    .map((c) => ({ id: c.id, editionId: c.edition_id, version: c.version, lang: c.lang, title: c.title, acceptedAt: c.accepted_at, workId: c.work_id, workVersionId: c.work_version_id, cardId: c.card_id, purpose: c.purpose }));
}
/** Текст именно принятой редакции — автору, принявшему её (или администрации). Опубликованные редакции открыты всем. */
function editionText(id, user, isAdmin) {
  const e = byId(id); if (!e) return null;
  if (e.status === 'published' || isAdmin) return edOut(e, { full: true });
  return null;
}

module.exports = { DOC, VERSION, SHORT, active, current, forReader, publish, accept, check, bind, mine, editionText, drafts, byId };
