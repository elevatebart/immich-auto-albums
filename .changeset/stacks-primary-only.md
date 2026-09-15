---
"immich-auto-albums": minor
---

Add `stacks.primary_only`, which puts only the primary photo of an Immich stack in an album and leaves the rest of the burst out of the plan entirely, thresholds included. The CLI takes `--primary-only` (or `PRIMARY_ONLY=1`) and the config form has a checkbox for it. Immich's search never reports stacks, so the members come from `GET /stacks`, which needs the `stack.read` permission: keys minted before this need `npm run login` again. Turning it on takes the stacked shots out of the albums already created on the next apply, and a burst-heavy day can fall under `daytrip_min_photos` and lose its album.
