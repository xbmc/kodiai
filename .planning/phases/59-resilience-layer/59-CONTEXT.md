# Phase 59: Resilience Layer - Context

**Gathered:** 2026-02-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Recover value from timed-out reviews by publishing accumulated partial results and optionally retrying with reduced file scope. Covers checkpoint accumulation, partial result publishing, retry with scope reduction, and chronic timeout handling. New review capabilities, timeout budget changes, and queue management are out of scope.

</domain>

<decisions>
## Implementation Decisions

### Partial review presentation
- Same format as normal review, with a disclaimer at the top (e.g., "Partial review — timed out after analyzing X of Y files")
- Minimum quality bar: at least 1 finding — if we found anything actionable, publish it
- Show coverage ratio in disclaimer (e.g., "Analyzed 4 of 12 files"), don't list individual skipped files
- Inline comments from analyzed files are still posted as usual alongside the summary comment

### Retry notification & output
- Silent retry — no "retrying..." message posted; just publish the result when done
- If original timeout produced a partial review and retry succeeds, replace the partial review comment with the retry result (edit, not new comment)
- Retry result is labeled — includes a note like "Reviewed top N files by risk" so authors know coverage is limited
- If retry also times out, apply the same partial-review logic — publish whatever we got (at least 1 finding threshold)

### Chronic timeout feedback
- When a repo+author hits 3+ timeouts in the last 7 days, retry is skipped
- Explain in the partial review disclaimer why retry was skipped: "Retry skipped — this repo has timed out frequently"
- Suggest actionable guidance: recommend splitting large PRs to stay within timeout budget
- Timeout count tracked per repo+author (not penalizing the whole repo for one author's patterns)

### Scope reduction strategy
- Primary risk signal: file change size (larger diffs = higher priority)
- Retry skips already-analyzed files from the partial review — focus retry budget on unreviewed files
- Scope reduction is adaptive, not fixed 50%: if original got through 80%, retry the remaining 20%; if it got through 10%, retry top 50% of remaining
- Final output merges partial + retry findings into a single coherent review comment covering all analyzed files

### Claude's Discretion
- Exact checkpoint accumulation data structure
- Buffer-and-flush implementation details
- How to merge partial + retry inline comments cleanly
- Telemetry schema for checkpoint and retry metadata
- Exact adaptive scope reduction formula

</decisions>

<specifics>
## Specific Ideas

- Partial reviews should feel like a normal review that just happens to cover fewer files — not a degraded experience
- The merge of partial + retry results should produce a seamless review comment (reader shouldn't notice the seam)
- "Replace partial with retry" via comment edit keeps the PR timeline clean (no double-posting)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 59-resilience-layer*
*Context gathered: 2026-02-15*
