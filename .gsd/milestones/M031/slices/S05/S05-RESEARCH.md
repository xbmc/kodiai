# S05 Research: End-to-End Proof Harness (verify:m031)

**Researched:** 2026-03-28

---

## Summary

This is a light research slice — no new technology, no new architecture. The proof harness pattern is fully established in prior milestones (M029/S04 is the canonical reference). S05 applies that exact pattern to five M031-specific checks, all exercising code that already exists and is tested in S01–S04. The work is: write `scripts/verify-m031.ts` and `scripts/verify-m031.test.ts`, and register `verify:m031` in `package.json`.

---

## Implementation Landscape

### Harness pattern (from M029/S04)

`scripts/verify-m029-s04.ts` is the canonical reference. The structure is:

1. **Exported constants:** `M029_S04_CHECK_IDS` tuple, `Check` type, `EvaluationReport` type
2. **Per-check runner functions** (one per check ID) — each returns `{ id, passed, skipped, status_code, detail? }`
3. **`evaluateM031(opts?)` function** — runs all checks in `Promise.all`, computes `overallPassed` (skipped checks excluded), returns report
4. **`buildM031ProofHarness(opts?)` function** — tries to auto-discover DB/GitHub from env vars, renders human or JSON output, returns `{ exitCode }`
5. **CLI runner** via `if (import.meta.main)`

The test suite mirrors the harness module structure: one `describe` block per check, plus envelope, `overallPassed` semantics, and `buildM031ProofHarness` groups.

### The five M031 checks

All five are **pure-code** (no DB, no GitHub required). This is a simpler harness than M029/S04 — every check always runs, none skip on missing infra.

| Check ID | What it proves | Source import | Test vector |
|---|---|---|---|
| `M031-ENV-ALLOWLIST` | `buildAgentEnv()` blocks application secrets | `src/execution/env.ts` → `buildAgentEnv`, `AGENT_ENV_ALLOWLIST` | Set `process.env.DATABASE_URL = "postgres://..."`, call `buildAgentEnv()`, assert `DATABASE_URL` absent; assert at least one auth key (`ANTHROPIC_API_KEY`/`CLAUDE_CODE_OAUTH_TOKEN`) present when set |
| `M031-GIT-URL-CLEAN` | Git remote URL contains no `x-access-token` after strip | `src/jobs/workspace.ts` → `buildAuthFetchUrl` | Assert `buildAuthFetchUrl("", undefined)` returns `"origin"` (no token injection when token absent) and does not contain `x-access-token` |
| `M031-OUTGOING-SCAN-BLOCKS` | `scanOutgoingForSecrets("ghp_abc123...")` returns blocked:true | `src/lib/sanitizer.ts` → `scanOutgoingForSecrets` | Call with a known `ghp_` PAT string, assert `{ blocked: true, matchedPattern: "github-pat" }` |
| `M031-PROMPT-HAS-SECURITY` | `buildMentionPrompt(...)` output includes `## Security Policy` and `refuse` language | `src/execution/mention-prompt.ts` → `buildMentionPrompt` | Build a minimal prompt params object (empty strings/defaults), assert result includes `## Security Policy` and `"I can't help with that"` |
| `M031-CLAUDEMD-HAS-SECURITY` | `buildSecurityClaudeMd()` output includes `# Security Policy` and the expected refusal phrasing | `src/execution/executor.ts` → `buildSecurityClaudeMd` | Call directly, assert result includes `# Security Policy` and `"I can't help with that"` |

### Imports needed

```ts
import { buildAgentEnv, AGENT_ENV_ALLOWLIST } from "../src/execution/env.ts";
import { scanOutgoingForSecrets } from "../src/lib/sanitizer.ts";
import { buildMentionPrompt } from "../src/execution/mention-prompt.ts";
import { buildSecurityClaudeMd } from "../src/execution/executor.ts";
import { buildAuthFetchUrl } from "../src/jobs/workspace.ts";
```

All exports confirmed present and exported:
- `AGENT_ENV_ALLOWLIST`: exported const in `src/execution/env.ts` (line 24)
- `buildAgentEnv`: exported function in `src/execution/env.ts`
- `scanOutgoingForSecrets`: exported from `src/lib/sanitizer.ts` (line 237)
- `buildMentionPrompt`: exported from `src/execution/mention-prompt.ts` (line 12)
- `buildSecurityClaudeMd`: exported from `src/execution/executor.ts` (line 15)
- `buildAuthFetchUrl`: exported from `src/jobs/workspace.ts` (confirmed line ~621 region)

### `buildMentionPrompt` minimal params

From `src/execution/mention-prompt.ts` line 12 — the function takes a `params` object. Need to check what's required vs optional to construct a minimal call.

Quick scan of the function signature is needed at task time — use `lsp hover` or read the first ~50 lines of the function. The test in `src/execution/mention-prompt.test.ts` already demonstrates the minimal call pattern used by S04 tests.

### `buildAuthFetchUrl` for the git URL check

From `src/jobs/workspace.ts`: `buildAuthFetchUrl(dir: string, token: string | undefined): string` — when `token` is undefined, it returns `"origin"`. This is the backward-compatible fallback path. The check verifies: when no token is present, the returned value does not contain `x-access-token`. This is a behavioral invariant, not a real filesystem operation — no `dir` needs to exist for the undefined-token path (the function returns early with `"origin"`).

For a stronger check: assert the regex shape of the auth URL constructed inline (`makeAuthUrl` is private, so test via `buildAuthFetchUrl` with a real dir containing a git remote). However since `makeAuthUrl` is not exported, the harness check should focus on the exported `buildAuthFetchUrl` contract. The S02 workspace tests already cover URL strip behavior with real bare repos.

**Alternative for M031-GIT-URL-CLEAN**: Instead of testing `buildAuthFetchUrl`, check a simpler invariant: `buildAgentEnv()` does not include `GITHUB_PRIVATE_KEY`, which is the credential the agent would need to authenticate via a stored key. The git URL token is verified by S02 unit tests. For S05 purposes, the check can be: `buildAgentEnv()` output does not contain any of the known application secrets.

**Recommendation:** Keep `M031-GIT-URL-CLEAN` as a separate structural check: call `buildAuthFetchUrl("", undefined)` (token-absent path returns `"origin"`, no URL needed), assert result equals `"origin"` and does not contain `x-access-token`. This exercises the exported function without needing a real git repo.

### `buildMentionPrompt` minimal invocation

S04 tests in `src/execution/mention-prompt.test.ts` demonstrate the minimal call. Expected required fields include `mentionBody`, `issueOrPrContext`, `repoContext`, etc. Use the same minimal params from the S04 test rather than re-reading the full signature.

Looking at the S04 test: the test calls `buildMentionPrompt({ mentionBody: "test mention" })` — need to verify the exact minimal shape at task time by reading the test file.

### package.json entry

The `verify:m031` script entry needs to be added:
```json
"verify:m031": "bun scripts/verify-m031.ts"
```

### `_fn` override pattern

Not needed for M031 — all five checks are pure-code and deterministic. No mocking needed in the test suite beyond a `process.env` snapshot for the env allowlist check (same `beforeEach`/`afterEach` pattern from `src/execution/env.test.ts`).

---

## Constraints

1. **`buildMentionPrompt` minimal params** — read `src/execution/mention-prompt.test.ts` at task time to clone the minimal call pattern rather than re-scanning the full function signature
2. **`buildAuthFetchUrl` with empty dir** — the undefined-token fast-return path (`return "origin"`) doesn't read the filesystem, so `""` works as dir. Confirm this at implementation time by reading the function body
3. **Process.env isolation** — `M031-ENV-ALLOWLIST` check must use `beforeEach`/`afterEach` env snapshot in the test suite (same pattern as `env.test.ts`)
4. **No DB or GitHub gate** — all five checks are pure-code; `overallPassed` is always the conjunction of all five, no skip semantics needed. The harness can still accept optional `sql` and `octokit` params for forward-compatibility, but no checks use them

---

## Recommendation

Single task: write both `scripts/verify-m031.ts` and `scripts/verify-m031.test.ts` and add the `package.json` entry. The harness is small and the test suite is mechanical. Estimated ~150 lines for the harness, ~200 lines for the test suite. Run `bun test scripts/verify-m031.test.ts` and `bun run verify:m031` to verify.

**Verification command:** `bun test scripts/verify-m031.test.ts && bun run verify:m031`
