# S01: Canonical continuation-family state and durable authority contract

**Goal:** Establish a durable canonical continuation-family lifecycle record keyed by stable review family identity/base reviewOutputKey so authoritative outcome, final stop reason, and winning attempt identity survive restarts and can be queried directly without inferring truth from checkpoints or telemetry.
**Demo:** After this slice, a deterministic canonical-state query/verifier can show the authoritative continuation family record for merge, quiet-settlement, blocked, and superseded scenarios directly from durable state, including the winning attempt and final stop reason.

## Must-Haves

- A dedicated durable continuation-family store/table exists with a controlled lifecycle contract for authoritative outcome, final stop reason, authoritative attempt identity, and projection status keyed by continuation family identity.
- Superseded or late-finishing attempts cannot overwrite canonical authority once a newer attempt has claimed the family, and restart-shaped rehydration can still answer the authoritative family state from durable data alone.
- Deterministic verifier coverage proves canonical answers for merge, quiet-settlement, blocked/no-follow-up, and superseded scenarios directly from canonical state rather than checkpoint JSON or resilience telemetry.
- Existing checkpoint and telemetry rows remain projection/scratch surfaces only; this slice does not require operator correlation across them to learn the winning attempt or final stop reason.

## Proof Level

- This slice proves: This slice proves: contract
Real runtime required: no
Human/UAT required: no

## Integration Closure

Upstream surfaces consumed: `src/jobs/review-work-coordinator.ts`, `src/handlers/review.ts`, `src/knowledge/store.ts`, `src/telemetry/store.ts`, `src/handlers/review-idempotency.ts`.
New wiring introduced in this slice: canonical continuation-family schema + store APIs, handler/coordinator authority projection hooks, and a deterministic verifier/query path that reads the canonical store directly.
What remains before the milestone is truly usable end-to-end: S02 must wire the live retry/orchestration path fully through canonical writes during real continuation execution; S03 must make operator evidence surfaces canonical-state-first.

## Verification

- Canonical family rows become the primary inspection surface for continuation authority. Deterministic verifier output should report family key, base reviewOutputKey, authoritative attempt id, final stop reason, authoritative outcome, and projection status so future agents can localize whether truth is missing versus a projection merely lagging.

## Tasks

- [x] **T01: Define the canonical continuation-family schema, enums, and store/query seam** `est:1.5h`
  Add the dedicated durable continuation-family authority surface chosen in D187 so continuation truth stops living in `review_checkpoints` JSON or `resilience_events` rows. Create the migration, TypeScript contract types, and store methods needed to upsert/read one canonical family record keyed by review family identity plus base `reviewOutputKey`, with controlled enums for authoritative outcome and final stop reason. Cover restart-shaped durability and supersession-safe compare/update behavior with real store tests before any handler wiring.
  - Files: `src/db/migrations/039-continuation-family-state.sql`, `src/db/migrations/039-continuation-family-state.down.sql`, `src/knowledge/types.ts`, `src/knowledge/store.ts`, `src/knowledge/store.test.ts`, `src/handlers/review-idempotency.ts`
  - Verify: bun test src/knowledge/store.test.ts

- [x] **T02: Project coordinator authority transitions into canonical lifecycle state** `est:2h`
  Wire the runtime publish gate from D188 into the new canonical store so authoritative attempt changes, supersession, and terminal outcomes are persisted durably during review/continuation handling. Update the coordinator-facing orchestration in `src/handlers/review.ts` to write canonical rows for initial timeout, continuation scheduling, continuation merge, quiet settlement, and stale-attempt suppression without letting late attempts overwrite newer authority. Keep `review_checkpoints` and `resilience_events` as projection/scratch surfaces only, but record projection status in canonical state so degraded writes are explicit instead of inferred.
  - Files: `src/handlers/review.ts`, `src/jobs/review-work-coordinator.ts`, `src/knowledge/types.ts`, `src/knowledge/store.ts`, `src/handlers/review.test.ts`, `src/telemetry/types.ts`
  - Verify: bun test src/handlers/review.test.ts

- [ ] **T03: Add deterministic canonical-state verifier coverage for authority outcomes** `est:1.5h`
  Create a verifier/query path that exercises the canonical family store directly and proves the slice demo scenarios from durable state: merge, quiet-settlement, blocked/no-follow-up, and superseded stale-attempt suppression. Reuse the M063 verification style but make canonical state—not comment bodies or telemetry rows—the answer source. Add scenario-driven tests for the verifier so the contract stays machine-checkable and maps back to R067, R071, R072, and R073.
  - Files: `scripts/verify-m064-s01.ts`, `scripts/verify-m064-s01.test.ts`, `src/knowledge/types.ts`, `src/knowledge/store.ts`, `src/handlers/review.test.ts`
  - Verify: bun test scripts/verify-m064-s01.test.ts && bun run verify:m064:s01 -- --json

## Files Likely Touched

- src/db/migrations/039-continuation-family-state.sql
- src/db/migrations/039-continuation-family-state.down.sql
- src/knowledge/types.ts
- src/knowledge/store.ts
- src/knowledge/store.test.ts
- src/handlers/review-idempotency.ts
- src/handlers/review.ts
- src/jobs/review-work-coordinator.ts
- src/handlers/review.test.ts
- src/telemetry/types.ts
- scripts/verify-m064-s01.ts
- scripts/verify-m064-s01.test.ts
