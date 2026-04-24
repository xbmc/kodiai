# M064 Research — Continuation state, supersession, and operator evidence

## Recommendation

Start by defining the canonical continuation-state contract as a pure domain model before touching handler orchestration. The codebase already has usable seams for planning (`planReviewContinuation`), settlement (`settleReviewContinuation`), publish authority (`ReviewWorkCoordinator`), durable partial-progress storage (`review_checkpoints`), and durable timeout/retry projection (`resilience_events`). What it does **not** have is one durable authoritative continuation record that answers the operator’s three priority questions directly:

1. final authoritative coverage/result state
2. why continuation stopped
3. which attempt held authority

Today those answers are reconstructed from a mix of checkpoint rows, resilience telemetry, handler logs, and in-memory coordinator state. That is the core gap M064 should close.

## What exists now

### 1. In-memory authority coordination already exists, but it is not durable

`src/jobs/review-work-coordinator.ts` provides family-level authority control keyed by `owner/repo#prNumber`.

- Attempts are claimed per review family.
- Newer attempts only become authoritative after they leave `claimed` and enter an active phase.
- `canPublish(attemptId)` is the final gate used before visible output writes.
- Snapshots annotate stale attempts with `supersededByAttemptId`.

This is already the right **runtime arbitration seam** for stale-attempt suppression, and tests cover the subtle behavior:

- a newer pending explicit review does not suppress an older active one
- a retry only becomes authoritative after it actually starts
- a later active attempt can suppress an older continuation

Relevant files:
- `src/jobs/review-work-coordinator.ts`
- `src/jobs/review-work-coordinator.test.ts`

**Constraint:** this coordinator is process-local. If the process restarts, durable operator truth must come from somewhere else.

### 2. Continuation planning and settlement are already isolated as pure logic

`src/lib/review-continuation-lifecycle.ts` is the cleanest existing seam.

`planReviewContinuation(...)` decides whether to:
- schedule continuation, or
- skip it for explicit reasons:
  - `zero-evidence-failure`
  - `inline-output-already-published`
  - `invalid-checkpoint-scope`
  - `no-remaining-scope`
  - `chronic-timeout`

`settleReviewContinuation(...)` decides whether to:
- merge continuation results, or
- settle quietly with `no-new-results`

This is already close to a state machine, but it is currently a **decision helper**, not a canonical persisted lifecycle model.

Relevant files:
- `src/lib/review-continuation-lifecycle.ts`
- `src/lib/review-continuation-lifecycle.test.ts`

### 3. Durable progress storage exists, but it is too thin to be the canonical lifecycle source

`review_checkpoints` stores:
- `review_output_key`
- repo / PR
- JSON checkpoint data with:
  - `filesReviewed`
  - `findingCount`
  - `summaryDraft`
  - `totalFiles`
- `partial_comment_id`

This is useful evidence and is already used to:
- publish bounded first-pass timeout output
- compute retry scope
- merge continuation results back into the original comment

But it does **not** answer:
- whether continuation was scheduled / running / merged / quietly settled / superseded / blocked
- which attempt became authoritative
- which stop reason finalized the family

Relevant files:
- `src/knowledge/types.ts`
- `src/knowledge/store.ts`
- `src/db/migrations/001-initial-schema.sql`
- `src/execution/mcp/checkpoint-server.ts`

### 4. Durable resilience telemetry exists, but it is a projection, not authority

`ResilienceEventRecord` and `resilience_events` already persist structured timeout/retry metadata such as:
- `deliveryId`
- `parentDeliveryId`
- `reviewOutputKey`
- checkpoint counts
- partial comment id
- chronic-timeout info
- retry enqueue / scope / timeout / checkpoint-enabled flags
- whether retry had results

This is already the best operator-facing evidence seam in the current system.

But it is still event-shaped, not state-shaped. It records facts about timeout/retry execution, but operators still need correlation to answer the final family outcome.

Relevant files:
- `src/telemetry/types.ts`
- `src/telemetry/store.ts`
- `src/db/migrations/001-initial-schema.sql`

### 5. Visible review truth is already centralized around the base `reviewOutputKey`

The public contract from M062/M063 is strong:
- bounded first-pass comment and Review Details are aligned
- continuation stays on the same visible surface
- continuation updates preserve the base `reviewOutputKey`
- no-delta continuation settles quietly
- stale attempts cannot overwrite the canonical visible summary

Relevant files:
- `src/handlers/review-idempotency.ts`
- `src/lib/partial-review-formatter.ts`
- `src/lib/review-utils.ts`
- `scripts/verify-m062-s03.ts`
- `scripts/verify-m063-s01.ts`
- `scripts/verify-m063-s02.ts`
- `scripts/verify-m063-s03.ts`

This means M064 should not invent a new public UX. It should make internal truth authoritative and let public surfaces remain projections.

## Current end-to-end lifecycle shape

Inside `src/handlers/review.ts`, the large-PR continuation path currently works like this:

1. runtime claims review-family authority through `ReviewWorkCoordinator`
2. on timeout/max-turns, handler reads `knowledgeStore.getCheckpoint(reviewOutputKey)`
3. `normalizeReviewFirstPass(...)` builds the bounded first-pass truth payload
4. `planReviewContinuation(...)` decides schedule vs skip
5. bounded first-pass comment is posted using base `reviewOutputKey`
6. checkpoint row is updated with `partialCommentId`
7. timeout resilience telemetry is written
8. a retry job is enqueued with continuation key `${reviewOutputKey}-retry-1`
9. retry executor runs with narrowed scope and optional checkpointing
10. retry checkpoint is read
11. retry resilience telemetry is written
12. `settleReviewContinuation(...)` decides merge vs quiet settlement
13. if merged, the original comment is updated in place and both checkpoint rows are deleted
14. if stale authority is lost, the merge/update is skipped

This works, but the authoritative truth is fragmented across runtime state, checkpoint rows, resilience rows, and comment content.

## What should be proven first

### First proof target: one persisted continuation-family state can answer the three operator questions directly

Before changing handler flow or public surfaces, prove that one canonical record can always answer:

- **Final authoritative result/coverage state:** e.g. bounded-first-pass only, continuation merged, continuation settled with no delta, continuation superseded, continuation blocked
- **Stop reason:** e.g. timeout, max-turns, chronic-timeout, no-remaining-scope, invalid-checkpoint-scope, superseded-by-newer-attempt, no-new-results
- **Authoritative attempt identity:** at minimum the winning attempt’s delivery/attempt identity and family/base review output identity

If that model is sound, everything else can project from it.

### Second proof target: superseded late finishers cannot mutate canonical state

The current runtime gate already protects visible publication. M064 should prove the same rule for persisted lifecycle truth:

- a stale continuation may finish
- it may emit best-effort telemetry/logs
- it must not overwrite the family’s authoritative lifecycle state once a newer authoritative attempt has won

### Third proof target: projections can fail independently without ambiguity

Checkpoint writes, resilience telemetry writes, report generation, or comment updates may fail. Canonical state should still let operators answer what happened, with projections marked incomplete rather than becoming rival truth sources.

## Natural slice boundaries

### Slice 1 — Canonical continuation-state model

Define the lifecycle model and transitions as pure code first.

Likely scope:
- new continuation-family state type(s)
- authoritative final-state enums / stop-reason enums
- attempt identity model and supersession semantics
- projection adapters from canonical state to checkpoint/telemetry/report wording

Why first:
- highest leverage
- lowest integration risk
- lets later slices prove against a crisp contract instead of handler branches

### Slice 2 — Durable persistence for canonical state

Add one durable store for canonical continuation family state.

Likely options:
- extend `review_checkpoints` too far and risk mixed concerns
- or add a dedicated continuation lifecycle table keyed by family/base review identity

Recommendation: prefer a **dedicated lifecycle table** over overloading checkpoint JSON.

Why:
- checkpoints represent partial review progress, not final authority
- lifecycle truth needs different retention and semantics than checkpoint scratch state
- a dedicated table makes “projection, not authority” easier to enforce for telemetry and checkpoint rows

### Slice 3 — Runtime orchestration projects into canonical state

Refactor the continuation-heavy block in `src/handlers/review.ts` so lifecycle transitions are explicit writes to the canonical store, with checkpoint/telemetry/comment updates as side effects or projections.

This slice should keep public behavior unchanged.

### Slice 4 — Operator evidence/reporting surfaces project from canonical state

Build or update operator-facing evidence so the top answers come straight from canonical state.

Likely targets:
- resilience telemetry enrichment
- verifier/report scripts
- deterministic machine-readable report shape for continuation families

### Slice 5 — Milestone proof surface

Add deterministic verification specifically for M064’s contract:
- canonical state answers the three questions directly
- stale attempts cannot overwrite authoritative state
- projection lag/failure does not create ambiguous truth

## Boundary contracts that matter

### 1. Base review identity vs continuation attempt identity

`reviewOutputKey` is already the stable visible identity. Continuation currently derives `-retry-1` from it.

M064 should preserve:
- **base identity** for public lifecycle ownership
- **attempt identity** for operator truth

Candidate contract:
- family identity: repo + PR
- lifecycle identity: base `reviewOutputKey`
- attempt identity: delivery id / attempt id / continuation number

Do not collapse these into one field.

### 2. Canonical state vs checkpoint progress

Checkpoint state should remain about **work completed so far**.
Canonical lifecycle state should answer **what the family means now**.

That separation matters because checkpoint rows are currently deleted after successful merge, while canonical lifecycle truth should remain queryable for operators.

### 3. Canonical state vs resilience telemetry

Telemetry should remain additive and fail-open.
It should not become the place that defines authority.

Good rule:
- canonical state = current truth
- telemetry = append-only or upserted evidence projection
- logs = debugging detail only

### 4. Runtime authority vs durable authority evidence

`ReviewWorkCoordinator` should remain the runtime publish gate, but M064 needs a durable record of which attempt ultimately held authority.

That means the persisted model should record authority transitions explicitly rather than inferring them later from whichever attempt wrote last.

## Constraints imposed by the codebase

### `src/handlers/review.ts` is already dense and risky

The continuation path spans a large orchestration block with interleaved:
- checkpoint reads/writes
- prompt shaping
- queueing
- executor calls
- telemetry writes
- GitHub comment publication
- stale-authority checks

This argues for putting new policy into pure modules and adding a persistence seam, not expanding handler-local branching.

### Current retry depth is hardcoded to one continuation

`deriveContinuationReviewOutputKey()` always creates `-retry-1` and verifier/tests assume `continuationNumber: 1`.

M064 context does not require multi-step chained continuation, so planning should avoid accidentally generalizing into an open-ended retry tree unless explicitly needed.

### Checkpoint MCP write currently does not await persistence

In `src/execution/mcp/checkpoint-server.ts`, `knowledgeStore.saveCheckpoint(...)` is called without `await`.

That is a real reliability risk for any milestone that wants canonical operator evidence:
- the model can receive `{ saved: true }`
- persistence could still fail or race afterward

This should be treated as a likely table-stakes hardening item for M064 even if the milestone does not otherwise redesign checkpointing.

### Current cleanup deletes evidence that operators may want later

After successful merge, the handler deletes base and retry checkpoint rows. That is fine if checkpoints are scratch state, but it reinforces the need for a separate durable lifecycle record retained beyond settlement.

## Known failure modes that should shape slice ordering

### 1. Superseded retry finishes late

Already covered in tests: a newer explicit/interactive review can supersede the queued retry, and the retry’s merge/update must be skipped.

M064 should make this a first-class lifecycle outcome, not just a log line plus no-op update.

### 2. Projection success can diverge today

Possible current split-brain patterns:
- checkpoint exists but resilience row is missing
- resilience row exists but checkpoint merge data is gone
- visible comment updated but no durable authoritative family summary exists
- runtime coordinator knew authority winner, but durable stores do not directly encode it

This is exactly why canonical lifecycle state should land before expanding reports.

### 3. Checkpoint corruption or malformed scope

`planReviewContinuation()` already has `invalid-checkpoint-scope`. That implies canonical state should capture blocked/invalid transitions explicitly rather than silently skipping continuation and leaving operators to infer why.

### 4. No-delta continuation is intentionally quiet publicly

That is correct public behavior, but it makes operator evidence more important. A quiet public outcome still needs a durable internal explanation: continuation ran, produced no material delta, canonical state settled without update.

## Existing patterns to reuse

### Reuse the M062/M063 verifier style

The strongest existing proof pattern is deterministic verifiers built around pure contracts rather than only handler integration tests.

M064 should add a verifier in that style rather than relying only on new `review.test.ts` scenarios.

### Reuse normalized truth payloads and projection helpers

Good existing pattern:
- pure data normalization (`normalizeReviewFirstPass`)
- pure planner/settler (`planReviewContinuation`, `settleReviewContinuation`)
- formatters project from normalized truth

M064 should preserve this architecture by introducing a pure lifecycle-state model that other surfaces project from.

### Reuse additive projection telemetry

`TelemetryStore.recordResilienceEvent()` already behaves like a projection sink. Keep that model: telemetry receives structured facts from the canonical lifecycle state instead of becoming the truth store.

## Requirements analysis

### Existing active requirement that is table stakes

**R067 — New commits supersede stale continuation work cleanly**

This is core to the milestone and already aligns with existing `ReviewWorkCoordinator` behavior. M064 should strengthen it by making supersession durable and operator-visible, not just runtime-enforced.

### Existing validated requirement that should be tightened by M064

**R068 — Durable operator evidence for continuation lifecycle outcomes**

This exists, but the current implementation is only partially there for the new continuation-family truth model. M064 should not assume R068 is fully sufficient for the milestone’s new scope; it should build on it.

### Candidate requirements surfaced by research

These should be considered explicitly by the planner instead of silently added:

1. **Candidate requirement:** canonical continuation-family state is persisted durably and survives process restarts
   - Why: runtime coordinator is in-memory only

2. **Candidate requirement:** canonical state records the final authoritative attempt identity explicitly
   - Why: operators currently infer from logs/telemetry correlation

3. **Candidate requirement:** canonical state records final stop reason from a controlled enum/contract
   - Why: skip/settlement/supersession reasons are spread across helpers and logs

4. **Candidate requirement:** projection failures are visible as projection status, not as ambiguity in lifecycle truth
   - Why: telemetry/checkpoint/report failures should not create rival truth sources

5. **Candidate requirement:** checkpoint tool acknowledges persistence truthfully
   - Why: current non-awaited checkpoint save can misreport success

### Things that look out of scope unless the user says otherwise

- adding more public PR comment verbosity
- building an operator UI beyond deterministic reports and durable queryable state
- generalizing beyond one continuation attempt if the milestone only needs authoritative family truth for current behavior

## Skill discovery

Directly relevant installed skills:
- `observability` — relevant for durable operator evidence and projection/report shaping

Promising non-installed skills found:
- PostgreSQL: `npx skills add wshobson/agents@postgresql-table-design`
  - highest install count among relevant Postgres options; useful if the planner wants a dedicated lifecycle table design pass
- Hono: `npx skills add yusukebe/hono-skill@hono`
  - relevant only if milestone work expands into HTTP/report endpoints; not necessary for the core state-model work

## Recommended implementation order

1. **Define canonical continuation-family state and transition helpers**
2. **Persist it durably in a dedicated lifecycle store/table**
3. **Project handler events into that state while preserving current public behavior**
4. **Project canonical state into telemetry/reporting surfaces**
5. **Add deterministic verifier coverage for canonical truth + supersession + projection lag/failure**
6. **Harden checkpoint persistence acknowledgment (`await saveCheckpoint`) if not addressed earlier**

## Bottom line for the roadmap planner

The natural milestone shape is:
- first establish a **durable canonical continuation-family state**
- then make checkpoint, telemetry, and reports into **projections of that state**
- only then refine operator evidence and verifier surfaces

The codebase already has the right pure seams to build on. The main risk is trying to solve M064 by adding more handler-local branches or richer telemetry without first creating a single authoritative persisted lifecycle model.
