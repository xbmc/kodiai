---
id: T01
parent: S01
milestone: M031
provides: []
requires: []
affects: []
key_files: ["src/execution/env.ts", "src/execution/env.test.ts", "src/execution/executor.ts", "src/llm/generate.ts"]
key_decisions: ["CLAUDE_CODE_ENTRYPOINT excluded from AGENT_ENV_ALLOWLIST so each call site sets the correct value for its context", "beforeEach/afterEach snapshot pattern for process.env mutation isolation"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "bun test src/execution/env.test.ts → 10 pass, 0 fail, 23 expect() calls. Both modified files build cleanly with bun build."
completed_at: 2026-03-28T16:43:07.918Z
blocker_discovered: false
---

# T01: Introduced buildAgentEnv() and wired it into both agent subprocess call sites, closing the env-secret-leakage attack surface; all 10 unit tests pass

> Introduced buildAgentEnv() and wired it into both agent subprocess call sites, closing the env-secret-leakage attack surface; all 10 unit tests pass

## What Happened
---
id: T01
parent: S01
milestone: M031
key_files:
  - src/execution/env.ts
  - src/execution/env.test.ts
  - src/execution/executor.ts
  - src/llm/generate.ts
key_decisions:
  - CLAUDE_CODE_ENTRYPOINT excluded from AGENT_ENV_ALLOWLIST so each call site sets the correct value for its context
  - beforeEach/afterEach snapshot pattern for process.env mutation isolation
duration: ""
verification_result: passed
completed_at: 2026-03-28T16:43:07.918Z
blocker_discovered: false
---

# T01: Introduced buildAgentEnv() and wired it into both agent subprocess call sites, closing the env-secret-leakage attack surface; all 10 unit tests pass

**Introduced buildAgentEnv() and wired it into both agent subprocess call sites, closing the env-secret-leakage attack surface; all 10 unit tests pass**

## What Happened

Created src/execution/env.ts exporting AGENT_ENV_ALLOWLIST (26 explicitly named keys) and buildAgentEnv() which iterates the list and returns a minimal subprocess env. CLAUDE_CODE_ENTRYPOINT is intentionally absent so each call site sets the correct value. Wired buildAgentEnv() into executor.ts and generate.ts replacing ...process.env spreads. Wrote 10 unit tests covering secret blocking, SDK auth forwarding, system var forwarding, unknown var blocking, absent-key omission, object identity, and CLAUDE_CODE_ENTRYPOINT exclusion. Process.env mutations isolated via beforeEach/afterEach snapshot pattern.

## Verification

bun test src/execution/env.test.ts → 10 pass, 0 fail, 23 expect() calls. Both modified files build cleanly with bun build.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test src/execution/env.test.ts` | 0 | ✅ pass | 2600ms |


## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/execution/env.ts`
- `src/execution/env.test.ts`
- `src/execution/executor.ts`
- `src/llm/generate.ts`


## Deviations
None.

## Known Issues
None.
