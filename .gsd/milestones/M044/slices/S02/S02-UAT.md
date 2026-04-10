# S02: Audit-Driven Publication/Correctness Repair — UAT

**Milestone:** M044
**Written:** 2026-04-09T08:23:04.268Z

## Operator UAT — S02 Azure-backed audit repair

1. Run:
   - `bun run verify:m044:s01 -- --repo xbmc/xbmc --limit 12 --json`
2. Confirm the report shows:
   - `githubAccess: available`
   - `azureLogAccess: available`
3. Verify the sample no longer collapses to all-`indeterminate`.
4. Inspect at least these live classifications in the JSON output:
   - one explicit mention-review PR classified `clean-valid` from `publishResolution=approval-bridge`
   - one automatic PR classified `clean-valid` from Azure `submitted-approval`
   - PR `#28135` classified `findings-published` from Azure `published-output`
5. Confirm source availability remains truthful:
   - DB-backed fields may still show `unavailable`
   - verdicts should still resolve from Azure evidence where present
6. Confirm the command still exits successfully and preserves `indeterminate` only where Azure/DB evidence is genuinely missing or contradictory.

