# server

SvelteKit UI for the planner. Roadmap item 1, first slice: read-only preview.

    cd server && npm install
    IMMICH_API_KEY=... npm run dev        # http://localhost:5173
    DEMO=1 npm run dev                   # no Immich needed, fixture library

Env: `IMMICH_API_KEY` (required unless `DEMO=1`), `IMMICH_URL`, `CONFIG` (default `../config.toml`),
`WINDOW_DAYS`. The key stays server side; it is never sent to the browser or written to the config.
`server/.env` works in dev and is gitignored.

## What is here

- `GET /api/preview` -> `Preview` (`src/lib/types.ts`): stats plus one row per reconcile action,
  with the create/update/noop op, rename flags, asset counts and the cluster centroid. Asset ids stay
  on the server. `?refresh=1` bypasses the 10 minute cache.
- `POST /api/apply` -> `ApplyResponse`. Body: `{ token, confirm: true, ids? }`. The token is the digest of the
  preview rows, so a plan that moved since the caller looked at it is rejected with 409 rather than written blind;
  a missing `confirm` is 400. `ids` narrows the write to those rows, omitted means every changed row. One failed
  row does not stop the others. Writes invalidate the cache. Under `DEMO=1` it reports `dryRun: true` and writes nothing.
- `GET /api/config` -> `ConfigResponse`: the parsed `Config`, the file text and an etag.
- `PUT /api/config` -> `ConfigWriteResponse`. Body: `{ etag, config, dryRun? }`. Replaces the file wholesale, so it
  takes the etag from GET and answers 409 when the file moved underneath. Every field is validated and all problems
  come back at once as `issues[{field, message}]` with 400. `dryRun` renders the TOML and the warnings without
  writing. A write copies the old file to `config.toml.bak`, writes through a temp file in the same directory, then
  renames, and drops the preview cache. `warnings` covers legal but costly edits, such as a new marker orphaning
  the albums tagged with the old one.
- `/`: the preview table, with kind filter, unchanged-rows toggle, per-row checkboxes and a confirm panel that
  spells out the counts before anything is written.

`$core` is an alias for `../src`, so the pure `planner.ts`, `reconcile.ts` and `config.ts` are imported
as source and bundled by Vite. No copy, no build step in the parent.

Config values are camelCase on the wire and snake_case in the file; `toToml` owns that mapping and regenerates the
explanatory comments from a template, so a UI write leaves the file as readable as a hand-edited one.

Not here yet: the config form itself, the people picker, the Leaflet map.

There is no auth in front of any of this, so bind it to the LAN.

## Build

    npm run build && node build     # adapter-node, PORT and HOST respected
