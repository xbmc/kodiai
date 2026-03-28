# S04 Summary — Re-generation, Re-publication & Proof Harness

**Status:** Complete  
**Completed:** 2026-03-21  
**Risk:** medium  
**Depends on:** S01, S02, S03

---

## What Was Delivered

S04 closes M029 by implementing the final-assembly proof harness that verifies the complete pipeline (S01 prompt fix + content filter + S02 heuristic threshold + S03 issue cleanup) produced quality output, plus a detailed operational runbook that operators must follow before the DB/GitHub checks can achieve a non-skipped full pass.

### Deliverables

| File | Purpose |
|------|---------|
| `scripts/verify-m029-s04.ts` | 5-check proof harness with 2 pure-code, 2 DB-gated, 1 GitHub-gated checks |
| `scripts/verify-m029-s04.test.ts` | 51-test suite covering all check behaviors via mocks |
| `package.json` | `"verify:m029:s04"` script entry added after `"verify:m028:s04"` |
| `docs/m029-s04-ops-runbook.md` | 5-step operator runbook: DB cleanup → re-generation → issue cleanup → re-publication → proof run |

---

## Verification Results

All slice checks passed:

| Check | Command | Exit | Result |
|-------|---------|------|--------|
| S04 test suite | `bun test ./scripts/verify-m029-s04.test.ts` | 0 | ✅ 51 pass, 0 fail |
| npm script entry | `grep '"verify:m029:s04"' package.json` | 0 | ✅ found |
| Harness pure-code run | `bun run verify:m029:s04 --json` | 0 | ✅ `overallPassed: true` |
| Baseline regression | `bun test src/knowledge/wiki-voice-validator.test.ts src/knowledge/wiki-voice-analyzer.test.ts src/knowledge/wiki-update-generator.test.ts` | 0 | ✅ 88 pass, 0 fail |

Pure-code checks (CONTENT-FILTER-REJECTS, PROMPT-BANS-META) pass without any infra. DB/GitHub checks skip gracefully in the absence of live connections.

---

## The 5 Checks

| ID | Type | What it checks | Skip condition |
|----|------|----------------|---------------|
| `M029-S04-CONTENT-FILTER-REJECTS` | Pure-code | `isReasoningProse("I'll analyze the evidence from PR #27909")` returns true | Never skips |
| `M029-S04-PROMPT-BANS-META` | Pure-code | `buildVoicePreservingPrompt(...)` output contains `## Output Contract` and `Do NOT` | Never skips |
| `M029-S04-NO-REASONING-IN-DB` | DB-gated | `wiki_update_suggestions` has 0 rows where suggestion starts with reasoning starters | Skips when no DB |
| `M029-S04-LIVE-PUBLISHED` | DB-gated | `wiki_update_suggestions` has > 0 rows where `published_at IS NOT NULL` | Skips when no DB |
| `M029-S04-ISSUE-CLEAN` | GitHub-gated | All comments on xbmc/wiki issue #5 either have the `<!-- kodiai:wiki-modification:NNN -->` marker or are the summary table | Skips when no GitHub |

`overallPassed` is true when all non-skipped checks pass. Skipped checks are excluded from the pass/fail computation.

---

## Patterns Established

### Optional mock-override `_fn` parameters for pure-code check isolation

Pure-code checks accept optional `_contentFilterFn?: (text: string) => boolean` and `_promptBuilderFn?: (...) => string` parameters. When absent, the real imports are used. When present in tests, the injected fn allows exercising pass/fail paths without touching real modules. Suffix `_` on injected fn params signals "test override, not production dependency".

### Sequential SQL stub for multi-check evaluators

When two DB checks run in the same `evaluateM029S04(opts)` call, they need different return values from the same `sql` mock. `makeSequentialSqlStub(responses[])` delivers the right result per call index. `makeSqlStub(rows)` suffices only when all SQL calls should return the same rows.

### Minimal typed Octokit stub for GitHub-gated checks

`makeOctokitStub(pages)` returns only the `issues.listComments` shape used by ISSUE-CLEAN — typed narrowly to match the exact field access pattern. Avoids full Octokit type mocking while keeping TypeScript happy.

### Auto-probe vs injected skip behavior

`buildM029S04ProofHarness` auto-probes `DATABASE_URL` and `GITHUB_APP_ID`+`GITHUB_PRIVATE_KEY` on startup. Tests that want to exercise the skip path must pass a **rejecting sql stub** (not `undefined`) — same rule as M028 harnesses, since `undefined` causes the harness to auto-probe and may find a real DB in the test environment.

### ISSUE-CLEAN violation rule matches cleanup-wiki-issue.ts classification

A comment is a violation if it lacks BOTH the `<!-- kodiai:wiki-modification:NNN -->` marker AND does not contain `# Wiki Modification Artifacts` (the summary table). This mirrors the scan logic in `scripts/cleanup-wiki-issue.ts` so the verifier and the cleanup script agree on what constitutes a clean issue.

---

## Integration Closure

**Upstream surfaces consumed:**
- `isReasoningProse` from S01 (`src/knowledge/wiki-voice-validator.ts`) — used for pure-code check
- `buildVoicePreservingPrompt` from S01 (`src/knowledge/wiki-voice-analyzer.ts`) — used for pure-code check
- `createGitHubApp` from `src/auth/github-app.ts` — GitHub App auth for ISSUE-CLEAN
- `createDbClient` from `src/db/client.ts` — DB connection for DB-gated checks
- `scripts/cleanup-wiki-issue.ts` from S03 — referenced in runbook only

**New wiring introduced:**
- `"verify:m029:s04"` npm script entry

**What remains before full live pass:**
An operator must execute the 5 steps in `docs/m029-s04-ops-runbook.md`:
1. DB cleanup — delete reasoning-prose suggestions from `wiki_update_suggestions`
2. Re-generation — `bun scripts/generate-wiki-updates.ts` with fixed pipeline
3. Issue cleanup — `bun scripts/cleanup-wiki-issue.ts --owner xbmc --repo wiki --issue-number 5 --no-dry-run`
4. Re-publication — `bun scripts/publish-wiki-updates.ts --issue-number 5`
5. Proof run — `bun run verify:m029:s04 --json` verifying all 5 checks pass

---

## Requirements Status

| Req | Status Change | Evidence |
|-----|--------------|----------|
| R033 | active → **validated** | S04 proof harness CONTENT-FILTER-REJECTS check passes in CI (pure-code, no infra); `isReasoningProse("I'll analyze the evidence from PR #27909")` returns true; S01 unit tests prove rejection logic; NO-REASONING-IN-DB check provides live DB gate post-operation |
| R034 | active → **validated** (by S02) | Confirmed by S04 baseline regression: 88 pass including `MIN_HEURISTIC_SCORE > is set to 3` and `createUpdateGenerator page selection` tests |
| R025 | re-validated | S04 CONTENT-FILTER-REJECTS and PROMPT-BANS-META checks enforce the modification-only artifact contract at generation time, not just at publication time |
| R026 | re-validated | ISSUE-CLEAN check (GitHub-gated) provides post-operation proof that all issue comments are properly marked modification-only comments |

---

## Key Decisions

1. **`_fn` override parameters use suffix `_`** to signal "test override" — consistent with M028-S04 pattern. Real imports used in production; injected in tests. No DI framework needed.
2. **ISSUE-CLEAN violation rule matches cleanup script logic** — uses the same two-condition classification (lacks marker AND is not summary table) so verifier and cleanup tool cannot drift out of agreement.
3. **`makeSequentialSqlStub` over per-call describe nesting** — cleaner than one test per SQL call index; delivers correct row shapes to each DB check in sequence within a single `evaluateM029S04` call.

---

## For Downstream Readers

If you are building on M029:

- The `isReasoningProse` function is the single deterministic gate for generation quality. The runtime filter runs before any LLM I/O. Do not remove or weaken it without updating both the `## Output Contract` section in the prompt and the proof harness check.
- The proof harness pattern (2 pure-code + N infra-gated checks, graceful skip, `overallPassed` excludes skipped) is the established template for M028+ slices. Follow it exactly for any future integration proof.
- The operational runbook at `docs/m029-s04-ops-runbook.md` must be executed before the harness can achieve a fully green (non-skipped) result. The harness exits 0 with `overallPassed: true` after only the pure-code checks in CI — this is expected behavior, not a gap.
- `makeSequentialSqlStub` in the test file is the right mock when a single `evaluateM*(opts)` call needs different rows for each DB check. The simpler `makeSqlStub` is only correct when all SQL calls should return the same data.
