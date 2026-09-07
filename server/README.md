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
- `/`: the preview table, with kind filter and an unchanged-rows toggle.

`$core` is an alias for `../src`, so the pure `planner.ts`, `reconcile.ts` and `config.ts` are imported
as source and bundled by Vite. No copy, no build step in the parent.

Not here yet: `POST /api/apply`, config editing, the people picker, the Leaflet map.

## Build

    npm run build && node build     # adapter-node, PORT and HOST respected
