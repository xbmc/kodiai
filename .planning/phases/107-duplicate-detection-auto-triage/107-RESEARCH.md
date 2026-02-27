# Phase 107: Duplicate Detection & Auto-Triage - Research

**Researched:** 2026-02-27
**Domain:** Webhook event handling, vector similarity search, idempotent comment posting
**Confidence:** HIGH

## Summary

Phase 107 adds an `issues.opened` webhook handler that embeds the new issue's title+body, queries the existing issue corpus (built in Phase 106) for vector-similar candidates, and posts a triage comment surfacing top duplicates. The entire infrastructure already exists: the `IssueStore` has `searchByEmbedding()` and `findSimilar()` methods, the `EmbeddingProvider` handles fail-open embedding generation, and the `EventRouter` dispatches events to registered handlers by key (e.g., `issues.opened`).

The primary new work is: (1) a new handler file `src/handlers/issue-opened.ts` registered on `issues.opened`, (2) extending the `triageSchema` in `src/execution/config.ts` with three new fields (`autoTriageOnOpen`, `duplicateThreshold`, `maxDuplicateCandidates`), (3) a three-layer idempotency mechanism (delivery-ID dedup + DB flag + comment marker fallback), and (4) formatting + posting the triage comment with optional label application.

**Primary recommendation:** Build a standalone `src/handlers/issue-opened.ts` handler following the existing handler factory pattern (`createXxxHandler` that accepts deps + registers on `eventRouter`). Reuse `IssueStore.searchByEmbedding()` for candidate retrieval, `EmbeddingProvider.generate()` for embedding the new issue, and `createDeduplicator` for delivery-ID dedup. Add a lightweight DB table (`issue_triage_state`) for per-issue triaged flags and cooldown tracking.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Triage comment format**: Compact markdown table with columns: #number, title, similarity %, status (open/closed). Brief one-line header before the table. Similarity scores as percentages only. No branding or footer.
- **Similarity thresholds**: Single threshold cutoff. Configurable per-repo via `triage.duplicateThreshold`. Max candidates configurable via `triage.maxDuplicateCandidates` (default: 3). If no candidates meet threshold, no comment posted.
- **Label & signal behavior**: Always apply duplicate label when candidates surfaced. If label doesn't exist, log warning and skip labeling. Prioritize closed candidates in presentation.
- **Idempotency**: Delivery ID dedup via `X-GitHub-Delivery` header. Per-issue cooldown after triaging. Both active simultaneously. Triage runs once on `issues.opened` only. "Already triaged" tracked via DB flag (source of truth) + existing comment check (fallback).

### Claude's Discretion
- Label name choice (should fit GitHub conventions)
- Concurrency strategy for simultaneous webhook events on same issue
- Exact cooldown window duration
- Exact default similarity threshold value
- How to emphasize closed candidates (ordering, annotation, or separate section)

### Deferred Ideas (OUT OF SCOPE)
None
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DUPL-01 | When a new issue is triaged, query issue corpus for vector-similar candidates at high-confidence threshold | `IssueStore.searchByEmbedding()` exists with cosine distance ordering; `EmbeddingProvider.generate()` handles fail-open embedding; threshold filtering via SQL `WHERE distance <= threshold` |
| DUPL-02 | Top-3 duplicate candidates presented in comment with similarity scores, titles, numbers, open/closed status | `IssueSearchResult` returns `record` (with `issueNumber`, `title`, `state`, `closedAt`) and `distance`; format as markdown table per locked decision |
| DUPL-03 | Duplicate detection never auto-closes issues -- comments and optionally applies label | Handler only calls `octokit.rest.issues.createComment()` and optionally `octokit.rest.issues.addLabels()`; no close API call |
| DUPL-04 | Duplicate detection is fail-open -- embedding or search failures logged but never block triage | Wrap embed+search in try/catch, log warning, return empty candidates; matches existing fail-open pattern in `EmbeddingProvider` |
| TRIAGE-01 | `issues.opened` webhook event triggers triage pipeline automatically | Register handler on `eventRouter.register("issues.opened", handler)` in new `createIssueOpenedHandler()` factory |
| TRIAGE-02 | Auto-triage gated behind `triage.autoTriageOnOpen` config flag (default: false) | Add `autoTriageOnOpen: z.boolean().default(false)` to `triageSchema` in `src/execution/config.ts` |
| TRIAGE-03 | Auto-triage includes duplicate detection in triage flow | Handler embeds issue, searches corpus, formats comment with duplicates inline |
| TRIAGE-04 | Auto-triage is idempotent -- webhook dedup, in-flight claim, per-issue cooldown prevent duplicate comments | Three layers: (1) `Deduplicator.isDuplicate(deliveryId)` already in webhook route, (2) DB `issue_triage_state` row with atomic INSERT, (3) comment marker scan fallback |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| postgres (via `Sql`) | existing | DB queries, triage state tracking | Already used for all data access in project |
| @octokit/rest | existing | GitHub API (comments, labels) | Already used for all GitHub interactions |
| voyageai | existing | Embedding generation via `EmbeddingProvider` | Already used for all corpora |
| pino | existing | Structured logging | Already used project-wide |
| zod | existing | Config schema validation | Already used for `.kodiai.yml` parsing |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| InMemoryCache | existing (src/lib) | Per-issue cooldown tracking in memory | Cooldown layer (belt) alongside DB flag (suspenders) |
| Deduplicator | existing (src/webhook) | Delivery ID dedup | Already applied at webhook route level |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| DB advisory lock for concurrency | In-memory Set of in-flight keys | Advisory lock works across multiple server instances; in-memory only works for single process. Project is single-process currently, but DB approach is more robust |
| Separate triage state table | Column on `issues` table | Separate table is cleaner; `issues` table is from Phase 106 corpus and shouldn't carry triage-specific state |

**Installation:**
```bash
# No new dependencies needed -- all libraries already in project
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── handlers/
│   └── issue-opened.ts          # NEW: issues.opened handler factory
│   └── issue-opened.test.ts     # NEW: unit tests
├── triage/
│   └── triage-agent.ts          # EXISTING: template validation (no changes needed)
│   └── duplicate-detector.ts    # NEW: pure function for search + format
│   └── duplicate-detector.test.ts
│   └── triage-comment.ts        # NEW: comment formatting
│   └── triage-comment.test.ts
├── db/
│   └── migrations/
│       └── 016-issue-triage-state.sql  # NEW: triage state table
├── execution/
│   └── config.ts                # MODIFY: extend triageSchema
```

### Pattern 1: Handler Factory (established project pattern)
**What:** Each handler is a factory function that accepts deps, registers on the event router, and returns void.
**When to use:** For all webhook event handlers.
**Example:**
```typescript
// Source: existing pattern from src/handlers/review.ts, mention.ts, feedback-sync.ts
export function createIssueOpenedHandler(deps: {
  eventRouter: EventRouter;
  jobQueue: JobQueue;
  githubApp: GitHubApp;
  issueStore: IssueStore;
  embeddingProvider: EmbeddingProvider;
  logger: Logger;
}): void {
  const { eventRouter, logger } = deps;

  async function handleIssueOpened(event: WebhookEvent): Promise<void> {
    // 1. Extract issue from payload
    // 2. Load repo config, check autoTriageOnOpen
    // 3. Check idempotency (DB flag)
    // 4. Embed issue, search for duplicates
    // 5. Format and post comment if candidates found
    // 6. Apply label if candidates found
    // 7. Mark issue as triaged in DB
  }

  eventRouter.register("issues.opened", handleIssueOpened);
}
```

### Pattern 2: Fail-Open Embedding + Search
**What:** Wrap embedding generation and vector search in try/catch, return empty results on failure.
**When to use:** Always -- matches project's fail-open philosophy (see STATE.md key constraints).
**Example:**
```typescript
// Source: existing pattern from src/knowledge/embeddings.ts
async function findDuplicateCandidates(params: {
  issueStore: IssueStore;
  embeddingProvider: EmbeddingProvider;
  title: string;
  body: string | null;
  repo: string;
  threshold: number;
  maxCandidates: number;
  logger: Logger;
}): Promise<DuplicateCandidate[]> {
  try {
    const text = buildIssueEmbeddingText(params.title, params.body);
    const embedResult = await params.embeddingProvider.generate(text, "query");
    if (!embedResult) {
      params.logger.warn("Embedding generation returned null for duplicate detection (fail-open)");
      return [];
    }

    const results = await params.issueStore.searchByEmbedding({
      queryEmbedding: embedResult.embedding,
      repo: params.repo,
      topK: params.maxCandidates * 2, // fetch extra to filter by threshold
    });

    return results
      .filter(r => (1 - r.distance) * 100 >= params.threshold)
      .slice(0, params.maxCandidates)
      .map(r => ({
        issueNumber: r.record.issueNumber,
        title: r.record.title,
        state: r.record.state,
        similarityPct: Math.round((1 - r.distance) * 100),
      }));
  } catch (err) {
    params.logger.warn({ err }, "Duplicate detection failed (fail-open)");
    return [];
  }
}
```

### Pattern 3: Three-Layer Idempotency
**What:** Belt-and-suspenders approach to prevent duplicate triage comments.
**When to use:** For the `issues.opened` handler.
**Example:**
```
Layer 1: Delivery ID dedup (already handled by webhook route's Deduplicator)
Layer 2: DB flag -- INSERT INTO issue_triage_state ... ON CONFLICT DO NOTHING + check affected rows
Layer 3: Comment marker scan -- check existing comments for marker string (fallback if DB flag lost)
```

### Pattern 4: Comment Marker for Idempotency (established project pattern)
**What:** Embed an HTML comment marker in the posted comment body to detect prior posting.
**When to use:** As fallback idempotency check alongside DB flag.
**Example:**
```typescript
// Source: existing pattern from src/handlers/review-idempotency.ts
const TRIAGE_MARKER_PREFIX = "kodiai:triage";

function buildTriageMarker(repo: string, issueNumber: number): string {
  return `<!-- ${TRIAGE_MARKER_PREFIX}:${repo}:${issueNumber} -->`;
}
```

### Anti-Patterns to Avoid
- **Adding to mention handler:** The mention handler is 2000+ lines. STATE.md explicitly says `issue-opened.ts must be a separate handler, not added to the 2000+ line mention handler`.
- **Auto-closing issues:** REQUIREMENTS.md explicitly excludes auto-close. Never call `octokit.rest.issues.update({ state: 'closed' })`.
- **Blocking triage on embedding failure:** Project uses fail-open philosophy everywhere. If embedding fails, triage completes without duplicate detection.
- **Re-triaging on body edit:** Only trigger on `issues.opened`, never on `issues.edited`. CONTEXT.md locks this.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Delivery ID dedup | Custom dedup logic | `Deduplicator` from `src/webhook/dedup.ts` | Already handles TTL, bounded size, tested |
| Embedding generation | Direct Voyage API calls | `EmbeddingProvider.generate()` | Handles retries, timeouts, fail-open |
| Vector similarity search | Raw SQL queries | `IssueStore.searchByEmbedding()` | Already handles pgvector query, distance calculation |
| Repo config loading | Manual YAML parsing | `loadRepoConfig()` from `src/execution/config.ts` | Handles validation, defaults, section fallback |
| Comment marker scanning | Custom scan logic | Adapt pattern from `review-idempotency.ts` | Pagination, direction, scan limits handled |
| TTL-based cooldown cache | Custom Map with timestamps | `createInMemoryCache()` from `src/lib/in-memory-cache.ts` | Handles TTL, eviction, bounded size |
| Issue embedding text | Custom concatenation | `buildIssueEmbeddingText()` from `src/knowledge/issue-comment-chunker.ts` | Consistent with backfill embedding format |

**Key insight:** This phase is ~80% wiring existing infrastructure with ~20% new logic (comment formatting, config extension, triage state table).

## Common Pitfalls

### Pitfall 1: Cosine Distance vs Similarity Percentage
**What goes wrong:** pgvector's `<=>` operator returns cosine **distance** (0 = identical, 2 = opposite), but the user wants similarity **percentage** (100% = identical, 0% = unrelated).
**Why it happens:** Confusing distance with similarity.
**How to avoid:** Convert with `similarity = (1 - distance) * 100`. The threshold in config should be expressed as a percentage (e.g., 75 means 75% similar = 0.25 cosine distance).
**Warning signs:** Threshold filtering going the wrong direction (showing dissimilar results, hiding similar ones).

### Pitfall 2: New Issue Matching Itself
**What goes wrong:** If the new issue is upserted into the corpus before searching, it will be its own top match.
**Why it happens:** Backfill/sync may have already ingested the issue, or the handler upserts before searching.
**How to avoid:** Either search before upserting, or exclude the source issue number from results (`WHERE issue_number != $sourceIssueNumber`). The existing `findSimilar()` method already does this exclusion.
**Warning signs:** Every new issue shows itself as a 100% match.

### Pitfall 3: Race Condition on Rapid Redelivery
**What goes wrong:** Two concurrent webhook deliveries for the same issue both pass the "not yet triaged" check and post duplicate comments.
**Why it happens:** Check-then-act without atomicity.
**How to avoid:** Use `INSERT ... ON CONFLICT DO NOTHING RETURNING id` as an atomic claim. If no row returned, another handler already claimed it.
**Warning signs:** Duplicate triage comments appearing on the same issue.

### Pitfall 4: Label Creation Failure
**What goes wrong:** Calling `addLabels()` with a label that doesn't exist in the repo may cause unexpected behavior.
**Why it happens:** GitHub's `addLabels` endpoint auto-creates labels with default color, but some orgs restrict label creation.
**How to avoid:** Per CONTEXT.md: "If the label doesn't exist in the repo, log a warning and skip labeling." Use try/catch around the label API call.
**Warning signs:** 422 errors from GitHub API during label application.

### Pitfall 5: Empty Corpus Returns Misleading Results
**What goes wrong:** If the corpus has very few issues, even low-similarity matches may be the "top" results.
**Why it happens:** Vector search always returns topK results regardless of quality.
**How to avoid:** Always filter by threshold. If no candidates meet the threshold, post no comment (per locked decision: "zero noise for unique issues").
**Warning signs:** Triage comments showing candidates with very low similarity percentages.

### Pitfall 6: Excluding the Triggering Issue from Search Results
**What goes wrong:** The `searchByEmbedding()` method does not exclude any issue by default. If the nightly sync or a concurrent process has already ingested this issue into the corpus, it appears as its own match.
**Why it happens:** `searchByEmbedding()` takes `queryEmbedding` and `repo` but has no `excludeIssueNumber` parameter.
**How to avoid:** Either (a) add an optional `excludeIssueNumber` parameter to `searchByEmbedding()`, or (b) filter results client-side after the query. Option (b) is simpler and avoids changing the store interface.
**Warning signs:** First result always has distance ~0.

## Code Examples

### Config Schema Extension
```typescript
// In src/execution/config.ts, extend triageSchema:
const triageSchema = z
  .object({
    enabled: z.boolean().default(false),
    autoTriageOnOpen: z.boolean().default(false),
    duplicateThreshold: z.number().min(0).max(100).default(75),
    maxDuplicateCandidates: z.number().min(1).max(10).default(3),
    duplicateLabel: z.string().default("possible-duplicate"),
    label: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
    comment: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
    labelAllowlist: z.array(z.string()).default([]),
    cooldownMinutes: z.number().min(0).max(1440).default(30),
  })
  .default({ /* defaults */ });
```

### Triage Comment Formatting
```typescript
// Compact markdown table per locked decision
function formatTriageComment(
  candidates: DuplicateCandidate[],
  marker: string,
): string {
  // Sort: closed candidates first (prioritize per locked decision), then by similarity desc
  const sorted = [...candidates].sort((a, b) => {
    if (a.state === "closed" && b.state !== "closed") return -1;
    if (a.state !== "closed" && b.state === "closed") return 1;
    return b.similarityPct - a.similarityPct;
  });

  const lines: string[] = [];
  lines.push("Possible duplicates detected:");
  lines.push("");
  lines.push("| Issue | Title | Similarity | Status |");
  lines.push("|-------|-------|------------|--------|");
  for (const c of sorted) {
    lines.push(`| #${c.issueNumber} | ${c.title} | ${c.similarityPct}% | ${c.state} |`);
  }

  // If all candidates are closed, add a note
  if (sorted.every(c => c.state === "closed")) {
    lines.push("");
    lines.push("All matches are closed issues -- the problem may already be resolved.");
  }

  lines.push("");
  lines.push(marker);

  return lines.join("\n");
}
```

### DB Migration for Triage State
```sql
-- 016-issue-triage-state.sql
CREATE TABLE IF NOT EXISTS issue_triage_state (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  repo TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  triaged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivery_id TEXT NOT NULL,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(repo, issue_number)
);

CREATE INDEX IF NOT EXISTS idx_issue_triage_state_repo
  ON issue_triage_state (repo, issue_number);
```

### Atomic Claim Pattern
```typescript
// Use INSERT ... ON CONFLICT DO NOTHING + check affected rows
async function claimIssueTriage(
  sql: Sql,
  repo: string,
  issueNumber: number,
  deliveryId: string,
): Promise<boolean> {
  const result = await sql`
    INSERT INTO issue_triage_state (repo, issue_number, delivery_id)
    VALUES (${repo}, ${issueNumber}, ${deliveryId})
    ON CONFLICT (repo, issue_number) DO NOTHING
    RETURNING id
  `;
  return result.length > 0; // true = we claimed it, false = already triaged
}
```

### Handler Registration in src/index.ts
```typescript
// Wire up in src/index.ts alongside other handlers
if (issueStore && embeddingProvider) {
  createIssueOpenedHandler({
    eventRouter,
    jobQueue,
    githubApp,
    issueStore,
    embeddingProvider,
    sql,
    logger,
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Triage only on @mention | Auto-triage on issues.opened (Phase 107) | This phase | Proactive duplicate detection without human trigger |
| In-memory cooldown only | DB flag + in-memory cooldown + comment marker | This phase | Survives restarts, prevents duplicates across deploys |
| No duplicate detection | Vector similarity search against issue corpus | This phase | Surfaces related issues to maintainers automatically |

## Open Questions

1. **Default similarity threshold value**
   - What we know: Cosine distance thresholds of 0.12/0.18/0.25 were mentioned in STATE.md research notes as needing empirical calibration. These correspond to ~88%/82%/75% similarity.
   - What's unclear: The optimal default that balances recall vs noise.
   - Recommendation: Use **75%** (0.25 cosine distance) as default. This is the most permissive of the researched bands and appropriate for a "surfacing" system where false positives are less harmful than false negatives (maintainers can ignore suggestions). The value is configurable per-repo.

2. **Cooldown window duration**
   - What we know: Existing mention-based triage uses 30 minutes.
   - What's unclear: Whether the same window makes sense for auto-triage (which only fires on `issues.opened`).
   - Recommendation: Use **60 minutes** default. Since auto-triage only fires on `issues.opened` (not on edits), a longer cooldown prevents edge cases with rapid re-opening. The primary protection is the DB flag anyway.

3. **Concurrency strategy**
   - What we know: Single-process deployment currently. The `Deduplicator` + DB `INSERT ... ON CONFLICT DO NOTHING` pattern provides atomic claiming.
   - What's unclear: Whether advisory locks are needed.
   - Recommendation: Use `INSERT ... ON CONFLICT DO NOTHING RETURNING id` as the concurrency control. This is atomic at the DB level and works even if the app scales to multiple instances later. No advisory lock needed -- the UNIQUE constraint provides the same guarantee.

4. **Emphasizing closed candidates**
   - What we know: CONTEXT.md says "if top matches are all closed issues, emphasize this in presentation."
   - Recommendation: Sort closed candidates before open ones in the table. If all candidates are closed, add a note line after the table: "All matches are closed issues -- the problem may already be resolved."

5. **Label name**
   - Recommendation: `possible-duplicate` -- follows GitHub conventions (lowercase, hyphenated), clearly communicates intent without being definitive.

## Sources

### Primary (HIGH confidence)
- Codebase: `src/knowledge/issue-store.ts` -- IssueStore with `searchByEmbedding()`, `findSimilar()` methods
- Codebase: `src/knowledge/embeddings.ts` -- EmbeddingProvider with fail-open semantics
- Codebase: `src/webhook/router.ts` -- EventRouter with `register()` / `dispatch()` pattern
- Codebase: `src/webhook/dedup.ts` -- Deduplicator with InMemoryCache backing
- Codebase: `src/execution/config.ts` -- triageSchema with existing cooldown, label allowlist
- Codebase: `src/handlers/review-idempotency.ts` -- HTML comment marker pattern
- Codebase: `src/knowledge/issue-comment-chunker.ts` -- `buildIssueEmbeddingText()` function
- Codebase: `src/routes/webhooks.ts` -- Webhook route with delivery ID extraction
- Codebase: `src/index.ts` -- Handler registration pattern in app bootstrap
- `.planning/STATE.md` -- Key constraints (fail-open, separate handler mandate)
- `.planning/REQUIREMENTS.md` -- DUPL-01 through TRIAGE-04 requirement definitions

### Secondary (MEDIUM confidence)
- STATE.md research notes on cosine distance bands (0.12/0.18/0.25) -- pre-calibration estimates

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in project, no new dependencies needed
- Architecture: HIGH - All patterns directly observable in existing codebase, handler factory pattern used by 6+ handlers
- Pitfalls: HIGH - All pitfalls derived from actual codebase analysis (distance vs similarity, self-matching, race conditions)

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (stable -- no external dependencies to go stale)
