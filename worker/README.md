# Live board collector

The board analyzer (`analyze.html`) records each board a player asks about. Boards asked about in a row from the same game make a run. Once a run has two boards, `js/live.js` sends them here. Each pair of boards in a row is a confirmed record of one step of a live game.

This folder is a Cloudflare Worker with a D1 database:
- `POST /v1/snapshots` takes up to 10 boards per upload from the analyzer. It rebuilds each board from the fields it knows, rejects anything out of range, and stores the rest. Retries can't make duplicates.
- `GET /v1/export?after=ID` hands every row after `ID` to the repo's workflow. It needs the export token.
- `POST /v1/reports` takes one report of an event, instrument or gift the simulator doesn't know yet. A report has a name, text, what happened, and optionally a screenshot. `js/report.js` crops and shrinks the screenshot in the browser before sending it.

No accounts are needed, and no addresses are stored. Each address may upload 60 times a minute and 1,500 boards a day. That count is kept against a salted hash that changes daily.

The Workers free plan covers this: 100,000 uploads and 100,000 row writes a day, and 5 GB of storage. If a limit is hit, uploads fail until midnight UTC and the analyzer retries later. Nothing is billed.

## Reports of something new

The analyzer's "Report it with a screenshot" links open `js/report.js`. A pasted screenshot goes into that dialog instead of the board reader, and the player can drag a box to send only the part that matters. The page shrinks it to WebP (JPEG where the browser can't make WebP) of at most 1,000 pixels a side and 150 KB, usually 10 to 80 KB. The Worker:
- keeps plain text only, with caps of 80 characters for the name, 2,000 for the text and 1,000 for what happened,
- accepts a screenshot only if its bytes really are WebP, JPEG or PNG, up to 160 KB,
- keeps at most 3 screenshots for each name (names are compared ignoring case and punctuation), and never the same picture twice; later reports keep their text,
- allows each address 20 reports a day.

Reports stay in D1. Nothing serves them publicly, and the workflow doesn't commit them, because they're free text and pictures from anyone and this repo is public. To read them:

```
node tools/live-data.js reports
```

This runs `wrangler` with your own Cloudflare login and downloads the new reports into `trainingdata/reports/`, which git ignores: `reports.jsonl` plus one image file per screenshot. At about 50 KB a screenshot, a free 500 MB database holds around 10,000 of them next to the boards.

## Where the data goes

`.github/workflows/live-data.yml` runs every 6 hours. It calls `node tools/live-data.js pull`, which:
- appends new rows to `beta/data/raw/<date>.jsonl`,
- writes `beta/data/rates.json`, which shows live rarities, beasts, events, doors on offer and more next to the values the simulator uses.

To run it now:

```
gh workflow run live-data.yml
```

Then `git pull` and read `beta/data/rates.json`, or run `node tools/live-data.js rates` for the same report as a table.

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
