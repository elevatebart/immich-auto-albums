---
"immich-auto-albums": minor
---

Add `stacks.primary_only`, which keeps the primary of an Immich stack in an album and leaves the shots behind it out. A photo in no stack counts as a primary. The CLI takes `--primary-only` (or `PRIMARY_ONLY=1`) and the config form has a checkbox. The filter runs after the planner, on album membership alone, so clustering, naming and every threshold still see the whole burst and no album appears or disappears because of it; a shot is only left out when its album also holds its primary. Immich's search never reports stacks, so the members come from `GET /stacks`, which needs the `stack.read` permission: keys minted before this need `npm run login` again.
