---
"immich-auto-albums": patch
---

Fix the Zone share slider in the config UI, which sat at full whatever the value: the slider defaulted to a step of 1, so a 0..1 field snapped to its maximum. The step now comes from the schema range.
