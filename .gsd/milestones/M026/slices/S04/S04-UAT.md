# S04: Knowledge System & Feature Docs — UAT

**Milestone:** M026
**Written:** 2026-03-11

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: This slice produces only documentation files — no runtime behavior changes. Accuracy is verified by reading docs against source code.

## Preconditions

- docs/ directory exists with architecture.md, configuration.md, deployment.md from S03
- docs/README.md exists with placeholder section for knowledge system docs

## Smoke Test

Open docs/README.md and confirm it links to knowledge-system.md, issue-intelligence.md, and guardrails.md with no "Coming soon" placeholder remaining.

## Test Cases

### 1. Knowledge System Documentation Completeness

1. Open docs/knowledge-system.md
2. Verify it contains a table listing all 5 corpora (review comments, wiki articles, code snippets, issues, discussions)
3. Verify it describes the two-stage RRF retrieval pipeline
4. Verify it covers embedding models, chunking strategies, and adaptive thresholds
5. Verify it covers background systems (wiki sync, staleness, clustering)
6. **Expected:** All 5 corpora documented with store/chunker/model details; retrieval pipeline has numbered steps; background systems have their own sections

### 2. Issue Intelligence Documentation Completeness

1. Open docs/issue-intelligence.md
2. Verify it describes template validation, duplicate detection, and threshold learning
3. Verify it includes the troubleshooting retrieval pipeline
4. Verify it documents handler idempotency layers
5. **Expected:** Component table with file paths, Bayesian threshold learning formula, 4-layer idempotency table, configuration reference

### 3. Guardrails Documentation Completeness

1. Open docs/guardrails.md
2. Verify it describes the 4-stage epistemic pipeline (extract → classify → filter → reconstruct)
3. Verify it documents all 3 classification tiers and 6 surface adapters
4. Verify it covers LLM fallback and fail-open design
5. **Expected:** Pipeline flow diagram, classification tier descriptions with strictness thresholds, adapter table with grounding sources, audit logging fields

### 4. Cross-Link Integrity

1. Verify docs/knowledge-system.md links to architecture.md and configuration.md
2. Verify docs/issue-intelligence.md links to architecture.md and configuration.md
3. Verify docs/guardrails.md links to architecture.md and configuration.md
4. Verify docs/README.md links to all three new docs
5. Verify architecture.md forward link to knowledge-system.md resolves
6. **Expected:** All cross-links are relative markdown links that resolve to existing files

## Edge Cases

### Empty or Stub Documentation

1. Check that no doc file contains only a title and no substantive content
2. **Expected:** Each doc has ≥ 5 second-level headings (##) with content under each

## Failure Signals

- Any doc file missing or empty
- "Coming soon" placeholder still present in docs/README.md
- Cross-links pointing to non-existent files
- Documentation describes features that don't exist in source code
- Documentation omits major components visible in source code

## Requirements Proved By This UAT

- R010 — Knowledge system documentation: docs/knowledge-system.md accurately describes 5-corpus retrieval pipeline, embedding strategy, hybrid search, two-stage RRF, and background systems

## Not Proven By This UAT

- R007 — README with contributor onboarding (S05 scope)
- R012 — Contributing guide (S05 scope)
- R013 — CHANGELOG through v0.25 (S05 scope)
- Runtime accuracy of documentation — no live system verification performed
- Long-term doc-code synchronization — no automated mechanism exists

## Notes for Tester

- Focus on whether the documentation accurately reflects current source code behavior
- The knowledge system is the most complex subsystem; pay particular attention to whether the retrieval pipeline steps match the actual code flow in src/knowledge/retrieval.ts and src/knowledge/cross-corpus-rrf.ts
- Guardrails documentation should be checked against src/lib/guardrail/pipeline.ts for pipeline accuracy
- Issue intelligence documentation should be checked against src/triage/ for component accuracy
