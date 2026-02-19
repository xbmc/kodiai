# Phase 81: Slack Write Mode Enablement - Context

**Gathered:** 2026-02-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Enable Slack-triggered write workflows so `@kodiai` can perform repository write actions (including issue/PR comments and PR creation) from Slack threads, while preserving policy enforcement and deterministic safety behavior.

</domain>

<decisions>
## Implementation Decisions

### Write intent triggers
- Support both explicit prefixes and conversational intent for write-mode entry.
- Prefix intents remain valid (`apply:`, `change:`, `plan:`) and should trigger write mode directly.
- Conversational intent is allowed with a medium-confidence threshold.
- When intent is ambiguous, do not execute writes; respond read-only with a quick action that lets the user rerun as write intent.
- Repo targeting for write mode should allow any repository the app installation can access when the user specifies `owner/repo`.

### Allowed write actions from Slack
- Allow the full write action set in Slack write mode: file edits, branch creation, PR creation, and issue/PR comments.
- Permit running tests/build commands when relevant to the requested change.
- Never push directly to protected/default branches; keep PR-only write delivery.
- If the run posts a GitHub comment, Slack must also reply in-thread and include the GitHub link (plus comment content or excerpt).

### Approval and confirmation behavior
- Require confirmation only for high-impact changes; do not require confirmation for every write run.
- Use Slack thread confirmation for gated runs.
- If confirmation is not received, keep the request pending (no automatic cancel fallback).

### Slack write-run response style
- Use balanced progress updates: start, key milestones, and final result.
- Final success message should include a concise outcome plus short bullets summarizing what changed and where.
- Failure/refusal responses should include the reason and an exact next-action retry/fix command.
- By default, include only the primary PR link in Slack final output; provide other links on request.

### Claude's Discretion
- Define the exact high-impact threshold criteria for when confirmation is required.
- Choose a default confirmation timeout duration for gated runs.
- Choose exact wording for the quick-action write rerun prompt in ambiguous-intent cases.

</decisions>

<specifics>
## Specific Ideas

- "If you asked in Slack, then you should respond and show the comment with a GitHub link."
- Write mode should not be limited to `xbmc/xbmc`; it should work for any repo the installation can access when explicitly requested.

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope.

</deferred>

---

*Phase: 81-slack-write-mode-enablement*
*Context gathered: 2026-02-18*
