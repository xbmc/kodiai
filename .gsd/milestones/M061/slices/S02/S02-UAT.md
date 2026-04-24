# S02: S02 — UAT

**Milestone:** M061
**Written:** 2026-04-24T01:49:50.429Z

# UAT — S02 Mention Flow Context Diet

## Preconditions
- Repository is at the S02-complete workspace state.
- Bun dependencies are installed.
- No `DATABASE_URL` or `TEST_DATABASE_URL` is required for the fail-open proof cases below.
- Run from the repo root.

## Test Case 1 — Ordinary conversational mention stays on the light path
1. Run `bun test ./src/handlers/mention.test.ts --test-name-pattern "conversational issue mentions with casual filenames stay on the light path|conversational PR mentions omit pre-fetched diff unless the request is diff-seeking|light conversational retrieval queries omit candidate code-pointer context"`.
   - Expected: the targeted handler tests pass.
2. Confirm the passing cases show that casual filename mentions do not trigger candidate code-pointer admission and conversational PR mentions do not prefetch diff context by default.
   - Expected: ordinary `mention.response` execution remains light unless the request shape explicitly warrants heavier context.

## Test Case 2 — Explicit review mentions preserve the rich review path
1. Run `bun test ./src/execution/mention-context.test.ts ./src/handlers/mention.test.ts --test-name-pattern "explicit review policy keeps conversation, PR metadata, and review thread as separate sections|explicit PR review mention stays on interactive-review/review.full and submits approval review when inspection evidence is present"`.
   - Expected: the explicit-review cases pass.
2. Inspect the test names/results.
   - Expected: explicit review still admits richer context and continues to execute on `review.full` rather than the lighter conversational path.

## Test Case 3 — Prompt accounting exposes fine-grained mention sections
1. Run `bun test ./src/execution/mention-context.test.ts ./src/execution/mention-prompt.test.ts --test-name-pattern "fine-grained prompt-section metrics|keeps mention user-prompt metrics stable"`.
   - Expected: the targeted tests pass.
2. Confirm the assertions cover separate `mention.context` section names and the canonical `mention.user-prompt` section.
   - Expected: operators can attribute prompt cost reductions by section name instead of a coarse context bucket.

## Test Case 4 — Canonical proof surface remains fail-open without Postgres
1. Run `bun test ./scripts/usage-report.test.ts ./scripts/verify-m061-s01.test.ts ./scripts/verify-m061-s02.test.ts`.
   - Expected: all proof/report tests pass.
2. Run `bun -e "import('./scripts/verify-m061-s02.ts').then(async (m) => { const { report } = await m.runM061S02MentionContextProofCli(['--json'], {}); console.log(JSON.stringify(report, null, 2)); })"`.
   - Expected: JSON output reports `databaseAccess: "missing"`, `overallPassed: false`, and no crash.
3. Run `bun -e "import('./scripts/usage-report.ts').then(async (m) => { const { report } = await m.runUsageReportCli(['--json'], {}); console.log(JSON.stringify(report, null, 2)); })"`.
   - Expected: JSON output reports a fail-open preflight with zeroed summary fields and no crash.

## Test Case 5 — Section fetch failures drop only the affected context section
1. Run `bun test ./src/execution/mention-context.test.ts --test-name-pattern "error paths fail open to empty/minimal mention context"`.
   - Expected: the targeted test passes.
2. Confirm the failure mode.
   - Expected: mention reply construction stays alive and omits the failed section instead of aborting the entire mention flow.

## Edge Cases
- Casual file-path references alone must not upgrade a conversational issue mention into a code-seeking path.
- Diff context must remain off for ordinary PR questions unless the request is explicit review or clearly diff-inspection shaped.
- Missing Postgres access must leave the operator proof/report commands in a truthful fail-open state rather than crashing or fabricating telemetry.
- Direct `bun scripts/verify-m061-s02.ts` entrypoint execution may hang in this harness even though the exported CLI helpers succeed; treat exported helper execution plus test coverage as the reliable automated evidence until that runtime quirk is separately debugged.
