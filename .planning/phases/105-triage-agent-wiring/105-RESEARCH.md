# Phase 105: Triage Agent Wiring - Research

**Researched:** 2026-02-26
**Status:** Complete

## Codebase Findings

### Existing Mention Handler Architecture

The mention handler (`src/handlers/mention.ts`) already processes `issue_comment.created` events. Key observations:

1. **Surface detection**: `normalizeIssueComment()` in `mention-types.ts` sets `surface: "issue_comment"` when `!payload.issue.pull_request`, distinguishing pure issue comments from PR comments.

2. **Issue-specific path**: Line 802 checks `isIssueThreadComment = event.name === "issue_comment" && mention.prNumber === undefined`. This flag already gates issue-specific logic (implicit write intent detection, issue code context building).

3. **MCP server wiring**: `buildMcpServers()` in `src/execution/mcp/index.ts` already supports `enableIssueTools` and `triageConfig` parameters. When both are truthy, it registers `github_issue_label` and `github_issue_comment` MCP servers. However, the executor (`src/execution/executor.ts` line 101-125) does NOT currently pass `enableIssueTools` or `triageConfig` to `buildMcpServers()`.

4. **Config schema**: `triageSchema` in `src/execution/config.ts` (line 460-479) already defines `triage.enabled`, `triage.label.enabled`, and `triage.comment.enabled` in `.kodiai.yml`. Default: `enabled: false` (opt-in).

### Phase 104 Deliverables (Dependencies)

- **`issue-label-server.ts`**: MCP tool `github_issue_label` with `add_labels` and `remove_labels` actions, label existence validation (404 handling), retry logic.
- **`issue-comment-server.ts`**: MCP tool `github_issue_comment` with `create_comment`, `update_comment`, `delete_comment` actions, 60k char truncation, retry logic.
- Both gated by `TriageConfig` -- tools return error if `triage.enabled` or sub-switch is false.

### Phase 103 Deliverables (Dependencies)

- **Issue store** (`src/knowledge/issue-store.ts`): CRUD + vector/full-text search for issues and comments.
- **Issue types** (`src/knowledge/issue-types.ts`): `IssueInput` includes `templateSlug: string | null` field -- ready for template parser output.
- **Migration 014**: `issues` table with `template_slug` column, HNSW + tsvector indexes.

### Template Parsing Requirements

GitHub `.md` issue templates live in `.github/ISSUE_TEMPLATE/`. Format:
```markdown
---
name: Bug Report
about: Report a bug
title: "[Bug]: "
labels: bug
assignees: ''
---

## Description
<!-- A clear description of the bug -->

## Steps to Reproduce
<!-- Steps to reproduce the behavior -->

## Expected Behavior
<!-- What you expected to happen -->

## Screenshots
<!-- If applicable, add screenshots -->
```

Parser needs to:
1. Read `.github/ISSUE_TEMPLATE/*.md` files from the repo (via Octokit contents API or workspace clone)
2. Parse YAML frontmatter for `name`, `labels`, `assignees`
3. Extract section headers (## headings) as required fields
4. Detect `<!-- optional -->` comments to mark sections optional
5. Match issue body against template sections
6. Report missing/empty sections

### Mention-Triage Integration Points

The triage nudge must be wired into the existing mention flow:
1. **Primary**: Answer the user's question (existing mention execution)
2. **Secondary**: Append template compliance nudge if fields are missing

Two integration approaches:
- **Approach A (Prompt injection)**: Add triage context to the mention prompt so the agent itself mentions missing fields. Simpler but less structured.
- **Approach B (Post-execution append)**: After mention execution completes, run template validation and append a brief nudge comment. More reliable but two API calls.

CONTEXT.md specifies: "the triage nudge should be a single sentence appended to whatever the bot's primary response is." This suggests Approach A -- include template validation results in the prompt and let the agent append a natural nudge.

### Label Strategy

CONTEXT.md specifies convention-based labels: `needs-info:{template_name}` derived from template filename.

- Label allowlist in `.kodiai.yml` -- needs a new config field (e.g., `triage.labelAllowlist: string[]`)
- If derived label doesn't exist on repo: skip labeling, mention in comment
- No label on passing issues

### Cooldown Mechanism

CONTEXT.md specifies per-issue cooldown that resets on issue body edit.
- Storage: In-memory Map keyed by `{owner}/{repo}#{issueNumber}` with `{lastTriagedAt, lastBodyHash}`
- On mention: compute body hash, compare to stored hash. If same and within cooldown: skip triage nudge
- On edit: body hash changes, cooldown resets automatically
- Default cooldown from STATE.md research notes: 30 minutes

### Config Schema Extensions Needed

Current `triageSchema` has: `enabled`, `label.enabled`, `comment.enabled`

Needed additions:
- `triage.labelAllowlist: string[]` -- allowed label patterns (empty = allow all convention-based)
- `triage.cooldownMinutes: number` -- per-issue cooldown (default 30)

### Execution Context Wiring

The executor needs to pass issue tools when mention is on an issue with triage enabled:
1. Load `.kodiai.yml` triage config (already parsed by `loadRepoConfig`)
2. In `executor.ts`, when `isIssueThreadComment` and `config.triage.enabled`, pass `enableIssueTools: true` and `triageConfig` to `buildMcpServers()`
3. Template parser results get injected into the mention prompt as triage context

### File Layout Plan

New files:
- `src/triage/template-parser.ts` -- Parse `.md` issue templates
- `src/triage/template-parser.test.ts` -- Tests
- `src/triage/triage-agent.ts` -- Validate issue against template, generate guidance
- `src/triage/triage-agent.test.ts` -- Tests
- `src/triage/types.ts` -- Triage types

Modified files:
- `src/execution/config.ts` -- Add `labelAllowlist`, `cooldownMinutes` to triageSchema
- `src/execution/executor.ts` -- Wire `enableIssueTools` + `triageConfig` for issue mentions
- `src/handlers/mention.ts` -- Integrate triage validation into issue mention flow
- `src/execution/mention-prompt.ts` -- Add triage context to mention prompt
- `src/execution/mcp/index.ts` -- Already wired, may need minor adjustments

## Validation Architecture

### Dimension 1: Unit Tests
- Template parser: parse valid template, handle missing frontmatter, detect optional sections, match against issue body
- Triage agent: validate issue with all fields, missing fields, no matching template, empty body
- Config: validate new schema fields (labelAllowlist, cooldownMinutes)

### Dimension 2: Integration Tests
- MCP tool wiring: executor enables issue tools when triage.enabled and issue_comment surface
- Mention flow: issue mention triggers triage validation and appends nudge
- Cooldown: second mention within cooldown skips triage nudge

### Dimension 3: Edge Cases
- Issue with no matching template: generic nudge
- Template with no YAML frontmatter: fall back to header matching
- Label doesn't exist on repo: skip label, mention in comment
- Issue body edited after triage: cooldown resets

## RESEARCH COMPLETE

---

*Phase: 105-triage-agent-wiring*
*Research completed: 2026-02-26*
