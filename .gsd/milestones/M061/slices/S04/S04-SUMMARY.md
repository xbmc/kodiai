---
id: S04
parent: M061
milestone: M061
provides:
  - Truthful reuse primitives for retrieval, mention context, and review prompt assembly.
  - Canonical reuse hit/miss/degraded evidence that S05 can use for integrated token-reduction proof.
requires:
  []
affects:
  - S05
key_files:
  - src/knowledge/retrieval.ts
  - src/handlers/mention.ts
  - src/execution/mention-context.ts
  - src/handlers/review.ts
  - scripts/usage-report.ts
  - scripts/verify-m061-s04.ts
key_decisions:
  - Reuse only bounded derived artifacts that are already destined for prompt assembly; never cache raw mutable GitHub payloads.
  - Make cache admission fingerprint-first and fail-open: incomplete state or cache faults bypass reuse and rebuild directly.
  - Expose reuse evidence on canonical telemetry/reporting surfaces (`reuse.*` through usage-report/verifier) instead of creating a parallel proof-only path.
patterns_established:
  - Request-scoped embedding memoization keyed by normalized query/provider/input-type can remove duplicate retrieval work without changing retrieval ordering.
  - Fingerprint-driven derived-artifact caches are safe when they key strictly on prompt-affecting admitted state and degrade to direct rebuild on uncertainty.
  - Canonical operator proof should consume the same telemetry path as production reporting, with explicit degraded states instead of silent misses.
observability_surfaces:
  - `reuse.*` telemetry rows emitted from mention/review handlers and retrieval reuse paths.
  - `scripts/usage-report.ts` reuse-evidence reporting.
  - `scripts/verify-m061-s04.ts --json` canonical proof surface with explicit `telemetry_unavailable` degraded preflight.
drill_down_paths:
  - .gsd/milestones/M061/slices/S04/tasks/T01-SUMMARY.md
  - .gsd/milestones/M061/slices/S04/tasks/T02-SUMMARY.md
  - .gsd/milestones/M061/slices/S04/tasks/T03-SUMMARY.md
  - .gsd/milestones/M061/slices/S04/tasks/T04-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-24T03:14:26.295Z
blocker_discovered: false
---

# S04: S04

**Eliminated duplicate same-query embedding work per retrieval run, added truthful fingerprinted reuse for mention/review derived artifacts, and exposed reuse evidence on the canonical reporting path.**

## What Happened

S04 closed the retrieval-reuse part of M061 without weakening prompt truthfulness. On the retrieval side, `src/knowledge/retrieval.ts` now memoizes embeddings per request by normalized query text, input type, and provider identity, and collapses duplicate normalized variants before vector fan-out while preserving existing ordering and fail-open behavior after results are expanded back to caller-visible shape. On the mention side, `src/execution/mention-context.ts` and `src/handlers/mention.ts` added a fingerprint-first cache for bounded derived context only: identical admitted GitHub state reuses the derived artifact, but missing fingerprint inputs, cache bookkeeping faults, or any thread/comment/PR/policy drift bypass or miss and rebuild directly. On the review side, `src/handlers/review.ts` reuses bounded review prompt artifacts behind an explicit fingerprint that covers PR identity, refs, changed files, review knobs, retry scope, and retrieval-derived prompt inputs, so reduced-scope retries naturally miss instead of reusing stale prompt state. The slice also kept reuse behavior inspectable through canonical seams rather than ad hoc logging: handlers emit durable `reuse.*` evidence and `scripts/usage-report.ts` plus `scripts/verify-m061-s04.ts` summarize hit/miss/degraded/bypass states. This means downstream proof work in S05 can measure token reduction on top of truthful reuse signals instead of hidden cache behavior.

## Verification

Fresh slice verification passed after the final code state. `bun test src/knowledge/retrieval.test.ts src/knowledge/retrieval.e2e.test.ts src/knowledge/multi-query-retrieval.test.ts` passed with 49/49 tests. `bun test src/execution/mention-context.test.ts src/execution/mention-prompt.test.ts src/handlers/mention.test.ts` passed with 173/173 tests. `bun test src/execution/review-prompt.test.ts src/handlers/review.test.ts scripts/usage-report.test.ts scripts/verify-m061-s04.test.ts && bun scripts/verify-m061-s04.ts --json` completed successfully: the test suites passed with 362/362 tests, and the verifier returned the expected fail-open JSON preflight (`databaseAccess: unavailable`, `statusCode: telemetry_unavailable`) because live Postgres was not reachable in this environment. `bun run lint` also passed. Operationally, the observability surface is wired: reuse evidence is queryable through the canonical usage-report/verifier path, and unavailable telemetry is reported explicitly instead of silently passing.

## Requirements Advanced

- R057 — retrieval now avoids duplicate same-query embedding work within one request while preserving fail-open behavior.
- R060 — mention/review derived-context reuse now requires exact state fingerprints, so identical-state retries can reuse bounded artifacts without serving stale prompt state.
- R068 — operator-facing proof/reporting surfaces now expose reuse hit/miss/degraded evidence on canonical telemetry paths.
- R069 — regression coverage now exercises identical-state hits, changed-state misses, retry misses, and degraded cache fallback across retrieval, mention, review, and verifier surfaces.

## Requirements Validated

- R068 — Canonical reporting/verifier surfaces now expose reuse hit/miss/degraded evidence, and the S04 verifier explicitly reports unavailable telemetry instead of silently passing.
- R069 — Fresh slice verification passed for retrieval, mention, review, usage-report, verifier, and lint suites, covering identical-state hits, changed-state misses, retry misses, and degraded fallback.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Operational Readiness

None.

## Deviations

No functional plan deviations at slice scope. The main environment limitation was observability proof against live Postgres: in this executor environment the canonical verifier could only prove the fail-open degraded path (`telemetry_unavailable`) rather than inspect live reuse rows.

## Known Limitations

Live Postgres-backed reuse evidence could not be observed in this environment because the verifier preflight hit `connect ECONNREFUSED 127.0.0.1:5432`. The canonical proof path is present and tested, but S05 should still gather representative live telemetry to demonstrate real token reduction on top of these reuse signals.

## Follow-ups

S05 should run representative mention/review executions against a reachable Postgres-backed telemetry store, then use the existing canonical usage-report/verifier surfaces to prove that the new reuse paths materially reduce token spend without changing grounding or fail-open behavior.

## Files Created/Modified

- `src/knowledge/retrieval.ts` — Added request-scoped embedding reuse, duplicate normalized-variant collapse, and reuse provenance counters.
- `src/execution/mention-context.ts` — Added stable mention-state fingerprinting for bounded derived-context reuse.
- `src/handlers/mention.ts` — Wrapped mention derived-context building in a fail-open fingerprinted cache and emitted truthful reuse telemetry.
- `src/handlers/review.ts` — Wrapped review prompt artifact building in a fail-open fingerprinted cache shared by initial and retry flows and emitted reuse telemetry.
- `scripts/usage-report.ts` — Extended canonical reporting to summarize reuse evidence from durable telemetry rows.
- `scripts/verify-m061-s04.ts` — Added the S04 verifier for retrieval/derived-cache reuse evidence with explicit degraded Postgres handling.
