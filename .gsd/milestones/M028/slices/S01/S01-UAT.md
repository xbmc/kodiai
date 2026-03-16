# S01: Modification Artifact Contract Through Real Entry Points — UAT

**Milestone:** M028
**Written:** 2026-03-16

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: S01's proof is the modification-only contract, not a live publication event. The contract is fully verifiable by running tests, the verifier script, and TypeScript compilation — all produce machine-checkable pass/fail without requiring a running DB or GitHub connection.

## Preconditions

1. Working directory is `/home/keith/src/kodiai`
2. Bun is available (`bun --version`)
3. `DATABASE_URL` may or may not be set — the verifier handles both cases

## Smoke Test

```bash
bun run verify:m028:s01 --json
```

Expected: JSON output with `"overallPassed": true`. Pure-code checks `M028-S01-NO-WHY-IN-RENDER` and `M028-S01-PR-CITATIONS` must show `"passed": true, "skipped": false`. DB checks may show `"skipped": true` if the database is unreachable.

---

## Test Cases

### 1. Generator parser returns modification-only output

```bash
bun test src/knowledge/wiki-update-generator.test.ts
```

1. Run the command above.
2. **Expected:** 30 pass, 0 fail. The `parseModificationContent` describe block is present and all tests pass.

Specific assertions to verify manually if needed:
- `parseModificationContent("NO_UPDATE")` → `{ replacementContent: "", isNoUpdate: true }`
- `parseModificationContent("WHY: Reason.\n\nNew content (PR #1).")` → `{ replacementContent: "New content (PR #1).", isNoUpdate: false }` (no whySummary)
- `parseModificationContent("Updated wiki text (PR #27901).")` → `{ replacementContent: "Updated wiki text (PR #27901).", isNoUpdate: false }`
- Return object has no `whySummary` key

### 2. Publisher render output has no WHY: prose

```bash
bun test src/knowledge/wiki-publisher.test.ts
```

1. Run the command above.
2. **Expected:** 29 pass, 0 fail. The `does NOT include **Why:**` tests pass.

Specific negative guards to verify:
- `formatPageComment(group, "xbmc", "xbmc")` where group has `replacementContent` → output does NOT contain `**Why:**`
- Output does NOT contain `:warning:` even when `voiceMismatchWarning: true`
- Output DOES contain `https://github.com/xbmc/xbmc/pull/` PR citation links

### 3. Publisher render for page mode

1. In `bun test src/knowledge/wiki-publisher.test.ts`, confirm the `page mode renders stitched content without per-section ### headers` test passes.
2. **Expected:** Page mode renders the stitched `replacementContent` block without `### Introduction`-style headers injected by the formatter. PR citations are present. No `**Why:**`.

### 4. Summary table uses Modifications terminology

1. Verify `formatSummaryTable` tests pass.
2. **Expected:** Output contains `Wiki Modification Artifacts` and `**Modifications posted:**`. Output does NOT contain `Suggestions posted` or `Voice Warnings` column headers.

### 5. Verifier check IDs and envelope shape

```bash
bun test ./scripts/verify-m028-s01.test.ts
```

1. Run the command above.
2. **Expected:** 20 pass, 0 fail.

Confirm envelope from `evaluateM028S01`:
- `check_ids` has exactly 4 entries: `M028-S01-ARTIFACT-CONTRACT`, `M028-S01-NO-WHY-IN-RENDER`, `M028-S01-PR-CITATIONS`, `M028-S01-MODE-FIELD`
- `overallPassed` is `true` for clean fixtures
- `overallPassed` is `false` when a fixture contains `**Why:**`
- DB-gated checks report `skipped: true` when DATABASE_URL is absent

### 6. Verifier CLI runs without error

```bash
bun run verify:m028:s01 --json
```

1. Run the command above.
2. **Expected:** Exit code 0. JSON output printed with `"overallPassed": true`.
3. `M028-S01-NO-WHY-IN-RENDER` shows `"passed": true, "skipped": false, "status_code": "no_why_in_render"`
4. `M028-S01-PR-CITATIONS` shows `"passed": true, "skipped": false, "status_code": "pr_citations_present"`

### 7. TypeScript compilation clean on S01 target files

```bash
bunx tsc --noEmit 2>&1 | grep -E 'wiki-update|wiki-publisher|verify-m028|generate-wiki'
```

1. Run the command above.
2. **Expected:** No output — zero TypeScript errors in S01 target files.

### 8. DB migration files exist and are syntactically correct

```bash
ls src/db/migrations/030*
```

1. **Expected:** Two files:
   - `030-wiki-modification-artifacts.sql`
   - `030-wiki-modification-artifacts.down.sql`

```bash
grep modification_mode src/db/migrations/030-wiki-modification-artifacts.sql | wc -l
```

2. **Expected:** ≥ 3 matches (column definition, CHECK constraint, index definition).

### 9. Type contract fields present

```bash
grep -n 'modificationMode\|replacementContent\|whySummary' src/knowledge/wiki-update-types.ts
```

1. **Expected:** Lines showing:
   - `modificationMode: 'section' | 'page'`
   - `replacementContent: string`
   - `whySummary: string | null` (nullable)

---

## Edge Cases

### WHY: drift guard

1. Call `parseModificationContent("WHY: Some reason.\n\nActual content (PR #100).")` in a test context.
2. **Expected:** Returns `{ replacementContent: "Actual content (PR #100).", isNoUpdate: false }` — no `whySummary`, no `WHY:` in output.

### Page-mode at threshold

1. Inspect mode-selection logic in `processPage()`:
   - `sectionInputs.length < pageModeThreshold (default 3)` → `modificationMode = 'section'`
   - `sectionInputs.length >= pageModeThreshold` → `modificationMode = 'page'`
2. **Expected:** Mode is deterministic; logged at info level with `{ modificationMode, sectionsMatched, pageModeThreshold }`.

### Legacy rows without replacement_content

1. Dry-run publisher test `legacy fallback` creates a group where `replacementContent === suggestion`.
2. **Expected:** `formatPageComment` still renders correctly. No `**Why:**` line regardless.

### Verifier with contaminated content

1. Pass a group with `replacementContent: "**Why:** This needs updating.\n\nNew content."` to `evaluateM028S01`.
2. **Expected:** `M028-S01-NO-WHY-IN-RENDER` check fails with `status_code: "why_found_in_render"` and `overallPassed: false`.

---

## Failure Signals

- Any test in `wiki-update-generator.test.ts`, `wiki-publisher.test.ts`, or `verify-m028-s01.test.ts` failing
- `bun run verify:m028:s01 --json` exits non-zero
- TypeScript errors in S01 target files (`bunx tsc --noEmit | grep wiki-` produces output)
- `M028-S01-NO-WHY-IN-RENDER` check reporting `passed: false`
- `formatPageComment` output containing `**Why:**` or `:warning:`
- `parseModificationContent` return type having a `whySummary` property

---

## Requirements Proved By This UAT

- R025 — Wiki outputs are modification-only: `M028-S01-NO-WHY-IN-RENDER` machine-check + 30 generator tests prove no WHY:/suggestion prose on the main path
- R027 — Wiki modification artifacts support hybrid granularity: `M028-S01-MODE-FIELD` check + mode-selection tests prove explicit section/page scope is present, machine-inspectable, and deterministic

## Not Proven By This UAT

- Real DB storage (migration 030 applied to live Postgres) — requires live DB connection; DB checks report skipped in this environment
- Real LLM generation producing modification-only output end-to-end — requires ANTHROPIC_API_KEY and a running pipeline; `buildGroundedSectionPrompt` still uses WHY: instruction (drift guard strips it, but prompt update is deferred)
- Live GitHub comment formatting — dry-run render is proven; live post to `xbmc/wiki` is S03 scope
- Supersession of existing suggestion-style comments — S02 scope
- Regression guards against re-introduction of WHY: in live published comments — S04 scope

## Notes for Tester

- All UAT checks are automated; no browser or manual GitHub interaction required for S01.
- The `bun test ./scripts/verify-m028-s01.test.ts` invocation requires the `./` prefix — `bun test scripts/verify-m028-s01.test.ts` (without `./`) will fail to find the file due to bun's test-file naming heuristics.
- 53 pre-existing TypeScript errors in unrelated M027 files (embedding-repair, retrieval, audit scripts) are expected and out of scope. Only S01 target files must be error-free.
- The `parseGeneratedSuggestion` function is deprecated but kept for backward compatibility; its tests are retained intentionally and should continue to pass.
