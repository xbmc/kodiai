# M042: Contributor Tier Truthfulness — Context

**Gathered:** 2026-04-06
**Status:** Ready for planning

## Project Description

Fix Kodiai's contributor-experience classification so a clearly established contributor is not labeled as a newcomer in review output. The concrete repro is CrystalP on `https://github.com/xbmc/xbmc/pull/28132`, where the contributor is seasoned and highly active, but Kodiai still applies newcomer-style author context. The goal is a full fix: make the stored contributor tier truthful, make review output consume the truthful signal, and stop caches or fallback classification from preserving contradictory labels.

## Why This Milestone

Author-experience guidance is part of Kodiai's review behavior, not just an internal metric. When it is wrong, Kodiai adjusts tone and explanation depth based on a false premise. That is a trust problem in the primary review loop. The current code inspection suggests the persistent contributor-profile system and the review-time fallback classifier are split, and the persistent path may be structurally unable to advance tiers in normal operation because score updates do not imply tier recalculation.

## User-Visible Outcome

### When this milestone is complete, the user can:

- inspect the repro path for `xbmc/xbmc#28132` and see that CrystalP is no longer described with newcomer-style author context
- trust that an experienced contributor with accumulated activity is not silently downgraded by stale stored tier state, cache reuse, or fallback classification

### Entry point / environment

- Entry point: PR review path in `src/handlers/review.ts`
- Environment: production-like review execution against GitHub PR metadata and stored contributor profile state
- Live dependencies involved: GitHub Search API / PR metadata, Postgres contributor profile store, review-time author cache

## Completion Class

- Contract complete means: unit and focused integration tests prove truthful tier advancement, source-of-truth precedence, and regression coverage for the repro and adjacent cases
- Integration complete means: the review path uses the corrected tier source consistently and no longer emits newcomer-style guidance for the real repro shape
- Operational complete means: cache and fail-open paths do not reintroduce stale or contradictory contributor labels under normal review execution

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- the CrystalP / `xbmc#28132` repro path no longer produces newcomer-style author context in review output
- stored contributor profile state can move upward when score/history warrants it, instead of remaining stuck at the original tier
- cache reuse and fallback classification preserve truthful review behavior rather than silently overriding corrected profile state

## Risks and Unknowns

- The real bug may be broader than a missing recalculation call — score weighting, cache precedence, and fallback normalization may all contribute.
- There are currently two author-tier systems (`src/contributor/*` and `src/lib/author-classifier.ts`) with different shapes and semantics, which creates drift risk.
- The review path prefers contributor profile store state first; if that profile is stale or structurally stuck, review output will consistently inherit the wrong label.
- GitHub Search API-derived merged PR counts are only one signal and may not reflect the user's intuitive notion of "seasoned dev who comments/posts a ton of stuff." We need truthful behavior without pretending to measure more than the system actually knows.

## Existing Codebase / Prior Art

- `src/handlers/review.ts` — resolves author classification, prefers contributor profile store, then author cache, then fallback classifier
- `src/lib/author-classifier.ts` — lightweight PR-time classifier based on GitHub author association + merged PR count
- `src/contributor/expertise-scorer.ts` — computes contributor expertise and overall score; currently updates score while reusing the existing stored tier
- `src/contributor/tier-calculator.ts` — percentile-based stored-tier recalculation logic that appears separate from the normal incremental score update path
- `src/contributor/profile-store.ts` — persistence layer for contributor profiles and expertise rows
- `src/execution/review-prompt.ts` — maps author tier into newcomer/developing/established/senior review guidance
- `src/handlers/review.test.ts` — existing author-tier cache and search-enrichment tests

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions — it is an append-only register; read it during planning, append to it during execution.

## Relevant Requirements

- R039 — make stored contributor profiles advance truthfully as contributor activity accumulates
- R040 — ensure review output consumes the corrected contributor tier and avoids newcomer mislabeling
- R041 — stop cache and fallback paths from preserving contradictory labels
- R042 — capture the real repro in regression verification

## Scope

### In Scope

- reproducing the current misclassification path for CrystalP / `xbmc#28132`
- correcting stored contributor-tier advancement behavior
- reconciling review-path source-of-truth precedence between contributor profile state, author cache, and fallback classifier
- wiring review output to the corrected signal path
- adding regression verification for the repro and adjacent contributor-history cases

### Out of Scope / Non-Goals

- recalibrating the entire contributor scoring model repo-wide
- redesigning the broader author-experience tone model from scratch
- unrelated review-copy cleanup that does not materially affect contributor-tier truthfulness

## Technical Constraints

- The review path must remain fail-open: broken enrichment cannot block PR review completion.
- Any fix must preserve truthful behavior under stale-cache or missing-data conditions rather than inventing stronger knowledge than the system actually has.
- The fix should work within the existing Postgres-backed contributor profile store and review handler architecture unless a small seam extraction is clearly warranted.

## Integration Points

- GitHub Search API — currently used to enrich ambiguous associations with merged PR count
- Postgres contributor profile store — holds persistent contributor tiers and expertise scores
- knowledge-store author cache — caches review-time author classification data
- review prompt builder — consumes the final tier and shapes author-context guidance

## Open Questions

- Should the stored contributor tier be recalculated synchronously during meaningful score updates, or should the review path explicitly normalize stale profile state another way?
- How should the 4-tier stored system (`newcomer`, `developing`, `established`, `senior`) map against the 3-tier fallback system (`first-time`, `regular`, `core`) when both are still present?
- Is the CrystalP mislabel caused purely by stale stored state, or is the score/history model itself undercounting experienced contributors?
