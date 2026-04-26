# Deploy Rollback

## When to use
Use this when a deploy introduces bad behavior or when a migration-backed rollout must be reversed safely.

## Signals
- `rollback_roundtrip_ok` / `rollback_roundtrip_schema_drift` from the migration proof scripts
- GitHub Actions workflow run status for the release or deploy lane

## Commands
- `bun run verify:m056:s01`
- `bun run verify:m056:s02`
- `bun run src/db/migrate.ts down <version>`

## Owning milestone
- M055 documents this runbook surface
- M056 owns the rollback contract
