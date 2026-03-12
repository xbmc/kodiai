---
id: S04
parent: M026
milestone: M026
provides:
  - docs/knowledge-system.md — comprehensive 5-corpus retrieval pipeline documentation
  - docs/issue-intelligence.md — triage, duplicate detection, threshold learning documentation
  - docs/guardrails.md — epistemic guardrail pipeline documentation
  - docs/README.md — updated index with links to all three feature docs
requires:
  - slice: S03
    provides: docs/ directory structure, docs/README.md index, docs/architecture.md and docs/configuration.md as cross-link targets
affects:
  - S05
key_files:
  - docs/knowledge-system.md
  - docs/issue-intelligence.md
  - docs/guardrails.md
  - docs/README.md
key_decisions:
  - Documented both legacy per-corpus pipeline outputs and unified cross-corpus pipeline to reflect actual backward-compatible API surface
patterns_established:
  - Knowledge system doc follows S03 pattern: overview → component table → strategies → pipeline flow → configuration reference
  - Issue intelligence doc follows pipeline-oriented structure: component table → subsystem details → handler flow → config reference
  - Guardrails doc follows pipeline-oriented structure: design principle → 4-stage pipeline → classification tiers → adapters table → audit → fail-open
observability_surfaces:
  - none
drill_down_paths:
  - .gsd/milestones/M026/slices/S04/tasks/T01-SUMMARY.md
  - .gsd/milestones/M026/slices/S04/tasks/T02-SUMMARY.md
  - .gsd/milestones/M026/slices/S04/tasks/T03-SUMMARY.md
duration: 32min
verification_result: passed
completed_at: 2026-03-11
---

# S04: Knowledge System & Feature Docs

**Wrote comprehensive documentation for all three major subsystems — knowledge retrieval (5 corpora, two-stage RRF), issue intelligence (triage, duplicate detection, Bayesian thresholds), and epistemic guardrails (4-stage pipeline, 6 surface adapters) — completing the feature documentation set.**

## What Happened

Read 35+ source files across `src/knowledge/`, `src/triage/`, `src/handlers/`, and `src/lib/guardrail/` to understand each subsystem, then wrote three documentation files following the S03 pattern (overview → components → flows → configuration references).

**T01 — docs/knowledge-system.md** (18 sections): 5-corpus table with store/chunker/embedding model per corpus, chunking strategies (thread-based, section-based, diff hunk, comment-based), embedding models (voyage-code-3 vs voyage-context-3 with contextualized API), full 9-step unified retrieval pipeline, two-stage RRF (per-corpus hybrid + cross-corpus merge), deduplication via Jaccard similarity, adaptive thresholds (gap-based → percentile → configured fallback), language-aware reranking, recency weighting (90-day half-life), snippet anchoring, background systems (wiki sync, staleness detection, review comment clustering), and configuration reference table.

**T02 — docs/issue-intelligence.md** (24 sections): 8-component summary table, template validation (parsing, best-fit matching, diff, guidance comments), duplicate detection (pipeline, threshold, comment format, fail-open), Bayesian threshold learning (Beta distribution, confusion matrix, posterior computation, effective threshold resolution chain), troubleshooting retrieval (7-step pipeline, thread assembly with budget distribution), handler idempotency (4-layer table), and configuration reference.

**T02 — docs/guardrails.md** (16 sections): Design principle (silent omission over hedging), 4-stage pipeline flow, 3-tier classification (diff-grounded, inferential, external-knowledge), strictness levels with overlap thresholds, LLM fallback (batched Haiku calls), general programming knowledge allowlist, 6 surface adapters table, adapter interface types, audit logging, multi-level fail-open design, and configuration reference.

**T03 — docs/README.md update**: Replaced "Coming soon" placeholder with linked entries for all three new docs. Verified all cross-links resolve bidirectionally.

## Verification

All 12 slice verification checks passed:
1. `test -f docs/knowledge-system.md` — PASS
2. `test -f docs/issue-intelligence.md` — PASS
3. `test -f docs/guardrails.md` — PASS
4. `grep -c '##' docs/knowledge-system.md` = 18 (≥ 8) — PASS
5. `grep -c '##' docs/issue-intelligence.md` = 24 (≥ 5) — PASS
6. `grep -c '##' docs/guardrails.md` = 16 (≥ 5) — PASS
7. README links to knowledge-system.md — PASS
8. README links to issue-intelligence.md — PASS
9. README links to guardrails.md — PASS
10. "Coming soon" placeholder removed — PASS
11. knowledge-system.md links to architecture.md — PASS
12. knowledge-system.md links to configuration.md — PASS

Cross-link verification: architecture.md → knowledge-system.md resolves, all three new docs → architecture.md, all three → configuration.md.

## Requirements Advanced

- R010 — Knowledge system documentation now complete: 18-section doc covering all 5 corpora, retrieval pipeline, and background systems

## Requirements Validated

- R010 — docs/knowledge-system.md exists with 18 sections accurately describing the 5-corpus retrieval pipeline, embedding strategy, hybrid search, two-stage RRF, and background systems from source code

## New Requirements Surfaced

- none

## Requirements Invalidated or Re-scoped

- none

## Deviations

None.

## Known Limitations

- Documentation accuracy is based on source code reading at time of writing; future code changes may cause docs to drift
- No automated doc-code sync mechanism exists

## Follow-ups

- S05 will link README to all three new docs and create CONTRIBUTING.md and CHANGELOG.md

## Files Created/Modified

- `docs/knowledge-system.md` — 5-corpus retrieval pipeline documentation (18 sections)
- `docs/issue-intelligence.md` — triage, duplicate detection, threshold learning documentation (24 sections)
- `docs/guardrails.md` — epistemic guardrail pipeline documentation (16 sections)
- `docs/README.md` — replaced "Coming soon" placeholder with links to all three feature docs

## Forward Intelligence

### What the next slice should know
- All feature docs are complete and linked from docs/README.md — S05 README rewrite should link to docs/README.md as the docs index rather than listing individual doc files
- docs/ now has 6 substantive docs: architecture.md, configuration.md, deployment.md, knowledge-system.md, issue-intelligence.md, guardrails.md

### What's fragile
- Documentation accuracy depends on source code not changing — there's no automated sync mechanism

### Authoritative diagnostics
- `grep -c '##' docs/*.md` gives section counts for all docs — quick way to verify substantiveness

### What assumptions changed
- none — S04 executed as planned with no surprises
