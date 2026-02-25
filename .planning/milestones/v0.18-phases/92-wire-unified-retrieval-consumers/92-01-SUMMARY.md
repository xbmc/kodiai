---
phase: 92-wire-unified-retrieval-consumers
plan: 01
status: complete
---

## Summary

Wired the mention handler to forward unified cross-corpus retrieval results to the mention prompt builder with source citation formatting.

## What Was Built

- **Mention handler capture**: mention.ts now captures unifiedResults, contextWindow, reviewPrecedents, and wikiKnowledge from the retriever result (mirroring review.ts pattern)
- **Prompt integration**: mention-prompt.ts accepts unified context params and renders the pre-assembled contextWindow when available, falling back to legacy retrieval for backward compat
- **Citation instruction**: Prompt includes instruction to cite sources using labels [wiki: Page Title], [review: PR #123], [code: file.ts]
- **Silent fallback**: When no wiki/review hits, no empty sections are added — answers from code context alone

## Key Decisions

- Reused `formatUnifiedContext` from review-prompt.ts rather than duplicating formatting logic
- Unified context takes precedence over legacy retrieval (if unified results exist, legacy section is skipped to avoid duplicate context)
- Updated test assertion to expect `## Knowledge Context` instead of `## Retrieval` since unified pipeline is now active

## Key Files

### Modified
- `src/handlers/mention.ts` — Captures unified retrieval fields and forwards to prompt builder
- `src/execution/mention-prompt.ts` — Accepts and renders unified context with citation labels
- `src/handlers/mention.test.ts` — Updated assertion for unified context format

## Self-Check: PASSED

- [x] All 57 mention tests pass
- [x] All 17 mention-prompt tests pass
- [x] TypeScript compiles with no errors
- [x] Unified results flow from retriever through handler to prompt
- [x] Silent fallback when no wiki/review hits
