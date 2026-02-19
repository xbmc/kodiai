# Phase 82: Draft PR Review Coverage - Context

**Gathered:** 2026-02-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Draft PRs receive the same review treatment as non-draft PRs, with clear visual acknowledgment of draft status. Non-draft PR behavior is unchanged.

</domain>

<decisions>
## Implementation Decisions

### Review trigger timing
- Draft PRs are treated identically to non-draft PRs for trigger purposes (review on open, manual review_requested)
- When a draft PR is converted to ready_for_review, Kodiai automatically re-reviews it (this is an exception to the general no-auto-re-review policy — ready_for_review is a distinct trigger event)
- Re-review on ready_for_review posts a new review comment; the old draft review stays visible as history
- Non-draft PRs continue working exactly as today — no changes to the non-draft path

### Review tone for drafts
- Draft reviews use softer tone: both a draft framing at the top AND per-finding language adjustments
- Top-level framing: draft indicator near the summary header (e.g., "Draft" badge), not a separate banner block
- Per-finding language: use suggestive framing ("Consider...", "You might want to...") instead of firm language ("Should...", "Fix this")
- When a draft is converted to ready and Kodiai re-reviews, the new review uses full normal tone — no draft framing, no softened language

### Claude's Discretion
- Exact draft badge/emoji styling in the summary header
- How to detect draft status from the webhook/event payload
- Implementation of the tone adjustment (prompt engineering, template branching, etc.)

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 82-draft-pr-review-coverage*
*Context gathered: 2026-02-19*
