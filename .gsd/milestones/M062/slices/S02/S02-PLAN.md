# S02: Coverage and visible-state rendering

**Goal:** Render one coherent bounded first-pass visible contract across the public comment and Review Details so maintainers can see what Kodiai covered, what remains, and whether continuation is still pending without implying exhaustive review.
**Demo:** After this: the visible review surface states what was covered, what remains, and whether continuation is still in progress, using one coherent comment contract.

## Must-Haves

- **Demo:** The visible review surface states what was covered, what remains, and whether continuation is still in progress or has stopped, using one coherent comment contract across the bounded public comment and Review Details.
- ## Must-Haves
- Both `formatPartialReviewComment()` and `formatReviewDetailsSummary()` consume the same wording contract for bounded first-pass state instead of drifting through separate prose paths.
- Timeout partial publication, retry merge updates, and exhausted-`max_turns` bounded fallback in `src/handlers/review.ts` all publish the same truthful coverage and continuation wording.
- Visible wording stays explicitly bounded and never implies exhaustive review when remaining scope exists or continuation has stopped.
- Requirement `R064` is advanced with unit and handler integration proof.
- ## Threat Surface
- **Abuse**: A misleading visible contract could falsely imply exhaustive review coverage, causing maintainers to trust incomplete review output.
- **Data exposure**: none beyond existing PR metadata and aggregate coverage/finding counts already surfaced in review comments.
- **Input trust**: normalized first-pass state from checkpoints, boundedness, and handler outcome data is trusted only after `normalizeReviewFirstPass()` validates it.
- ## Requirement Impact
- **Requirements touched**: R064
- **Re-verify**: bounded timeout publication, retry-merged partial comment updates, exhausted-`max_turns` bounded fallback, and Review Details wording parity.
- **Decisions revisited**: D173, D180
- ## Proof Level
- This slice proves: contract
- Real runtime required: no
- Human/UAT required: no
- ## Verification
- `bun test ./src/lib/review-utils.test.ts ./src/lib/partial-review-formatter.test.ts`
- `bun test ./src/handlers/review.test.ts`
- `bun run tsc --noEmit`
- ## Observability / Diagnostics
- Runtime signals: bounded first-pass detail lines and public bounded comment text remain the observable contract for coverage, remaining scope, and continuation state.
- Inspection surfaces: `src/lib/review-utils.test.ts`, `src/lib/partial-review-formatter.test.ts`, and `src/handlers/review.test.ts` assert the rendered strings across formatter and handler publication paths.
- Failure visibility: regressions show up as changed visible wording or timeout/max-turns publication mismatches in the targeted test files.
- Redaction constraints: keep output limited to aggregate file counts, bounded reason, evidence source, and continuation state; no new raw prompt or secret data surfaces.
- ## Integration Closure
- Upstream surfaces consumed: `src/lib/review-first-pass.ts`, existing checkpoint/boundedness payloads, and handler publication branches in `src/handlers/review.ts`.
- New wiring introduced in this slice: shared formatter contract consumption by partial-comment and Review Details rendering, then reused in timeout, retry-merge, and bounded fallback publication flows.
- What remains before the milestone is truly usable end-to-end: S03 still needs a milestone-level deterministic verifier that locks the visible contract against regression.

## Proof Level

- This slice proves: contract

## Integration Closure

Shared visible-state formatter contract wired through `src/lib/review-utils.ts`, `src/lib/partial-review-formatter.ts`, and `src/handlers/review.ts`; S03 remains responsible for the milestone-level deterministic proof harness.

## Verification

- Formatter and handler tests become the primary inspection surface for visible-state regressions, especially timeout and max-turns paths where wording drift would otherwise be easy to miss.

## Tasks

- [x] **T01: Lock the visible-state wording contract in formatter tests and shared helpers** `est:50m`
  Define the visible bounded-first-pass contract at the formatter seam before touching handler branches. Expand formatter tests to assert one coherent statement of covered scope, remaining scope, and continuation state for both the public bounded comment and Review Details, then refactor the shared helper layer in `src/lib/review-utils.ts` so both surfaces consume the same wording primitives instead of parallel prose.
  - Files: `src/lib/review-utils.ts`, `src/lib/review-utils.test.ts`, `src/lib/partial-review-formatter.ts`, `src/lib/partial-review-formatter.test.ts`
  - Verify: bun test ./src/lib/review-utils.test.ts ./src/lib/partial-review-formatter.test.ts

- [ ] **T02: Make Review Details and bounded comments render the same coverage and continuation story** `est:45m`
  Wire the shared wording contract into both visible surfaces. Reconcile the current `timeoutProgress` precedence in `formatReviewDetailsSummary()` with the normalized first-pass payload so timeout details can add retry metadata without bypassing the shared coverage/remaining/continuation wording, and keep surface-specific framing limited to blockquote versus bullet formatting.
  - Files: `src/lib/review-utils.ts`, `src/lib/review-utils.test.ts`, `src/lib/partial-review-formatter.ts`, `src/lib/partial-review-formatter.test.ts`
  - Verify: bun test ./src/lib/review-utils.test.ts ./src/lib/partial-review-formatter.test.ts

- [ ] **T03: Propagate the unified contract through timeout, retry-merge, and max-turns publication paths** `est:55m`
  Update `src/handlers/review.ts` and its integration coverage so every constrained publication branch uses the unified visible-state contract. Prove timeout partial publication, retry-merged partial comment updates, and exhausted-`max_turns` bounded fallback all render the same truthful coverage and continuation state without bespoke handler prose.
  - Files: `src/handlers/review.ts`, `src/handlers/review.test.ts`, `src/lib/review-utils.ts`, `src/lib/partial-review-formatter.ts`
  - Verify: bun test ./src/handlers/review.test.ts && bun run tsc --noEmit

## Files Likely Touched

- src/lib/review-utils.ts
- src/lib/review-utils.test.ts
- src/lib/partial-review-formatter.ts
- src/lib/partial-review-formatter.test.ts
- src/handlers/review.ts
- src/handlers/review.test.ts
