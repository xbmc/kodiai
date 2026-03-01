# Phase 109 Context: Issue Corpus Retrieval Integration

> Decisions made via `--auto` flag based on codebase analysis of existing retrieval patterns

## 1. Issue Search Strategy

**Decision:** Hybrid search (vector + BM25), matching wiki and review_comment patterns.

**Rationale:** Issues contain structured natural language (titles, descriptions, comments) similar to wiki pages. BM25 catches exact issue numbers, error messages, and component names that vector search may miss. The hybrid infrastructure already exists in `hybrid-search.ts`.

**Implementation guidance:**
- Add BM25 indexing for issue corpus alongside existing vector embeddings
- Use same `hybridSearchMerge()` RRF pattern as wiki/review_comment sources
- Issue title should be weighted higher than body/comments in BM25

## 2. Per-Trigger Weight Tuning

**Decision:** Issue weight configuration per trigger type:

| Trigger | Issue Weight | Rationale |
|---------|-------------|-----------|
| `pr_review` | 0.8 | Lower — issues provide context but code/review findings dominate |
| `issue` | 1.5 | Highest — issue queries benefit most from related issue context |
| `question` | 1.2 | High — questions about issues/bugs benefit from corpus |
| `slack` | 1.0 | Neutral — general queries get balanced weighting |

**Implementation guidance:**
- Add `issue` key to each trigger's weight map in `SOURCE_WEIGHTS`
- These are starting values; can be tuned based on retrieval quality observation

## 3. Citation Format & Content

**Decision:** Citations use `[issue: #N]` format with title and status metadata.

**Format:** `[issue: #N] Title (open/closed)`
**URL:** `https://github.com/{owner}/{repo}/issues/{N}`

**Examples:**
- `[issue: #12345] Video playback stutters on HDR content (open)`
- `[issue: #9876] EPG guide fails to load after migration (closed)`

**Implementation guidance:**
- Follow existing `sourceLabel` / `sourceUrl` pattern from other corpus types
- Include open/closed status — critical for knowing if the issue is still relevant
- Do NOT include labels or assignees in citation — too noisy

## 4. Issue Chunk Content

**Decision:** Issue chunks contain title + body (truncated), with comments as separate chunks.

**Structure per issue:**
- **Primary chunk:** `#{number} {title}\n\n{body}` (body truncated to ~2000 chars)
- **Comment chunks:** Already stored separately by phase 106 comment chunker

**Implementation guidance:**
- Reuse the chunking from phase 106's ingestion — chunks already exist in the store
- The `UnifiedRetrievalChunk` normalization should map issue fields to standard schema
- `source` type: `"issue"` (new SourceType enum value)
- Include issue state (open/closed) in chunk metadata for downstream filtering

## Deferred Ideas

None identified — phase scope is well-bounded.

## Locked Decisions Summary

| Area | Decision | Locked? |
|------|----------|---------|
| Search strategy | Hybrid (vector + BM25) | Yes |
| Weight: pr_review | 0.8 | Yes |
| Weight: issue | 1.5 | Yes |
| Weight: question | 1.2 | Yes |
| Weight: slack | 1.0 | Yes |
| Citation format | `[issue: #N] Title (status)` | Yes |
| Chunk strategy | Reuse phase 106 chunks | Yes |
| New SourceType | `"issue"` | Yes |
