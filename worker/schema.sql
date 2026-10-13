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

-- Uploads per address per day, keyed by a salted hash that changes daily,
-- so no address is ever stored.
CREATE TABLE IF NOT EXISTS quota (
  key TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  n INTEGER NOT NULL
);
