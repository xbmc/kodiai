# T01: 33-explainable-learning-and-delta-reporting 01

**Slice:** S04 — **Milestone:** M006

## Description

Create a delta classification module that compares current review findings against prior review findings using filePath:titleFingerprint composite keys to label each finding as `new`, `still-open`, or `resolved`.

Purpose: Provides the classification engine that Phase 33-03 will call from the review handler to produce delta-labeled findings for the Review Details summary. This is a pure deterministic set-comparison function with well-defined I/O -- ideal for TDD.

Output: `src/lib/delta-classifier.ts` with exported types and `classifyFindingDeltas` function, plus comprehensive test coverage.

## Must-Haves

- [ ] "classifyFindingDeltas correctly labels current findings as new or still-open based on prior fingerprint comparison"
- [ ] "Prior findings not present in current findings are returned as resolved"
- [ ] "Counts object accurately reflects new, resolved, and stillOpen tallies"
- [ ] "Empty prior findings produce all-new classifications with zero resolved"
- [ ] "Empty current findings with non-empty prior produce all-resolved classifications"

## Files

- `src/lib/delta-classifier.ts`
- `src/lib/delta-classifier.test.ts`
