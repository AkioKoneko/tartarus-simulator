-- Pictures from Follow my game (js/auto.js), in their own database so they
-- can never crowd out the boards. Create and apply once:
--   npx wrangler d1 create tartarus-captures
--   (add the CAPTURES binding it prints to wrangler.jsonc)
--   npx wrangler d1 execute tartarus-captures --remote --file captures.sql

-- One row per picture: the log lines that set it off and what the reader
-- made of it (body, as JSON), and the picture itself, shrunk by the page.
CREATE TABLE IF NOT EXISTS captures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  received TEXT NOT NULL,
  client TEXT NOT NULL,
  app TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  image BLOB NOT NULL,
  image_type TEXT NOT NULL,
  image_hash TEXT NOT NULL,
  image_size INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS captures_hash ON captures (image_hash);

-- Counters: pictures per address per day (a salted hash that changes
-- daily), per day from everyone (day:<date>), and stored in all (stored).
CREATE TABLE IF NOT EXISTS counts (
  key TEXT PRIMARY KEY,
  n INTEGER NOT NULL
);
