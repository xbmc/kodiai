# T02: 110-troubleshooting-retrieval-foundation 02

**Slice:** S01 — **Milestone:** M023

## Description

Comprehensive test coverage for the thread assembler and troubleshooting retrieval pipeline, verifying state filtering, budget enforcement, wiki fallback, and silent no-match behavior.

Purpose: The thread assembler has nuanced budget logic (tail-first, semantic fill, similarity-weighted distribution) and the orchestrator has a multi-step fallback chain. Tests lock down correctness before Phase 111 builds on top.

Output: Two test files covering unit-level thread assembly functions and integration-level retrieval pipeline behavior.

## Must-Haves

- [ ] "Thread assembler unit tests verify truncation, tail selection, budget distribution, empty-comment edge case, and semantic fill"
- [ ] "Integration tests verify state-filtered retrieval returns only closed issues"
- [ ] "Integration tests verify similarity floor filters low-quality matches"
- [ ] "Integration tests verify wiki fallback fires when no resolved issues match"
- [ ] "Integration tests verify silent no-match returns null when nothing found"
- [ ] "Integration tests verify PR records are excluded from results"
- [ ] "Budget distribution tests confirm similarity-weighted allocation"

## Files

- `src/knowledge/thread-assembler.test.ts`
- `src/knowledge/troubleshooting-retrieval.test.ts`
