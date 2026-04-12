# S01: Live Phase Timing and Operator Evidence Surfaces

**Goal:** Capture durable per-phase latency on the real xbmc/kodiai review path and expose it on Review Details plus an operator verifier, correlated by deliveryId and reviewOutputKey, without making review execution more brittle.
**Demo:** Trigger a real xbmc/kodiai review and inspect Review Details plus the live verifier/audit output to see queue wait, workspace preparation, retrieval/context assembly, executor handoff/runtime, and publication timings tied to the review output key.

## Must-Haves

- Live review executions emit one truthful phase-timing payload keyed by `deliveryId` and `reviewOutputKey`, covering `queue wait`, `workspace preparation`, `retrieval/context assembly`, `executor handoff`, `remote runtime`, and `publication`, with explicit unavailable/degraded states instead of invented zeroes.
- GitHub Review Details renders the same required phase set in a stable order so operators can see where a live review spent time without opening ad hoc raw logs.
- The operator-facing audit surface can resolve a single live review by `reviewOutputKey`, report the captured phase timings plus total wall-clock time, and fail loudly on missing or mismatched correlation evidence.
- Timing capture stays fail-open: successful, failed, and timeout reviews still publish their existing truthful outcome even if one timing source is missing.
- `bun test ./src/jobs/queue.test.ts ./src/execution/executor.test.ts ./src/handlers/review.test.ts ./src/lib/review-utils.test.ts ./src/review-audit/phase-timing-evidence.test.ts ./scripts/verify-m048-s01.test.ts`, `bun run verify:m048:s01 -- --review-output-key "$REVIEW_OUTPUT_KEY" --json`, and `bun run tsc --noEmit` pass together.

## Threat Surface

- **Abuse**: False latency evidence could hide the real bottleneck if code hardcodes fast durations, silently drops a required phase, or correlates Azure rows to the wrong `reviewOutputKey` / `deliveryId` pair. Missing phases must fail or surface explicit unavailability, not quiet success.
- **Data exposure**: Phase timing logs and verifier output may include repo, PR number, delivery id, and `reviewOutputKey`, but they must not expose workspace paths, repo bundle locations, prompt text, Azure mount details, tokens, or other secrets.
- **Input trust**: Queue metadata, executor-returned timing spans, verifier CLI args, and Azure Log Analytics rows are all untrusted until normalized and correlation-checked.

## Requirement Impact

- **Requirements touched**: `R050` directly; `R043` / `R044` as continuity requirements because live review publication and explicit review execution must keep working while timing capture is added.
- **Re-verify**: Focused queue/executor/review handler tests, Review Details publication tests, and the live `verify:m048:s01` audit command must agree on the same six operator phases and correlation ids.
- **Decisions revisited**: `D100` (measurement-first M048 execution strategy) and `D101` (phase timing must surface on existing GitHub/Azure evidence surfaces).

## Proof Level

- This slice proves: operational latency evidence on the real GitHub -> queue -> workspace -> ACA -> Review Details path.
- Real runtime required: yes.
- Human/UAT required: yes — trigger a real `xbmc/kodiai` review and pass its `reviewOutputKey` to `verify:m048:s01`.

## Verification

- `bun test ./src/jobs/queue.test.ts ./src/execution/executor.test.ts ./src/handlers/review.test.ts ./src/lib/review-utils.test.ts ./src/review-audit/phase-timing-evidence.test.ts ./scripts/verify-m048-s01.test.ts`
- `bun run verify:m048:s01 -- --review-output-key "$REVIEW_OUTPUT_KEY" --json`
- `bun run tsc --noEmit`

## Observability / Diagnostics

- Runtime signals: a structured review-phase timing log emitted on review completion with required phase durations/status plus total wall-clock time.
- Inspection surfaces: GitHub Review Details timing block, Azure Log Analytics filtered by `reviewOutputKey` / `deliveryId`, and `bun run verify:m048:s01 -- --review-output-key "$REVIEW_OUTPUT_KEY" --json`.
- Failure visibility: missing/degraded phases, unavailable surfaces, total-vs-phase drift, and correlation ids all stay visible to future agents.
- Redaction constraints: do not log workspace paths, prompt content, repo bundle paths, or secrets.

## Integration Closure

- Upstream surfaces consumed: `src/jobs/queue.ts` wait metrics, `src/handlers/review.ts` orchestration phases, `src/execution/executor.ts` ACA staging/runtime boundaries, `src/lib/review-utils.ts`, and Azure Log Analytics via `src/review-audit/log-analytics.ts`.
- New wiring introduced in this slice: the review handler merges queue + local + executor timings, Review Details renders the merged phase object, and `verify:m048:s01` resolves the same evidence by `reviewOutputKey`.
- What remains before the milestone is truly usable end-to-end: later slices can optimize latency using this proof surface, but S01 itself is complete once the live review path and verifier expose the required phase evidence.

## Tasks

- [x] **T01: Capture live review phase timings across queue and executor** `est:2h`
  - Why: The slice needs one truthful timing contract at the real runtime seams before any visible surface can render or verify it.
  - Files: `src/jobs/types.ts`, `src/jobs/queue.ts`, `src/jobs/queue.test.ts`, `src/execution/types.ts`, `src/execution/executor.ts`, `src/execution/executor.test.ts`, `src/handlers/review.ts`, `src/handlers/review.test.ts`
  - Do: Extend the queue/executor contracts so the review handler receives queue wait plus executor handoff/runtime timings, timestamp the local orchestration phases in `src/handlers/review.ts`, and emit one structured completion log keyed by `deliveryId` and `reviewOutputKey` with explicit unavailable/degraded states instead of guessed zeroes.
  - Verify: `bun test ./src/jobs/queue.test.ts ./src/execution/executor.test.ts ./src/handlers/review.test.ts`
  - Done when: a live review path can produce the required six named phases as one normalized payload even on success, failure, and timeout paths.

- [ ] **T02: Render the captured timings on GitHub Review Details** `est:90m`
  - Why: Operators already inspect Review Details first, so the new timing contract must become GitHub-visible on both clean and findings-published review paths.
  - Files: `src/lib/review-utils.ts`, `src/lib/review-utils.test.ts`, `src/handlers/review.ts`, `src/handlers/review.test.ts`
  - Do: Add a stable Review Details formatter for the six required phases plus total wall-clock time, thread the merged phase object through Review Details publication, and keep degraded/unavailable wording explicit instead of inventing smooth success.
  - Verify: `bun test ./src/lib/review-utils.test.ts ./src/handlers/review.test.ts`
  - Done when: Review Details shows queue wait, workspace preparation, retrieval/context assembly, executor handoff, remote runtime, and publication in a stable order on both standalone and append-to-summary paths.

- [ ] **T03: Ship the M048 S01 operator latency verifier** `est:90m`
  - Why: S01 is not complete until an operator can answer “where did the time go for this review output key?” from a repeatable proof command instead of raw log archaeology.
  - Files: `src/review-audit/log-analytics.ts`, `src/review-audit/phase-timing-evidence.ts`, `src/review-audit/phase-timing-evidence.test.ts`, `scripts/verify-m048-s01.ts`, `scripts/verify-m048-s01.test.ts`, `package.json`
  - Do: Normalize structured phase-timing rows from Azure Log Analytics, build `verify:m048:s01` around `--review-output-key` with optional `--delivery-id`, and keep the report scoped to one live review with named unavailable/error states on correlation drift.
  - Verify: `bun test ./src/review-audit/phase-timing-evidence.test.ts ./scripts/verify-m048-s01.test.ts && bun run verify:m048:s01 -- --review-output-key "$REVIEW_OUTPUT_KEY" --json`
  - Done when: `verify:m048:s01` resolves one live review by `reviewOutputKey`, reports the same six phases used on Review Details, and fails loudly on missing/mismatched evidence.

## Files Likely Touched

- `src/jobs/types.ts`
- `src/jobs/queue.ts`
- `src/jobs/queue.test.ts`
- `src/execution/types.ts`
- `src/execution/executor.ts`
- `src/execution/executor.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `src/lib/review-utils.ts`
- `src/lib/review-utils.test.ts`
- `src/review-audit/log-analytics.ts`
- `src/review-audit/phase-timing-evidence.ts`
- `src/review-audit/phase-timing-evidence.test.ts`
- `scripts/verify-m048-s01.ts`
- `scripts/verify-m048-s01.test.ts`
- `package.json`
