# T01: 44-smart-finding-prioritization 01

**Slice:** S03 — **Milestone:** M008

## Description

Build a pure, deterministic finding prioritization engine with TDD so Phase 44 can enforce multi-factor ranking independent of model output order.

Purpose: Requirement PRIOR-01/02 depends on reliable post-LLM prioritization logic that can be tested in isolation and reused by the review handler.

Output: `src/lib/finding-prioritizer.ts` and `src/lib/finding-prioritizer.test.ts` with RED-GREEN coverage for scoring, sorting, and capped selection behavior.

## Must-Haves

- [ ] "Findings receive a deterministic composite score using severity, file risk, category, and recurrence"
- [ ] "When a cap is provided, prioritization returns exactly the highest-scoring findings up to that cap"
- [ ] "Score ordering is stable and predictable when scores tie"
- [ ] "Prioritization returns summary stats needed for Review Details transparency"

## Files

- `src/lib/finding-prioritizer.ts`
- `src/lib/finding-prioritizer.test.ts`
