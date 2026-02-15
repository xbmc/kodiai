# Phase 52: Intelligent Retrieval - Research

**Researched:** 2026-02-14
**Domain:** Vector retrieval query construction and post-retrieval re-ranking
**Confidence:** HIGH

## Summary

Phase 52 improves the relevance of historical findings surfaced during code reviews. Currently, the retrieval query is constructed from just the PR title and the first 20 file paths (`review.ts:1432`), which misses important contextual signals. The retrieval results are returned purely by vector distance with no post-processing. This phase addresses both gaps: (1) constructing richer multi-signal queries that incorporate PR intent, detected languages, diff risk signals, and author tier, and (2) applying language-aware re-ranking to boost same-language findings after retrieval.

The implementation is well-scoped because all the signal sources already exist in the codebase. PR intent is parsed by `pr-intent-parser.ts`, languages are classified by `diff-analysis.ts:classifyLanguages()`, risk signals come from `diff-analysis.ts:analyzeDiff()`, and author tier is resolved by `author-classifier.ts`. The retrieval path (`isolation.ts` -> `memory-store.ts`) and the prompt injection point (`review-prompt.ts:buildRetrievalContextSection()`) are both clean extension points. No new dependencies are needed.

**Primary recommendation:** Build a `buildRetrievalQuery()` function that composes a structured text query from existing signals, and a `rerankByLanguage()` function that post-processes retrieval results using the `filePath` extension on stored records. Both are pure functions, easily unit-tested.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| sqlite-vec | (existing) | Vector similarity search | Already in use for learning memory store |
| voyageai | (existing) | Voyage Code 3 embeddings | Already configured, 1024-dim float[1024] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none needed) | - | - | No new dependencies required |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Post-retrieval re-ranking | Qdrant payload filtering | sqlite-vec partition key only supports repo; adding language as partition key would require schema migration and limit flexibility. Post-retrieval re-ranking is simpler and more configurable. |
| Concatenated text query | Separate query per signal | Multiple embedding calls per review would add latency and cost. Single enriched query is more practical. |

## Architecture Patterns

### Current Retrieval Flow (what exists today)
```
review.ts:1432 → queryText = `${pr.title}\n${reviewFiles.slice(0,20).join("\n")}`
              → embeddingProvider.generate(queryText, "query")
              → isolationLayer.retrieveWithIsolation(...)
              → results sorted by distance only
              → buildRetrievalContextSection() injects into prompt
```

### Proposed Retrieval Flow (RET-01 + RET-02)
```
review.ts → buildRetrievalQuery({
               prTitle, prBody, conventionalType, detectedLanguages,
               riskSignals, authorTier, topFilePaths
            })
         → embeddingProvider.generate(enrichedQuery, "query")
         → isolationLayer.retrieveWithIsolation(...)
         → rerankByLanguage({
               results, prLanguages, boostFactor, penaltyFactor
            })
         → buildRetrievalContextSection() injects into prompt
```

### Recommended Project Structure
```
src/
├── learning/
│   ├── retrieval-query.ts      # NEW: buildRetrievalQuery() - multi-signal query construction
│   ├── retrieval-query.test.ts # NEW: unit tests for query construction
│   ├── retrieval-rerank.ts     # NEW: rerankByLanguage() - post-retrieval re-ranking
│   ├── retrieval-rerank.test.ts # NEW: unit tests for re-ranking
│   ├── memory-store.ts         # UNCHANGED
│   ├── isolation.ts            # UNCHANGED
│   ├── embedding-provider.ts   # UNCHANGED
│   └── types.ts                # EXTENDED: add RetrievalQuerySignals type, RerankedResult type
├── handlers/
│   └── review.ts               # MODIFIED: wire new query builder + reranker into retrieval path
```

### Pattern 1: Multi-Signal Query Construction (RET-01)
**What:** Build a richer embedding query string from multiple PR context signals
**When to use:** Every time retrieval is invoked during a review
**Key insight:** Voyage Code 3 uses `input_type: "query"` which is optimized for retrieval. Including structured signals in the query text gives the model more semantic context to match against stored findings.

```typescript
// src/learning/retrieval-query.ts

export type RetrievalQuerySignals = {
  prTitle: string;
  prBody?: string;
  conventionalType?: string | null;       // from parsePRIntent
  detectedLanguages: string[];            // from classifyLanguages keys
  riskSignals: string[];                  // from analyzeDiff().riskSignals
  authorTier?: string;                    // from classifyAuthor
  topFilePaths: string[];                 // first N changed files
};

export function buildRetrievalQuery(signals: RetrievalQuerySignals): string {
  const parts: string[] = [];

  // PR title is always the primary signal
  parts.push(signals.prTitle);

  // PR body excerpt (first ~200 chars) adds intent context
  if (signals.prBody) {
    const excerpt = signals.prBody.slice(0, 200).trim();
    if (excerpt) parts.push(excerpt);
  }

  // Conventional commit type adds review focus signal
  if (signals.conventionalType) {
    parts.push(`[${signals.conventionalType}]`);
  }

  // Languages tell the embedding model what ecosystem we're in
  if (signals.detectedLanguages.length > 0) {
    parts.push(`Languages: ${signals.detectedLanguages.slice(0, 5).join(", ")}`);
  }

  // Risk signals indicate what kinds of findings are relevant
  if (signals.riskSignals.length > 0) {
    parts.push(`Risk: ${signals.riskSignals.slice(0, 3).join("; ")}`);
  }

  // Author tier influences what kinds of findings were historically generated
  if (signals.authorTier) {
    parts.push(`Author: ${signals.authorTier}`);
  }

  // File paths provide structural context (capped)
  const cappedFiles = signals.topFilePaths.slice(0, 15);
  if (cappedFiles.length > 0) {
    parts.push(cappedFiles.join("\n"));
  }

  return parts.join("\n");
}
```

### Pattern 2: Language-Aware Re-Ranking (RET-02)
**What:** After vector retrieval, adjust result ordering to prefer same-language findings
**When to use:** Post-retrieval, before injecting into prompt
**Key insight:** The `filePath` field is already stored on every `LearningMemoryRecord`. We can extract the language from the file extension using the existing `classifyFileLanguage()` function. No schema changes needed.

```typescript
// src/learning/retrieval-rerank.ts
import { classifyFileLanguage } from "../execution/diff-analysis.ts";

export type RerankConfig = {
  /** Multiplier for same-language results. < 1.0 = boost (lower distance = better). Default 0.85 */
  sameLanguageBoost: number;
  /** Multiplier for cross-language results. > 1.0 = penalize. Default 1.15 */
  crossLanguagePenalty: number;
};

export const DEFAULT_RERANK_CONFIG: RerankConfig = {
  sameLanguageBoost: 0.85,
  crossLanguagePenalty: 1.15,
};

export type RerankedResult = {
  memoryId: number;
  distance: number;          // original distance
  adjustedDistance: number;   // after language re-ranking
  record: LearningMemoryRecord;
  sourceRepo: string;
  languageMatch: boolean;
};

export function rerankByLanguage(params: {
  results: RetrievalResult[];
  prLanguages: string[];        // detected languages in current PR
  config?: RerankConfig;
}): RerankedResult[] {
  const cfg = params.config ?? DEFAULT_RERANK_CONFIG;
  const prLangSet = new Set(params.prLanguages);

  const reranked = params.results.map(result => {
    const recordLang = classifyFileLanguage(result.record.filePath);
    const isMatch = recordLang !== "Unknown" && prLangSet.has(recordLang);

    const multiplier = isMatch ? cfg.sameLanguageBoost : cfg.crossLanguagePenalty;
    const adjustedDistance = result.distance * multiplier;

    return {
      ...result,
      adjustedDistance,
      languageMatch: isMatch,
    };
  });

  // Re-sort by adjusted distance
  reranked.sort((a, b) => a.adjustedDistance - b.adjustedDistance);
  return reranked;
}
```

### Anti-Patterns to Avoid
- **Embedding the same text twice:** Do not call `embeddingProvider.generate()` more than once per retrieval. The enriched query should be a single call.
- **Modifying stored embeddings:** Stored document embeddings must not be changed. Re-ranking happens post-retrieval only.
- **Over-penalizing cross-language results:** A Python finding about "SQL injection via string concatenation" is still relevant to a PHP PR. The penalty should be mild (~15%), not exclusionary.
- **Breaking the distance threshold contract:** The `distanceThreshold` config (default 0.3) should still apply to the original distance, not the adjusted distance. Re-ranking only changes ordering within the already-filtered set.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Language detection from file paths | Custom regex parser | `classifyFileLanguage()` from `diff-analysis.ts` | Already handles 25+ extensions, well-tested |
| PR intent parsing | Custom title parser | `parsePRIntent()` from `pr-intent-parser.ts` | Already extracts conventional commit types, bracket tags, focus areas |
| Diff risk signal extraction | Custom heuristics | `analyzeDiff().riskSignals` from `diff-analysis.ts` | Already handles path-based and content-based risk patterns |

**Key insight:** Every signal needed for RET-01 already exists as a function return value somewhere in the review pipeline. The work is composition, not creation.

## Common Pitfalls

### Pitfall 1: Query Length Explosion
**What goes wrong:** Concatenating too many signals creates a very long query string that exceeds the embedding model's effective context window or degrades embedding quality.
**Why it happens:** Voyage Code 3 has a context limit of ~16K tokens but embedding quality degrades with very long inputs. More text does not mean better embeddings.
**How to avoid:** Cap total query length to ~500-800 characters. Prioritize signals: title > body excerpt > languages > risk signals > file paths. Truncate aggressively.
**Warning signs:** Retrieval quality drops when many signals are added; A/B test before and after.

### Pitfall 2: Re-Ranking Distortion
**What goes wrong:** Aggressive language boosting causes irrelevant same-language results to rank above highly relevant cross-language results.
**Why it happens:** A same-language finding with distance 0.28 * 0.85 = 0.238 would rank above a cross-language finding with distance 0.15 * 1.15 = 0.172 -- but the cross-language one is actually more relevant.
**How to avoid:** Keep boost/penalty factors mild (0.85/1.15). The language signal should be a tiebreaker, not a dominant factor. Consider only applying re-ranking when original distances are within a narrow band (e.g., within 0.05 of each other).
**Warning signs:** Cross-language findings that were previously retrieved stop appearing.

### Pitfall 3: Breaking Fail-Open Semantics
**What goes wrong:** The new query construction or re-ranking code throws an exception, and the entire retrieval context is lost.
**Why it happens:** The retrieval path is already wrapped in try/catch at `review.ts:1430-1460`. But if the new code is inserted outside that block, or if it modifies the control flow, fail-open is broken.
**How to avoid:** Keep all new code inside the existing try/catch block. The `buildRetrievalQuery()` and `rerankByLanguage()` functions should be pure and never throw. Add defensive guards (null checks, empty array defaults).
**Warning signs:** Reviews failing with retrieval errors instead of proceeding without retrieval.

### Pitfall 4: Stale Language Data on Stored Records
**What goes wrong:** Historical findings have `filePath` values that may not represent the PR's primary language (e.g., a finding on a `.json` config file in a TypeScript PR).
**Why it happens:** The `filePath` stored in `LearningMemoryRecord` is the specific file the finding was on, not the primary language of the PR that generated it.
**How to avoid:** When the `classifyFileLanguage()` returns "Unknown" for a stored record, treat it as neutral (no boost, no penalty). Do not penalize findings on non-source files.
**Warning signs:** Findings on config/docs files being consistently demoted.

## Code Examples

### Integration Point in review.ts (lines ~1428-1461)
```typescript
// Current code (lines 1428-1461 in review.ts):
// const queryText = `${pr.title}\n${reviewFiles.slice(0, 20).join("\n")}`;

// Replace with:
import { buildRetrievalQuery } from "../learning/retrieval-query.ts";
import { rerankByLanguage } from "../learning/retrieval-rerank.ts";

const queryText = buildRetrievalQuery({
  prTitle: pr.title,
  prBody: pr.body ?? undefined,
  conventionalType: parsedIntent.conventionalType?.type ?? null,
  detectedLanguages: Object.keys(diffResult.filesByLanguage),
  riskSignals: diffResult.riskSignals,
  authorTier: authorResult.tier,
  topFilePaths: reviewFiles.slice(0, 15),
});

const embedResult = await embeddingProvider.generate(queryText, "query");
if (embedResult) {
  const retrieval = isolationLayer.retrieveWithIsolation({
    queryEmbedding: embedResult.embedding,
    repo: `${apiOwner}/${apiRepo}`,
    owner: apiOwner,
    sharingEnabled: config.knowledge.sharing.enabled,
    topK: config.knowledge.retrieval.topK,
    distanceThreshold: config.knowledge.retrieval.distanceThreshold,
    logger,
  });

  if (retrieval.results.length > 0) {
    // RET-02: Language-aware re-ranking
    const reranked = rerankByLanguage({
      results: retrieval.results,
      prLanguages: Object.keys(diffResult.filesByLanguage),
    });

    retrievalCtx = {
      findings: reranked.map(r => ({
        findingText: r.record.findingText,
        severity: r.record.severity,
        category: r.record.category,
        filePath: r.record.filePath,
        outcome: r.record.outcome,
        distance: r.adjustedDistance,
        sourceRepo: r.sourceRepo,
      })),
    };
  }
}
```

### Key Data Available at Retrieval Point
At the point where retrieval happens (`review.ts:~1428`), these variables are already in scope:
- `pr.title` - PR title string
- `pr.body` - PR body string (nullable)
- `parsedIntent` - `ParsedPRIntent` with `conventionalType`, `focusAreas`, etc.
- `diffResult.filesByLanguage` - `Record<string, string[]>` from `analyzeDiff()`
- `diffResult.riskSignals` - `string[]` from `analyzeDiff()`
- `authorResult.tier` - `AuthorTier` ("first-time" | "regular" | "core")
- `reviewFiles` - `string[]` of files to review

All signals are available without any additional data fetching.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Title + file paths only | Multi-signal query (this phase) | Phase 52 | Better semantic match between query and stored findings |
| Distance-only ranking | Language-aware re-ranking (this phase) | Phase 52 | Same-language findings surface preferentially |

**Explicitly out of scope (per phase description):**
- RET-03: Adaptive distance thresholds (knee-point detection)
- RET-04: Recency-weighted scoring
- RET-05: Retrieval quality metrics
- RET-06: Cross-language concept equivalence
- Custom embedding fine-tuning

## Open Questions

1. **Query text length budget**
   - What we know: Voyage Code 3 handles up to ~16K tokens, but quality likely degrades with very long inputs. The current query is ~500 chars (title + 20 file paths).
   - What's unclear: Optimal query length for retrieval quality with this model.
   - Recommendation: Start with a 600-char cap. Log query lengths in debug mode. This can be tuned later without architecture changes.

2. **Boost/penalty factor tuning**
   - What we know: The 0.85/1.15 values are reasonable starting points for mild language preference.
   - What's unclear: Optimal values depend on the actual distance distribution of stored findings.
   - Recommendation: Make factors configurable (via `RerankConfig`) but not exposed in `.kodiai.yml` yet. Tune after observing real retrieval patterns. Expose to users only if there's demand.

3. **Should re-ranking apply to shared pool results?**
   - What we know: Owner-level sharing pulls findings from other repos (different language profiles). Language re-ranking would affect these.
   - What's unclear: Whether cross-repo + same-language should be treated differently from same-repo + cross-language.
   - Recommendation: Apply re-ranking uniformly. The language signal is about finding relevance, not provenance. Provenance is already tracked separately.

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `src/handlers/review.ts` lines 1428-1461 -- current retrieval query construction
- Codebase inspection: `src/learning/isolation.ts` -- retrieval with isolation layer
- Codebase inspection: `src/learning/memory-store.ts` -- sqlite-vec backed vector store
- Codebase inspection: `src/learning/types.ts` -- LearningMemoryRecord, RetrievalResult types
- Codebase inspection: `src/execution/diff-analysis.ts` -- classifyFileLanguage(), classifyLanguages(), analyzeDiff()
- Codebase inspection: `src/lib/pr-intent-parser.ts` -- parsePRIntent(), ParsedPRIntent type
- Codebase inspection: `src/lib/author-classifier.ts` -- classifyAuthor(), AuthorTier type
- Codebase inspection: `src/execution/config.ts` -- retrieval config (topK, distanceThreshold, maxContextChars)
- Codebase inspection: `src/execution/review-prompt.ts` -- buildRetrievalContextSection()

### Secondary (MEDIUM confidence)
- Voyage AI documentation -- Voyage Code 3 supports `input_type: "query"` vs `"document"` asymmetric embedding, context limit ~16K tokens

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies, all existing libraries
- Architecture: HIGH - All signals already computed in review pipeline, clean extension points identified
- Pitfalls: HIGH - Based on direct codebase analysis, specific line numbers cited

**Research date:** 2026-02-14
**Valid until:** 2026-03-14 (stable -- no external dependency changes expected)
