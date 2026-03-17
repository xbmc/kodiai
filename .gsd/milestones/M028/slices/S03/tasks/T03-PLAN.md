---
estimated_steps: 8
estimated_files: 3
---

# T03: S03 Proof Harness

**Slice:** S03 — Live Modification-Only Wiki Publishing
**Milestone:** M028

## Description

Build `scripts/verify-m028-s03.ts` — the machine-checkable proof harness for S03. This follows the exact same pattern as `verify-m028-s01.ts` and `verify-m028-s02.ts`: exported check IDs array, exported `evaluateM028S03()` function, exported `buildM028S03ProofHarness()` function, and a CLI runner.

**Four checks:**

| Check ID | Type | Passes when |
|---|---|---|
| `M028-S03-NO-WHY-IN-RENDER` | pure-code | `formatPageComment()` output does not contain `"**Why:**"` or `":warning:"` |
| `M028-S03-LIVE-MARKER` | DB-gated | At least one published row has `published_comment_id > 0` |
| `M028-S03-COMMENT-BODY` | GitHub-gated | At least one comment on the issue has the marker AND no `**Why:**` |
| `M028-S03-SENTINEL-CLEARED` | DB-gated, informational | Always passes; reports count of sentinel (`published_comment_id = 0`) rows as detail |

**Key constraint:** `SENTINEL-CLEARED` is **always `passed: true`** — it is an informational reporter, not a gate. The `overallPassed` of the harness is true when all non-skipped, non-informational checks pass. `SENTINEL-CLEARED` never contributes to a fail verdict.

**GitHub-gated check pattern:** `M028-S03-COMMENT-BODY` requires an `octokit` instance, `owner`, `repo`, and `issueNumber`. When the CLI is run without GitHub credentials, these are absent and the check reports `skipped: true, status_code: "github_unavailable"`. The check does NOT make it a pass or fail — just skipped (same pattern as DB-gated checks).

**Model after S02 harness** — copy the envelope shape, check interface, sequential SQL stub test helper, and `createSilentLogger()` call. Do not re-import from S02 — replicate the minimal helpers inline.

## Steps

1. **Write `scripts/verify-m028-s03.ts`**: implement the following structure:

   ```typescript
   export const M028_S03_CHECK_IDS = [
     "M028-S03-NO-WHY-IN-RENDER",
     "M028-S03-LIVE-MARKER",
     "M028-S03-COMMENT-BODY",
     "M028-S03-SENTINEL-CLEARED",
   ] as const;

   export type M028S03CheckId = (typeof M028_S03_CHECK_IDS)[number];

   export type M028S03Check = {
     id: M028S03CheckId;
     passed: boolean;
     skipped: boolean;
     status_code: string;
     detail?: string;
   };

   export type M028S03EvaluationReport = {
     check_ids: readonly string[];
     overallPassed: boolean;
     checks: M028S03Check[];
   };
   ```

2. **Implement `checkNoWhyInRender()`** (pure-code): import `formatPageComment` from `"../src/knowledge/wiki-publisher.ts"` and `PageSuggestionGroup` type from `"../src/knowledge/wiki-publisher-types.ts"`. Build a minimal mock group (page_id=1, pageTitle="Test Page", modificationMode="section", one suggestion with `replacementContent="Wiki text here."`, `citingPrs=[]`). Call `formatPageComment(group, "xbmc", "xbmc")`. Assert result does NOT include `"**Why:**"` and NOT include `":warning:"`. Return `passed: true, status_code: "no_why_in_render"` or `passed: false, status_code: "why_found"` with the offending snippet in `detail`.

3. **Implement `checkLiveMarker(sql?)`** (DB-gated): query `SELECT COUNT(*)::int AS cnt FROM wiki_update_suggestions WHERE published_at IS NOT NULL AND published_comment_id > 0`. When `sql` absent or DB unreachable, return `skipped: true, status_code: "db_unavailable"`. When count > 0, return `passed: true, status_code: "real_ids_found", detail: "count=N"`. When count = 0, return `passed: false, status_code: "no_real_ids"`.

4. **Implement `checkCommentBody(octokit?, owner?, repo?, issueNumber?)`** (GitHub-gated): when any arg absent, return `skipped: true, status_code: "github_unavailable"`. Otherwise: fetch up to 3 pages of issue comments (`per_page=100, sort=created, direction=desc`). For each comment, check if it includes a `<!-- kodiai:wiki-modification:` marker AND does NOT include `"**Why:**"`. If at least one such clean-marker comment is found, return `passed: true, status_code: "modification_comment_found"`. If no comment has the marker, return `passed: false, status_code: "no_marker_found"`. If a comment has the marker but also has `**Why:**`, return `passed: false, status_code: "why_in_marker_comment"`. Wrap in try/catch; on any GitHub error return `skipped: true, status_code: "github_unavailable"`.

5. **Implement `checkSentinelCleared(sql?)`** (DB-gated, informational): query `SELECT COUNT(*)::int AS cnt FROM wiki_update_suggestions WHERE published_at IS NOT NULL AND published_comment_id = 0`. When DB absent/unreachable, return `passed: true, skipped: false, status_code: "db_unavailable", detail: "count unknown"`. Otherwise always `passed: true, status_code: "sentinel_count", detail: "sentinel_rows=N"`.

6. **Implement `evaluateM028S03(sql?, octokit?, owner?, repo?, issueNumber?)`**: run all four checks (in parallel via `Promise.all`). `overallPassed` is `true` when all non-skipped checks have `passed: true`. `SENTINEL-CLEARED` is treated as always-passing — explicitly never contributes to `overallPassed: false`. Use `checks.filter(c => !c.skipped && c.id !== "M028-S03-SENTINEL-CLEARED").every(c => c.passed)` logic.

7. **Implement `buildM028S03ProofHarness(opts?)`** and CLI runner: follow the exact S02 pattern — accept `{ json?: boolean }`, create logger, call `evaluateM028S03()`, log results, exit 0 on pass, exit 1 on fail. When `--json` flag given, print the `M028S03EvaluationReport` as JSON.

8. **Write `scripts/verify-m028-s03.test.ts`**: cover:
   - Check IDs: `M028_S03_CHECK_IDS.length === 4` and includes all four IDs
   - Envelope shape: `evaluateM028S03()` returns `{ check_ids, overallPassed, checks }`
   - `NO-WHY-IN-RENDER` pass: mock group renders clean → `passed: true, status_code: "no_why_in_render"`
   - `NO-WHY-IN-RENDER` fail: inject a mock `formatPageComment` that returns `"**Why:** reason"` → `passed: false, status_code: "why_found"`
   - `LIVE-MARKER` skip: no SQL → `skipped: true, status_code: "db_unavailable"`
   - `LIVE-MARKER` pass: SQL stub returns count=3 → `passed: true, status_code: "real_ids_found"`
   - `LIVE-MARKER` fail: SQL stub returns count=0 → `passed: false, status_code: "no_real_ids"`
   - `SENTINEL-CLEARED` always passes: SQL stub returns count=21 → `passed: true, status_code: "sentinel_count", detail includes "21"`
   - `SENTINEL-CLEARED` always passes even when DB absent: no SQL → `passed: true`
   - `overallPassed` is false when `LIVE-MARKER` fails (even if `SENTINEL-CLEARED` passes)
   - `overallPassed` is true when both non-informational checks pass and GitHub check is skipped

9. **Add package.json alias**: `"verify:m028:s03": "bun scripts/verify-m028-s03.ts"`

## Must-Haves

- [ ] `M028_S03_CHECK_IDS`, `evaluateM028S03`, `buildM028S03ProofHarness` are named exports
- [ ] `NO-WHY-IN-RENDER` is always run (pure-code, no DB or GitHub needed)
- [ ] `LIVE-MARKER` and `SENTINEL-CLEARED` are DB-gated — skip with `db_unavailable` when DB absent
- [ ] `COMMENT-BODY` is GitHub-gated — skip with `github_unavailable` when octokit/args absent
- [ ] `SENTINEL-CLEARED` is always `passed: true` — it never contributes to `overallPassed: false`
- [ ] Test suite passes (all pure-code + stub-based tests)
- [ ] `bun run verify:m028:s03 --json` exits 0 with `overallPassed: true` in this environment (DB connected, T02 complete)
- [ ] Zero TypeScript errors on new files

## Verification

```bash
bun test ./scripts/verify-m028-s03.test.ts
# → all pass

bun run verify:m028:s03 --json
# → { overallPassed: true, checks: [...] }
# NO-WHY-IN-RENDER: passed, LIVE-MARKER: passed (after T02 run), SENTINEL-CLEARED: passed

bunx tsc --noEmit 2>&1 | grep verify-m028-s03
# → (no output)
```

## Observability Impact

- Signals added: `bun run verify:m028:s03 --json` — primary post-publish readiness signal for S03
- How a future agent inspects this: look for `M028-S03-LIVE-MARKER: { passed: false, status_code: "no_real_ids" }` to detect that the live publish hasn't run yet; `COMMENT-BODY: { status_code: "no_marker_found" }` to detect comments were posted without the identity marker
- Failure state exposed: `no_real_ids` (live publish didn't write comment IDs); `why_found` (render regression); `why_in_marker_comment` (modification comment contaminated with rationale prose)

## Inputs

- `scripts/verify-m028-s02.ts` — reference implementation for the harness pattern (check IDs, envelope, SQL stub pattern, CLI runner)
- `src/knowledge/wiki-publisher.ts` — `formatPageComment` export for `NO-WHY-IN-RENDER` check
- `src/knowledge/wiki-publisher-types.ts` — `PageSuggestionGroup` type for mock construction
- DB state after T02: at least one row with `published_comment_id > 0` (makes `LIVE-MARKER` pass)

## Expected Output

- `scripts/verify-m028-s03.ts` — new: 4-check harness with all exports
- `scripts/verify-m028-s03.test.ts` — new: test suite covering all check paths
- `package.json` — `verify:m028:s03` alias added
