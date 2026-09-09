# Changesets

One package, so one version for the whole tool. `npx changeset` records an intent to release; the release
workflow turns the accumulated ones into a `Version Packages` PR, and merging that PR tags `v<version>` and
pushes the CLI image to GHCR. `server/` has no version of its own: it ships inside the same release.
