# M031: 

## Vision
No information reachable inside the agent's environment can leak outward, regardless of what a user asks. A user asking @kodiai for its API key or to read .git/config gets a refusal, not the key — and even if the agent generated credential text, every publish path strips it before it leaves the system.

## Slice Overview
| ID | Slice | Risk | Depends | Done | After this |
|----|-------|------|---------|------|------------|
| S01 | Env Allowlist — buildAgentEnv() | high | — | ✅ | Unit test output shows buildAgentEnv() blocks all application secrets and preserves SDK auth + system vars. bun test src/execution/env.test.ts exits 0. |
| S02 | Git Remote Sanitization + Token Memory Refactor | high | S01 | ✅ | Unit test reads back git remote get-url origin after workspace.create() and asserts no x-access-token present. bun test src/jobs/workspace.test.ts exits 0. |
| S03 | Outgoing Secret Scan on All Publish Paths | medium | S01 | ✅ | Unit test demonstrates a string containing 'ghp_abc123...' is blocked with { blocked: true, matchedPattern: 'github-pat' }. bun test src/lib/sanitizer.test.ts exits 0. |
| S04 | Prompt Security Policy + CLAUDE.md in Workspace | low | S01 | ✅ | Unit test on buildMentionPrompt asserts result includes '## Security Policy' and 'refuse'. Executor test asserts workspace dir contains CLAUDE.md with security content. bun test src/execution/mention-prompt.test.ts src/execution/review-prompt.test.ts src/execution/executor.test.ts exits 0. |
| S05 | End-to-End Proof Harness (verify:m031) | low | S01, S02, S03, S04 | ✅ | bun run verify:m031 output shows five green checks. bun test scripts/verify-m031.test.ts exits 0. |
| S06 | Fix TS2532 in verify-m031.test.ts — R001 remediation | low | S05 | ✅ | bunx tsc --noEmit exits 0 with no errors across the codebase. |
