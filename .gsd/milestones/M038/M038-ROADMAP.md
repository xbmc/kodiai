# M038: AST Call-Graph Impact Analysis

## Vision
Consume M040's graph substrate and M041's canonical current-code corpus at review time so Kodiai can show bounded, structurally-grounded impact evidence and more truthful breaking-change output for C++ and Python PRs.

## Slice Overview
| ID | Slice | Risk | Depends | Done | After this |
|----|-------|------|---------|------|------------|
| S01 | Graph/Corpus Consumer Adapters and Orchestration | medium | — | ✅ | After this, M038 can ask M040 and M041 for structural and semantic context through explicit adapters and produce a bounded internal structural-impact payload for a C++ or Python change. |
| S02 | Structural Impact Rendering and Review Flow Integration | high | S01 | ✅ | After this, a large C++ or Python review shows a bounded Structural Impact section in Review Details and uses structural evidence to strengthen breaking-change output. |
| S03 | Timeout, Cache Reuse, and Fail-Open Verification | medium | S01, S02 | ✅ | After this, repeated reviews reuse cached structural-impact results, substrate failures degrade cleanly, and the verifier proves bounded fail-open structural output for both large-review and timeout paths. |
