# M029 Roadmap - Wiki Generation Quality & Issue Cleanup

**Status:** Complete
**Milestone goal:** The generation pipeline produces substantive wiki replacement text (not reasoning prose), the page-selection filter eliminates irrelevant PR evidence, xbmc/wiki issue #5 is cleaned up, and a machine-verifiable proof harness confirms the assembled system.

---

## Decomposition Reasoning

M029 has four independent-but-ordered layers of work:

1. **Prompt fix + content filter** — these are the correctness contract. The prompt fix reduces reasoning-prose frequency; the content filter is the deterministic gate. Both land together because the filter is the only reliable enforcement regardless of how good the prompt is. Tests prove the contract immediately.

2. **Heuristic score threshold** — this is the relevance gate at page-selection time. It's one-line SQL change plus a mock-SQL test, and it prevents the pipeline from targeting irrelevant pages. It can ship independently of the prompt fix, but it needs to be in place before re-generation.

3. **Issue cleanup script** — a one-time destructive GitHub operation that deletes garbage comments from xbmc/wiki issue #5. It needs to be separate, dry-run-safe, and ready before re-generation so the re-generation can post to a clean issue.

4. **Re-generation, re-publication, proof harness** — the integration proof that the assembled system (prompt fix + filter + threshold + clean issue) produces and publishes quality content. Follows the M027/M028 pattern of a machine-verifiable JSON harness.

**Risk ordering:** The prompt fix + content filter are the hardest thing to get right — the filter's pattern list determines what gets rejected, and getting it wrong (too aggressive or too lenient) has downstream consequences. This lands first. The heuristic threshold and cleanup script are mechanically simple. The proof harness builds on all three.

The four slices are not merged into fewer because S01 tests are standalone unit tests with no DB/GitHub dependency, S02 requires a mock SQL layer, S03 requires live GitHub auth, and S04 requires live DB + LLM + GitHub. Keeping them separate lets each slice execute and verify independently.

---

## Slices

### S01 — Prompt Fix + Content Filter

- [x] **S01** | risk: high | depends: []

**What ships:** `buildVoicePreservingPrompt` gains an explicit `## Output Contract` section banning reasoning starters ("I'll", "Let me", "I will", "Looking at", "I need to"). `isReasoningProse(text: string): boolean` is added as an exported function in `wiki-voice-validator.ts`, pattern-matching on these starters. `generateWithVoicePreservation` calls `isReasoningProse` before the voice validation step and drops the suggestion when it returns true (logging a warning). Unit tests cover: reasoning text → rejected; real wiki content with PR citation → accepted; edge cases (empty string, mixed content that starts clean but is mostly reasoning).

**Demo:** `bun test src/knowledge/wiki-voice-validator.test.ts src/knowledge/wiki-voice-analyzer.test.ts` passes with new tests for `isReasoningProse`, and a test that feeds "I'll analyze the evidence from PR #27909" through the pipeline and verifies it is dropped. A second test feeds valid MediaWiki section content and verifies it is accepted. A third test asserts that `buildVoicePreservingPrompt` output contains the string "do not explain" (or equivalent prohibition phrase).

**Proof strategy:** Pure unit tests, no DB or LLM required. Tests are deterministic — `isReasoningProse` is pattern-based.

**Verification class:** Unit tests (deterministic, no external deps)

---

### S02 — Heuristic Score Threshold in Page Selection

- [x] **S02** | risk: low | depends: [S01]

**What ships:** The page-selection query in `createUpdateGenerator` gains `AND wpe.heuristic_score >= 3` (the "High" threshold from the staleness detector). `MIN_HEURISTIC_SCORE` is extracted as a named constant at the top of the file alongside the existing `MIN_OVERLAP_SCORE`. The existing test for `matchPatchesToSection` sorting behavior is extended with a test that verifies the SQL query would filter rows with `heuristic_score < 3`.

**Demo:** `bun test src/knowledge/wiki-update-generator.test.ts` passes with a new test asserting that a mock SQL call to the page-selection query includes `heuristic_score >= 3` in its parameters (via mock SQL stub, same pattern as M028 tests).

**Proof strategy:** Mock SQL tests. The constant value (3) is checked in a dedicated test so any accidental regression is caught immediately.

**Verification class:** Unit tests with mock SQL

---

### S03 — Issue Cleanup Script

- [x] **S03** | risk: low | depends: [S01, S02]

**What ships:** `scripts/cleanup-wiki-issue.ts` — a new one-time operational script that deletes comments from a GitHub issue by marker scan. Dry-run mode (default) lists which comments would be deleted; `--no-dry-run` executes deletions. Auth follows the `cleanup-legacy-branches.ts` pattern exactly (`getInstallationOctokit`). Deletion targets are identified by marker presence (`<!-- kodiai:wiki-modification:NNN -->`) and/or a flag `--delete-all` for non-marker comments (for cleaning up the garbage reasoning-prose comments). Script is safe by default: dry-run unless explicitly opted out.

```
bun scripts/cleanup-wiki-issue.ts --owner xbmc --repo wiki --issue-number 5 --dry-run
bun scripts/cleanup-wiki-issue.ts --owner xbmc --repo wiki --issue-number 5 --no-dry-run
```

**Demo:** Running the dry-run command prints a list of comment IDs that would be deleted from issue #5 without mutating GitHub state. Running `--no-dry-run` produces a summary showing comments deleted vs. errors. The output is structured (JSON or plain text table) so it can be audited.

**Proof strategy:** Dry-run mode can be validated without GitHub auth. Live `--no-dry-run` requires real credentials — executed manually as part of S04 integration.

**Verification class:** Manual execution (dry-run verifiable without live GitHub; delete requires live run)

---

### S04 — Re-generation, Re-publication & Proof Harness

- [x] **S04** | risk: medium | depends: [S01, S02, S03]

**What ships:** 
1. DB cleanup: run SQL to delete stale/garbage `wiki_update_suggestions` rows (those with reasoning prose in the `suggestion` column, identified by the same `isReasoningProse` patterns).
2. Re-generation: `bun scripts/generate-wiki-updates.ts` run with the fixed prompt + content filter + heuristic threshold active.
3. Cleanup: `scripts/cleanup-wiki-issue.ts --no-dry-run` deletes garbage comments from issue #5.
4. Re-publication: `bun scripts/publish-wiki-updates.ts --issue-number 5` posts high-quality suggestions.
5. Proof harness: `scripts/verify-m029-s04.ts` with these checks:
   - **NO-REASONING-IN-DB** — query `wiki_update_suggestions` where `suggestion ~* '^(I''ll|Let me|I will|I need to|Looking at)'`; count must be 0. Skips when DB unavailable.
   - **PROMPT-BANS-META** — call `buildVoicePreservingPrompt` with minimal inputs; assert output contains the output-contract prohibition phrase. Always runs.
   - **CONTENT-FILTER-REJECTS** — call `isReasoningProse("I'll analyze the evidence from PR #27909")`; assert returns true. Always runs.
   - **LIVE-PUBLISHED** — query `wiki_update_suggestions` where `published_at IS NOT NULL`; count must be > 0. Skips when DB unavailable.
   - **ISSUE-CLEAN** — GitHub API call to list comments on issue #5; assert zero comments lack the `<!-- kodiai:wiki-modification: -->` marker (i.e., all non-summary-table comments are properly marked modification comments). Skips when GitHub auth unavailable.

`bun run verify:m029:s04 --json` exits 0 with `overallPassed: true`.

**Demo:** After executing the re-generation + cleanup + publish sequence, `bun run verify:m029:s04 --json` prints a 5-check report with all checks passing. A human visiting xbmc/wiki issue #5 sees only the summary table plus modification-only comments containing actual wiki replacement text with PR citations.

**Proof strategy:** Mixed — 2 pure-code checks (always run), 2 DB-gated (skip gracefully), 1 GitHub-gated (skip gracefully). Pattern matches M028/S04 exactly.

**Verification class:** Integration proof harness (live DB + GitHub required for full pass; pure-code checks always pass)

---

## Requirement Coverage

| Req | Class | Current Status | M029 Treatment |
|-----|-------|---------------|----------------|
| R025 | correctness | validated | Re-validated: content filter ensures generated suggestions are actual wiki text, not reasoning prose. S01 tightens the enforcement that R025 assumed was working but wasn't. |
| R026 | correctness | validated | Re-validated: issue cleanup (S03+S04) ensures published comments are modification-only replacement text. Garbage reasoning comments are deleted before re-publish. |
| R033 | correctness | new | **Primary owner: S01.** Generation output is pattern-verified before storage — `isReasoningProse` rejects suggestions identified as reasoning/analysis prose. |
| R034 | correctness | new | **Primary owner: S02.** Page selection enforces minimum evidence quality threshold — `heuristic_score >= 3` added to the page-selection query. |

**New requirements R033 and R034 are introduced by this milestone.** Both address observable correctness gaps in the existing pipeline that R025/R026 assumed were handled but were not.

**Coverage summary:**
- Active requirements mapped: 2 (R033 → S01, R034 → S02)
- Re-validated requirements: 2 (R025 via S01+S04, R026 via S03+S04)
- No active requirements orphaned

---

## Boundary Map

| Boundary | Touched in | Notes |
|----------|-----------|-------|
| `src/knowledge/wiki-voice-validator.ts` | S01 | Add `isReasoningProse()`, call it in `generateWithVoicePreservation()` |
| `src/knowledge/wiki-voice-analyzer.ts` | S01 | Add `## Output Contract` section to `buildVoicePreservingPrompt()` |
| `src/knowledge/wiki-update-generator.ts` | S02 | Add `MIN_HEURISTIC_SCORE = 3` constant; add `AND wpe.heuristic_score >= 3` to page-selection query |
| `scripts/cleanup-wiki-issue.ts` | S03 | New script — GitHub App auth, scan-then-delete, dry-run safe |
| `scripts/verify-m029-s04.ts` | S04 | New proof harness — 5-check M028-pattern JSON verifier |
| `package.json` | S04 | Add `verify:m029:s04` script entry |
| `wiki_update_suggestions` table | S04 | DB cleanup of reasoning-prose rows before re-generation |
| xbmc/wiki issue #5 | S03+S04 | GitHub comment deletion + re-publication |
| Test files | S01, S02 | Additive tests only; no existing tests modified |

---

## Definition of Done

M029 is complete when:

1. `bun test src/knowledge/wiki-voice-validator.test.ts` passes with `isReasoningProse` tests — reasoning text rejected, wiki content accepted.
2. `bun test src/knowledge/wiki-voice-analyzer.test.ts` passes with prompt output-contract test.
3. `bun test src/knowledge/wiki-update-generator.test.ts` passes with heuristic-score threshold test.
4. `bun run verify:m029:s04 --json` exits 0 with `overallPassed: true` and all non-skipped checks passing.
5. xbmc/wiki issue #5 contains only: the summary table comment + modification-only comments with `<!-- kodiai:wiki-modification:NNN -->` markers and actual wiki replacement text.
6. No stored suggestion in `wiki_update_suggestions` where `published_at IS NOT NULL` begins with or primarily contains `I'll`, `Let me`, `I need to`, `I will`, or `Looking at`.
