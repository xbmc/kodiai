# T03: 31-incremental-re-review-with-retrieval-context 03

**Slice:** S02 — **Milestone:** M006

## Description

Wire incremental diff, finding deduplication, and retrieval context into the review handler and prompt builder.

Purpose: This is the integration plan that connects all Phase 31 infrastructure (config, KnowledgeStore queries, incremental diff, finding dedup, retrieval) into the live review pipeline. After this plan, synchronize events trigger incremental re-reviews, prior findings inform dedup, and learning memory enriches prompts.

Output: Working incremental re-review with retrieval context, all fail-open.

## Must-Haves

- [ ] "pull_request.synchronize events trigger review when onSynchronize is enabled"
- [ ] "Synchronize events compute incremental diff and only review changed files"
- [ ] "Prior findings on unchanged code are injected as context in the review prompt"
- [ ] "New findings matching prior finding fingerprints on unchanged files are suppressed"
- [ ] "Retrieval context from learning memory is injected into the review prompt"
- [ ] "If incremental diff fails, review proceeds as full review (fail-open)"
- [ ] "If retrieval fails, review proceeds without retrieval context (fail-open)"
- [ ] "review_requested events also attempt incremental mode if prior completed review exists"

## Files

- `src/handlers/review.ts`
- `src/execution/review-prompt.ts`
