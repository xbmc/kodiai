# S04: Knowledge System & Feature Docs

**Goal:** Document the knowledge system, issue intelligence, and guardrail subsystems for open-source contributors.
**Demo:** docs/knowledge-system.md, docs/issue-intelligence.md, and docs/guardrails.md exist with accurate content from source code; docs/README.md links to all three.

## Must-Haves

- docs/knowledge-system.md covers all 5 corpora, chunking strategies, embedding models, hybrid search, two-stage RRF, dedup, adaptive thresholds, and background systems
- docs/issue-intelligence.md covers triage (template validation, duplicate detection, threshold learning) and troubleshooting retrieval
- docs/guardrails.md covers epistemic pipeline (claim classification, context grounding, 6 surface adapters, LLM fallback, audit)
- docs/README.md "Coming soon" placeholder replaced with real links to all three new docs
- architecture.md forward link to knowledge-system.md resolves (file exists)
- All docs cross-link to architecture.md for system context and configuration.md for config details
- Documentation follows S03 patterns: overview → components → flows → configuration references

## Proof Level

- This slice proves: contract (documentation accuracy verified against source code)
- Real runtime required: no
- Human/UAT required: yes (read-through for accuracy and completeness)

## Verification

- `test -f docs/knowledge-system.md` — file exists
- `test -f docs/issue-intelligence.md` — file exists
- `test -f docs/guardrails.md` — file exists
- `grep -c '##' docs/knowledge-system.md` ≥ 8 — substantive structure covering corpora, retrieval, background systems
- `grep -c '##' docs/issue-intelligence.md` ≥ 5 — substantive structure covering triage, duplicate detection, troubleshooting
- `grep -c '##' docs/guardrails.md` ≥ 5 — substantive structure covering pipeline, classification, adapters
- `grep -l 'knowledge-system.md' docs/README.md` — index links to knowledge system doc
- `grep -l 'issue-intelligence.md' docs/README.md` — index links to issue intelligence doc
- `grep -l 'guardrails.md' docs/README.md` — index links to guardrails doc
- `grep -l 'Coming soon' docs/README.md` exits non-zero — placeholder removed
- `grep -l 'architecture.md' docs/knowledge-system.md` — cross-link to architecture doc
- `grep -l 'configuration.md' docs/knowledge-system.md` — cross-link to configuration doc

## Observability / Diagnostics

- Runtime signals: none (documentation-only slice)
- Inspection surfaces: none
- Failure visibility: none
- Redaction constraints: none

## Integration Closure

- Upstream surfaces consumed: docs/architecture.md (forward link to knowledge-system.md), docs/README.md (placeholder to replace), docs/configuration.md (cross-link target)
- New wiring introduced in this slice: none (documentation only)
- What remains before the milestone is truly usable end-to-end: S05 (README rewrite, CONTRIBUTING.md, CHANGELOG.md)

## Tasks

- [x] **T01: Write docs/knowledge-system.md** `est:30m`
  - Why: The knowledge system is the largest subsystem (60+ files) with zero external docs; architecture.md has a forward link that needs to resolve; this is the primary deliverable of S04 and owns R010
  - Files: `docs/knowledge-system.md`, source files in `src/knowledge/`
  - Do: Read key source files (retrieval.ts, cross-corpus-rrf.ts, hybrid-search.ts, types.ts, each store, chunker, embeddings.ts, adaptive-threshold.ts, dedup.ts, multi-query-retrieval.ts, wiki-sync.ts, cluster-pipeline.ts). Write doc following S03 pattern: overview → 5-corpus table → chunking strategies → embedding models → retrieval pipeline flow (numbered steps) → two-stage RRF explanation → dedup → adaptive thresholds → language-aware reranking → background systems (wiki sync, staleness, clustering) → configuration references
  - Verify: `test -f docs/knowledge-system.md && grep -c '##' docs/knowledge-system.md` ≥ 8
  - Done when: Doc accurately describes current retrieval pipeline with all 5 corpora, both RRF stages, and background systems

- [x] **T02: Write docs/issue-intelligence.md and docs/guardrails.md** `est:25m`
  - Why: These two smaller subsystems complete the feature documentation set; both are well-defined and can be written in one task
  - Files: `docs/issue-intelligence.md`, `docs/guardrails.md`, source files in `src/triage/`, `src/lib/guardrail/`
  - Do: Read triage-agent.ts, template-parser.ts, duplicate-detector.ts, threshold-learner.ts, troubleshooting-retrieval.ts, thread-assembler.ts for issue-intelligence doc. Read pipeline.ts, context-classifier.ts, allowlist.ts, llm-classifier.ts, audit-store.ts, types.ts, and adapter files for guardrails doc. Write both docs following S03 pattern with overview → components → flows → configuration references. Include cross-links to architecture.md and configuration.md
  - Verify: `test -f docs/issue-intelligence.md && test -f docs/guardrails.md && grep -c '##' docs/issue-intelligence.md` ≥ 5
  - Done when: Both docs accurately describe their subsystems with component descriptions, flow diagrams, and config references

- [x] **T03: Update docs/README.md index and verify all links** `est:10m` ✅
  - Why: The docs index has a "Coming soon" placeholder that must be replaced; all cross-links between docs must resolve
  - Files: `docs/README.md`
  - Do: Replace the "Coming soon" placeholder in the Knowledge System section with links to knowledge-system.md, issue-intelligence.md, and guardrails.md with descriptions. Verify all forward links resolve (architecture.md → knowledge-system.md, README.md → all three new docs). Run all slice verification checks
  - Verify: All 12 slice verification checks pass
  - Done when: docs/README.md indexes all three new docs, no "Coming soon" placeholder remains, all cross-links resolve

## Files Likely Touched

- `docs/knowledge-system.md`
- `docs/issue-intelligence.md`
- `docs/guardrails.md`
- `docs/README.md`
