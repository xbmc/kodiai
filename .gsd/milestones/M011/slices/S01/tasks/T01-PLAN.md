# T01: 60-issue-q-a 01

**Slice:** S01 — **Milestone:** M011

## Description

Define and lock the Issue Q&A response contract in the mention prompt so issue replies are direct, actionable, and path-specific when code evidence is required.

Purpose: ISSUE-01 depends on consistent model behavior; this plan encodes non-negotiable response rules into prompt text and tests before handler wiring.
Output: Updated `buildMentionPrompt()` rules plus regression tests proving issue-surface requirements are present.

## Must-Haves

- [ ] "Issue mentions get one direct in-thread answer instead of a generic restatement"
- [ ] "When code context matters, the response contract requires specific file-path pointers"
- [ ] "When context is missing, the response contract requires targeted clarifying questions"

## Files

- `src/execution/mention-prompt.ts`
- `src/execution/mention-prompt.test.ts`
