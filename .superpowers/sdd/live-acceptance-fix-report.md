# Live Acceptance Fix Report

## Outcome

Implemented the live acceptance fix from base `cc849482e7` without deploying. The add-on model review now packs complete rendered prompts at no more than 22,000 characters and 120 added evidence lines, constrains structured findings to the eight contextual model rule IDs, explicitly excludes deterministic and generic Python-quality categories, and emits bounded preflight count telemetry.

Implementation commit: `f7987107e8dd672935f30c9c2a948b1766a728f9` (`fix: bound contextual addon review evidence`).

## TDD Evidence

### RED

Tests were added before production changes for:

- splitting at the 121st evidence line with order and uniqueness preserved;
- the exact 22,000-character and 120-line constants;
- both prompt and evidence-line bounds for the 53,089-character patch fixture;
- the exact eight-value schema enum and runtime allowlist;
- atomic rejection of a mixed result containing a generic rule;
- prompt delegation of deterministic categories and all required negative-scope examples;
- preflight prompt/line limits and per-chunk evidence-line counts without evidence text.

The first loading attempt exposed missing named exports, so the RED tests were adjusted to observe those missing contracts through assertions rather than module-load errors. The assertion-level RED command was:

```text
bun test src/lib/addon-rule-evidence.test.ts src/lib/addon-rule-llm.test.ts src/lib/addon-rule-review.test.ts
```

Result: `37 pass, 5 fail, 225 expect() calls`. Expected failures were:

1. 53,089-character chunks exceeded 120 evidence lines.
2. Preflight telemetry omitted `maxPromptChars`, `maxEvidenceLines`, and per-chunk line counts.
3. `MAX_ADDON_RULE_LLM_PROMPT_CHARS` was still 28,000 and no 120-line constant existed.
4. The exact contextual rule list/schema enum did not exist.
5. Runtime validation did not enforce the contextual rule allowlist.

### GREEN

After the minimal implementation and updates to existing expectations affected by the intended smaller chunks/exact enum, the same focused command produced:

```text
42 pass
0 fail
262 expect() calls
```

The final broader preservation run included the focused tests and produced `301 pass, 1 fail, 1704 expect() calls`; the only failure was the independently reproduced mention baseline described below.

## Implementation Details

- `MAX_ADDON_RULE_LLM_PROMPT_CHARS` is exactly `22_000`.
- `MAX_ADDON_RULE_LLM_EVIDENCE_LINES` is exactly `120`.
- `packAddonRuleEvidence` applies both limits to each candidate chunk. Metadata-only files add zero evidence lines, while added lines retain source order and appear once unless existing oversized file/line accounting omits them.
- `ADDON_RULE_REVIEW_SCHEMA` uses an enum containing exactly:
  - `filesystem-boundaries`
  - `download-consent`
  - `executable-execution`
  - `addon-modification`
  - `direct-database-access`
  - `skin-view-sort-mode`
  - `usage-analytics`
  - `obfuscation`
- Runtime domain validation uses the same exact list and retains atomic rejection, safe-string limits, and exact add-on/path/added-line validation.
- The prompt defines all eight IDs, delegates target branches, development artifacts, binaries, license naming/content, translation paths, `addon.xml` metadata/dependencies, and line endings to deterministic checks, and explicitly excludes the generic categories listed in the brief.
- The preflight log adds only numeric limits/count arrays: `maxPromptChars`, `maxEvidenceLines`, and `evidenceLinesPerChunk`. Tests confirm added-line evidence text is absent.
- Structured generation, OAuth/tool isolation, cost tracking, Haiku-to-one-Sonnet fallback, public formatting, deterministic findings, and incomplete-state aggregation were not changed.

## Verification

### Relevant structured/add-on/handler tests

```text
bun test src/llm/structured-generate.test.ts src/lib/addon-rule-*.test.ts src/lib/addon-check*.test.ts src/handlers/addon-check.test.ts src/handlers/mention.test.ts
```

Result: `301 pass, 1 fail, 1704 expect() calls` across 12 files. All structured-generation, add-on evidence/contract/review/deterministic/context/source/checker/formatter/classification, and add-on handler tests passed.

Known unrelated baseline failure:

```text
src/handlers/mention.test.ts
createMentionHandler conversational review wiring > conversational PR mentions are grounded with the pre-fetched PR diff
Expected capturedPrompt to contain "## PR Diff"
```

This is the independently reproduced mention baseline identified in the brief; none of the touched files are in that handler path.

### Scoped ESLint

```text
bunx eslint src/lib/addon-rule-evidence.ts src/lib/addon-rule-evidence.test.ts src/lib/addon-rule-llm.ts src/lib/addon-rule-llm.test.ts src/lib/addon-rule-review.ts src/lib/addon-rule-review.test.ts
```

Result: exit 0, no diagnostics.

### TypeScript

```text
bunx tsc --noEmit
```

Result: exit 2 with one unrelated baseline diagnostic and no touched-file diagnostics:

```text
src/jobs/aca-launcher.test.ts(344,70): error TS2493: Tuple type '[]' of length '0' has no element at index '0'.
```

### Bun build

```text
build_dir=$(mktemp -d /tmp/kodiai-addon-live-acceptance-build.XXXXXX) && bun build src/index.ts --outdir "$build_dir" --target bun
```

Result: exit 0; 832 modules bundled, producing a 5.85 MB `index.js` in the temporary directory.

### Diff hygiene

Before the implementation commit, `git diff --check` exited 0. After the report commit, the requested base-to-HEAD and worktree checks were rerun and recorded in the final handoff.

## Independent Review Fix: Chunk-Local Coordinates

Independent review found that each structured chunk was validated against all added coordinates in the PR. A model response could therefore cite a real added line from another chunk even though that line was absent from its prompt.

Fix commit: `ee76ac19504447cf1b7ad7a9742acf600691a2ca` (`fix: validate addon findings per evidence chunk`).

The validator now accepts an explicit evidence-coordinate allowlist. The original PR contexts remain authoritative for add-on/path metadata, while review orchestration passes only the current chunk for line-coordinate validation. The same chunk-local validator is supplied to the structured generator, so Haiku and the one Sonnet fallback share identical grounding. Direct compatibility callers continue to default to the complete projected input.

### Review-fix RED

```text
bun test src/lib/addon-rule-review.test.ts --test-name-pattern "atomically rejects a chunk"
```

Result before the fix: `0 pass, 1 fail`. The rejected chunk incorrectly returned both line 121 from its own evidence and line 1 from the first chunk, proving whole-PR coordinate validation.

### Review-fix GREEN and regressions

The same targeted command passed after the fix: `1 pass, 0 fail, 2 expect() calls`.

```text
bun test src/lib/addon-rule-evidence.test.ts src/lib/addon-rule-llm.test.ts src/lib/addon-rule-review.test.ts src/llm/structured-generate.test.ts
```

Result: `56 pass, 0 fail, 303 expect() calls`.

```text
bun test src/handlers/addon-check.test.ts
```

Result: `34 pass, 0 fail, 167 expect() calls`.

```text
bunx eslint src/lib/addon-rule-llm.ts src/lib/addon-rule-review.ts src/lib/addon-rule-review.test.ts
```

Result: exit 0, no diagnostics.

`bunx tsc --noEmit` continued to report only the unrelated `src/jobs/aca-launcher.test.ts(344,70)` TS2493 baseline. A fresh temporary-directory Bun build passed with 832 modules and a 5.85 MB bundle. `git diff --check` passed. No deployment was performed.

## Live Response Fix: Truthful Aggregate Summary

Live response `5018969400` exposed a contradiction: an early clean chunk's prose was concatenated into the aggregate Summary even though later chunks produced analytics findings. The public Findings/Verdict format was not changed.

Fix commit: `095c167690ebed2f9062deedb72ab85af5dc2d75` (`fix: derive addon summary from final findings`).

Complete multi-chunk summaries are now deterministic and derived from coverage plus the final deduplicated/bounded finding count; arbitrary chunk summaries are not concatenated. A finding-bearing single chunk uses the same deterministic sentence so its model prose cannot contradict its findings. A genuinely clean single chunk retains its validated model summary. Incomplete summaries retain their existing prepared/completed semantics. Deterministic aggregate summaries are bounded to 600 characters while preserving the finding-count suffix for complete reviews.

### Summary-fix RED

```text
bun test src/lib/addon-rule-review.test.ts --test-name-pattern "summarizes final findings|contradictory single-chunk"
```

Result before the fix: `0 pass, 2 fail, 4 expect() calls`.

- The multi-chunk Summary incorrectly contained `No contextual violations found.` before a later finding.
- The single-chunk Summary returned the same clean claim while retaining one finding.

A second RED case covered the hard 600-character contract for complete and incomplete aggregate summaries:

```text
bun test src/lib/addon-rule-review.test.ts --test-name-pattern "bounds deterministic complete and incomplete"
```

Result before the incomplete-summary bound: `0 pass, 1 fail`; the incomplete aggregate was 808 characters.

### Summary-fix GREEN and regressions

The contradiction command passed with `2 pass, 0 fail, 5 expect() calls`; the length-bound command passed with `1 pass, 0 fail, 2 expect() calls`.

```text
bun test src/lib/addon-rule-evidence.test.ts src/lib/addon-rule-llm.test.ts src/lib/addon-rule-review.test.ts src/llm/structured-generate.test.ts
```

Result: `59 pass, 0 fail, 310 expect() calls`.

```text
bun test src/handlers/addon-check.test.ts src/lib/addon-check-formatter.test.ts
```

Result: `41 pass, 0 fail, 188 expect() calls`.

Scoped ESLint exited 0. The temporary Bun build passed with 832 modules and a 5.85 MB bundle. `bunx tsc --noEmit` continued to report only the unrelated `src/jobs/aca-launcher.test.ts(344,70)` TS2493 baseline. `git diff --check` passed. No deployment was performed.

## Re-review Fix: Source-Scoped Complete Summaries

Re-review identified two remaining ambiguities: the deterministic count described only LLM findings but could be read as the total public Findings count after deterministic/checker merging, and a clean single chunk could still publish arbitrary model summary prose.

Fix commit: `b690f7f9c569a68022f281bd2e5b54e57533869a` (`fix: scope addon model summary counts`).

Every complete default model review now derives its Summary deterministically from coverage and the final bounded LLM finding count, for both single and multiple chunks. Positive counts explicitly say `model-backed contextual rule finding(s)`. Zero uses `Found no model-backed contextual rule findings.` Incomplete prepared/completed summaries and the 600-character bound are unchanged. Public Findings/Verdict formatting and later deterministic/checker merging are unchanged.

### Re-review RED

```text
bun test src/lib/addon-rule-review.test.ts --test-name-pattern "summarizes final findings|contradictory single-chunk|clean single-chunk model claim"
```

Result before the fix: `0 pass, 3 fail, 6 expect() calls`.

- Positive single- and multi-chunk counts said only `contextual rule finding`, without model-source scoping.
- A clean single chunk returned `Analytics violations found.` unchanged despite having zero findings.

### Re-review GREEN and regressions

The same targeted command passed with `3 pass, 0 fail, 8 expect() calls`.

```text
bun test src/lib/addon-rule-evidence.test.ts src/lib/addon-rule-llm.test.ts src/lib/addon-rule-review.test.ts src/llm/structured-generate.test.ts
```

Result: `60 pass, 0 fail, 313 expect() calls`.

```text
bun test src/handlers/addon-check.test.ts src/lib/addon-check-formatter.test.ts
```

Result: `41 pass, 0 fail, 188 expect() calls`.

Scoped ESLint exited 0. The temporary Bun build passed with 832 modules and a 5.85 MB bundle. `bunx tsc --noEmit` continued to report only the unrelated `src/jobs/aca-launcher.test.ts(344,70)` TS2493 baseline. `git diff --check` passed. No deployment was performed.

## Touched Files

- `src/lib/addon-rule-evidence.ts`
- `src/lib/addon-rule-evidence.test.ts`
- `src/lib/addon-rule-llm.ts`
- `src/lib/addon-rule-llm.test.ts`
- `src/lib/addon-rule-review.ts`
- `src/lib/addon-rule-review.test.ts`
- `.superpowers/sdd/live-acceptance-fix-report.md`

No deployment was performed.
