# Technology Stack

**Project:** Kodiai v0.19 Intelligent Retrieval Enhancements
**Researched:** 2026-02-25

## Recommendation: Zero New Dependencies

All four v0.19 features can be implemented with the existing dependency set. No new npm packages are needed. This is a stack *extension* milestone, not a stack *addition* milestone.

## Existing Stack (Unchanged)

| Technology | Version | Purpose | Status |
|------------|---------|---------|--------|
| Bun | latest | Runtime | Keep |
| Hono | ^4.11.8 | HTTP server | Keep |
| postgres (postgres.js) | ^3.4.8 | PostgreSQL client | Keep |
| pgvector extension | installed | Vector similarity search | Keep |
| voyageai | ^0.1.0 | Embeddings (voyage-code-3, 1024 dims) | Keep |
| @octokit/rest | ^22.0.1 | GitHub API client | Keep -- already has all needed endpoints |
| @anthropic-ai/claude-agent-sdk | ^0.2.37 | Agent loop, MCP server creation | Keep |
| @modelcontextprotocol/sdk | ^1.26.0 | MCP protocol | Keep |
| zod | ^4.3.6 | Schema validation | Keep |
| pino | ^10.3.0 | Logging | Keep |
| picomatch | ^4.0.2 | Glob matching | Keep |

## Feature-by-Feature Stack Analysis

### 1. Language-Aware Retrieval Boosting

**What exists:**
- `retrieval-rerank.ts` already does language-based distance adjustment (`sameLanguageBoost: 0.85`, `crossLanguagePenalty: 1.15`)
- `classifyFileLanguage()` in `diff-analysis.ts` maps 20+ extensions to language names
- `learning_memories` table has `file_path TEXT` column but **no `language` column**

**What's needed:**
- **DB migration 007**: Add `language TEXT` column to `learning_memories` table, backfill from `file_path` using `classifyFileLanguage()`, add partial indexes per common language
- **Schema extension**: Add `language` field to `LearningMemoryRecord` type
- **Retrieval filter**: Add optional `WHERE language = $1` to vector search queries for same-language pre-filtering before RRF

**Stack impact:** None. Uses existing `postgres` client for migration, existing `classifyFileLanguage()` for classification. The pgvector post-filtering approach (iterative scan) is sufficient at our data scale -- we don't need pre-filtering since learning_memories is unlikely to exceed 100K rows. A simple `WHERE language = $lang` in the vector query with increased `hnsw.ef_search` handles this.

**Confidence:** HIGH -- verified pgvector filtering docs and existing codebase patterns.

### 2. Hunk-Level Code Snippet Embedding

**What exists:**
- `voyageai` SDK with `voyage-code-3` model (32K token context, 1024-dim output)
- `createEmbeddingProvider()` wraps VoyageAI with fail-open semantics
- Review comment chunker uses whitespace-based token counting
- Snippet anchoring in `retrieval-snippets.ts` already locates code lines

**What's needed:**
- A diff hunk parser that extracts individual code hunks from PR diffs (parse unified diff `@@` blocks)
- Embed each hunk as a standalone document via existing `embeddingProvider.generate()`
- Store hunk embeddings in a new `code_snippets` table (or extend `learning_memories`) with metadata: file_path, start_line, end_line, language, pr_number, hunk_text
- Retrieval integration: add `code_snippet` as a fourth corpus source in `createRetriever()`

**Stack impact:** None. The existing `voyageai` SDK already supports embedding arbitrary text. voyage-code-3's 32K context window easily handles individual hunks. Unified diff parsing is string manipulation -- no library needed.

**Why no diff parser library:** Unified diff format is simple (`@@`, `+`, `-` prefixed lines). Bun's string methods handle it. Adding a dependency for this would be over-engineering given the narrow scope (extract hunks, not full patch analysis).

**Confidence:** HIGH -- verified voyage-code-3 specs (32K tokens, 1024 dims). The model is explicitly designed for code-to-code and text-to-code retrieval.

### 3. [depends] PR Deep Review Pipeline

**What exists:**
- Three-stage dep bump detector (`detectDepBump`, `extractDepBumpDetails`, `classifyDepBump`)
- `dep-bump-enrichment.ts` already fetches: security advisories, changelogs via GitHub Releases API + CHANGELOG.md, breaking changes
- `resolveGitHubRepo()` resolves npm/python/ruby packages to GitHub repos
- Composite merge confidence scoring
- Usage analyzer for workspace-level impact detection
- Scope coordinator for multi-package groups

**What's needed for [depends] PR deep review:**
- **[depends] detection**: Extend `detectDepBump()` to also match `[depends]` title prefix pattern (Kodi convention: "[depends] Bump zlib 1.3.2"). This is a regex addition, not a stack addition
- **Deeper changelog analysis**: The existing `fetchChangelog()` fetches release notes but truncates at 1500 chars. For deep review, increase budget or add a summarization pass using Claude (via the existing agent SDK)
- **Impact assessment**: Existing `usage-analyzer.ts` does workspace grep for package usage. Extend to also parse CMakeLists.txt / depends/ directory structure (Kodi-specific build system patterns)
- **Hash/URL validation**: For C/C++ dependency bumps that modify hash files (SHA256, URL changes in `depends/`), add validation logic. Pure string comparison -- no library needed
- **Structured review comment format**: New prompt template for dep-bump-specific review output. Uses existing MCP inline review server

**Stack impact:** None. All Octokit endpoints needed (releases, content, advisories) are already used in `dep-bump-enrichment.ts`. Claude summarization uses existing agent SDK. Build file parsing is regex/string matching.

**Confidence:** HIGH -- all underlying APIs and libraries already in use.

### 4. Unrelated CI Failure Recognition

**What exists:**
- `ci-status-server.ts` MCP tool: `get_ci_status` (lists workflow runs) and `get_workflow_run_details` (lists jobs with failed steps)
- Octokit has full Actions API support: `listWorkflowRunsForRepo`, `listJobsForWorkflowRun`

**What's needed:**
- **Check run annotations**: Use `octokit.rest.checks.listForRef()` to get check runs for the PR's head SHA, then `octokit.rest.checks.listAnnotations()` for failed check details
- **Scope comparison logic**: Compare failed workflow's trigger files (workflow YAML `paths:` / `paths-ignore:`) against PR changed files to determine overlap
- **Heuristic classifier**: Pure function that takes (PR changed files, failed job name, failed step name, error message) and returns `related | unrelated | unknown` with reasoning
- **Annotation publishing**: Comment on PR with unrelated failure analysis. Uses existing GitHub comment publishing via Octokit

**Stack impact:** None. The Octokit REST client (`@octokit/rest ^22.0.1`) already exposes:
- `octokit.rest.checks.listForRef({ owner, repo, ref })` -- list check runs
- `octokit.rest.checks.listAnnotations({ owner, repo, check_run_id })` -- get annotations
- `octokit.rest.actions.listWorkflowRunsForRepo()` -- already used
- `octokit.rest.actions.listJobsForWorkflowRun()` -- already used
- `octokit.rest.actions.downloadJobLogsForWorkflowRun()` -- available if log parsing needed

The GitHub App needs `checks:read` permission (likely already granted for CI status MCP tool).

**Confidence:** HIGH -- verified Octokit types and GitHub API docs.

## What NOT to Add

| Rejected Dependency | Why Not |
|---------------------|---------|
| `diff` / `diff2html` / `parse-diff` | Unified diff parsing is 20 lines of code for hunk extraction. A library adds 100KB+ for features we won't use |
| `semver` | Already have `parseSemver()` in `dep-bump-detector.ts` covering our needs |
| Tree-sitter / language parsers | Overkill for v0.19 scope. Language classification by file extension is sufficient for boosting. AST-level analysis is a future enhancement |
| OpenAI embeddings / alternative providers | voyage-code-3 is SOTA for code retrieval. No reason to switch or add alternatives |
| Redis / external cache | In-memory + PostgreSQL handles all caching needs at current scale |
| LangChain / LlamaIndex | Already have a clean, purpose-built retrieval pipeline. Framework would add complexity without value |

## Database Migrations Needed

Next migration number: **007**

| Migration | Purpose | Tables/Columns Affected |
|-----------|---------|------------------------|
| 007-language-column.sql | Add `language TEXT` column to `learning_memories`; backfill from `file_path`; add index | `learning_memories` |
| 008-code-snippets.sql (if hunk embedding ships) | New `code_snippets` table for hunk-level embeddings | New table: `code_snippets` |

### 007 Migration Detail

```sql
-- Add language column
ALTER TABLE learning_memories ADD COLUMN IF NOT EXISTS language TEXT;

-- Backfill: will be done by application code using classifyFileLanguage()
-- since SQL CASE for 20+ extensions would be unwieldy

-- Index for language-filtered vector queries
CREATE INDEX IF NOT EXISTS idx_memories_language ON learning_memories(language);
```

### 008 Migration Detail (exploratory -- only if hunk embedding ships)

```sql
CREATE TABLE IF NOT EXISTS code_snippets (
  id BIGSERIAL PRIMARY KEY,
  repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  language TEXT,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  hunk_text TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  embedding_dim INTEGER NOT NULL,
  embedding vector(1024),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_snippets_repo ON code_snippets(repo);
CREATE INDEX IF NOT EXISTS idx_snippets_language ON code_snippets(language);
```

## GitHub App Permissions

| Permission | Status | Needed For |
|------------|--------|-----------|
| `checks:read` | Verify -- likely already granted | CI failure recognition (list check runs, annotations) |
| `actions:read` | Already used | CI status MCP tool, workflow run queries |
| `contents:read` | Already used | CHANGELOG.md fetching, file content |
| `pull_requests:write` | Already used | Publishing review comments |
| `security_advisories:read` | Already used | Advisory lookup for dep bumps |

## VoyageAI Embedding Budget Impact

| Feature | Estimated Additional Embeddings/Month | Cost Impact |
|---------|---------------------------------------|-------------|
| Language-aware boosting | 0 (uses existing embeddings, just adds metadata) | None |
| Hunk-level embedding | ~50-200 per PR with hunks (exploratory) | Low -- voyage-code-3 pricing is per-token, hunks are small |
| [depends] deep review | 0 (uses existing retrieval, adds prompt analysis) | None |
| CI failure recognition | 0 (no embeddings, uses API + heuristics) | None |

## Integration Points Summary

| Feature | Touches | New Files Expected |
|---------|---------|-------------------|
| Language boosting | `memory-store.ts`, `retrieval-rerank.ts`, migration 007 | 0 new files, extend existing |
| Hunk embedding | `knowledge/` module, `retrieval.ts`, migration 008 | ~3-4 new files (parser, store, retrieval integration) |
| [depends] deep review | `dep-bump-detector.ts`, `dep-bump-enrichment.ts`, `review-prompt.ts` | ~1-2 new files (deep review pipeline, prompt template) |
| CI failure recognition | `ci-status-server.ts` or new module, handler integration | ~2-3 new files (classifier, publisher, handler wiring) |

## Sources

- pgvector filtering: [pgvector GitHub](https://github.com/pgvector/pgvector), [Clarvo filtered queries guide](https://www.clarvo.ai/blog/optimizing-filtered-vector-queries-from-tens-of-seconds-to-single-digit-milliseconds-in-postgresql)
- voyage-code-3: [Voyage AI blog](https://blog.voyageai.com/2024/12/04/voyage-code-3/), [Voyage AI docs](https://docs.voyageai.com/docs/embeddings)
- GitHub Actions API: [Workflow runs REST API](https://docs.github.com/en/rest/actions/workflow-runs), [Check runs REST API](https://docs.github.com/en/rest/checks/runs)
- Octokit checks API: [Octokit REST checks](https://actions-cool.github.io/octokit-rest/api/checks/)
- Existing codebase: `src/knowledge/retrieval.ts`, `src/lib/dep-bump-detector.ts`, `src/lib/dep-bump-enrichment.ts`, `src/execution/mcp/ci-status-server.ts`
