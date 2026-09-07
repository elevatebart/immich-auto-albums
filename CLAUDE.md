# immich-auto-albums

Planner that clusters an Immich library into event albums (trips, day trips, gatherings at home,
person-years, seasonal buckets, fixed events) and reconciles them with existing albums. Node 22, TS strict, ESM.

## Layout
- `src/planner.ts`: pure, no I/O. `plan(cfg, assets, opts) -> { plans, absorbed }`. Every rule is a `planX(ctx, assets)` function.
  `opts.scope`: `window` plans only what the rolling window holds in full, `all` plans the whole library. The planner
  defaults to `all`; the CLI and the server default to `window` and take `--all` / `SCOPE=all` / `?scope=all`.
- `src/reconcile.ts`: pure. `reconcile(plans, managedAlbums) -> Action[]` (create | update | rename | noop). `update`
  moves photos, `rename` only writes the title and the `auto:` line. Handles user renames.
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
  types. Routes: `GET`/`POST /api/preview` (saved config, draft config), `POST /api/apply`, `GET`/`PUT /api/config`,
  `GET /api/people`, `GET /api/people/<id>/thumbnail`, `GET /api/assets/<id>/thumbnail`, `POST /api/albums/assets`,
  `GET /api/geocode`. One page, `/`: handles left, albums right. A draft preview carries no token, so only a plan from
  the saved config can be applied. Apply needs the preview token plus `confirm: true`, and
  `apply.ts` is the only path that mutates Immich. Config writes need the file etag, are validated field by field in
  `config-io.ts`, keep a `.bak` and swap through a temp file. `DEMO=1` swaps in a fixture library, apply then dry runs.
- `python/immich_auto_albums.py`: the original stdlib implementation this was ported from, reading the same
  `config.toml`. Kept working; see `python/README.md` for where the two differ.
- `test/planner.test.ts`: golden cases. Run `npm test` before and after any planner change. Tests read
  `test/fixtures/config.toml`, never the real one.

## Config files
- The TOML format has two readers, `src/config.ts` and `python/immich_auto_albums.py`. A change to it means
  checking both, and dates stay bare TOML dates because the Python side compares real `date` objects.
- `config.toml` is local and gitignored: it holds homes and household names. `config.example.toml` is the committed
  starting point, `test/fixtures/config.toml` is the tests' own copy, `config.schema.json` is the generated schema.
- A missing config answers 404 on every route with the hint to copy the example.
- Address lookups try Immich's geodata first. Nominatim is the fallback and sends the query out, so it stays
  switchable off with `GEOCODER=immich`.

## Invariants
- Planner and reconcile stay pure so a Svelte UI and, later, an Immich WASM plugin can wrap them.
- `Asset.t` encodes Immich `localDateTime` as a UTC-labelled Date; use `getUTC*` accessors only. Never introduce a tz library.
- One source of truth for config bounds: the schema. Ranges, hints and defaults come from it, never hardcoded in a
  form or a second validator.
- Description line 1 is `<marker> kind=<kind> key=<key>`, and `key=` must stay last on it: a person key is
  `<full name>:<year>` and an event key is `<name>:<from>`, both of which contain spaces, so the parser reads the key
  to the end of the line.
- Only albums whose description starts with the marker are ever touched. Description line 2 is `auto: <generated name>`;
  when album name != auto name the user renamed it and the name is preserved. Renaming in Immich is the only way to
  override a generated name: there is no config key for it.
- Event kinds (trip, daytrip, gathering) match existing albums by >=50% asset overlap within 45 days; person, season, event match by key.
- In `window` scope a person year, season or fixed event is planned only when the window covers it in full, so a
  partial slice can never strip photos out of an album that a full run created. Face tags are still fetched from
  `taggedSince(ctx)`, which reaches further back than the planned years: a trip needs its faces even when the year
  it sits in is not planned.
- The API key comes from `IMMICH_API_KEY` only. Never write it to config or logs.
- Immich API facts verified against the OpenAPI spec: `POST /search/metadata` (page/size/withExif/visibility/personIds/takenAfter as full ISO datetime),
  `GET /people?withHidden=false&page&size`, `GET /people/{id}/thumbnail` (octet-stream),
  `POST /search/metadata` with `albumIds` for an album's asset ids: `AlbumResponseDto` carries only `assetCount`,
  `GET /albums/{id}` does not return assets, and reading `detail.assets` silently yields an empty set, which makes
  every trip-like album miss its match and get recreated.
  `GET /search/places?name=` (`{name, latitude, longitude, admin1name, admin2name}`),
  `GET /assets/{id}/thumbnail?size=thumbnail|preview` (needs `asset.view`), `GET/POST/PATCH /albums`,
  `PUT/DELETE /albums/{id}/assets`. Permissions needed:
  asset.read, person.read, album.read, album.create, album.update, albumAsset.create, albumAsset.delete, user.read.

## Code style
- Comments and JSDoc at most 2 lines. No em dashes anywhere. Straight quotes.
- Prefer small pure functions; no classes except the API client.
- Names in albums are English; place names come from Immich's geocoder through `normPlace` (aliases in config).

## Roadmap
1. Done. `server/` holds the API key, exposes preview, apply, config, people, geocode and album assets. The UI has the
   clustering sliders, the face-tile people picker, an address lookup for the homes, event date pickers, and the album
   list with badges, thumbnails and a modal that shows the whole album plus, for a trip, where its photos were taken.
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
    npm run preview -- --all      # the whole library, not just the window
