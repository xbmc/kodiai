# M044: Audit Recent XBMC Review Correctness

## Vision
Ship a real operator audit surface for the recent `xbmc/xbmc` Kodiai review stream across both automatic PR review and explicit `@kodiai review` lanes. The milestone should let operators select a deterministic recent sample, classify each PR with evidence-backed verdicts instead of guessing from approvals alone, repair the first real production defect or missing-truth gap the audit exposes, and finish with one rerunnable verifier/runbook entrypoint that can be used later without manual PR archaeology.

## Slice Overview
| ID | Slice | Risk | Depends | Done | After this |
|----|-------|------|---------|------|------------|
| S01 | S01 | high — this slice must prove the core audit is feasible against real `xbmc/xbmc` history without misclassifying legitimate clean approvals or collapsing the two review lanes into one heuristic. | — | ✅ | Run a real recent-review audit against `xbmc/xbmc` and get a deterministic lane-aware sample plus per-PR provisional verdicts backed by GitHub-visible markers and currently available internal evidence, so operators can stop guessing from approval-only output. |
| S02 | S02 | medium-high — the audit may expose a real publication defect, a missing durable evidence seam, or a classification/correlation bug, and the slice must fix the smallest true root cause without regressing known clean-review behavior. | — | ✅ | Rerun the audit after the first real defect or evidence gap is fixed and watch previously ambiguous or wrong cases resolve into truthful outcomes without turning valid clean approvals into false failures. |
| S03 | S03 | medium — this slice must turn the proven audit into a stable operator surface with truthful preflight and evidence reporting, not just leave behind an internal script or one-off notes. | — | ✅ | Operators run one documented command such as `bun run verify:m044 -- --repo xbmc/xbmc --limit 12 [--json]` and receive human-readable and machine-readable verdicts, preflight/access status, and per-PR evidence they can rerun later without manual archaeology. |
