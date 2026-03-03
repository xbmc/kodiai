---
phase: 16-parse-windows-package-lists-and-harden-p
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/depends-bump-enrichment.ts
  - src/lib/depends-bump-enrichment.test.ts
  - src/handlers/review.ts
autonomous: true
requirements: [WINLIST-01, HARDEN-01]

must_haves:
  truths:
    - "Windows [depends] bumps with only .list file diffs (no VERSION file) extract old/new versions from package archive names"
    - "Pipeline posts structured depends comment even when all enrichment data is partial (no VERSION file, changelog unavailable)"
    - "Existing VERSION-file-based enrichment continues to work unchanged"
  artifacts:
    - path: "src/lib/depends-bump-enrichment.ts"
      provides: "parsePackageListDiff() function"
      exports: ["parsePackageListDiff"]
    - path: "src/lib/depends-bump-enrichment.test.ts"
      provides: "Tests for parsePackageListDiff"
      contains: "parsePackageListDiff"
    - path: "src/handlers/review.ts"
      provides: "Fallback to .list file parsing when no VERSION file found"
  key_links:
    - from: "src/handlers/review.ts"
      to: "src/lib/depends-bump-enrichment.ts"
      via: "parsePackageListDiff import and fallback call"
      pattern: "parsePackageListDiff"
---

<objective>
Parse Windows package list diffs to extract version information, and harden the [depends] pipeline to always post a structured review comment even when enrichment is partial.

Purpose: Windows [depends] bumps (e.g., `[Windows] Bump zlib to 1.3.2`) often have no VERSION file -- they only modify `0_package.target-*.list` files containing lines like `zlib-1.3.1-x64-v143-20260216.7z` changed to `zlib-1.3.2-x64-v143-20260301.7z`. Currently the pipeline finds no VERSION file, gets all-null enrichment, and the structured comment has no version diff data. Additionally, when all enrichment is null/empty, the pipeline should still post the comment with whatever it has.

Output: Updated enrichment module with .list parser, updated review handler with fallback logic.
</objective>

<execution_context>
@/home/keith/.claude/get-shit-done/workflows/execute-plan.md
@/home/keith/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/lib/depends-bump-enrichment.ts
@src/lib/depends-bump-enrichment.test.ts
@src/lib/depends-bump-detector.ts
@src/lib/depends-review-builder.ts
@src/handlers/review.ts (lines 1980-2175 — the [depends] pipeline section)
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add parsePackageListDiff to depends-bump-enrichment</name>
  <files>src/lib/depends-bump-enrichment.ts, src/lib/depends-bump-enrichment.test.ts</files>
  <behavior>
    - parsePackageListDiff extracts old/new versions from unified diffs of .list files
    - Input: unified diff patch string of a `0_package.target-*.list` file
    - Output: Array of `{ name: string, oldVersion: string | null, newVersion: string | null }`
    - Pattern: lines like `-zlib-1.3.1-x64-v143-20260216.7z` / `+zlib-1.3.2-x64-v143-20260301.7z` — parse `name-version-arch-compiler-date.7z`
    - Handles multi-package .list diffs (multiple packages changed in one file)
    - Handles added-only lines (new package, no old version) and removed-only lines (removed package, no new version)
    - Returns empty array for non-.list diffs or unparseable content
    - Package name segments before version are joined with hyphens (e.g., `libjpeg-turbo` from `libjpeg-turbo-3.1.0-x64-...`)
  </behavior>
  <action>
    1. Add a new exported type `PackageListEntry = { name: string; oldVersion: string | null; newVersion: string | null }`.

    2. Add exported function `parsePackageListDiff(patch: string): PackageListEntry[]`:
       - Parse unified diff lines, collecting `-` (old) and `+` (new) lines (skip `---`/`+++` headers).
       - For each content line, extract the archive filename (e.g., `zlib-1.3.2-x64-v143-20260301.7z`).
       - Parse archive filename with regex: The format is `{name}-{version}-{arch}-{compiler}-{date}.{ext}`. The version is a semver-like pattern (digits and dots). The name may contain hyphens (e.g., `libjpeg-turbo`). Strategy: split on `-`, find the first segment that looks like a version (starts with digit), everything before is name, the version is that segment. Arch/compiler/date are after version.
       - Group old/new entries by package name (case-insensitive match).
       - Return array of `PackageListEntry`.

    3. Add tests covering:
       - Single package version bump (zlib-1.3.1 -> zlib-1.3.2)
       - Multi-package list diff (zlib + openssl changed in same file)
       - Package with hyphenated name (libjpeg-turbo-3.0.0 -> libjpeg-turbo-3.1.0)
       - Added-only package (new line with no corresponding removal)
       - Empty/irrelevant diff returns empty array
       - Real-world format: `zlib-1.3.2-x64-v143-20260301.7z`
  </action>
  <verify>
    <automated>cd /home/keith/src/kodiai && bun test src/lib/depends-bump-enrichment.test.ts</automated>
  </verify>
  <done>parsePackageListDiff correctly extracts name/old/new version triples from Windows .list file diffs. All existing tests still pass.</done>
</task>

<task type="auto">
  <name>Task 2: Wire .list fallback into review pipeline and harden all-null posting</name>
  <files>src/handlers/review.ts</files>
  <action>
    In the [depends] deep-review pipeline section of review.ts (around line 1995-2009), after the VERSION file diff parsing loop:

    1. **Add .list file fallback**: After the existing VERSION file loop, add a second pass for packages that still have null old/new versions in `versionDiffs`. For each such package:
       - Find `.list` files in `prFilesForDepends` matching pattern `0_package.target` (case-insensitive filename check).
       - If found, call `parsePackageListDiff(listFile.patch)` on each matching .list file.
       - Match returned entries by package name (case-insensitive) against the package in question.
       - If a match is found, update `versionDiffs` entry's `oldVersion` and `newVersion` from the .list parse result. Leave `versionFileDiff` as null (no VERSION file exists — hash verification correctly skips).
       - Log at info level: `[depends] extracted version from .list file for {packageName}`.

    2. **Import parsePackageListDiff** from `./depends-bump-enrichment.ts` at the top of review.ts (add to existing import block).

    3. **Harden posting**: The current pipeline code at line ~2108-2131 already builds and posts the comment unconditionally within the try block. Verify this is the case — the comment should post even when `versionDiffs` all have null versions, `changelogs` are all "unavailable", and `hashResults` are all "skipped". The `buildDependsReviewComment` function already handles empty/null data gracefully. No change needed here unless the pipeline has an early return or skip condition for all-null data (it should NOT).

    Important: Do NOT add any early returns or skip conditions based on enrichment quality. The philosophy is fail-open: always post whatever we have.
  </action>
  <verify>
    <automated>cd /home/keith/src/kodiai && bun test src/lib/depends-bump-enrichment.test.ts && bun test src/lib/depends-review-builder.test.ts && bun build src/handlers/review.ts --no-bundle 2>&1 | head -5</automated>
  </verify>
  <done>Windows [depends] bumps with .list-only diffs extract versions into versionDiffs. Pipeline always posts structured comment regardless of enrichment completeness. TypeScript compiles clean.</done>
</task>

</tasks>

<verification>
1. `bun test src/lib/depends-bump-enrichment.test.ts` — all tests pass including new parsePackageListDiff tests
2. `bun test src/lib/depends-review-builder.test.ts` — existing review builder tests still pass
3. `bun build src/handlers/review.ts --no-bundle` — compiles without errors
</verification>

<success_criteria>
- parsePackageListDiff correctly parses `zlib-1.3.1-x64-v143-20260216.7z` -> `{ name: "zlib", oldVersion: "1.3.1", newVersion: null }` (and paired entries)
- Review pipeline falls back to .list parsing when no VERSION file exists for a package
- Pipeline posts structured comment even when all enrichment yields partial/empty data
- All existing tests pass unchanged
</success_criteria>

<output>
After completion, create `.planning/quick/16-parse-windows-package-lists-and-harden-p/16-SUMMARY.md`
</output>
