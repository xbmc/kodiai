# S03: Bounded continuation shaping and authority-safe proof

**Goal:** Prove that continuation stays materially narrower than the first pass and that shipped same-surface continuation write paths still block stale/superseded publication on the final summary and Review Details merge path.
**Demo:** Deterministic proof shows continuation prompt/context is materially narrower than the first pass, final write paths keep last-mile publish-rights guards, and stale/superseded continuation cannot overwrite newer authoritative review state on the shipped continuation paths.

## Must-Haves

- **Demo:** `bun run verify:m063:s03 -- --json` reports a passing matrix that compares first-pass vs continuation prompt sections using production builders and confirms stale/superseded continuation cannot mutate the shipped same-surface write path.
- ## Must-Haves
- Deterministic proof compares initial large-PR prompt assembly against continuation prompt assembly on production seams rather than mocked prose.
- Proof shows continuation is sufficient-but-bounded: retry prompt/context is narrower in the sections that actually change, omits first-pass-only large-PR expansion, and stays truthful instead of claiming exhaustive coverage.
- Shipped same-surface continuation writes re-prove publish-right safety for both canonical summary merge and nested Review Details refresh, including quiet no-delta settlement.
- Slice verification re-runs existing S01/S02 continuation surfaces so R062/R063/R065 behavior is not regressed while adding R066 proof.
- ## Threat Surface
- **Abuse**: A stale or superseded retry attempt could replay older continuation output onto the canonical review comment, or a too-broad continuation prompt could effectively replay first-pass cost while still presenting itself as bounded.
- **Data exposure**: Review prompts may include repository code, prior findings, retrieval context, and Review Details metadata, but no new secrets or identities should be surfaced beyond existing review paths.
- **Input trust**: Prompt-shaping inputs come from PR metadata, changed-file lists, continuation scope planning, prior findings, retrieval context, and coordinator authority state; verifier fixtures must model these inputs without inventing new trust boundaries.
- ## Requirement Impact
- **Requirements touched**: R066, plus milestone success criteria around stale-authority-safe continuation publication and preservation of R062/R063/R065 behavior.
- **Re-verify**: Continuation lifecycle scheduling, same-surface ownership, explicit revision/no-delta settlement, prompt-section telemetry integrity, and stale-authority suppression on retry merge paths.
- **Decisions revisited**: D181, D183, D185, D186.
- ## Verification
- `bun test src/execution/review-prompt.test.ts --filter "continuation"`
- `bun test src/handlers/review.test.ts --filter "retry"`
- `bun test scripts/verify-m063-s03.test.ts`
- `bun run verify:m063:s03 -- --json`
- `bun run verify:m063:s02 -- --json`
- `bun run tsc --noEmit`

## Proof Level

- This slice proves: - This slice proves: contract + integration
- Real runtime required: no
- Human/UAT required: no

## Integration Closure

- Upstream surfaces consumed: `src/handlers/review.ts`, `src/execution/review-prompt.ts`, `src/lib/review-continuation-lifecycle.ts`, `src/lib/retry-scope-reducer.ts`, `src/lib/partial-review-formatter.ts`, `scripts/verify-m063-s02.ts`
- New wiring introduced in this slice: package-level verifier entry for S03 plus deterministic comparison fixtures that exercise the production prompt builder and shipped retry merge authority path.
- What remains before the milestone is truly usable end-to-end: nothing beyond running the S03 verifier and full TypeScript/test gates during slice close.

## Verification

- Runtime signals: existing prompt-section metrics, retry scope metadata, and coordinator publish-right suppression logs remain the primary proof surfaces; S03 adds deterministic verifier statuses that summarize narrowing and authority-safety outcomes.
- Inspection surfaces: `scripts/verify-m063-s03.ts --json`, `src/execution/review-prompt.test.ts`, and `src/handlers/review.test.ts --filter "retry"`.
- Failure visibility: verifier output should name the section or authority check that drifted, while handler tests continue to expose which retry write path was suppressed.
- Redaction constraints: verifier fixtures and reports must stay on tracked sample data only and must not emit repository secrets or non-test credentials.

## Tasks

- [x] **T01: Lock continuation prompt narrowing against the production prompt builder** `est:50m`
  Establish the deterministic prompt-shaping seam for S03 by comparing initial large-PR and continuation prompt assembly through `buildReviewPromptDetails(...)` and the real handler context contract. Start from `src/handlers/review.ts` and `src/execution/review-prompt.ts`, extract only the minimum shared fixture/helper surface needed to build a first-pass context and a retry context from the same review state, and add focused prompt-builder tests that assert the sections which are supposed to shrink actually do shrink. Document in the tests that narrowing is section-specific rather than universally smaller because retrieval/knowledge context is intentionally reused.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `buildReviewPromptDetails(...)` section metrics | Fail the test and verifier immediately with a section-specific assertion so prompt drift is visible at the production seam. | N/A for pure tests; keep the helper synchronous and deterministic. | Treat missing/renamed sections as contract failure and report which required section disappeared. |
| Retry-scope / handler context assumptions | Keep assertions on subset/narrowing semantics instead of exact ratio math so heuristic changes fail only when the boundedness contract breaks. | N/A for pure fixtures. | Reject fixtures that do not model a real continuation subset or large-PR first-pass shape. |

## Load Profile

- **Shared resources**: None at runtime; this task is pure prompt-construction and test execution.
- **Per-operation cost**: Two prompt builds plus section-metric comparisons per scenario.
- **10x breakpoint**: Test output becomes noisy before compute cost matters; keep the scenario matrix small and deterministic.

## Negative Tests

- **Malformed inputs**: missing retry section records, empty continuation file set, or absent large-PR first-pass context should fail the contract test.
- **Error paths**: section rename/removal or a retry prompt that grows instead of narrowing should produce explicit failure messages.
- **Boundary conditions**: verify continuation keeps required sections even when size/change sections shrink and when reused knowledge sections stay equal.

## Steps

1. Audit the initial and retry prompt-build contexts in `src/handlers/review.ts` and identify the concrete inputs that differ (`changedFiles`, `largePRContext`, continuation instructions, boundedness inputs, and retry scope metadata).
2. Add or extract the smallest tracked helper/fixture surface needed to build first-pass and continuation prompt contexts from one review scenario without duplicating handler business logic.
3. Extend `src/execution/review-prompt.test.ts` with deterministic assertions for section presence, total/section token or char deltas, subset-of-files behavior, and truthful sufficient-but-bounded wording.
4. Keep assertions resilient to reused retrieval/knowledge context by requiring narrowing where the contract actually changes instead of demanding every section shrink.

## Must-Haves

- [ ] Prompt-builder coverage proves continuation narrows `review-change-context` and `review-size-context` relative to a large-PR first pass.
- [ ] Tests prove continuation omits first-pass-only `largePRContext` expansion while preserving the required named prompt sections.
- [ ] The prompt proof surface is production-seam-based and deterministic, not a mocked prompt string snapshot.

## Verification

- `bun test src/execution/review-prompt.test.ts --filter "continuation"`
- `bun run tsc --noEmit`

## Observability Impact

- Signals added/changed: prompt-section comparison failures become explicit test assertions on named sections and narrowing reasons.
- How a future agent inspects this: run `bun test src/execution/review-prompt.test.ts --filter "continuation"` and inspect the failing section names.
- Failure state exposed: missing section, widened retry scope, or lost boundedness wording is surfaced directly in deterministic test output.
  - Files: `src/execution/review-prompt.ts`, `src/execution/review-prompt.test.ts`, `src/handlers/review.ts`, `src/lib/retry-scope-reducer.ts`
  - Verify: bun test src/execution/review-prompt.test.ts --filter "continuation" && bun run tsc --noEmit

- [x] **T02: Add an S03 verifier that proves bounded continuation without exaggeration** `est:45m`
  Package the S03 proof into a deterministic verifier script that mirrors the S01/S02 proof style: build first-pass and continuation prompt evidence from tracked fixtures, report section-level narrowing and sufficiency checks, and wire a `verify:m063:s03` script plus verifier tests. The verifier should be strict enough to fail when continuation replays first-pass breadth or loses required boundedness truthfulness, but it must stay honest about what it proves: narrower/sufficient-than-first-pass continuation, not exhaustive eventual coverage.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| Prompt comparison helper from T01 | Bubble the helper failure into a contract-failed verifier result with the scenario/check name. | N/A; verifier is pure and local. | Treat malformed section data as a failed check and record it in `issues`. |
| CLI/report wiring in `package.json` | Fail the verifier test that checks script wiring so execution cannot silently skip the proof. | N/A. | Report invalid args with an explicit `m063_s03_invalid_arg` status code and usage text. |

## Load Profile

- **Shared resources**: None; verifier remains pure and file-local.
- **Per-operation cost**: A small fixed scenario matrix with prompt builds and summary/report rendering.
- **10x breakpoint**: Report verbosity, not compute, so keep scenarios narrowly tied to R066 and authority-safe proof.

## Negative Tests

- **Malformed inputs**: invalid scenario id, missing required prompt sections, or an empty continuation file subset should fail deterministically.
- **Error paths**: package-script drift, contract-failed scenario mutation, or widened continuation metrics should turn the verifier red.
- **Boundary conditions**: include a scenario where continuation stays narrower but quiet/no-delta semantics still avoid overclaiming exhaustive coverage.

## Steps

1. Model a small S03 scenario matrix covering large-PR first-pass vs continuation prompt comparison plus truthful boundedness reporting.
2. Implement `scripts/verify-m063-s03.ts` to evaluate the matrix, emit human and JSON reports, and return dedicated status codes for invalid args vs contract failure.
3. Add `scripts/verify-m063-s03.test.ts` coverage for scenario rendering, failure injection, and `package.json` script wiring.
4. Wire `package.json` with `verify:m063:s03` and keep the report language explicit about sufficient-but-bounded rather than exhaustive coverage.

## Must-Haves

- [ ] `verify:m063:s03` reports section-level narrowing evidence and boundedness wording checks using tracked fixtures only.
- [ ] Verifier output stays truthful about sufficiency and does not claim exhaustive review completion.
- [ ] Package/test wiring makes the verifier part of repeatable slice-close evidence.

## Verification

- `bun test scripts/verify-m063-s03.test.ts`
- `bun run verify:m063:s03 -- --json`

## Observability Impact

- Signals added/changed: new verifier status codes and per-scenario checks for narrowing, boundedness truthfulness, and contract drift.
- How a future agent inspects this: run `bun run verify:m063:s03 -- --json` and inspect `issues` plus failing check keys.
- Failure state exposed: which scenario/check stopped proving bounded continuation.
  - Files: `scripts/verify-m063-s03.ts`, `scripts/verify-m063-s03.test.ts`, `package.json`, `src/execution/review-prompt.test.ts`
  - Verify: bun test scripts/verify-m063-s03.test.ts && bun run verify:m063:s03 -- --json

- [ ] **T03: Re-prove authority-safe same-surface continuation writes on the shipped retry path** `est:45m`
  Extend the real handler-path coverage so S03 proves the final same-surface continuation write path still respects publish authority after S02 collapsed continuation onto one canonical comment. Focus on the retry merge path in `src/handlers/review.ts`: canonical summary merge, nested Review Details refresh, and quiet no-delta settlement. Make the tests assert on actual public mutations and suppression logs; only touch handler code if the new assertions expose a genuine gap.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `ReviewWorkCoordinator` publish-right checks | Keep stale-authority scenarios red until the real write path rechecks authority before each public mutation. | N/A in tests; coordinator state is local and deterministic. | Treat missing supersession markers/logs as a failing regression because stale-state suppression is the contract. |
| Canonical-comment / Review Details merge path | Fail the test if either update mutates the comment after rights are lost or if quiet no-delta settlement emits public churn. | N/A for local handler tests. | Fail when the canonical comment cannot be rediscovered or when Review Details merge falls back to an unintended standalone write. |

## Load Profile

- **Shared resources**: In-memory review-work coordinator and mocked GitHub comment state inside handler tests.
- **Per-operation cost**: One queued retry flow with mocked summary lookup/update operations per scenario.
- **10x breakpoint**: Test fixture complexity and assertion brittleness, so keep scenarios narrowly scoped to final write-path guards.

## Negative Tests

- **Malformed inputs**: missing canonical comment id or malformed prior Review Details body should not mask stale-authority failures.
- **Error paths**: stale retry loses rights before summary merge, between summary merge and Review Details merge, or during quiet no-delta settlement.
- **Boundary conditions**: no-delta continuation must settle internally while leaving the canonical public surface unchanged.

## Steps

1. Audit the retry merge branch in `src/handlers/review.ts` to confirm where summary and Review Details writes are independently gated today.
2. Extend `src/handlers/review.test.ts` with explicit stale/superseded scenarios for summary merge suppression, Review Details merge suppression, and quiet no-delta no-op behavior on the canonical comment.
3. Make the tests assert on both comment mutations and publish-right suppression logs so the failure mode is diagnosable.
4. If a gap is exposed, apply the smallest handler fix that preserves S01/S02 semantics and re-run the S02 verifier as a regression guard.

## Must-Haves

- [ ] Handler coverage proves stale/superseded retry cannot update the canonical summary body.
- [ ] Handler coverage proves stale/superseded retry cannot refresh nested Review Details after losing rights.
- [ ] Quiet no-delta continuation remains a public no-op on the same visible surface.

## Verification

- `bun test src/handlers/review.test.ts --filter "retry"`
- `bun run verify:m063:s02 -- --json`
- `bun run tsc --noEmit`

## Observability Impact

- Signals added/changed: stale-authority suppression remains visible through retry-path logs and explicit test assertions on update calls.
- How a future agent inspects this: run `bun test src/handlers/review.test.ts --filter "retry"` and inspect the stale-authority scenario names plus suppression log assertions.
- Failure state exposed: whether summary merge, Review Details merge, or quiet settlement regressed.
  - Files: `src/handlers/review.ts`, `src/handlers/review.test.ts`, `scripts/verify-m063-s02.ts`, `src/lib/partial-review-formatter.ts`
  - Verify: bun test src/handlers/review.test.ts --filter "retry" && bun run verify:m063:s02 -- --json && bun run tsc --noEmit

## Files Likely Touched

- src/execution/review-prompt.ts
- src/execution/review-prompt.test.ts
- src/handlers/review.ts
- src/lib/retry-scope-reducer.ts
- scripts/verify-m063-s03.ts
- scripts/verify-m063-s03.test.ts
- package.json
- src/handlers/review.test.ts
- scripts/verify-m063-s02.ts
- src/lib/partial-review-formatter.ts
