const fs = require('fs');
const path = require('path');
// Встроенная в Node.js 22 база SQLite (node:sqlite): не нужна сборка нативных модулей на сервере.
// Предупреждение «SQLite is an experimental feature» не выводим — остальные предупреждения Node остаются.
const emitWarning = process.emitWarning;
process.emitWarning = (w, ...rest) => (String(w && w.message || w).includes('SQLite') ? undefined : emitWarning.call(process, w, ...rest));
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(config.dataDir, { recursive: true });
const db = new DatabaseSync(path.join(config.dataDir, 'dcards.sqlite'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

// db.transaction(fn) — как в better-sqlite3: всё внутри fn выполняется атомарно; вложенные вызовы — через SAVEPOINT.
let depth = 0;
db.transaction = (fn) => (...args) => {
  const sp = `sp${depth}`;
  db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
  depth += 1;
  try {
    const result = fn(...args);
    depth -= 1;
    db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    return result;
  } catch (e) {
    depth -= 1;
    db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw e;
  }
};

const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))";

db.exec(`
-- ---------- люди и роли ----------
CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY,
  email        TEXT UNIQUE,                    -- может быть пустым у заведённых вручную (например, автор первой колоды)
  name         TEXT NOT NULL,
  public_name  TEXT NOT NULL DEFAULT '',       -- публичное имя или псевдоним
  is_demo      INTEGER NOT NULL DEFAULT 0,
  demo_key     TEXT UNIQUE,                    -- для демо-пользователей: artist, curator, …
  created_at   TEXT NOT NULL DEFAULT ${NOW},
  last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS user_roles (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('artist','curator','facilitator','admin')),
  granted_by INTEGER,
  granted_at TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (user_id, role)
);
CREATE TABLE IF NOT EXISTS login_codes (
  id         INTEGER PRIMARY KEY,
  email      TEXT NOT NULL,
  code_hash  TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  used_at    TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS outbox (           -- все письма сайта: отправленные или показанные в демо-режиме
  id         INTEGER PRIMARY KEY,
  to_email   TEXT NOT NULL,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL,                    -- sent | demo | failed
  error      TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

-- ---------- карты ----------
CREATE TABLE IF NOT EXISTS cards (
  id            INTEGER PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  number        INTEGER NOT NULL UNIQUE,
  author        TEXT NOT NULL DEFAULT '',
  image_full    TEXT NOT NULL,
  image_thumb   TEXT NOT NULL,
  image_original TEXT,
  width         INTEGER NOT NULL,
  height        INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','removed')),
  source        TEXT NOT NULL DEFAULT 'upload',
  created_at    TEXT NOT NULL DEFAULT ${NOW},
  published_at  TEXT NOT NULL DEFAULT ${NOW},
  removed_at    TEXT
);
CREATE TABLE IF NOT EXISTS card_versions (    -- прежние изображения карты после одобренного «исправления»
  id          INTEGER PRIMARY KEY,
  card_id     INTEGER NOT NULL REFERENCES cards(id),
  image_full  TEXT NOT NULL,
  image_thumb TEXT NOT NULL,
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  work_id     INTEGER,
  replaced_at TEXT NOT NULL DEFAULT ${NOW}
);

-- ---------- подборки и выбор ----------
CREATE TABLE IF NOT EXISTS collections (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  is_test     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT ${NOW},
  updated_at  TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS collection_cards (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  card_id       INTEGER NOT NULL REFERENCES cards(id),
  position      INTEGER NOT NULL,
  added_at      TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (collection_id, card_id)
);
CREATE TABLE IF NOT EXISTS selections (
  id            INTEGER PRIMARY KEY,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  card_id       INTEGER NOT NULL REFERENCES cards(id),
  visitor_id    TEXT NOT NULL,
  round         INTEGER NOT NULL DEFAULT 1,
  is_test       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT ${NOW},
  cancelled_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sel_card ON selections(card_id) WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sel_visitor ON selections(collection_id, visitor_id);
CREATE TABLE IF NOT EXISTS card_offers (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  card_id       INTEGER NOT NULL REFERENCES cards(id),
  visitor_id    TEXT NOT NULL,
  is_test       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (collection_id, card_id, visitor_id)
);

-- ---------- работы художников и кураторская проверка ----------
CREATE TABLE IF NOT EXISTS submissions (       -- одна отправка (может содержать несколько работ)
  id                INTEGER PRIMARY KEY,
  artist_id         INTEGER NOT NULL REFERENCES users(id),
  terms_version     TEXT NOT NULL,
  terms_accepted_at TEXT NOT NULL,
  is_demo           INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS works (
  id             INTEGER PRIMARY KEY,
  submission_id  INTEGER NOT NULL REFERENCES submissions(id),
  artist_id      INTEGER NOT NULL REFERENCES users(id),
  kind           TEXT NOT NULL DEFAULT 'new' CHECK (kind IN ('new','replacement')),
  target_card_id INTEGER REFERENCES cards(id),   -- для новой версии опубликованной карты
  status         TEXT NOT NULL DEFAULT 'submitted'
                 CHECK (status IN ('submitted','discussion','needs_changes','rejected','published','withdrawn')),
  assigned_to    INTEGER REFERENCES users(id),
  card_id        INTEGER REFERENCES cards(id),   -- карта, созданная или обновлённая этой работой
  is_demo        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT ${NOW},
  updated_at     TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS work_versions (
  id             INTEGER PRIMARY KEY,
  work_id        INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  n              INTEGER NOT NULL,
  image_full     TEXT NOT NULL,
  image_thumb    TEXT NOT NULL,
  image_original TEXT,
  width          INTEGER NOT NULL,
  height         INTEGER NOT NULL,
  note           TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT ${NOW},
  UNIQUE (work_id, n)
);
CREATE TABLE IF NOT EXISTS decisions (         -- история работы: каждое действие куратора и художника
  id               INTEGER PRIMARY KEY,
  work_id          INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  version_n        INTEGER NOT NULL,
  actor_id         INTEGER NOT NULL REFERENCES users(id),
  action           TEXT NOT NULL,              -- submitted, resubmitted, approve, return, reject, assign, discuss, vote, withdraw
  criteria         TEXT NOT NULL DEFAULT '[]', -- номера критериев (JSON)
  comment          TEXT NOT NULL DEFAULT '',
  replacement_type TEXT,                       -- fix | new (для новой версии карты)
  to_user_id       INTEGER REFERENCES users(id),
  created_at       TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS votes (
  work_id    INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  curator_id INTEGER NOT NULL REFERENCES users(id),
  vote       TEXT NOT NULL CHECK (vote IN ('approve','return','reject')),
  comment    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (work_id, curator_id)
);
CREATE TABLE IF NOT EXISTS criteria (
  id             INTEGER PRIMARY KEY,
  number         INTEGER NOT NULL UNIQUE,
  text           TEXT NOT NULL,
  is_placeholder INTEGER NOT NULL DEFAULT 0     -- 1 = временная формулировка, ждёт текста из PDF владельца
);

-- ---------- обсуждения и чаты ----------
CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY,
  card_id    INTEGER NOT NULL REFERENCES cards(id),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  text       TEXT NOT NULL,
  is_demo    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  deleted_at TEXT,
  deleted_by INTEGER
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id         INTEGER PRIMARY KEY,
  room       TEXT NOT NULL CHECK (room IN ('curators','facilitators')),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  text       TEXT NOT NULL,
  is_demo    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

-- ---------- фасилитаторы и встречи ----------
CREATE TABLE IF NOT EXISTS fac_applications (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL UNIQUE REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','submitted','approved','rejected')),
  course_done   TEXT NOT NULL DEFAULT '[]',      -- пройденные главы (JSON)
  answers       TEXT NOT NULL DEFAULT '{}',
  about         TEXT NOT NULL DEFAULT '',
  city          TEXT NOT NULL DEFAULT '',
  decision_note TEXT NOT NULL DEFAULT '',
  decided_by    INTEGER,
  decided_at    TEXT,
  is_demo       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT ${NOW},
  updated_at    TEXT NOT NULL DEFAULT ${NOW}
);
-- заявки на роль куратора: имя, контакт, короткий ответ «почему хочу участвовать»; решает администратор
CREATE TABLE IF NOT EXISTS curator_applications (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL UNIQUE REFERENCES users(id),
  name          TEXT NOT NULL DEFAULT '',
  contact       TEXT NOT NULL DEFAULT '',
  motivation    TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','approved','rejected')),
  decision_note TEXT NOT NULL DEFAULT '',
  decided_by    INTEGER,
  decided_at    TEXT,
  is_demo       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT ${NOW},
  updated_at    TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS meetings (
  id             INTEGER PRIMARY KEY,
  facilitator_id INTEGER NOT NULL REFERENCES users(id),
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  country        TEXT NOT NULL,
  city           TEXT NOT NULL,
  venue          TEXT NOT NULL DEFAULT '',
  language       TEXT NOT NULL,                  -- ru, en, …
  timezone       TEXT NOT NULL,                  -- IANA, например Europe/Moscow
  price_type     TEXT NOT NULL DEFAULT 'free' CHECK (price_type IN ('free','paid')),
  price_note     TEXT NOT NULL DEFAULT '',
  capacity       INTEGER NOT NULL,
  ask_contact    INTEGER NOT NULL DEFAULT 0,     -- показать необязательное поле телефона/мессенджера
  status         TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','unpublished','removed')),
  removed_reason TEXT NOT NULL DEFAULT '',
  removed_by     INTEGER,
  is_demo        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS meeting_dates (
  id         INTEGER PRIMARY KEY,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  starts_at  TEXT NOT NULL,                      -- UTC
  local_time TEXT NOT NULL,                      -- как ввёл фасилитатор: YYYY-MM-DDTHH:MM в поясе встречи
  capacity   INTEGER NOT NULL,                   -- места на эту дату
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled'))
);
CREATE TABLE IF NOT EXISTS registrations (
  id           INTEGER PRIMARY KEY,
  date_id      INTEGER NOT NULL REFERENCES meeting_dates(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  email        TEXT NOT NULL,
  contact      TEXT NOT NULL DEFAULT '',
  token        TEXT NOT NULL UNIQUE,             -- ссылка для отмены без аккаунта
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  is_demo      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT ${NOW},
  cancelled_at TEXT
);
`);

// Миграции для баз, созданных первой версией прототипа.
function addColumn(table, column, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
}
addColumn('cards', 'artist_id', 'INTEGER REFERENCES users(id)');
addColumn('cards', 'is_demo', 'INTEGER NOT NULL DEFAULT 0');
addColumn('cards', 'removed_by', "TEXT NOT NULL DEFAULT ''");          // owner | artist | admin
addColumn('cards', 'print_permission', "TEXT NOT NULL DEFAULT 'not_set'"); // not_set | allowed | denied
addColumn('users', 'site_uid', 'TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_site_uid ON users(site_uid) WHERE site_uid IS NOT NULL');
addColumn('collections', 'owner_id', 'INTEGER REFERENCES users(id)');
addColumn('collections', 'is_demo', 'INTEGER NOT NULL DEFAULT 0');
// Единый счётчик «Выбрали для обсуждения»: выбор в подборке не идёт в счёт, если карту выбрал её автор или демо-роль.
addColumn('meetings', 'duration_min', 'INTEGER');       // продолжительность (мин); у старых встреч — пусто, не выдумываем
addColumn('meetings', 'price_amount', 'REAL');          // стоимость участия с человека (платная встреча)
addColumn('meetings', 'currency', "TEXT NOT NULL DEFAULT ''"); // ISO 4217, например THB
// Запросы фасилитаторов на готовую печатную колоду — для команды проекта.
db.exec(`CREATE TABLE IF NOT EXISTS print_requests (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  note       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','done')),
  is_demo    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
)`);
addColumn('chat_messages', 'work_id', 'INTEGER REFERENCES works(id)'); // вопрос куратора со ссылкой на работу
addColumn('selections', 'counted', 'INTEGER NOT NULL DEFAULT 1');
addColumn('selections', 'user_id', 'INTEGER REFERENCES users(id)');
// Выбор для обсуждения в общей библиотеке (сценарии «Вдвоём» и «В группе»). Один активный выбор карты на браузер и на аккаунт.
db.exec(`CREATE TABLE IF NOT EXISTS library_choices (
  id           INTEGER PRIMARY KEY,
  card_id      INTEGER NOT NULL REFERENCES cards(id),
  visitor_id   TEXT NOT NULL,
  user_id      INTEGER REFERENCES users(id),
  counted      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  cancelled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_lib_card ON library_choices(card_id) WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lib_visitor ON library_choices(visitor_id, card_id) WHERE cancelled_at IS NULL;`);

module.exports = db;
