# S05: End-to-End Proof Harness (verify:m031) — UAT

**Milestone:** M031
**Written:** 2026-03-28T18:00:07.375Z

# S05 UAT: End-to-End Proof Harness (verify:m031)

## Preconditions

- `scripts/verify-m031.ts` and `scripts/verify-m031.test.ts` exist in the repo root
- `package.json` has `"verify:m031": "bun scripts/verify-m031.ts"` in scripts
- ANTHROPIC_API_KEY is set in the environment (or check 1 assertion on ANTHROPIC_API_KEY presence is relaxed — check is tolerant of key being absent in CI)
- All M031 S01–S04 source files are present: `src/execution/env.ts` (buildAgentEnv), `src/jobs/workspace.ts` (buildAuthFetchUrl), `src/lib/sanitizer.ts` (scanOutgoingForSecrets), `src/execution/mention-prompt.ts` (buildMentionPrompt), `src/execution/executor.ts` (buildSecurityClaudeMd)

---

## Test Cases

### TC-01: Test suite passes (23/23)

**Command:** `bun test ./scripts/verify-m031.test.ts`

**Expected outcome:**
- Exit code 0
- Output contains `23 pass` and `0 fail`
- All five check groups present in output: M031-ENV-ALLOWLIST, M031-GIT-URL-CLEAN, M031-OUTGOING-SCAN-BLOCKS, M031-PROMPT-HAS-SECURITY, M031-CLAUDEMD-HAS-SECURITY
- envelope and buildM031ProofHarness describe blocks pass

---

### TC-02: Proof harness runs with five green checks

**Command:** `bun run verify:m031`

**Expected outcome:**
- Exit code 0
- Output line: `Final verdict: PASS`
- Five lines each starting with `- M031-<CHECK-ID> PASS`
- No `FAIL` or `SKIP` lines

---

### TC-03: ENV-ALLOWLIST check — DATABASE_URL is blocked

**Manual verification:** In `scripts/verify-m031.ts`, locate `runEnvAllowlist()`. It sets `process.env.DATABASE_URL = 'postgres://secret'`, calls `buildAgentEnv()`, and asserts `DATABASE_URL` is absent from the result. Confirm the check returns `{ passed: true }`.

**Edge case:** The check restores the original `DATABASE_URL` value in a finally block — verify it does not permanently mutate the process environment.

---

### TC-04: GIT-URL-CLEAN check — token-absent fast path

**Manual verification:** `buildAuthFetchUrl('', undefined)` must return the string `'origin'` without reading the filesystem. Confirm check result includes `result="origin"` and `no token in URL` in the detail.

---

### TC-05: OUTGOING-SCAN-BLOCKS check — github-pat pattern

**Manual verification:** Calling `scanOutgoingForSecrets` with a 36-char `ghp_`-prefixed string must return `{ blocked: true, matchedPattern: 'github-pat' }`. Confirm the check detail shows `blocked=true matchedPattern=github-pat`.

---

### TC-06: PROMPT-HAS-SECURITY check — Security Policy in mention prompt

**Manual verification:** `buildMentionPrompt` with a minimal `pr_comment` MentionEvent must produce a string containing `## Security Policy` and `I can't help with that`. Confirm the check passes and the detail references both strings.

---

### TC-07: CLAUDEMD-HAS-SECURITY check — Security Policy in CLAUDE.md content

**Manual verification:** `buildSecurityClaudeMd()` must return a string containing `# Security Policy` and `I can't help with that`. Confirm the check passes.

---

### TC-08: JSON output mode

**Command:** `bun scripts/verify-m031.ts --json`

**Expected outcome:**
- Exit code 0
- Output is valid JSON
- JSON has `overallPassed: true` and `checks` array with 5 entries, each with `passed: true`

---

### TC-09: Harness exit code on injected failure

**Verification via test suite:** `buildM031ProofHarness > exit code 1 when a check fails` test in `verify-m031.test.ts` injects a failing `_buildAgentEnvFn` and asserts exit code 1. TC-01 (running the full test suite) covers this case.

---

## Edge Cases

- **ghp_ token length:** The github-pat regex requires exactly 36 chars after the prefix. Tokens shorter than 36 chars are not matched. The test harness pads to 36 chars — confirm `scanOutgoingForSecrets('ghp_' + 'A'.repeat(36))` returns `{ blocked: true }`.
- **Bun test path prefix:** `bun test scripts/verify-m031.test.ts` (without `./`) treats the argument as a filter and produces "no test files found". Always use `bun test ./scripts/verify-m031.test.ts`.

