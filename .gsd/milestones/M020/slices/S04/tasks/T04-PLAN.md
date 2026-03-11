# T04: 100-review-pattern-clustering 04

**Slice:** S04 — **Milestone:** M020

## Description

Implement pattern matching that identifies which active clusters are relevant to a given PR diff.

Purpose: Bridge between clustering pipeline and review prompt injection — finds the right patterns for each PR.
Output: Matcher module with TDD tests covering dual-signal scoring and threshold filtering.

## Must-Haves

- [ ] PR diffs are matched against active clusters using dual signals (embedding similarity + file path overlap)
- [ ] Only clusters with 3+ members in last 60 days are surfaced
- [ ] Maximum 3 pattern matches returned per PR
- [ ] Recency weighting favors recent comments within the 60-day window

## Files

- `src/knowledge/cluster-matcher.ts`
- `src/knowledge/cluster-matcher.test.ts`
