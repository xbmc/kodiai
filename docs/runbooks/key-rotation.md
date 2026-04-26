# Key Rotation

## When to use
Use this when a runtime secret is expired, revoked, or suspected compromised.

## Signals
- `authentication failures`
- `GitHub Actions workflow run status` shows the failing rotation-related workflow run
- repeated startup or webhook auth errors in runtime logs

## Commands
- `bun run verify:m055:s02`
- `bun run verify:m058:s02`

## Owning milestone
- M055 for contributor/operator docs truth
- M058 for the Bun/CI contract around contributor expectations
