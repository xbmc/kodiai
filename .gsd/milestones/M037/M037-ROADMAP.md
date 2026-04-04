# M037: Embedding-Based Suggestion Clustering & Reinforcement Learning

## Vision
Use cached positive and negative feedback clusters to make review-time finding suppression and confidence adjustments thematic, conservative, and non-blocking.

## Slice Overview
| ID | Slice | Risk | Depends | Done | After this |
|----|-------|------|---------|------|------------|
| S01 | Cluster Model Build and Cache | medium | — | ⬜ | After this, Kodiai can build and cache a per-repo positive/negative cluster model from learning memories instead of recomputing it on every review. |
| S02 | Thematic Finding Scoring and Review Integration | high | S01 | ⬜ | After this, review-time findings can be scored against cached cluster models so persistently-negative themes are suppressed and persistently-positive themes boost confidence, subject to safety guards. |
| S03 | Refresh, Staleness Handling, and Fail-Open Verification | medium | S01, S02 | ⬜ | After this, cluster models refresh in the background, stale/unavailable models degrade cleanly, and the verifier proves cached reuse plus non-blocking behavior. |
