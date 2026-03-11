# S01: Issue Q A

**Goal:** Define and lock the Issue Q&A response contract in the mention prompt so issue replies are direct, actionable, and path-specific when code evidence is required.
**Demo:** Define and lock the Issue Q&A response contract in the mention prompt so issue replies are direct, actionable, and path-specific when code evidence is required.

## Must-Haves


## Tasks

- [x] **T01: 60-issue-q-a 01** `est:1 min`
  - Define and lock the Issue Q&A response contract in the mention prompt so issue replies are direct, actionable, and path-specific when code evidence is required.

Purpose: ISSUE-01 depends on consistent model behavior; this plan encodes non-negotiable response rules into prompt text and tests before handler wiring.
Output: Updated `buildMentionPrompt()` rules plus regression tests proving issue-surface requirements are present.
- [x] **T02: 60-issue-q-a 02** `est:3 min`
  - Create an issue-specific code-context helper that surfaces likely file pointers from the workspace so issue answers can include actionable file references.

Purpose: Prompt-only instructions are insufficient for consistent path-rich answers; this helper supplies concrete repository hints for ISSUE-01 when questions imply code-level guidance.
Output: New `buildIssueCodeContext()` module and tests covering bounded extraction and fail-open behavior.
- [x] **T03: 60-issue-q-a 03** `est:3 min`
  - Wire issue Q&A behavior end-to-end in the mention handler so issue mentions reliably produce actionable answers with path pointers or focused clarification.

Purpose: This integration step satisfies ISSUE-01 at runtime by combining prompt contract + code-pointer enrichment + deterministic fallback on silent/non-published runs.
Output: Mention handler updates for issue comments plus regression tests proving direct answer path and underspecified fallback path.

## Files Likely Touched

- `src/execution/mention-prompt.ts`
- `src/execution/mention-prompt.test.ts`
- `src/execution/issue-code-context.ts`
- `src/execution/issue-code-context.test.ts`
- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
