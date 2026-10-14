-- The live board collector's tables. Apply with:
--   npx wrangler d1 execute tartarus-live --remote --file schema.sql

-- One row per board a player asked about. Boards of the same run share
-- `run`, in `seq` order. `body` is the cleaned snapshot as JSON.
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  received TEXT NOT NULL,
  client TEXT NOT NULL,
  run TEXT NOT NULL,
  seq INTEGER NOT NULL,
  app TEXT NOT NULL,
  body TEXT NOT NULL
);

-- Something the simulator doesn't know yet, reported from the analyzer:
-- an event, instrument or gift, with its text and what happened (body, as
-- JSON) and maybe a small screenshot. norm is the name made comparable, so
-- the Worker keeps only the first few screenshots of each.
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  received TEXT NOT NULL,
  client TEXT NOT NULL,
  app TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  norm TEXT NOT NULL,
  body TEXT NOT NULL,
  image BLOB,
  image_type TEXT,
  image_hash TEXT,
  image_size INTEGER
);
CREATE INDEX IF NOT EXISTS reports_name ON reports (kind, norm);

-- Uploads per address per day, keyed by a salted hash that changes daily,
-- so no address is ever stored.
CREATE TABLE IF NOT EXISTS quota (
  key TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  n INTEGER NOT NULL
);
