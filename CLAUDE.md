# immich-auto-albums

Planner that clusters an Immich library into event albums (trips, day trips, gatherings at home,
person-years, seasonal buckets, fixed events) and reconciles them with existing albums. Node 22, TS strict, ESM.

## Layout
- `src/planner.ts`: pure, no I/O. `plan(cfg, assets, opts) -> { plans, absorbed }`. Every rule is a `planX(ctx, assets)` function.
- `src/reconcile.ts`: pure. `reconcile(plans, managedAlbums) -> Action[]` (create | update | noop). Handles user renames.
- `src/config.ts`: `config.toml` -> `Config` (`fromToml`, which validates) and back (`toToml`, canonical, comments
  from a fixed template). TOML keys are snake_case, `Config` is camelCase.
- `src/schema.ts`: JSON Schema 2020-12 for `Config`, plus `schemaField(path)`. No validator import, so a form can
  pull ranges and descriptions without Ajv. `config.schema.json` is generated from it by `npm run schema`.
- `src/validate.ts`: `validateConfig(raw) -> { config, issues }` on Ajv. Fills defaults, collects every problem, and
  adds the order rules JSON Schema cannot express (homes chronological, event `to` after `from`).
- `src/immich.ts`: fetch client for the Immich REST API (`x-api-key` header, `/api` prefix).
- `src/cli.ts`: `preview` and `apply`. Writes `run_*.log`, `decisions_*.csv`, `plan_*.json` to `out_dir`.
- `server/`: SvelteKit UI, `@immich/ui` components on Tailwind 4 so it matches Immich. Imports `src/` through the
  `$core` alias (`server/vite.config.ts`). `server/src/lib/server/*` holds the I/O, `server/src/lib/types.ts` the wire
  types. Routes: `GET /api/preview`, `POST /api/apply`, `GET`/`PUT /api/config`, `GET /api/people`. Pages: `/` preview
  table, `/config` form. Apply needs the preview token plus `confirm: true`, and
  `apply.ts` is the only path that mutates Immich. Config writes need the file etag, are validated field by field in
  `config-io.ts`, keep a `.bak` and swap through a temp file. `DEMO=1` swaps in a fixture library, apply then dry runs.
- `test/planner.test.ts`: golden cases. Run `npm test` before and after any planner change. Tests read
  `test/fixtures/config.toml`, never the real one.

## Config files
- `config.toml` is local and gitignored: it holds homes and household names. `config.example.toml` is the committed
  starting point, `test/fixtures/config.toml` is the tests' own copy, `config.schema.json` is the generated schema.
- A missing config answers 404 on every route with the hint to copy the example.

## Invariants
- Planner and reconcile stay pure so a Svelte UI and, later, an Immich WASM plugin can wrap them.
- `Asset.t` encodes Immich `localDateTime` as a UTC-labelled Date; use `getUTC*` accessors only. Never introduce a tz library.
- One source of truth for config bounds: the schema. Ranges, hints and defaults come from it, never hardcoded in a
  form or a second validator.
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
1. Done. `server/` holds the API key, exposes preview, apply, config and people. The UI has the clustering sliders, the
   people picker, the Leaflet homes map, event date pickers, the preview table with badges and the centroid map, which
   is cross-linked with the table through a focused row id.
2. Done. `src/schema.ts` holds the schema, `config.schema.json` is the generated artifact for outside consumers, and
   the form takes every slider range and hint from it.
3. Done. `Dockerfile` has a `cli` target for the scheduled run and a default target that adds the UI, both on
   `node:22-slim` with `/data` as the only mount. README has the DSM task. Cross-builds to amd64 for the NAS.

## Docker
- `cli` target: root deps plus `dist`. Default target adds `server/build` and the server deps.
- `docker/entrypoint.sh` dispatches `preview`, `apply`, `serve`, anything else runs verbatim.
- Never bake `config.toml` into an image: `.dockerignore` excludes it.

## Running
    npm ci && npm run build && npm test
    IMMICH_API_KEY=... IMMICH_URL=http://nas:2283 CONFIG=./config.toml npm run preview
