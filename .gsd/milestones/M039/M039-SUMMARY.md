---
id: M039
title: "Review Output Hardening — Intent Parsing + Claude Usage Visibility"
status: complete
completed_at: 2026-04-04T21:03:27.547Z
key_decisions:
  - Replace heading-line-only removal with section-body removal (heading through next same-or-higher heading) for template stripping.
  - Percent-left = 100 - Math.round(utilization * 100) with `remaining` suffix; truthful fallback is absence of line when usageLimit is undefined.
key_files:
  - src/lib/pr-intent-parser.ts
  - src/lib/pr-intent-parser.test.ts
  - src/lib/review-utils.ts
  - src/lib/review-utils.test.ts
  - src/handlers/review.test.ts
lessons_learned:
  - Section-body stripping is more robust than heading-line-only stripping because checkbox content typically spans multiple lines below the heading.
---

# M039: Review Output Hardening — Intent Parsing + Claude Usage Visibility

**Fixed PR template false-positive breaking-change detection and changed Claude usage display to percent-left across two slices.**

## What Happened

Fixed two live review-output regressions. In the parser, `stripTemplateBoilerplate` now removes full heading sections from the matched heading through the next same-or-higher-level heading, eliminating false positive breaking-change detection from xbmc-style PR templates. In review-utils, `formatReviewDetailsSummary` now displays percent remaining instead of percent used, with a truthful absence when rate-limit data is missing. Both surfaces are locked by updated regression tests across parser, review-utils, and handler test files.

## Success Criteria Results

All six success criteria met: xbmc fixture clean, plain-prose detection preserved, percent-left format verified, absent-data fallback verified, handler test expectations updated, TSC clean.

## Definition of Done Results

- [x] S01 complete: section-body stripping in place, xbmc fixture and plain-prose tests pass (37/37).
- [x] S02 complete: percent-left display in place, review-utils (3/3) and handler (73/73) tests pass.
- [x] `bun run tsc --noEmit` exits clean.
- [x] Validation verdict: pass.

## Requirement Outcomes

No existing requirements were formally tracked for these surfaces. Both correctness contracts are now locked by regression tests introduced in this milestone.

## Deviations

None.

## Follow-ups

None.
