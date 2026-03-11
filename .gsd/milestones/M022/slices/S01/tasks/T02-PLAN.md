# T02: 106-historical-corpus-population 02

**Slice:** S01 — **Milestone:** M022

## Description

Create the CLI script entry point and GitHub Actions nightly sync workflow. The script supports dual-mode: full backfill (default) and incremental sync (--sync flag).

Purpose: Makes the backfill engine from Plan 01 runnable as a CLI script and automatable via GitHub Actions.
Output: scripts/backfill-issues.ts and .github/workflows/nightly-issue-sync.yml.

## Must-Haves

- [ ] "Running `bun scripts/backfill-issues.ts` populates the issue corpus with historical issues and comments"
- [ ] "Running `bun scripts/backfill-issues.ts --sync` fetches only issues updated since last sync"
- [ ] "The --repo flag allows testing on smaller repos before xbmc/xbmc"
- [ ] "Nightly GitHub Action triggers the sync on a cron schedule"
- [ ] "Script prints summary report at end with total issues, comments, failures, duration, API calls"

## Files

- `scripts/backfill-issues.ts`
- `.github/workflows/nightly-issue-sync.yml`
