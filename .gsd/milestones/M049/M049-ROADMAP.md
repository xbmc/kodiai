# M049: Evidence-Backed Clean PR Approvals

## Vision
Replace marker-only clean approval reviews with one short evidence-backed GitHub review body across all approval lanes, while preserving issue publication behavior for findings and keeping clean approvals free of separate PR comments.

## Slice Overview
| ID | Slice | Risk | Depends | Done | After this |
|----|-------|------|---------|------|------------|
| S01 | S01 | medium | — | ✅ | A clean approval on explicit `@kodiai review` and automatic review both show a short GitHub review body with `Decision: APPROVE`, `Issues: none`, factual evidence lines, and the existing review-output marker. |
| S02 | S02 | low | — | ⬜ | Operators inspecting a clean approval on GitHub can see why it was approved without a separate issue comment, and audit tooling can correlate the same published body to the delivery cleanly. |
