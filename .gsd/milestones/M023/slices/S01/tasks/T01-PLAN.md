# T01: 110-troubleshooting-retrieval-foundation 01

**Slice:** S01 — **Milestone:** M023

## Description

Extend IssueStore with state-filtered search, build a resolution-focused thread assembler, and create the troubleshooting retrieval orchestrator with wiki fallback and silent no-match.

Purpose: Phase 111 (troubleshooting agent) needs to retrieve similar resolved issues and assemble their resolution context. This plan provides the entire retrieval foundation: filtered search, thread assembly with budget management, and the fallback chain.

Output: Three new modules (thread-assembler.ts, troubleshooting-retrieval.ts) plus extensions to IssueStore, issue-store.ts, config.ts, and index.ts.

## Must-Haves

- [ ] "searchByEmbedding and searchByFullText accept optional stateFilter and return only matching-state issues when provided"
- [ ] "Thread assembler produces resolution-focused context with tail comments guaranteed, semantic fill for remaining budget"
- [ ] "Budget is distributed across matches weighted by similarity score"
- [ ] "Bodies over 500 chars are truncated to first paragraph + last paragraph"
- [ ] "When no resolved issues pass similarity floor, wiki fallback runs with dual query (original + keywords)"
- [ ] "When both resolved issues and wiki return nothing, the function returns null (silent no-match)"
- [ ] "Troubleshooting config is available as triage.troubleshooting sub-object with enabled, similarityThreshold, maxResults, totalBudgetChars"

## Files

- `src/knowledge/issue-types.ts`
- `src/knowledge/issue-store.ts`
- `src/knowledge/issue-retrieval.ts`
- `src/knowledge/thread-assembler.ts`
- `src/knowledge/troubleshooting-retrieval.ts`
- `src/execution/config.ts`
- `src/knowledge/index.ts`
