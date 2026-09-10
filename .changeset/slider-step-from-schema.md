---
"immich-auto-albums": patch
---

Take every slider step in the config UI from the schema range. The km and hour sliders had a step of 0.5 on a minimum of 0.1, so their grid ran 0.1, 0.6, 1.1 and a home radius of 20 km showed as 20.1 on the slider while the number box said 20. The zone circle radius had the same mismatch.
