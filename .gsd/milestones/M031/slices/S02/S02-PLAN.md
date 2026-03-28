# S02: Git Remote Sanitization + Token Memory Refactor

**Goal:** Post-clone, immediately rewrite the git remote URL to strip the x-access-token credential. Carry the token in Workspace.token (memory only). Refactor createBranchCommitAndPush, commitAndPushToRemoteRef, pushHeadToRemoteRef, and fetchAndCheckoutPullRequestHeadRef to receive the token from the caller rather than re-reading it from .git/config.
**Demo:** After this: Unit test reads back git remote get-url origin after workspace.create() and asserts no x-access-token present. bun test src/jobs/workspace.test.ts exits 0.

## Tasks
