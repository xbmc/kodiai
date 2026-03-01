# Phase 110: Troubleshooting Retrieval Foundation - Research

**Researched:** 2026-02-27
**Domain:** PostgreSQL pgvector state-filtered search, thread assembly, wiki fallback
**Confidence:** HIGH

## Summary

Phase 110 extends the existing issue retrieval infrastructure to support troubleshooting by adding state-filtered search (closed issues only), building a resolution-focused thread assembler, and implementing a wiki fallback chain. The codebase already has all the foundational pieces: `IssueStore` with vector and full-text search, `issue_comments` table with embeddings, `searchWikiPages()` for wiki retrieval, and the `hybridSearchMerge()` RRF combiner. The work is primarily additive -- extending existing SQL queries with a `stateFilter` parameter, building a new thread assembly module, and wiring a fallback path.

Key finding: The `issues` table schema already has `state`, `is_pull_request`, and `closed_at` columns but does NOT have a `merged_at` column. The current backfill (`issue-backfill.ts`) skips PRs entirely (`if (item.pull_request) continue;`), so the corpus currently contains zero PR records. The CONTEXT.md decision to "include merged PRs only" requires either: (a) a migration to add `merged_at` to the issues table and updating the backfill to ingest PRs, or (b) implementing the post-filter to simply exclude all `is_pull_request = true` records since none are merged (no `merged_at` data). Recommendation: add `merged_at` column via migration and update the PR ingestion in a future phase; for now, post-filter excludes all `is_pull_request = true` rows, which is correct given the current corpus state.

**Primary recommendation:** Add an optional `stateFilter` parameter to `searchByEmbedding` and `searchByFullText` in `IssueStore`, build `assembleTroubleshootingContext()` as a standalone module in `src/knowledge/`, and wire wiki fallback using the existing `searchWikiPages()` function.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Thread assembly priority:** Tail-first (last N comments before closure), then semantic. Adaptive character budget based on match count.
- **Character budget:** Fixed total ceiling with per-issue budget varying by match count. Fewer matches = larger budget per issue (e.g., 8K for 1 match, 3K each for 3+ matches).
- **Issue body handling:** Bodies over ~500 chars truncated to first paragraph + last paragraph. Short bodies included in full.
- **Budget distribution across matches:** Weighted by similarity score. Higher-scoring resolved issues get proportionally more of the total budget.
- **Candidate retrieval:** Top 10 candidates from vector search before applying threshold filter.
- **Similarity floor:** Default 0.65 cosine similarity, configurable via `triage.troubleshooting.similarityThreshold`.
- **Max results after filtering:** Default 3, configurable via `triage.troubleshooting.maxResults`.
- **Search mode:** Hybrid (vector + full-text, deduplicated). Both apply the same state filter.
- **Wiki fallback:** Both original query + extracted keywords. Top 2 wiki pages. Silent no-match (no comment, no side effects).
- **Source attribution:** Blended but cited inline: `[Issue #X]` or `[Wiki: Page Name]`.
- **State filtering:** `state = 'closed'`, include merged PRs only, locked issues included.
- **Filter implementation:** SQL for state, post-filter for PR merge status.

### Claude's Discretion
- Exact character budget ceiling and scaling formula
- Exact budget weighting formula across matches

### Deferred Ideas (OUT OF SCOPE)
_(None raised during discussion)_
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TSHOOT-01 | State-filtered vector search retrieves similar resolved issues | Extend `searchByEmbedding`/`searchByFullText` with `stateFilter` param; add `AND state = 'closed'` to SQL WHERE; post-filter `is_pull_request` rows |
| TSHOOT-02 | Resolution-focused thread assembly with tail+semantic priority and per-issue character budget | New `thread-assembler.ts` module using `getCommentsByIssue()` for tail comments + `searchCommentsByEmbedding()` for semantic fill; budget math detailed below |
| TSHOOT-03 | Fallback to wiki search then transparent "no match" response when no similar resolved issues exist | Use existing `searchWikiPages()` with dual-query strategy; return early with no side effects on empty results |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| postgres (porsager) | ^3.4.8 | SQL client with tagged templates | Already used project-wide for all DB access |
| pgvector | HNSW index | Cosine similarity search | Already configured with 1024-dim vectors |
| bun:test | built-in | Test runner | Project standard |
| voyageai | ^0.1.0 | Embedding provider (voyage-code-3) | Already used for all corpus embeddings |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pino | ^10.3.0 | Structured logging | All handler/module logging |
| zod | ^4.3.6 | Config validation | Extending triage config schema |

### Alternatives Considered
None -- this phase uses only existing project infrastructure.

## Architecture Patterns

### Recommended Project Structure
```
src/knowledge/
  issue-types.ts           # MODIFY: add stateFilter to search params
  issue-store.ts           # MODIFY: add WHERE state clause to queries
  issue-retrieval.ts       # MODIFY: add stateFilter passthrough
  thread-assembler.ts      # NEW: tail+semantic thread assembly
  thread-assembler.test.ts # NEW: unit tests
  troubleshooting-retrieval.ts       # NEW: orchestrator (search + assemble + fallback)
  troubleshooting-retrieval.test.ts  # NEW: integration tests
```

### Pattern 1: State Filter Extension
**What:** Add optional `stateFilter` to existing `IssueStore` search methods
**When to use:** Any filtered search on the issues table
**Example:**
```typescript
// In issue-types.ts - extend search params
searchByEmbedding(params: {
  queryEmbedding: Float32Array;
  repo: string;
  topK: number;
  stateFilter?: string;   // NEW: e.g., 'closed'
}): Promise<IssueSearchResult[]>;

// In issue-store.ts - conditional WHERE clause
const rows = await sql`
  SELECT *,
    embedding <=> ${queryEmbeddingString}::vector AS distance
  FROM issues
  WHERE repo = ${params.repo}
    AND embedding IS NOT NULL
    ${params.stateFilter ? sql`AND state = ${params.stateFilter}` : sql``}
  ORDER BY embedding <=> ${queryEmbeddingString}::vector
  LIMIT ${params.topK}
`;
```

### Pattern 2: Thread Assembly (Tail-First + Semantic Fill)
**What:** Assemble resolution-focused context from issue comments
**When to use:** Building troubleshooting context from resolved issues
**Example:**
```typescript
// thread-assembler.ts
export type ThreadAssemblyResult = {
  issueNumber: number;
  title: string;
  body: string;        // truncated if > 500 chars
  tailComments: string[];
  semanticComments: string[];
  totalChars: number;
};

export async function assembleIssueThread(params: {
  issueStore: IssueStore;
  embeddingProvider: EmbeddingProvider;
  repo: string;
  issueNumber: number;
  queryEmbedding: Float32Array;
  charBudget: number;
  logger: Logger;
}): Promise<ThreadAssemblyResult> {
  // 1. Get the issue record (for body)
  // 2. Get all comments via getCommentsByIssue()
  // 3. Take last N comments (tail) that fit in ~60% of budget
  // 4. From remaining comments, rank by embedding similarity to query
  // 5. Fill remaining budget with semantic matches
  // 6. Truncate body if > 500 chars (first para + last para)
}
```

### Pattern 3: Fallback Chain (Issues -> Wiki -> Silent No-Match)
**What:** Orchestrate retrieval with graceful degradation
**When to use:** Top-level troubleshooting retrieval entry point
**Example:**
```typescript
// troubleshooting-retrieval.ts
export async function retrieveTroubleshootingContext(params: {
  issueStore: IssueStore;
  wikiPageStore?: WikiPageStore;
  embeddingProvider: EmbeddingProvider;
  repo: string;
  queryTitle: string;
  queryBody: string | null;
  config: TroubleshootingConfig;
  logger: Logger;
}): Promise<TroubleshootingResult | null> {
  // 1. Hybrid search (vector + full-text) with state='closed'
  // 2. Apply similarity floor + maxResults
  // 3. If matches found: assemble threads, return
  // 4. If no matches: wiki fallback (original query + extracted keywords)
  // 5. If wiki returns nothing: return null (silent no-match)
}
```

### Anti-Patterns to Avoid
- **Modifying the generic retrieval pipeline** (`retrieval.ts`): Troubleshooting retrieval is a SEPARATE pipeline, not a modification to the existing cross-corpus RRF pipeline. The existing `createRetriever` serves PR review and mentions. Troubleshooting has different priorities (state filtering, thread assembly, budget distribution).
- **Adding merged_at column now**: The corpus currently has zero PR records. Adding a migration and updating backfill is future work. Post-filter `is_pull_request = true` records is sufficient and correct.
- **LLM calls in the retrieval layer**: Thread assembly and fallback are pure data operations. Synthesis happens in Phase 111 (the troubleshooting agent).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Hybrid search merging | Custom merge logic | `hybridSearchMerge()` from `hybrid-search.ts` | RRF algorithm already implemented and tested |
| Wiki vector search | Raw SQL wiki queries | `searchWikiPages()` from `wiki-retrieval.ts` | Handles embedding generation, distance filtering, URL building |
| Embedding generation | Direct VoyageAI calls | `EmbeddingProvider.generate()` | Fail-open semantics, model abstraction |
| Full-text search | Raw `ts_rank` queries | Extend existing `searchByFullText()` pattern | tsvector triggers already configured |
| Comment retrieval | Custom SQL | `IssueStore.getCommentsByIssue()` | Already returns ordered by `github_created_at ASC` |
| Config validation | Manual parsing | Extend `triageSchema` with zod | Project convention for all config |

## Common Pitfalls

### Pitfall 1: Cosine Distance vs. Cosine Similarity Confusion
**What goes wrong:** pgvector `<=>` returns cosine DISTANCE (0 = identical, 2 = opposite). The CONTEXT.md specifies "0.65 cosine similarity" as the floor.
**Why it happens:** Easy to confuse `distance <= 0.35` (correct) with `distance <= 0.65` (wrong, too lenient).
**How to avoid:** Convert at the boundary: `maxDistance = 1 - similarityThreshold`. For 0.65 similarity, use `distance <= 0.35`.
**Warning signs:** Getting too many low-quality matches.

### Pitfall 2: Empty Comment Thread
**What goes wrong:** A closed issue might have zero comments (auto-closed, or body-only resolution).
**Why it happens:** Not all resolutions happen in comments -- some issues are closed with just a commit reference.
**How to avoid:** Thread assembler must handle zero-comment case gracefully. Return just the (truncated) issue body as context.

### Pitfall 3: Postgres Tagged Template Conditional SQL
**What goes wrong:** Incorrect use of conditional SQL fragments with the `postgres` library.
**Why it happens:** The `sql` tagged template requires specific patterns for dynamic WHERE clauses.
**How to avoid:** Use `${condition ? sql\`AND col = ${val}\` : sql\`\`}` pattern (empty sql fragment, not empty string).

### Pitfall 4: Budget Overshoot with Multi-Byte Characters
**What goes wrong:** Character count budget can be wildly inaccurate for token budgets.
**Why it happens:** The CONTEXT.md specifies character budgets, but LLM context is token-based.
**How to avoid:** Use character budget as specified (simpler, predictable). The total ceiling (e.g., 12K chars) should be conservative enough that token conversion isn't an issue.

### Pitfall 5: PR Records in Corpus
**What goes wrong:** Post-filter for `is_pull_request` applied but no PRs exist in corpus.
**Why it happens:** Current backfill (`issue-backfill.ts` line 216) skips PRs: `if (item.pull_request) continue;`.
**How to avoid:** Still implement the post-filter (it's a no-op today but correct for when PRs are ingested). Don't add a migration for `merged_at` -- that's future work when PR ingestion is added.

## Code Examples

### State-Filtered Search Extension (issue-store.ts)
```typescript
// Source: Existing pattern from searchByEmbedding + conditional SQL
async searchByEmbedding(params: {
  queryEmbedding: Float32Array;
  repo: string;
  topK: number;
  stateFilter?: string;
}): Promise<IssueSearchResult[]> {
  const queryEmbeddingString = float32ArrayToVectorString(params.queryEmbedding);

  const rows = await sql`
    SELECT *,
      embedding <=> ${queryEmbeddingString}::vector AS distance
    FROM issues
    WHERE repo = ${params.repo}
      AND embedding IS NOT NULL
      ${params.stateFilter ? sql`AND state = ${params.stateFilter}` : sql``}
    ORDER BY embedding <=> ${queryEmbeddingString}::vector
    LIMIT ${params.topK}
  `;

  return rows.map((row) => ({
    record: rowToRecord(row as unknown as IssueRow),
    distance: Number((row as Record<string, unknown>).distance),
  }));
},
```

### Body Truncation (first + last paragraph)
```typescript
// Source: CONTEXT.md decision — bodies over ~500 chars
export function truncateIssueBody(body: string, maxChars: number = 500): string {
  if (body.length <= maxChars) return body;

  const paragraphs = body.split(/\n\n+/).filter(Boolean);
  if (paragraphs.length <= 2) {
    return body.slice(0, maxChars) + "...";
  }

  const first = paragraphs[0]!;
  const last = paragraphs[paragraphs.length - 1]!;
  const truncated = `${first}\n\n[...]\n\n${last}`;

  // If still too long, hard truncate
  return truncated.length <= maxChars * 1.5
    ? truncated
    : truncated.slice(0, maxChars) + "...";
}
```

### Budget Distribution Formula
```typescript
// Source: CONTEXT.md — weighted by similarity, adaptive per match count
const TOTAL_BUDGET_CHARS = 12_000;

export function computeBudgetDistribution(
  matches: Array<{ distance: number }>,
): number[] {
  if (matches.length === 0) return [];
  if (matches.length === 1) return [TOTAL_BUDGET_CHARS];

  // Convert distances to similarity scores (higher = better)
  const similarities = matches.map((m) => 1 - m.distance);
  const totalSim = similarities.reduce((a, b) => a + b, 0);

  // Proportional allocation
  return similarities.map((sim) =>
    Math.floor((sim / totalSim) * TOTAL_BUDGET_CHARS)
  );
}
```

### Tail-First Comment Selection
```typescript
// Source: CONTEXT.md — last N comments before closure guaranteed
export function selectTailComments(
  comments: IssueCommentRecord[],
  charBudget: number,
): { selected: IssueCommentRecord[]; remaining: IssueCommentRecord[]; charsUsed: number } {
  // Comments are already ordered by github_created_at ASC
  const reversed = [...comments].reverse(); // latest first
  const selected: IssueCommentRecord[] = [];
  let charsUsed = 0;

  for (const comment of reversed) {
    if (charsUsed + comment.body.length > charBudget) break;
    selected.unshift(comment); // maintain chronological order
    charsUsed += comment.body.length;
  }

  const selectedIds = new Set(selected.map((c) => c.commentGithubId));
  const remaining = comments.filter((c) => !selectedIds.has(c.commentGithubId));

  return { selected, remaining, charsUsed };
}
```

### Wiki Fallback with Dual Query
```typescript
// Source: CONTEXT.md — original query + extracted keywords, top 2 pages
import { searchWikiPages } from "./wiki-retrieval.ts";

async function wikiFallback(params: {
  wikiPageStore: WikiPageStore;
  embeddingProvider: EmbeddingProvider;
  originalQuery: string;
  extractedKeywords: string;
  logger: Logger;
}): Promise<WikiKnowledgeMatch[]> {
  const [originalResults, keywordResults] = await Promise.allSettled([
    searchWikiPages({
      store: params.wikiPageStore,
      embeddingProvider: params.embeddingProvider,
      query: params.originalQuery,
      topK: 2,
      logger: params.logger,
    }),
    searchWikiPages({
      store: params.wikiPageStore,
      embeddingProvider: params.embeddingProvider,
      query: params.extractedKeywords,
      topK: 2,
      logger: params.logger,
    }),
  ]);

  // Merge and deduplicate by pageId, keep top 2
  const all = [
    ...(originalResults.status === "fulfilled" ? originalResults.value : []),
    ...(keywordResults.status === "fulfilled" ? keywordResults.value : []),
  ];
  const seen = new Set<number>();
  const deduped: WikiKnowledgeMatch[] = [];
  for (const match of all.sort((a, b) => a.distance - b.distance)) {
    if (!seen.has(match.pageId)) {
      seen.add(match.pageId);
      deduped.push(match);
    }
  }
  return deduped.slice(0, 2);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Unfiltered issue search | State-filtered search (this phase) | Phase 110 | Enables troubleshooting-specific retrieval |
| No thread assembly | Tail+semantic thread assembly | Phase 110 | Resolution context available for synthesis |
| Issue retrieval only | Issue -> Wiki fallback chain | Phase 110 | Graceful degradation when corpus is sparse |

## Open Questions

1. **Tail comment count default**
   - What we know: CONTEXT.md says "last N comments before closure" without specifying N
   - Recommendation: Use budget-driven approach (fill ~60% of per-issue budget with tail comments). This naturally adapts -- for short threads, all comments are tail; for long threads, ~3-5 comments fit.

2. **Keyword extraction for wiki fallback**
   - What we know: CONTEXT.md says "extracted keywords (error messages, component names, symptoms)" for the second wiki query
   - Recommendation: Simple heuristic extraction: take error codes/messages (quoted strings, stack trace patterns), capitalized component names, and the issue title. No LLM call -- keep it deterministic.

3. **Total character budget ceiling**
   - What we know: CONTEXT.md says "8K for 1 match, 3K each for 3+ matches" as examples
   - Recommendation: 12K total ceiling. Formula: `Math.min(TOTAL_BUDGET, Math.floor(TOTAL_BUDGET / matchCount) * 1.2)` per issue. For 1 match: 12K. For 2: ~7.2K each (capped at 12K total). For 3: ~4.8K each.

4. **Cosine similarity vs. distance conversion**
   - What we know: Config uses "similarity" (0.65), pgvector uses "distance" (<=> operator)
   - Recommendation: Config stores similarity (user-friendly). Convert at query time: `maxDistance = 1 - similarity`. Document this clearly.

## Schema Analysis

### Current `issues` Table (migration 014)
| Column | Type | Notes |
|--------|------|-------|
| `state` | TEXT | Already indexed (`idx_issues_state`). Values: 'open', 'closed' |
| `is_pull_request` | BOOLEAN | Exists but corpus has zero PRs (backfill skips them) |
| `closed_at` | TIMESTAMPTZ | Available for recency sorting |
| `locked` | BOOLEAN | Available, included per CONTEXT.md |
| `embedding` | vector(1024) | HNSW indexed |
| `search_tsv` | tsvector | GIN indexed, weighted A/B/C |

### Current `issue_comments` Table (migration 014)
| Column | Type | Notes |
|--------|------|-------|
| `repo` + `issue_number` | Composite | Indexed, used by `getCommentsByIssue()` |
| `body` | TEXT | Comment content |
| `embedding` | vector(1024) | HNSW indexed, used by `searchCommentsByEmbedding()` |
| `github_created_at` | TIMESTAMPTZ | Already ordered ASC in `getCommentsByIssue()` |

### Missing: No `merged_at` Column on `issues`
The `merged_at` column does NOT exist on the `issues` table. The `dep_bump_merge_history` table has `merged_at` but that's for dependency bumps only. The current backfill skips PRs entirely. Post-filtering `is_pull_request = true` is correct and sufficient.

## Config Extension

The triage config schema needs a `troubleshooting` sub-object:

```typescript
// Extend triageSchema in config.ts
troubleshooting: z.object({
  enabled: z.boolean().default(false),
  similarityThreshold: z.number().min(0).max(1).default(0.65),
  maxResults: z.number().min(1).max(10).default(3),
  totalBudgetChars: z.number().min(1000).max(50000).default(12000),
}).default({
  enabled: false,
  similarityThreshold: 0.65,
  maxResults: 3,
  totalBudgetChars: 12000,
}),
```

## Sources

### Primary (HIGH confidence)
- `src/knowledge/issue-types.ts` -- IssueStore interface, search method signatures
- `src/knowledge/issue-store.ts` -- SQL implementation, pgvector queries, row mapping
- `src/db/migrations/014-issues.sql` -- Full schema for issues + issue_comments tables
- `src/knowledge/issue-retrieval.ts` -- Current issue search with distance threshold
- `src/knowledge/wiki-retrieval.ts` -- Wiki search pattern (embedding + distance filter)
- `src/knowledge/retrieval.ts` -- Cross-corpus retrieval pipeline, hybrid search wiring
- `src/knowledge/hybrid-search.ts` -- RRF merge algorithm
- `src/knowledge/issue-comment-chunker.ts` -- Embedding text builders, bot filtering
- `src/knowledge/issue-backfill.ts` -- Confirms PRs are skipped (line 216)
- `src/triage/duplicate-detector.ts` -- Existing similarity search pattern
- `src/execution/config.ts` -- triageSchema, RepoConfig type
- `src/knowledge/issue-store.test.ts` -- Test patterns, mock helpers

### Secondary (MEDIUM confidence)
- CONTEXT.md decisions on budget formulas (interpreted from examples)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use, no new dependencies
- Architecture: HIGH -- patterns directly observed in codebase
- Pitfalls: HIGH -- identified from actual schema analysis and code review
- Budget formulas: MEDIUM -- interpolated from CONTEXT.md examples, needs validation

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (stable domain, internal codebase)
