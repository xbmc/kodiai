# T01: 26-review-mode-severity-control 01

**Slice:** S01 — **Milestone:** M004

## Description

Extend the `.kodiai.yml` review config schema with new fields for review mode, severity filtering, focus areas, and comment cap.

Purpose: Enable users to configure review behavior via `.kodiai.yml` without any code changes in their repos. These config values will drive prompt enrichment in Plan 26-02.
Output: Updated `reviewSchema` Zod definition with new optional fields and comprehensive tests.

## Must-Haves

- [ ] "Setting review.mode to 'enhanced' or 'standard' is accepted by config parser with 'standard' as default"
- [ ] "Setting review.severity.minLevel to any of critical/major/medium/minor is accepted with 'minor' as default"
- [ ] "Setting review.focusAreas and review.ignoredAreas accepts arrays of category enums with empty arrays as defaults"
- [ ] "Setting review.maxComments accepts a number 1-25 with default 7"
- [ ] "Old configs without new fields parse identically to current behavior (zero migration)"
- [ ] "Invalid new field values cause section-level fallback with warnings, not crashes"

## Files

- `src/execution/config.ts`
- `src/execution/config.test.ts`
