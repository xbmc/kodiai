# Phase 107: Duplicate Detection & Auto-Triage - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Detect duplicate issues at high confidence when new issues are opened, and auto-triage on `issues.opened`. The system posts a triage comment surfacing top duplicate candidates to maintainers. It never auto-closes issues. Auto-triage is gated behind `triage.autoTriageOnOpen` config flag (default: false). Duplicate detection is fail-open — failures are logged but never block triage.

</domain>

<decisions>
## Implementation Decisions

### Triage comment format
- Compact markdown table with columns: #number, title, similarity %, status (open/closed)
- Brief one-line header (e.g., "Possible duplicates detected:") before the table
- Similarity scores displayed as percentages only (e.g., "92%"), no descriptive labels
- No special branding or footer — comment posted by the bot's GitHub account is sufficient attribution

### Similarity thresholds
- Single threshold cutoff — candidates above it are shown, below it are ignored
- Threshold is configurable per-repo via `triage.duplicateThreshold` with a sensible default
- Max candidates shown is configurable via `triage.maxDuplicateCandidates` (default: 3)
- If no candidates meet the threshold, no triage comment is posted (zero noise for unique issues)

### Label & signal behavior
- Always apply a duplicate label when candidates are surfaced
- If the label doesn't exist in the repo, log a warning and skip labeling (require manual setup)
- Prioritize closed candidates — if top matches are all closed issues, emphasize this in presentation (may indicate the problem was already fixed)

### Idempotency & edge cases
- Delivery ID dedup: track GitHub's `X-GitHub-Delivery` header, skip if already processed
- Per-issue cooldown: after triaging an issue, ignore further events for that issue within a cooldown window
- Both mechanisms active simultaneously (belt and suspenders)
- Triage runs once on `issues.opened` only — no re-triage when issue body is edited
- "Already triaged" tracked via DB flag (source of truth) + existing comment check (fallback)

### Claude's Discretion
- Label name choice (should fit GitHub conventions for the repo)
- Concurrency strategy for simultaneous webhook events on the same issue
- Exact cooldown window duration
- Exact default similarity threshold value
- How to emphasize closed candidates (e.g., separate section, annotation, or ordering)

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

*Phase: 107-duplicate-detection-auto-triage*
*Context gathered: 2026-02-27*
