---
phase: "14"
title: Fix CI test failures in buildAuthorExperienceSection
status: complete
commit: 8248d970c6
---

# Quick Task 14 Summary

## What Changed

Two test expectations in `src/execution/review-prompt.test.ts` were out of sync with the Phase 98 (v0.20) implementation of `buildAuthorExperienceSection`:

1. **Core tier test** (line 453): Expected `"core contributor"` but implementation outputs `"core/senior contributor"` (covers both core and senior tiers). Updated assertion.

2. **Regular tier test** (lines 459-463): Expected empty string `""` but Phase 98 added developing-tier guidance for regular contributors. Updated test to verify the guidance content instead of expecting empty.

## Verification

- `bun test src/execution/review-prompt.test.ts`: 130 pass, 0 fail
- Full suite: 1567 pass locally (2 local-only DB migration failures unrelated to this change)
- CI had exactly these 2 failures; all other 1588 tests passed

## Root Cause

Phase 98 (contributor profiles) expanded `buildAuthorExperienceSection` to provide guidance for all tiers including regular/developing, and renamed the core tier label to `"core/senior contributor"`. The corresponding tests were not updated.
