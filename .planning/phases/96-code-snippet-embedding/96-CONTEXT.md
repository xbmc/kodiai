# Phase 96: Code Snippet Embedding - Context

**Gathered:** 2026-02-25
**Status:** Ready for planning

<domain>
## Phase Boundary

PR diff hunks are embedded at hunk-level granularity and integrated as a fourth retrieval corpus, enabling sub-function semantic search across past PR changes. Ships behind `.kodiai.yml` flag (`retrieval.hunkEmbedding.enabled`) defaulting to enabled.

</domain>

<decisions>
## Implementation Decisions

### Chunking strategy
- Use git's native unified diff hunk boundaries (not AST-based function scoping)
- Skip pure-deletion hunks (only embed hunks with additions or modifications)
- Exclude generated/vendored files via a default pattern list (*.lock, vendor/, generated/) with `.kodiai.yml` override capability
- Embed hunk content prefixed with metadata: file path, function name from hunk header, and PR title — gives embedding model semantic anchoring without bloating tokens

### Embedding lifecycle
- Embed hunks after Kodiai's review completes (not during PR ingestion)
- All reviewed PRs qualify for hunk embedding (not just PRs with findings)
- Keep embeddings indefinitely — no TTL-based cleanup; deduplication handles bloat
- Content-hash deduplication: one embedding row per unique hunk content, with a junction table linking to each PR/file/line occurrence (shared embedding, per-PR metadata)

### Retrieval integration
- Equal weight with other three corpora (code memories, reviews, wiki) — similarity scores determine ranking naturally
- Show both snippet and code memory results when they overlap from the same PR, with distinct source labels ([snippet] vs [code])
- Compact metadata display: PR title + file path + line range (e.g., `[snippet] PR #1234: Fix buffer overflow — lib/codec/ffmpeg.cpp:142-158`)
- Shared result pool — all four corpora compete for the same top-N retrieval slots, no reserved slots per corpus

### Cost bounding
- Hard cap of 100 hunks per PR (default); when exceeded, keep the largest hunks by line count
- Cap is configurable per-repo via `retrieval.hunkEmbedding.maxHunksPerPr` in `.kodiai.yml`
- Minimum 3 changed lines (added/modified) to embed a hunk — filters trivial imports, whitespace changes

### Claude's Discretion
- Schema design for `code_snippets` table and junction table
- Embedding model choice and dimension
- Exact exclusion pattern defaults
- Batch processing strategy for embedding calls

</decisions>

<specifics>
## Specific Ideas

- Reuse the language column pattern validated in Phase 93 for the code_snippets table
- Feature flag path: `retrieval.hunkEmbedding.enabled` (default: true)
- Config path for hunk cap: `retrieval.hunkEmbedding.maxHunksPerPr` (default: 100)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 96-code-snippet-embedding*
*Context gathered: 2026-02-25*
