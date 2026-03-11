# S04: Wire Unified Retrieval Consumers

**Goal:** Wire the mention handler to forward unified cross-corpus retrieval results to the mention prompt builder, and update mention-prompt.
**Demo:** Wire the mention handler to forward unified cross-corpus retrieval results to the mention prompt builder, and update mention-prompt.

## Must-Haves


## Tasks

- [x] **T01: 92-wire-unified-retrieval-consumers 01**
  - Wire the mention handler to forward unified cross-corpus retrieval results to the mention prompt builder, and update mention-prompt.ts to format unified context with inline source citations.

Purpose: @mention responses currently only use legacy code findings. This plan wires the unified pipeline output (wiki + review + code) through to the mention prompt with [wiki: Name] and [review: PR #123] citation markers.
Output: mention.ts forwards unifiedResults/contextWindow; mention-prompt.ts renders attributed context.
- [x] **T02: 92-wire-unified-retrieval-consumers 02**
  - Fix the review retry path to pass full unified context to buildReviewPrompt and wire learningMemoryStore into createRetriever() for hybrid BM25+vector search on the code corpus.

Purpose: The retry path currently drops wikiKnowledge, unifiedResults, and contextWindow. The code corpus currently gets vector-only search because learningMemoryStore is not passed to createRetriever. This plan closes both gaps.
Output: Review retry preserves unified context; code corpus gets hybrid search via BM25+vector.
- [x] **T03: 92-wire-unified-retrieval-consumers 03**
  - Verify each pending requirement against actual code and update REQUIREMENTS.md checkboxes for KI-11 through KI-14 and the remaining success criteria.

Purpose: The audit found requirements KI-11 through KI-14 are satisfied by the Phase 91 + 92 work but checkboxes remain unchecked. Per CONTEXT.md, verify each requirement before checking — don't blindly trust the audit. Checkbox updates go in a separate commit from wiring code changes.
Output: REQUIREMENTS.md with all v0.18 checkboxes checked and a verification log.

## Files Likely Touched

- `src/handlers/mention.ts`
- `src/execution/mention-prompt.ts`
- `src/handlers/review.ts`
- `src/index.ts`
- `.planning/REQUIREMENTS.md`
