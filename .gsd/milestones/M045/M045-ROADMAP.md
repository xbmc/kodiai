# M045: Contributor Experience Product Contract and Architecture

## Vision
Turn contributor experience from mixed tier strings and surface-specific heuristics into one explicit product contract that governs GitHub review behavior, Slack profile semantics, retrieval shaping, and opt-out handling through a single coherent architecture.

## Slice Overview
| ID | Slice | Risk | Depends | Done | After this |
|----|-------|------|---------|------|------------|
| S01 | S01 | high — the milestone fails if taxonomy refactoring happens before kodiai explicitly decides what contributor experience is allowed to change on the real review surface. | — | ✅ | Given profile-backed, coarse fallback, unknown, and opted-out/degraded author inputs through the review path, GitHub review prompt instructions and Review Details reflect one explicit contributor-experience contract with truthful, non-contradictory behavior. |
| S02 | S02 | medium-high — current copy promises generic reviews on opt-out, contributor resolution is coupled to `knowledgestore` availability, and slack/retrieval surfaces can drift even if github review is correct. | — | ✅ | A contributor can inspect `/kodiai profile`, opt in or out, and trigger review-time resolution without seeing conflicting tier semantics; retrieval hints either follow the contract-approved signal or are absent by design. |
| S03 | S03 | medium — without one cross-surface verification surface, the milestone can appear complete while contract drift survives in lesser-used paths. | — | ✅ | An operator runs one M045 verifier command and gets named pass/fail results for review prompt/details behavior, Slack profile output, retrieval shaping or exclusion, and opt-out truthfulness, with both human-readable and JSON output. |
