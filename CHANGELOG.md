# immich-auto-albums

## 1.1.1

### Patch Changes

- 269c80c: Bound the latitude and longitude boxes in the homes table and the zone editor by the schema, so a typo like 200 is caught in the form rather than on save.
- cf9f53e: Name a trip after its leading place when no region carries it and that place doubles the runner-up, so a Chicago to New Orleans road trip reads "New Orleans" instead of the country. Tunable as `clustering.lead_share`, default 0.35.
- 269c80c: Take every slider step in the config UI from the schema range. The km and hour sliders had a step of 0.5 on a minimum of 0.1, so their grid ran 0.1, 0.6, 1.1 and a home radius of 20 km showed as 20.1 on the slider while the number box said 20. The zone circle radius had the same mismatch.
- cf9f53e: Name a trip after its two regions when one country holds them, so a two state trip reads "Texas & Florida" instead of "United States of America". Border trips still name the two countries. `config.example.toml` also aliases the geodata's "United States of America" down to "USA", for the trips that stay at country level.
- 269c80c: Fix the Zone share slider in the config UI, which sat at full whatever the value: the slider defaulted to a step of 1, so a 0..1 field snapped to its maximum. The step now comes from the schema range.

## 1.1.0

### Minor Changes

- f126e5f: Release with changesets and publish the CLI image to GHCR, so the DSM task pulls the newest release instead of
  building one on the NAS by hand.
