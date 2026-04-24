# Research — M064/S03 Canonical-state-first operator evidence and projection-status proof

## Summary
S03 is targeted, not exploratory. The core continuation-family authority model already exists (`continuation_family_state`) and S02 already hardens live writes. The missing piece is an operator-facing proof/report surface that answers from canonical state first, while making projection degradation explicit instead of forcing operators to infer truth from telemetry/checkpoints/logs.

This slice primarily owns **R068** and closes the remaining active requirement **R074**. It also consumes the validated S01/S02 contracts for R071-R073 rather than redefining them.

## Requirements Focus
- **Primary:** `R068` — durable operator evidence for continuation lifecycle outcomes.
- **Primary active:** `R074` — projection failures must surface as explicit `projectionStatus` on top of canonical truth.
- **Supported contracts from prior slices:**
  - `R071` canonical state is the authority
  - `R072` authoritative attempt identity is explicit
  - `R073` final stop reason is explicit and enum-backed

Implication: S03 should not add a rival evidence source. It should read canonical rows and render/report them.

## Skill Discovery
Relevant installed skills already exist:
- **`observability`** — directly relevant. Its rule matches the milestone boundary: structured operator evidence should preserve one truth source and make degradation explicit rather than inferred.
- **`verify-before-complete`** / **`verification-before-completion`** — directly relevant. S03 should finish with fresh proof-command output, not only code/tests.

No missing core-technology skill justified an external `npx skills find` lookup here. This slice is standard TypeScript/Bun/Postgres/reporting work already established in-repo.

## Implementation Landscape

### Canonical authority seam already exists
- `src/knowledge/types.ts`
  - Defines the continuation-family contract:
    - `ContinuationFamilyAuthoritativeOutcome`
    - `ContinuationFamilyFinalStopReason`
    - `ContinuationFamilyProjectionStatus`
    - `ContinuationFamilyStateRecord`
  - Current store API only exposes:
    - `upsertContinuationFamilyState(record)`
    - `getContinuationFamilyState({ familyKey, baseReviewOutputKey })`
- `src/knowledge/store.ts`
  - Persists one row per `(family_key, base_review_output_key)`.
  - Uses ordinal-guarded upsert semantics so stale attempts cannot overwrite newer authority.
- `src/db/migrations/039-continuation-family-state.sql`
  - Confirms the durable schema and indexes.
  - Important detail: there are indexes on both `family_key` and `base_review_output_key`, so read-side lookup expansion is cheap if S03 needs a more operator-friendly query API.

### Runtime writes are already canonical-state-first
- `src/handlers/review.ts`
  - Central helpers:
    - `persistContinuationFamilyState(...)`
    - `persistDegradedContinuationFamilyState(...)`
    - `finalizeContinuationAttempt(...)`
  - These already encode the correct write-side rule: canonical row first, projections second.
  - Supersession writes come from the coordinator path and persist `superseded-by-newer-attempt` truth.

### Current proof surfaces are verifier-shaped, not operator-report-shaped
- `scripts/verify-m064-s01.ts`
  - Pure in-memory scenario matrix proving canonical merge / quiet settlement / blocked / superseded outcomes.
- `scripts/verify-m064-s02.ts`
  - Stronger harness that drives real review orchestration seams and reads canonical state back.
- `scripts/verify-m064-s01.test.ts`, `scripts/verify-m064-s02.test.ts`
  - Lock deterministic JSON + human rendering contracts.

These prove the model, but they are still milestone-slice verifiers. They do **not** yet look like the operator-facing continuation evidence surface described by R068.

### Existing report pattern worth reusing
- `scripts/usage-report.ts`
  - Good precedent for operator reporting:
    - explicit preflight/access state
    - machine-readable JSON + human-readable text
    - fail-open explanation when the backing store is unavailable
- `scripts/verify-m061-s05.ts`
  - Good precedent for integrated operator proof that composes existing evidence and preserves preflight/degradation truth.

### Projection surfaces remain projections only
- `src/telemetry/types.ts`
- `src/telemetry/store.ts`
- `src/execution/mcp/checkpoint-server.ts`

Telemetry and checkpoints still do not define continuation authority. S03 should not promote them. They matter only insofar as the report exposes whether projection health is `canonical`, `degraded`, or `pending`.

### Important missing seam
Current read API requires **both** `familyKey` and `baseReviewOutputKey`.
That is fine for tests/verifiers but awkward for operators unless they already know both exact identifiers. S03 likely needs one of these:
1. a read helper that accepts `baseReviewOutputKey` alone,
2. a read helper that accepts `owner/repo + prNumber + baseReviewOutputKey`, or
3. a CLI surface that parses/derives keys from a provided review output key.

The existing code gives useful ingredients:
- `src/jobs/review-work-coordinator.ts` exports `buildReviewFamilyKey(owner, repo, prNumber)`
- `src/handlers/review-idempotency.ts` exports `parseReviewOutputKey(reviewOutputKey)`

Those make an operator-friendly lookup path feasible without inventing new identity rules.

## Recommendation
Build S03 around **one shared continuation operator-report module plus one top-level verifier/report command**.

Recommended shape:
1. **Add a read-side query/helper seam** near `src/knowledge/types.ts` / `src/knowledge/store.ts`
   - enough to resolve the canonical row from operator-available input
   - prefer using `parseReviewOutputKey(...)` + `buildReviewFamilyKey(...)` rather than asking operators for raw DB keys
2. **Add a report builder** that converts a canonical row into an operator-first result ordered as:
   - authoritative outcome
   - final stop reason
   - authoritative attempt identity
   - projection status
   - supersession metadata
3. **Keep projections subordinate**
   - report should say whether evidence is `canonical`, `degraded`, or `pending`
   - it should not join telemetry/checkpoint rows to reconstruct truth
4. **Expose both JSON and human output**
   - follow the verifier/report pattern already used in `scripts/usage-report.ts` and the M064 verifiers

This matches the `observability` skill rule: explicit failure/degradation signals, one authority source, no inference from missing projections.

## Natural Seams for Planning

### Seam 1 — Read-side lookup ergonomics
Likely files:
- `src/knowledge/types.ts`
- `src/knowledge/store.ts`
- possibly `src/knowledge/store.test.ts`
- possibly `src/handlers/review-idempotency.ts` only as a consumer import, probably no change

Goal:
- make it possible for an operator-facing script to resolve continuation-family truth without already knowing both key parts manually.

Most likely low-risk option:
- accept a full `reviewOutputKey`, parse it to `baseReviewOutputKey`, derive `familyKey` from parsed owner/repo/pr, then read canonical state using the existing exact-key API.

This is cheaper than introducing broader search/list APIs unless the slice explicitly wants them.

### Seam 2 — Shared report/evidence formatter
Likely files:
- new module under `src/knowledge/` or `scripts/` helper space
- should be reusable by both verifier and future milestone work

Goal:
- convert canonical row -> stable report object + human text
- keep this logic separate from CLI parsing and separate from DB access

### Seam 3 — Operator command + tests
Likely files:
- new `scripts/verify-m064-s03.ts` or equivalently named operator-proof/report script
- new `scripts/verify-m064-s03.test.ts`
- `package.json`

Goal:
- expose deterministic command wiring
- support `--json`
- ideally support one-identifier operator input via `reviewOutputKey` or fixture scenario mode if live DB input is unavailable

## What To Prove First
1. **Lookup contract** — operator input can resolve the canonical row without manual DB-key reconstruction.
2. **Canonical-state-first rendering** — outcome/stop-reason/attempt/projection status come directly from the canonical row.
3. **Projection-status truthfulness** — degraded/pending states render explicitly and are not inferred from missing telemetry/checkpoint data.
4. **Supersession visibility** — superseded rows surface `supersededByAttemptId` plainly.

If the lookup contract is awkward or underspecified, the rest of the slice risks becoming another test-only verifier instead of a usable operator surface.

## Risks / Constraints
- **Biggest risk:** accidentally rebuilding truth by correlating telemetry/checkpoints/logs. That would violate the milestone boundary and R074.
- **Input-shape risk:** if the command requires both `familyKey` and `baseReviewOutputKey`, it technically works but remains operator-hostile.
- **Overreach risk:** broad search/list/report history APIs are probably unnecessary for this slice. The lightest useful operator lookup should win.
- **Verification environment risk:** store-backed Postgres tests were infra-gated earlier when `TEST_DATABASE_URL` was absent. Prefer DB-independent contract tests for the report builder/CLI, plus live command verification where the environment supports it.

## Verification
Minimum convincing verification for S03:
- `bun test scripts/verify-m064-s03.test.ts`
- `bun run verify:m064:s03 -- --json`
- regression reruns of prior proof surfaces to ensure S03 does not drift the established contract:
  - `bun test scripts/verify-m064-s01.test.ts`
  - `bun test scripts/verify-m064-s02.test.ts`
  - optionally `bun run verify:m064:s01 -- --json`
  - optionally `bun run verify:m064:s02 -- --json`

If store/query APIs change:
- `bun test src/knowledge/store.test.ts` (noting DB gating if `TEST_DATABASE_URL` is absent)

If `package.json` wiring changes:
- assert `verify:m064:s03` script is present in the test suite, following the same contract style as S01/S02.

## Planner Notes
- Treat this as a **reporting/read-side slice**, not a write-side orchestration slice.
- Reuse existing M064 verifier/report shape aggressively; do not invent a new reporting framework.
- Prefer a small shared module for canonical-state-to-report mapping so M065 can consume it later.
- The strongest finish is an operator command that takes a review output key, resolves canonical continuation-family truth, and prints both machine-readable and human-readable evidence with explicit projection status.
