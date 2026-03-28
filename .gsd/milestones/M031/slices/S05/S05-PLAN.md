# S05: End-to-End Proof Harness (verify:m031)

**Goal:** Write scripts/verify-m031.ts following the M029 harness pattern. Five pure-code checks: ENV-ALLOWLIST-BLOCKS-SECRETS, GIT-REMOTE-CLEAN, OUTGOING-SCAN-BLOCKS-CREDENTIALS, PROMPT-CONTAINS-SECURITY-POLICY, WORKSPACE-CLAUDE-MD-WRITTEN. Add 'verify:m031' to package.json scripts. Write companion test file.
**Demo:** After this: bun run verify:m031 output shows five green checks. bun test scripts/verify-m031.test.ts exits 0.

## Tasks
