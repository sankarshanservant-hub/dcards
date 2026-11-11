// Работы художников и кураторская проверка.
// Статусы работы: submitted (на рассмотрении), discussion (вынесена на обсуждение кураторов), needs_changes (возвращена
// на доработку), rejected (отклонена), published (опубликована), withdrawn (отозвана художником).
// Каждое действие пишется в историю (decisions). Отказ и возврат требуют выбрать хотя бы один критерий.
const db = require('./db');
const config = require('./config');
const cards = require('./cards');
const mediaUrl = (kind, file) => `${config.basePath}/media/works/${kind}/${file}`;

const PLACEHOLDER_CRITERIA = 5;
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
  return { n: v.n, thumb: mediaUrl('thumb', v.image_thumb), full: mediaUrl('full', v.image_full), width: v.width, height: v.height, note: v.note, createdAt: v.created_at };
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
    id: w.id, submissionId: w.submission_id, kind: w.kind, status: w.status, isDemo: !!w.is_demo,
    artist: userName(w.artist_id), artistId: w.artist_id,
    assignedTo: w.assigned_to ? { id: w.assigned_to, name: userName(w.assigned_to) } : null,
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
      .map((v) => ({ thumb: cards.mediaUrl('thumb', v.image_thumb), replacedAt: v.replaced_at })) : [];
  }
  return out;
}

// ---------- художник ----------
/** Отправка: одна или несколько работ, у каждой — свой статус. */
async function submit(artist, files, { termsAccepted, termsVersion, notes = [] }) {
  if (!termsAccepted || termsVersion !== config.termsVersion) return { error: 'terms_required' };
  if (!files.length) return { error: 'no_images' };
  const processed = [];
  const failed = [];
  for (const f of files) {
    try { processed.push({ img: await cards.processImage(f.buffer, f.originalname, 'works'), name: f.originalname }); }
    catch { failed.push(f.originalname); }
  }
  if (!processed.length) return { error: 'bad_images', failed };
  const ids = db.transaction(() => {
    const sub = db.prepare('INSERT INTO submissions (artist_id, terms_version, terms_accepted_at, is_demo) VALUES (?, ?, ?, ?)')
      .run(artist.id, termsVersion, new Date().toISOString(), artist.is_demo ? 1 : 0);
    const out = [];
    processed.forEach(({ img }, i) => {
      const w = db.prepare('INSERT INTO works (submission_id, artist_id, is_demo) VALUES (?, ?, ?)').run(sub.lastInsertRowid, artist.id, artist.is_demo ? 1 : 0);
      db.prepare('INSERT INTO work_versions (work_id, n, image_full, image_thumb, image_original, width, height, note) VALUES (?, 1, ?, ?, ?, ?, ?, ?)')
        .run(w.lastInsertRowid, img.full, img.thumb, img.original, img.width, img.height, String(notes[i] || '').slice(0, 500));
      q.log.run(w.lastInsertRowid, 1, artist.id, 'submitted', '[]', '', null, null);
      out.push(w.lastInsertRowid);
    });
    return out;
  })();
  return { ids, failed };
}

/** Новая версия опубликованной карты: опубликованная остаётся видна до решения куратора. */
async function proposeReplacement(artist, cardCode, file, { termsAccepted, termsVersion, note = '' }) {
  const card = db.prepare('SELECT * FROM cards WHERE code = ?').get(cardCode);
  if (!card || card.artist_id !== artist.id) return { error: 'not_your_card' };
  if (card.status !== 'published') return { error: 'card_not_published' };
  if (!termsAccepted || termsVersion !== config.termsVersion) return { error: 'terms_required' };
  const img = await cards.processImage(file.buffer, file.originalname, 'works');
  const id = db.transaction(() => {
    const sub = db.prepare('INSERT INTO submissions (artist_id, terms_version, terms_accepted_at, is_demo) VALUES (?, ?, ?, ?)')
      .run(artist.id, termsVersion, new Date().toISOString(), artist.is_demo ? 1 : 0);
    const w = db.prepare(`INSERT INTO works (submission_id, artist_id, kind, target_card_id, is_demo) VALUES (?, ?, 'replacement', ?, ?)`)
      .run(sub.lastInsertRowid, artist.id, card.id, artist.is_demo ? 1 : 0);
    db.prepare('INSERT INTO work_versions (work_id, n, image_full, image_thumb, image_original, width, height, note) VALUES (?, 1, ?, ?, ?, ?, ?, ?)')
      .run(w.lastInsertRowid, img.full, img.thumb, img.original, img.width, img.height, String(note).slice(0, 500));
    q.log.run(w.lastInsertRowid, 1, artist.id, 'submitted', '[]', '', null, null);
    return w.lastInsertRowid;
  })();
  return { id };
}

/** Исправление загружается в ту же заявку: новая версия той же работы, работа снова на рассмотрении. */
async function addVersion(artist, workId, file, note = '') {
  const w = q.work.get(workId);
  if (!w || w.artist_id !== artist.id) return { error: 'not_found' };
  if (!['needs_changes', 'submitted'].includes(w.status)) return { error: 'not_editable', status: w.status };
  const img = await cards.processImage(file.buffer, file.originalname, 'works');
  db.transaction(() => {
    const n = q.lastVersion.get(workId).n + 1;
    db.prepare('INSERT INTO work_versions (work_id, n, image_full, image_thumb, image_original, width, height, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(workId, n, img.full, img.thumb, img.original, img.width, img.height, String(note).slice(0, 500));
    q.setStatus.run('submitted', workId);
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
    pendingReplacement: !!db.prepare(`SELECT 1 FROM works WHERE target_card_id = ? AND status IN ('submitted','discussion','needs_changes')`).get(c.id),
  }));
}
/** Художник сам убирает свою карту (без одобрения куратора). Обсуждение карты перестаёт быть публичным. */
function withdrawCard(artist, code) {
  const c = db.prepare('SELECT * FROM cards WHERE code = ?').get(code);
  if (!c || c.artist_id !== artist.id) return { error: 'not_your_card' };
  if (c.status !== 'published') return { error: 'already_removed' };
  db.prepare(`UPDATE cards SET status = 'removed', removed_by = 'artist', removed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(c.id);
  return { ok: true };
}

// ---------- куратор ----------
function queue(showDemo) {
  return db.prepare(`SELECT * FROM works WHERE status IN ('submitted','discussion') AND ${showDemo ? '1=1' : 'is_demo = 0'} ORDER BY updated_at`)
    .all().map((w) => workOut(w));
}
function recentDecided(showDemo) {
  return db.prepare(`SELECT * FROM works WHERE status NOT IN ('submitted','discussion') AND ${showDemo ? '1=1' : 'is_demo = 0'} ORDER BY updated_at DESC LIMIT 30`)
    .all().map((w) => workOut(w));
}
function detail(id) { const w = q.work.get(id); return w ? workOut(w, { full: true }) : null; }
function canSee(user, roles, workId) {
  const w = q.work.get(workId);
  if (!w) return false;
  return w.artist_id === user.id || roles.includes('curator') || roles.includes('admin');
}

/**
 * Решение куратора. approve — публикует (новая работа → новая карта с автоматическим кодом;
 * новая версия: fix — та же карта, номер и обсуждение сохраняются; new — новая карта со своим номером и обсуждением).
 * return / reject — обязательно хотя бы один критерий.
 */
function decide(curator, workId, { action, criteria = [], comment = '', replacementType }) {
  const w = q.work.get(workId);
  if (!w) return { error: 'not_found' };
  if (!['submitted', 'discussion'].includes(w.status)) return { error: 'not_in_review', status: w.status };
  if (!['approve', 'return', 'reject'].includes(action)) return { error: 'bad_action' };
  const crit = criteriaByNumbers(criteria).map((c) => c.number);
  if (action !== 'approve' && !crit.length) return { error: 'criteria_required' };
  if (action === 'approve' && w.kind === 'replacement' && !['fix', 'new'].includes(replacementType)) return { error: 'replacement_type_required' };
  const v = q.lastVersion.get(workId);
  const artist = db.prepare('SELECT * FROM users WHERE id = ?').get(w.artist_id);
  const authorName = artist ? (artist.public_name || artist.name) : '';
  return db.transaction(() => {
    let cardCode = null;
    if (action === 'approve') {
      cards.copyWorkImage(v);
      if (w.kind === 'replacement' && replacementType === 'fix') {
        const card = q.card.get(w.target_card_id);
        db.prepare('INSERT INTO card_versions (card_id, image_full, image_thumb, width, height, work_id) VALUES (?, ?, ?, ?, ?, ?)')
          .run(card.id, card.image_full, card.image_thumb, card.width, card.height, w.id);
        db.prepare('UPDATE cards SET image_full = ?, image_thumb = ?, image_original = ?, width = ?, height = ? WHERE id = ?')
          .run(v.image_full, v.image_thumb, v.image_original, v.width, v.height, card.id);
        db.prepare('UPDATE works SET card_id = ? WHERE id = ?').run(card.id, w.id);
        cardCode = card.code;
      } else {
        const card = cards.insertCard({ author: authorName, image_full: v.image_full, image_thumb: v.image_thumb, image_original: v.image_original,
          width: v.width, height: v.height, artist_id: w.artist_id, is_demo: w.is_demo, source: 'work' });
        db.prepare('UPDATE works SET card_id = ? WHERE id = ?').run(card.id, w.id);
        cardCode = card.code;
      }
      q.setStatus.run('published', w.id);
    } else {
      q.setStatus.run(action === 'return' ? 'needs_changes' : 'rejected', w.id);
    }
    q.log.run(w.id, v.n, curator.id, action, JSON.stringify(crit), String(comment).slice(0, 2000), action === 'approve' ? (replacementType || null) : null, null);
    return { ok: true, cardCode };
  })();
}

/** Передать работу другому куратору — работа остаётся в очереди с ответственным. */
function assign(curator, workId, toUserId) {
  const w = q.work.get(workId);
  if (!w || !['submitted', 'discussion'].includes(w.status)) return { error: 'not_in_review' };
  const target = db.prepare(`SELECT u.id FROM users u JOIN user_roles r ON r.user_id = u.id WHERE u.id = ? AND r.role IN ('curator','admin')`).get(toUserId);
  if (!target) return { error: 'not_a_curator' };
  db.prepare(`UPDATE works SET assigned_to = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(toUserId, workId);
  q.log.run(workId, q.lastVersion.get(workId).n, curator.id, 'assign', '[]', '', null, toUserId);
  return { ok: true };
}
/** Вынести сложную работу на обсуждение кураторов. Пороги голосования не согласованы: голоса видны, решение принимает куратор. */
function discuss(curator, workId, comment = '') {
  const w = q.work.get(workId);
  if (!w || w.status !== 'submitted') return { error: 'not_in_review' };
  q.setStatus.run('discussion', workId);
  q.log.run(workId, q.lastVersion.get(workId).n, curator.id, 'discuss', '[]', String(comment).slice(0, 2000), null, null);
  return { ok: true };
}
function vote(curator, workId, value, comment = '') {
  const w = q.work.get(workId);
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

/** Доступ к изображениям работ на рассмотрении: художнику-автору, кураторам и администраторам. */
function workMediaAllowed(file, user, roles) {
  if (!user) return false;
  if (roles.includes('curator') || roles.includes('admin')) return true;
  const row = db.prepare('SELECT w.artist_id FROM work_versions v JOIN works w ON w.id = v.work_id WHERE v.image_full = ? OR v.image_thumb = ?').get(file, file);
  return !!row && row.artist_id === user.id;
}

module.exports = {
  criteriaList, setCriteria, submit, proposeReplacement, addVersion, myWorks, myCards, withdrawCard,
  queue, recentDecided, detail, canSee, decide, assign, discuss, vote, curators, workMediaAllowed,
};
