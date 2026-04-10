# S03: Repeatable Audit Verifier and Runbook

**Goal:** Package the now-proven recent-review audit into the final operator surface: a stable milestone-level verifier command, clear prerequisite/preflight reporting, and runbook guidance for rerunning and drilling into flagged PRs without manual archaeology.
**Demo:** Operators run one documented command such as `bun run verify:m044 -- --repo xbmc/xbmc --limit 12 [--json]` and receive human-readable and machine-readable verdicts, preflight/access status, and per-PR evidence they can rerun later without manual archaeology.

## Must-Haves

- Operators can run one documented final command to audit the recent xbmc/xbmc sample and receive stable human + JSON output.
- The final verifier preserves truthful preflight for GitHub, DB, and Azure evidence access, plus explicit verdict taxonomy and per-PR drill-down fields.
- Runbook docs explain prerequisites, workspace/log assumptions, verdict meanings, and how to investigate a flagged PR.
- A final live run through the packaged surface succeeds and the milestone can close on observed evidence rather than slice-local knowledge.

## Proof Level

- This slice proves: Operational/final-assembly proof: the shipped operator command and runbook are exercised against live xbmc/xbmc history and current internal publication evidence.

## Integration Closure

This slice closes the milestone by turning the evolved `verify:m044:s01` seam into the final `verify:m044` operator entrypoint and matching documentation, then reruns the live xbmc/xbmc sample through that final surface.

## Verification

- Promotes the slice-level audit JSON into the final milestone-level operator contract with stable command naming, preflight fields, verdict summaries, and documented drill-down steps.

## Tasks

- [x] **T01: Finalize the milestone-level verifier command and output contract** `est:1h`
  Promote the current slice-level verifier into the final milestone operator command. Add a final `verify:m044` package script (keeping the slice-level script only if it still adds value), tighten the output contract around milestone-level summary counts and verdict breakdowns, and add tests that pin the final command name and JSON/human report shape.
  - Files: `scripts/verify-m044-s01.ts`, `scripts/verify-m044-s01.test.ts`, `package.json`
  - Verify: bun test ./scripts/verify-m044-s01.test.ts && bun run verify:m044 -- --repo xbmc/xbmc --limit 12 --json

- [x] **T02: Document the recent-review audit runbook and verdict meanings** `est:1h`
  Write the operator runbook section for the recent-review audit. Document GitHub/DB/Azure prerequisites, workspace discovery assumptions, verdict meanings (`clean-valid`, `findings-published`, `publish-failure`, `suspicious-approval`, `indeterminate`), and the exact follow-up steps for investigating one flagged PR using `reviewOutputKey`, delivery ID, and Azure log evidence.
  - Files: `docs/runbooks/recent-review-audit.md`
  - Verify: test -s docs/runbooks/recent-review-audit.md && rg -n "clean-valid|findings-published|publish-failure|suspicious-approval|indeterminate" docs/runbooks/recent-review-audit.md

- [x] **T03: Run the packaged verifier live and close the milestone on the final report** `est:45m`
  Run the final milestone-level verifier through the packaged surface, confirm the recent xbmc/xbmc sample still resolves with real internal evidence, and close M044 on the observed final report. If the live run regresses, stop and record the exact blocker instead of papering over it.
  - Files: `scripts/verify-m044-s01.ts`
  - Verify: bun run verify:m044 -- --repo xbmc/xbmc --limit 12 --json

## Files Likely Touched

- scripts/verify-m044-s01.ts
- scripts/verify-m044-s01.test.ts
- package.json
- docs/runbooks/recent-review-audit.md
