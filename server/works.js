// Работы авторов и кураторская проверка.
// Статусы работы: submitted (на рассмотрении), discussion (вынесена на обсуждение кураторов), needs_changes (возвращена
// на доработку), rejected (отклонена), published (опубликована), withdrawn (отозвана автором).
// Каждое действие пишется в историю (decisions). Отказ и возврат требуют выбрать хотя бы один критерий.
// С 17.11.2026 куратор не публикует сам: «Рекомендовать к публикации» ставит работу в очередь администратора
// (recommended_at; статус для показа — recommended). В галерею работа попадает только по решению администратора.
// Возврат и отклонение куратор делает сам, без подтверждения администратора.
const { demoWhere } = require('./demo-scope');
const db = require('./db');
const terms = require('./terms');
const config = require('./config');
const cards = require('./cards');
const mediaUrl = (kind, file) => `${require('./site').base()}/media/works/${kind}/${file}`;

const PLACEHOLDER_CRITERIA = 5;
const effStatus = (w) => (w.recommended_at && ['submitted', 'discussion'].includes(w.status) ? 'recommended' : w.status);
/** Временные критерии: формулировки будут перенесены из PDF владельца (самим список не придумываем). */
function ensureCriteria() {
  if (db.prepare('SELECT COUNT(*) AS n FROM criteria').get().n) return;
  const ins = db.prepare('INSERT INTO criteria (number, text, is_placeholder) VALUES (?, ?, 1)');
  for (let i = 1; i <= PLACEHOLDER_CRITERIA; i++) ins.run(i, `Критерий ${i} — формулировка будет перенесена из PDF владельца проекта`);
}
ensureCriteria();

const criteriaList = () => db.prepare('SELECT number, text, is_placeholder AS placeholder FROM criteria ORDER BY number').all()
  .map((c) => ({ ...c, placeholder: !!c.placeholder }));
function criteriaByNumbers(nums) {
  const all = new Map(criteriaList().map((c) => [c.number, c]));
  return (nums || []).map((n) => all.get(Number(n))).filter(Boolean);
}
function setCriteria(list) {
  const clean = (list || []).map((c, i) => ({ number: Number(c.number) || i + 1, text: String(c.text || '').trim().slice(0, 500) }))
    .filter((c) => c.text);
  if (!clean.length) return { error: 'empty' };
  if (new Set(clean.map((c) => c.number)).size !== clean.length) return { error: 'duplicate_numbers' };
  db.transaction(() => {
    db.prepare('DELETE FROM criteria').run();
    const ins = db.prepare('INSERT INTO criteria (number, text, is_placeholder) VALUES (?, ?, 0)');
    for (const c of clean) ins.run(c.number, c.text);
  })();
  return { ok: true };
}

const userName = (id) => {
  const u = id && db.prepare('SELECT name, public_name FROM users WHERE id = ?').get(id);
  return u ? (u.public_name || u.name) : '';
};

const q = {
  work: db.prepare('SELECT * FROM works WHERE id = ?'),
  versions: db.prepare('SELECT * FROM work_versions WHERE work_id = ? ORDER BY n'),
  lastVersion: db.prepare('SELECT * FROM work_versions WHERE work_id = ? ORDER BY n DESC LIMIT 1'),
  history: db.prepare('SELECT * FROM decisions WHERE work_id = ? ORDER BY id'),
  lastDecision: db.prepare(`SELECT * FROM decisions WHERE work_id = ? AND action IN ('approve','return','reject') ORDER BY id DESC LIMIT 1`),
  votes: db.prepare('SELECT * FROM votes WHERE work_id = ? ORDER BY created_at'),
  log: db.prepare(`INSERT INTO decisions (work_id, version_n, actor_id, action, criteria, comment, replacement_type, to_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  setStatus: db.prepare(`UPDATE works SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`),
  card: db.prepare('SELECT * FROM cards WHERE id = ?'),
};

function versionOut(v) {
  // файлы удалены (отклонена окончательно или снята автором) — без ссылок на изображение
  if (v.purged_at) return { n: v.n, id: v.id, thumb: null, full: null, purged: true, width: v.width, height: v.height, note: v.note, createdAt: v.created_at };
  return { n: v.n, id: v.id, thumb: mediaUrl('thumb', v.image_thumb), full: mediaUrl('full', v.image_full), width: v.width, height: v.height, note: v.note, createdAt: v.created_at };
}
function decisionOut(d) {
  const crit = criteriaByNumbers(JSON.parse(d.criteria || '[]'));
  return { action: d.action, versionN: d.version_n, actor: userName(d.actor_id), criteria: crit, comment: d.comment,
    replacementType: d.replacement_type, toUser: userName(d.to_user_id), createdAt: d.created_at };
}
function workOut(w, { full = false } = {}) {
  const versions = q.versions.all(w.id);
  const last = versions[versions.length - 1];
  const target = w.target_card_id ? q.card.get(w.target_card_id) : null;
  const result = q.lastDecision.get(w.id);
  const out = {
    id: w.id, submissionId: w.submission_id, kind: w.kind, status: effStatus(w), isDemo: !!w.is_demo,
    recommendedBy: w.recommended_at ? userName(w.recommended_by) : null, recommendedAt: w.recommended_at || null, recommendedType: w.recommended_type || null,
    artist: userName(w.artist_id), artistId: w.artist_id,
    version: last ? versionOut(last) : null, versionsCount: versions.length,
    targetCard: target ? cards.publicCard(target, { withDetails: true }) : null,
    card: w.card_id ? (() => { const c = q.card.get(w.card_id); return c ? { code: c.code, status: c.status } : null; })() : null,
    lastResult: result ? decisionOut(result) : null,
    createdAt: w.created_at, updatedAt: w.updated_at,
  };
  if (full) {
    out.versions = versions.map(versionOut);
    out.history = q.history.all(w.id).map(decisionOut);
    out.votes = q.votes.all(w.id).map((v) => ({ curator: userName(v.curator_id), curatorId: v.curator_id, vote: v.vote, comment: v.comment, createdAt: v.created_at }));
    out.targetCardOldVersions = target ? db.prepare('SELECT * FROM card_versions WHERE card_id = ? ORDER BY id').all(target.id)
      .map((v, i) => ({ id: v.id, label: `v${i + 1}`, thumb: v.revoked_at ? null : cards.mediaUrl('thumb', v.image_thumb), revoked: !!v.revoked_at, replacedAt: v.replaced_at })) : [];
  }
  return out;
}

// ---------- автор ----------
/** Отправка: одна или несколько работ, у каждой — свой статус. */
async function submit(artist, files, { termsAccepted, termsVersion, notes = [], clientKey = '', consentId = null }) {
  // новая редакция соглашения (опубликована администрацией) — согласие по отдельной записи; иначе — прежние условия
  let consent = null;
  if (terms.active()) { const c = terms.check(artist, consentId, 'submit'); if (c.error && !clientKey) return c; consent = c.consent || null; }
  else if (!termsAccepted || termsVersion !== config.termsVersion) return { error: 'terms_required' };
  const key = String(clientKey || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || null;
  // повтор той же отправки (связь оборвалась после того, как сервер её принял) — возвращаем уже созданные работы
  if (key) {
    const prev = db.prepare('SELECT id FROM submissions WHERE artist_id = ? AND client_key = ?').get(artist.id, key);
    if (prev) return { ids: db.prepare('SELECT id FROM works WHERE submission_id = ? ORDER BY id').all(prev.id).map((x) => x.id), failed: [], repeated: true };
  }
  if (terms.active() && !consent) return { error: 'terms_required' };
  if (!files.length) return { error: 'no_images' };
  const processed = [];
  const failed = [];
  // по два файла одновременно: быстрее, чем по одному, и без лишней нагрузки на сервер
  for (let i = 0; i < files.length; i += 2) {
    const part = await Promise.all(files.slice(i, i + 2).map((f) => cards.processImage(f.buffer, f.originalname, 'works').then((img) => ({ img, name: f.originalname })).catch(() => { failed.push(f.originalname); return null; })));
    processed.push(...part.filter(Boolean));
  }
  if (!processed.length) return { error: 'bad_images', failed };
  const ids = db.transaction(() => {
    const ed = consent ? terms.byId(consent.edition_id) : null;
    const sub = db.prepare('INSERT INTO submissions (artist_id, terms_version, terms_accepted_at, is_demo, client_key) VALUES (?, ?, ?, ?, ?)')
      .run(artist.id, ed ? `${ed.doc}-${ed.version}-${ed.lang}` : termsVersion, consent ? consent.accepted_at : new Date().toISOString(), artist.is_demo ? 1 : 0, key);
    const out = []; const links = [];
    processed.forEach(({ img }, i) => {
      const w = db.prepare('INSERT INTO works (submission_id, artist_id, is_demo) VALUES (?, ?, ?)').run(sub.lastInsertRowid, artist.id, artist.is_demo ? 1 : 0);
      const v = db.prepare('INSERT INTO work_versions (work_id, n, image_full, image_thumb, image_original, width, height, note) VALUES (?, 1, ?, ?, ?, ?, ?, ?)')
        .run(w.lastInsertRowid, img.full, img.thumb, img.original, img.width, img.height, String(notes[i] || '').slice(0, 500));
      q.log.run(w.lastInsertRowid, 1, artist.id, 'submitted', '[]', '', null, null);
      out.push(w.lastInsertRowid); links.push({ submissionId: Number(sub.lastInsertRowid), workId: Number(w.lastInsertRowid), versionId: Number(v.lastInsertRowid) });
    });
    if (consent) terms.bind(consent, links); // согласие — к фактически отправленным файлам
    return out;
  })();
  return { ids, failed };
}

/** Новая версия опубликованной карты: опубликованная остаётся видна до решения куратора. */
async function proposeReplacement(artist, cardCode, file, { termsAccepted, termsVersion, note = '', consentId = null }) {
  const card = db.prepare('SELECT * FROM cards WHERE code = ?').get(cardCode);
  if (!card || card.artist_id !== artist.id) return { error: 'not_your_card' };
  if (card.status !== 'published') return { error: 'card_not_published' };
  let consent = null;
  if (terms.active()) { const c = terms.check(artist, consentId, 'replacement'); if (c.error) return c; consent = c.consent; }
  else if (!termsAccepted || termsVersion !== config.termsVersion) return { error: 'terms_required' };
  const img = await cards.processImage(file.buffer, file.originalname, 'works');
  const id = db.transaction(() => {
    const ed = consent ? terms.byId(consent.edition_id) : null;
    const sub = db.prepare('INSERT INTO submissions (artist_id, terms_version, terms_accepted_at, is_demo) VALUES (?, ?, ?, ?)')
      .run(artist.id, ed ? `${ed.doc}-${ed.version}-${ed.lang}` : termsVersion, consent ? consent.accepted_at : new Date().toISOString(), artist.is_demo ? 1 : 0);
    const w = db.prepare(`INSERT INTO works (submission_id, artist_id, kind, target_card_id, is_demo) VALUES (?, ?, 'replacement', ?, ?)`)
      .run(sub.lastInsertRowid, artist.id, card.id, artist.is_demo ? 1 : 0);
    const v = db.prepare('INSERT INTO work_versions (work_id, n, image_full, image_thumb, image_original, width, height, note) VALUES (?, 1, ?, ?, ?, ?, ?, ?)')
      .run(w.lastInsertRowid, img.full, img.thumb, img.original, img.width, img.height, String(note).slice(0, 500));
    q.log.run(w.lastInsertRowid, 1, artist.id, 'submitted', '[]', '', null, null);
    if (consent) terms.bind(consent, [{ submissionId: Number(sub.lastInsertRowid), workId: Number(w.lastInsertRowid), versionId: Number(v.lastInsertRowid), cardId: card.id }]);
    return w.lastInsertRowid;
  })();
  return { id };
}

/** Исправление загружается в ту же заявку: новая версия той же работы, работа снова на рассмотрении. */
async function addVersion(artist, workId, file, note = '', consentId = null) {
  const w = q.work.get(workId);
  if (!w || w.artist_id !== artist.id) return { error: 'not_found' };
  if (!['needs_changes', 'submitted'].includes(w.status)) return { error: 'not_editable', status: w.status };
  let consent = null;
  if (terms.active()) { const c = terms.check(artist, consentId, 'resubmit'); if (c.error) return c; consent = c.consent; }
  const img = await cards.processImage(file.buffer, file.originalname, 'works');
  db.transaction(() => {
    const n = q.lastVersion.get(workId).n + 1;
    const v = db.prepare('INSERT INTO work_versions (work_id, n, image_full, image_thumb, image_original, width, height, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(workId, n, img.full, img.thumb, img.original, img.width, img.height, String(note).slice(0, 500));
    if (consent) terms.bind(consent, [{ submissionId: w.submission_id, workId, versionId: Number(v.lastInsertRowid) }]);
    q.setStatus.run('submitted', workId);
    db.prepare('UPDATE works SET recommended_at = NULL, recommended_by = NULL, recommended_type = NULL WHERE id = ?').run(workId);
    q.log.run(workId, n, artist.id, 'resubmitted', '[]', String(note).slice(0, 500), null, null);
  })();
  return { ok: true };
}

function myWorks(artistId) {
  return db.prepare('SELECT * FROM works WHERE artist_id = ? ORDER BY id DESC').all(artistId).map((w) => workOut(w, { full: true }));
}
function myCards(artistId) {
  return db.prepare('SELECT * FROM cards WHERE artist_id = ? ORDER BY number').all(artistId).map((c) => ({
    ...cards.publicCard(c, { withDetails: true }), status: c.status, removedBy: c.removed_by,
    selectedCount: require('./choices').total(c.id), // тот же счётчик «Выбрали для разговора», что в галерее
    pendingReplacement: !!db.prepare(`SELECT 1 FROM works WHERE target_card_id = ? AND status IN ('submitted','discussion','needs_changes')`).get(c.id),
    version: `v${(db.prepare('SELECT COUNT(*) AS n FROM card_versions WHERE card_id = ?').get(c.id).n || 0) + 1}`,
    oldVersions: db.prepare('SELECT * FROM card_versions WHERE card_id = ? ORDER BY id').all(c.id).map((v, i) => ({ id: v.id, label: `v${i + 1}`, revoked: !!v.revoked_at, replacedAt: v.replaced_at })),
  }));
}
/** Автор сам убирает свою карту (без одобрения куратора). Обсуждение карты перестаёт быть публичным. */
function withdrawCard(artist, code) {
  const c = db.prepare('SELECT * FROM cards WHERE code = ?').get(code);
  if (!c || c.artist_id !== artist.id) return { error: 'not_your_card' };
  if (c.status !== 'published') return { error: 'already_removed' };
  // отзыв разрешения: карта сразу недоступна, файлы удаляются, фасилитаторы получают уведомление (collection.js)
  return require('./collection').removeFinal(c, 'artist');
}
/** Автор снимает работу с кураторского рассмотрения: файлы удаляются, фасилитаторам ничего не уходит (карта не публиковалась). */
function withdrawWork(artist, workId) {
  const w = q.work.get(workId);
  if (!w || w.artist_id !== artist.id) return { error: 'not_found' };
  if (!['submitted', 'discussion', 'needs_changes'].includes(w.status)) return { error: 'not_editable', status: w.status };
  db.transaction(() => { q.setStatus.run('withdrawn', w.id); q.log.run(w.id, q.lastVersion.get(w.id).n, artist.id, 'withdraw', '[]', '', null, null); })();
  require('./collection').purgeWorkFiles(w.id);
  return { ok: true };
}
/** Отзыв разрешения на прежнюю версию своей опубликованной карты. */
function revokeOldVersion(artist, code, versionId) {
  const c = db.prepare('SELECT * FROM cards WHERE code = ?').get(code);
  if (!c || c.artist_id !== artist.id) return { error: 'not_your_card' };
  return require('./collection').revokeVersion(c, versionId, 'artist');
}

// ---------- куратор ----------
function queue(showDemo) {
  return db.prepare(`SELECT * FROM works WHERE status IN ('submitted','discussion') AND recommended_at IS NULL AND ${demoWhere(showDemo, 'is_demo')} ORDER BY updated_at`)
    .all().map((w) => workOut(w));
}
/** Кураторы рекомендовали — ждут решения администратора. */
function recommendedQueue(showDemo) {
  return db.prepare(`SELECT * FROM works WHERE status IN ('submitted','discussion') AND recommended_at IS NOT NULL AND ${demoWhere(showDemo, 'is_demo')} ORDER BY recommended_at`)
    .all().map((w) => workOut(w));
}
/** Обзор решений для администратора: рекомендации, возвраты и отклонения — автор, дата, причины. */
function decisionsLog(showDemo, limit = 100) {
  return db.prepare(`SELECT d.*, w.artist_id, w.is_demo FROM decisions d JOIN works w ON w.id = d.work_id
    WHERE d.action IN ('recommend','approve','return','reject') AND ${demoWhere(showDemo, 'w.is_demo')} ORDER BY d.id DESC LIMIT ?`).all(limit)
    .map((d) => ({ ...decisionOut(d), workId: d.work_id, artist: userName(d.artist_id), isDemo: !!d.is_demo,
      thumb: (() => { const v = db.prepare('SELECT image_thumb FROM work_versions WHERE work_id = ? AND n = ?').get(d.work_id, d.version_n); return v ? mediaUrl('thumb', v.image_thumb) : null; })() }));
}
function recentDecided(showDemo) {
  // Принятые решения за последние 30 дней (период показывается кураторам явно).
  return db.prepare(`SELECT * FROM works WHERE (status NOT IN ('submitted','discussion') OR recommended_at IS NOT NULL) AND updated_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days') AND ${demoWhere(showDemo, 'is_demo')} ORDER BY updated_at DESC LIMIT 200`)
    .all().map((w) => workOut(w));
}
function detail(id) { const w = q.work.get(id); return w ? workOut(w, { full: true }) : null; }
function canSee(user, roles, workId) {
  const w = q.work.get(workId);
  if (!w) return false;
  if (w.artist_id === user.id) return true;
  if (user.is_demo && !w.is_demo) return false; // демо-куратор не видит настоящие работы
  return roles.includes('curator') || roles.includes('admin');
}

/**
 * Решение куратора: recommend — рекомендовать к публикации (очередь администратора; в галерею ещё не попадает),
 * return / reject — сразу, с хотя бы одним критерием (комментарий — по желанию). Прежний action 'approve' от куратора
 * теперь тоже означает рекомендацию. Новая версия: тип (fix — та же карта, new — новая карта) выбирает куратор при рекомендации.
 */
function decide(curator, workId, { action, criteria = [], comment = '', replacementType }) {
  const w = q.work.get(workId);
  if (!w) return { error: 'not_found' };
  if (w.artist_id === curator.id) return { error: 'own_work' }; // свою работу рассматривают другие кураторы
  if (!['submitted', 'discussion'].includes(w.status)) return { error: 'not_in_review', status: w.status };
  if (action === 'approve') action = 'recommend';
  if (!['recommend', 'return', 'reject'].includes(action)) return { error: 'bad_action' };
  const crit = criteriaByNumbers(criteria).map((c) => c.number);
  if (action !== 'recommend' && !crit.length) return { error: 'criteria_required' };
  if (action === 'recommend' && w.recommended_at) return { error: 'already_recommended' };
  if (action === 'recommend' && w.kind === 'replacement' && !['fix', 'new'].includes(replacementType)) return { error: 'replacement_type_required' };
  const v = q.lastVersion.get(workId);
  const rejectedIds = [];
  const res = db.transaction(() => {
    if (action === 'recommend') {
      db.prepare(`UPDATE works SET recommended_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), recommended_by = ?, recommended_type = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
        .run(curator.id, w.kind === 'replacement' ? replacementType : null, w.id);
    } else {
      q.setStatus.run(action === 'return' ? 'needs_changes' : 'rejected', w.id);
      if (action === 'reject') rejectedIds.push(w.id); // окончательно отклонена — изображение удаляется (после записи решения)
      db.prepare('UPDATE works SET recommended_at = NULL, recommended_by = NULL, recommended_type = NULL WHERE id = ?').run(w.id);
    }
    const info = q.log.run(w.id, v.n, curator.id, action, JSON.stringify(crit), String(comment).slice(0, 2000), action === 'recommend' ? (replacementType || null) : null, null);
    return { ok: true, decisionId: Number(info.lastInsertRowid), recommended: action === 'recommend' };
  })();
  for (const id of rejectedIds) require('./collection').purgeWorkFiles(id);
  return res;
}

/**
 * Окончательное решение администратора по рекомендованной работе. publish — публикация (новая работа → новая карта
 * с автоматическим кодом; новая версия fix — та же карта: код и обсуждение сохраняются, прежнее изображение уходит в историю
 * card_versions; new — новая карта). Можно также вернуть или отклонить (с критериями).
 */
function adminDecide(admin, workId, { action, criteria = [], comment = '', replacementType }) {
  const w = q.work.get(workId);
  if (!w) return { error: 'not_found' };
  if (!['submitted', 'discussion'].includes(w.status)) return { error: 'not_in_review', status: w.status };
  if (!['publish', 'return', 'reject'].includes(action)) return { error: 'bad_action' };
  if (action !== 'publish') return decide(admin, workId, { action, criteria, comment });
  if (!w.recommended_at) return { error: 'not_recommended' };
  const type = w.kind === 'replacement' ? (replacementType || w.recommended_type) : null;
  if (w.kind === 'replacement' && !['fix', 'new'].includes(type)) return { error: 'replacement_type_required' };
  const v = q.lastVersion.get(workId);
  const artist = db.prepare('SELECT * FROM users WHERE id = ?').get(w.artist_id);
  const authorName = artist ? (artist.public_name || artist.name) : '';
  const after = [];
  const res = db.transaction(() => {
    let cardCode = null;
    cards.copyWorkImage(v);
    if (w.kind === 'replacement' && type === 'fix') {
      const card = q.card.get(w.target_card_id);
      db.prepare('INSERT INTO card_versions (card_id, image_full, image_thumb, width, height, work_id) VALUES (?, ?, ?, ?, ?, ?)')
        .run(card.id, card.image_full, card.image_thumb, card.width, card.height, w.id);
      db.prepare('UPDATE cards SET image_full = ?, image_thumb = ?, image_original = ?, width = ?, height = ? WHERE id = ?')
        .run(v.image_full, v.image_thumb, v.image_original, v.width, v.height, card.id);
      db.prepare('UPDATE works SET card_id = ? WHERE id = ?').run(card.id, w.id);
      cardCode = card.code; after.push(() => require('./collection').updated(q.card.get(card.id), w.id));
    } else {
      const card = cards.insertCard({ author: authorName, image_full: v.image_full, image_thumb: v.image_thumb, image_original: v.image_original,
        width: v.width, height: v.height, artist_id: w.artist_id, is_demo: w.is_demo, source: 'work' });
      db.prepare('UPDATE works SET card_id = ? WHERE id = ?').run(card.id, w.id);
      cardCode = card.code; after.push(() => require('./collection').added(q.card.get(card.id)));
    }
    q.setStatus.run('published', w.id);
    const info = q.log.run(w.id, v.n, admin.id, 'approve', '[]', String(comment).slice(0, 2000), type, null);
    return { ok: true, cardCode, decisionId: Number(info.lastInsertRowid) };
  })();
  after.forEach((f) => { try { f(); } catch (e) { console.error('collection:', e.message); } });
  return res;
}

/**
 * Вынести работу на обсуждение кураторов. Куратор пишет вопрос («Что хотите обсудить с коллегами?») и подтверждает:
 * вопрос публикуется в чате кураторов со ссылкой на работу. Коллеги открывают работу по ссылке и оставляют голоса и комментарии.
 * Пороги голосования не согласованы: голоса видны, решение принимает куратор.
 */
function discuss(curator, workId, question = '') {
  const w = q.work.get(workId);
  if (w && w.artist_id === curator.id) return { error: 'own_work' };
  if (!w || w.status !== 'submitted') return { error: 'not_in_review' };
  const text = String(question || '').trim().slice(0, 2000);
  if (!text) return { error: 'question_required' };
  return db.transaction(() => {
    q.setStatus.run('discussion', workId);
    q.log.run(workId, q.lastVersion.get(workId).n, curator.id, 'discuss', '[]', text, null, null);
    db.prepare('INSERT INTO chat_messages (room, user_id, text, is_demo, work_id) VALUES (?, ?, ?, ?, ?)').run('curators', curator.id, text, curator.is_demo ? 1 : 0, workId);
    return { ok: true };
  })();
}
function vote(curator, workId, value, comment = '') {
  const w = q.work.get(workId);
  if (w && w.artist_id === curator.id) return { error: 'own_work' };
  if (!w || w.status !== 'discussion') return { error: 'not_in_discussion' };
  if (!['approve', 'return', 'reject'].includes(value)) return { error: 'bad_vote' };
  db.prepare(`INSERT INTO votes (work_id, curator_id, vote, comment) VALUES (?, ?, ?, ?)
              ON CONFLICT(work_id, curator_id) DO UPDATE SET vote = excluded.vote, comment = excluded.comment, created_at = excluded.created_at`)
    .run(workId, curator.id, value, String(comment).slice(0, 1000));
  q.log.run(workId, q.lastVersion.get(workId).n, curator.id, 'vote', '[]', `${value}${comment ? ': ' + comment : ''}`.slice(0, 1000), null, null);
  return { ok: true };
}
const curators = () => db.prepare(`SELECT DISTINCT u.id, COALESCE(NULLIF(u.public_name,''), u.name) AS name, u.is_demo FROM users u
  JOIN user_roles r ON r.user_id = u.id WHERE r.role = 'curator' ORDER BY name`).all();

/** Доступ к изображениям работ на рассмотрении: автору, кураторам и администраторам. */
function workMediaAllowed(file, user, roles) {
  if (!user) return false;
  const row = db.prepare('SELECT w.artist_id, w.is_demo FROM work_versions v JOIN works w ON w.id = v.work_id WHERE v.image_full = ? OR v.image_thumb = ?').get(file, file);
  if (!row) return false;
  if (row.artist_id === user.id) return true;
  if (user.is_demo && !row.is_demo) return false; // демо-куратор не видит файлы настоящих работ
  return roles.includes('curator') || roles.includes('admin');
}

module.exports = {
  criteriaList, setCriteria, submit, proposeReplacement, addVersion, myWorks, myCards, withdrawCard, withdrawWork, revokeOldVersion,
  queue, recommendedQueue, decisionsLog, recentDecided, detail, canSee, decide, adminDecide, discuss, vote, curators, workMediaAllowed,
};
