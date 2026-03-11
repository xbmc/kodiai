# T02: 91-cross-corpus-retrieval-integration 02

**Slice:** S03 — **Milestone:** M018

## Description

Build the cross-corpus Reciprocal Rank Fusion engine and cosine deduplication module.

Purpose: KI-15 requires RRF merging ranked lists from heterogeneous sources using `1/(k + rank)` scoring summed across lists. KI-19 requires near-duplicate chunks from different sources to be collapsed via cosine similarity threshold. This plan creates both as standalone, tested modules that the unified retrieval pipeline (plan 03) will consume.

Output: `crossCorpusRRF` function that merges ranked lists from code, review, and wiki corpora. `deduplicateChunks` function that collapses near-duplicates within and across corpora.

## Must-Haves

- [ ] "Ranked lists from different sources are merged via RRF with 1/(k + rank) scoring"
- [ ] "Near-duplicate chunks across corpora are collapsed via cosine similarity threshold"
- [ ] "Surviving deduped chunks carry alternate source annotations"

## Files

- `src/knowledge/cross-corpus-rrf.ts`
- `src/knowledge/cross-corpus-rrf.test.ts`
- `src/knowledge/dedup.ts`
- `src/knowledge/dedup.test.ts`
