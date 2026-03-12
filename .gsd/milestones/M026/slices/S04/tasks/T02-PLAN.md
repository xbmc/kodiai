---
estimated_steps: 4
estimated_files: 3
---

# T02: Write docs/issue-intelligence.md and docs/guardrails.md

**Slice:** S04 — Knowledge System & Feature Docs
**Milestone:** M026

## Description

Write documentation for the issue intelligence subsystem (triage, duplicate detection, threshold learning, troubleshooting retrieval) and the epistemic guardrail system (claim classification, context grounding, surface adapters, LLM fallback, audit). These are smaller, well-defined subsystems that fit naturally in one task.

## Steps

1. Read issue intelligence source files: `src/triage/triage-agent.ts`, `src/triage/template-parser.ts`, `src/triage/duplicate-detector.ts`, `src/triage/triage-comment.ts`, `src/triage/threshold-learner.ts`, `src/triage/types.ts`, `src/knowledge/troubleshooting-retrieval.ts`, `src/knowledge/thread-assembler.ts`, `src/handlers/issue-opened.ts` (4-layer idempotency)
2. Write `docs/issue-intelligence.md` following S03 pattern: overview → template validation → duplicate detection (vector similarity, configurable threshold) → threshold learning (Bayesian Beta distribution) → troubleshooting retrieval (hybrid search, thread assembly) → handler idempotency (4 layers) → configuration references. Cross-link architecture.md and configuration.md
3. Read guardrail source files: `src/lib/guardrail/pipeline.ts`, `src/lib/guardrail/context-classifier.ts`, `src/lib/guardrail/types.ts`, `src/lib/guardrail/allowlist.ts`, `src/lib/guardrail/llm-classifier.ts`, `src/lib/guardrail/audit-store.ts`, adapter files in `src/lib/guardrail/adapters/`
4. Write `docs/guardrails.md` following S03 pattern: overview (epistemic principle) → pipeline flow (extract → classify → filter → reconstruct) → classification tiers (diff-visible, system-enrichment, external-knowledge) → context classifier (allowlist → patterns → diff delegation → word overlap) → strictness levels (strict/standard/lenient thresholds) → LLM fallback (Haiku batching) → 6 surface adapters table → audit logging → fail-open design → configuration references. Cross-link architecture.md and configuration.md

## Must-Haves

- [ ] Issue intelligence doc covers template validation, duplicate detection, threshold learning, troubleshooting retrieval
- [ ] Guardrails doc covers pipeline flow, three-tier classification, strictness levels, 6 surface adapters
- [ ] Both docs cross-link to architecture.md and configuration.md
- [ ] Content matches DECISIONS.md entries on guardrail design (silent omission, citation rules, strictness thresholds)

## Verification

- `test -f docs/issue-intelligence.md` — file exists
- `test -f docs/guardrails.md` — file exists
- `grep -c '##' docs/issue-intelligence.md` ≥ 5 — substantive structure
- `grep -c '##' docs/guardrails.md` ≥ 5 — substantive structure
- `grep -l 'architecture.md' docs/issue-intelligence.md` — cross-link present
- `grep -l 'architecture.md' docs/guardrails.md` — cross-link present

## Observability Impact

- Signals added/changed: None
- How a future agent inspects this: Read docs/issue-intelligence.md and docs/guardrails.md
- Failure state exposed: None

## Inputs

- `docs/architecture.md` — system context cross-link target
- `docs/configuration.md` — config reference target for triage.* and guardrail settings
- S04-RESEARCH.md source file listings and key design decisions

## Expected Output

- `docs/issue-intelligence.md` — triage, duplicate detection, threshold learning, troubleshooting retrieval documentation
- `docs/guardrails.md` — epistemic guardrail pipeline documentation with all 6 surface adapters
