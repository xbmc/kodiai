# T03: 62-issue-write-mode-pr-creation 03

**Slice:** S03 — **Milestone:** M011

## Description

Close the Phase 62 production gaps by fixing real issue-comment write-intent classification and proving that accepted issue requests create a default-branch PR with an in-thread `Opened PR` response.

Purpose: Verification found code-level coverage but failed live behavior, so this plan restores production truth for IWR-01 with fixture parity and live-evidence validation.
Output: Mention handler/runtime tests updated to match real webhook payload shape, plus validated live issue evidence showing trigger comment, bot PR-link reply, and created PR URL.

## Must-Haves

- [ ] "Production-shape issue_comment `@kodiai apply:`/`@kodiai change:` is accepted as write-mode when write.enabled is true"
- [ ] "Accepted issue write-mode flow reaches branch push plus `pulls.create` against repository default branch"
- [ ] "Issue thread receives `Opened PR: <url>` and live validation captures trigger, reply, and PR URL evidence"

## Files

- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
