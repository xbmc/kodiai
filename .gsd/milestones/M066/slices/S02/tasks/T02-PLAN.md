---
estimated_steps: 15
estimated_files: 3
skills_used:
  - test-driven-development
  - tdd
  - verify-before-complete
---

# T02: Parse formatter unified diffs into conservative file and hunk models

Use installed skills in task-plan frontmatter: `test-driven-development`, `tdd`, `verify-before-complete`.

Why: R082 depends on deterministic parsing of formatter output before any safe GitHub line mapping can happen. The existing `src/knowledge/code-snippet-chunker.ts` parser is intentionally insufficient because it drops file headers, deletions, old ranges, binary/rename state, and replacement blocks.

Steps:
1. Extend `src/execution/formatter-suggestions.test.ts` with RED fixture tests for one modified file/one hunk, multiple files and multiple hunks, hunk count defaults (`@@ -10 +10 @@` means count 1), blank added lines preservation, `\\ No newline at end of file` marker ignoring, and conservative skips for binary, added, deleted, renamed, and malformed diffs.
2. Run `bun test ./src/execution/formatter-suggestions.test.ts --timeout 30000` and confirm these parser tests fail for missing behavior.
3. Extend `src/execution/formatter-suggestions.ts` with exported diff model types (`FormatterDiffFile`, `FormatterDiffHunk`, `FormatterDiffLine`, `FormatterSuggestionSkipReason`) and `parseFormatterUnifiedDiff(diffText: string)` returning parsed files plus structured skipped entries.
4. Implement git unified-diff parsing for `diff --git`, `---`, `+++`, `/dev/null`, `@@ -old,count +new,count @@`, context lines, removed lines, added lines, and no-newline markers. Normalize payload paths by stripping `a/` and `b/` prefixes and skip unsupported file statuses rather than attempting partial mapping.
5. Re-run the targeted tests until all T01 and T02 assertions pass.

Must-haves:
- Parsed hunk line models retain prefix kind (`context`, `removed`, `added`), text without the prefix, and enough old/new cursor data for T03 changed-block mapping.
- File-level unsupported cases return visible skip reasons instead of silently disappearing.
- The parser never reads ignored fixtures; all fixture strings are inline in `src/execution/formatter-suggestions.test.ts`.

Failure Modes (Q5): dependency formatter stdout is malformed => parsed files may be empty and skipped entries identify `malformed-diff`; binary/rename/add/delete are unsupported => skipped with `unsupported-file`-style reasons; impossible hunk counts => skipped rather than guessed.

Load Profile (Q6): shared resources are memory/CPU while parsing diff text; per-operation cost is O(diff lines) with bounded object creation; 10x breakpoint is very large formatter output, so no recursive parsing and no dependency install.

Negative Tests (Q7): empty diff, malformed headers, malformed hunk ranges, binary diff, added file, deleted file, rename, no-newline marker, and blank added line preservation.

## Inputs

- `src/execution/formatter-suggestions.ts`
- `src/execution/formatter-suggestions.test.ts`
- `src/knowledge/code-snippet-chunker.ts`

## Expected Output

- `src/execution/formatter-suggestions.ts`
- `src/execution/formatter-suggestions.test.ts`

## Verification

bun test ./src/execution/formatter-suggestions.test.ts --timeout 30000

## Observability Impact

Adds structured parser skip reasons for malformed or unsupported formatter diff files so later orchestration can report why suggestions were not generated.
