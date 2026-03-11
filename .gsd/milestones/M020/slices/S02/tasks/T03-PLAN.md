# T03: 98-contributor-profiles-identity-linking 03

**Slice:** S02 — **Milestone:** M020

## Description

Build the expertise scoring engine, tier calculator, and identity matcher -- the intelligence layer that turns raw GitHub activity into structured expertise profiles.

Purpose: This is the core algorithm that drives adaptive review behavior (Plan 04).
Output: Expertise scorer with decay, tier calculator with percentiles, identity matcher with heuristics.

## Must-Haves

- [ ] "Expertise scores are computed from commit history, PR authorship, and PR review activity with recency decay"
- [ ] "Scores are two-dimensional: programming language AND codebase file area"
- [ ] "Tiers are auto-computed from percentile distribution of all contributors"
- [ ] "Heuristic identity matcher suggests GitHub/Slack links based on display name similarity"

## Files

- `src/contributor/expertise-scorer.ts`
- `src/contributor/expertise-scorer.test.ts`
- `src/contributor/tier-calculator.ts`
- `src/contributor/tier-calculator.test.ts`
- `src/contributor/identity-matcher.ts`
- `src/contributor/identity-matcher.test.ts`
