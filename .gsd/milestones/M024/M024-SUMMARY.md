---
id: M024
milestone: M024
verification_result: passed
completed_at: migrated
---

# M024: Hallucination Prevention & Fact Verification

**Migrated from v0.24 milestone summary**

## What Happened

## v0.24 Hallucination Prevention & Fact Verification (Shipped: 2026-03-03)

**Scope:** 5 phases (115-119), 5 plans
**Motivation:** [PR #27932](https://github.com/xbmc/xbmc/pull/27932) — bot fabricated libxkbcommon version numbers as a [CRITICAL] finding

**Key accomplishments:**
- Epistemic boundary system with 3-tier knowledge classification (diff-visible, context-visible, external) in review prompts
- Cross-surface guardrails applied consistently to PR reviews, @mention responses, and Slack assistant
- Heuristic claim classifier labeling each finding's claims as diff-grounded, external-knowledge, or inferential
- Severity demotion capping external-knowledge findings at medium severity (CRITICAL/MAJOR -> medium)
- Output filter rewriting findings to remove external claims or suppressing entirely when no diff-grounded core remains

---
