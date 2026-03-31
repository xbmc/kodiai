# S03: Harden security policy prompt against execution bypass

**Goal:** Update buildSecurityClaudeMd and buildSecurityPolicySection to mandate code review before any execution request and name the social engineering bypass pattern explicitly.
**Demo:** After this: bun test ./src/execution/review-prompt.test.ts passes with assertions for new security policy clauses.

## Tasks
