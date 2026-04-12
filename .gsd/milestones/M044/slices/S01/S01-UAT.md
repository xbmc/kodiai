# S01: Sample Selection and Recent Review Audit — UAT

**Milestone:** M044
**Written:** 2026-04-09T07:59:05.130Z

## Operator UAT — S01 Recent Review Audit

1. Run:
   - `bun run verify:m044:s01 -- --repo xbmc/xbmc --limit 12 --json`
2. Confirm the command exits successfully and returns a JSON report.
3. Check `preflight`:
   - `githubAccess` should be `available` in an environment with GitHub App credentials.
   - `databaseAccess` may be `available`, `missing`, or `unavailable`, but it must be reported truthfully.
   - `explicitPublishResolution` is expected to be `unavailable` in S01.
4. Check `selection`:
   - `scannedPullRequests` is non-zero.
   - `collectedArtifacts` is non-zero.
   - The final sample length is at most 12.
   - Lane counts and `fillCount` are present and internally consistent.
5. Inspect at least one automatic and one explicit artifact in `artifacts`:
   - each record includes `prNumber`, `source`, `reviewOutputKey`, `verdict`, `rationale`, and `sourceAvailability`.
6. Verify truthfulness:
   - when DB evidence is unavailable, automatic cases report `indeterminate` with source availability showing the missing DB-backed surfaces.
   - explicit cases remain `indeterminate` until publish-resolution evidence is added in a later slice.

