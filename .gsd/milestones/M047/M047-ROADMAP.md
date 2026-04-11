# M047: Contributor Experience Redesign and Calibration Rollout

## Vision
Turn the M045 contributor-experience contract and M046 replace verdict into shipped behavior by making persisted contributor state trustworthy, rolling that shared resolution through GitHub review, Slack, retrieval, and profile-plumbing surfaces, and proving cross-surface coherence end to end.

## Slice Overview
| ID | Slice | Risk | Depends | Done | After this |
|----|-------|------|---------|------|------------|
| S01 | S01 | high — linked-but-unscored and legacy profile rows currently masquerade as trustworthy `profile-backed` newcomer guidance inside the live review entrypoint. | — | ⬜ | A review-path scenario using real stored profile states shows linked-but-unscored and legacy profiles fail open instead of surfacing `profile-backed` newcomer guidance, while a calibrated retained contributor drives the shipped prompt and Review Details coherently on the GitHub review surface. |
| S02 | Contract-first Slack, retrieval, and profile continuity rollout | medium — downstream raw-tier consumers remain on slack/profile surfaces and route-level continuity can drift even if the review resolver is fixed. | S01 | ⬜ | The same contributor state produces consistent `/kodiai profile`, link/opt continuity messaging where applicable, and review retrieval hints with no raw-tier leakage or false 'active profile-backed' claims. |
| S03 | Integrated M047 coherence verifier | medium — the milestone can look complete while still hiding runtime source-resolution drift unless the assembled system is proven through one operator-facing proof surface. | S01, S02 | ⬜ | `bun run verify:m047 -- --json` passes and shows linked-unscored, calibrated-retained, stale/degraded, opt-out, and coarse-fallback scenarios resolving consistently across review, Review Details, retrieval hints, Slack/profile output, and contributor-model plumbing while preserving nested M045/M046 evidence. |
