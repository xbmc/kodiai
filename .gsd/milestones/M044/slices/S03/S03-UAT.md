# S03: Repeatable Audit Verifier and Runbook — UAT

**Milestone:** M044
**Written:** 2026-04-09T08:39:37.333Z

## Operator UAT — Final M044 surface

1. Run:
   - `bun run verify:m044 -- --repo xbmc/xbmc --limit 12 --json`
2. Confirm the command succeeds and returns:
   - a non-empty `selection`
   - a non-empty `summary`
   - per-PR `artifacts`
3. Confirm preflight truth:
   - `githubAccess: available`
   - `azureLogAccess: available`
   - `databaseAccess` reported truthfully (`available`, `missing`, or `unavailable`)
4. Confirm the final sample summary is internally consistent:
   - `summary.totalArtifacts` matches the artifact array length
   - verdict counts sum to `summary.totalArtifacts`
   - lane counts match the final selected sample
5. Open `docs/runbooks/recent-review-audit.md` and verify it documents:
   - the final command
   - the verdict taxonomy
   - how to drill into one flagged PR using `reviewOutputKey`
6. Manually inspect one `clean-valid` and one `findings-published` artifact in the JSON output and confirm the runbook's described evidence pattern matches the fields shown.

