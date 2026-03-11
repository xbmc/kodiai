# T03: 103-issue-corpus-schema-store 03

**Slice:** S01 — **Milestone:** M021

## Description

Wire the IssueStore into the application — export from knowledge barrel and instantiate in index.ts.

Purpose: Makes the issue store available for Phase 105 triage agent wiring.
Output: Modified index.ts and knowledge/index.ts with issue store exports and initialization.

## Must-Haves

- [ ] IssueStore factory and types are exported from src/knowledge/index.ts
- [ ] IssueStore is instantiated in src/index.ts after migrations
- [ ] IssueStore is NOT wired into createRetriever (deferred to v0.22)

## Files

- `src/knowledge/index.ts`
- `src/index.ts`
