---
id: T01
parent: S04
milestone: M026
provides:
  - docs/knowledge-system.md — comprehensive knowledge system documentation
key_files:
  - docs/knowledge-system.md
key_decisions:
  - Documented both legacy per-corpus pipeline outputs and unified cross-corpus pipeline to reflect actual backward-compatible API surface
patterns_established:
  - Knowledge system doc follows S03 pattern: overview → component table → strategies → pipeline flow → configuration reference
observability_surfaces:
  - none
duration: 15min
verification_result: passed
completed_at: 2026-03-11
blocker_discovered: false
---

# T01: Write docs/knowledge-system.md

**Wrote comprehensive documentation covering all 5 corpora, the two-stage RRF retrieval pipeline, and background systems**

## What Happened

Read 15+ source files across `src/knowledge/` to understand the complete retrieval pipeline, then wrote `docs/knowledge-system.md` with 18 sections covering:

- 5-corpus table (store, chunker, embedding model, description for each)
- Chunking strategies per corpus (thread-based, section-based, diff hunk, comment-based)
- Embedding models (voyage-code-3 vs voyage-context-3 with contextualized embedding API)
- Full 9-step unified retrieval pipeline with numbered steps
- Two-stage RRF (per-corpus hybrid merge + cross-corpus merge)
- Deduplication via Jaccard similarity at two stages
- Adaptive thresholds (gap-based → percentile → configured fallback)
- Language-aware reranking (legacy + unified pipeline proportional boost)
- Recency weighting (90-day half-life, severity floors)
- Snippet anchoring, repo isolation
- Background systems (wiki sync, staleness detection, review comment clustering)
- Configuration reference table linking to configuration.md

## Verification

All task must-have checks passed:
- `test -f docs/knowledge-system.md` — PASS
- `grep -c '##' docs/knowledge-system.md` = 18 (≥ 8) — PASS
- `grep -l 'architecture.md' docs/knowledge-system.md` — PASS
- `grep -l 'configuration.md' docs/knowledge-system.md` — PASS
- `grep -l 'RRF' docs/knowledge-system.md` — PASS
- 5-corpus table present with all corpora — PASS

Slice-level checks (partial — T01 is first of 4 tasks):
- knowledge-system.md exists — PASS
- knowledge-system.md sections ≥ 8 — PASS
- architecture.md cross-link — PASS
- configuration.md cross-link — PASS
- issue-intelligence.md exists — expected FAIL (T02)
- guardrails.md exists — expected FAIL (T03)

## Diagnostics

Read `docs/knowledge-system.md` to inspect the documentation.

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `docs/knowledge-system.md` — comprehensive 5-corpus retrieval pipeline documentation (resolves forward link from architecture.md)
