# Stack Research: v0.21 Issue Triage Foundation

**Domain:** Issue triage automation for GitHub App (adding to existing codebase)
**Researched:** 2026-02-26
**Confidence:** HIGH

## Scope

This research covers ONLY what is needed for the v0.21 milestone: issue corpus, MCP tools for labeling/commenting, template parser, and triage agent. The existing stack (PostgreSQL+pgvector, Bun+Hono, Agent SDK, Octokit, postgres.js, VoyageAI, Vercel AI SDK, etc.) is validated and not re-evaluated.

## Recommended Stack Additions

### New Dependencies: NONE

No new packages are required. Every capability needed for v0.21 is already available in the existing dependency tree.

| Capability Needed | Provided By | Already Installed | Version |
|-------------------|-------------|-------------------|---------|
| Issue label management | `@octokit/rest` | Yes | ^22.0.1 |
| Issue comment creation | `@octokit/rest` | Yes | ^22.0.1 |
| MCP tool definition | `@anthropic-ai/claude-agent-sdk` | Yes | 0.2.37 |
| Schema validation (tool inputs) | `zod` | Yes | ^4.3.6 |
| Issue template YAML parsing | `js-yaml` | Yes | ^4.1.1 |
| Vector storage + HNSW indexes | `postgres` + pgvector | Yes | ^3.4.8 |
| Embedding generation | `voyageai` | Yes | ^0.1.0 |
| Agent execution | `@anthropic-ai/claude-agent-sdk` | Yes | 0.2.37 |
| Issue template markdown parsing | Built-in string/regex | N/A | N/A |

### Rationale: Why No New Dependencies

1. **Octokit already covers label and comment APIs.** `octokit.rest.issues.addLabels()`, `octokit.rest.issues.createComment()`, and `octokit.rest.issues.removeLabel()` are all part of `@octokit/rest` which is already used extensively throughout the codebase (see `src/handlers/mention.ts`, `src/execution/mcp/comment-server.ts`).

2. **Template parsing is simple string extraction.** xbmc/xbmc uses classic markdown issue templates (`.github/ISSUE_TEMPLATE/bug_report.md`), not GitHub YAML form schemas. Template parsing requires extracting section headers and checking if the issue body contains those sections. This is pure string/regex work -- no parsing library needed.

3. **MCP tool pattern is established.** The `createSdkMcpServer` + `tool()` + `z` schema pattern from `@anthropic-ai/claude-agent-sdk` is used in 5 existing MCP servers. Two new tools follow the exact same pattern.

4. **Issue corpus follows review_comments corpus pattern exactly.** The `review_comments` table with HNSW + tsvector indexes, the `ReviewCommentStore` interface, and the chunking/embedding pipeline provide a direct blueprint. The `issues` table schema, store interface, and retrieval integration are structural copies with different columns.

## Integration Points

### 1. MCP Server Registration (`src/execution/mcp/index.ts`)

Two new MCP servers added to `buildMcpServers()`:

```typescript
// New: github_issue_label server
if (deps.enableIssueLabelTools) {
  servers.github_issue_label = createIssueLabelServer(
    deps.getOctokit,
    deps.owner,
    deps.repo,
    deps.botHandles ?? [],
  );
}

// New: dedicated github_issue_comment for triage-specific comments
if (deps.enableIssueCommentTools) {
  servers.github_issue_comment = createIssueCommentServer(
    deps.getOctokit,
    deps.owner,
    deps.repo,
    deps.botHandles ?? [],
    deps.onPublishEvent,
  );
}
```

### 2. Config Schema (`src/execution/config.ts`)

New `triage` section in `repoConfigSchema`:

```typescript
const triageSchema = z.object({
  enabled: z.boolean().default(false),
  labels: z.object({
    missingFields: z.string().default("Ignored rules"),
  }).default({ missingFields: "Ignored rules" }),
}).default({ enabled: false, labels: { missingFields: "Ignored rules" } });
```

Added to `repoConfigSchema` alongside `review`, `mention`, `write`, etc.

### 3. Database Migration

New migration (following existing `src/db/migrate.ts` pattern):

```sql
-- issues table (parallel to review_comments)
CREATE TABLE IF NOT EXISTS issues (
  id SERIAL PRIMARY KEY,
  repo TEXT NOT NULL,
  owner TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  author_login TEXT NOT NULL,
  labels JSONB DEFAULT '[]',
  state TEXT NOT NULL DEFAULT 'open',
  template_name TEXT,
  missing_fields JSONB DEFAULT '[]',
  embedding vector(1024),
  search_text tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))
  ) STORED,
  github_created_at TIMESTAMPTZ NOT NULL,
  github_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(repo, issue_number)
);

CREATE INDEX idx_issues_repo ON issues(repo);
CREATE INDEX idx_issues_embedding ON issues
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX idx_issues_search_text ON issues USING GIN (search_text);
```

### 4. Webhook Router (`src/webhook/router.ts`)

Issue mention events already route through the existing `issue_comment.created` handler in `src/handlers/mention.ts`. The triage agent hooks into the existing mention flow with a conditional branch:

```
issue_comment.created
  -> containsMention() check
  -> if issue (not PR) AND triage.enabled
    -> route to triage agent
  -> else
    -> existing mention handler
```

### 5. Retrieval Integration

Issue corpus integrates into `createRetriever()` as a 5th corpus alongside code, review_comments, wiki_pages, and code_snippets. Follows the same `searchByEmbedding()` + `searchByFullText()` -> `hybridSearchMerge()` -> `crossCorpusRRF()` pipeline.

## Octokit API Surface for Issue Triage

All methods are on `octokit.rest.issues.*` (already authenticated via GitHub App installation tokens):

| Method | Purpose | Used For |
|--------|---------|----------|
| `addLabels({ owner, repo, issue_number, labels })` | Apply labels | Triage: apply "Ignored rules" label |
| `removeLabel({ owner, repo, issue_number, name })` | Remove label | Future: remove label when issue is updated |
| `createComment({ owner, repo, issue_number, body })` | Post comment | Triage: structured guidance comment |
| `listLabelsOnIssue({ owner, repo, issue_number })` | Check existing labels | Idempotency: skip if already labeled |
| `get({ owner, repo, issue_number })` | Fetch issue details | Get current body/labels for triage |

**Required GitHub App permissions:** `issues: write` (already configured for the Kodiai app since it creates comments on issues via mention handling).

## Issue Template Parsing Approach

### Template Format: Classic Markdown (NOT YAML Forms)

xbmc/xbmc uses classic markdown templates at `.github/ISSUE_TEMPLATE/bug_report.md`:

```markdown
---
name: Problem report
about: Create an extensive report to help us document a problem
---
## Bug report
### Describe the bug
### Expected Behavior
### Actual Behavior
...
```

### Parser Strategy: Section Header Extraction

1. Read template files from cloned workspace `.github/ISSUE_TEMPLATE/*.md`
2. Parse YAML frontmatter (`js-yaml` already installed) to get template name/about
3. Extract `##` and `###` headers as required sections
4. Compare against issue body: check which sections are present and which have content
5. Return `{ templateName, requiredSections, missingSections, emptySections }`

No external markdown AST parser needed. Section headers in GitHub issue templates are plain `##`/`###` markers. A regex-based extractor is sufficient and consistent with the codebase's approach (see `sanitizeKodiaiReviewSummary` in `comment-server.ts` which does extensive markdown section validation with regex).

## What NOT to Add

| Do Not Add | Why |
|------------|-----|
| `marked` / `remark` / `unified` markdown parser | Overkill for section header extraction from issue templates. Regex is simpler, faster, and consistent with existing codebase patterns. |
| `gray-matter` YAML frontmatter parser | `js-yaml` already handles this. Just split on `---` delimiters and parse the middle. |
| GitHub Issue Forms YAML schema validator | xbmc/xbmc uses classic markdown templates, not YAML form schemas. Even if they migrate, the form schema generates the same markdown body. |
| Separate GitHub REST client for labels | `@octokit/rest` already provides the full issues API surface. |
| External queue for triage jobs | Triage runs synchronously in the mention handler path, same as all other mention responses. The existing p-queue handles concurrency. |
| New embedding model/provider | VoyageAI `voyage-code-3` works fine for issue text. Issue bodies are natural language, which voyage-code-3 handles well despite the "code" name. |
| `@octokit/webhooks-types` additions | Issue comment webhook types are already defined and used in mention handler. |

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| Regex-based template parser | `remark` AST parser | Template sections are simple `##` headers. AST parsing adds 50+ KB dep for no benefit. |
| Single `issues` table with embedding column | Separate `issues` + `issue_vectors` tables | The issue from #73 mentions `issue_vectors` but the review_comments pattern uses a single table with embedding column. Single table is simpler, proven, and sufficient for the expected issue volume. |
| Triage as mention handler branch | Standalone triage handler | Triage triggers on `@kodiai` mentions in issues. The mention handler already dispatches issue vs. PR context. A branch in the existing flow avoids duplication. |
| `voyage-code-3` for issue embeddings | `voyage-3` (general purpose) | `voyage-code-3` is already configured and produces 1024-dim vectors matching all existing HNSW indexes. Switching models would require separate index dimensions or re-embedding everything. |

## Version Compatibility

All versions are current and compatible -- no changes to `package.json` required.

| Package | Current Version | Compatibility Notes |
|---------|-----------------|---------------------|
| `@octokit/rest` | ^22.0.1 | `issues.addLabels()` available since v18. Fully supported. |
| `@anthropic-ai/claude-agent-sdk` | 0.2.37 | `tool()` + `createSdkMcpServer()` pattern used by all existing MCP servers. |
| `postgres` | ^3.4.8 | Tagged template SQL with pgvector. Same patterns as review_comments schema. |
| `zod` | ^4.3.6 | Schema validation for MCP tool inputs and config schema extension. |
| `js-yaml` | ^4.1.1 | Template frontmatter parsing. Already used in `loadRepoConfig()`. |

## Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| No new deps needed | HIGH | Verified every capability against installed packages and Octokit API surface |
| Octokit label/comment API | HIGH | Methods confirmed in @octokit/rest docs; same auth pattern as existing comment creation |
| Template parsing approach | HIGH | Verified xbmc/xbmc uses classic markdown templates; regex approach proven in codebase |
| Issue corpus schema | HIGH | Direct parallel to review_comments pattern which is battle-tested |
| MCP tool pattern | HIGH | 5 existing servers use identical pattern; verified SDK version supports it |
| Config schema extension | HIGH | Zod schema extension follows exact same pattern as review/mention/write sections |

## Sources

- xbmc/xbmc `.github/ISSUE_TEMPLATE/bug_report.md` -- verified via GitHub API (classic markdown format)
- [GitHub Issue Form Schema Docs](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-githubs-form-schema) -- confirmed xbmc uses classic templates, not YAML forms
- `@octokit/rest` v22 -- `issues.addLabels()`, `issues.createComment()` verified in existing codebase usage
- `src/execution/mcp/comment-server.ts` -- existing MCP server pattern reference
- `src/knowledge/review-comment-store.ts` -- existing corpus store pattern reference
- `src/execution/config.ts` -- existing config schema pattern reference
- `package.json` + `bun.lock` -- current dependency versions verified

---
*Stack research for: v0.21 Issue Triage Foundation*
*Researched: 2026-02-26*
