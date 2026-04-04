---
depends_on: [M035]
---

# M036: Auto Rule Generation from Feedback

**Gathered:** 2026-04-04
**Status:** Queued — pending auto-mode execution
**Depends on:** M035

## Project Description

Kodiai accumulates `learning_memories` records per review — each finding stored with its embedding, outcome (`accepted | suppressed | thumbs_up | thumbs_down`), severity, category, file path, and language. Currently these memories feed two subsystems: embedding-based retrieval for similar past patterns, and fingerprint-based feedback suppression (exact-match fingerprints meeting threshold → suppressed). There is no learning loop that promotes recurring patterns into durable rules.

## Why This Milestone

kodus-ai (kodustech/kodus-ai) has a first-class rule domain model where rules can have `origin: GENERATED` and automatically progress from `PENDING → ACTIVE → RETIRED`. It clusters suggestion embeddings using k-means to identify thematic patterns — not just exact-fingerprint recurrences — and uses both positive (implemented, thumbsUp) and negative (thumbsDown, suppressed) signals. Kodiai currently only uses negative signals, and only at the exact-fingerprint level. This milestone closes that gap: cluster learning memories by embedding similarity, surface high-positive-signal clusters as rule proposals, and auto-activate rules that cross a confidence threshold.

## User-Visible Outcome

### When this milestone is complete:
- Recurring accepted/implemented patterns in a repo's learning memories automatically become proposed rules
- Auto-activated rules inject into the review prompt's custom instructions section, influencing future reviews
- Rules above a high-confidence threshold auto-activate; below threshold they surface as pending proposals visible in logs/Slack
- Rules can be RETIRED when their signal degrades or they become stale

### Entry point / environment
- Entry point: background sweep (similar to wiki-update-generator sweep pattern)
- Environment: production
- Live dependencies: PostgreSQL (learning_memories, new rules table), Voyage AI (embeddings already present)

## Completion Class

- Contract complete means: clustering pipeline produces rule proposals from learning memories; DB schema for rules table exists; rule injection into review prompt is wired
- Integration complete means: end-to-end sweep runs on a repo with sufficient history and produces at least one activated rule; that rule appears in the next review's system prompt
- Operational complete means: rule lifecycle (PENDING → ACTIVE → RETIRED) transitions correctly under production load; Slack notification on auto-activation

## Final Integrated Acceptance

- Given a repo with ≥30 learning memories where several share high embedding cosine similarity, the sweep produces a PENDING rule candidate with title and description extracted from the cluster's representative sample
- A rule that crosses the auto-activation threshold (`accepted+thumbsUp signal ≥ threshold`) transitions to ACTIVE without manual input
- An ACTIVE rule's text appears in the `## Custom instructions` section of the next PR's review prompt for that repo
- RETIRED transition triggers when the rule's signal drops below a floor (e.g., 3+ new thumbsDowns on findings matching the rule)

## Risks and Unknowns

- **Cluster quality with sparse data** — k-means requires ≥50 samples to be meaningful; repos with fewer learning memories need a fallback (no-op or global signal aggregation). Solution: require a minimum cluster member count before proposing a rule (e.g., ≥5 members).
- **Rule text quality** — extracting a natural-language rule from a cluster centroid is LLM-dependent. The representative sample approach (highest-similarity member to centroid) is probably better than generating from scratch.
- **Prompt injection via generated rules** — auto-generated rule text that reaches the review prompt is an injection surface. Rule text must be sanitized and capped in length before injection.
- **Signal decay** — a rule that was valid 6 months ago may not be valid now. Need a recency window on the signal computation.

## Existing Codebase / Prior Art

- `src/knowledge/memory-store.ts` — `LearningMemoryStore`, `writeMemory`, pgvector HNSW index on learning_memories embeddings; outcome column already has `thumbs_up | thumbs_down | accepted | suppressed`
- `src/knowledge/cluster-matcher.ts` — dual-signal cosine+Jaccard cluster matching with recency weighting; established pattern for pgvector-backed clustering
- `src/knowledge/cluster-pipeline.ts` — `cosineSimilarity` helper; k-means or HNSW-based cluster pipeline
- `src/feedback/aggregator.ts` — `aggregateSuppressiblePatterns` with threshold filtering; model for signal aggregation
- `src/feedback/types.ts` — `FeedbackPattern` type with thumbsDown/thumbsUp counts; extend for rule proposal
- `src/enforcement/severity-floors.ts` — `BUILTIN_SEVERITY_PATTERNS` + `userPatterns` merge; auto-generated rules integrate here
- `src/execution/review-prompt.ts` — `customInstructions` field (`config.review.prompt`) injected at line 2181; this is the injection point for active rules
- `src/knowledge/wiki-update-generator.ts` — background sweep pattern; reuse for the rule-generation sweep

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions.

## Relevant Requirements

- This is new scope — introduces a durable learning loop not previously captured in requirements.

## Scope

### In Scope

- New DB migration: `generated_rules` table (id, repo, title, rule_text, status: pending/active/retired, signal_score, member_count, cluster_centroid, created_at, activated_at, retired_at, origin: 'generated')
- `createRuleGenerationSweep` — clusters learning memories per repo using ANN on pgvector, groups by cosine similarity ≥ 0.75, filters to clusters with ≥5 accepted/thumbs_up outcomes
- Rule proposal: extract representative sample text, format as rule description via LLM (short, actionable, no prompt injection)
- Auto-activation: if `accepted+thumbsUp signal_score ≥ configurable threshold` (default 0.7), transition to ACTIVE immediately; otherwise remain PENDING
- Rule injection: `getActiveRulesForRepo(repo)` → formatted bullet list → prepended to `customInstructions` in review prompt context
- Rule retirement: signal monitoring — a weekly sweep checks active rules; retires rules where recent thumbsDown rate exceeds threshold or member count has decayed
- Sanitization: rule text is stripped of markdown injection vectors before injection
- Tests for clustering, proposal extraction, auto-activation logic, and prompt injection
- Slack notification on auto-activation event

### Out of Scope / Non-Goals

- Web UI for rule management (no web frontend in kodiai)
- Manual rule authoring interface (separate concern — this milestone is about auto-generation only)
- Cross-repo rule sharing
- Rule versioning / history
- `MEMORY` rule type (kodus-ai distinction between STANDARD and MEMORY rules)
- kodyRules inheritance hierarchy (path-scoped rules can come later)

## Technical Constraints

- Rule text must be sanitized before injection into the LLM prompt (strip HTML, cap at 200 chars per rule, max 10 rules injected at once)
- Sweep must be fail-open: errors do not affect the review pipeline
- Auto-activation threshold must be configurable via env var with a sane default
- Cluster minimum: ≥5 members with positive outcome before any rule is proposed

## Integration Points

- `src/knowledge/store.ts` — add `getActiveRulesForRepo` to KnowledgeStore interface
- `src/handlers/review.ts` — pass active rules into review prompt context
- `src/execution/review-prompt.ts` — inject active rules into custom instructions section
- `src/db/migrations/` — add generated_rules table

## Open Questions

- None — scope is clear.
