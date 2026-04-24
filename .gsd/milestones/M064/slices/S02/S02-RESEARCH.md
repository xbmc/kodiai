# S02 Research — Project review orchestration into canonical state with supersession-safe writes

## Summary

S02 is a **targeted integration slice**, not a new architecture slice. S01 already created the durable canonical store, migration, types, store API, and a canonical-state-first verifier. The remaining work is to make the **real timeout/retry orchestration path** in `src/handlers/review.ts` tell the truth under success, supersession, enqueue failure, retry failure, and projection failure.

This slice primarily supports:
- **R067** — stale continuation attempts must not overwrite authority
- **R068** — operators need durable lifecycle evidence that stays truthful when continuation paths fail or are superseded
- Candidate requirement: **projection failures are visible as projection status, not as ambiguity in lifecycle truth**
- Candidate requirement: **checkpoint tool acknowledges persistence truthfully**

The biggest current gap is that canonical state is only updated for the happy-path lifecycle transitions (`blocked`, `continuation-pending`, `merged`, `quiet-settled`) plus the publish-gate supersession path. Several important real execution failures still only log and/or delete checkpoints, leaving canonical truth stale or overly optimistic.

Following the loaded `using-superpowers` rule to use **process skills first**, the planner should decompose this slice around **proof-first orchestration scenarios** before broad refactors: establish the failing/live-path contracts, then extract minimal helpers.

## Recommendation

Build S02 in three ordered pieces:

1. **Truthful checkpoint persistence projection**
   - Fix `src/execution/mcp/checkpoint-server.ts` so `save_review_checkpoint` awaits `knowledgeStore.saveCheckpoint(...)` and only returns `{ saved: true }` after the write completes.
   - Add a negative-path test proving a rejected checkpoint save returns an error instead of a false success.

2. **Canonical projection-status orchestration helper in `src/handlers/review.ts`**
   - S01 added `persistContinuationFamilyState(...)`, but S02 needs a higher-level helper or pattern that updates canonical rows when downstream projection writes fail.
   - Existing catch blocks for checkpoint/telemetry/enqueue/retry failures mostly just log. They should instead preserve/advance canonical truth with a meaningful `projectionStatus` (`canonical` vs `degraded`) and authoritative stop reason where the family is final.

3. **Close the live continuation-family lifecycle gaps**
   - Cover queue failure, retry execution failure, and stale retry supersession as first-class canonical outcomes in the real handler path.
   - Keep public PR behavior unchanged; only harden internal truth.

## Implementation Landscape

### 1. Canonical state seam already exists and is small

**Files:**
- `src/knowledge/types.ts`
- `src/knowledge/store.ts`
- `src/db/migrations/039-continuation-family-state.sql`

`ContinuationFamilyStateRecord` already has the fields S02 needs:
- `authoritativeAttemptId`
- `authoritativeAttemptOrdinal`
- `authoritativeOutcome`
- `finalStopReason`
- `projectionStatus`
- `supersededByAttemptId`

The store already enforces **ordinal-guarded upsert**:
- `src/knowledge/store.ts` updates only when `EXCLUDED.authoritative_attempt_ordinal >= continuation_family_state.authoritative_attempt_ordinal`
- older attempts cannot overwrite newer authoritative rows

This means S02 should **not** change the schema unless a newly discovered final stop reason genuinely cannot fit the current enum.

### 2. Handler orchestration is the real integration seam

**File:** `src/handlers/review.ts`

Relevant local seam already exists around line ~1930:
- `getBaseReviewOutputKey(...)`
- `getAttemptOrdinal(...)`
- `persistContinuationFamilyState(...)`
- `canPublishReviewWorkOutput(...)`

Current canonical writes in the real handler path:
- timeout with no retry scheduled → `blocked` / `no-follow-up`
- retry scheduled → `continuation-pending` / `awaiting-continuation`
- retry merged → `merged` / `merged-continuation-results`
- retry quiet settlement → `quiet-settled` / `settled-without-update`
- publish-rights lost → `superseded` / `superseded-by-newer-attempt`

What is **missing or weak**:
- telemetry projection failures only log; they do not degrade canonical projection status
- retry enqueue failure only logs after `.catch(...)`; no canonical finalization/degradation write
- retry execution failure in the queued job `catch (retryErr)` only logs; canonical state may remain `continuation-pending`
- retry `finally` deletes both retry and base checkpoints even on retry failure, which can erase scratch evidence while canonical state still says `continuation-pending`
- initial timeout checkpoint tool path is awaited in the handler, but the MCP tool used by the model is still non-awaited and can claim `saved: true` before persistence finishes

### 3. Checkpoint MCP server currently misreports persistence

**Files:**
- `src/execution/mcp/checkpoint-server.ts`
- `src/execution/mcp/checkpoint-server.test.ts`

Current issue:
- `knowledgeStore.saveCheckpoint({...})` is called **without `await`**
- tool returns `{"saved": true}` immediately

This directly conflicts with the milestone’s “truthful persistence” goal.

Test gap:
- existing test only proves the handler is called, not that async persistence is awaited
- no rejection-path test exists

This is the cleanest first task in the slice.

### 4. Telemetry is projection-only and should stay that way

**Files:**
- `src/telemetry/types.ts`
- `src/telemetry/store.ts`

`ResilienceEventRecord` is still timeout/retry-event shaped, not authority shaped. That is correct.

S02 should **not** move authority into telemetry. Instead:
- telemetry write failures should degrade canonical `projectionStatus`
- canonical state should remain queryable even if `recordResilienceEvent(...)` throws

There is no existing explicit coupling between telemetry write success/failure and canonical projection status.

### 5. ReviewWorkCoordinator is still the runtime authority gate

**File:** `src/jobs/review-work-coordinator.ts`

Coordinator behavior remains correct for runtime suppression:
- attempts become authoritative when active, not merely claimed
- `canPublish(attemptId)` is the final visible-output gate
- snapshots expose `supersededByAttemptId`

S02 should preserve this split:
- **coordinator** = runtime publish gate
- **canonical row** = durable operator truth

Do not try to replace the coordinator. Instead, project coordinator outcomes into canonical state more completely.

## Natural Seams for Planning

### Seam A — Truthful checkpoint persistence

**Files:**
- `src/execution/mcp/checkpoint-server.ts`
- `src/execution/mcp/checkpoint-server.test.ts`

Independent task:
- await checkpoint save
- propagate failure truthfully
- add tests for async resolution + rejection

### Seam B — Canonical-state transition hardening in the handler

**Files:**
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`

Likely extraction target:
- a tiny helper that wraps projection writes and computes resulting `projectionStatus`
- or a small family of helpers for “write canonical state after projection X” rather than spreading ad hoc catch blocks

Keep the refactor minimal. `review.ts` is already dense.

### Seam C — Deterministic verification for live orchestration gaps

**Files:**
- likely `src/handlers/review.test.ts`
- possibly new verifier script under `scripts/` if the planner wants an operator-facing proof surface for S02

S01 already owns canonical-store verification. S02’s verification should focus on **real orchestration scenarios**:
- retry enqueue failure
- retry execution failure
- telemetry projection failure
- superseded retry cannot falsely claim durable success

## What to Build or Prove First

1. **Checkpoint tool truthfulness first**
   - small blast radius
   - directly addresses a named candidate requirement
   - avoids building orchestration on top of a lying persistence signal

2. **Retry failure / enqueue failure canonical finalization second**
   - highest operator-truth risk today
   - current code can leave canonical state stuck at `continuation-pending` even though continuation is no longer actually going to complete

3. **Projection degradation semantics third**
   - once failure transitions exist, ensure telemetry/checkpoint projection failure changes `projectionStatus` instead of silently logging

4. **Superseded stale retry evidence last**
   - runtime publish suppression already exists
   - S02 should prove stale attempts also cannot leave misleading durable persistence claims

## Concrete Gaps / Planner Watchouts

### Queue failure gap

In `src/handlers/review.ts`, the retry enqueue path ends with:
- `jobQueue.enqueue(...).catch((err) => { reviewWorkCoordinator.release(...); logger.error(...) })`

Current problem:
- canonical state was already written as `continuation-pending`
- if enqueue fails, no canonical correction follows

Planner implication:
- decide whether enqueue failure should finalize to `blocked`/`no-follow-up` with `projectionStatus: degraded`, or another explicit final stop reason if the enum must grow
- if you add a new stop reason, you must update migration constraints, type unions, store tests, and verifier expectations

### Retry execution failure gap

Inside the queued retry job:
- `catch (retryErr) { logger.error(...) }`
- `finally { ... deleteCheckpoint(retryReviewOutputKey); deleteCheckpoint(reviewOutputKey); }`

Current problem:
- a thrown retry can leave canonical state at `continuation-pending`
- scratch checkpoints are deleted anyway
- operator truth regresses to stale durable state plus logs

Planner implication:
- S02 likely needs a canonical write in the retry failure path before cleanup
- be careful not to let a stale retry overwrite newer authority; reuse current attempt ordinal + coordinator state

### Telemetry degradation gap

Timeout/retry telemetry writes in `review.ts` are all wrapped in best-effort `try/catch` blocks that only warn.

Current problem:
- canonical rows keep `projectionStatus: canonical` or `pending` even when important projections failed

Planner implication:
- use canonical row updates to reflect degraded projections after the authoritative state is otherwise known
- because upsert is ordinal-guarded, same-attempt degradation updates are safe as long as they do not let older attempts overtake newer ones

### Superseded durable-claim gap

`canPublishReviewWorkOutput(...)` already writes a superseded canonical row when a stale attempt loses publish rights.

What is not yet proven:
- a stale retry cannot also leave a **truthy checkpoint persistence acknowledgement** or other durable projection signal that implies success

Planner implication:
- couple supersession-focused handler tests with the checkpoint-server truthfulness fix
- this slice is about “cannot falsely report checkpoint durability,” not just “cannot publish comments”

## Verification

### Existing commands worth reusing

- `bun test src/handlers/review.test.ts`
- `bun test src/execution/mcp/checkpoint-server.test.ts`
- `bun test src/knowledge/store.test.ts` *(still DB-gated by `TEST_DATABASE_URL` in this environment)*
- `bun run verify:m064:s01 -- --json` *(useful regression check to ensure S02 does not break the canonical-state contract established by S01)*

### New/expanded proof points S02 should add

1. **Checkpoint MCP tool awaits persistence**
   - promise does not resolve `saved: true` before the store write completes
   - rejected save returns an error / non-success payload

2. **Retry enqueue failure updates canonical truth**
   - canonical row no longer remains `continuation-pending`
   - projection status is truthful

3. **Retry execution failure updates canonical truth before cleanup**
   - canonical row reflects final authoritative outcome for that family
   - checkpoint cleanup does not erase the only durable evidence

4. **Telemetry projection failure degrades canonical projection status**
   - the authoritative outcome remains correct
   - only projection status changes

5. **Superseded retry cannot falsely claim durable success**
   - no stale-attempt canonical overwrite
   - no misleading checkpoint-success acknowledgement path

## Skill Discovery (suggest)

Directly relevant technology here is the **Claude Agent SDK MCP tool surface** and **PostgreSQL persistence**.

Promising optional skills discovered (not installed):
- `npx skills add jezweb/claude-skills@claude-agent-sdk`
  - highest-signal result for the MCP tool implementation surface used in `src/execution/mcp/checkpoint-server.ts`
- `npx skills add supabase/agent-skills@supabase-postgres-best-practices`
  - strongest PostgreSQL-oriented result; useful if S02 ends up needing enum/constraint changes or more nuanced upsert semantics

Neither looks mandatory for this slice because the relevant patterns are already established in-repo.

## Sources

- `src/handlers/review.ts` — canonical persistence helper, timeout/retry orchestration, enqueue/retry failure paths, supersession publish gate
- `src/handlers/review.test.ts` — current canonical state coverage for blocked/pending/merged/quiet-settled and existing supersession behavior tests
- `src/execution/mcp/checkpoint-server.ts` — non-awaited checkpoint persistence acknowledgment bug
- `src/execution/mcp/checkpoint-server.test.ts` — current positive-path-only MCP checkpoint tests
- `src/knowledge/types.ts` — canonical continuation-family type contract
- `src/knowledge/store.ts` — ordinal-guarded canonical upsert/read semantics
- `src/knowledge/store.test.ts` — durable state and stale-attempt suppression tests
- `src/jobs/review-work-coordinator.ts` — runtime authority contract
- `src/telemetry/types.ts` / `src/telemetry/store.ts` — projection-only resilience telemetry surface
