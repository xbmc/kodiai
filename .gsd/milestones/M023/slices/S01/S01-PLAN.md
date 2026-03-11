# S01: Troubleshooting Retrieval Foundation

**Goal:** Extend IssueStore with state-filtered search, build a resolution-focused thread assembler, and create the troubleshooting retrieval orchestrator with wiki fallback and silent no-match.
**Demo:** Extend IssueStore with state-filtered search, build a resolution-focused thread assembler, and create the troubleshooting retrieval orchestrator with wiki fallback and silent no-match.

## Must-Haves


## Tasks

- [x] **T01: 110-troubleshooting-retrieval-foundation 01**
  - Extend IssueStore with state-filtered search, build a resolution-focused thread assembler, and create the troubleshooting retrieval orchestrator with wiki fallback and silent no-match.

Purpose: Phase 111 (troubleshooting agent) needs to retrieve similar resolved issues and assemble their resolution context. This plan provides the entire retrieval foundation: filtered search, thread assembly with budget management, and the fallback chain.

Output: Three new modules (thread-assembler.ts, troubleshooting-retrieval.ts) plus extensions to IssueStore, issue-store.ts, config.ts, and index.ts.
- [x] **T02: 110-troubleshooting-retrieval-foundation 02**
  - Comprehensive test coverage for the thread assembler and troubleshooting retrieval pipeline, verifying state filtering, budget enforcement, wiki fallback, and silent no-match behavior.

Purpose: The thread assembler has nuanced budget logic (tail-first, semantic fill, similarity-weighted distribution) and the orchestrator has a multi-step fallback chain. Tests lock down correctness before Phase 111 builds on top.

Output: Two test files covering unit-level thread assembly functions and integration-level retrieval pipeline behavior.

## Files Likely Touched

- `src/knowledge/issue-types.ts`
- `src/knowledge/issue-store.ts`
- `src/knowledge/issue-retrieval.ts`
- `src/knowledge/thread-assembler.ts`
- `src/knowledge/troubleshooting-retrieval.ts`
- `src/execution/config.ts`
- `src/knowledge/index.ts`
- `src/knowledge/thread-assembler.test.ts`
- `src/knowledge/troubleshooting-retrieval.test.ts`
