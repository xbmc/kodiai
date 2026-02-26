# Phase 100: Review Pattern Clustering - Context

**Gathered:** 2026-02-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Kodiai discovers emergent review themes from review comment embeddings using HDBSCAN clustering and surfaces recurring patterns as context in PR reviews. This phase covers: dimensionality reduction (UMAP), clustering (HDBSCAN), auto-labeling, persistence, scheduled refresh, and pattern injection into reviews. It does NOT cover trend detection over time (ECLST-01) or cross-repo comparison (ECLST-02).

</domain>

<decisions>
## Implementation Decisions

### Pattern injection in reviews
- Patterns appear as inline comments on relevant code lines, not as a summary section
- Format: subtle footnote at the end of a review comment, not a standalone tagged comment
- Proactive surfacing: patterns appear even when the reviewer didn't flag the area, acting as a second pair of eyes
- Max 3 pattern footnotes per PR review to avoid noise — only the most relevant clusters shown

### Cluster labeling
- Two-layer labels: short technical slug for storage/filtering (e.g., `null-check-missing`) + natural language description for display (e.g., "Missing null checks on API response fields")
- LLM sees 3-5 representative samples from the cluster to generate labels
- Labels regenerated only when cluster membership changes significantly (>20% gain/loss), not every refresh cycle
- Labels go live automatically but can be manually overridden/pinned via configuration

### Refresh lifecycle
- Rolling 6-month window for clustering input — only embeddings from last 6 months processed
- Weekly scheduled job (cron) plus on-demand triggering via CLI/API for testing or after bulk imports
- Incremental merge strategy: new embeddings merged into existing clusters rather than full atomic re-cluster each run

### Surface threshold
- Matching uses both signals: embedding cosine similarity to PR diff + file path overlap with clustered comments
- Moderate confidence threshold — some false positives acceptable to catch most real patterns
- Recency weighting within the 60-day surfacing window: recent comments weigh more than older ones

### Claude's Discretion
- HDBSCAN min_cluster_size parameter tuning
- Cluster retirement behavior when dropping below 3 members in 60-day window
- UMAP hyperparameters (n_neighbors, min_dist, n_components)
- Exact similarity/confidence threshold values
- Incremental merge algorithm details

</decisions>

<specifics>
## Specific Ideas

- Footnote style should blend with existing review comment format — not jarring or promotional
- Pattern injection should feel like institutional memory, not a bot warning
- On-demand trigger useful for validating clustering results during development

</specifics>

<deferred>
## Deferred Ideas

- ECLST-01: Trend detection showing cluster growth/shrinkage over time — future enhancement
- ECLST-02: Cross-repo pattern comparison — future enhancement

</deferred>

---

*Phase: 100-review-pattern-clustering*
*Context gathered: 2026-02-25*
