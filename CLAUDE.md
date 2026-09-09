# immich-auto-albums

Planner that clusters an Immich library into event albums (trips, day trips, gatherings at home,
person-years, seasonal buckets, fixed events) and reconciles them with existing albums. Node 22, TS strict, ESM.

## Layout
- `src/planner.ts`: pure, no I/O. `plan(cfg, assets, opts) -> { plans, absorbed, folded }`. Every rule is a `planX(ctx, assets)` function.
  `opts.scope`: `window` plans only what the rolling window holds in full, `all` plans the whole library. The planner
  defaults to `all`; the CLI and the server default to `window` and take `--all` / `SCOPE=all` / `?scope=all`.
- `src/reconcile.ts`: pure. `reconcile(plans, managedAlbums) -> Action[]` (create | update | rename | noop). `update`
  moves photos, `rename` only writes the title and the `auto:` line. Handles user renames.
- `src/config.ts`: `config.toml` -> `Config` (`fromToml`, which validates) and back (`toToml`, canonical, comments
  from a fixed template). TOML keys are snake_case, `Config` is camelCase.
- `src/schema.ts`: JSON Schema 2020-12 for `Config`, plus `schemaField(path)`. No validator import, so a form can
  pull ranges and descriptions without Ajv. `config.schema.json` is generated from it by `npm run schema`.
- `src/diff.ts`: pure. `diffConfig(base, next) -> { changes, gone }` keyed by the form's field paths, plus `kindAt`,
  `countAt` and `countAll` for a container or a card header. Array items pair up by identity first (a home by its
  date, an event by name and date, a zone circle by its rank inside its name) and by position for what is left, so
  an edited row reads as changed and a deleted one as gone. Name lists are compared as sets, `aliases` by key.
- `src/validate.ts`: `validateConfig(raw) -> { config, issues }` on Ajv. Fills defaults, collects every problem, and
  adds the order rules JSON Schema cannot express (homes chronological, event `to` after `from`).
- `src/immich.ts`: fetch client for the Immich REST API (`/api` prefix). `request()` and `authHeader()` are shared
  with `auth.ts`; a `Credential` is either an api key (`x-api-key`) or a session token (`Authorization: Bearer`).
  `attachDistricts` enriches assets with admin2 through the places endpoint and caches the hits per city.
- `src/auth.ts`: pure. Sign in with email and password, create the labelled child session, sweep leftovers, mint a
  scoped api key, and `verifyCredential` which probes one endpoint per permission the planner reads.
- `src/env-file.ts`: writes `IMMICH_API_KEY` into the env file beside the config, atomically, only when asked.
- `src/prompt.ts`, `src/login.ts`: the CLI's `login` flow, raw mode prompts, no dependency.
- `src/cli.ts`: `login`, `preview` and `apply`. Writes `run_*.log`, `decisions_*.csv`, `plan_*.json` to `out_dir`.
  `login` runs before the config is required and takes `--save`; `preview` and `apply` never prompt.
- `server/`: SvelteKit UI, `@immich/ui` components on Tailwind 4 so it matches Immich. Imports `src/` through the
  `$core` alias (`server/vite.config.ts`). `server/src/lib/server/*` holds the I/O, `server/src/lib/types.ts` the wire
  types. Routes: `GET`/`POST`/`PUT`/`DELETE /api/auth` (state, sign in or mint a key with `?key=1`, save a key,
  sign out), `GET`/`POST /api/preview` (saved config, draft config), `POST /api/apply`, `GET`/`PUT /api/config`,
  `GET /api/people`, `GET /api/people/<id>/thumbnail`, `GET /api/assets/<id>/thumbnail`, `POST /api/albums/assets`,
  `GET /api/geocode`, `GET /api/towns`, `GET /api/progress`. `GET /api/config` also returns the parsed
  `config.example.toml` as `defaults`, the second baseline the form highlights changes against. One page, `/`: the sign in card when there is no credential and no
  `DEMO=1`, otherwise handles left, albums right, with the account bar and the optional API key card above the
  config form. Apply takes a token that must match a replan of the
  same config, saved or draft, so a write always matches a plan someone looked at. Apply needs the preview token plus `confirm: true`, and
  `apply.ts` is the only path that mutates Immich. Config writes need the file etag, are validated field by field in
  `config-io.ts`, keep a `.bak` and swap through a temp file. `DEMO=1` swaps in a fixture library, apply then dry runs.
- `test/planner.test.ts`: golden cases. Run `npm test` before and after any planner change. Tests read
  `test/fixtures/config.toml`, never the real one.

## Config files
- `src/config.ts` is the only reader of the TOML format. Dates stay bare TOML dates: `toToml` writes them bare
  and the schema documents `YYYY-MM-DD`, though `fromToml` also accepts them quoted.
- `config.toml` is local and gitignored: it holds homes and household names. `config.example.toml` is the committed
  starting point, `test/fixtures/config.toml` is the tests' own copy, `config.schema.json` is the generated schema.
- A missing config answers 404 on every route with the hint to copy the example, and the CLI exits 1 with the same.
- Credentials live in `/.env` at the repo root, gitignored, with `.env.example` tracked. `envFilePath(configFile)`
  resolves it (`ENV_FILE`, else `.env` beside the config), which is `/data/.env` in the container. The CLI and `server start`
  pass it to node with `--env-file-if-exists`, the dev server through `kit.env.dir: '..'`, the container reads
  `/data/.env`. The environment always wins over the file.
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
- A trip, day trip or gathering with `clustering.event_absorb_share` of both its photos and its distinct
  days inside a hand-declared `[[events]]` range is folded into that event: the cluster plan is dropped and
  the event album takes the union of both, centroid included. Both measures are needed, or a photo-heavy
  wedding weekend drags the three week honeymoon it starts into the event. A tie goes to the narrowest
  range. The test is the declared range, not the event plan, so `window` scope drops the cluster even when
  it does not plan the event. `plan()` returns the folds as `folded`, and `foldIntoEvents` rebuilds rather
  than mutates the plans it is handed. A threshold change can therefore move photos out of an event album.
- Nothing here deletes an album. `orphans(actions, albums, since?)` in `reconcile.ts` lists managed albums
  no plan claims any more, which the CLI logs and the server puts in `Preview.warnings`. Pass `since` in
  `window` scope, or every album older than the window is reported on every run.
- `person_years.favorites` is the allowlist for person albums. Empty means everyone over the threshold, which
  is the behaviour from before the key; `household` still only lowers the photo count, it does not grant an album.
- In `window` scope a person year, season or fixed event is planned only when the window covers it in full, so a
  partial slice can never strip photos out of an album that a full run created. The server enforces the same rule
  against its snapshot: a plan is clamped to how far back the fetch reached (`Snapshot.since`), and a draft asking
  for more history refetches rather than planning over assets it does not have. Face tags are still fetched from
  `taggedSince(ctx)`, which reaches further back than the planned years: a trip needs its faces even when the year
  it sits in is not planned.
- A credential is either the signed in session, held in memory by `server/src/lib/server/credentials.ts` and nowhere
  else, or `IMMICH_API_KEY` from the environment. Never config, never logs. The env file is written only on an
  explicit `login --save` or Save press, never as a side effect of signing in. The browser remembers the address in
  `localStorage` under `immich-auto-albums:url` and nothing else: no password, no token, no key.
- The session is temporary by construction: `POST /sessions` labelled `immich-auto-albums` with a one day duration,
  deleted on sign out and on `SIGTERM`, and a later sign in sweeps the labelled sessions a crash left behind. It
  falls back to the login token when a server has no `/sessions`, or when logging the parent out kills the child.
- Immich API facts verified against the OpenAPI spec: `POST /search/metadata` (page/size/withExif/visibility/personIds/takenAfter as full ISO datetime),
  `GET /people?withHidden=false&page&size`, `GET /people/{id}/thumbnail` (octet-stream),
  `POST /search/metadata` with `albumIds` for an album's asset ids: `AlbumResponseDto` carries only `assetCount`,
  `GET /albums/{id}` does not return assets, and reading `detail.assets` silently yields an empty set, which makes
  every trip-like album miss its match and get recreated.
  `GET /search/places?name=` (`{name, latitude, longitude, admin1name, admin2name}`; `admin2name` is the only
  source of the district, since `exifInfo.state` on this server holds admin1 alone),
  `GET /assets/{id}/thumbnail?size=thumbnail|preview` (needs `asset.view`), `GET/POST/PATCH /albums`,
  `PUT/DELETE /albums/{id}/assets`, `POST /auth/login` (unauthenticated, 201, `accessToken`), `POST /auth/logout`,
  `POST /sessions` (`{deviceOS, deviceType, duration}` in seconds, returns `token`, `id`, `expiresAt`, documented as
  a child of the current session), `GET`/`DELETE /sessions/{id}`, `POST /api-keys` (`{name, permissions}`, `secret`
  shown once), `GET /server/features` (unauthenticated, carries `passwordLogin` and `oauth`). Every endpoint above
  accepts `bearer` as well as `x-api-key`. There is no TOTP in Immich: the PIN and the elevated session gate locked
  assets only. Permissions needed, and the one list of them is `ALBUM_KEY_PERMISSIONS` in `src/auth.ts`:
  asset.read, asset.view, person.read, album.read, album.create, album.update, albumAsset.create, albumAsset.delete,
  user.read.

## Code style
- Comments and JSDoc at most 2 lines. No em dashes anywhere. Straight quotes.
- Prefer small pure functions; no classes except the API client.
- Names in albums are English; place names come from Immich's geocoder through `normPlace` (aliases in config).
- The place radius adapts per cluster: `place_km` is the floor, the p75 distance from the cluster centroid
  over 3 is the target, `place_km_max` the cap. Set the cap to `place_km` to switch it off. `merge_label_km`
  stays fixed, so on a spread out trip the place radius, not the merge, is what joins two destinations.
- Trip naming, in order: a place holding `dominant_share` of the GPS photos, else a `[[zones]]` area holding
  `zone_share` of them, else the area (see below), else the one country, else the top two joined by " & ".
  Zones sharing a name are one area, tested as a union and tightest first, because a mountain range is several
  small circles: one wide circle around Grenoble also holds the valley, and named a day in Bilieu a mountain trip.
- The area is the region, except in `naming.district_countries` (France), where the district wins unless the region
  is in `naming.keep_regions`: one district holding the share, else its top two joined by " & ", else the region.
  Immich exif has no district, so `attachDistricts` fills `Asset.district` from `GET /search/places?name=<city>`,
  one lookup per distinct city, picking the exact-name hit nearest the photo and dropping anything over 100 km.
  The index skips the smallest communes, so a town it does not carry takes the district of the nearest town
  within 25 km that resolved. Without that fill the unresolved photos dilute the share and the region wins.
  The geodata carries pre-2016 region names ("Rhône-Alpes") and a few typos ("Loire-et-Cher"), hence the aliases.

## Roadmap
1. Done. `server/` holds the API key, exposes preview, apply, config, people, geocode and album assets. The UI has the
   clustering sliders, the face-tile people pickers (me, household, person-year favorites), an address lookup
   for the homes, a zone editor (one modal per zone: a relief map with its circles, draggable, plus the towns
   each circle catches from `GET /api/towns`),
   event date pickers, and the album list with badges, thumbnails and a modal that shows the whole album plus,
   for a trip, where its photos were taken. The form covers every config key, and highlights what the config on
   screen changes about the saved file or about `config.example.toml`.
2. Done. `src/schema.ts` holds the schema, `config.schema.json` is the generated artifact for outside consumers, and
   the form takes every slider range and hint from it.
3. Done. `Dockerfile` has a `cli` target for the scheduled run and a default target that adds the UI, both on
   `node:22-slim` with `/data` as the only mount. README has the DSM task, which pulls the published
   `linux/amd64` image before every run.

## Docker
- `cli` target: root deps plus `dist`. Default target adds `server/build` and the server deps.
- `docker/entrypoint.sh` dispatches `preview`, `apply`, `serve`, anything else runs verbatim.
- Never bake `config.toml` into an image: `.dockerignore` excludes it.
- Only the `cli` target is published, to `ghcr.io/elevatebart/immich-auto-albums`: the UI is a local tool for
  writing the config, the NAS pulls the CLI and runs it from a DSM task.

## Releases
- Changesets, single package (`server/` is not a workspace, so it has no version of its own). `npx changeset`
  writes the intent, `.github/workflows/release.yml` turns pending ones into a `Version Packages` PR, and
  merging it runs `changeset git-tag` for `v<version>`. The root package is private: nothing reaches npm.
- The release job then calls `.github/workflows/image.yml` as a reusable workflow, because a tag pushed with
  `GITHUB_TOKEN` triggers nothing. That workflow also takes a `workflow_dispatch` version to replay a build.
- The action is v2: it hands the publish script `CHANGESETS_OUTPUT` and reads the ndjson the CLI writes there,
  so the publish script has to be the changesets CLI (`changeset git-tag`), not a hand-rolled `git tag`.

## Running
    npm ci && npm run build && npm test
    npm run login                 # url, email, password; --save writes the key into .env
    IMMICH_API_KEY=... IMMICH_URL=http://nas:2283 CONFIG=./config.toml npm run preview
    npm run preview -- --all      # the whole library, not just the window
