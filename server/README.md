# server

SvelteKit UI for the planner. Roadmap item 1, first slice: read-only preview.

    cd server && npm install
    npm run dev                          # http://localhost:5678, credentials from ../.env
    DEMO=1 npm run dev                   # no Immich needed, fixture library
    npm run build && npm start           # production, same ../.env

`config.toml` is gitignored, so copy `config.example.toml` first. Every route answers 404 with that hint when it is
missing. Credentials come from `../.env` (`kit.env.dir` points there, so `$env/dynamic/private` sees it in dev and
`npm start` passes it to node), and anything already in the environment wins.

With no credential and no `DEMO=1` the page opens on a sign in form: url, email, password. That opens an Immich
session which lives in this process only, is labelled `immich-auto-albums` with a one day expiry, and is deleted on
sign out or on `SIGTERM`. Nothing derived from the password reaches disk, and the browser only ever remembers the
address (`localStorage`, `immich-auto-albums:url`).

Env: `IMMICH_API_KEY` (optional now: sign in instead, and it is still what a scheduled run uses), `IMMICH_URL`,
`CONFIG` (default `../config.toml`), `ENV_FILE` (default `.env` beside the config), `WINDOW_DAYS`,
`GEOCODER=immich` to keep address lookups off the internet. Credentials stay server side; neither the key nor the
session token is ever sent to the browser or written to the config. `server/.env` works in dev and is gitignored.

## What is here

- `GET /api/auth` -> `AuthState`: whether there is a credential, which kind, the address to prefill, and what sign
  in methods this Immich offers. `POST` signs in, `POST ?key=1` mints a scoped API key with that session,
  `PUT { secret }` writes a verified key into the env file, `DELETE` signs out. No response ever carries a token.
- `?scope=all` on the preview, and `scope` in the apply and album bodies, plan the whole library instead of the
  rolling window. The window is the default everywhere, and the checkbox in the album header is the bypass.
- `GET /api/preview` -> `Preview` (`src/lib/types.ts`): stats plus one row per reconcile action,
  with the create/update/rename/noop op, rename flags, asset counts and the cluster centroid. Asset ids stay
  on the server. `?refresh=1` rescans the library, which is the only slow part and is cached for 10 minutes. The
  snapshot records how far back it fetched; a longer window refetches, a shorter one reuses it.
- `POST /api/preview` with `{ config }` -> the same shape for an unsaved config, planned over the cached
  library in a few milliseconds. It carries `draft: true` and no token, so apply can never write a plan
  that came from a config the file does not have.
- `POST /api/apply` -> `ApplyResponse`. Body: `{ token, confirm: true, ids? }`. The token is the digest of the
  preview rows, so a plan that moved since the caller looked at it is rejected with 409 rather than written blind;
  a missing `confirm` is 400. `ids` narrows the write to those rows, omitted means every changed row. One failed
  row does not stop the others. Writes invalidate the cache. Under `DEMO=1` it reports `dryRun: true` and writes nothing.
- `GET /api/people` -> `PeopleResponse`: named people from Immich, for the household and "me" pickers.
- `GET /api/people/<id>/thumbnail`: proxies Immich's person thumbnail so the key stays server side. The id must be
  a UUID, anything else is 404, and the picker falls back to initials whenever the image does not load.
- `GET /api/assets/<id>/thumbnail?size=thumbnail|preview`: same idea for photos. Needs `asset.view` on the key, and
  a 403 turns into a hint in the album list rather than a wall of grey boxes.
- `POST /api/albums/assets` with `{ id, config? }` -> `AlbumAssets`: the asset ids of one planned album, capped at
  300, plus the ones joining and leaving. Pass the draft config to open the album the list is currently showing.
- `GET /api/progress` -> `{ job }`: what the server is busy with, one job at a time, cheap to poll. The bar in the
  album header polls it every 700 ms while a scan, a replan or an apply is running. Phases: photos, faces, albums,
  writing. Faces, albums and writing report a real fraction; photos only report a count, since this Immich's search
  returns the page's own total rather than the match total.
- `GET /api/geocode?q=` -> `{ hits: GeoHit[] }`: address to coordinates for the homes. Immich's own geodata first
  (`GET /search/places`, place level, nothing leaves the network), and only when that finds nothing, Nominatim for
  street level, which does send the query out. `GEOCODER=immich` turns that fallback off.
- `GET /api/config` -> `ConfigResponse`: the parsed `Config`, the file text, an etag, and `defaults`: the parsed
  `config.example.toml` when it is next to the config or in the working directory, else null. That is the second
  baseline the form highlights against, so a deployment without the example simply loses that button.
- `PUT /api/config` -> `ConfigWriteResponse`. Body: `{ etag, config, dryRun? }`. Replaces the file wholesale, so it
  takes the etag from GET and answers 409 when the file moved underneath. Every field is validated and all problems
  come back at once as `issues[{field, message}]` with 400, from the shared `validateConfig` in `src/validate.ts`. `dryRun` renders the TOML and the warnings without
  writing. A write copies the old file to `config.toml.bak`, writes through a temp file in the same directory, then
  renames, and drops the preview cache. `warnings` covers legal but costly edits, such as a new marker orphaning
  the albums tagged with the old one.
- `/` is the whole app: config handles on the left, the albums they produce on the right. `/config` redirects here.
  Left (`ConfigPanel.svelte`): sliders for everything numeric, `MultiSelect` of Immich people for the household, a
  tile picker with Immich thumbnails for "me" and the household, an address lookup that fills a home's coordinates,
  native date inputs for the fixed events, row editors for aliases and events, and the rendered TOML. Check file renders it through the dry run; Save
  writes it.
  The form covers every key in the config (including the naming lists, the region share and the event absorb
  share), so a change count can never point at a field the form does not show.
  Every field also says how it differs from a baseline: the bar at the top counts the changes and switches between
  the saved file and `config.example.toml`, each card header carries its own count, a changed control gets an amber
  accent, a `changed`/`new` badge and a `was ...` value, and an entry the baseline has and the config does not is
  listed struck through under its section. `src/lib/change.ts` holds the wording and the colours, `$core/diff.js`
  the comparison.
  Right (`AlbumsPanel.svelte`): the planned albums with create, update, rename, kept-name and unchanged badges, four
  thumbnails per row, the album name opening a full grid in a modal with the joining and leaving photos ringed, a
  kind filter and an unchanged-rows toggle. A trip or day trip modal also plots where its photos were taken.
  Move any handle and the right panel replans 400 ms later from the draft, without saving. That draft can be applied
  too: the request carries the config alongside the token, the server replans it and checks the token the same way, and
  the confirm panel says the scheduled run will keep using the saved config until you save.

`$core` is an alias for `../src`, so the pure `planner.ts`, `reconcile.ts` and `config.ts` are imported
as source and bundled by Vite. No copy, no build step in the parent.

The UI is built from `@immich/ui` (pinned) on Tailwind 4, with its theme imported in `src/app.css`, so the pages look
like Immich rather than like a second product. Three things are hand-rolled because the library has no equivalent: the
slider in `src/lib/components/Slider.svelte`, the person tiles in `PeoplePicker.svelte`, and the Leaflet map in
`CentroidsMap.svelte`. The map fits its bounds only once the container has a real size, since Leaflet otherwise lands
on zoom 0, and only refits when the data changes, so a pan or a click is never undone. Wide data tables are plain
`<table>` elements, since the library's `Table` distributes columns evenly.

Config values are camelCase on the wire and snake_case in the file; `toToml` owns that mapping and regenerates the
explanatory comments from a template, so a UI write leaves the file as readable as a hand-edited one.

Slider ranges and field hints are read from the JSON Schema through `schemaField`, so nothing about a bound is written
twice. `src/schema.ts` deliberately has no Ajv import, which keeps the validator out of the browser bundle; the server
imports `validateConfig` from `src/validate.ts` instead.

There is no auth in front of any of this, so bind it to the LAN. A signed in session carries the full rights of that
Immich account, where `IMMICH_API_KEY` carries nine permissions, so sign out when you are done.

## Build

    npm run build && npm start      # adapter-node, PORT and HOST respected, ../.env loaded
