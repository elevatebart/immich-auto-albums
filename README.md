# immich-auto-albums (TS)

Pure planner + reconcile for Immich event albums, with a CLI.

    cp config.example.toml config.toml   # config.toml is gitignored: homes and names are personal
    npm ci && npm run build
    IMMICH_API_KEY=... CONFIG=./config.toml npm run preview   # writes plan_*.json, decisions_*.csv, run_*.log to out_dir
    IMMICH_API_KEY=... npm run apply

Env overrides: IMMICH_URL, OUT, WINDOW_DAYS, CONFIG. The API key never goes in config.toml.

UI: `cd server && DEMO=1 npm run dev` for the preview table, the apply confirm and the config form (see `server/README.md`).

`config.schema.json` is the JSON Schema for the config, generated with `npm run schema`.

Layout: `src/planner.ts` (pure, no I/O), `src/reconcile.ts` (pure), `src/config.ts` (TOML -> Config),
`src/schema.ts` + `src/validate.ts` (JSON Schema and Ajv validation),
`src/immich.ts` (fetch client), `src/cli.ts`. `test/` holds the golden cases ported from the Python version.

Docker on the NAS: `docker run --rm --network host -e IMMICH_API_KEY=... -v /volume1/tools/immich-auto-albums:/app -w /app node:22-slim npm run preview`
