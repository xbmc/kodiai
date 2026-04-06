# S01 Research — Repro and Tier-State Correction

## Summary

Slice S01 owns the storage-side truthfulness requirements: **R039** directly, and it materially supports **R040/R041/R042** by establishing a reproducible contributor-tier state that the review path can trust.

This is targeted research. The key bug shape is already in the codebase:

- `src/handlers/review.ts` resolves author experience by preferring **contributor profile store first**, then review-time author cache, then fallback `classifyAuthor()`.
- `src/contributor/expertise-scorer.ts` updates `overallScore` after incremental or batch scoring, but it writes that score back using the **existing stored tier** (`profile.overallTier`) instead of recalculating the tier.
- `src/contributor/tier-calculator.ts` contains the only tier recomputation logic, but `rg` shows it is **not called from production paths**.

That means a contributor can accumulate enough score/history to merit an upgrade while the stored `overall_tier` remains stuck forever. Because the review handler consumes `profile.overallTier` first, the wrong tier is treated as source of truth and the prompt receives newcomer/developing guidance even when the score/history says otherwise.

## Recommendation

Build S01 around three proofs, in this order:

1. **Reproduce the stuck-tier behavior deterministically** with unit tests around `updateExpertiseIncremental()` and/or score update flow, proving that score increases do not advance `overall_tier` today.
2. **Introduce the smallest durable recalculation seam** in the contributor scoring/update path, so meaningful score updates also produce a truthful tier (either inline tier recompute from current profile-score distribution or an explicit post-update recalculation hook).
3. **Add a slice verifier / focused regression tests** proving the CrystalP-shaped state can advance out of the low tier and that review resolution would consume the corrected stored tier before any cache/fallback path.

The highest-value first task is proving the current defect. Per the project rule to reproduce before fix, the planner should start with a failing regression that demonstrates: **score changes, tier does not**.

## Implementation Landscape

### Contributor tier source of truth

**Files:**
- `src/contributor/types.ts`
- `src/contributor/profile-store.ts`
- `src/db/migrations/011-contributor-profiles.sql`

**What exists:**
- Persistent contributor state lives in `contributor_profiles` with `overall_tier`, `overall_score`, and `last_scored_at`.
- Valid stored tiers are `newcomer | developing | established | senior`.
- Store API has `updateTier(profileId, tier, overallScore)` and `getAllScores()`.

**Important constraint:**
- `updateTier()` is the only writer for `overall_tier`. There is no separate `updateScoreOnly()` API, so existing callers encode tier behavior implicitly by what tier they pass.

### Scoring path that currently preserves stale tiers

**File:** `src/contributor/expertise-scorer.ts`

**What it does:**
- Computes per-language and per-file-area expertise.
- Computes `overallScore` from top expertise entries.
- Calls:
  - batch path: `profileStore.updateTier(profile.id, profile.overallTier, overallScore)`
  - incremental path: `profileStore.updateTier(profile.id, profile.overallTier, overallScore)`

**Why this matters:**
- Both paths persist a fresh score with a stale tier.
- This is the most direct structural cause of “stuck” contributor advancement.

**Natural seam:**
- The fix belongs either inside `expertise-scorer.ts` or immediately adjacent to it, not in prompt wording and not in fallback classifier logic.
- A small extracted helper like `resolveContributorTierForScore(...)` or a scoring-path call into `tier-calculator.ts` is the likely seam.

### Tier recalculation logic already exists but is orphaned

**File:** `src/contributor/tier-calculator.ts`

**What exists:**
- `recalculateTiers({ profileStore, logger })`
- Uses percentile buckets over `getAllScores()`:
  - `< 0.2` newcomer
  - `< 0.5` developing
  - `< 0.8` established
  - otherwise senior
- Zero score always maps to newcomer.

**What’s missing:**
- No production caller. `rg -n "recalculateTiers\(" src` only finds the function and its tests.

**Planner implication:**
- S01 does not need new tier math from scratch. It needs the existing tier math wired into a real scoring/update path, or a refined helper extracted from it for synchronous use.

### Review path precedence already favors stored contributor profiles

**Files:**
- `src/handlers/review.ts` (`resolveAuthorTier`)
- `src/execution/review-prompt.ts` (`buildAuthorExperienceSection`)

**Resolution order in `resolveAuthorTier(...)`:**
1. contributor profile store → return `profile.overallTier`
2. knowledge-store author cache
3. search-enriched `classifyAuthor()` fallback

**Prompt mapping in `buildAuthorExperienceSection(...)`:**
- `first-time` or `newcomer` → welcoming / educational guidance
- `regular` or `developing` → developing-contributor guidance
- `established` → brief explanations
- `core` or `senior` → terse peer-to-peer guidance

**Implication:**
- If S01 fixes stored tier truthfulness, S02 can likely wire review truthfulness with relatively small changes because the precedence is already correct in principle.
- The actual mislabel is downstream of stale stored state, not obviously a prompt-template bug.

### Fallback system is semantically different from stored system

**File:** `src/lib/author-classifier.ts`

**What exists:**
- Fallback tiers: `first-time | regular | core`.
- Uses `authorAssociation` plus merged PR count.

**Mismatch:**
- Stored system is 4-tier (`newcomer/developing/established/senior`).
- Fallback system is 3-tier (`first-time/regular/core`).
- Prompt builder accepts both unions and merges them into shared tone buckets.

**Planner implication:**
- S01 should stay focused on correcting stored-tier state, not unifying both tier taxonomies yet.
- But tests should explicitly cover the precedence rule: corrected stored tier must win over fallback/cache when present.

## What To Build or Prove First

### 1) Deterministic repro of the stuck-tier defect

Best first task.

**Target files:**
- `src/contributor/expertise-scorer.test.ts`
- possibly a new focused verifier in `scripts/verify-m042-s01.ts`

**Proof to add:**
- Start with a profile whose stored tier is `newcomer`.
- Return expertise data / scores such that recomputation should place them above newcomer.
- Run incremental or batch scoring update.
- Assert current behavior leaves `updateTier(..., profile.overallTier, overallScore)` using the stale tier.

Because the current tests for `updateExpertiseIncremental()` only verify `upsertExpertise` calls, they do **not** prove anything about tier advancement.

### 2) Choose the recalculation seam

Most natural options:

**Option A — synchronous recompute in scorer path**
- After updating expertise and recomputing `overallScore`, call into tier logic and persist the recalculated tier immediately.
- Pros: direct, keeps stored state truthful immediately after meaningful updates.
- Risk: percentile-based tiering depends on `getAllScores()` across all profiles, so each update becomes a small global read/recalc operation.

**Option B — targeted helper extracted from `tier-calculator.ts` plus full recalculation call**
- Reuse the percentile implementation but make it callable from scorer path.
- Could either recalc all tiers or compute the target profile’s percentile from current score distribution.
- Pros: stays aligned with existing algorithm.
- Risk: if implemented as “recalculate all tiers on every update,” it is operationally heavier, though still possibly acceptable given contributor updates are fire-and-forget today.

**What to avoid:**
- Do not patch `review.ts` to ignore stored `newcomer` tiers when score looks high. That would violate D042 and leave the source of record stale.

### 3) Add review-resolution proof, not just scorer proof

Even though S02 owns review-surface wiring, S01 should still prove the corrected stored tier is the one `resolveAuthorTier()` returns.

**Target files:**
- `src/handlers/review.test.ts` (focused tests around `resolveAuthorTier` behavior via handler seams if available)
- or a small dedicated extracted unit seam later if needed

**Proof to add:**
- contributor profile exists with elevated stored tier → handler resolves that tier directly
- cached/fallback data should not override it

This supports **R041/R042** and reduces planner uncertainty for S02.

## Risks and Constraints

### Percentile math is population-relative

`recalculateTiers()` is not threshold-based; it is percentile-based over all contributor scores.

**Consequence:**
- A test that says “score 0.8 must become senior” is brittle unless the test also controls the full score distribution.
- Tests should construct full score sets and assert percentile outcomes, not absolute-score outcomes.

### Incremental scoring is fire-and-forget in review flow

`src/handlers/review.ts` calls `updateExpertiseIncremental(...)` at the end of review in a non-blocking `.catch(...)` path.

**Consequence:**
- S01 should avoid designs that make review completion depend on a fragile synchronous recomputation step that can throw and block review.
- Preserve fail-open behavior. If recalculation is added, it needs the same non-blocking/error-tolerant posture as the existing scoring update.

### Existing DB tests use `DATABASE_URL`, not `TEST_DATABASE_URL`

`src/contributor/profile-store.test.ts` currently uses:
- `process.env.DATABASE_URL ?? postgresql://kodiai:kodiai@localhost:5432/kodiai`

This does **not** follow the repo’s established explicit test DB gate pattern from Project Knowledge (`TEST_DATABASE_URL`-gated integration suites should skip cleanly).

**Planner implication:**
- Prefer unit tests and pure/fake-store tests for S01 unless there is a specific need for DB integration.
- If touching contributor DB integration tests, consider aligning them with `TEST_DATABASE_URL` gating so verification is deterministic in auto-mode.

### No current CrystalP repro artifact exists

`rg` found no existing `CrystalP` / `28132`-specific test or script in `src/`.

**Consequence:**
- The slice likely needs a new deterministic repro harness or fixture, not just edits to existing generic tests.
- Keep it synthetic but shaped after the real failure: established contributor history + stale stored low tier + review consumes low tier.

## Verification Strategy

Prefer deterministic proofs over live GitHub calls for this slice.

### Primary verification

- `bun test ./src/contributor/expertise-scorer.test.ts`
- `bun test ./src/contributor/tier-calculator.test.ts`
- targeted review-path test file or filter covering author-tier precedence in `src/handlers/review.test.ts`

### Stronger slice-level proof

Add a focused verifier script, e.g.:
- `scripts/verify-m042-s01.ts`
- `bun run ./scripts/verify-m042-s01.ts -- --json`

Suggested checks:
- **STUCK-TIER-REPRO** — old behavior would preserve stale low tier while score rises
- **TIER-RECALC-ON-SCORE-UPDATE** — corrected scoring path advances stored tier under controlled population scores
- **PROFILE-PRECEDENCE** — `resolveAuthorTier` prefers corrected contributor profile over cache/fallback
- **FAIL-OPEN-ON-RECALC-ERROR** — if recalc path throws, review/scoring path still degrades safely

### Secondary verification

- `bun run tsc --noEmit`

Per project knowledge, if this command is part of the gate it must exit 0; do not accept “no new errors.”

## Files Most Likely To Change

### High-probability
- `src/contributor/expertise-scorer.ts`
- `src/contributor/expertise-scorer.test.ts`
- `src/contributor/tier-calculator.ts`
- `src/contributor/tier-calculator.test.ts`

### Likely supporting / regression
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `scripts/verify-m042-s01.ts`
- `scripts/verify-m042-s01.test.ts`

### Possible but lower-probability
- `src/contributor/profile-store.ts` (only if a helper query/API is needed)
- `src/contributor/types.ts` (only if a new helper type is extracted)
- `src/contributor/index.ts` (if new helper exports are added)

## Natural Task Split

### Task 1 — Repro harness and failing regression
- Map the exact stuck-tier behavior in scorer tests and/or a verifier.
- Deliverable: deterministic failing proof of stale-tier preservation.

### Task 2 — Tier recalculation wiring in contributor scoring path
- Wire existing tier-calculation logic into score updates with fail-open behavior.
- Deliverable: score updates can advance stored tier truthfully.

### Task 3 — Review-resolution regression and slice verifier hardening
- Prove corrected stored tier wins in review resolution and add CrystalP-shaped regression coverage.
- Deliverable: planner/executor for S02 can trust the source-of-truth behavior.

## Notes for the Planner

- Follow the GSD rule from this prompt set: **reproduce before fix**. Do not start by refactoring tier math.
- Use the smallest durable seam. The code already contains the tier algorithm; the missing piece is production wiring.
- Keep S01 centered on **stored state correction**. Taxonomy reconciliation between 4-tier and 3-tier systems is adjacent, but broader and better left to S02/S03 unless it blocks the storage fix.
- If adding any new proof harness test doubles for store behavior, follow the repo’s existing pattern of light injectable seams rather than global module mocking.
