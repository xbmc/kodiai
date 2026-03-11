# T02: 60-issue-q-a 02

**Slice:** S01 — **Milestone:** M011

## Description

Create an issue-specific code-context helper that surfaces likely file pointers from the workspace so issue answers can include actionable file references.

Purpose: Prompt-only instructions are insufficient for consistent path-rich answers; this helper supplies concrete repository hints for ISSUE-01 when questions imply code-level guidance.
Output: New `buildIssueCodeContext()` module and tests covering bounded extraction and fail-open behavior.

## Must-Haves

- [ ] "Issue Q&A can provide concrete repository pointers before generation when code context is relevant"
- [ ] "Code-pointer extraction is deterministic and bounded so mentions remain reliable"
- [ ] "Low-signal questions degrade safely without blocking issue replies"

## Files

- `src/execution/issue-code-context.ts`
- `src/execution/issue-code-context.test.ts`
