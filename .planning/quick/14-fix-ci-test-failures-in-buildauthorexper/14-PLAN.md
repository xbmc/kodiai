---
phase: "14"
title: Fix CI test failures in buildAuthorExperienceSection
status: complete
plans: 1
tasks: 1
must_haves:
  truths:
    - "CI passes with 0 test failures for buildAuthorExperienceSection"
  artifacts:
    - "src/execution/review-prompt.test.ts"
  key_links:
    - "src/execution/review-prompt.ts → implementation (unchanged)"
    - "src/execution/review-prompt.test.ts → test expectations (updated)"
---

# Quick Task 14: Fix CI test failures in buildAuthorExperienceSection

## Task 1: Update test expectations to match v0.20 implementation

**files:** src/execution/review-prompt.test.ts
**action:** Fix 2 failing tests:
1. Core tier test: change `"core contributor"` → `"core/senior contributor"` (line 453)
2. Regular tier test: change from expecting empty string to expecting developing guidance content (lines 459-463)

**verify:** `bun test src/execution/review-prompt.test.ts` — 130 pass, 0 fail
**done:** Tests align with `buildAuthorExperienceSection` implementation from Phase 98 (contributor profiles)
