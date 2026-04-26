# Nightly Sync Failures

## When to use
Use this when the nightly sync automations stop updating issues or reaction-derived feedback.

## Signals
- `nightly-issue-sync` or `nightly-reaction-sync` failures in GitHub Actions workflow run status
- the workflow logs show the `nightly-issue-sync` or `nightly-reaction-sync` job name directly
- stale issue/reaction sync evidence in operator review

## Commands
- `bun scripts/backfill-issues.ts --sync`
- `bun scripts/sync-triage-reactions.ts`

## Owning milestone
- M052 for the shipped relay/nightly operator surface
- M055 for the required runbook inventory
