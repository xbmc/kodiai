# T01: 58-intelligence-layer 01

**Slice:** S03 — **Milestone:** M010

## Description

Create the adaptive distance threshold computation module using TDD.

Purpose: This pure function is the algorithmic core of Phase 58 -- it takes a sorted array of candidate distances and determines the optimal cutoff using max-gap detection (8+ candidates) or percentile fallback (fewer candidates). TDD is ideal because the function has well-defined inputs and outputs with many edge cases.

Output: `src/learning/adaptive-threshold.ts` with full test coverage in `src/learning/adaptive-threshold.test.ts`

## Must-Haves

- [ ] "computeAdaptiveThreshold uses max-gap detection when given 8+ distances"
- [ ] "computeAdaptiveThreshold uses 75th-percentile fallback when given fewer than 8 distances"
- [ ] "computeAdaptiveThreshold falls back to configured threshold when no candidates or gap too small"
- [ ] "All computed thresholds are clamped to [0.15, 0.65] floor/ceiling bounds"

## Files

- `src/learning/adaptive-threshold.ts`
- `src/learning/adaptive-threshold.test.ts`
