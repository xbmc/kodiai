# S01: Graph/Corpus Consumer Adapters and Orchestration — UAT

**Milestone:** M038
**Written:** 2026-04-05T19:19:28.318Z

# S01: Graph/Corpus Consumer Adapters and Orchestration — UAT

**Milestone:** M038  
**Written:** 2026-04-05T12:08:55-07:00

## Preconditions

- Repository contains the M038/S01 implementation in `src/structural-impact/` and the `review.ts` integration changes.
- Bun dependencies are installed.
- No live database, embedding API key, or running graph indexer is required for these scripted proof cases; all slice verification can run against deterministic unit tests and stubs.
- Optional: if you want to inspect integration behavior manually, be prepared to read test names and signal assertions in the structural-impact test files.

## UAT 1 — Bounded payload assembly combines graph and canonical evidence into a single consumer contract

1. Run `bun test ./src/structural-impact/adapters.test.ts`.
2. Confirm the suite passes all tests.
3. Inspect the passing test names and verify they cover:
   - `status is 'ok' when both graph and corpus return results`
   - `status is 'partial' when only graph returns results`
   - `status is 'partial' when only corpus returns results`
   - `status is 'unavailable' when both sources produce no results`
4. Confirm the suite also covers translation fidelity for:
   - graph `impactedFiles`
   - `probableDependents` → `probableCallers`
   - `likelyTests`
   - `graphStats.changedFilesRequested`
   - corpus matches → `canonicalEvidence`

**Expected outcome:** The slice exposes one bounded consumer payload that accurately translates graph and corpus data without importing substrate internals into callers.

## UAT 2 — Orchestrator runs graph and corpus fetches concurrently and returns partial results on timeout/error

1. Run `bun test ./src/structural-impact/orchestrator.test.ts`.
2. Confirm the suite passes all tests.
3. Verify the passing test list includes explicit timeout/error scenarios for:
   - graph timeout → partial
   - corpus timeout → partial
   - both timeout → unavailable
   - graph error → partial
   - corpus error → partial
   - both error → unavailable
4. Confirm the suite includes `both adapters run concurrently (total time < sum of individual times)`.

**Expected outcome:** Graph and corpus lookups do not serialize each other, and one failing/slow substrate still yields a truthful partial payload instead of aborting the review path.

## UAT 3 — Cache reuse prevents repeated substrate calls for the same review key

1. Run `bun test ./src/structural-impact/orchestrator.test.ts`.
2. Confirm the following cache tests pass:
   - `cache hit skips adapter calls and returns cached payload`
   - `cache miss triggers adapter calls and writes result to cache`
   - `partial result is also cached`
3. Confirm `buildStructuralImpactCacheKey` tests pass and prove:
   - repo is normalized to lowercase
   - base/head SHAs affect the key
   - different SHAs yield different keys

**Expected outcome:** Structural-impact results are reusable per review `(repo, baseSha, headSha)` and degraded partial outputs are cached too, avoiding repeated pressure on unavailable substrates.

## UAT 4 — Observability signals surface cache, adapter, and result-state transitions without affecting execution

1. Run `bun test ./src/structural-impact/orchestrator.test.ts`.
2. Confirm the signal-related tests pass for:
   - `graph-ok`, `corpus-ok`, and `result-ok`
   - `graph-timeout`
   - `corpus-error`
   - `result-partial`
   - `result-unavailable`
   - `cache-hit` and `cache-miss`
3. Confirm the test `onSignal error is swallowed and does not propagate` passes.

**Expected outcome:** The orchestration layer exposes a stable, structured telemetry surface, and broken observers/loggers cannot break review execution.

## UAT 5 — Review handler consumes the review-facing seam instead of calling the graph substrate directly

1. Run `bun test ./src/structural-impact/review-integration.test.ts`.
2. Confirm the suite passes all tests.
3. Verify the passing tests include:
   - `returns bounded payload and captured graph blast radius when both substrates are available`
   - `fails open to partial when graph substrate rejects`
   - `returns unavailable when neither substrate is configured`
   - `reuses cache by repo/base/head key and skips repeated substrate calls`
   - `forwards orchestration signals to the caller`
4. Open `src/handlers/review.ts` and confirm the large-PR graph-aware selection path calls `fetchReviewStructuralImpact(...)` and then conditionally applies `applyGraphAwareSelection({ riskScores, graph: graphBlastRadius })` only when `graphBlastRadius` is present.

**Expected outcome:** Review-path substrate wiring is centralized behind `src/structural-impact/review-integration.ts`, and `review.ts` no longer reaches directly into the graph substrate for this path.

## UAT 6 — TypeScript and slice-level verification contract remain clean

1. Run:
   - `bun test ./src/structural-impact/adapters.test.ts`
   - `bun test ./src/structural-impact/orchestrator.test.ts`
   - `bun test ./src/structural-impact/review-integration.test.ts`
   - `bun run tsc --noEmit`
2. Confirm every command exits 0.

**Expected outcome:** The slice is only considered complete when contract tests, orchestration tests, integration tests, and repository typecheck all pass together.

## Edge Cases to Exercise Explicitly

### Edge Case A — Corpus-only evidence still produces a usable partial payload

1. Run `bun test ./src/structural-impact/adapters.test.ts`.
2. Confirm the test `status is 'partial' when only corpus returns results` passes.
3. Confirm `canonicalEvidence` is preserved while graph-derived lists are empty.

**Expected:** Current-code evidence can survive independently when graph data is absent.

### Edge Case B — Adapter rejection does not escape the timeout wrapper

1. Run `bun test ./src/structural-impact/orchestrator.test.ts`.
2. Confirm the graph error and corpus error tests pass.
3. Confirm the suite does not fail with unhandled rejection behavior.

**Expected:** Adapter failures are converted into degradation records before timeout racing, preserving fail-open behavior.

### Edge Case C — Missing substrates degrade truthfully at the review seam

1. Run `bun test ./src/structural-impact/review-integration.test.ts`.
2. Confirm the test `returns unavailable when neither substrate is configured` passes.
3. Confirm the result has `payload.status === "unavailable"` and `graphBlastRadius === null`.

**Expected:** The integration seam reports true unavailability rather than fabricating empty success.

## Operational Readiness

- **Health signal:** Structural-impact tests pass; orchestrator emits expected `graph-*`, `corpus-*`, `cache-*`, and `result-*` signals; `bun run tsc --noEmit` exits 0.
- **Failure signal:** Repeated `graph-timeout`, `corpus-timeout`, or `result-unavailable` signals for the same review scope indicate substrate slowness/unavailability or missing dependency wiring.
- **Recovery procedure:** Re-run the structural-impact test suites to confirm contract behavior, inspect whether the review path is injecting graph/corpus dependencies, then restore the failing substrate or enable cache reuse so the review path can continue fail-open with truthful degradation.
- **Monitoring gaps:** S01 adds the signal surface but does not yet wire production counters/dashboards or render canonical evidence to user-visible review output; downstream slices must close that loop.

