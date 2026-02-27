# Phase 103: Issue Corpus Schema & Store - Research

**Researched:** 2026-02-26
**Status:** Research complete

## Existing Corpus Patterns

### Migration Convention
- Migrations numbered sequentially: `001-initial-schema.sql` through `013-review-clusters.sql`
- Next migration: `014-issues.sql`
- Each migration has a `.down.sql` counterpart (most recent ones like 012/013 omit it)
- Tables use `BIGSERIAL PRIMARY KEY`, `TIMESTAMPTZ NOT NULL DEFAULT now()` for created_at
- Vector column: `embedding vector(1024)` (voyage-code-3, 1024 dims)
- HNSW index: `USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)`
- tsvector: either trigger-based (`review_comments`) or `GENERATED ALWAYS AS` stored column (`code_snippets`)

### Store Factory Pattern
All stores follow the same factory pattern:
```typescript
export function createXxxStore(opts: { sql: Sql; logger: Logger }): XxxStore { ... }
```
- Factory returns an object implementing the store interface
- Types live in a separate `xxx-types.ts` file
- Store implementations in `xxx-store.ts`
- Tests in `xxx-store.test.ts`
- Uses `postgres.js` tagged template literals for queries
- Float32Array to pgvector conversion via `float32ArrayToVectorString()` helper (repeated in each store)

### Store Interface Pattern (ReviewCommentStore reference)
Key methods:
- `writeChunks()` — bulk upsert with ON CONFLICT DO NOTHING
- `softDelete()` — sets `deleted = true`
- `updateChunks()` — transaction: delete old + insert new
- `searchByEmbedding()` — vector cosine distance search, filtered by repo + stale + deleted
- `searchByFullText()` — tsvector search with `ts_rank`
- `countByRepo()` — count non-deleted records
- `getSyncState()` / `updateSyncState()` — cursor-based backfill tracking

### Retrieval Integration
- `createRetriever()` in `retrieval.ts` accepts optional store deps
- Each corpus has a `searchXxx()` retrieval function (e.g., `searchReviewComments()`)
- Retrieval functions wrap store's `searchByEmbedding` + `searchByFullText` with fail-open semantics
- Unified pipeline normalizes all results to `UnifiedRetrievalChunk`
- Cross-corpus RRF merges all corpora
- **Note:** Issue corpus is explicitly deferred from cross-corpus retrieval (v0.22 per REQUIREMENTS.md out-of-scope)

### Wiring in index.ts
- Stores created after migrations: `const store = createXxxStore({ sql, logger })`
- Passed as optional deps to `createRetriever()`
- Pattern: create store, log initialization, pass to retriever

## Schema Design Decisions

### Issues Table
Two tables needed per CONTEXT.md decisions:
1. `issues` — one row per issue, single embedding from title+body
2. `issue_comments` — one row per comment, individual embedding

**Issues table columns** (from CONTEXT.md decisions):
- `id BIGSERIAL PRIMARY KEY`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `repo TEXT NOT NULL` (owner/repo format like other stores)
- `owner TEXT NOT NULL`
- `issue_number INTEGER NOT NULL`
- `title TEXT NOT NULL`
- `body TEXT` (full body for display)
- `state TEXT NOT NULL DEFAULT 'open'` (required by success criteria)
- `author_login TEXT NOT NULL`
- `author_association TEXT` (required by success criteria)
- `label_names TEXT[]` (CONTEXT.md gives discretion; text[] is better for `@>` containment queries + tsvector feeding)
- `template_slug TEXT` (required by success criteria)
- `comment_count INTEGER NOT NULL DEFAULT 0` (required by success criteria)
- `assignees JSONB` (CONTEXT.md: JSONB array with id+login)
- `milestone TEXT`
- `reaction_count INTEGER NOT NULL DEFAULT 0`
- `is_pull_request BOOLEAN NOT NULL DEFAULT false`
- `locked BOOLEAN NOT NULL DEFAULT false`
- `embedding vector(1024)`
- `embedding_model TEXT`
- `search_tsv tsvector` (trigger-updated: title weight A + body weight B + labels weight C)
- `github_created_at TIMESTAMPTZ NOT NULL`
- `github_updated_at TIMESTAMPTZ`
- `closed_at TIMESTAMPTZ`
- `UNIQUE(repo, issue_number)`

**Issue_comments table columns:**
- `id BIGSERIAL PRIMARY KEY`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `repo TEXT NOT NULL`
- `issue_number INTEGER NOT NULL`
- `comment_github_id BIGINT NOT NULL`
- `author_login TEXT NOT NULL`
- `author_association TEXT`
- `body TEXT NOT NULL`
- `embedding vector(1024)`
- `embedding_model TEXT`
- `search_tsv tsvector` (trigger-updated from body)
- `github_created_at TIMESTAMPTZ NOT NULL`
- `github_updated_at TIMESTAMPTZ`
- `UNIQUE(repo, comment_github_id)`

### Indexes
Following existing conventions:
- `idx_issues_repo` — B-tree on repo
- `idx_issues_repo_number` — B-tree on (repo, issue_number)
- `idx_issues_state` — B-tree on state
- `idx_issues_author` — B-tree on author_login
- `idx_issues_embedding_hnsw` — HNSW vector cosine (m=16, ef_construction=64)
- `idx_issues_search_tsv` — GIN on search_tsv
- `idx_issues_labels` — GIN on label_names (for containment queries)
- `idx_issue_comments_repo_issue` — B-tree on (repo, issue_number)
- `idx_issue_comments_embedding_hnsw` — HNSW vector cosine
- `idx_issue_comments_search_tsv` — GIN on search_tsv

### tsvector Strategy
Use trigger-based approach (matching `review_comments` pattern):
```sql
-- Issues: weighted tsvector from title (A) + body (B) + labels (C)
NEW.search_tsv := setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
                  setweight(to_tsvector('english', COALESCE(NEW.body, '')), 'B') ||
                  setweight(to_tsvector('english', COALESCE(array_to_string(NEW.label_names, ' '), '')), 'C');
```

### Store Interface
```typescript
export type IssueStore = {
  upsert(issue: IssueInput): Promise<void>;
  delete(repo: string, issueNumber: number): Promise<void>;
  getByNumber(repo: string, issueNumber: number): Promise<IssueRecord | null>;
  searchByEmbedding(params: { queryEmbedding: Float32Array; repo: string; topK: number }): Promise<IssueSearchResult[]>;
  searchByFullText(params: { query: string; repo: string; topK: number }): Promise<IssueSearchResult[]>;
  findSimilar(repo: string, issueNumber: number, threshold?: number): Promise<IssueSearchResult[]>;
  countByRepo(repo: string): Promise<number>;

  // Comment methods
  upsertComment(comment: IssueCommentInput): Promise<void>;
  deleteComment(repo: string, commentGithubId: number): Promise<void>;
  getCommentsByIssue(repo: string, issueNumber: number): Promise<IssueCommentRecord[]>;
  searchCommentsByEmbedding(params: { queryEmbedding: Float32Array; repo: string; topK: number }): Promise<IssueCommentSearchResult[]>;
};
```

Key design: `findSimilar()` is a first-class method per CONTEXT.md — it retrieves an issue's embedding and does a vector search excluding itself.

## Implementation Risks

1. **Label storage**: `TEXT[]` chosen for query ergonomics. The triage agent (Phase 105) will query `label_names @> ARRAY['bug']` — array containment is indexed by GIN.
2. **Two-table design**: issues and issue_comments are separate tables (not a unified corpus with type discriminator). This is simpler and matches the context decision for "one-row-per-comment with issue_number as foreign key."
3. **No cross-corpus wiring yet**: The issue store will NOT be wired into `createRetriever()` — that's deferred to v0.22 per requirements out-of-scope.

## File Inventory

Files to create:
- `src/db/migrations/014-issues.sql` — schema migration
- `src/db/migrations/014-issues.down.sql` — rollback
- `src/knowledge/issue-types.ts` — TypeScript types
- `src/knowledge/issue-store.ts` — store factory implementation
- `src/knowledge/issue-store.test.ts` — store unit tests

Files to modify:
- `src/knowledge/index.ts` — export new store factory and types
- `src/index.ts` — create and wire issue store instance

## Testing Strategy

Follow `review-comment-store.test.ts` pattern:
- Use real PostgreSQL (same connection string as other tests)
- Run migrations in beforeAll
- Clean tables in beforeEach
- Test: upsert creates record, upsert updates on conflict, delete removes, getByNumber retrieves
- Test: searchByEmbedding returns closest vectors, searchByFullText uses tsvector
- Test: findSimilar finds related issues by embedding, excludes self
- Test: upsertComment/deleteComment/getCommentsByIssue CRUD
- Test: countByRepo

---

## RESEARCH COMPLETE

*Phase: 103-issue-corpus-schema-store*
*Research completed: 2026-02-26*
