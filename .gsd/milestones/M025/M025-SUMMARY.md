---
id: M025
milestone: M025
verification_result: passed
completed_at: migrated
---

# M025: Wiki Content Updates

**Migrated from v0.25 milestone summary**

## What Happened

## v0.25 Wiki Content Updates (Shipped: 2026-03-07)

**Scope:** 7 phases (120-126), 19 plans
**Timeline:** 2026-03-02 → 2026-03-07 (5 days)
**Files modified:** 148 (23,720 insertions, 257 deletions)

**Key accomplishments:**
- Wiki embeddings migrated to voyage-context-3 with per-corpus model routing in retrieval pipeline
- Page popularity scoring combining MediaWiki inbound links, retrieval citation frequency, and edit recency
- Enhanced staleness detection grounded in actual PR/commit diffs from last 90 days with domain stopwords and heading weighting
- LLM-generated section-level wiki update suggestions with PR/commit citations and grounding verification
- Wiki update suggestions published as tracking issue comments on xbmc/wiki with rate-limit safety
- Voice-preserving generation with spread sampling, style caching, template/heading validation, and formatting freedom
- Unified anti-hallucination guardrail pipeline across all output surfaces with context-grounded classification, LLM fallback, and audit logging

---
