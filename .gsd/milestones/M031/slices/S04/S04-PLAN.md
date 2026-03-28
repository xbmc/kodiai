# S04: Prompt Security Policy + CLAUDE.md in Workspace

**Goal:** Add buildSecurityPolicySection() to review-prompt.ts. Import and include it in both buildMentionPrompt (mention-prompt.ts) and buildReviewPrompt (review-prompt.ts). Write a CLAUDE.md containing the security policy to workspace.dir immediately before every executor.ts query() call.
**Demo:** After this: Unit test on buildMentionPrompt asserts result includes '## Security Policy' and 'refuse'. Executor test asserts workspace dir contains CLAUDE.md with security content. bun test src/execution/mention-prompt.test.ts src/execution/review-prompt.test.ts src/execution/executor.test.ts exits 0.

## Tasks
