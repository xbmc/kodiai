---
id: T02
parent: S04
milestone: M026
provides:
  - docs/issue-intelligence.md — triage, duplicate detection, threshold learning, troubleshooting retrieval documentation
  - docs/guardrails.md — epistemic guardrail pipeline documentation with all 6 surface adapters
key_files:
  - docs/issue-intelligence.md
  - docs/guardrails.md
key_decisions:
  - none
patterns_established:
  - Issue intelligence doc follows same S03 pattern: overview → component table → subsystem details → configuration reference
  - Guardrails doc follows pipeline-oriented structure: design principle → 4-stage pipeline → classification tiers → adapters table → audit → fail-open
observability_surfaces:
  - none
duration: 12min
verification_result: passed
completed_at: 2026-03-11
blocker_discovered: false
---

# T02: Write docs/issue-intelligence.md and docs/guardrails.md

**Wrote comprehensive documentation for issue triage (template validation, duplicate detection, Bayesian threshold learning, troubleshooting retrieval, 4-layer idempotency) and epistemic guardrails (4-stage pipeline, 3-tier classification, 6 surface adapters, LLM fallback, audit logging)**

## What Happened

Read 20+ source files across `src/triage/`, `src/handlers/`, `src/knowledge/`, and `src/lib/guardrail/` to understand both subsystems, then wrote two documentation files:

**docs/issue-intelligence.md** (24 sections):
- Component summary table (8 components with file paths)
- Template validation: parsing, best-fit matching, diff against template, section statuses, guidance comments
- Duplicate detection: pipeline, similarity threshold, comment format, fail-open design
- Threshold learning: Bayesian Beta distribution, confusion matrix classification, posterior computation, threshold derivation formula, effective threshold resolution chain, storage
- Troubleshooting retrieval: 7-step pipeline, thread assembly (body truncation, budget distribution, tail vs semantic comments), keyword extraction for wiki fallback
- Handler idempotency: 4-layer table (delivery ID dedup, atomic DB claim, comment marker scan, per-issue cooldown), full handler flow
- Configuration reference table linking to configuration.md

**docs/guardrails.md** (16 sections):
- Design principle (epistemic grounding, silent omission over hedging)
- 4-stage pipeline flow (extract → classify → filter → reconstruct)
- 3-tier classification (diff-grounded, inferential, external-knowledge) with priority chain
- Strictness levels with overlap thresholds (strict=0.3, standard=0.5, lenient=0.7)
- LLM fallback: batched Haiku calls (10 per batch), JSON response format, fail-open
- General programming knowledge allowlist (8 categories)
- 6 surface adapters table with grounding sources and min content thresholds
- Adapter interface (SurfaceAdapter, GroundingContext types)
- Audit logging (all fields in guardrail_audit table)
- Multi-level fail-open design (pipeline, LLM batch, LLM global, audit)
- Configuration reference

## Verification

All task verification checks passed:
- `test -f docs/issue-intelligence.md` — PASS
- `test -f docs/guardrails.md` — PASS
- `grep -c '##' docs/issue-intelligence.md` = 24 (≥ 5) — PASS
- `grep -c '##' docs/guardrails.md` = 16 (≥ 5) — PASS
- `grep -l 'architecture.md' docs/issue-intelligence.md` — PASS
- `grep -l 'architecture.md' docs/guardrails.md` — PASS
- `grep -l 'configuration.md' docs/issue-intelligence.md` — PASS
- `grep -l 'configuration.md' docs/guardrails.md` — PASS

Slice-level checks (partial — T02 is second of 3 tasks):
- knowledge-system.md exists — PASS
- issue-intelligence.md exists — PASS
- guardrails.md exists — PASS
- All section count checks — PASS
- README links to new docs — expected FAIL (T03)

## Diagnostics

Read `docs/issue-intelligence.md` and `docs/guardrails.md` to inspect the documentation.

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `docs/issue-intelligence.md` — triage, duplicate detection, threshold learning, troubleshooting retrieval documentation (24 sections)
- `docs/guardrails.md` — epistemic guardrail pipeline documentation with 6 surface adapters (16 sections)
