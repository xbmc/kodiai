# Phase 96: Code Snippet Embedding - Research

**Researched:** 2026-02-25
**Domain:** Hunk-level PR diff embedding, vector search, cross-corpus retrieval integration
**Confidence:** HIGH

## Summary

Phase 96 adds a fourth retrieval corpus — hunk-level PR diff snippets — to the existing cross-corpus RRF pipeline (code memories, review comments, wiki pages). The codebase already has a mature embedding and retrieval infrastructure using Voyage AI (`voyage-code-3`, 1024 dimensions), pgvector with HNSW indexes, and a well-defined `UnifiedRetrievalChunk` → `crossCorpusRRF()` → `deduplicateChunks()` pipeline in `src/knowledge/retrieval.ts`.

The implementation follows the same store/retrieval/integration pattern as review comments (Phase 89) and wiki pages (Phase 90): a `code_snippets` table with pgvector column, a store module, a chunker/parser module, a retrieval search function, and wiring into `createRetriever()`.

**Primary recommendation:** Mirror the review-comment corpus pattern exactly — create `code-snippet-store.ts`, `code-snippet-types.ts`, `code-snippet-chunker.ts`, `code-snippet-retrieval.ts`, a migration `009-code-snippets.sql`, and extend `SourceType` from `"code" | "review_comment" | "wiki"` to include `"snippet"`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Use git's native unified diff hunk boundaries (not AST-based function scoping)
- Skip pure-deletion hunks (only embed hunks with additions or modifications)
- Exclude generated/vendored files via a default pattern list (*.lock, vendor/, generated/) with `.kodiai.yml` override capability
- Embed hunk content prefixed with metadata: file path, function name from hunk header, and PR title — gives embedding model semantic anchoring without bloating tokens
- Embed hunks after Kodiai's review completes (not during PR ingestion)
- All reviewed PRs qualify for hunk embedding (not just PRs with findings)
- Keep embeddings indefinitely — no TTL-based cleanup; deduplication handles bloat
- Content-hash deduplication: one embedding row per unique hunk content, with a junction table linking to each PR/file/line occurrence (shared embedding, per-PR metadata)
- Equal weight with other three corpora — similarity scores determine ranking naturally
- Show both snippet and code memory results when they overlap from the same PR, with distinct source labels ([snippet] vs [code])
- Compact metadata display: PR title + file path + line range (e.g., `[snippet] PR #1234: Fix buffer overflow — lib/codec/ffmpeg.cpp:142-158`)
- Shared result pool — all four corpora compete for the same top-N retrieval slots, no reserved slots per corpus
- Hard cap of 100 hunks per PR (default); when exceeded, keep the largest hunks by line count
- Cap is configurable per-repo via `retrieval.hunkEmbedding.maxHunksPerPr` in `.kodiai.yml`
- Minimum 3 changed lines (added/modified) to embed a hunk — filters trivial imports, whitespace changes

### Claude's Discretion
- Schema design for `code_snippets` table and junction table
- Embedding model choice and dimension
- Exact exclusion pattern defaults
- Batch processing strategy for embedding calls

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SNIP-01 | PR diff hunks are chunked at the hunk level for embedding | Diff parsing module — parse `@@` hunk headers from unified diff format, extract added/modified lines, apply min-3-lines filter |
| SNIP-02 | Hunk embeddings stored in dedicated `code_snippets` table with PR/file/line metadata | Migration 009 creates `code_snippets` + `code_snippet_occurrences` junction table; follows pgvector pattern from learning_memories and review_comments |
| SNIP-03 | Content-hash caching prevents re-embedding identical hunks across PRs | SHA-256 content hash on the embedded text; UPSERT by hash; junction table links hash → PR/file/line occurrences |
| SNIP-04 | Hunk embeddings integrated into cross-corpus retrieval as fourth corpus | Extend `SourceType` union, add `"snippet"` source list to `crossCorpusRRF()`, add snippet-to-unified normalizer |
| SNIP-05 | Embedding cost bounded by configurable hunk cap | Config schema extension for `retrieval.hunkEmbedding`, per-PR hunk cap with largest-first selection, exclusion patterns |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| voyageai | (existing) | Embedding generation | Already used via `createEmbeddingProvider()` — `voyage-code-3` model, 1024 dimensions |
| postgres.js | (existing) | PostgreSQL client with pgvector | Already used for all stores via `Sql` type from `src/db/client.ts` |
| pgvector | (existing) | Vector similarity search | HNSW indexes with cosine distance already configured |
| zod | (existing) | Config schema validation | Already used in `src/execution/config.ts` for `.kodiai.yml` parsing |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| picomatch | (existing) | Glob pattern matching for exclusion patterns | Already a dependency, used in `src/execution/diff-analysis.ts` |
| node:crypto | (built-in) | SHA-256 content hashing for dedup | createHash('sha256').update(text).digest('hex') |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SHA-256 content hash | MD5 | SHA-256 is standard; MD5 is faster but collision risk; no meaningful perf difference at <100 hashes/PR |
| Junction table | Denormalized rows | Junction avoids re-embedding identical content; trades JOIN cost for embedding API cost savings |

**Installation:** No new dependencies needed — all libraries are already in use.

## Architecture Patterns

### Recommended Project Structure
```
src/knowledge/
├── code-snippet-types.ts      # Types: CodeSnippetRecord, CodeSnippetOccurrence, CodeSnippetStore
├── code-snippet-chunker.ts    # parseDiffHunks(): extract hunks from unified diff
├── code-snippet-store.ts      # createCodeSnippetStore(): CRUD with pgvector
├── code-snippet-retrieval.ts  # searchCodeSnippets(): vector search + fail-open
├── cross-corpus-rrf.ts        # Extended SourceType: add "snippet"
├── retrieval.ts               # Wire snippet corpus into createRetriever()
└── index.ts                   # Re-export new modules
src/db/migrations/
├── 009-code-snippets.sql      # Table + indexes
└── 009-code-snippets.down.sql # Rollback
src/execution/
└── config.ts                  # Add retrieval.hunkEmbedding schema
```

### Pattern 1: Store Module Pattern (established)
**What:** Each corpus has a `create*Store()` factory returning an interface with `write*()`, `searchByEmbedding()`, `searchByFullText()`.
**When to use:** All knowledge corpus stores.
**Example:**
```typescript
// Follow review-comment-store.ts pattern exactly:
export function createCodeSnippetStore(opts: {
  sql: Sql;
  logger: Logger;
}): CodeSnippetStore {
  return {
    async writeSnippet(record, embedding): Promise<void> { /* UPSERT by content_hash */ },
    async writeOccurrence(occurrence): Promise<void> { /* INSERT into junction table */ },
    async searchByEmbedding(params): Promise<CodeSnippetSearchResult[]> { /* pgvector cosine */ },
    async searchByFullText(params): Promise<CodeSnippetSearchResult[]> { /* tsvector BM25 */ },
    close() {},
  };
}
```

### Pattern 2: Content-Hash Deduplication (new for this phase)
**What:** SHA-256 hash of the embedded text serves as the dedup key. The snippets table uses content_hash as unique constraint; a junction table links each hash to PR/file/line occurrences.
**When to use:** When multiple PRs can produce identical hunks.
**Example:**
```typescript
import { createHash } from "node:crypto";

function computeContentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// Store: UPSERT on content_hash, separate INSERT for occurrence
async writeSnippet(record, embedding) {
  const hash = computeContentHash(record.embeddedText);
  await sql`
    INSERT INTO code_snippets (content_hash, embedded_text, embedding, ...)
    VALUES (${hash}, ${record.embeddedText}, ${embeddingString}::vector, ...)
    ON CONFLICT (content_hash) DO NOTHING
  `;
}
```

### Pattern 3: Unified Diff Hunk Parsing
**What:** Parse `@@ -old,count +new,count @@` headers and extract added/modified lines.
**When to use:** Processing PR diffs for embedding.
**Example:**
```typescript
// Parse unified diff format (git's default output)
const HUNK_HEADER_RE = /^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@\s*(.*)$/;

type DiffHunk = {
  startLine: number;
  lineCount: number;
  functionContext: string; // from @@ header
  addedLines: string[];
  content: string; // full hunk content for embedding
};
```

### Anti-Patterns to Avoid
- **Re-embedding on every PR:** Content-hash dedup prevents this. Always check hash before calling Voyage API.
- **Embedding pure deletion hunks:** Context.md explicitly excludes these — only additions/modifications.
- **Unbounded embedding calls:** Always apply the per-PR hunk cap BEFORE calling the embedding API, not after.
- **Blocking review on embedding failure:** The entire hunk embedding pipeline must be fail-open, exactly like the existing embedding provider.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Diff parsing | Custom regex-only parser | Git's unified diff format with well-tested regex | Hunks are delimited by `@@` markers; git's format is stable |
| Vector search | Custom similarity computation | pgvector HNSW with cosine distance | Already configured and indexed in existing corpora |
| Content dedup | Bloom filter / fuzzy matching | SHA-256 exact content hash | Exact dedup is what CONTEXT.md specifies; Jaccard dedup already handles near-duplicates in the RRF pipeline |
| Config validation | Manual parsing | Zod schema extension in config.ts | All other config uses Zod; consistency matters |
| Glob pattern matching | Custom glob implementation | picomatch (existing dep) | Already used in diff-analysis.ts |

**Key insight:** The codebase has established patterns for every component of this feature. The risk is in departing from those patterns, not in the patterns themselves.

## Common Pitfalls

### Pitfall 1: Hunk Boundary Parsing Edge Cases
**What goes wrong:** Diff format has edge cases: no-newline-at-end-of-file markers (`\ No newline at end of file`), binary file markers, and context-only hunks with zero additions.
**Why it happens:** Git's unified diff format is simple but has corner cases.
**How to avoid:** Filter hunks by counting `+` lines (not `-` or ` ` context lines). Skip hunks where addedLineCount < 3.
**Warning signs:** Test with empty diffs, binary-only diffs, and rename-only diffs.

### Pitfall 2: Embedding Text Bloat
**What goes wrong:** Including too much context in the embedded text (full diff with - lines, context lines) wastes embedding tokens and dilutes signal.
**Why it happens:** Temptation to embed the "full picture."
**How to avoid:** Per CONTEXT.md: embed only added/modified lines, prefixed with file path + function name + PR title. Keep it semantic, not exhaustive.
**Warning signs:** Embedded text exceeding ~500 tokens per hunk.

### Pitfall 3: Junction Table Write Amplification
**What goes wrong:** Every PR creates N occurrence rows even if all snippets already exist. With high-frequency repos, the junction table grows rapidly.
**Why it happens:** The dedup design trades storage for embedding API cost.
**How to avoid:** This is expected — junction rows are tiny (just IDs + metadata). Add an index on `(content_hash)` and `(repo, pr_number)` for efficient lookup and cleanup.
**Warning signs:** Junction table > 100x snippets table — likely means very few unique hunks (consider increasing min-line threshold).

### Pitfall 4: Blocking Review Completion
**What goes wrong:** Embedding 100 hunks × 10ms each = 1 second synchronous in the review path.
**Why it happens:** Embedding after review completion means it's in the response path.
**How to avoid:** Fire-and-forget (async). The review handler should complete and post the review, then trigger hunk embedding asynchronously. If embedding fails, next review still works — fail-open.
**Warning signs:** Review latency regression after enabling hunk embedding.

## Code Examples

### Unified Diff Hunk Parser
```typescript
const HUNK_HEADER_RE = /^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@\s*(.*)$/;

export type ParsedHunk = {
  filePath: string;
  startLine: number;
  lineCount: number;
  functionContext: string;
  addedLines: string[];
  fullContent: string;
};

export function parseDiffHunks(diffText: string, filePath: string): ParsedHunk[] {
  const lines = diffText.split("\n");
  const hunks: ParsedHunk[] = [];
  let currentHunk: ParsedHunk | null = null;

  for (const line of lines) {
    const headerMatch = HUNK_HEADER_RE.exec(line);
    if (headerMatch) {
      if (currentHunk && currentHunk.addedLines.length >= 3) {
        hunks.push(currentHunk);
      }
      currentHunk = {
        filePath,
        startLine: parseInt(headerMatch[1]!, 10),
        lineCount: parseInt(headerMatch[2] ?? "1", 10),
        functionContext: headerMatch[3]?.trim() ?? "",
        addedLines: [],
        fullContent: "",
      };
      continue;
    }
    if (currentHunk) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        currentHunk.addedLines.push(line.slice(1));
      }
      currentHunk.fullContent += line + "\n";
    }
  }
  // Don't forget the last hunk
  if (currentHunk && currentHunk.addedLines.length >= 3) {
    hunks.push(currentHunk);
  }
  return hunks;
}
```

### Embedding Text Assembly
```typescript
export function buildEmbeddingText(hunk: ParsedHunk, prTitle: string): string {
  const header = [prTitle, hunk.filePath];
  if (hunk.functionContext) header.push(hunk.functionContext);
  return `${header.join(" | ")}\n${hunk.addedLines.join("\n")}`;
}
```

### Snippet-to-Unified Normalizer
```typescript
// Follows existing memoryToUnified / reviewMatchToUnified / wikiMatchToUnified pattern
function snippetToUnified(match: CodeSnippetMatch, repo: string): UnifiedRetrievalChunk {
  return {
    id: `snippet:${match.contentHash}:${match.distance}`,
    text: match.embeddedText,
    source: "snippet",
    sourceLabel: `[snippet] PR #${match.prNumber}: ${match.prTitle ?? "untitled"} — ${match.filePath}:${match.startLine}-${match.endLine}`,
    sourceUrl: `https://github.com/${repo}/pull/${match.prNumber}`,
    vectorDistance: match.distance,
    rrfScore: 0,
    createdAt: match.createdAt,
    metadata: {
      contentHash: match.contentHash,
      filePath: match.filePath,
      startLine: match.startLine,
      endLine: match.endLine,
      prNumber: match.prNumber,
      prTitle: match.prTitle,
      language: match.language,
    },
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| File-level code memories | Hunk-level snippets (this phase) | Phase 96 | Sub-function granularity for retrieval |
| 3-corpus RRF | 4-corpus RRF with snippets | Phase 96 | Richer retrieval context |
| No code dedup | Content-hash dedup | Phase 96 | Prevents embedding cost explosion |

**Deprecated/outdated:** None — this is net-new functionality.

## Open Questions

1. **Batch embedding vs. individual calls**
   - What we know: Voyage AI supports batch embedding (array of inputs in one call).
   - What's unclear: Whether the existing `EmbeddingProvider.generate()` interface should be extended for batch, or if sequential calls with the existing interface are sufficient.
   - Recommendation: Use existing `generate()` in a loop for simplicity. 100 hunks × ~10ms = ~1s total. Batch optimization can be a follow-up if latency matters.

2. **tsvector full-text search for snippets**
   - What we know: Review comments and wiki pages both have `tsvector` columns and `searchByFullText()`. Code memories have it too.
   - What's unclear: Whether the code snippet text (which is raw code, not natural language) benefits from BM25.
   - Recommendation: Add tsvector column in migration but make `searchByFullText` optional — vector search is the primary path for code. Can enable BM25 later if needed.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `src/knowledge/retrieval.ts` — cross-corpus RRF pipeline, unified chunk normalization
- Codebase analysis: `src/knowledge/embeddings.ts` — Voyage AI provider, fail-open pattern
- Codebase analysis: `src/knowledge/cross-corpus-rrf.ts` — RRF algorithm, `SourceType` union
- Codebase analysis: `src/knowledge/review-comment-store.ts` — store pattern with pgvector
- Codebase analysis: `src/knowledge/dedup.ts` — Jaccard deduplication
- Codebase analysis: `src/db/migrations/007-language-column.sql` — language column pattern from Phase 93
- Codebase analysis: `src/execution/config.ts` — Zod config schema, `.kodiai.yml` structure

### Secondary (MEDIUM confidence)
- Codebase analysis: `src/execution/diff-analysis.ts` — language classification, picomatch usage

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already in use in the codebase
- Architecture: HIGH - direct pattern replication from existing corpora
- Pitfalls: HIGH - identified from actual codebase patterns and known diff parsing edge cases

**Research date:** 2026-02-25
**Valid until:** 2026-03-25 (stable — internal codebase patterns)
