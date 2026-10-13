# Live board collector

The board analyzer (`analyze.html`) records each board a player asks about. Boards asked about in a row from the same game make a run. Once a run has two boards, `js/live.js` sends them here. Each pair of boards in a row is a confirmed record of one step of a live game.

This folder is a Cloudflare Worker with a D1 database:
- `POST /v1/snapshots` takes up to 10 boards per upload from the analyzer. It rebuilds each board from the fields it knows, rejects anything out of range, and stores the rest. Retries can't make duplicates.
- `GET /v1/export?after=ID` hands every row after `ID` to the repo's workflow. It needs the export token.

No accounts are needed, and no addresses are stored. Each address may upload 60 times a minute and 1,500 boards a day. That count is kept against a salted hash that changes daily.

The Workers free plan covers this: 100,000 uploads and 100,000 row writes a day, and 5 GB of storage. If a limit is hit, uploads fail until midnight UTC and the analyzer retries later. Nothing is billed.

## Where the data goes

`.github/workflows/live-data.yml` runs every 6 hours. It calls `node tools/live-data.js pull`, which:
- appends new rows to `data/live/raw/<date>.jsonl`,
- writes `data/live/rates.json`, which shows live rarities, beasts, events, doors on offer and more next to the values the simulator uses.

To run it now:

```
gh workflow run live-data.yml
```

Then `git pull` and read `data/live/rates.json`, or run `node tools/live-data.js rates` for the same report as a table.

## Setup (already done once)

From this folder, with Node 18+:

```
npx wrangler login
npx wrangler d1 create tartarus-live          # put its id in wrangler.jsonc
npx wrangler d1 execute tartarus-live --remote --file schema.sql
npx wrangler deploy
npx wrangler secret put EXPORT_TOKEN          # a long random string
npx wrangler secret put IP_SALT               # another long random string
gh secret set LIVE_DATA_TOKEN                 # the same value as EXPORT_TOKEN
```

The secrets live only in Cloudflare and in GitHub's encrypted repo secrets, never in the repo. Every value in `wrangler.jsonc` is safe to publish.

To try it locally:
1. Put `EXPORT_TOKEN=...` and `IP_SALT=...` in `worker/.dev.vars`. Git ignores this file.
2. Run `npx wrangler d1 execute tartarus-live --local --file schema.sql`.
3. Run `npx wrangler dev`.
