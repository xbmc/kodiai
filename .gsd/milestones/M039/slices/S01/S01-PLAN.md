# S01: PR Template Stripping Hardening + xbmc Fixture

**Goal:** Extend `stripTemplateBoilerplate` in `src/lib/pr-intent-parser.ts` to remove entire heading sections (not just the heading line) through to the next same-or-higher-level heading, then add a minimal xbmc-style PR body fixture test proving the regression is fixed and the plain-prose path still works.
**Demo:** After this: After this: a PR body containing a `## Types of change` section with Breaking change checkbox text no longer triggers `breaking change in body`; a plain-prose `This is a breaking change` body still does.

## Tasks
- [x] **T01: Extended template section stripping to remove heading body content through next heading, not just the heading line.** — The current `stripTemplateBoilerplate` in `src/lib/pr-intent-parser.ts` removes heading lines for `## Types of change` and `## Checklist` but leaves the checkbox lines below them in place. The 3+-consecutive-checkbox-run backstop strips those runs, but it fails when the template has fewer than 3 boxes in a row or when runs are interrupted by blank lines.

The fix: replace the heading-only removal with a section-body removal that strips everything from the matched heading through (but not including) the next heading of the same or higher level.

Steps:
1. Read `src/lib/pr-intent-parser.ts` lines 72-90 carefully before editing.
2. Replace the heading-only regexes with a section-body removal approach. A safe pattern:
```ts
// Remove entire template heading sections (heading + all content until next same-or-higher-level heading)
// Targets: ## Types of change, ## Checklist, and similar boilerplate section names
const TEMPLATE_SECTION_HEADINGS = /^(#+)\s*(Types of change|Checklist|Checks|PR type|Change type)\b[^\n]*/im;
function stripTemplateSections(text: string): string {
  let out = text;
  let match: RegExpExecArray | null;
  const re = /^(#+)\s*(Types of change|Checklist|Checks|PR type|Change type)\b[^\n]*/gim;
  // Collect section ranges in reverse order so index math stays valid after replacement
  const ranges: Array<{ start: number; end: number }> = [];
  while ((match = re.exec(out)) !== null) {
    const hashes = match[1]!;
    const level = hashes.length;
    const start = match.index;
    // Find the next heading of equal or greater level (same or fewer # characters)
    const nextHeading = new RegExp(`^#{1,${level}}\\s+\\S`, 'gm');
    nextHeading.lastIndex = start + match[0].length;
    const next = nextHeading.exec(out);
    const end = next ? next.index : out.length;
    ranges.push({ start, end });
  }
  // Replace in reverse order to preserve indices
  for (const r of ranges.reverse()) {
    out = out.slice(0, r.start) + ' TEMPLATE_REMOVED ' + out.slice(r.end);
  }
  return out;
}
```
3. Update `stripTemplateBoilerplate` to call `stripTemplateSections` instead of the heading-line-only regexes. Keep the 3+-checkbox-run backstop as a secondary guard.
4. Verify the existing unit tests still pass (they use the function name `stripTemplateBoilerplate` via `parsePRIntent`; the internals can be refactored freely).
5. Run `bun run tsc --noEmit` and fix any type errors.
  - Estimate: 30m
  - Files: src/lib/pr-intent-parser.ts
  - Verify: bun test ./src/lib/pr-intent-parser.test.ts && bun run tsc --noEmit
- [x] **T02: Added xbmc fixture regression test and plain-prose detection guard to pr-intent-parser.test.ts.** — Add a minimal real-world xbmc-style PR body fixture test to `src/lib/pr-intent-parser.test.ts` that proves the section-stripping fix works end-to-end, and confirm the plain-prose breaking-change detection path still fires.

Steps:
1. Construct a minimal xbmc PR body fixture — the actual xbmc template structure that caused the false positive:
```
## Description
Fix some bug in the player.

## Types of change
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] Breaking change (fix or feature that will cause existing functionality to change)
- [ ] New feature (non-breaking change which adds functionality)

## Checklist
- [x] My code follows the code style of this project.
- [x] I have read the CONTRIBUTING document.
```
2. Add a test `'xbmc PR template body does not trigger breaking change in body'` that calls `parsePRIntent('Fix player bug', XBMC_FIXTURE_BODY)` and asserts `breakingChangeDetected === false` and `breakingChangeSources.filter(s => s.source === 'body')` is empty.
3. Add (or verify the existing) test `'plain body prose still triggers breaking change detection'` that calls `parsePRIntent('Update API', 'This is a breaking change to the REST API')` and asserts `breakingChangeDetected === true`.
4. Run `bun test ./src/lib/pr-intent-parser.test.ts` and confirm all pass.
5. Run `bun run tsc --noEmit` to confirm the type gate is clean.
  - Estimate: 20m
  - Files: src/lib/pr-intent-parser.test.ts
  - Verify: bun test ./src/lib/pr-intent-parser.test.ts
