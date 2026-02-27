# Phase 103: Issue Corpus Schema & Store - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

PostgreSQL issue table with HNSW/tsvector indexes and typed store interface matching existing corpus conventions. Issues and their comments get dedicated vector storage with hybrid search. No triage logic, no MCP tools — those are Phases 104-105.

</domain>

<decisions>
## Implementation Decisions

### Metadata columns
- Store full issue body as text column (not vector-only) for display in triage responses and debugging
- Richer metadata profile beyond the required fields: include assignees (JSONB array with id+login), milestone, reaction_count, is_pull_request flag, locked status
- Core fields: title, issue_number, repo, author_login, created_at, updated_at, closed_at
- Required fields from success criteria: state, author_association, label_names, template_slug, comment_count

### Search behavior
- tsvector fed by title (weight A) + body (weight B) + label names — labels are searchable text
- Hybrid search weighting matches existing corpus pattern (ReviewCommentStore) — consistency over custom tuning
- Search includes closed issues by default — valuable for duplicate detection ("this was already reported and fixed in #123")
- Store exposes `findSimilar(issueNumber, threshold)` method at the store level for reusable, testable duplicate detection

### Embedding scope
- Issue embedding: single vector from title+body concatenation per issue
- Comment embedding: one vector row per comment, with issue_number as foreign key — granular search, individual comment retrieval
- Embedding model: match existing VoyageAI model and dimension used by review comment corpus — no new dependencies

### Sync lifecycle
- Webhook-driven ingestion on issue opened/edited/closed/labeled events — corpus stays fresh automatically
- No automatic backfill on install; provide a CLI tool to manually trigger backfill of existing issues when needed
- Closed issues stay in corpus with state updated to 'closed' — vectors and metadata preserved for history and duplicate detection
- New comments: embed only the new comment (insert new vector row) — existing embeddings stay unchanged, incremental and efficient

### Claude's Discretion
- Label storage format (text[] vs JSONB) — pick based on query patterns needed by triage agent
- Exact tsvector weight configuration for labels (weight C or similar)
- Migration naming and ordering conventions
- Index configuration details beyond the specified HNSW (cosine, m=16)

</decisions>

<specifics>
## Specific Ideas

- CLI backfill tool should paginate through existing open issues via GitHub API and upsert them — user wants manual control over when corpus is populated
- One-row-per-comment design means the issues table and issue_comments table (or a unified corpus table with a type discriminator) need clear foreign key relationships
- findSimilar should be a first-class store method, not something the triage agent has to compose from raw search

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 103-issue-corpus-schema-store*
*Context gathered: 2026-02-26*
