---
id: S01
parent: M031
milestone: M031
provides:
  - src/execution/env.ts module with AGENT_ENV_ALLOWLIST and buildAgentEnv() — importable by any downstream slice needing to understand or extend the allowlist
  - Established pattern for subprocess env isolation that S02/S03/S04/S05 can reference
requires:
  []
affects:
  - S02 — git remote sanitization builds on the same security model; no shared code but same threat model
  - S04 — CLAUDE.md in workspace is a separate security surface; buildAgentEnv() is already in place for the executor call site S04 modifies
  - S05 — proof harness can import buildAgentEnv() or AGENT_ENV_ALLOWLIST directly for env-isolation checks
key_files:
  - src/execution/env.ts
  - src/execution/env.test.ts
  - src/execution/executor.ts
  - src/llm/generate.ts
key_decisions:
  - CLAUDE_CODE_ENTRYPOINT excluded from AGENT_ENV_ALLOWLIST — each call site sets the correct context-specific value
  - 26-element explicit allowlist (not denylist) — any new env var is blocked by default until explicitly permitted
  - beforeEach/afterEach snapshot pattern for process.env mutation isolation in tests
patterns_established:
  - Allowlist-first subprocess env construction: src/execution/env.ts is the single source of truth. Any future subprocess launch that uses agent code should import buildAgentEnv() rather than spreading process.env.
  - Process.env test isolation: save ALL keys touched by the test suite in beforeEach, restore ALL of them in afterEach — including keys that may have been undefined before the test set them.
observability_surfaces:
  - none
drill_down_paths:
  - .gsd/milestones/M031/slices/S01/tasks/T01-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-03-28T16:44:36.481Z
blocker_discovered: false
---

# S01: Env Allowlist — buildAgentEnv()

**Created src/execution/env.ts with AGENT_ENV_ALLOWLIST and buildAgentEnv(); wired into executor.ts and generate.ts, closing the env-secret-leakage attack surface. All 10 unit tests pass.**

## What Happened

S01 delivered a single focused change with direct security impact: the agent subprocess environment in this codebase was previously constructed with `...process.env`, meaning every application secret (GITHUB_PRIVATE_KEY, DATABASE_URL, SLACK_BOT_TOKEN, VOYAGE_API_KEY, etc.) was visible to the Claude Code agent process.

The fix: `src/execution/env.ts` exports a 26-element `AGENT_ENV_ALLOWLIST` (SDK auth, POSIX system, locale/terminal, git identity, runtime paths) and `buildAgentEnv()` which iterates the list and returns a new object containing only the allowed keys that are present in `process.env`. Keys absent from `process.env` are omitted entirely — no undefined values.

Both call sites were updated: `executor.ts:192` and `generate.ts:69` now call `buildAgentEnv()` instead of spreading `process.env`. Each call site still appends its own `CLAUDE_CODE_ENTRYPOINT` value on top, which is correct — the module intentionally omits it so `executor.ts` can set `'kodiai-github-app'` and `generate.ts` can set `'kodiai-llm-generate'`.

The unit test suite (10 tests, 23 expect() calls) covers: application secret blocking (9 keys), SDK auth forwarding, system var forwarding, unknown var blocking, absent-key omission (hasOwnProperty check), object identity (not process.env itself), and CLAUDE_CODE_ENTRYPOINT exclusion. Process.env mutations are isolated via a beforeEach/afterEach snapshot pattern that saves and restores the exact set of keys touched by the tests.

## Verification

bun test src/execution/env.test.ts → 10 pass, 0 fail, 23 expect() calls. Exit 0. Both executor.ts and generate.ts build cleanly via bun build.

## Requirements Advanced

None.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

None. Delivered exactly as planned.

## Known Limitations

None. The allowlist is exhaustive for the current subprocess needs. If new SDK auth vars are introduced (e.g., a new provider's API key), AGENT_ENV_ALLOWLIST must be updated manually — there is no dynamic discovery mechanism by design.

## Follow-ups

S02 can now import from ./env.ts if needed. S04 wires CLAUDE.md into the workspace but the env boundary established here is independent of the CLAUDE.md mechanism.

## Files Created/Modified

- `src/execution/env.ts` — New module: AGENT_ENV_ALLOWLIST (26 keys) and buildAgentEnv() — the single source of truth for subprocess env construction
- `src/execution/env.test.ts` — New test suite: 10 tests covering secret blocking, SDK auth forwarding, system var forwarding, unknown var blocking, absent-key omission, object identity, CLAUDE_CODE_ENTRYPOINT exclusion
- `src/execution/executor.ts` — Replaced `...process.env,` at line ~192 with `...buildAgentEnv(),` — closes secret leakage on the mention/review agent call site
- `src/llm/generate.ts` — Replaced `...process.env,` at line ~69 with `...buildAgentEnv(),` — closes secret leakage on the LLM generate call site
