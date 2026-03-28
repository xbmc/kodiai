---
estimated_steps: 22
estimated_files: 4
skills_used: []
---

# T01: Create buildAgentEnv() module, wire into executor.ts and generate.ts, add unit tests

This task closes the primary attack surface: today executor.ts:192 and generate.ts:69 both pass ...process.env to the Claude Code agent subprocess, exposing every application secret (GITHUB_PRIVATE_KEY, DATABASE_URL, SLACK_BOT_TOKEN, etc.) to the agent. The fix is to introduce a single module that builds a minimal, allowlisted subprocess env, and wire it into both call sites.

Steps:
1. Create src/execution/env.ts:
   - Export AGENT_ENV_ALLOWLIST: readonly string[] — the exact list of env var names the agent subprocess may receive. Include: CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY, HOME, PATH, TMPDIR, TEMP, TMP, USER, USERNAME, LOGNAME, LANG, LC_ALL, LC_CTYPE, LC_MESSAGES, LC_NUMERIC, LC_TIME, TERM, SHELL, GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL, GIT_COMMITTER_NAME, GIT_COMMITTER_EMAIL, BUN_INSTALL, NODE_PATH.
   - Export buildAgentEnv(): NodeJS.ProcessEnv — iterates AGENT_ENV_ALLOWLIST, picks each key from process.env if present (skip undefined), returns a new object. Does NOT include CLAUDE_CODE_ENTRYPOINT — callers add that on top.
2. Update src/execution/executor.ts:
   - Import buildAgentEnv from ./env.ts
   - At line 192, replace `...process.env,` with `...buildAgentEnv(),`
   - The existing `CLAUDE_CODE_ENTRYPOINT: 'kodiai-github-app'` line stays as-is (it overrides whatever buildAgentEnv returns, which is correct)
3. Update src/llm/generate.ts:
   - Import buildAgentEnv from ../execution/env.ts
   - At line 69, replace `...process.env,` with `...buildAgentEnv(),`
   - The existing `CLAUDE_CODE_ENTRYPOINT: 'kodiai-llm-generate'` line stays as-is
4. Create src/execution/env.test.ts:
   - Test suite 'buildAgentEnv': use bun:test (describe/test/expect pattern, no import from 'bun:test' mock needed — pure unit)
   - 'blocks application secret keys': set each of GITHUB_PRIVATE_KEY, GITHUB_PRIVATE_KEY_BASE64, GITHUB_APP_ID, GITHUB_WEBHOOK_SECRET, DATABASE_URL, SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, VOYAGE_API_KEY, BOT_USER_PAT in process.env before calling buildAgentEnv(), assert none appear in result
   - 'forwards SDK auth vars when set': set CLAUDE_CODE_OAUTH_TOKEN and ANTHROPIC_API_KEY in process.env, assert both appear in buildAgentEnv() result
   - 'forwards system vars when set': set HOME=/test-home, PATH=/usr/bin, USER=testuser, assert all appear in result
   - 'blocks unknown arbitrary vars': set process.env.SOME_UNKNOWN_SECRET='leak', assert absent from result
   - 'AGENT_ENV_ALLOWLIST is a non-empty array': assert Array.isArray(AGENT_ENV_ALLOWLIST) and length > 0
   - Restore process.env after each test using beforeEach/afterEach snapshot pattern (save original values, restore them after each test that mutates them)
5. Run bun test src/execution/env.test.ts and confirm exit 0

## Inputs

- `src/execution/executor.ts`
- `src/llm/generate.ts`

## Expected Output

- `src/execution/env.ts`
- `src/execution/env.test.ts`

## Verification

bun test src/execution/env.test.ts

## Observability Impact

None — buildAgentEnv() is synchronous and pure; no runtime signals or new log paths introduced.
