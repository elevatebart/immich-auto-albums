# immich-auto-albums (TS)

Pure planner + reconcile for Immich event albums, with a CLI.

    cp config.example.toml config.toml   # config.toml is gitignored: homes and names are personal
    npm ci && npm run build
    IMMICH_API_KEY=... CONFIG=./config.toml npm run preview   # writes plan_*.json, decisions_*.csv, run_*.log to out_dir
    IMMICH_API_KEY=... npm run apply

Env overrides: IMMICH_URL, OUT, WINDOW_DAYS, CONFIG, SCOPE. The API key never goes in config.toml.

By default a run only looks at the rolling window (`window_days`), and only fetches photos taken inside it. Person
years, seasons and fixed events are planned only when the window covers them in full, so history is left alone. Pass
`--all` (or `SCOPE=all`) for the whole library, which is what a first run wants.

UI: `cd server && DEMO=1 npm run dev` for the preview table, the apply confirm and the config form (see `server/README.md`).

`config.schema.json` is the JSON Schema for the config, generated with `npm run schema`.

`python/immich_auto_albums.py` is the original single-file version, stdlib only, reading the same `config.toml`.
See `python/README.md`.

Layout: `src/planner.ts` (pure, no I/O), `src/reconcile.ts` (pure), `src/config.ts` (TOML -> Config),
`src/schema.ts` + `src/validate.ts` (JSON Schema and Ajv validation),
`src/immich.ts` (fetch client), `src/cli.ts`. `test/` holds the golden cases ported from the Python version.

## Docker

Two targets. `cli` is the monthly run, the default adds the UI.

    docker build -t immich-auto-albums .                   # CLI + UI, 531 MB
    docker build --target cli -t immich-auto-albums:cli .   # CLI only, 350 MB

Building on a Mac for a Synology needs `--platform linux/amd64`. Both targets cross-build, or build on the
NAS itself over SSH.

`/data` is the only mount: it holds `config.toml` and receives `run_*.log`, `decisions_*.csv` and `plan_*.json`.
The container runs as root so it can write to a NAS share.

    docker run --rm --network host -e IMMICH_API_KEY=... \
      -v /volume1/tools/immich-auto-albums:/data immich-auto-albums:cli preview
    docker run --rm --network host -e IMMICH_API_KEY=... \
      -v /volume1/tools/immich-auto-albums:/data immich-auto-albums:cli apply
    docker run -d --network host -e IMMICH_API_KEY=... \
      -v /volume1/tools/immich-auto-albums:/data immich-auto-albums serve   # UI on :3000

`docker-compose.yml` runs the UI. `--network host` is there so the container reaches Immich on the NAS itself.

## Monthly run on DSM

1. Put the key in `/volume1/tools/immich-auto-albums/immich.env`, `chmod 600`: `IMMICH_API_KEY=...`
2. Control Panel, Task Scheduler, Create, Scheduled Task, User-defined script. User `root`, monthly, day 1.
3. Run command:

       /usr/local/bin/docker run --rm --network host \
         --env-file /volume1/tools/immich-auto-albums/immich.env \
         -v /volume1/tools/immich-auto-albums:/data immich-auto-albums:cli apply

Run it with `preview` once by hand first: it writes the same decision CSV without touching Immich. Enable the
task's email notification to get the run log.
