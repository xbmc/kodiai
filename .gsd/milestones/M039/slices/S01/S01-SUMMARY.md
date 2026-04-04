---
id: S01
parent: M039
milestone: M039
provides:
  - Corrected parser behavior: template heading sections are fully stripped before breaking-change detection.
  - xbmc fixture test locked in as regression guard.
requires:
  []
affects:
  []
key_files:
  - src/lib/pr-intent-parser.ts
  - src/lib/pr-intent-parser.test.ts
key_decisions:
  - Use section-body removal (heading through next same-or-higher heading) rather than heading-line-only removal to ensure checkbox content is fully stripped.
  - Preserve the 3+ checkbox run backstop as a secondary guard for standalone checkbox blocks.
patterns_established:
  - Template section stripping pattern: collect section ranges (heading to next equal-or-higher heading), replace in reverse order to preserve indices.
observability_surfaces:
  - None — pure function, no logging.
drill_down_paths:
  - .gsd/milestones/M039/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M039/slices/S01/tasks/T02-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-04T21:01:34.826Z
blocker_discovered: false
---

# S01: PR Template Stripping Hardening + xbmc Fixture

**Fixed PR template stripping to remove full heading sections and added an xbmc fixture regression test.**

## What Happened

Extended template stripping from heading-line-only removal to full section-body removal. The fix correctly handles the xbmc template where `## Types of change` is followed by checkbox lines that include `Breaking change` text. Added a checked-in xbmc fixture test and preserved plain-prose detection. All 37 parser tests pass.

## Verification

`bun test ./src/lib/pr-intent-parser.test.ts` — 37 pass, 0 fail.

## Requirements Advanced

None.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

None.

## Known Limitations

None.

## Follow-ups

None.

## Files Created/Modified

- `src/lib/pr-intent-parser.ts` — Rewrote `stripTemplateBoilerplate` to remove full heading sections (heading + body through next heading), not just the heading line.
- `src/lib/pr-intent-parser.test.ts` — Added xbmc fixture regression test and plain-prose detection guard.
