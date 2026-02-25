# Phase 93: Language-Aware Retrieval Boosting - Research

**Researched:** 2026-02-25
**Domain:** Database schema extension, retrieval pipeline re-ranking, wiki content analysis
**Confidence:** HIGH

## Summary

Phase 93 adds a `language` column to `learning_memories`, a `language_tags` column to `wiki_pages`, and replaces the runtime `classifyFileLanguage()` call in `rerankByLanguage()` with stored metadata. The existing `EXTENSION_LANGUAGE_MAP` in `diff-analysis.ts` provides the classification function. A migration script backfills existing records from their `file_path` column. The unified cross-corpus pipeline in `retrieval.ts` gets language-aware boosting applied in exactly one location.

The codebase already has language-based reranking in `retrieval-rerank.ts` (the legacy pipeline) and cross-corpus RRF in `cross-corpus-rrf.ts` (the unified pipeline). The key change is: (1) store language at write time instead of deriving at query time, (2) extend boosting to cover all three corpora via the unified pipeline, and (3) remove the legacy language reranking to prevent double-boost.

**Primary recommendation:** Add `language TEXT` to `learning_memories` and `language_tags TEXT[]` to `wiki_pages` via migration 007. Consolidate language boosting into the unified pipeline (step 6e in `retrieval.ts`), remove the legacy `rerankByLanguage()` call from step 4.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Ambiguous file extensions resolved using repository context (other files in the same PR/repo determine the language; e.g., `.h` treated as C++ if PR contains `.cpp` files), with fallback to most common usage
- C and C++ stored as separate languages but treated as related languages with affinity during retrieval boosting
- Files with unknown or missing extensions tagged as `unknown` — no boost or penalty during retrieval, ranked on semantic similarity alone
- Comprehensive taxonomy covering 30+ languages — map every known extension to its language rather than grouping into broad categories
- One-time migration script (not background job or lazy backfill)
- Classify from stored file paths only — no need for files to still exist on disk
- Idempotent: safe to re-run, only classifies records with no language set (skips already-classified)
- Stats summary logged at completion: total records, records per language, records marked 'unknown', failures
- Query language determined from PR file extensions (files changed in the PR)
- For multi-language PRs, boost is proportional to change volume (80% C++ / 20% Python → C++ results get stronger boost)
- Boost matching languages only — non-matching results keep their original score, never penalized
- Related-language affinity (e.g., C/C++) uses a fixed fraction of exact-match boost (Claude decides exact ratio)
- Language weighting applied in exactly one location in the retrieval pipeline — no double-boost
- Multiple language affinity tags per wiki page (a page covering both Python and C++ gets both tags)
- Language affinity determined by content analysis at ingest time (code blocks, language mentions, API references)
- Non-code wiki pages (process, governance, etc.) explicitly tagged as `general` — no language boost, ranked on semantic similarity
- Language tags re-analyzed every time a wiki page is re-ingested — tags stay current as content evolves

### Claude's Discretion
- Exact boost factor magnitude and related-language affinity ratio
- Language detection implementation details (extension mapping data structure, content analysis approach for wiki)
- Migration script batch size and error handling specifics
- Database schema design for the language column(s)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LANG-01 | Learning memory records store the programming language of their source file | Migration 007 adds `language TEXT` column; `memory-store.ts` `writeMemory()` calls `classifyFileLanguage()` on insert |
| LANG-02 | Existing learning memory records are backfilled with language classification | Migration 007 includes SQL UPDATE backfill using file_path LIKE patterns matching `EXTENSION_LANGUAGE_MAP` |
| LANG-03 | Retrieval re-ranking applies language-aware boost using stored language instead of re-classifying at query time | `rerankByLanguage()` reads `record.language` from DB row instead of calling `classifyFileLanguage(record.filePath)` |
| LANG-04 | Double-boost risk eliminated — unified pipeline is the single location for language weighting | Remove legacy `rerankByLanguage()` call from step 4 in `retrieval.ts`; apply language boost only in unified pipeline step 6e |
| LANG-05 | Wiki pages are tagged with language affinity so language-filtered retrieval spans all corpora | Migration adds `language_tags TEXT[]` to `wiki_pages`; wiki chunker/sync populates tags via content analysis; unified pipeline uses tags for boosting |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| postgres.js | existing | SQL queries for migration, backfill, store writes | Already used throughout codebase via `src/db/client.ts` |
| pgvector | existing | Vector similarity search with HNSW indexes | Already configured with cosine distance operators |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| picomatch | existing | File pattern matching | Already used in `diff-analysis.ts` for file categorization |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SQL LIKE backfill | Node.js script reading rows | SQL is faster for bulk updates, Node.js needed only if classification logic is too complex for SQL CASE |
| TEXT[] for wiki language_tags | Separate junction table | Array column is simpler, no joins needed, and wiki pages have few tags (1-5 per page) |

## Architecture Patterns

### Recommended File Changes
```
src/
├── db/migrations/
│   ├── 007-language-column.sql        # NEW: Add language columns + backfill
│   └── 007-language-column.down.sql   # NEW: Rollback
├── execution/
│   └── diff-analysis.ts               # MODIFIED: Expand EXTENSION_LANGUAGE_MAP to 30+ languages, add RELATED_LANGUAGES map, add ambiguous extension resolver
├── knowledge/
│   ├── memory-store.ts                # MODIFIED: Populate language column on writeMemory()
│   ├── types.ts                       # MODIFIED: Add language field to LearningMemoryRecord, MemoryRow
│   ├── retrieval-rerank.ts            # MODIFIED: Read stored language instead of classifying at runtime
│   ├── retrieval.ts                   # MODIFIED: Move language boosting to unified pipeline (step 6e), remove legacy rerankByLanguage call
│   ├── cross-corpus-rrf.ts            # MODIFIED: Add optional language boost parameter
│   ├── wiki-types.ts                  # MODIFIED: Add languageTags to WikiPageChunk, WikiPageRecord
│   ├── wiki-store.ts                  # MODIFIED: Read/write language_tags column
│   ├── wiki-chunker.ts               # MODIFIED: Add language affinity detection from content
│   └── wiki-sync.ts                   # MODIFIED: Pass language tags through sync pipeline
└── scripts/
    └── backfill-language.ts           # NEW: Standalone idempotent backfill script (if SQL CASE approach is insufficient)
```

### Pattern 1: Schema-Additive Migration
**What:** Add nullable columns to existing tables without breaking existing queries
**When to use:** Always for production schema changes
**Example:**
```sql
-- Migration 007-language-column.sql
ALTER TABLE learning_memories ADD COLUMN IF NOT EXISTS language TEXT;
CREATE INDEX IF NOT EXISTS idx_memories_language ON learning_memories(language);

ALTER TABLE wiki_pages ADD COLUMN IF NOT EXISTS language_tags TEXT[] DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_wiki_pages_language_tags ON wiki_pages USING gin(language_tags);
```

### Pattern 2: Write-Time Classification
**What:** Classify language at write time and store it, rather than deriving at query time
**When to use:** When the classification input (file_path) is immutable once stored
**Example:**
```typescript
// memory-store.ts writeMemory() — add language classification
const language = classifyFileLanguage(record.filePath);
await sql`
  INSERT INTO learning_memories (..., language) VALUES (..., ${language})
`;
```

### Pattern 3: Proportional Multi-Language Boost
**What:** When a PR has multiple languages, weight boost by change volume proportion
**When to use:** In the unified pipeline language boost step
**Example:**
```typescript
// Build language weight map from PR file extensions
// { "C++": 0.8, "Python": 0.2 } if 80% of changes are C++
const langWeights = buildLanguageWeights(prLanguages, prFilesByLanguage);

for (const chunk of unifiedResults) {
  const chunkLang = getChunkLanguage(chunk); // from metadata
  const boost = langWeights[chunkLang] ?? getAffinityBoost(chunkLang, langWeights);
  chunk.rrfScore *= (1 + boost * LANGUAGE_BOOST_FACTOR);
}
```

### Anti-Patterns to Avoid
- **Double boosting:** Applying language boost in both the legacy `rerankByLanguage()` and the unified pipeline. The user constraint is explicit: exactly one location.
- **Runtime re-classification:** Calling `classifyFileLanguage()` during retrieval when the language is already stored in the database.
- **Penalizing non-matching:** The CONTEXT.md explicitly says non-matching results keep their original score, never penalized. The current `rerankByLanguage()` applies a 1.15x penalty — this must be removed.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File extension → language mapping | Custom regex parser | Existing `EXTENSION_LANGUAGE_MAP` in `diff-analysis.ts` | Already tested, covers 20+ extensions, just needs expansion to 30+ |
| SQL migration runner | Custom migration logic | Existing migration framework (numbered SQL files in `src/db/migrations/`) | Consistent with all prior migrations (001-006) |

## Common Pitfalls

### Pitfall 1: Double-Boost from Legacy + Unified Paths
**What goes wrong:** Language boost applied in `rerankByLanguage()` (legacy, step 4) AND in the unified pipeline (step 6e), causing language-matching results to be over-promoted.
**Why it happens:** The legacy and unified pipelines currently coexist. `retrieval.ts` calls `rerankByLanguage()` at line 361 for learning memories, then builds unified results from those already-boosted results.
**How to avoid:** Move all language boosting to the unified pipeline (step 6e). Remove the `rerankByLanguage()` call from step 4, or make it language-neutral (distance pass-through with no boost/penalty). The unified pipeline can boost all three corpora uniformly.
**Warning signs:** `adjustedDistance` values on learning memories already reflecting language multipliers before entering the unified pipeline.

### Pitfall 2: Cross-Language Penalty Violates User Constraint
**What goes wrong:** Current `rerankByLanguage()` applies `crossLanguagePenalty: 1.15` to non-matching languages. CONTEXT.md says: "Boost matching languages only — non-matching results keep their original score, never penalized."
**Why it happens:** Legacy design choice predates the discuss-phase constraint.
**How to avoid:** New unified language boost must only multiply matching results. Non-matching results get multiplier 1.0 (unchanged score).
**Warning signs:** Any code path that increases distance or decreases score for non-matching language results.

### Pitfall 3: `.h` Files Classified as C Instead of C++
**What goes wrong:** The current `EXTENSION_LANGUAGE_MAP` maps `.h` to `"C"`. In repositories that are primarily C++, this misclassifies header files.
**Why it happens:** `.h` is genuinely ambiguous between C and C++.
**How to avoid:** Implement the repository-context disambiguation from CONTEXT.md: if the PR/repo contains `.cpp` files, treat `.h` as C++. Fallback to C (most common usage in isolation).
**Warning signs:** C++ PR with `.h` file changes not getting C++ boost.

### Pitfall 4: Wiki Language Tags Overwritten on Re-Ingest
**What goes wrong:** Not a pitfall — this is desired behavior per CONTEXT.md ("Language tags re-analyzed every time a wiki page is re-ingested"). But the implementation must ensure `replacePageChunks()` passes new language tags.
**How to avoid:** Language analysis must be part of the chunking/sync pipeline, not a separate post-processing step.

## Code Examples

### Current Legacy Language Reranking (to be refactored)
```typescript
// retrieval-rerank.ts — current implementation uses runtime classification
const language = classifyFileLanguage(result.record.filePath);
// PROBLEM: derives language at query time from file_path
// PROBLEM: applies crossLanguagePenalty (violates "never penalized" constraint)
```

### Target: Store Language on Write
```typescript
// memory-store.ts — writeMemory()
import { classifyFileLanguage } from "../execution/diff-analysis.ts";

async writeMemory(record: LearningMemoryRecord, embedding: Float32Array): Promise<void> {
  const language = classifyFileLanguage(record.filePath);
  await sql`
    INSERT INTO learning_memories (
      ..., language
    ) VALUES (
      ..., ${language === 'Unknown' ? 'unknown' : language.toLowerCase()}
    )
    ON CONFLICT (repo, finding_id, outcome) DO NOTHING
  `;
}
```

### Target: Unified Pipeline Language Boost
```typescript
// retrieval.ts — step 6e replacement
// Build proportional language weights from PR files
const langWeightMap = buildProportionalLanguageWeights(prLanguages);
const BOOST_FACTOR = 0.25; // exact match boost magnitude
const AFFINITY_RATIO = 0.5; // related language gets 50% of exact boost

for (const chunk of unifiedResults) {
  const chunkLang = chunk.metadata?.language as string | undefined;
  if (!chunkLang || chunkLang === 'unknown') continue; // neutral — no boost

  let boost = 0;
  if (langWeightMap.has(chunkLang)) {
    boost = langWeightMap.get(chunkLang)! * BOOST_FACTOR;
  } else if (isRelatedLanguage(chunkLang, langWeightMap)) {
    boost = getMaxRelatedWeight(chunkLang, langWeightMap) * BOOST_FACTOR * AFFINITY_RATIO;
  }

  if (boost > 0) {
    chunk.rrfScore *= (1 + boost);
  }
}
```

### Target: Wiki Language Tag Detection
```typescript
// wiki-chunker.ts — detect language affinity from content
function detectLanguageTags(chunkText: string, rawText: string): string[] {
  const tags = new Set<string>();

  // 1. Detect from fenced code blocks: ```python, ```cpp, etc.
  const codeBlockLangs = rawText.match(/```(\w+)/g);
  if (codeBlockLangs) {
    for (const match of codeBlockLangs) {
      const lang = match.replace('```', '').toLowerCase();
      const mapped = CODE_BLOCK_LANG_MAP[lang];
      if (mapped) tags.add(mapped);
    }
  }

  // 2. Detect from API references and language mentions
  // (e.g., "Python API", "C++ implementation")
  // ... content analysis heuristics

  // 3. If no code-specific content found, tag as 'general'
  if (tags.size === 0) tags.add('general');

  return Array.from(tags);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Runtime language classification on every retrieval | Store at write time, read from DB | Phase 93 (this phase) | Eliminates redundant computation, enables SQL-level filtering |
| Language boost only for learning memories | Language boost across all 3 corpora | Phase 93 (this phase) | Wiki and review results also ranked by language relevance |
| Cross-language penalty (1.15x) | Boost-only, no penalty | Phase 93 (this phase) | Matches user constraint; non-matching results unaffected |

## Open Questions

1. **Backfill approach: SQL vs Node.js script?**
   - What we know: `EXTENSION_LANGUAGE_MAP` covers ~25 extensions. SQL CASE with LIKE patterns can handle this.
   - What's unclear: Whether the ambiguous `.h` extension resolver (needs repo context) should run during backfill or only on new writes.
   - Recommendation: SQL backfill for the simple cases (direct extension mapping). For `.h` files, tag as `c` in backfill (most common), then let new writes use the full context-aware resolver. This is acceptable because backfill is one-time and the boost is a ranking signal, not a filter.

2. **Unified pipeline language boost location**
   - What we know: Step 6e currently applies `SOURCE_WEIGHTS` (corpus-type weighting). Language boosting should integrate here.
   - What's unclear: Whether language boost should be multiplicative with source weights or additive.
   - Recommendation: Multiplicative — language is orthogonal to source type. A C++ code finding in a C++ PR should get both the source weight boost and the language match boost.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `src/knowledge/retrieval.ts`, `retrieval-rerank.ts`, `cross-corpus-rrf.ts` — direct inspection of current pipeline
- Codebase analysis: `src/execution/diff-analysis.ts` — existing `EXTENSION_LANGUAGE_MAP` and `classifyFileLanguage()`
- Codebase analysis: `src/db/migrations/001-006` — existing schema patterns
- Codebase analysis: `src/knowledge/memory-store.ts`, `wiki-store.ts`, `wiki-types.ts` — current store interfaces

### Secondary (MEDIUM confidence)
- `.planning/research/ARCHITECTURE.md` — pre-existing project research on language-aware retrieval architecture

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies needed
- Architecture: HIGH — clear extension of existing patterns, all touch points identified
- Pitfalls: HIGH — double-boost risk is well-understood and documented in STATE.md Critical Pitfalls

**Research date:** 2026-02-25
**Valid until:** 2026-03-25 (stable — schema extension, no external dependency changes)
