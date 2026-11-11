const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(config.dataDir, { recursive: true });
const db = new Database(path.join(config.dataDir, 'dcards.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS cards (
  id            INTEGER PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,         -- постоянный код карты, присваивается автоматически
  number        INTEGER NOT NULL UNIQUE,      -- порядковый номер, из него строится код
  author        TEXT NOT NULL DEFAULT '',
  image_full    TEXT NOT NULL,                -- путь в data/media
  image_thumb   TEXT NOT NULL,
  image_original TEXT,                        -- исходный файл (если загружен через сайт)
  width         INTEGER NOT NULL,
  height        INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','removed')),
  source        TEXT NOT NULL DEFAULT 'upload', -- 'seed' | 'upload'
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  published_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  removed_at    TEXT
);

CREATE TABLE IF NOT EXISTS collections (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,            -- часть публичной ссылки /s/<slug>
  title       TEXT NOT NULL,
  is_test     INTEGER NOT NULL DEFAULT 0,      -- выборы в тестовой подборке не идут в общую статистику
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS collection_cards (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  card_id       INTEGER NOT NULL REFERENCES cards(id),
  position      INTEGER NOT NULL,
  added_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (collection_id, card_id)
);

-- Выбор карты для обсуждения. visitor_id — случайный идентификатор браузера участника, без личных данных.
-- Отменённые и заменённые выборы не удаляются, а помечаются (cancelled_at), чтобы не терять историю.
CREATE TABLE IF NOT EXISTS selections (
  id            INTEGER PRIMARY KEY,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  card_id       INTEGER NOT NULL REFERENCES cards(id),
  visitor_id    TEXT NOT NULL,
  round         INTEGER NOT NULL DEFAULT 1,
  is_test       INTEGER NOT NULL DEFAULT 0,     -- копия флага подборки на момент выбора
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  cancelled_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sel_card ON selections(card_id) WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sel_visitor ON selections(collection_id, visitor_id);

-- Сколько раз карта была предложена участникам: первое открытие подборки участником.
CREATE TABLE IF NOT EXISTS card_offers (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  card_id       INTEGER NOT NULL REFERENCES cards(id),
  visitor_id    TEXT NOT NULL,
  is_test       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (collection_id, card_id, visitor_id)
);
`);

module.exports = db;
