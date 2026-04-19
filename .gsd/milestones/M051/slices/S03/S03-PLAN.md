# S03: Residual operator truthfulness cleanup

**Goal:** Retire the remaining truthful M048 operator/verifier drift from PR #87 by rejecting incomplete phase-timing payloads, fixing tri-state outcome wording, and aligning the last stale docs/adjacent code surface on `main`.
**Demo:** After this slice, the remaining operator/verifier truthfulness debt from PR #87 is fixed on `main` instead of being stranded in a closed PR review.

## Must-Haves

- `buildPhaseTimingEvidence()` stops reporting `status: "ok"` when matched phase-summary rows are missing `conclusion` and/or `published`, while still preserving the matched row, normalized phases, and named payload issues for diagnosis.
- `deriveM048S01Outcome()` distinguishes `no evidence` from `evidence present but incomplete`, preserves tri-state publication wording (`published output`, `no published output`, `publication unknown`), and downstream M048 verifier/report tests stay truthful.
- `docs/runbooks/review-requested-debug.md` no longer advertises an `M050` timeout-truth heading above `verify:m048:*` commands.
- The last stranded PR #87 code-cleanup comment is cleared by replacing the local `timeoutProgress` type literal in `src/handlers/review.ts` with the exported `TimeoutReviewDetailsProgress` type.

## Threat Surface

- **Abuse**: malformed or partial Review phase timing summary payloads must not yield a false-green `ok` verifier result or a misleading `no evidence` summary when a matched row actually exists.
- **Data exposure**: no new sensitive data is introduced; the slice continues exposing only existing review correlation fields (`reviewOutputKey`, `deliveryId`) plus phase timing details already present on the operator proof surfaces.
- **Input trust**: Azure Log Analytics rows, parsed `conclusion` / `published` fields, and review-output-key correlation values are untrusted until normalized by `src/review-audit/phase-timing-evidence.ts` and reinterpreted by the verifier scripts.

## Requirement Impact

- **Requirements touched**: R049, R050.
- **Re-verify**: parser invalid-payload handling in `src/review-audit/phase-timing-evidence.test.ts`, outcome wording in `scripts/verify-m048-s01.test.ts`, downstream report reuse in `scripts/verify-m048-s03.test.ts`, docs header drift via targeted grep, and `bun run tsc --noEmit`.
- **Decisions revisited**: D101, D106, D122, D127.

## Proof Level

- This slice proves: integration proof on deterministic parser/verifier fixtures plus operator-doc drift checks.
- Real runtime required: no.
- Human/UAT required: no.

## Verification

- `bun test ./src/review-audit/phase-timing-evidence.test.ts ./scripts/verify-m048-s01.test.ts ./scripts/verify-m048-s03.test.ts`
- `bun test ./scripts/verify-m048-s02.test.ts ./src/lib/review-utils.test.ts ./src/handlers/review.test.ts`
- `! rg -n "^## M050 Timeout-Truth Verifier Surfaces$" docs/runbooks/review-requested-debug.md && rg -n "^## M048 .*Verifier Surfaces$|verify:m048:s01|verify:m048:s02|verify:m048:s03" docs/runbooks/review-requested-debug.md`
- `bun run tsc --noEmit`

## Observability / Diagnostics

- Runtime signals: `invalid-phase-payload` and named missing-field issues from `buildPhaseTimingEvidence()`, plus repaired `outcome.summary` strings from `verify:m048:s01` reused by `verify:m048:s03`.
- Inspection surfaces: `src/review-audit/phase-timing-evidence.test.ts`, `scripts/verify-m048-s01.test.ts`, `scripts/verify-m048-s03.test.ts`, targeted runbook grep, and TypeScript compile output.
- Failure visibility: incomplete evidence now stays visible as matched-but-invalid payload drift instead of collapsing into a false-green or false-negative summary.
- Redaction constraints: keep the existing `reviewOutputKey` / `deliveryId` proof surfaces; do not add any new secret-bearing or operator-irrelevant log fields.

## Integration Closure

- Upstream surfaces consumed: `src/review-audit/phase-timing-evidence.ts`, `scripts/verify-m048-s01.ts`, `scripts/verify-m048-s03.ts`, `docs/runbooks/review-requested-debug.md`, and `src/lib/review-utils.ts` / `src/handlers/review.ts`.
- New wiring introduced in this slice: invalid phase-payload issues from the parser become the trusted source for operator-visible verifier summaries, while the runbook and review handler stop carrying stale local drift.
- What remains before the milestone is truly usable end-to-end: nothing for the PR #87 truthfulness debt on `main` once these regressions and docs/code alignments land.

## Tasks

- [x] **T01: Harden the phase-timing evidence contract against incomplete payloads** `est:1h`
  - Why: the root false-green lives at the parser seam, where matched phase-timing rows missing `conclusion` and/or `published` still return `status: "ok"`.
  - Files: `src/review-audit/phase-timing-evidence.ts`, `src/review-audit/phase-timing-evidence.test.ts`
  - Do: add failing regressions first, treat both fields as named payload issues, keep the matched row plus normalized phases visible for diagnosis, and preserve existing malformed-phase behavior instead of hiding it behind the new checks.
  - Verify: `bun test ./src/review-audit/phase-timing-evidence.test.ts`
  - Done when: incomplete matched rows return `invalid-phase-payload` with specific issues for missing `conclusion` / `published`, while `evidence` still carries the matched row identity and normalized phases.
- [x] **T02: Make the M048 verifier summaries preserve tri-state publication truth** `est:1h`
  - Why: the S01 verifier currently collapses `evidence present but incomplete` into the same summary as `no evidence`, and it treats `published: null` as if publication definitely failed.
  - Files: `scripts/verify-m048-s01.ts`, `scripts/verify-m048-s01.test.ts`, `scripts/verify-m048-s03.test.ts`
  - Do: add failing summary regressions first, keep `no correlated phase evidence available` only for the real no-evidence case, render `publication unknown` when `published` is null, and pin the downstream S03 report surface so it reuses the repaired wording unchanged.
  - Verify: `bun test ./scripts/verify-m048-s01.test.ts ./scripts/verify-m048-s03.test.ts && bun test ./scripts/verify-m048-s02.test.ts`
  - Done when: operator-facing outcome summaries stay truthful for missing conclusion/publication fields, and downstream verifier tests keep the shared report contract green.
- [x] **T03: Align the runbook heading and clear the last stranded PR #87 code cleanup** `est:45m`
  - Why: after the parser and verifier fixes, the remaining stale operator surface is the `M050` runbook heading above `verify:m048:*` commands, plus the still-duplicated `timeoutProgress` shape in `src/handlers/review.ts`.
  - Files: `docs/runbooks/review-requested-debug.md`, `src/handlers/review.ts`, `src/lib/review-utils.ts`
  - Do: rename the runbook heading to an M048-correct title and swap the local handler type literal for the exported `TimeoutReviewDetailsProgress` type so the closed PR no longer leaves adjacent cleanup debt behind.
  - Verify: `bun test ./src/lib/review-utils.test.ts ./src/handlers/review.test.ts && ! rg -n "^## M050 Timeout-Truth Verifier Surfaces$" docs/runbooks/review-requested-debug.md && rg -n "^## M048 .*Verifier Surfaces$|verify:m048:s01|verify:m048:s02|verify:m048:s03" docs/runbooks/review-requested-debug.md && bun run tsc --noEmit`
  - Done when: the runbook header matches the verifier family, the inline `timeoutProgress` type literal is gone from `src/handlers/review.ts`, and nearby tests/typecheck stay green.

## Files Likely Touched

- `src/review-audit/phase-timing-evidence.ts`
- `src/review-audit/phase-timing-evidence.test.ts`
- `scripts/verify-m048-s01.ts`
- `scripts/verify-m048-s01.test.ts`
- `scripts/verify-m048-s03.test.ts`
- `docs/runbooks/review-requested-debug.md`
- `src/handlers/review.ts`
- `src/lib/review-utils.ts`
