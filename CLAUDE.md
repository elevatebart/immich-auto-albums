# immich-auto-albums

Planner that clusters an Immich library into event albums (trips, day trips, gatherings at home,
person-years, seasonal buckets, fixed events) and reconciles them with existing albums. Node 22, TS strict, ESM.

## Layout
- `src/planner.ts`: pure, no I/O. `plan(cfg, assets, opts) -> { plans, absorbed }`. Every rule is a `planX(ctx, assets)` function.
- `src/reconcile.ts`: pure. `reconcile(plans, managedAlbums) -> Action[]` (create | update | noop). Handles user renames.
- `src/config.ts`: `config.toml` -> `Config`. TOML keys are snake_case, `Config` is camelCase.
- `src/immich.ts`: fetch client for the Immich REST API (`x-api-key` header, `/api` prefix).
- `src/cli.ts`: `preview` and `apply`. Writes `run_*.log`, `decisions_*.csv`, `plan_*.json` to `out_dir`.
- `server/`: SvelteKit UI. Imports `src/` through the `$core` alias (`server/vite.config.ts`).
  `server/src/lib/server/*` holds the I/O, `server/src/lib/types.ts` the wire types. `GET /api/preview` and
  `POST /api/apply` exist; apply needs the preview token plus `confirm: true`, and `src/lib/server/apply.ts` is the only
  path that mutates Immich. No config editing yet. `DEMO=1` swaps in a fixture library and makes apply a dry run.
- `test/planner.test.ts`: golden cases. Run `npm test` before and after any planner change.

## Invariants
- Planner and reconcile stay pure so a Svelte UI and, later, an Immich WASM plugin can wrap them.
- `Asset.t` encodes Immich `localDateTime` as a UTC-labelled Date; use `getUTC*` accessors only. Never introduce a tz library.
- Only albums whose description starts with the marker are ever touched. Description line 2 is `auto: <generated name>`;
  when album name != auto name the user renamed it and the name is preserved.
- Event kinds (trip, daytrip, gathering) match existing albums by >=50% asset overlap within 45 days; person, season, event match by key.
- The API key comes from `IMMICH_API_KEY` only. Never write it to config or logs.
- Immich API facts verified against the OpenAPI spec: `POST /search/metadata` (page/size/withExif/visibility/personIds/takenAfter as full ISO datetime),
  `GET /people?withHidden=false&page&size`, `GET/POST/PATCH /albums`, `PUT/DELETE /albums/{id}/assets`. Permissions needed:
  asset.read, person.read, album.read, album.create, album.update, albumAsset.create, albumAsset.delete, user.read.

## Code style
- Comments and JSDoc at most 2 lines. No em dashes anywhere. Straight quotes.
- Prefer small pure functions; no classes except the API client.
- Names in albums are English; place names come from Immich's geocoder through `normPlace` (aliases in config).

## Roadmap
1. `server/`: SvelteKit app. Server routes hold the API key, expose `GET /api/preview` (reconcile output + centroids) and `POST /api/apply`,
   read/write `config.toml`. UI: sliders for `clustering.*`, people picker from `/api/people`, Leaflet map for homes, date pickers for events,
   preview table with create/update/rename badges and a map of cluster centroids.
2. JSON Schema for `Config`, shared by the form and by a future Immich plugin settings form.
3. Docker image for the NAS (`node:22-slim`), monthly run via DSM Task Scheduler as root.

## Running
    npm ci && npm run build && npm test
    IMMICH_API_KEY=... IMMICH_URL=http://nas:2283 CONFIG=./config.toml npm run preview
