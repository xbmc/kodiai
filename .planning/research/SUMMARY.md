# Project Research Summary

**Project:** Kodiai v0.22 Issue Intelligence
**Domain:** GitHub App — historical issue ingestion, duplicate detection, PR-issue linking, auto-triage
**Researched:** 2026-02-26
**Confidence:** HIGH

## Executive Summary

v0.22 is a feature-layer build on a solid v0.21 foundation. The core insight from all four research areas is the same: everything needed to deliver Issue Intelligence already exists in the codebase. No new npm packages are required. The issue tables, HNSW vector indexes, tsvector columns, IssueStore CRUD/search primitives, triage agent, MCP tools, webhook router, and scheduler infrastructure are all in place. The work is wiring them together in a dependency-driven sequence: populate the corpus first, then enable detection and linking, then enable automation, then integrate the corpus into retrieval.

The recommended approach is four phases mirroring the feature dependency chain. Historical issue backfill (following `review-comment-backfill.ts` exactly) must come first because duplicate detection, PR-issue linking, and semantic retrieval all require a populated corpus. Duplicate detection and auto-triage on `issues.opened` follow as the core user-facing intelligence features. PR-issue linking is independent of auto-triage and can ship alongside it. Cross-corpus retrieval wiring is an enhancement that delivers value last and can be added without risk to the other three phases.

The key risks are precision and trust: a few false-positive duplicate suggestions erode maintainer confidence faster than any missing feature. Embedding strategy (embed problem summary, not raw full body) and threshold calibration (cosine distance with named constants, empirically tuned) are the two technical decisions that most affect outcome quality. Idempotency in the webhook handler (delivery-ID dedup + advisory lock + cooldown) is the operational risk that must be solved before `issues.opened` auto-triage goes live.

## Key Findings

### Recommended Stack

No new dependencies. Every v0.22 capability is served by the existing stack: `@octokit/rest` for paginated GitHub API calls, `voyageai` (`voyage-code-3`, 1024d) for embeddings, PostgreSQL pgvector (`<=>` operator, HNSW indexed) for vector similarity, `tsvector` + `ts_rank()` for BM25 full-text, and the custom `setInterval` + startup-delay pattern for scheduled jobs. See [STACK.md](STACK.md) for the full integration point mapping.

**Core technologies:**
- `@octokit/rest ^22.0.1` with `paginate.iterator()`: paginated issue/comment ingestion — memory-efficient streaming, already used for review comment backfill
- `voyageai` `voyage-code-3` (1024d): embedding generation — same model/dimensions as all other corpora, no model change needed
- PostgreSQL pgvector `<=>` operator: vector similarity for duplicate detection — HNSW indexed, threshold-configurable via `IssueStore.findSimilar()`
- `setInterval` + startup delay pattern: nightly sync scheduler — matches wiki-sync and cluster-scheduler patterns, no Redis required
- `createEventRouter` key dispatch: `issues.opened` webhook handler — register like any other event, already supports the dispatch key

Two schema migrations are needed: `015-issue-sync-state.sql` (cursor-based resume for backfill/sync, mirrors `review_comment_sync_state`) and `016-pr-issue-links.sql` (linking table with `link_type`, `confidence`, `distance` columns). No changes to existing `issues` or `issue_comments` tables — the v0.21 schema already has all needed columns.

### Expected Features

**Must have (table stakes):**
- Historical issue backfill with embeddings — no duplicate detection without a populated corpus; prerequisite for everything else
- Nightly incremental sync — corpus drifts without it; GitHub's `since` parameter handles updates cheaply
- High-confidence duplicate detection — the primary intelligence feature; cosine distance < 0.25 with ranked candidates
- Duplicate detection comment — users expect to see which issue they may be duplicating, with open/closed state context
- Auto-triage on `issues.opened` — natural next step from mention-triggered triage; config-gated default off
- Config gate for auto-triage (`triage.autoTriageOnOpen: false`) — repos must explicitly opt in; default-on would surprise maintainers

**Should have (differentiators):**
- PR-issue linking via reference parsing — deterministic regex for `fixes/closes/resolves #N`, verified against `is_pull_request` field
- Semantic PR-issue linking — embedding-based fallback when no explicit references; LOW confidence signal, suggestion only
- Issue corpus in cross-corpus retrieval — 5th corpus in unified RRF fan-out; weighted lower for PR reviews, higher for issue queries
- Duplicate candidate ranking — top-3 with open/closed state and human-friendly similarity percentage

**Defer to v0.23+:**
- Area classification labels — HIGH complexity; requires per-repo label taxonomy design and two-model confidence approach
- Auto-assign issues to developers — social complexity; accuracy requirements not achievable in v0.22
- Auto-close for template violations — explicit anti-feature; guidance comment + `needs-info` label is the correct action
- Cross-repo duplicate detection — massive complexity; scope all detection to same repo

### Architecture Approach

All seven new components follow existing patterns precisely with no novel architectural invention required. `issue-backfill.ts` mirrors `review-comment-backfill.ts`. `issue-sync.ts` mirrors `wiki-sync.ts`. `issue-duplicate-detector.ts` is a pure function module (no state, no side effects beyond IssueStore reads). `issue-opened.ts` is a clean, focused handler (~200 lines) registered separately on the event router — it must NOT be added to the mention handler, which is already 2000+ lines and assumes a comment trigger exists. See [ARCHITECTURE.md](ARCHITECTURE.md) for full component map, data flows, and anti-patterns.

**Major components:**
1. `src/knowledge/issue-backfill.ts` + `scripts/backfill-issues.ts` — paginated bulk ingestion with embeddings, adaptive rate limiting, cursor-based resume; follows `review-comment-backfill.ts` exactly
2. `src/knowledge/issue-sync.ts` — nightly scheduler with 150s startup delay (staggered after wiki 60s, staleness 90s, cluster 120s), `since`-parameterized incremental fetch
3. `src/knowledge/issue-duplicate-detector.ts` — pure embedding comparison; cosine distance bands 0.12/0.18/0.25 for definite/likely/possible; returns ranked `DuplicateCandidate[]`
4. `src/handlers/issue-opened.ts` — orchestrates triage + duplicate detection in parallel; fetches templates via GitHub Contents API (not workspace clone); idempotent via delivery-ID + advisory lock
5. `src/handlers/pr-issue-linker.ts` — two-signal linking (regex reference parsing + semantic search); stores results in `pr_issue_links`; posts comment only for HIGH confidence
6. `src/knowledge/issue-retrieval.ts` — hybrid search adapter for cross-corpus RRF; follows `review-comment-retrieval.ts` pattern
7. Schema migrations 015 (`issue_sync_state`) and 016 (`pr_issue_links`)

**Modified components (minimal surface area):** Event router registrations in `src/index.ts`; `SourceType` union in `cross-corpus-rrf.ts`; retrieval fan-out in `retrieval.ts`; `triageSchema` in `config.ts`; shutdown manager in `src/index.ts`.

### Critical Pitfalls

Top pitfalls from [PITFALLS.md](PITFALLS.md):

1. **Embedding full issue body produces weak similarity signals** — Extract `title + description section` only; skip logs, system info, stacktraces. The v0.21 template parser already identifies sections — reuse it. Decide before bulk ingestion: re-embedding 5-8K issues costs real money and time. Address in Phase 1.

2. **Cosine distance vs. cosine similarity threshold confusion** — pgvector `<=>` returns distance (0=identical), not similarity (1=identical). Use named constants: `const DUPLICATE_DISTANCE_THRESHOLD = 0.25` with inline comment `// 0.25 distance = 0.75 similarity`. Tune empirically against known xbmc/xbmc duplicate pairs before shipping. Address in Phase 2.

3. **Auto-triage comment spam on webhook redelivery** — GitHub guarantees "at least once" delivery. Three-layer defense required: (1) `X-GitHub-Delivery` dedup at webhook layer, (2) advisory lock in DB (`ON CONFLICT DO NOTHING` returning check), (3) 30-min per-issue cooldown at application layer. Address in Phase 2.

4. **Rate limit exhaustion during backfill blocks production webhooks** — Copy `adaptiveRateDelay` from `review-comment-backfill.ts` exactly. Stop backfill when `x-ratelimit-remaining / x-ratelimit-limit < 0.5`. Run as separate script outside main server process. Use cursor-based resume so partial runs are recoverable. Address in Phase 1.

5. **Issue/PR number space collision in backfill** — GitHub Issues API returns PRs in issue lists. Filter `response.pull_request` presence during backfill. Add `AND is_pull_request = false` to all duplicate detection queries. Verify with `SELECT COUNT(*) FROM issues WHERE is_pull_request = true` post-backfill (should be 0). Address in Phase 1.

## Implications for Roadmap

The feature dependency chain is strict and dictates phase order. You cannot detect duplicates without a corpus. You cannot auto-triage effectively without duplicate detection wired in. The only flexibility is that PR-issue linking (Phase 3) and cross-corpus retrieval (Phase 4) are independent of each other and could be reordered if priorities shift.

### Phase 1: Historical Corpus Population

**Rationale:** Duplicate detection, PR-issue linking, and retrieval integration all require issues to exist in the corpus with embeddings. This phase unblocks everything else and has no upstream dependencies.

**Delivers:** All xbmc/xbmc issues from the past 3 years ingested with embeddings (5-8K issues, 6-8 hour one-time backfill); nightly sync keeping corpus current; sync state enabling cursor-based resume; two new schema migrations.

**Addresses (FEATURES.md):** Historical issue backfill, issue embedding on ingest, nightly incremental sync, backfill progress reporting.

**Avoids (PITFALLS.md):** Embedding full body (Pitfall 1 — extract description section, skip boilerplate), rate limit exhaustion (Pitfall 4 — adaptive delay + 50% budget reserve), PR/issue number confusion (Pitfall 10 — filter `pull_request` field), Voyage AI rate limits (Pitfall 7 — retry/resume sweep), nightly sync since-parameter gap (Pitfall 11 — use data timestamps not wall clock), IssueStore upsert timestamp guard (INT-1 — add `WHERE github_updated_at < EXCLUDED.github_updated_at`).

### Phase 2: Duplicate Detection and Auto-Triage

**Rationale:** Core user-facing intelligence feature. Requires populated corpus from Phase 1. Triage agent and MCP tools already exist — this is an orchestration and threshold-tuning problem, not a build-from-scratch problem.

**Delivers:** `issues.opened` fires parallel duplicate detection + triage validation; comment posted when high-confidence duplicates found or triage fails; labels applied; all operations idempotent against webhook redelivery.

**Addresses (FEATURES.md):** High-confidence duplicate detection, duplicate detection comment, duplicate candidate ranking (top-3 with state), auto-triage on `issues.opened`, config gate (`triage.autoTriageOnOpen`).

**Avoids (PITFALLS.md):** Threshold confusion (Pitfall 2 — named constants with comments), comment spam on redelivery (Pitfall 3 — three-layer idempotency), bot-created issue noise (Pitfall 8 — filter `sender.type === "Bot"`), closed-issue duplicate overwhelm (Pitfall 9 — recency weighting, cap at 3, include state/date), missing config gate (Pitfall 13 — default `autoTriageOnOpen: false`), workspace clone latency anti-pattern (use GitHub Contents API for templates, not workspace clone).

### Phase 3: PR-Issue Linking

**Rationale:** Independent of auto-triage. Requires populated corpus for semantic linking leg. Regex reference parsing works without corpus but semantic fallback needs it. Lower user-facing urgency than Phase 2 but ships the `pr_issue_links` table used by future retrieval enrichment.

**Delivers:** PRs linked to issues on `pull_request.opened` via reference parsing and semantic search; links stored in `pr_issue_links` table with confidence levels; HIGH confidence links surface as informational PR comments.

**Addresses (FEATURES.md):** PR-issue linking via reference parsing, semantic PR-issue linking.

**Avoids (PITFALLS.md):** False regex matches and ambiguous references (Pitfall 5 — verify referenced number `is_pull_request = false`; use keyword-close patterns only; Timeline API as ground truth for ambiguous cases), timeline API rate cost (Pitfall 14 — text-match first, Timeline API only for closed issues with no text match; run as background job).

### Phase 4: Issue Corpus in Cross-Corpus Retrieval

**Rationale:** Enhancement to the existing retrieval pipeline. All three prior phases deliver standalone user-facing value. This phase makes issues available as context in PR reviews and mention responses, completing the issue intelligence picture.

**Delivers:** Issue results in unified RRF fan-out alongside code, review comments, wiki, and snippets; `[issue: #N]` citations in PR review and mention responses; weighted per trigger type (0.8x for PR reviews, 1.3x for issue queries).

**Addresses (FEATURES.md):** Issue corpus in cross-corpus retrieval.

**Avoids (PITFALLS.md):** N+1 latency regression (Pitfall 15 — feature-flag the integration initially; measure p95 issue search latency independently before wiring into unified pipeline), cross-corpus dedup threshold mismatch (INT-5 — test dedup threshold interaction between issue text and wiki/code before shipping).

### Phase Ordering Rationale

- Phases 2-4 all depend on Phase 1 data; Phase 1 must be first.
- Phase 2 (auto-triage) and Phase 3 (PR linking) are independent of each other; Phase 2 is higher user-facing impact so it goes second.
- Phase 4 is the lowest-risk, lowest-urgency enhancement; it goes last by design.
- All four phases use existing patterns — no architectural invention required — so implementation velocity should be high.

### Research Flags

Phases with well-documented patterns (standard execution, skip `/gsd:research-phase`):
- **Phase 1:** Exact template in `review-comment-backfill.ts` (backfill) and `wiki-sync.ts` (nightly scheduler). No implementation ambiguity.
- **Phase 3:** Reference parsing regex is deterministic. Semantic linking uses existing `IssueStore.searchByEmbedding()`. Timeline API behavior is documented.

Phases that warrant a calibration spike before committing to implementation:
- **Phase 2:** Duplicate detection threshold tuning requires empirical validation against xbmc/xbmc data. Recommend a threshold calibration task as the first sub-task: run `findSimilar` against 20 known-duplicate pairs and 20 known-non-duplicate pairs to validate the 0.12/0.18/0.25 distance bands before baking them into config schema.
- **Phase 4:** Cross-corpus dedup threshold interaction between issue text (conversational) and wiki/code text (technical documentation/code) has not been validated. Measure with real queries before shipping.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All capabilities confirmed present in existing dependency tree; no new packages required; integration points verified against installed versions and actual source files |
| Features | HIGH for ingestion and auto-triage; MEDIUM for duplicate thresholds | Ingestion and triage patterns are established codebase precedents; threshold values (0.12/0.18/0.25) are research-informed but must be empirically validated against real xbmc/xbmc data |
| Architecture | HIGH | Every new component follows an existing codebase pattern; file locations, interfaces, and data flows specified precisely with line references; anti-patterns documented from real code constraints |
| Pitfalls | MEDIUM-HIGH | GitHub API behavior and pgvector distance/similarity confusion verified via official docs and community issues; embedding dilution and idempotency patterns verified against existing codebase implementations; rate limit projections are estimates |

**Overall confidence:** HIGH

### Gaps to Address

- **Duplicate detection thresholds (Phase 2):** The 0.12/0.18/0.25 cosine distance bands are research-informed but not validated against xbmc/xbmc data. Build a calibration task into Phase 2 planning: run detection against known duplicate pairs before committing thresholds to config schema.

- **Embedding quality on xbmc/xbmc issues (Phase 1):** xbmc/xbmc issues are template-driven with heavy log/system-info boilerplate. The "extract description section, skip boilerplate" strategy is correct but depends on the v0.21 template parser correctly identifying section boundaries on real issues. Validate on 10-20 real issues before bulk ingestion begins.

- **Voyage AI rate limits at bulk ingestion scale (Phase 1):** 5-8K issues + ~15K comments = ~20K embedding calls. Voyage AI rate limits at this scale are not precisely documented. Budget 6-12 hours for backfill and build retry/resume capability before starting.

- **IssueStore upsert timestamp guard (Phase 1):** The existing `IssueStore.upsert()` uses `ON CONFLICT DO UPDATE SET` without a `WHERE github_updated_at < EXCLUDED.github_updated_at` guard. This is a required fix (INT-1) before nightly sync runs concurrently with webhook updates. Must be addressed in Phase 1.

- **Cross-corpus dedup threshold (Phase 4):** The existing `deduplicateChunks` uses cosine threshold 0.90 for the current four corpora. Issue text is conversational, not technical documentation or code. The threshold may need per-corpus-pair tuning. Test before shipping.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/knowledge/review-comment-backfill.ts` (backfill pattern), `src/knowledge/wiki-sync.ts` (nightly scheduler), `src/knowledge/cluster-scheduler.ts` (setInterval + startup delay), `src/knowledge/issue-store.ts` (CRUD + search API), `src/triage/triage-agent.ts` (template validation), `src/knowledge/cross-corpus-rrf.ts` (RRF merging), `src/webhook/router.ts` (event dispatch), `src/handlers/review-idempotency.ts` (idempotency patterns)
- [GitHub REST API: List Repository Issues](https://docs.github.com/en/rest/issues/issues#list-repository-issues) — `state`, `since`, `sort`, `direction`, `per_page` parameters
- [GitHub REST API: Pagination](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api) — Link header, per_page max 100
- [GitHub REST API: Rate Limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) — 5,000 req/hr for authenticated apps
- [pgvector GitHub issue #72](https://github.com/pgvector/pgvector/issues/72) and [Supabase issue #12244](https://github.com/supabase/supabase/issues/12244) — cosine distance vs. similarity operator behavior confirmed
- [GitHub Timeline Events API](https://docs.github.com/en/rest/issues/timeline) — cross-reference event types
- [GitHub webhook redelivery behavior](https://github.com/orgs/community/discussions/151676) — at-least-once delivery guarantee

### Secondary (MEDIUM confidence)
- [Simili Bot](https://github.com/similigh/simili-bot), [AI Duplicate Detector](https://github.com/mackgorski/ai-duplicate-detector), [Probot duplicate-issues](https://github.com/probot/duplicate-issues), [Similar Issues AI](https://github.com/apps/similar-issues-ai) — feature landscape and anti-feature guidance
- [VS Code Automated Issue Triaging](https://github.com/microsoft/vscode/wiki/Automated-Issue-Triaging) — threshold approaches, two-model pattern, auto-close timing
- [GitHub Agentic Workflows: Issue Triage](https://github.github.io/gh-aw/blog/2026-01-13-meet-the-workflows/) — auto-triage patterns
- [Zilliz: Embeddings for Duplicate Detection](https://zilliz.com/ai-faq/how-do-i-use-embeddings-for-duplicate-detection) and [emergentmind cosine similarity threshold research](https://www.emergentmind.com/topics/cosine-similarity-threshold) — threshold guidance informing the 0.25/0.18/0.12 bands

### Tertiary (LOW confidence)
- Voyage AI rate limits at 20K+ embedding call scale — not precisely documented at this volume; budget conservatively with retry/resume

---
*Research completed: 2026-02-26*
*Ready for roadmap: yes*
