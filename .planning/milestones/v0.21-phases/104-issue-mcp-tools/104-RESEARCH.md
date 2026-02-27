# Phase 104: Issue MCP Tools - Research

**Researched:** 2026-02-26
**Status:** Complete
**Confidence:** HIGH

## Existing MCP Server Patterns

### Architecture (HIGH confidence)
The codebase uses `@anthropic-ai/claude-agent-sdk` for MCP tool definition:
- `createSdkMcpServer({ name, version, tools })` creates a server
- `tool(name, description, zodSchema, handler)` defines individual tools
- Handlers return `{ content: [{ type: "text", text: JSON.stringify(result) }] }` on success
- Handlers return `{ content: [{ type: "text", text: "Error: ..." }], isError: true }` on failure
- All tools receive `getOctokit: () => Promise<Octokit>` for lazy GitHub client resolution

### Server Registry (HIGH confidence)
- `buildMcpServers()` in `src/execution/mcp/index.ts` creates all MCP servers
- Returns `Record<string, McpServerConfig>` with named server entries
- Each server is conditionally registered based on boolean flags (e.g., `enableCommentTools`, `enableInlineTools`)
- `buildAllowedMcpTools()` maps server names to `mcp__${name}__*` patterns for allowlisting

### Existing Servers
| Server | File | Tools |
|--------|------|-------|
| `github_comment` | `comment-server.ts` | `create_comment`, `update_comment` |
| `github_inline_comment` | `inline-review-server.ts` | inline review tools |
| `github_ci` | `ci-status-server.ts` | `get_ci_status`, `get_workflow_run_details` |
| `reviewCommentThread` | `review-comment-thread-server.ts` | thread management |
| `review_checkpoint` | `checkpoint-server.ts` | checkpoint management |

### Key Observations
1. Existing `github_comment` server is PR-focused with review validators (sanitizeKodiaiDecisionResponse, sanitizeKodiaiReviewSummary). The new issue comment tool must NOT include these validators.
2. Each server is a separate file following the `create*Server()` factory pattern.
3. Config gating happens at the `buildMcpServers()` level, not inside individual tools.

## Config Gating Pattern (HIGH confidence)

### Current `.kodiai.yml` Schema
- `src/execution/config.ts` defines `repoConfigSchema` using Zod
- Top-level sections: `review`, `write`, `mention`, `telemetry`, `knowledge`, etc.
- Each section has an `enabled: boolean` field
- No existing `triage` section -- needs to be added

### Config Gating Approach
The CONTEXT.md specifies:
- Per-repo enable/disable for each tool
- Shared GitHub token in app config, with optional per-repo token override
- Hot-reload: check config on each call
- When tool is gated off: return `TOOL_DISABLED` error code

Since existing tools check config at the `buildMcpServers()` level (one-time), but CONTEXT.md requires hot-reload (check on each call), the new tools should check config inside the tool handler.

### Recommended Config Schema
```yaml
triage:
  enabled: true  # master switch
  label:
    enabled: true
  comment:
    enabled: true
```

## GitHub API Integration (HIGH confidence)

### Label Operations
- `octokit.rest.issues.addLabels({ owner, repo, issue_number, labels })` -- adds labels
- `octokit.rest.issues.listLabelsForRepo({ owner, repo })` -- lists available labels for validation
- Label names are case-insensitive in GitHub's API (it normalizes to canonical casing)
- Adding a label that already exists on the issue is a no-op (no error)

### Comment Operations
- `octokit.rest.issues.createComment({ owner, repo, issue_number, body })` -- create
- `octokit.rest.issues.updateComment({ owner, repo, comment_id, body })` -- update
- GitHub's max comment length is 65,535 characters
- API returns `{ data: { id, html_url, ... } }` on success

### Error Codes
| HTTP Status | Meaning | Mapped Error Code |
|-------------|---------|-------------------|
| 404 | Issue/comment not found | `ISSUE_NOT_FOUND` / `COMMENT_NOT_FOUND` |
| 403 | Permissions denied | `PERMISSION_DENIED` |
| 422 | Validation error (bad label) | `LABEL_NOT_FOUND` |
| 429 | Rate limited | `RATE_LIMITED` |

### Rate Limiting
- GitHub returns `429` with `Retry-After` header
- Exponential backoff: 1s, 2s, 4s (3 retries max)
- `octokit.rest` methods throw `RequestError` with `status` property

## Testing Pattern (HIGH confidence)

### Existing Tests
- `comment-server.test.ts` and `checkpoint-server.test.ts` exist
- Tests use `bun:test` with `describe`/`it`/`expect`
- Mock Octokit via manual mock objects passed to factory functions
- No need for HTTP-level mocking -- just mock the Octokit methods

### Test Strategy
- Unit test each tool handler with mocked Octokit
- Test label validation logic (case-insensitive matching, missing labels)
- Test error mapping (404 -> ISSUE_NOT_FOUND, etc.)
- Test config gating (tool disabled returns TOOL_DISABLED)
- Integration test: wiring into `buildMcpServers()`

## Implementation Plan Guidance

### File Structure
```
src/execution/mcp/
  issue-label-server.ts          # github_issue_label MCP server
  issue-label-server.test.ts     # tests
  issue-comment-server.ts        # github_issue_comment MCP server
  issue-comment-server.test.ts   # tests
  index.ts                       # updated to wire new servers
```

### Key Design Decisions
1. **Separate from existing comment server** -- the existing `comment-server.ts` has heavy review-specific validation. Issue comment tool should be clean.
2. **Config check inside handler** -- supports hot-reload requirement.
3. **Label pre-validation** -- fetch repo labels, case-insensitive match, apply valid ones, report invalid ones.
4. **Structured error responses** -- JSON with `{ success, error_code, message, ... }` format.
5. **Partial application for labels** -- apply valid labels, report invalid in response (not all-or-nothing).

### Pitfalls
1. **Don't reuse existing comment server** -- it has PR-specific validation (review summaries, decision responses) that would reject issue triage comments.
2. **Case-insensitive label matching** -- GitHub's API handles this, but the pre-validation step must do case-insensitive comparison.
3. **Closed issue warning** -- check issue state and include warning flag in response, but don't block.
4. **Rate limit retry** -- must handle `RequestError` with status 429 and `Retry-After` header.

---

## RESEARCH COMPLETE

*Phase: 104-issue-mcp-tools*
*Researched: 2026-02-26*
