# Architecture Research

**Domain:** Issue triage agent integration into existing GitHub App
**Researched:** 2026-02-26
**Confidence:** HIGH -- all integration points verified against existing source code

## System Overview

The triage feature integrates at four well-defined seams: database schema, MCP tool registry, mention handler routing, and config schema. No new architectural patterns are needed -- the existing patterns (createRetriever factory, in-process MCP servers, event router dispatch, config-gated features) are reused directly.

```
Webhook Layer (existing, unchanged)
  issue_comment.created
        |
        v
Event Router (existing, unchanged)
  register("issue_comment.created", handleMention)
        |
        v
Mention Handler (MODIFY: add triage branch)
  normalizeIssueComment() -> MentionEvent
    surface: "issue_comment", prNumber: undefined
  isIssueThreadComment = true (line 802)
        |
        +-- config.triage.enabled? ---YES---> [NEW] Triage Path
        |                                      |
        NO                                     +-> Issue Template Parser [NEW]
        |                                      +-> Triage Prompt Builder [NEW]
        v                                      +-> executor.execute() (existing)
  Existing read/write                                |
  mention path                                 MCP Servers:
                                                 github_issue_label [NEW]
                                                 github_issue_comment [NEW]
                                                      |
                                                      v
                                                GitHub API (label + comment)

Data Layer (NEW: issue corpus)
  issues table (HNSW + tsvector)
  issue-store.ts (factory)
```

### Component Responsibilities

| Component | Responsibility | Status |
|-----------|---------------|--------|
| Event Router (`src/webhook/router.ts`) | Dispatch `issue_comment.created` to handlers | EXISTS -- no changes needed |
| Mention Types (`src/handlers/mention-types.ts`) | Normalize webhook payload to `MentionEvent` | EXISTS -- already handles `surface: "issue_comment"` |
| Mention Handler (`src/handlers/mention.ts`) | Route mention to triage or read/write path | MODIFY -- add triage branch before write-intent parsing |
| Config Parser (`src/execution/config.ts`) | Parse `.kodiai.yml` with triage section | MODIFY -- add `triageSchema` |
| MCP Index (`src/execution/mcp/index.ts`) | Wire MCP servers into executor | MODIFY -- add issue tool flags |
| Issue Label Server | `github_issue_label` MCP tool (add/remove labels) | NEW |
| Issue Comment Server | `github_issue_comment` MCP tool (post comments) | NEW |
| Issue Template Parser | Read templates from workspace, extract required fields, diff against body | NEW |
| Triage Prompt Builder | Build triage agent prompt from template diff + issue context | NEW |
| Issue Store | Issue vector store factory (CRUD, embedding, search) | NEW |
| Migration 014 | Issue corpus schema (table, indexes, tsvector trigger) | NEW |

## Recommended Project Structure

New files only -- existing structure is unchanged:

```
src/
├── db/
│   └── migrations/
│       └── 014-issues.sql                  # Issue corpus schema
├── knowledge/
│   └── issue-store.ts                      # Issue vector store (factory + types)
├── execution/
│   ├── mcp/
│   │   ├── issue-label-server.ts           # github_issue_label MCP tool
│   │   ├── issue-comment-server.ts         # github_issue_comment MCP tool
│   │   └── index.ts                        # MODIFY: wire issue tools
│   ├── issue-template-parser.ts            # Template parsing + validation
│   ├── triage-prompt.ts                    # Triage agent prompt builder
│   └── config.ts                           # MODIFY: add triage schema
└── handlers/
    └── mention.ts                          # MODIFY: add triage routing branch
```

### Structure Rationale

- **MCP tools in `execution/mcp/`:** All existing MCP servers live here. New issue tools follow the same pattern.
- **Template parser in `execution/`:** Part of the execution pipeline (prompt building), not knowledge retrieval. Similar to existing `issue-code-context.ts` which also lives in `execution/`.
- **Issue store in `knowledge/`:** All corpus stores (review-comment-store, wiki-store, code-snippet-store) live here. Issue store follows the same convention.

## Architectural Patterns

### Pattern 1: Config-Gated Feature Branch

**What:** Feature disabled by default, enabled via `.kodiai.yml`. Routing decision happens inside existing handler.
**When to use:** Every new feature that changes behavior.
**Trade-offs:** Simple on/off gating. No gradual rollout, but appropriate for private-audience app.

**Precedent:** `write.enabled` (default false), `review.enabled` (default true), `mention.enabled` (default true)

```typescript
// In repoConfigSchema (config.ts):
const triageSchema = z.object({
  enabled: z.boolean().default(false),
  missingFieldsLabel: z.string().default("Ignored rules"),
  prompt: z.string().optional(),
}).default({
  enabled: false,
  missingFieldsLabel: "Ignored rules",
});

// Add to repoConfigSchema object:
triage: triageSchema,
```

### Pattern 2: In-Process MCP Server

**What:** Agent tools created via `createSdkMcpServer()`, registered in `buildMcpServers()`.
**When to use:** Agent needs to interact with external APIs during execution.
**Trade-offs:** Type-safe, testable, in-process (no IPC overhead). Must follow sanitization conventions.

**Existing examples:** `github_comment`, `github_inline_comment`, `github_ci`, `review_checkpoint`

Key constraints from existing implementations:
- Sanitize outgoing mentions via `sanitizeOutgoingMentions()` on all publish paths
- Return `{ content: [{ type: "text" as const, text: JSON.stringify(result) }] }` shape
- Wrap errors with `isError: true`
- Accept `getOctokit: () => Promise<Octokit>` (lazy auth)

```typescript
export function createIssueLabelServer(
  getOctokit: () => Promise<Octokit>,
  owner: string,
  repo: string,
) {
  return createSdkMcpServer({
    name: "github_issue_label",
    version: "0.1.0",
    tools: [
      tool("add_labels", "Add labels to a GitHub issue", {
        issueNumber: z.number(),
        labels: z.array(z.string()),
      }, async ({ issueNumber, labels }) => {
        try {
          const octokit = await getOctokit();
          await octokit.rest.issues.addLabels({
            owner, repo, issue_number: issueNumber, labels,
          });
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ success: true }) }],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text" as const, text: `Error: ${message}` }],
            isError: true,
          };
        }
      }),
    ],
  });
}
```

### Pattern 3: Mention Handler Internal Routing

**What:** Adding a routing branch inside the existing `handleMention` function rather than registering a separate handler.
**When to use:** When the new feature triggers on the same webhook event as an existing feature.
**Trade-offs:** Avoids double-handler race conditions. Keeps bot-filter, mention-check, config-load in one place. Slightly increases handler complexity but maintains single-responsibility for the `issue_comment.created` event key.

**Critical constraint:** The event router runs ALL registered handlers for a key via `Promise.allSettled` (router.ts line 99). Registering a second handler for `issue_comment.created` would cause BOTH to fire, creating duplicate reactions and comments.

```typescript
// Insert BEFORE parseWriteIntent (~line 803 in mention.ts):
if (isIssueThreadComment && config.triage?.enabled) {
  await handleTriageMention({ mention, config, workspace, octokit, ... });
  return; // Skip the general-purpose mention path
}
```

## Data Flow

### Triage Mention Flow (Primary)

```
1. GitHub sends issue_comment.created webhook
2. Event router dispatches to handleMention (existing registration)
3. normalizeIssueComment() produces MentionEvent:
   - surface: "issue_comment" (NOT "pr_comment" -- issue.pull_request is falsy)
   - prNumber: undefined
   - issueNumber: issue.number
4. isIssueThreadComment = true (line 802: event.name==="issue_comment" && prNumber===undefined)
5. Bot filter + mention check (existing)
6. workspaceManager.acquire() -> shallow clone (existing)
7. loadRepoConfig() from workspace .kodiai.yml (existing)
8. [NEW] config.triage.enabled check:
   a. parseIssueTemplates(workspaceDir) -- reads .github/ISSUE_TEMPLATE/*.yml
   b. validateIssueAgainstTemplate(issueBody, matchedTemplate)
   c. buildTriagePrompt({ mention, templateDiff, config })
   d. executor.execute({
        prompt,
        mcpServers: { github_issue_label, github_issue_comment },
        allowedTools: ["mcp__github_issue_label__*", "mcp__github_issue_comment__*"],
      })
   e. Agent posts comment with guidance and/or applies "Ignored rules" label
9. [EXISTING] If NOT config.triage.enabled: falls through to existing read/write path
```

### Issue Template Parser Data Flow

```
Workspace clone (.github/ISSUE_TEMPLATE/)
    |
    v
Read *.yml files -> parse YAML frontmatter
    |
    v
Extract: name, description, body[] fields
  Each field: id, label, type (input|textarea|dropdown|checkboxes), required
    |
    v
Match template to issue by name/title heuristic
    |
    v
Diff issue body against matched template:
  - Which required fields are present?
  - Which are missing or empty?
    |
    v
TemplateValidationResult {
  matchedTemplate, missingRequiredFields[], presentFields[], isValid
}
```

### Key Data Flows

1. **Triage execution:** Webhook -> mention handler -> triage branch -> template parser -> executor with issue MCP tools -> GitHub API (comment + label). One-shot execution, no conversation turns.
2. **Issue corpus write:** Migration creates tables. Issue store provides CRUD. NOT wired to retriever in v0.21 -- the triage agent reads the issue body from webhook payload, not from vector search.

## Scaling Considerations

Not a concern for v0.21. Triage adds at most 1 LLM call per `@kodiai` mention on issues. Current volume is low (single-digit mentions per day).

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Current (~5 mentions/day) | In-process, synchronous. No concerns. |
| 100 issues/day | Issue store ingestion becomes relevant. Add webhook handler for `issues.opened` to backfill corpus. |
| 1000+ issues/day | Consider separating triage into its own worker queue to avoid blocking PR reviews. |

## Anti-Patterns

### Anti-Pattern 1: Separate Event Handler for Triage

**What people do:** Register a new handler for `issue_comment.created` alongside the mention handler.
**Why it's wrong:** The event router runs ALL handlers via `Promise.allSettled`. Both handlers fire for every issue comment, creating race conditions -- double eye reactions, double comments, duplicated config loading, duplicated bot-filter checks.
**Do this instead:** Add a triage routing decision inside the existing `handleMention` function. The `isIssueThreadComment` flag (line 802) already cleanly identifies pure issue mentions.

### Anti-Pattern 2: Reusing github_comment MCP Server for Triage

**What people do:** Have the triage agent post comments via the existing `github_comment` server.
**Why it's wrong:** The existing comment server has review-specific validators: `sanitizeKodiaiReviewSummary()` enforces Five-Section template (What Changed / Strengths / Observations / Suggestions / Verdict), `sanitizeKodiaiDecisionResponse()` enforces APPROVE/NOT APPROVED format, `sanitizeKodiaiReReviewSummary()` enforces delta template. Triage comments would be REJECTED by these validators.
**Do this instead:** Create a separate `github_issue_comment` MCP server with mention-only sanitization (sanitizeOutgoingMentions, no template validation).

### Anti-Pattern 3: Premature Retrieval Integration

**What people do:** Immediately wire the issue corpus into `createRetriever()` as a 5th fan-out.
**Why it's wrong:** v0.21 scope is triage (validate template, apply labels). The triage agent reads the current issue from the webhook payload, not historical issues via vector search. Adding a 5th corpus to the already-complex 7-search fan-out adds latency with zero triage benefit.
**Do this instead:** Build the schema and store now (tables ready for future ingestion). Wire into retriever in a later milestone when duplicate detection or similar-issue linking is needed.

### Anti-Pattern 4: Skipping Workspace Clone

**What people do:** Run triage without cloning the repo since "no code changes are needed."
**Why it's wrong:** The issue template parser needs `.github/ISSUE_TEMPLATE/` files from the repository. Without a clone, templates cannot be parsed.
**Do this instead:** Use existing `workspaceManager.acquire()` for a shallow clone. The clone is lightweight (depth=50) and template files are tiny YAML.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| GitHub Issues API | `octokit.rest.issues.addLabels()` | Via MCP tool; needs `Issues: Read and write` permission (already granted) |
| GitHub Issues API | `octokit.rest.issues.createComment()` | Via MCP tool; same permission |
| GitHub Issues API | `octokit.rest.issues.removeLabel()` | Optional for label cleanup; same permission |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Mention handler -> Triage path | Direct function call (same file or imported) | Early return prevents fallthrough to read/write path |
| Triage path -> Executor | `executor.execute()` with triage-specific MCP config | Existing executor interface, no changes |
| Triage path -> Template parser | Direct import, pure function | No async dependencies beyond filesystem reads |
| buildMcpServers -> Issue tools | New `enableIssueTools` flag in deps | Follows existing `enableInlineTools` / `enableCommentTools` pattern |
| Config schema -> Triage section | New `triage` key in `repoConfigSchema` | Section-fallback parsing handles invalid triage config gracefully |

## New vs Modified Summary

### New Components (6 files + tests)

| File | Purpose | Dependencies |
|------|---------|-------------|
| `src/db/migrations/014-issues.sql` | Issue corpus schema | PostgreSQL, pgvector |
| `src/knowledge/issue-store.ts` | Issue vector store factory | `src/db/client.ts`, embedding types |
| `src/execution/mcp/issue-label-server.ts` | Label MCP tool | Agent SDK, Octokit |
| `src/execution/mcp/issue-comment-server.ts` | Comment MCP tool | Agent SDK, Octokit, sanitizer |
| `src/execution/issue-template-parser.ts` | Template parsing + validation | Node fs, js-yaml |
| `src/execution/triage-prompt.ts` | Triage agent prompt builder | Template parser types |

### Modified Components (3 files)

| File | Change | Scope |
|------|--------|-------|
| `src/execution/config.ts` | Add `triageSchema` to `repoConfigSchema` | ~15 lines |
| `src/execution/mcp/index.ts` | Wire issue tools into `buildMcpServers()` | ~15 lines |
| `src/handlers/mention.ts` | Add triage routing branch before write-intent parsing | ~30 lines |

### Unchanged Components

| File | Why Unchanged |
|------|--------------|
| `src/webhook/router.ts` | `issue_comment.created` already dispatched |
| `src/handlers/mention-types.ts` | `normalizeIssueComment` already handles this surface |
| `src/knowledge/retrieval.ts` | Issue corpus not wired into retriever in v0.21 |
| `src/execution/executor.ts` | Already supports arbitrary MCP configs |
| `src/execution/mention-context.ts` | Not used by triage path |
| `src/execution/mention-prompt.ts` | Not used by triage path (separate triage prompt) |

## Build Order

```
Phase 1: Schema + Store (independent, no deps)
  014-issues.sql -> issue-store.ts + tests

Phase 2: MCP Tools (independent, can run parallel with Phase 1)
  issue-label-server.ts + tests
  issue-comment-server.ts + tests
  Wire into mcp/index.ts

Phase 3: Triage Logic (depends on Phase 1 for store, Phase 2 for tools)
  issue-template-parser.ts + tests
  triage-prompt.ts + tests
  Config schema: add triageSchema
  Mention handler: add triage routing branch
  Integration test: end-to-end triage flow
```

Phases 1 and 2 are independent and can execute in parallel. Phase 3 depends on both.

## Sources

- `src/webhook/router.ts` -- event dispatch pattern, handler isolation via Promise.allSettled
- `src/handlers/mention.ts` -- mention handler, isIssueThreadComment detection (line 802), write-intent parsing
- `src/handlers/mention-types.ts` -- MentionEvent normalization, surface classification
- `src/execution/mcp/index.ts` -- buildMcpServers wiring pattern (lines 18-106)
- `src/execution/mcp/comment-server.ts` -- existing MCP tool pattern with review sanitization
- `src/execution/config.ts` -- repoConfigSchema, section-fallback parsing (lines 464-488)
- `src/knowledge/retrieval.ts` -- createRetriever pattern, 7-search fan-out
- `src/execution/issue-code-context.ts` -- existing issue-aware code context builder
- GitHub Issue #73 -- v0.21 requirements and phase breakdown

---
*Architecture research for: Issue triage integration into Kodiai GitHub App*
*Researched: 2026-02-26*
