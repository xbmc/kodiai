---
id: T01
parent: S01
milestone: M039
key_files:
  - src/lib/pr-intent-parser.ts
key_decisions:
  - Replace heading-only removal with full section-body removal that strips from the matched heading through the next same-or-higher-level heading, preserving the 3+ checkbox-run backstop as a secondary guard.
duration: 
verification_result: passed
completed_at: 2026-04-04T21:01:10.987Z
blocker_discovered: false
---

# T01: Extended template section stripping to remove heading body content through next heading, not just the heading line.

**Extended template section stripping to remove heading body content through next heading, not just the heading line.**

## What Happened

Rewrote `stripTemplateBoilerplate` to collect section ranges by scanning for `TEMPLATE_SECTION_RE` heading matches, then finding the next heading of equal or greater level to determine where each section ends. Ranges are replaced in reverse order to preserve indices. The 3+ checkbox run backstop remains as a secondary guard for checkbox blocks without a heading.

## Verification

`bun test ./src/lib/pr-intent-parser.test.ts` 35/35 pass; `bun run tsc --noEmit` clean.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/lib/pr-intent-parser.test.ts && bun run tsc --noEmit` | 0 | ✅ pass | 7100ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/lib/pr-intent-parser.ts`
