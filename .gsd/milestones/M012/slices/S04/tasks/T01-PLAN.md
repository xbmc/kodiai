# T01: 69-snippet-anchors-prompt-budgeting 01

**Slice:** S04 — **Milestone:** M012

## Description

Build the RET-08 utility core with TDD: snippet-anchor extraction plus deterministic budget trimming.

Purpose: Phase 69 needs reusable logic that can run in both review and mention flows to produce actionable evidence (`path:line` + snippet) without overflowing prompt budgets.
Output: `src/learning/retrieval-snippets.ts` and `src/learning/retrieval-snippets.test.ts` with RED->GREEN coverage for anchor extraction, budget enforcement, and fail-open behavior.

## Must-Haves

- [ ] "Retrieved findings can be rendered with concise snippet evidence and `path:line` anchors when matching evidence is found"
- [ ] "Snippet extraction enforces strict per-item and total-size caps so utility output stays prompt-safe"
- [ ] "Snippet extraction failures never throw into callers; utility degrades to path-only anchors"

## Files

- `src/learning/retrieval-snippets.ts`
- `src/learning/retrieval-snippets.test.ts`
