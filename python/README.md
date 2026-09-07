# python

`immich_auto_albums.py` is the original implementation, the one `src/` was ported from. One file, standard
library only, no install step. Keep it working: it is the fallback when Node is not available on a box, and it
is the reference the golden cases in `test/` were taken from.

Python 3.11 or newer, for `tomllib`.

    cp config.example.toml config.toml            # same file the TS version uses
    IMMICH_API_KEY=... python3 python/immich_auto_albums.py            # plans only, writes nothing
    IMMICH_API_KEY=... DRY_RUN=0 python3 python/immich_auto_albums.py   # applies

Env: `IMMICH_API_KEY` (required), `IMMICH_URL`, `CONFIG` (default `config.toml` next to the script, so pass it
from the repo root), `OUT` (logs, `decisions_*.csv`), `WINDOW_DAYS`, `DRY_RUN` (default `1`).

Note the safety default is inverted between the two: the script writes nothing until `DRY_RUN=0`, while the CLI
writes only when the subcommand is `apply`.

## Same config, two readers

Both read the same `config.toml` with the same snake_case keys. `src/config.ts` maps them to camelCase for the
planner; this script reads them straight into globals. A config written by the UI works here unchanged, and
`config.schema.json` documents the field meanings for both, though it describes the camelCase shape and so
validates only the TS side.

Two things to keep in mind when the format changes:

- Dates must be bare TOML dates (`from = 2023-06-08`), not quoted strings. `tomllib` hands the script real
  `date` objects and it compares them as such, so a quoted date raises a TypeError. `toToml` writes them bare.
- A key added on one side is ignored by the other. This script uses `.get` with defaults for everything
  optional, so it tolerates a newer config; the reverse is also true, since `fromToml` only reads what it knows.

## Where the two differ

- No scope. This script always looks at the whole library: it fetches every asset and plans person years,
  seasons and fixed events over all of history. That is what `npm run preview -- --all` does on the TS side,
  where the default is the rolling window instead.
- No UI, no schema validation, no `POST /search/metadata` `takenAfter` narrowing.
- Everything else matches on purpose: the marker, the `auto:` line that detects a manual rename, the >=50%
  overlap within 45 days for trip-like kinds, key matching for the stable kinds, and the same album names.
