# Phase 98: Contributor Profiles & Identity Linking - Context

**Gathered:** 2026-02-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Contributors have cross-platform profiles with expertise scores that adapt Kodiai's review depth and tone. Includes: identity linking (GitHub/Slack), expertise inference from activity signals, adaptive review behavior based on contributor tier, and privacy controls. Does not include: review pattern clustering, wiki staleness detection, or any new review comment types.

</domain>

<decisions>
## Implementation Decisions

### Identity linking flow
- Linking initiated via Slack slash command: `/kodiai link <github-username>`
- Trust-based verification — accept the claim at face value (internal teams, low abuse risk)
- Kodiai proactively suggests links via Slack DM when it detects likely matches (e.g., same display name on GitHub and Slack)
- Unlinking via `/kodiai unlink` removes the cross-platform link but keeps expertise data intact
- No GitHub-side linking command — Slack is the single entry point

### Expertise scoring model
- Expertise scored on two dimensions: programming language AND codebase file area (e.g., "TypeScript: 0.8, src/api/: 0.9")
- Four signals feed into scores:
  - Commit history (files touched, languages, frequency)
  - PR review activity (reviews given in specific areas/languages)
  - PR authorship (merged PRs, weighted heavier than individual commits)
  - Recency weighting (recent activity counts more, decay over time)
- Author tiers auto-computed from expertise scores (e.g., percentile-based: top 20% = senior, bottom 20% = newcomer)

### Adaptive review behavior
- High-expertise contributors (in their strong areas) get:
  - No basic explanations — just flag the issue directly
  - Higher confidence threshold — fewer nitpicks, only comment on real issues
  - Terser, more direct tone — peers talking to peers
  - Focus shifted toward architecture/design concerns over syntax/style
- Newcomers / low-expertise contributors get:
  - Explanations of WHY something is an issue, not just WHAT
  - Links to project docs, style guides, or similar PRs as examples
  - Friendlier, encouraging tone — frame suggestions as learning opportunities
- Adaptation is invisible — no indicators or badges, reviews just naturally read differently
- Cross-area behavior uses overall tier — a senior contributor gets senior treatment everywhere, even outside their primary expertise area

### Privacy & consent
- Profiles are opt-out (built automatically for anyone who interacts with Kodiai)
- Opt-out via Slack command: `/kodiai profile opt-out`
- When someone opts out: stop collecting new data but keep existing history (soft freeze)
- Opted-out contributors receive generic (non-adapted) reviews
- Contributors can view their own profile via `/kodiai profile` — shows linked identities, expertise scores, and tier

### Claude's Discretion
- Expertise score refresh strategy (incremental on PR events vs periodic batch vs hybrid)
- Exact tier thresholds and number of tiers
- Score decay curve and time constants
- Heuristic matching algorithm for identity suggestions
- Exact prompt engineering for adapted review tones

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 98-contributor-profiles-identity-linking*
*Context gathered: 2026-02-25*
