---
id: M008
milestone: M008
verification_result: passed
completed_at: migrated
---

# M008: Conversational Intelligence

**Migrated from v0.8 milestone summary**

## What Happened

## v0.8 Conversational Intelligence (Shipped: 2026-02-14)

**Scope:** 9 phases (42-50), 19 plans
**Timeline:** 2026-02-14
**Tests:** 736 passing
**Git range:** feat(42-01) → docs(phase-50)

**Key accomplishments:**
- PR intent parser extracting bracket tags, conventional commit prefixes, and breaking change signals from PR metadata
- Deterministic auto-profile selection adapting review depth to PR size (strict ≤100, balanced 101-500, minimal >500 lines)
- Multi-factor finding prioritization with composite scoring (severity + file risk + category + recurrence) and configurable weights
- Author experience adaptation classifying contributors into tiers with tone-adjusted review feedback and SQLite caching
- Conversational review enabling @kodiai follow-up responses on review findings with thread context, rate limiting, and context budgets
- Defense-in-depth mention sanitization across all 12 outbound publish paths preventing self-trigger loops

---
