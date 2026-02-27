# Phase 104: Issue MCP Tools - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

MCP tools that let the triage agent apply labels and post comments on GitHub issues. Two tools: `github_issue_label` and `github_issue_comment`, wired into the executor MCP server registry with per-repo config gating and integration tests. No triage logic — that's Phase 105.

</domain>

<decisions>
## Implementation Decisions

### Label tool behavior
- Accept multiple labels in a single call (array input)
- Pre-validate all labels against the repo's existing labels before making changes
- Case-insensitive matching — resolve to the repo's canonical casing
- On missing labels: error and report (do NOT auto-create labels)
- Partial application: apply valid labels, report invalid ones in the response (not all-or-nothing)

### Comment tool behavior
- Support both raw markdown string AND structured input (title/body/suggestions) — agent chooses which to use
- No bot branding or signature on comments
- Support both creating new comments and updating existing comments by ID
- Enforce a max length limit — truncate with a note if exceeded

### Error & response contract
- Rich responses on success — return full result data (applied labels list, comment URL/ID, etc.)
- Include request metadata in responses (issue number, repo, timestamp) for traceability
- Structured error codes + human-readable messages (e.g., LABEL_NOT_FOUND, ISSUE_NOT_FOUND, PERMISSION_DENIED)
- Distinct error codes for different failure types (404 vs 403 vs rate limit)
- Retry with exponential backoff on GitHub API rate limiting
- Warn (don't block) when operating on closed issues — include warning in response

### Config gating
- Per-repo enable/disable for each tool
- Shared GitHub token in app config, with optional per-repo token override
- Hot-reload — config changes take effect immediately (check config on each call)
- When tool is called but gated off: return TOOL_DISABLED error code with explanation (don't hide the tool)

### Claude's Discretion
- API call logging/observability approach — follow existing telemetry patterns in the codebase
- Exact retry count and backoff intervals for rate limiting
- Comment length limit value (GitHub's own limit is 65535 chars)
- Structured input schema details for the comment tool

</decisions>

<specifics>
## Specific Ideas

- Label matching should feel forgiving — case-insensitive so the triage agent doesn't need to know exact casing
- Comment update support enables the agent to amend earlier guidance rather than posting duplicate comments
- Rich responses with metadata support traceability without re-querying GitHub

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 104-issue-mcp-tools*
*Context gathered: 2026-02-26*
