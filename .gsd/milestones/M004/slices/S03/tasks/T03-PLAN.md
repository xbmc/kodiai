# T03: 28-knowledge-store-explicit-learning 03

**Slice:** S03 — **Milestone:** M004

## Description

Wire the knowledge store, suppression matching, confidence scoring, and review metrics into the review pipeline. This is the integration plan that connects Plans 01 and 02 to the live review flow.

Purpose: The storage and computation primitives exist; now they need to flow through the prompt (so Claude respects suppressions and outputs structured data) and through the handler (so findings are persisted and metrics are collected). This delivers LEARN-01 through LEARN-04.

Output: Enriched review prompt with suppression/confidence/metrics sections, handler integration with knowledge store writes, and app-level initialization.

## Must-Haves

- [ ] "Review prompt contains suppression rules section instructing Claude not to flag suppressed patterns"
- [ ] "Review prompt contains confidence display instructions for structured output"
- [ ] "Review prompt contains metrics formatting instructions for the summary comment"
- [ ] "Review handler initializes knowledge store and persists findings after execution"
- [ ] "Review handler applies suppression matching against finding metadata post-execution"
- [ ] "Review summary includes collapsible Review Details section with quantitative metrics"
- [ ] "Low-confidence findings appear in a separate collapsible section"

## Files

- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/handlers/review.ts`
- `src/index.ts`
