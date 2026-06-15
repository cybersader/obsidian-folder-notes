# Folder notes — sync-race E2E test vault

This vault is driven by WebdriverIO (`npm run e2e`). Specs create and delete
their own folders/notes at runtime against an isolated copy of this vault, so
nothing here needs to be maintained by hand.

See `tests/e2e/sync-race.spec.ts` and `SYNC_FIX_BRIEF.md`.
