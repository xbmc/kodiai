# S03: S03 — UAT

**Milestone:** M061
**Written:** 2026-04-24T02:20:01.118Z

# UAT — S03 Review Prompt Compaction and Budget Enforcement

## Preconditions

1. Repository is on the S03 implementation state.
2. Bun dependencies are installed.
3. For the fail-open smoke path, no reachable local Postgres is required.
4. For optional live-telemetry checking, a Postgres instance with S01 telemetry schema may be configured through `DATABASE_URL`.

## Test Case 1 — Review prompt builder emits bounded named sections

1. Run `bun test src/execution/review-prompt.test.ts`.
2. Confirm the suite passes.
3. Inspect the test names in the output and verify coverage includes the budgeted named prompt-section metrics contract.

**Expected outcome:**
- The suite passes with no failures.
- Coverage proves `buildReviewPromptDetails()` returns named sections, estimated token counts, and truncation flags.
- Oversized path-instruction / retrieval / graph-context cases stay bounded rather than re-expanding into one unaccounted prompt blob.

## Test Case 2 — Initial review execution persists multi-section telemetry under `review.user-prompt`

1. Run `bun test src/handlers/review.test.ts`.
2. Confirm the specific review prompt section telemetry tests pass.
3. Verify the output includes assertions for the initial review path.

**Expected outcome:**
- The handler suite passes with no failures.
- Initial review execution persists multiple named prompt-section rows while keeping `promptKind: "review.user-prompt"` stable.
- Section metadata includes builder-produced truncation state instead of handler-recomputed approximations.

## Test Case 3 — Retry review execution preserves the same telemetry contract

1. From the same `bun test src/handlers/review.test.ts` run, verify the retry telemetry coverage passes.
2. Confirm the retry path uses the reduced-scope review flow but still records multiple named `review.user-prompt` sections.

**Expected outcome:**
- Retry review execution preserves the same prompt kind and section attribution contract as the initial flow.
- Truncation metadata survives the retry path.
- No regression collapses the retry prompt back into a single coarse section.

## Test Case 4 — Canonical reporting surface recognizes named review sections

1. Run `bun test scripts/usage-report.test.ts scripts/verify-m061-s03.test.ts`.
2. Confirm all tests pass.
3. Verify the proof coverage expects named review sections such as change-context/knowledge-context style rows instead of one legacy review block.

**Expected outcome:**
- The canonical usage-report tests pass.
- The S03 verifier tests pass.
- Operator-facing reporting stays aligned with the new review section names and truncation evidence contract.

## Test Case 5 — Fail-open verifier smoke run reports database-unavailable state cleanly

1. Run `bun scripts/verify-m061-s03.ts --json` in an environment without reachable Postgres.
2. Capture the JSON output.
3. Confirm the command exits cleanly instead of hanging.
4. Inspect the JSON preflight block.

**Expected outcome:**
- Output is valid JSON.
- `preflight.databaseAccess` is `"unavailable"`.
- The detail explains the connection failure (for example `ECONNREFUSED 127.0.0.1:5432`).
- The command fails open as an operator proof surface rather than stalling indefinitely.

## Optional Live-Telemetry Check — Real telemetry attribution

1. Configure reachable Postgres telemetry data from S01 surfaces.
2. Run `bun scripts/verify-m061-s03.ts --json`.
3. Inspect the `observed.reviewUserPromptSections`, `observed.truncatedReviewSections`, and `observed.reviewDeliveries` fields.

**Expected outcome:**
- Review deliveries attribute prompt sections under `review.user-prompt`.
- Named review sections are visible.
- At least one truncated section is reported when oversized review context has been exercised.

## Edge Cases Covered By This UAT

- Oversized review context still preserves truthful instruction/safety guidance while truncating only volatile sections.
- Unified retrieval mode omits legacy retrieval/precedent/wiki sections rather than double-counting knowledge context.
- Retry review execution does not silently change prompt-kind or flatten telemetry.
- Unreachable Postgres produces explicit fail-open evidence instead of a hung verifier/usage-report process.
