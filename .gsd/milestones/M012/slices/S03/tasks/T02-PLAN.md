# T02: 68-multi-query-retrieval-core 02

**Slice:** S03 — **Milestone:** M012

## Description

Integrate Phase 68 multi-query retrieval into live review and mention execution paths with deterministic merged context and fail-open behavior.

Purpose: Deliver full RET-07 outcome across user-facing surfaces, not only pure functions, while preserving reliability and latency constraints established in Phases 66-67.
Output: Review and mention handlers use shared multi-query retrieval orchestration, prompt wiring is updated, and regressions lock deterministic/fail-open behavior.

## Must-Haves

- [ ] "Review and mention flows execute bounded intent/file-path/code-shape retrieval variants from one request context"
- [ ] "Merged retrieval context ordering is deterministic and stable for equivalent inputs in both surfaces"
- [ ] "If one retrieval variant errors, the flow fails open and still responds using successful variants"
- [ ] "Multi-query integration stays within current operational latency guardrails"

## Files

- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
- `src/execution/mention-prompt.ts`
- `src/execution/mention-prompt.test.ts`
- `src/learning/multi-query-retrieval.ts`
