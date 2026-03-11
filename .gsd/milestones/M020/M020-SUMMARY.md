---
id: M020
milestone: M020
verification_result: passed
completed_at: migrated
---

# M020: Multi-Model & Active Intelligence

**Migrated from v0.20 milestone summary**

## What Happened

## v0.20 Multi-Model & Active Intelligence (Shipped: 2026-02-26)

**Scope:** 6 phases (97-102), 17 plans
**Timeline:** 2026-02-25 → 2026-02-26
**Source:** [Issue #66](https://github.com/xbmc/kodiai/issues/66)
**Files modified:** 57 (7,427 insertions, 12 deletions)

**Key accomplishments:**
- Multi-LLM task routing via Vercel AI SDK with task-type-based model selection, per-repo `.kodiai.yml` overrides, and automatic provider fallback
- Per-invocation cost tracking logging model, provider, token counts, and estimated USD to Postgres for every non-agentic LLM call
- Contributor profiles with GitHub/Slack identity linking via slash commands, expertise inference with exponential decay, and 4-tier adaptive review depth
- Wiki staleness detection with two-tier evaluation (cheap heuristic pass then LLM), file-path evidence, configurable thresholds, and scheduled Slack reports
- HDBSCAN-based review pattern clustering with UMAP dimensionality reduction, auto-generated theme labels, and dual-signal pattern matching injected as footnotes in PR reviews
- Gap closure: executor dependencies wired (costTracker + taskRouter), Phase 100 verification completed, all 20 v0.20 requirements satisfied

---
