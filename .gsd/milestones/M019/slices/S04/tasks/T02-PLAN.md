# T02: 96-code-snippet-embedding 02

**Slice:** S04 — **Milestone:** M019

## Description

Build the diff hunk parser and embedding text assembler using TDD.

Purpose: Parse unified diff format into embeddable hunk chunks with all filtering rules applied.
Output: Thoroughly tested chunker module with parseDiffHunks, buildEmbeddingText, applyHunkCap, and isExcludedPath.

## Must-Haves

- [ ] parseDiffHunks extracts hunks from unified diff format with correct startLine, lineCount, addedLines
- [ ] Pure-deletion hunks are excluded (only additions/modifications)
- [ ] Hunks with fewer than minChangedLines added lines are filtered out
- [ ] Generated/vendored files are excluded via configurable glob patterns
- [ ] buildEmbeddingText assembles file path + function context + PR title + added lines
- [ ] applyHunkCap selects the largest hunks by line count when count exceeds max

## Files

- `src/knowledge/code-snippet-chunker.ts`
- `src/knowledge/code-snippet-chunker.test.ts`
