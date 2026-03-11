# T02: 28-knowledge-store-explicit-learning 02

**Slice:** S03 — **Milestone:** M004

## Description

Add suppression pattern config schema and confidence scoring engine. These are the two configuration and computation primitives that the handler and prompt will consume.

Purpose: Users need to configure what findings to suppress (LEARN-02) and what confidence threshold to apply (LEARN-03). The confidence engine computes scores from deterministic signals per the locked decision.

Output: Extended config schema with `review.suppressions` and `review.minConfidence`, plus `computeConfidence()` and `matchesSuppression()` pure functions with tests.

## Must-Haves

- [ ] "User can define suppression patterns as simple strings, glob prefixed, or regex prefixed in .kodiai.yml"
- [ ] "Suppression patterns support optional severity, category, and paths metadata"
- [ ] "User can set minConfidence threshold (0-100) in .kodiai.yml review config"
- [ ] "Confidence score is computed from deterministic heuristic signals, not Claude self-assessment"
- [ ] "Invalid regex patterns in suppressions fail gracefully at config parse time"

## Files

- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/knowledge/confidence.ts`
- `src/knowledge/confidence.test.ts`
