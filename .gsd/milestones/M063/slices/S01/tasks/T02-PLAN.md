---
estimated_steps: 20
estimated_files: 6
skills_used:
  - using-superpowers
  - systematic-debugging
  - verify-before-complete
---

# T02: Wire the review handler through the continuation lifecycle seam

Replace the timeout-specialized continuation block in `src/handlers/review.ts` with orchestration over the extracted lifecycle planner while keeping the real publication path and coordinator semantics intact. This task closes the actual product requirement: a bounded first pass should enqueue continuation automatically through the live handler-owned job flow, and queued continuation must recheck publish authority before mutating the bounded review surface.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `knowledgeStore` checkpoint reads/writes | fall back to the existing zero-evidence / no-merge behavior and log why continuation could not be advanced | keep the original bounded output intact and settle without follow-up mutation | refuse to plan or merge continuation from malformed checkpoint scope |
| `jobQueue.enqueue(...)` follow-up execution | keep the first-pass comment truthful and visible; do not claim continuation succeeded | leave continuation pending but avoid duplicate enqueues from the same attempt | reject missing continuation files or keys before dispatch |
| `ReviewWorkCoordinator` publish checks | skip bounded-comment or Review Details updates when authority is lost and log the suppressed attempt | preserve the newer authoritative attempt | treat inconsistent attempt identity as non-publishable |

## Load Profile

- **Shared resources**: job queue ordering, checkpoint rows keyed by `reviewOutputKey`, and review-work family authority state
- **Per-operation cost**: one continuation planning pass per bounded first pass plus at most one queued continuation execution on the shipped path
- **10x breakpoint**: duplicated enqueues or stale checkpoint churn would break before CPU does; tests must prove single-follow-up planning and cleanup

## Negative Tests

- **Malformed inputs**: missing checkpoint comment id, malformed checkpoint scope, and inconsistent continuation plan state
- **Error paths**: queued continuation with no additional results, queued continuation losing publish authority, and continuation planner returning no-follow-up
- **Boundary conditions**: bounded first pass with exactly one remaining file, no remaining files, and superseding review work arriving before continuation publishes

## Must-Haves

- [ ] `src/handlers/review.ts` delegates continuation planning, merge, and settlement decisions to the extracted lifecycle module
- [ ] Automatic continuation still goes through the real queued review execution path; no manual trigger or fake shortcut is introduced
- [ ] All continuation update paths recheck `ReviewWorkCoordinator` authority before changing the bounded comment or Review Details surface
- [ ] Handler tests cover auto-enqueue, successful merge, no-delta settlement, and superseded-update suppression

## Inputs

- ``src/handlers/review.ts``
- ``src/handlers/review.test.ts``
- ``src/lib/review-continuation-lifecycle.ts``
- ``src/lib/partial-review-formatter.ts``
- ``src/jobs/review-work-coordinator.ts``
- ``src/knowledge/types.ts``

## Expected Output

- ``src/handlers/review.ts``
- ``src/handlers/review.test.ts``

## Verification

bun test src/handlers/review.test.ts --filter "continuation"

## Observability Impact

Keeps continuation planner outcomes, queued continuation delivery IDs, and publish-authority suppression visible in handler logs/tests so future agents can tell whether a follow-up was planned, skipped, merged, or rejected as stale.
