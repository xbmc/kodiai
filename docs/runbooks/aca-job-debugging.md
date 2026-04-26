# ACA Job Debugging

## When to use
Use this when an Azure Container Apps job fails, stalls, or times out.

## Signals
- `result.json` is missing or reports failure
- `agent-diagnostics.log` shows the last remote diagnostics
- `Last remote diagnostics:` appears in the surfaced timeout/failure output
- GitHub Actions workflow run status or review proof surfaces show timeout-related failures

## Commands
- `bun run verify:m048:s03`
- `bun run verify:m055:s03`

## Owning milestone
- M048 for timeout/review proof surfaces
- M055 for the runbook inventory contract
