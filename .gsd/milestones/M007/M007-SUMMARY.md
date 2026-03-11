---
id: M007
milestone: M007
verification_result: passed
completed_at: migrated
---

# M007: Intelligent Review Content

**Migrated from v0.7 milestone summary**

## What Happened

## v0.7 Intelligent Review Content (Shipped: 2026-02-14)

**Scope:** 3 phases (39-41), 11 plans
**Timeline:** 2026-02-14
**Tests:** 616 passing

**Key accomplishments:**
- Language-aware enforcement with 10-pattern severity floor catalog (auto-suppress tooling noise, elevate C++ null deref/Go unchecked errors)
- Risk-weighted file prioritization for large PRs with 5-dimension scoring and tiered analysis (top 30 full, next 20 abbreviated)
- Feedback-driven auto-suppression after 3+ thumbs-down from 3+ users across 2+ PRs with safety floors for CRITICAL/MAJOR

---
