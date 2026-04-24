---
depends_on: [M063]
---

# M064: Continuation state, supersession, and operator evidence

**Gathered:** 2026-04-23
**Status:** Ready for planning

## Project Description

M064 hardens the continuation lifecycle behind the scenes. Once M063 introduces continuation as a first-class large-PR execution model, operators need one authoritative answer to what happened: what final coverage/result state the authoritative attempt left behind, why continuation stopped, and which attempt held authority. This milestone defines and implements one canonical continuation-state model so telemetry, checkpoints, and reports stop acting like competing truth surfaces.

## Why This Milestone

The current codebase already has several relevant seams: same-PR attempt coordination, checkpoint-backed partial review merge, resilience telemetry, and stable review identity via `reviewOutputKey`. Those surfaces are useful, but they are still organized around timeout retry rather than the broader continuation lifecycle. M064 exists to prevent the redesigned review lifecycle from becoming a log-forensics problem. Operators should not need to correlate half-truths across multiple stores to understand continuation behavior.

## User-Visible Outcome

### When this milestone is complete, the user can:

- keep seeing the same concise public review surface while continuation state stays trustworthy behind the scenes
- rely on operators being able to explain the final authoritative continuation outcome without hand-waving or guesswork

### Entry point / environment

- Entry point: internal continuation lifecycle state and operator-facing evidence surfaces for large-PR review families
- Environment: production-like continuation execution with deterministic operator/reporting proof surfaces
- Live dependencies involved: continuation state storage, review-family coordination, checkpoint persistence, telemetry/reporting surfaces

## Completion Class

- Contract complete means: continuation lifecycle truth has one canonical source
- Integration complete means: coordinator, checkpoint, telemetry, and operator reports all project from the same authoritative lifecycle state
- Operational complete means: operators can answer the three priority questions quickly without reconstructing truth from scattered fragments

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- one canonical continuation-state model answers final coverage/result state, stop reason, and authoritative attempt identity
- superseded or late-finishing attempts cannot ambiguate or overwrite authoritative state
- projection surfaces may fail or lag without making operator truth ambiguous when canonical state exists

## Scope

### In Scope

- defining one canonical continuation-state model as the source of truth
- authoritative-state and supersession-safe lifecycle semantics
- operator/internal evidence surfaces optimized around final authoritative state, stop reason, and authoritative attempt identity
- projecting lifecycle truth into telemetry/checkpoint/report/reporting surfaces from canonical state
- deterministic proof/reporting that operators can recover continuation truth quickly

### Out of Scope / Non-Goals

- expanding public review detail on the PR beyond the surfaces already defined in M062/M063
- turning M064 into a user-facing UX milestone
- keeping multiple rival truth sources and expecting operators to correlate them manually

## Architectural Decisions

### Canonical continuation-state model

**Decision:** Define one canonical continuation-state model as the authoritative source of truth for continuation lifecycle state.

**Rationale:** Operators need direct answers about the final authoritative state, not a correlation puzzle across multiple partial stores.

**Evidence source:** user priority ordering plus current spread across coordinator/checkpoint/telemetry seams.

**Alternatives Considered:**
- Federated correlation only — cheaper short-term, but much easier to drift or become ambiguous under supersession.

### Existing surfaces project from canonical state

**Decision:** Current coordinator, checkpoint, telemetry, and reporting seams should become projections or consumers of canonical lifecycle state rather than competing truth sources.

**Rationale:** This reuses working infrastructure while preventing fragmented truth.

**Evidence source:** codebase review of `src/jobs/review-work-coordinator.ts`, `src/telemetry/types.ts`, and `src/telemetry/store.ts`.

**Alternatives Considered:**
- Replace everything with a separate isolated subsystem — unnecessary if the current seams can be aligned to one source of truth.

### Operator evidence optimized around final state first

**Decision:** Shape operator evidence around final authoritative coverage/result state first, stop reason second, and authoritative attempt identity third.

**Rationale:** That is the order the user wants operators to answer questions quickly.

**Evidence source:** user discussion.

**Alternatives Considered:**
- Chronology-first evidence — useful for debugging later, but not the fastest path to operational truth.

### Public review stays thin

**Decision:** Detailed continuation lifecycle truth remains operator/internal in this milestone.

**Rationale:** M064 should harden lifecycle truth, not expand public review verbosity.

**Evidence source:** user scope decision for this milestone.

**Alternatives Considered:**
- Exposing more lifecycle detail on the PR itself — deferred and outside this milestone’s focus.

## Error Handling Strategy

If canonical lifecycle state cannot be written, continuation must not promote itself as authoritative. It is better to preserve the prior truthful state than to let an untraceable attempt publish as current. Projection surfaces like telemetry or reports may lag or fail independently, but they must degrade to “canonical state available, projection incomplete” rather than becoming rival truth sources.

If supersession occurs during a state transition, the newer authoritative state wins immediately. If canonical state is partially corrupted, the system should preserve the last known authoritative state and stop continuation rather than guess from telemetry fragments. Operator evidence tools should fail open to canonical state whenever it exists, and should never stitch best guesses from projections when authoritative lifecycle state is available.

## Risks and Unknowns

- Preserving too much of the old federated truth model could leave the system with dual authority in practice.
- Late-finishing attempts may still look believable in telemetry unless promotion rules are enforced strictly enough.
- The canonical state model could become too thin to answer real operator questions, forcing correlation back in through the side door.

## Existing Codebase / Prior Art

- `src/jobs/review-work-coordinator.ts` — current same-PR attempt family and publish-authority coordination.
- `src/telemetry/types.ts` — current structured resilience/timeout/retry event shape.
- `src/telemetry/store.ts` — persistence layer for telemetry and resilience event projections.
- `src/handlers/review.ts` — current partial-review checkpoint merge and retry evidence path.
- `src/handlers/review-idempotency.ts` — stable review identity semantics.

## Relevant Requirements

- R067 — new commits supersede stale continuation cleanly
- R068 — durable operator evidence for continuation lifecycle outcomes
- R063 — same review identity still matters as the lifecycle anchor, though M063 owns the visible-surface behavior

## Technical Constraints

- Canonical lifecycle state must answer the top operator questions directly.
- Projection surfaces must not become competing truth sources.
- This milestone must not increase public PR review noise.
- The lifecycle model should leave room for later live-proof/report surfaces in M065.

## Integration Points

- continuation attempt coordination and authority rules
- checkpoint/comment identity persistence
- resilience telemetry and any downstream reporting surfaces
- operator-facing verifier/report tools that inspect continuation lifecycle state

## Testing Requirements

This milestone needs unit coverage for canonical lifecycle state transitions, authority promotion/demotion, supersession rules, and projection generation; integration coverage for multi-attempt continuation families where stale attempts finish late; and deterministic operator-facing proof/reporting that the three priority answers can be recovered directly from canonical lifecycle state.

## Acceptance Criteria

- Continuation lifecycle state has one canonical source of truth.
- Operators can determine final authoritative coverage/result state, stop reason, and authoritative attempt identity from that state.
- Superseded attempts cannot overwrite or ambiguate authoritative lifecycle state.
- Telemetry/checkpoint/reporting surfaces are projections of canonical state, not rival truth sources.

## Open Questions

- How much historical attempt chronology should be retained inside canonical lifecycle state itself versus left to projected telemetry?
- Which existing checkpoint and resilience telemetry fields are worth preserving unchanged as projections, and which should be narrowed once canonical state exists?
