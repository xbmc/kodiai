# S03: Review Prompt Compaction and Budget Enforcement

**Goal:** Make review prompt assembly emit bounded, named review sections so expensive review context is compacted, attributable, and still truthful through the existing `review.user-prompt` telemetry/reporting path.
**Demo:** review prompt assembly uses bounded per-section budgets and the packed unified knowledge-context representation, materially shrinking the prompt without removing truthful review guidance.

## Must-Haves

- Review prompt construction in `src/execution/review-prompt.ts` emits multiple named sections instead of a single `review-user-prompt` blob, with explicit per-section budgets/truncation for the volatile high-cost review context.
- The unified retrieval path remains preferred when `unifiedResults` are present; legacy retrieval/precedent/wiki sections stay omitted in that mode, and required instruction/safety guidance still survives compaction.
- `src/handlers/review.ts` continues to persist prompt telemetry under `promptKind: "review.user-prompt"` for both initial and retry review flows, now carrying the multi-section metrics produced by the prompt builder.
- Operators can prove which review sections consume budget and when truncation happened using the canonical reporting surface plus a dedicated slice verifier.
- Slice verification passes with fresh assertions in `src/execution/review-prompt.test.ts`, `src/handlers/review.test.ts` and `scripts/verify-m061-s03.test.ts`, plus the command `bun test src/execution/review-prompt.test.ts src/handlers/review.test.ts scripts/usage-report.test.ts scripts/verify-m061-s03.test.ts` and a fail-open smoke run of `bun scripts/verify-m061-s03.ts --json`.

## Proof Level

- This slice proves: This slice proves: contract + integration.
- Contract: `buildReviewPromptDetails()` has stable named section boundaries, budgets, and truncation semantics.
- Integration: the review handler persists those sections through `prompt_section_events` under the existing `review.user-prompt` prompt kind, and the operator proof surface reports them.
- Real runtime required: no.
- Human/UAT required: no.

## Integration Closure

- Upstream surfaces consumed: `src/execution/review-prompt.ts`, `src/execution/prompt-section-metrics.ts`, `src/handlers/review.ts`, `scripts/usage-report.ts`, and the S01 Postgres-backed `prompt_section_events` reporting contract.
- New wiring introduced in this slice: the review prompt builder returns budgeted section metrics, the review handler persists them on both normal and retry review paths, and a new `scripts/verify-m061-s03.ts` proof script reads the canonical reporting/query layer.
- What remains before the milestone is truly usable end-to-end: S04/S05 still need retrieval reuse and end-to-end token-reduction proof across representative review/mention flows.

## Verification

- Runtime signals: per-section `charCount`, `estimatedTokens`, and `truncated` flags for review prompt sections.
- Inspection surfaces: `prompt_section_events`, `bun scripts/usage-report.ts`, and `bun scripts/verify-m061-s03.ts`.
- Failure visibility: operators can distinguish whether prompt growth came from changed-files/diff context, graph/structural evidence, knowledge context, or instruction-heavy guidance.
- Redaction constraints: preserve the existing text-free telemetry contract; only section metrics and names are persisted, never raw prompt text.

## Tasks

- [x] **T01: Refactor the review prompt builder into budgeted named sections** `est:4h`
  Split `buildReviewPromptDetails()` in `src/execution/review-prompt.ts` from a monolithic `lines: string[]` build into explicit prompt-section assembly that preserves the current review content order while exposing real section boundaries. Add local budgeting/truncation for the volatile expensive sections called out by research: changed-files/diff-shape context, large-PR/incremental/boundedness context, unified knowledge context (with legacy fallback only when unified data is absent), graph/structural impact evidence, and the instruction-heavy tail. Keep `promptKind: "review.user-prompt"` semantics unchanged; only the internal section accounting and enforced caps should change. Document any budget constants in code so later slices can adjust them without rediscovering the section map.
  - Files: `src/execution/review-prompt.ts`, `src/execution/review-prompt.test.ts`, `src/execution/prompt-section-metrics.ts`
  - Verify: bun test src/execution/review-prompt.test.ts

- [x] **T02: Wire multi-section review prompt telemetry through initial and retry review execution** `est:3h`
  Update the review handler so both the normal review flow and the reduced-scope retry flow persist the new section arrays returned by `buildReviewPromptDetails()` without collapsing them back into one bucket. Add or extend handler tests to assert that `promptKind: "review.user-prompt"` remains stable while multiple named section rows are emitted for review execution, including truncation metadata when the prompt builder reports it. Keep the work wiring-only: the handler should consume the new prompt-builder contract rather than recomputing section metrics itself.
  - Files: `src/handlers/review.ts`, `src/handlers/review.test.ts`, `src/execution/review-prompt.ts`
  - Verify: bun test src/handlers/review.test.ts

- [x] **T03: Add operator proof for section budgets and truncation visibility** `est:3h`
  Extend the operator proof surface so S03 can be re-verified without inspecting raw prompts. Add a dedicated verifier script/test pair that reuses the Postgres-backed usage-report query layer and checks for named `review.full / review.user-prompt / <section>` rows plus truncation evidence on review sections. Update any usage-report fixtures/tests needed so the canonical reporting surface remains aligned with the new review section names instead of assuming a single review block. The proof should fail open when Postgres access is unavailable, matching the S01 operator pattern.
  - Files: `scripts/verify-m061-s03.ts`, `scripts/verify-m061-s03.test.ts`, `scripts/usage-report.ts`, `scripts/usage-report.test.ts`, `scripts/verify-m061-s01.ts`
  - Verify: bun test scripts/usage-report.test.ts scripts/verify-m061-s03.test.ts && bun scripts/verify-m061-s03.ts --json

## Files Likely Touched

- src/execution/review-prompt.ts
- src/execution/review-prompt.test.ts
- src/execution/prompt-section-metrics.ts
- src/handlers/review.ts
- src/handlers/review.test.ts
- scripts/verify-m061-s03.ts
- scripts/verify-m061-s03.test.ts
- scripts/usage-report.ts
- scripts/usage-report.test.ts
- scripts/verify-m061-s01.ts
