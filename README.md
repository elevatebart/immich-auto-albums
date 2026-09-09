# immich-auto-albums (TS)

Pure planner + reconcile for Immich event albums, with a CLI.

    cp config.example.toml config.toml   # config.toml is gitignored: homes and names are personal
    npm ci && npm run build
    npm run login -- --save              # asks for url, email, password; mints a key into .env
    npm run preview                      # writes plan_*.json, decisions_*.csv, run_*.log to out_dir
    npm run apply

`npm run login` signs in to Immich, creates an API key scoped to reading photos and people and writing albums,
prints it, and with `--save` puts it in `.env`. Without `--save` nothing is written and the line is yours to place.
The UI does not need any of this: it has a sign in form, and the session it opens lives in memory only.

`.env` at the repo root is read by all of it: the CLI, the UI in dev and in production, and the container when the
file sits in `/data`. Anything already in the environment wins over the file, so a one-off
`WINDOW_DAYS=90 npm run preview` still works.

Keys it understands: IMMICH_API_KEY, IMMICH_URL, CONFIG, OUT, WINDOW_DAYS, SCOPE, GEOCODER, ENV_FILE, and DEMO for
the UI. A credential only ever lives in `.env` or in the environment, never in config.toml.

By default a run only looks at the rolling window (`window_days`), and only fetches photos taken inside it. Person
years, seasons and fixed events are planned only when the window covers them in full, so history is left alone. Pass
`--all` (or `SCOPE=all`) for the whole library, which is what a first run wants.

UI: `cd server && DEMO=1 npm run dev` for the preview table, the apply confirm and the config form (see
`server/README.md`). Without `DEMO=1` and without a key it opens on the sign in form.

## Rename an album in Immich, it sticks

Every album the tool creates carries its identity in the description, not in the title:

    [auto-albums] kind=trip key=2025-09-24
    auto: London with Milos, Sep 2025

Line 1 is the marker plus the plan's kind and key. Line 2 records the name the generator produced. Nothing matches on
the title: the stable kinds (person, season, event) match on `key`, and trips, day trips and gatherings match on
>=50% asset overlap within 45 days of that date. So renaming an album in Immich is safe. On the next run the tool
finds it, sees that its title no longer equals the `auto:` line, and treats the title as yours: the decision log says
`keeping your name`, the UI shows a `your name` badge, and photos keep being added and removed as usual while the
title is left alone. Line 2 is still refreshed to whatever the generator would call it today, which is what keeps the
rename recognised run after run.

Two things to avoid:

- Do not edit or remove the description. It is the only handle on the album. Without the marker line the album stops
  being managed and the next run creates a second one alongside it.
- Do not rename an album to exactly what the generator would call it. Title equal to `auto:` reads as "the tool owns
  this name", so a later change to the generated name would move your title with it.

There is no rename key in the config on purpose: this is the one mechanism, and it lives where you are already
looking at the album.

`config.schema.json` is the JSON Schema for the config, generated with `npm run schema`.

Layout: `src/planner.ts` (pure, no I/O), `src/reconcile.ts` (pure), `src/config.ts` (TOML -> Config),
`src/schema.ts` + `src/validate.ts` (JSON Schema and Ajv validation),
`src/immich.ts` (fetch client), `src/cli.ts`. `test/` holds the golden cases.

## Docker

The CLI image is published on every release: `ghcr.io/elevatebart/immich-auto-albums`, `linux/amd64`, built from
the `cli` target. The UI is not in it. It is a local tool for writing `config.toml`, not something the NAS runs.

    docker pull ghcr.io/elevatebart/immich-auto-albums:latest

The package has to be public in the repo's package settings, or the NAS needs a `docker login ghcr.io` with a
`read:packages` token first.

Building it yourself is still one command each, and the default target adds the UI:

    docker build --target cli -t immich-auto-albums:cli .   # CLI only, 350 MB
    docker build -t immich-auto-albums .                    # CLI + UI, 531 MB

Do not build on the NAS. Two `npm ci` runs plus `tsc` and the Vite build are heavy, and 2 GB is not enough.
That is what the registry is for: the NAS only pulls.

`/data` is the only mount: it holds `config.toml` and receives `run_*.log`, `decisions_*.csv` and `plan_*.json`.
The container runs as root so it can write to a NAS share.

Put the key in `/volume1/tools/immich-auto-albums/.env` (`chmod 600`) and the container picks it up, so it never
appears in a command line or a task definition.

    docker run --rm --network host -v /volume1/tools/immich-auto-albums:/data \
      ghcr.io/elevatebart/immich-auto-albums:latest preview
    docker run --rm --network host -v /volume1/tools/immich-auto-albums:/data \
      ghcr.io/elevatebart/immich-auto-albums:latest apply
    docker run -d -p 3000:3000 -v ./data:/data immich-auto-albums serve   # UI on :3000, locally built

`docker-compose.yml` runs that same UI locally: `docker compose up ui`, port 3000, `./data` for `config.toml`
and its `.env`. No host networking any more, so an Immich on the NAS is its own address and an Immich on this
machine is `http://host.docker.internal:2283`. Copy the config it writes to the NAS share when you are happy
with it.

## Monthly run on DSM

1. Put the key in `/volume1/tools/immich-auto-albums/.env`, `chmod 600`: `IMMICH_API_KEY=...`
2. Control Panel, Task Scheduler, Create, Scheduled Task, User-defined script. User `root`, monthly, day 1.
3. Run command:

       /usr/local/bin/docker pull ghcr.io/elevatebart/immich-auto-albums:latest && \
         /usr/local/bin/docker run --rm --network host \
           -v /volume1/tools/immich-auto-albums:/data \
           ghcr.io/elevatebart/immich-auto-albums:latest apply --all

The pull is the whole update mechanism: every run starts on the newest release, and there is no image to carry
over by hand any more. `&&` means a registry outage skips the run instead of quietly applying an old planner;
swap it for `;` if you would rather run stale than not run. Pin `:latest` to `:1.2.0` to put a human between a
release and your library.

Run it with `preview` once by hand first: it writes the same decision CSV without touching Immich. Enable the
task's email notification to get the run log.

`--all` plans the whole library, which is what a monthly run wants: without it the rolling window of
`window_days` is all that gets revisited, so older person years and seasons stop being touched. Dropping it is
safe, just narrower.

`/data` is the only mount, and the image already sets `CONFIG=/data/config.toml` and `OUT=/data`. A config under
another name needs `-e CONFIG=/data/<name>.toml`, and `IMMICH_URL` only when it differs from `immich.url` in the
config. There is no `DRY_RUN`: `preview` writes nothing, `apply` writes, and that is the whole switch.

## Releasing

Changesets, one package, one version for the whole tool. Anything worth a release carries one:

    npx changeset       # major/minor/patch, one line of prose, commit the file it writes

Pushing to `main` collects the pending ones into a `Version Packages` PR. Merging that PR bumps `package.json`,
writes `CHANGELOG.md`, tags `v<version>`, and pushes the image at both `<version>` and `latest`. Nothing goes to
npm: the package is private and `changeset git-tag` is the publish step.

The image build is a reusable workflow (`.github/workflows/image.yml`), so a release whose push failed can be
replayed from the Actions tab by running `image` with the version. The release workflow calls it as a job rather
than triggering on the tag, because a tag pushed with `GITHUB_TOKEN` starts no workflow of its own.
