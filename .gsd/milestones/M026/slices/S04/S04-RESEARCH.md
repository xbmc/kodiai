# S04: Knowledge System & Feature Docs — Research

**Date:** 2026-03-11

## Summary

This slice writes three documentation files: `docs/knowledge-system.md` (the 5-corpus retrieval pipeline), `docs/issue-intelligence.md` (triage, duplicate detection, troubleshooting retrieval), and `docs/guardrails.md` (the epistemic guardrail system). All source material is in the codebase — no external research needed. The docs/README.md index also needs updating to replace the "Coming soon" placeholder with real links.

The knowledge system is the largest documentation target: 60+ source files across 5 corpora, 2 embedding models, hybrid search (vector + BM25), cross-corpus RRF merging, adaptive thresholds, language-aware reranking, and deduplication. Issue intelligence and guardrails are smaller but well-defined subsystems. All three docs should follow the pattern established by S03 (overview → components → flow → configuration).

## Recommendation

Write all three docs by reading source code directly — the system is thoroughly implemented and the code is self-documenting. Follow the S03 documentation patterns: overview paragraph, component tables, flow descriptions with numbered steps, and configuration references pointing to `configuration.md`. Each doc should be readable standalone but cross-link to `architecture.md` for system context.

**Task split:**
1. `docs/knowledge-system.md` — largest doc, covers all 5 corpora, chunking, embedding, retrieval pipeline, RRF, dedup, adaptive thresholds, background systems (wiki sync, staleness detection, clustering)
2. `docs/issue-intelligence.md` — covers triage (template validation, duplicate detection, threshold learning, troubleshooting retrieval)
3. `docs/guardrails.md` — covers epistemic system (claim classification, context grounding, surface adapters, LLM fallback, audit)
4. Update `docs/README.md` to replace placeholder with links to the three new docs

## Don't Hand-Roll

No external libraries or tools needed — this is pure documentation work reading existing source.

## Existing Code and Patterns

### Knowledge System (docs/knowledge-system.md sources)

- `src/knowledge/index.ts` — barrel exports showing all public API surface (5 stores, retriever, embeddings, dedup, hybrid search, RRF)
- `src/knowledge/types.ts` — canonical type definitions: KnowledgeStore, LearningMemoryStore, EmbeddingProvider, all record types
- `src/knowledge/retrieval.ts` (867 lines) — the unified retrieval pipeline with `createRetriever()`: 9 parallel searches, variant execution, hybrid merge, RRF, language boost, dedup, context assembly
- `src/knowledge/cross-corpus-rrf.ts` — `crossCorpusRRF()`: RRF scoring with recency boost, defines `UnifiedRetrievalChunk` and `SourceType`
- `src/knowledge/multi-query-retrieval.ts` — multi-query variant system: intent/file-path/code-shape queries, `buildRetrievalVariants()`, `mergeVariantResults()`
- `src/knowledge/hybrid-search.ts` — per-corpus RRF merge of vector + BM25 results
- `src/knowledge/dedup.ts` — Jaccard similarity dedup, within-corpus and cross-corpus modes, 0.9 threshold
- `src/knowledge/adaptive-threshold.ts` — gap-based adaptive thresholding with percentile fallback
- `src/knowledge/retrieval-rerank.ts` — language-aware reranking with proportional weights and related-language affinity
- `src/knowledge/retrieval-recency.ts` — exponential decay recency weighting (90-day half-life, critical/major floor)
- `src/knowledge/retrieval-snippets.ts` — snippet anchoring: maps findings to workspace file locations
- `src/knowledge/isolation.ts` — repo-scoped retrieval with optional owner-level shared pool

**5 Corpora:**

| Corpus | Store | Chunker | Embedding Model | Key Files |
|--------|-------|---------|-----------------|-----------|
| Learning memories | `memory-store.ts` | N/A (finding text) | voyage-code-3 | `memory-store.ts` |
| Review comments | `review-comment-store.ts` | `review-comment-chunker.ts` (thread-based) | voyage-code-3 | `review-comment-backfill.ts`, `review-comment-catchup.ts`, `review-comment-retrieval.ts` |
| Wiki pages | `wiki-store.ts` | `wiki-chunker.ts` (section-based) | voyage-context-3 | `wiki-backfill.ts`, `wiki-sync.ts`, `wiki-retrieval.ts` |
| Code snippets | `code-snippet-store.ts` | `code-snippet-chunker.ts` (diff hunk) | voyage-code-3 | `code-snippet-retrieval.ts` |
| Issues | `issue-store.ts` | `issue-comment-chunker.ts` | voyage-code-3 | `issue-backfill.ts`, `issue-retrieval.ts`, `issue-linker.ts` |

**Background systems:**
- `wiki-sync.ts` — MediaWiki RecentChanges polling on interval (24h default, 60s startup delay)
- `wiki-staleness-detector.ts` — two-tier (heuristic + LLM) staleness detection for wiki pages impacted by code changes
- `wiki-popularity-scorer.ts` — citation-based popularity scoring for wiki pages
- `wiki-voice-analyzer.ts` / `wiki-voice-validator.ts` — style consistency for wiki updates
- `wiki-publisher.ts` — publishes wiki update suggestions
- `cluster-pipeline.ts` — UMAP + HDBSCAN clustering of review comments for pattern discovery
- `cluster-scheduler.ts` — scheduled re-clustering

**Embedding details:**
- `embeddings.ts` — Voyage AI provider with fail-open semantics, no-op provider when key missing
- Two models: `voyage-code-3` (1024d, code/review/issue/snippet), `voyage-context-3` (wiki, contextualized embedding API)
- `contextualizedEmbedChunks()` — batch page-level embedding for wiki
- All embedding is stored in PostgreSQL with pgvector `vector(1024)` columns

### Issue Intelligence (docs/issue-intelligence.md sources)

- `src/triage/triage-agent.ts` — template validation: reads `.github/ISSUE_TEMPLATE/*.md`, best-fit heading matching, guidance comment generation, label recommendation
- `src/triage/template-parser.ts` — parses issue templates (frontmatter + sections), diffs against template
- `src/triage/duplicate-detector.ts` — vector similarity search against issue corpus, configurable threshold, fail-open
- `src/triage/triage-comment.ts` — formats triage comment with duplicate candidate table (closed first, similarity%), HTML marker for idempotency
- `src/triage/threshold-learner.ts` — Bayesian (Beta distribution) threshold adaptation from issue close/reopen outcomes
- `src/triage/types.ts` — TemplateDefinition, TriageValidationResult, section types
- `src/handlers/issue-opened.ts` — handler with 4-layer idempotency (delivery dedup, DB claim, marker scan, cooldown)
- `src/handlers/issue-closed.ts` — feedback capture on issue close
- `src/knowledge/troubleshooting-retrieval.ts` — hybrid search for closed issues + wiki fallback, thread assembly with budget allocation
- `src/knowledge/thread-assembler.ts` — budget-weighted thread assembly (body + tail + semantic comments)
- `src/execution/issue-code-context.ts` — code context extraction for issue Q&A

### Guardrails (docs/guardrails.md sources)

- `src/lib/guardrail/pipeline.ts` — `runGuardrailPipeline()`: extract claims → classify → filter external-knowledge → reconstruct, with fail-open wrapper
- `src/lib/guardrail/context-classifier.ts` — `classifyClaimAgainstContext()`: allowlist → external patterns (CVE, version, API behavior, release dates, performance, compatibility) → diff delegation → word overlap → fail-open default
- `src/lib/guardrail/types.ts` — SurfaceAdapter interface, GroundingContext, StrictnessLevel (strict/standard/lenient), GuardrailConfig, AuditRecord
- `src/lib/guardrail/allowlist.ts` — general programming knowledge (null safety, injection, concurrency, resources, bounds, error handling, typing, code smells) — always passes
- `src/lib/guardrail/llm-classifier.ts` — Haiku fallback for ambiguous claims, batches up to 10 per call
- `src/lib/guardrail/audit-store.ts` — PostgreSQL audit logging
- `src/lib/claim-classifier.ts` — original heuristic classifier (ClaimLabel: diff-grounded/external-knowledge/inferential), used by context-classifier for diff delegation
- **6 surface adapters** (in `src/lib/guardrail/adapters/`): review, mention, slack, triage, troubleshoot, wiki — each implements extractClaims, buildGroundingContext, reconstructOutput

**Key design principles (from DECISIONS.md):**
- Three-tier knowledge classification: diff-visible, system-enrichment, external-knowledge
- External knowledge silently omitted — no hedging, no acknowledgment
- Universal citation rule: diff-visible cites file:line, enrichment cites footnote URL
- General programming knowledge explicitly allowed as exception
- Strictness thresholds: strict=0.3, standard=0.5, lenient=0.7 word overlap
- Pipeline is fail-open: errors return output unchanged
- LLM classifier batches ambiguous claims (confidence < 0.6)

## Constraints

- All docs must be accurate to current source code — no aspirational features
- Forward link from `architecture.md` to `knowledge-system.md` must resolve (file must be created)
- `docs/README.md` "Coming soon" placeholder must be replaced with real links
- Documentation audience is open-source contributors (not internal ops)
- Follow S03 established patterns: overview → components → flows → configuration references

## Common Pitfalls

- **Documenting deprecated patterns** — the system has evolved through many phases; document current state only (e.g., unified retrieval pipeline, not legacy separate-corpus queries)
- **Overloading knowledge-system.md** — the doc needs to cover a lot; use clear sections and don't duplicate what's in architecture.md (which already has a knowledge system overview paragraph)
- **Missing cross-links** — ensure all three docs link to architecture.md for system context and configuration.md for config details
- **Confusing the two RRF stages** — there are TWO levels of RRF: per-corpus hybrid merge (vector+BM25) and cross-corpus merge (across all 5 corpora). Document both clearly.

## Open Risks

- **Documentation accuracy drift** — these docs will be accurate at time of writing but may drift as the knowledge system evolves. This is inherent to any doc-from-source approach and is noted in S03 summary.
- **Scope creep on knowledge-system.md** — 60+ source files to cover. Need to stay at architectural level and not document every helper function. Focus on the pipeline flow, corpus descriptions, and configuration knobs.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| N/A | N/A | Documentation-only slice — no external technology skills needed |

## Sources

- All source material is in the codebase under `src/knowledge/`, `src/triage/`, `src/lib/guardrail/`, `src/handlers/issue-opened.ts`
- Pattern reference: `docs/architecture.md` and `docs/configuration.md` (established by S03)
- Forward intelligence from S03 summary: docs/README.md has "Coming soon" placeholder, architecture.md has forward link to knowledge-system.md
