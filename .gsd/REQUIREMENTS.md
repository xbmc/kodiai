# Requirements

This file is the explicit capability and coverage contract for the project.

## Active

### R031 — Review Details must report breaking-change intent only from genuine title/body/commit signals after template/checklist stripping, not from leaked PR boilerplate.
- Class: correctness
- Status: active
- Description: Review Details must report breaking-change intent only from genuine title/body/commit signals after template/checklist stripping, not from leaked PR boilerplate.
- Why it matters: False breaking-change signals erode trust in Review Details and mis-scope the review prompt.
- Source: user
- Primary owning slice: M039
- Supporting slices: none
- Validation: Regression fixture derived from xbmc/xbmc PR 28127 body/output does not render 'breaking change in body' unless a real author-authored signal remains after stripping.
- Notes: Introduced by M039 after false 'breaking change in body' output on a live xbmc PR. The parser may still use real body prose, but template/checklist sections must be stripped first.

### R032 — Review Details must show Claude weekly usage percent left and reset timing when rate-limit data is available, and degrade truthfully when the SDK omits that data.
- Class: correctness
- Status: active
- Description: Review Details must show Claude weekly usage percent left and reset timing when rate-limit data is available, and degrade truthfully when the SDK omits that data.
- Why it matters: Missing or misleading Claude usage telemetry makes the shipped Review Details surface untrustworthy.
- Source: user
- Primary owning slice: M039
- Supporting slices: none
- Validation: Handler and formatter regression tests prove Review Details renders percent-left when usageLimit is present and follows the documented unavailable-state contract when it is absent.
- Notes: Introduced by M039 as a follow-up to M034. The display contract changes from utilization shown to percent remaining shown. Truthful degradation means Kodiai must not invent or imply captured usage when the underlying SDK signal is absent.

### R033 — Kodiai must use persistent structural graph context to improve coverage and context selection for extensive PR reviews, including blast-radius and likely affected tests/dependents.
- Class: functional
- Status: active
- Description: Kodiai must use persistent structural graph context to improve coverage and context selection for extensive PR reviews, including blast-radius and likely affected tests/dependents.
- Why it matters: File-level heuristics and semantic retrieval alone are not enough for extensive code review on structurally-coupled changes and large PRs.
- Source: user
- Primary owning slice: M040
- Supporting slices: none
- Validation: Fixture-based proof shows graph-aware review selection identifies impacted files/tests/dependents beyond file-level triage alone, while keeping context bounded on large PRs.
- Notes: Introduced by M040 after comparing Kodiai with code-review-graph and Octopus. The graph augments existing large-PR triage and retrieval; it does not replace cross-corpus retrieval.

### R034 — Graph-backed review context must fail open and avoid regressing small PR latency/cost through bounded context ranking and trivial-change bypass.
- Class: quality-attribute
- Status: active
- Description: Graph-backed review context must fail open and avoid regressing small PR latency/cost through bounded context ranking and trivial-change bypass.
- Why it matters: A graph substrate only helps if it improves extensive reviews without making normal reviews slower or noisier.
- Source: user
- Primary owning slice: M040
- Supporting slices: none
- Validation: Regression tests and milestone verifier demonstrate that trivial single-file PRs bypass or bound graph overhead, and graph build/query failures do not block reviews.
- Notes: Also introduced by M040. code-review-graph's own benchmarks show graph context can be more expensive than naive reads on tiny single-file changes, so Kodiai must explicitly guard against that failure mode.

### R043 — Explicit PR mention review requests must execute the review lane and publish exactly one visible GitHub outcome instead of succeeding silently.
- Class: functional
- Status: active
- Description: Explicit PR mention review requests must execute the review lane and publish exactly one visible GitHub outcome instead of succeeding silently.
- Why it matters: A bot that reacts to `@kodiai review` but publishes nothing on the PR is functionally broken and untrustworthy.
- Source: user
- Primary owning slice: M043
- Validation: Live production verification on xbmc/kodiai PR #80 shows an explicit `@kodiai review` request causes either a real review/comment publication or a visible failure comment, with no silent-success path.

### R049 — Kodiai should reduce PR review latency on the live xbmc/kodiai path with operator-visible phase timing and truthful bounded behavior for large reviews.
- Class: functional
- Status: active
- Description: Kodiai should reduce PR review latency on the live xbmc/kodiai path with operator-visible phase timing and truthful bounded behavior for large reviews.
- Why it matters: Repo-backed approvals are still hard to trust when GitHub only shows a silent APPROVED marker. A short factual review body improves operator and user auditability without turning clean reviews into noisy PR comments.
- Source: user
- Primary owning slice: M048
- Validation: Live xbmc/kodiai review proof shows per-phase timing and a materially improved end-to-end review path versus the current timeout-prone baseline, while any reduced-scope or staged large-PR behavior remains explicit and truthful instead of silently stalling or fabricating completeness.
- Notes: Queue discussion for M048 explicitly chose a best-effort latency target rather than a hard never-over-10-minutes guarantee. The milestone may include internal pipeline optimization, large-PR behavior changes, and parallel review-worker exploration, but must preserve review truthfulness.

### R050 — Expose durable per-phase latency for live PR reviews, including queue wait, workspace preparation, retrieval/context assembly, remote executor runtime, and publication, on operator-visible evidence surfaces.
- Class: operational
- Status: active
- Description: Expose durable per-phase latency for live PR reviews, including queue wait, workspace preparation, retrieval/context assembly, remote executor runtime, and publication, on operator-visible evidence surfaces.
- Why it matters: M048 proof requires attributable latency evidence on the real review path, not just total duration guesses from logs.
- Source: M048
- Primary owning slice: M048/S01
- Supporting slices: M048/S02,M048/S03
- Notes: Owned by M048 S01 with downstream optimization and disclosure support in S02/S03.

### R051 — When a repository intends synchronize-triggered reviews, the configured trigger shape must actually activate synchronize reruns or milestone verification must fail loudly.
- Class: functional
- Status: active
- Description: When a repository intends synchronize-triggered reviews, the configured trigger shape must actually activate synchronize reruns or milestone verification must fail loudly.
- Why it matters: Live latency proof and operator iteration depend on synchronize-triggered reviews working when the repo configuration says they should.
- Source: M048
- Primary owning slice: M048/S03
- Supporting slices: None
- Notes: Owned by M048 S03 because trigger-shape continuity and verifier failure behavior land there.

### R070 — The redesigned large-PR lifecycle is proven on at least one real large PR with bounded first pass, automatic continuation, and in-place visible comment updates
- Class: launchability
- Status: active
- Description: The redesigned large-PR lifecycle is proven on at least one real large PR with bounded first pass, automatic continuation, and in-place visible comment updates
- Why it matters: This redesign changes the public review contract and should not be considered done on test fixtures alone
- Source: user
- Primary owning slice: M065/S02
- Supporting slices: none
- Validation: mapped
- Notes: Live proof requirement for the redesign track.

### R105 — Shadow rollout metrics and tiered review modes: run lanes in shadow mode, collect hard metrics, then graduate Fast/Standard/Deep/Critical review tiers based on measured cost, latency, coverage, and signal.
- Class: operability
- Status: active
- Description: Shadow rollout metrics and tiered review modes: run lanes in shadow mode, collect hard metrics, then graduate Fast/Standard/Deep/Critical review tiers based on measured cost, latency, coverage, and signal.
- Why it matters: Review tiers and specialist orchestration should be backed by production evidence, not labels.
- Source: issue #131
- Primary owning slice: M070/S03
- Supporting slices: M070/S03
- Validation: unmapped
- Notes: M070/S03 advanced this requirement by adding aggregate-only candidate-verification publication evidence to the shared MCP publication gate, ExecutionResult, Review Details, and structured runtime logs. Full validation remains pending later review-tier/live rollout evidence in S04-S06 and beyond.

### R131 — Specialist lanes must start in shadow/private mode and emit bounded aggregate evidence only until reducer and verification gates prove they are safe to publish.
- Class: core-capability
- Status: active
- Description: Specialist lanes must start in shadow/private mode and emit bounded aggregate evidence only until reducer and verification gates prove they are safe to publish.
- Why it matters: Specialization should improve signal without uncontrolled parallelism, comment volume, or leakage of private candidate details.
- Source: user
- Primary owning slice: M073
- Supporting slices: M072/S01,M072/S02,M072/S03,M073,M074
- Validation: unmapped
- Notes: M072 supports R131 by keeping bridge evidence private, bounded, and redacted while threading shadow candidate evidence before publication. Primary completion remains deferred to M073 specialist lane work.

### R132 — Candidate publication must require reducer-approved verification status, dedupe, and disagreement handling before public GitHub output.
- Class: core-capability
- Status: active
- Description: Candidate publication must require reducer-approved verification status, dedupe, and disagreement handling before public GitHub output.
- Why it matters: Issue #131 is about making verification stronger than generation, not adding more unvetted comments.
- Source: user
- Primary owning slice: M074
- Supporting slices: M072/S01,M072/S02,M072/S03,M072/S04,M073,M074,M075
- Validation: unmapped
- Notes: M072 supports R132 by preserving fail-closed candidate publication policy and exposing reducer handoff input, but does not claim reducer-approved verification, dedupe, or disagreement handling; primary completion remains M074.

### R133 — Final issue #131 closure must be backed by orchestration telemetry, rollout gates, and cost/noise controls.
- Class: operability
- Status: active
- Description: Final issue #131 closure must be backed by orchestration telemetry, rollout gates, and cost/noise controls.
- Why it matters: The architecture should prove lower latency, better coverage, or lower noise before broader rollout.
- Source: user
- Primary owning slice: M075
- Supporting slices: M072/S01,M072/S03,M072/S04,M073,M074,M075
- Validation: unmapped
- Notes: M072 supports R133 through bounded bridge status, reason codes, and verifier evidence foundations. Final telemetry, rollout gates, and cost/noise closure remain M075.

### R138 — Reviews must optimize for token cost before timeout headroom; timeout increases are not an acceptable primary solution for recurring review-runtime pressure.
- Class: quality-attribute
- Status: active
- Description: Reviews must optimize for token cost before timeout headroom; timeout increases are not an acceptable primary solution for recurring review-runtime pressure.
- Why it matters: The user explicitly disliked increasing addon-check and dynamic review timeout headroom as the long-term fix; Kodiai should do less wasteful review work instead of giving wasteful work more time.
- Source: user
- Primary owning slice: M073/S01
- Supporting slices: M073/S02,M073/S03,M073/S04,M073/S05,M073/S06
- Validation: mapped
- Notes: Token reduction is the primary optimization constraint; latency improvements are expected to follow from reduced wasted work.

### R139 — Review prompt and context assembly must expose section-level token budgets and deterministic overflow behavior for prompt, retrieval, candidate/reducer, and continuation inputs.
- Class: core-capability
- Status: active
- Description: Review prompt and context assembly must expose section-level token budgets and deterministic overflow behavior for prompt, retrieval, candidate/reducer, and continuation inputs.
- Why it matters: Without explicit budgets, token usage stays opaque and optimization can silently become shallow or inconsistent review behavior.
- Source: user + inferred
- Primary owning slice: M073/S02
- Supporting slices: M073/S01,M073/S05,M073/S06
- Validation: mapped
- Notes: Overflow must be stable and explainable, not random prompt shrinkage.

### R140 — Review pipeline caches must expose hit, miss, degraded, and bypass telemetry with safe invalidation boundaries so cached reuse saves tokens without silently reusing stale context.
- Class: operability
- Status: active
- Description: Review pipeline caches must expose hit, miss, degraded, and bypass telemetry with safe invalidation boundaries so cached reuse saves tokens without silently reusing stale context.
- Why it matters: The user explicitly added 'cache more'; caching only helps if operators can see when it is working and correctness is protected when it is unsafe.
- Source: user
- Primary owning slice: M073/S03
- Supporting slices: M073/S01,M073/S04,M073/S06
- Validation: mapped
- Notes: Cache miss or degraded bookkeeping should rebuild directly; stale, incomplete, or weakly keyed entries must bypass with structured reasons.

### R141 — Continuation and retry reviews must reuse compact deltas instead of blindly replaying full context when safety signals show compaction is valid.
- Class: continuity
- Status: active
- Description: Continuation and retry reviews must reuse compact deltas instead of blindly replaying full context when safety signals show compaction is valid.
- Why it matters: Timeout and retry paths can burn tokens by re-sending context already analyzed; compact deltas reduce waste while preserving continuity.
- Source: inferred
- Primary owning slice: M073/S04
- Supporting slices: M073/S02,M073/S03,M073/S06
- Validation: mapped
- Notes: When compaction lacks required safety signals, the system must fall back to existing fuller context rather than guessing.

### R142 — Visible review behavior changes caused by budgeting must be bounded, explainable, and preserve review correctness, candidate verification, reducer, publication, and secret-safety gates.
- Class: failure-visibility
- Status: active
- Description: Visible review behavior changes caused by budgeting must be bounded, explainable, and preserve review correctness, candidate verification, reducer, publication, and secret-safety gates.
- Why it matters: The user allowed visible changes to save tokens, but users and operators must understand when budgeting changes what was reviewed and safety gates cannot be weakened.
- Source: user
- Primary owning slice: M073/S05
- Supporting slices: M073/S02,M073/S03,M073/S04,M073/S06
- Validation: mapped
- Notes: Review Details may expose bounded cost/efficiency signals and scoped-review disclosure, but must not leak raw prompts, raw candidates, or unsafe evidence.

## Validated

### R001 — `bunx tsc --noEmit` produces zero errors across the entire codebase
- Class: quality-attribute
- Status: validated
- Description: `bunx tsc --noEmit` produces zero errors across the entire codebase
- Why it matters: 474 TS errors undermine refactoring confidence and IDE support; strict types prevent runtime nullability bugs
- Source: execution
- Primary owning slice: M026/S02
- Supporting slices: none
- Validation: addonRepos Zod field in AppConfig (comma-split transform, configurable via ADDON_REPOS env var); handler gates on config.addonRepos.includes(repo); M030/S01 test 'non-addon repo returns without calling listFiles' passes.
- Notes: Fixed via null assertions, tx casts, type union additions, and mock type corrections

### R002 — Deprecated files (db-path.ts, SQLite databases in data/, root-level test-delta-verification.ts), stale SQLite references in comments, and orphaned code are removed
- Class: quality-attribute
- Status: validated
- Description: Deprecated files (db-path.ts, SQLite databases in data/, root-level test-delta-verification.ts), stale SQLite references in comments, and orphaned code are removed
- Why it matters: Dead code confuses contributors and agents; stale references mislead about the actual storage backend
- Source: execution
- Primary owning slice: M026/S01
- Supporting slices: none
- Validation: runAddonChecker in src/lib/addon-checker-runner.ts spawns kodi-addon-checker --branch &lt;branch&gt; &lt;addonDir&gt; subprocess; 19 runner tests pass including 'passes the branch and addonDir to the subprocess'.
- Notes: 5 files deleted total; .gitignore now covers data/

### R003 — .env.example lists every environment variable the app reads with required/optional status and description
- Class: operability
- Status: validated
- Description: .env.example lists every environment variable the app reads with required/optional status and description
- Why it matters: Current .env.example has 7 vars; production uses 22+. New contributors cannot set up the project
- Source: execution
- Primary owning slice: M026/S01
- Supporting slices: none
- Validation: resolveCheckerBranch maps PR base branch against ValidKodiVersions (10 known names); test 'covers all 10 expected version names' passes; unknown branch returns null → handler warns and skips.
- Notes: GITHUB_PRIVATE_KEY and GITHUB_PRIVATE_KEY_BASE64 listed as separate alternative entries

### R004 — data/, .planning/ (after archive), and any other generated directories are properly gitignored
- Class: quality-attribute
- Status: validated
- Description: data/, .planning/ (after archive), and any other generated directories are properly gitignored
- Why it matters: SQLite files in data/ could get committed; .planning/ is 11MB of legacy planning tracked in git
- Source: execution
- Primary owning slice: M026/S01
- Supporting slices: none
- Validation: parseCheckerOutput strips ANSI codes and matches ^(ERROR|WARN|INFO): (.+) per line; non-matching lines dropped silently; 5 parseCheckerOutput tests pass including ANSI and mixed-line cases.
- Notes: Both entries present with descriptive comments

### R005 — Merged local branches are deleted; only main and active feature branches remain
- Class: quality-attribute
- Status: validated
- Description: Merged local branches are deleted; only main and active feature branches remain
- Why it matters: 36 local branches, 5+ already merged into main — confusing for anyone running `git branch`
- Source: execution
- Primary owning slice: M026/S01
- Supporting slices: none
- Validation: formatAddonCheckComment renders HTML marker + heading + ERROR/WARN table (INFO filtered) + summary line; upsertAddonCheckComment posts or updates; tests 'posts comment when findings exist' and 'updates existing comment on second push' pass.
- Notes: Also removed 2 stale worktrees and pruned 28 stale remote tracking refs

### R006 — Production source files use pino logger instead of console.log/warn/error (scripts/migrations excluded)
- Class: quality-attribute
- Status: validated
- Description: Production source files use pino logger instead of console.log/warn/error (scripts/migrations excluded)
- Why it matters: console.log bypasses structured logging, making production debugging harder
- Source: execution
- Primary owning slice: M026/S02
- Supporting slices: none
- Validation: addonRepos is Zod-validated with comma-split transform; defaults to xbmc/repo-plugins,xbmc/repo-scripts,xbmc/repo-scrapers; overrideable via ADDON_REPOS env var.
- Notes: Uses optional logger injection pattern (logger?: Logger) for backward compatibility

### R007 — README covers architecture overview, complete setup instructions, configuration reference, and links to in-depth docs
- Class: quality-attribute
- Status: validated
- Description: README covers architecture overview, complete setup instructions, configuration reference, and links to in-depth docs
- Why it matters: Current README lists features but is light on architecture, contributor guidance, and complete config reference
- Source: user
- Primary owning slice: M026/S05
- Supporting slices: M026/S03, M026/S04
- Validation: Dockerfile updated in M030/S03/T02: apt-get install -y python3 python3-pip followed by pip3 install --no-cache-dir kodi-addon-checker in the same RUN layer.
- Notes: Target audience is open-source contributors

### R008 — docs/architecture.md explains the system design, module boundaries, data flow, and key abstractions
- Class: quality-attribute
- Status: validated
- Description: docs/architecture.md explains the system design, module boundaries, data flow, and key abstractions
- Why it matters: 212 source files across 20+ directories with no architectural documentation; contributors must read code to understand structure
- Source: user
- Primary owning slice: M026/S03
- Supporting slices: none
- Validation: Handler iterates all deduped addonIds calling runAddonChecker per addon; test 'runner called per addon with correct addonDir and branch' passes; findings from all addons aggregated before upsert.
- Notes: Forward link to knowledge-system.md (S04 creates that file)

### R009 — docs/configuration.md documents every .kodiai.yml option with types, defaults, and examples
- Class: quality-attribute
- Status: validated
- Description: docs/configuration.md documents every .kodiai.yml option with types, defaults, and examples
- Why it matters: Users have no reference for config options; only way to learn is reading config.ts (911 lines)
- Source: user
- Primary owning slice: M026/S03
- Supporting slices: none
- Validation: buildAddonCheckMarker provides deterministic HTML marker; upsertAddonCheckComment scans existing comments for marker then calls updateComment (not createComment) if found; test 'updates existing comment on second push (upsert path)' passes.
- Notes: Hand-written from config.ts schema; includes quick-start YAML example and two-pass safeParse behavior

### R010 — docs/knowledge-system.md documents the 5-corpus retrieval pipeline, embedding strategy, hybrid search, and RRF merging
- Class: quality-attribute
- Status: validated
- Description: docs/knowledge-system.md documents the 5-corpus retrieval pipeline, embedding strategy, hybrid search, and RRF merging
- Why it matters: The knowledge system is the crown jewel — 63 files in src/knowledge/ with zero external docs
- Source: user
- Primary owning slice: M026/S04
- Supporting slices: none
- Validation: Early return before any workspace or subprocess work when !config.addonRepos.includes(repo); test 'non-addon repo returns without calling listFiles' passes; existing review pipeline unaffected.
- Notes: Also produced docs/issue-intelligence.md (24 sections) and docs/guardrails.md (16 sections) as supporting feature docs

### R011 — docs/deployment.md consolidates deployment instructions; existing runbooks are linked from a docs index
- Class: operability
- Status: validated
- Description: docs/deployment.md consolidates deployment instructions; existing runbooks are linked from a docs index
- Why it matters: deployment.md is orphaned at project root; runbooks exist but aren't discoverable from README
- Source: user
- Primary owning slice: M026/S03
- Supporting slices: none
- Validation: S03 — docs/deployment.md updated with cross-links to architecture.md, configuration.md, GRACEFUL-RESTART-RUNBOOK.md; docs/README.md created indexing all 17 docs files across 5 sections including 6 runbooks
- Notes: deployment.md moved to docs/ by S01; S03 added cross-links and created the index

### R012 — CONTRIBUTING.md covers development setup, testing, code style, PR process, and module ownership
- Class: quality-attribute
- Status: validated
- Description: CONTRIBUTING.md covers development setup, testing, code style, PR process, and module ownership
- Why it matters: Open-source contributor audience needs onboarding guide
- Source: user
- Primary owning slice: M026/S05
- Supporting slices: none
- Validation: S05 — CONTRIBUTING.md created with prerequisites, dev setup, testing (including describe.skipIf pattern), code style, PR process, and architecture.md reference
- Notes: Does not reference LICENSE file (none exists)

### R013 — CHANGELOG.md backfilled with entries for v0.17 through v0.25
- Class: quality-attribute
- Status: validated
- Description: CHANGELOG.md backfilled with entries for v0.17 through v0.25
- Why it matters: Current CHANGELOG stops at v0.16; 9 milestones of work are undocumented in the changelog
- Source: user
- Primary owning slice: M026/S05
- Supporting slices: none
- Validation: S05 — v0.25 entry added with 7 Wiki Content Updates deliverables sourced from PROJECT.md
- Notes: v0.17–v0.24 were backfilled in prior milestones; S05 added v0.25

### R014 — Extract obvious helper functions from review.ts (4,415 lines) and mention.ts (2,677 lines) without restructuring handler flow
- Class: quality-attribute
- Status: validated
- Description: Extract obvious helper functions from review.ts (4,415 lines) and mention.ts (2,677 lines) without restructuring handler flow
- Why it matters: These files are too large for effective code review and agent comprehension
- Source: user
- Primary owning slice: M026/S02
- Supporting slices: none
- Validation: S02 — review-utils.ts (451 lines, 19 functions) and mention-utils.ts (106 lines, 2 functions) extracted; review.ts reduced by 386 lines, mention.ts by 90 lines; all tests pass
- Notes: Deep restructuring deferred to R017

### R015 — All tests pass or DB-dependent tests are properly skipped when Postgres is unavailable
- Class: quality-attribute
- Status: validated
- Description: All tests pass or DB-dependent tests are properly skipped when Postgres is unavailable
- Why it matters: 4 failing tests (pgvector stores + telemetry purge) fail on every local run without Postgres
- Source: execution
- Primary owning slice: M026/S02
- Supporting slices: none
- Validation: S02 — bun test → 2181 pass, 45 skip, 0 fail; DB tests use describe.skipIf(!TEST_DATABASE_URL)
- Notes: Uses TEST_DATABASE_URL (not DATABASE_URL) for skip guards

### R016 — .planning/ directory (11MB, 1028 files) removed from git tracking and added to .gitignore
- Class: quality-attribute
- Status: validated
- Description: .planning/ directory (11MB, 1028 files) removed from git tracking and added to .gitignore
- Why it matters: Superseded by .gsd/; adds bulk to clone and confuses the two planning systems
- Source: user
- Primary owning slice: M026/S01
- Supporting slices: none
- Validation: S01 — git ls-files .planning/ returns 0; README .planning/ references replaced with CHANGELOG.md
- Notes: Local .planning/ directory preserved on disk; .gitignore prevents re-tracking

### R019 — A deterministic audit reports embedding completeness and integrity for learning memories, PR review comments, wiki pages, code snippets, issues, and issue comments, including null/missing/stale/model-mismatch counts.
- Class: operability
- Status: validated
- Description: A deterministic audit reports embedding completeness and integrity for learning memories, PR review comments, wiki pages, code snippets, issues, and issue comments, including null/missing/stale/model-mismatch counts.
- Why it matters: The system currently has corpus-specific backfills and smoke checks but no end-to-end proof that embeddings are actually present across production data.
- Source: user
- Primary owning slice: M027
- Supporting slices: none
- Validation: M027/S01 — `bun run audit:embeddings --json` emits deterministic six-corpus integrity/model-status JSON from a read-only transaction and truthfully reports live failures instead of hiding them; M027/S04 — `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json` closed the milestone with `M027-S04-FULL-AUDIT` passing against the preserved six-corpus `s01.audit` envelope, including the audited-only `issue_comments` boundary.
- Notes: Production-first scope; audit is read-only and machine-checkable.

### R020 — Operators can repair missing/stale embeddings without downtime using resumable, rate-limited tooling for all persisted corpora.
- Class: operability
- Status: validated
- Description: Operators can repair missing/stale embeddings without downtime using resumable, rate-limited tooling for all persisted corpora.
- Why it matters: Silent fail-open embedding behavior preserves uptime but can leave production data degraded indefinitely unless repair is safe and practical.
- Source: user
- Primary owning slice: M027
- Supporting slices: none
- Validation: M027/S03 — `bun run repair:embeddings -- --corpus review_comments --json`, `bun run repair:embeddings -- --corpus review_comments --status --json`, `bun run repair:embeddings -- --corpus review_comments --resume --json`, `bun run repair:embeddings -- --corpus issues --dry-run --json`, and `bun run verify:m027:s03 -- --corpus review_comments --json` proved resumable live repair for the degraded corpus plus truthful no-op handling for another corpus through the shared contract; M027/S04 — `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json` closed the milestone with `M027-S04-NON-WIKI-REPAIR-STATE=repair_completed`, interpreting the idempotent `review_comments` rerun truthfully from durable status evidence rather than requiring fresh mutations.
- Notes: Repair mode is now explicit, observable, resumable, and shared across wiki plus all remaining non-wiki corpora.

### R021 — Verification proves that query-time embedding generation and retrieval actually use the persisted corpora after repair, not just that rows exist in tables.
- Class: correctness
- Status: validated
- Description: Verification proves that query-time embedding generation and retrieval actually use the persisted corpora after repair, not just that rows exist in tables.
- Why it matters: Row completeness alone does not prove the retrieval pipeline is healthy.
- Source: user
- Primary owning slice: M027
- Supporting slices: none
- Validation: M027/S01 — `bun run verify:retriever --repo xbmc/xbmc --query "json-rpc subtitle delay" --json` exercises the real `createRetriever(...).retrieve(...)` path, distinguishes query-embedding failure from no-hit states, and returns attributed live hits; M027/S04 — `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json` closed the milestone with `M027-S04-RETRIEVER=retrieval_hits`, preserving `s01.retriever.not_in_retriever=["issue_comments"]` so end-to-end proof stays truthful about live scope.
- Notes: Verified through the real production retrieval pipeline, not table-only checks.

### R022 — The script/backfill timeout failure is identified at the root cause and fixed with bounded batching, retries, resume behavior, and/or control-flow changes as needed.
- Class: reliability
- Status: validated
- Description: The script/backfill timeout failure is identified at the root cause and fixed with bounded batching, retries, resume behavior, and/or control-flow changes as needed.
- Why it matters: Repair tooling that times out is not operationally usable, especially against production data.
- Source: user
- Primary owning slice: M027
- Supporting slices: none
- Validation: M027/S02/S03 — wiki proof (`bun run verify:m027:s02 -- --page-title "JSON-RPC API/v8" --json`) and non-wiki proof (`bun run repair:embeddings -- --corpus review_comments --json` plus `bun run verify:m027:s03 -- --corpus review_comments --json`) both completed representative live bounded repairs without timeout-class failure while preserving resume/status evidence; M027/S04 — `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json` closed the milestone with both repair-state checks passing from durable status-backed evidence (`JSON-RPC API/v8` still `repair_completed`; `review_comments` healthy idempotent rerun still backed by `repair_completed`).
- Notes: The hardened repair story now covers the prior wiki timeout path plus the live non-wiki `review_comments` degradation through the same bounded, resumable operational model.

### R023 — The audit verifies that each corpus uses the intended embedding model and path, especially wiki `voyage-context-3` versus `voyage-code-3` for other corpora.
- Class: correctness
- Status: validated
- Description: The audit verifies that each corpus uses the intended embedding model and path, especially wiki `voyage-context-3` versus `voyage-code-3` for other corpora.
- Why it matters: Mixed or incorrect vector spaces can degrade retrieval even when embeddings are present.
- Source: user
- Primary owning slice: M027
- Supporting slices: none
- Validation: M027/S01 — `bun run audit:embeddings --json` locks wiki=`voyage-context-3` vs non-wiki=`voyage-code-3`, reports actual model sets per corpus, and surfaces live wiki model mismatch counts; M027/S04 — `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json` closed the milestone from the preserved all-green `s01.audit` envelope, confirming `wiki_pages` remained on `voyage-context-3` while the other audited corpora, including the audited-only `issue_comments`, remained on the non-wiki model boundary.
- Notes: Presence is insufficient; model alignment is now audited explicitly.

### R024 — Tests and/or deterministic operator verifiers catch future embedding completeness drift and timeout regressions before they become silent production degradation.
- Class: quality-attribute
- Status: validated
- Description: Tests and/or deterministic operator verifiers catch future embedding completeness drift and timeout regressions before they become silent production degradation.
- Why it matters: This class of failure will recur if it relies only on one-time manual inspection.
- Source: user
- Primary owning slice: M027
- Supporting slices: none
- Validation: M027/S01/S02/S03 — contract tests plus `audit:embeddings`, `verify:retriever`, `verify:m027:s01`, `bun test ./scripts/verify-m027-s02.test.ts`, `bun test ./scripts/verify-m027-s03.test.ts`, `bun run verify:m027:s02 -- --page-title "JSON-RPC API/v8" --json`, and `bun run verify:m027:s03 -- --corpus review_comments --json` now cover audit drift, live retriever truth, wiki repair proof, and non-wiki repair/no-op proof envelopes; M027/S04 — `bun test ./scripts/verify-m027-s04.test.ts` plus `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json` close the milestone with a repeatable machine-checkable final proof that preserves nested S01/S02/S03 evidence and stable milestone-level check IDs.
- Notes: Guardrails now cover both live repair families and preserve raw audit/repair/status evidence with stable check IDs for machine re-verification.

### R025 — The wiki update pipeline generates concrete page modification artifacts rather than suggestion/rationale-oriented prose.
- Class: correctness
- Status: validated
- Description: The wiki update pipeline generates concrete page modification artifacts rather than suggestion/rationale-oriented prose.
- Why it matters: The current output contract publishes advice about what should change instead of directly usable wiki modifications.
- Source: user
- Primary owning slice: M028/S01
- Supporting slices: M028/S03, M028/S04
- Validation: S01–S04 — Modification-only artifact contract proven end-to-end: WikiUpdateGroup type carries mode/scope (section|page), formatPageComment emits replacement text only, formatSummaryTable emits Wiki Modification Artifacts title and Modifications posted stat. bun run verify:m028:s04 --json overallPassed:true with NO-WHY-IN-RENDER, NO-WHY-IN-SUMMARY, DRY-RUN-CLEAN all passing. 104 rows in DB with real comment IDs confirming full pipeline is modification-first.
- Notes: Replaces the current suggestion-style contract introduced in M025.

### R026 — Published `xbmc/wiki` tracking issue comments contain replacement content and only minimal citations/metadata, with no `WHY:` blocks or opinionated explanatory prose.
- Class: correctness
- Status: validated
- Description: Published `xbmc/wiki` tracking issue comments contain replacement content and only minimal citations/metadata, with no `WHY:` blocks or opinionated explanatory prose.
- Why it matters: The user wants actionable wiki updates, not commentary.
- Source: user
- Primary owning slice: M028/S03
- Supporting slices: none
- Validation: S03 — Live publish to xbmc/wiki issue #5 confirmed: 3 comments posted with modification-only content and <!-- kodiai:wiki-modification:{pageId} --> markers, no **Why:** or voice-mismatch prose. formatPageComment fixed. bun run verify:m028:s03 --json → overallPassed: true with LIVE-MARKER count=80.
- Notes: Section headings and PR links may remain if they are purely navigational/traceable metadata.

### R027 — The wiki update system can publish section replacements by default and full-page replacement artifacts when broader changes make section-only output awkward or incomplete.
- Class: product-capability
- Status: validated
- Description: The wiki update system can publish section replacements by default and full-page replacement artifacts when broader changes make section-only output awkward or incomplete.
- Why it matters: Some stale pages need focused edits; others need a coherent page-wide rewrite.
- Source: user
- Primary owning slice: M028/S01
- Supporting slices: M028/S03, M028/S04
- Validation: S01 — WikiUpdateGroup type carries explicit mode field (section|page) with replacement text and scope metadata. Section vs page mode is deterministically chosen and machine-checkable in stored artifacts and verifier output. S04 regression harness confirms mode field present in all formatPageComment mock renders.
- Notes: Planning must define the deterministic threshold or rule for switching modes.

### R028 — Already-published suggestion-style wiki issue comments can be updated, superseded, or regenerated so the live workflow no longer presents the old contract as current output.
- Class: operability
- Status: validated
- Description: Already-published suggestion-style wiki issue comments can be updated, superseded, or regenerated so the live workflow no longer presents the old contract as current output.
- Why it matters: The user explicitly called out a live published comment as unacceptable; fixing only future output leaves the visible workflow inconsistent.
- Source: user
- Primary owning slice: M028/S02
- Supporting slices: M028/S03, M028/S04
- Validation: S02–S04 — Durable comment identity via published_comment_id column (migration 031). upsertWikiPageComment scans existing comments by marker and updates in place rather than creating duplicates. 21 legacy sentinel rows (published_comment_id=0) re-published via live upsert in S04; all acquired real GitHub comment IDs. bun run verify:m028:s04 --json SENTINEL-SUPERSEDED=pass (sentinel_rows=0). LIVE-PUBLISHED=pass (count=104).
- Notes: Externally visible GitHub history must be handled safely and reproducibly.

### R029 — Tests and/or deterministic verifiers fail if the wiki generation/publishing pipeline reintroduces `WHY:` blocks, opinionated framing, or suggestion-style issue output.
- Class: quality-attribute
- Status: validated
- Description: Tests and/or deterministic verifiers fail if the wiki generation/publishing pipeline reintroduces `WHY:` blocks, opinionated framing, or suggestion-style issue output.
- Why it matters: This is a contract change, not just a one-off formatting tweak.
- Source: user
- Primary owning slice: M028/S04
- Supporting slices: M028/S01, M028/S02, M028/S03
- Validation: S04 — 5-check machine-verifiable harness (verify-m028-s04.ts) with negative guards: NO-WHY-IN-RENDER, NO-WHY-IN-SUMMARY, DRY-RUN-CLEAN all assert absence of **Why:**, :warning:, Wiki Update Suggestions. wiki-publisher.test.ts has does-not-contain-suggestion-style-labels test (5 negative guards). Full regression sweep verify:m028:s02, s03, s04 all exit 0. Tests fail immediately if any banned string reappears.
- Notes: Should cover both stored generation artifacts and final published issue-comment formatting.

### R030 — Non-wiki corpora use voyage-4 embeddings and the retrieval pipeline uses rerank-2.5 as a post-RRF neural reranking step
- Class: quality-attribute
- Status: validated
- Description: Non-wiki corpora use voyage-4 embeddings and the retrieval pipeline uses rerank-2.5 as a post-RRF neural reranking step
- Why it matters: voyage-4 provides better retrieval quality than voyage-code-3; rerank-2.5 adds a neural cross-encoder pass that significantly improves final ranking accuracy over heuristic RRF alone
- Source: user
- Primary owning slice: M035/S01
- Supporting slices: M035/S02
- Validation: S01 — grep -r 'voyage-code-3' src/ --include='*.ts' | grep -v '.test.ts' returns 0 hits; DEFAULT_EMBEDDING_MODEL and NON_WIKI_TARGET_EMBEDDING_MODEL are "voyage-4"; createRerankProvider with rerank-2.5 model is implemented in embeddings.ts; 9 unit tests pass; tsc --noEmit exits clean.

### R035 — Kodiai shall keep the canonical code corpus fresh through selective changed-file updates and bounded audit/repair sweeps rather than periodic full-repo re-embedding.
- Class: operational
- Status: validated
- Description: Kodiai shall keep the canonical code corpus fresh through selective changed-file updates and bounded audit/repair sweeps rather than periodic full-repo re-embedding.
- Why it matters: Event-driven freshness plus repair keeps cost, lag, and provenance drift bounded while preserving truthful current-code retrieval.
- Source: M041
- Primary owning slice: M041
- Supporting slices: S03
- Validation: verify:m041:s03 --json exits 0 with overallPassed:true. All four checks pass: UNCHANGED-FILE-PRESERVATION (upsertCallCount=0 for fully unchanged file, upsertCallCount=1 for partially changed file), DRIFT-DETECTED-BY-AUDIT (audit_failed on drifted corpus, audit_ok on clean), SELECTIVE-REPAIR-FIXES-ONLY-DRIFTED-ROWS (repaired=3 embedCallCount=3 writeCallCount=3 on 3-drifted/1-fresh corpus), REPAIR-SKIPS-WHEN-NO-DRIFT (status_code=repair_not_needed embedCallCount=0).
- Notes: Validated by M041/S03. updateCanonicalCodeSnapshot() re-embeds only changed/new chunks via content-hash comparison; auditCanonicalCode() + runCanonicalCodeEmbeddingRepair() detect and repair stale/missing/model-mismatch rows in bounded passes (CANONICAL_CODE_REPAIR_LIMIT=2000).

### R036 — Kodiai shall maintain a canonical default-branch code corpus of current code chunks with commit/ref provenance and semantic retrieval so review-time systems can retrieve truthful unchanged code.
- Class: functional
- Status: validated
- Description: Kodiai shall maintain a canonical default-branch code corpus of current code chunks with commit/ref provenance and semantic retrieval so review-time systems can retrieve truthful unchanged code.
- Why it matters: Historical diff-hunk embeddings are not a canonical snapshot of repo code and cannot serve as the source of truth for unchanged-code review context.
- Source: M041
- Primary owning slice: M041
- Supporting slices: S01,S02
- Validation: S01 established the canonical current-code substrate: dedicated canonical_code_chunks/canonical_corpus_backfill_state schema, explicit chunk identity and provenance types, canonical chunker with auditable exclusions/boundaries, and a dedicated ingest path with inserted/replaced/dedup semantics proven by canonical-code store/chunker/ingest tests plus clean tsc. This validates the storage/chunking half of the requirement; retrieval/backfill workflow is advanced further in later slices.
- Notes: Validated at the substrate level by M041/S01. Full end-to-end default-branch backfill + retrieval proof continues in M041/S02/S03.

### R037 — Kodiai shall surface structurally-grounded impact context in reviews by combining graph blast-radius data with semantically relevant unchanged code from the canonical current-code corpus for changed symbols.
- Class: functional
- Status: validated
- Description: Kodiai shall surface structurally-grounded impact context in reviews by combining graph blast-radius data with semantically relevant unchanged code from the canonical current-code corpus for changed symbols.
- Why it matters: Diff text and historical retrieval alone cannot show who depends on a changed symbol or which unchanged code is semantically relevant right now.
- Source: M038
- Primary owning slice: M038
- Supporting slices: S01,S02
- Validation: Validated by M038/S02. Review Details now includes a bounded Structural Impact section with changed symbols, probable callers/dependents, impacted files, likely tests, and canonical unchanged-code evidence. The deterministic verifier `bun run verify:m038:s02 -- --json` passes both C++ and Python proof scenarios, including structurally grounded breaking-change wording when evidence is present.
- Notes: M038/S01 established the consumer adapters/orchestrator substrate; M038/S02 completed the review-visible rendering and prompt integration contract. M038/S03 still advances timeout/cache/fail-open operability, but the requirement's stated validation target is now met.

### R038 — Breaking-change detection for exported or widely-used symbols shall be structurally grounded with caller/dependent evidence and fail open when graph or corpus context is unavailable.
- Class: correctness
- Status: validated
- Description: Breaking-change detection for exported or widely-used symbols shall be structurally grounded with caller/dependent evidence and fail open when graph or corpus context is unavailable.
- Why it matters: Heuristic breaking-change output is less trustworthy than evidence-backed structural impact, but the review pipeline must remain non-blocking when substrate data is unavailable.
- Source: M038
- Primary owning slice: M038
- Supporting slices: S02,S03
- Validation: Validated by M040/S03. Proof check M040-S03-FAIL-OPEN-VALIDATION confirms neverThrew=true, succeeded=false, originalFindingsPreserved=true when LLM validation gate throws. buildGraphContextSection(null) returns empty text (fail-open). applyGraphAwareSelection() returns usedGraph=false on null graph. queryBlastRadiusFromSnapshot() provides caller/dependent evidence with explicit confidence scores and reason strings. bun run verify:m040:s03 --json exits 0 with overallPassed:true.

### R039 — Untitled
- Status: validated
- Validation: Validated by M042/S01 scorer-tier persistence work and fresh milestone validation reruns: `bun run verify:m042:s01` passed `M042-S01-STUCK-TIER-REPRO-FIXED` and `M042-S01-RECALCULATED-TIER-PERSISTS`, proving stored contributor tiers now advance truthfully as score signals accumulate.
- Notes: M042 closed the source-of-truth defect by recalculating and persisting contributor tiers during incremental scorer updates instead of reusing stale stored tiers.

### R040 — Untitled
- Status: validated
- Validation: Validated by M042/S02 render-surface wiring and fresh milestone validation reruns: `bun run verify:m042:s02` passed `M042-S02-PROFILE-TIER-DRIVES-SURFACE`, `M042-S02-PROMPT-ESTABLISHED-TRUTHFUL`, `M042-S02-DETAILS-ESTABLISHED-TRUTHFUL`, and `M042-S02-CRYSTALP-SURFACES-STAY-ESTABLISHED`, proving review output no longer mislabels the CrystalP-shaped experienced contributor as a newcomer.
- Notes: The corrected contributor-profile tier now drives prompt and Review Details wording directly, with explicit banned-phrase regression coverage for newcomer/developing copy on established contributors.

### R041 — Untitled
- Status: validated
- Validation: Validated by M042/S03 cache/fallback hardening and fresh milestone validation reruns: `bun run verify:m042:s03` passed `M042-S03-CACHE-HIT-SURFACE-TRUTHFUL`, `M042-S03-PROFILE-OVERRIDES-CONTRADICTORY-CACHE`, and `M042-S03-DEGRADED-FALLBACK-NONCONTRADICTORY`, proving lower-fidelity cache and degraded fallback paths do not preserve stale or contradictory contributor labels.
- Notes: `author_cache` is now bounded to fallback-taxonomy values only, unsupported cached tiers are ignored fail-open with a warning, and degraded paths preserve truthful contributor labeling plus disclosure.

### R042 — Untitled
- Status: validated
- Validation: Validated by the named M042 proof-harness path for the CrystalP-shaped repro and fresh milestone validation reruns: `bun run verify:m042:s01`, `bun run verify:m042:s02`, and `bun run verify:m042:s03` all passed, providing a reproducible mechanical regression surface for the original failure and adjacent contributor-history cases.
- Notes: The milestone now carries stable proof harnesses for persisted-tier advancement, review-surface truthfulness, and cache/degraded-path truthfulness, so the original repro is covered by repeatable verification rather than ad hoc inspection.

### R044 — Production mention-review deploys must preserve required ACA job wiring and publish-stage diagnostics so runtime failures are attributable instead of silent or generic.
- Class: operational
- Status: validated
- Description: Production mention-review deploys must preserve required ACA job wiring and publish-stage diagnostics so runtime failures are attributable instead of silent or generic.
- Why it matters: Broken app revisions and generic ACA failure wrappers made the real failure mode hard to identify and slowed restoration of the production bot.
- Source: user
- Primary owning slice: M043
- Validation: M043/S01 closure reran `bun test ./src/handlers/mention.test.ts ./src/handlers/review-idempotency.test.ts` (102 pass) and `bash -n deploy.sh` (exit 0). Verified deploy.sh preserves ACA job/app wiring via full-YAML updates and surfaces active revision + /healthz + /readiness evidence; mention publish-path regressions prove `reviewOutputKey`/idempotency/publish-resolution logs and actionable publish-failure fallback comments.
- Notes: Validated without outward Azure/GitHub mutations. This requirement is satisfied by deployment-contract preservation plus attributable publish diagnostics; live PR #80 proof remains tracked separately by R043.

### R045 — Operators can run a repeatable audit over recent Kodiai PR reviews and distinguish valid clean approvals from missing or unpublished findings using GitHub-visible output plus internal review publication evidence.
- Class: operational
- Status: validated
- Description: Operators can run a repeatable audit over recent Kodiai PR reviews and distinguish valid clean approvals from missing or unpublished findings using GitHub-visible output plus internal review publication evidence.
- Why it matters: Recent xbmc approvals that show only Review Details are ambiguous from GitHub alone; operators need a reliable way to tell genuinely clean reviews from review-output regressions.
- Source: user
- Primary owning slice: M044/S03
- Supporting slices: M044/S01, M044/S02
- Validation: `bun run verify:m044 -- --repo xbmc/xbmc --limit 12 --json` produced a deterministic 12-PR recent sample over xbmc/xbmc with verdict summary `clean-valid=11`, `findings-published=1`, `publish-failure=0`, `suspicious-approval=0`, `indeterminate=0`, using GitHub-visible output plus Azure internal publication evidence. `docs/runbooks/recent-review-audit.md` documents the rerun and drill-down flow.
- Notes: Validated by M044/S03 final packaged audit surface and milestone validation.

### R046 — Kodiai has one explicit contributor-experience contract that defines how contributor status affects review behavior and related tier surfaces.
- Class: functional
- Status: validated
- Description: Kodiai has one explicit contributor-experience contract that defines how contributor status affects review behavior and related tier surfaces.
- Why it matters: Without an explicit contract, the current dual-taxonomy system drifts across prompt shaping, Review Details, retrieval hints, and Slack/profile output.
- Source: issue-79
- Primary owning slice: M045/S01
- Supporting slices: M045/S02, M045/S03, M047/S01, M047/S02, M047/S03
- Validation: Revalidated during M047 closeout by fresh passing results from `bun run verify:m047 -- --json` and the prerequisite bundle (`bun run verify:m047:s02 -- --json && bun run verify:m045:s03 -- --json && bun run verify:m046 -- --json`), proving the contributor-experience contract remains truthful across review prompt/Review Details, retrieval hints, Slack/profile output, identity suppression, and contributor-model evidence without raw-tier drift.
- Notes: M047/S03 completed the final proof obligation for cross-surface coherence on top of the M045 contributor-experience contract.

### R047 — Kodiai can calibrate its contributor-tier model against a reusable xbmc/xbmc contributor fixture set and state whether the current scoring/tiering mechanism is sound, needs retuning, or needs replacement.
- Class: operational
- Status: validated
- Description: Kodiai can calibrate its contributor-tier model against a reusable xbmc/xbmc contributor fixture set and state whether the current scoring/tiering mechanism is sound, needs retuning, or needs replacement.
- Why it matters: The current scoring and percentile tiering need evidence from real contributors, not one-off anecdotes or a single bug repro.
- Source: issue-78
- Primary owning slice: M046/S02
- Supporting slices: M046/S01,M046/S03
- Validation: 2026-04-10 milestone closeout: `bun test ./src/contributor/fixture-set.test.ts ./src/contributor/xbmc-fixture-refresh.test.ts ./scripts/verify-m046-s01.test.ts ./src/contributor/xbmc-fixture-snapshot.test.ts ./src/contributor/calibration-evaluator.test.ts ./scripts/verify-m046-s02.test.ts ./src/contributor/calibration-change-contract.test.ts ./scripts/verify-m046.test.ts`, `bun run verify:m046 -- --json`, and `bun run tsc --noEmit` all passed. The integrated verifier preserved the nested S01/S02 proof surfaces, retained/excluded counts (3/6), a truthful `replace` verdict, and a complete `m047ChangeContract`.
- Notes: Mapped during M046 planning: S01 establishes the trusted xbmc fixture truth set, S02 is the primary calibration evaluator against the M045 contributor contract, and S03 emits the explicit keep/retune/replace verdict plus M047 change contract.

### R048 — The contributor-experience redesign and any approved contributor-tier recalibration ship coherently across all in-scope tier-related surfaces.
- Class: functional
- Status: validated
- Description: The contributor-experience redesign and any approved contributor-tier recalibration ship coherently across all in-scope tier-related surfaces.
- Why it matters: A partial rollout would leave GitHub review behavior, retrieval hints, Slack profile output, and contributor-model plumbing disagreeing about the same contributor.
- Source: issues-78-79
- Primary owning slice: M047/S03
- Supporting slices: M047/S01, M047/S02, M045, M046
- Validation: Validated during M047 closeout by fresh passing results from `bun test ./scripts/verify-m047.test.ts`, `bun run verify:m047 -- --json`, `bun run verify:m047:s02 -- --json && bun run verify:m045:s03 -- --json && bun run verify:m046 -- --json`, and `bun run tsc --noEmit`. The integrated `verify:m047` report preserved nested S02/M045/M046 evidence and the five milestone scenarios (`linked-unscored`, `calibrated-retained`, `stale-degraded`, `opt-out`, `coarse-fallback`) across review/runtime, Review Details, retrieval hints, Slack/profile output, identity behavior, and contributor-model evidence.
- Notes: Slice S03 is the owning slice and provides the milestone-close coherence proof surface for the shipped contributor-experience rollout.

### R052 — If an explicit strict PR review is bounded, downgraded, or scope-reduced for latency reasons, the GitHub-visible review surface and operator evidence must disclose that bounded behavior clearly.
- Class: functional
- Status: validated
- Description: If an explicit strict PR review is bounded, downgraded, or scope-reduced for latency reasons, the GitHub-visible review surface and operator evidence must disclose that bounded behavior clearly.
- Why it matters: Bounded execution changes product semantics and must be visible to users and operators instead of appearing as an exhaustive strict review.
- Source: M048
- Primary owning slice: M048/S03
- Supporting slices: M048/S01
- Validation: Reconfirmed during M048 closeout by fresh passing results from `bun test ./src/jobs/queue.test.ts ./src/jobs/aca-launcher.test.ts ./src/execution/prepare-agent-workspace.test.ts ./src/execution/agent-entrypoint.test.ts ./src/execution/executor.test.ts ./src/execution/config.test.ts ./src/execution/review-prompt.test.ts ./src/handlers/review.test.ts ./src/lib/review-utils.test.ts ./src/lib/review-boundedness.test.ts ./src/review-audit/phase-timing-evidence.test.ts ./scripts/verify-m048-s01.test.ts ./scripts/verify-m048-s02.test.ts ./scripts/verify-m048-s03.test.ts`, `bun run tsc --noEmit`, and `REVIEW_OUTPUT_KEY='' bun run verify:m048:s03 -- --review-output-key "$REVIEW_OUTPUT_KEY" --json`. The combined suite preserved the shared bounded-review disclosure contract across prompt generation, handler/publication, Review Details, summary backfill, and verifier fixtures while small unbounded reviews stayed silent.
- Notes: Owned by M048/S03 with S01 providing the operator evidence seam; M048 closeout reconfirmed the disclosure contract without changing the requirement scope.

### R053 — Small or low-complexity PR reviews must not receive a remote-runtime budget below a safe floor that makes tiny PRs more likely to time out than larger PRs.
- Class: non-functional
- Status: validated
- Description: Small or low-complexity PR reviews must not receive a remote-runtime budget below a safe floor that makes tiny PRs more likely to time out than larger PRs.
- Why it matters: The current timeout budgeting shrinks low-complexity runtime below the configured base budget even though ACA handoff/startup overhead is largely fixed, causing avoidable timeout_partial failures on tiny PRs.
- Source: user
- Primary owning slice: M050
- Supporting slices: none
- Validation: Fresh milestone closeout reran `bun test ./src/lib/timeout-estimator.test.ts ./src/handlers/review.test.ts ./src/lib/review-utils.test.ts ./src/execution/executor.test.ts ./src/review-audit/phase-timing-evidence.test.ts ./scripts/verify-m048-s01.test.ts ./scripts/verify-m048-s02.test.ts ./scripts/verify-m048-s03.test.ts && bun run tsc --noEmit` with 209 pass / 0 fail / exit 0. Live proof from S02 remained the milestone evidence set: `verify:m048:s01` returned `m048_s01_ok` for the opened and synchronize `xbmc/kodiai#86` runs on revision `ca-kodiai--deploy-20260416-143108`, and `verify:m048:s02` reported `latency-improved` with a `-660095ms` targeted delta versus the historical `xbmc/kodi-tv#1240` degraded baseline.
- Notes: Introduced from live timeout evidence on xbmc/kodi-tv PR #1240 and xbmc/xbmc PR #28185 plus verified timeout-estimator / executor budgeting analysis.

### R054 — Timeout partial-review comments and Review Details must report actual analyzed progress and retry state truthfully rather than implying total changed files were reviewed.
- Class: functional
- Status: validated
- Description: Timeout partial-review comments and Review Details must report actual analyzed progress and retry state truthfully rather than implying total changed files were reviewed.
- Why it matters: Misleading timeout output breaks trust and makes operators think review work completed when the run may have timed out before analyzing the changed files.
- Source: user
- Primary owning slice: M050
- Supporting slices: none
- Validation: Fresh milestone closeout reran `bun test ./src/lib/timeout-estimator.test.ts ./src/handlers/review.test.ts ./src/lib/review-utils.test.ts ./src/execution/executor.test.ts ./src/review-audit/phase-timing-evidence.test.ts ./scripts/verify-m048-s01.test.ts ./scripts/verify-m048-s02.test.ts ./scripts/verify-m048-s03.test.ts && bun run tsc --noEmit` with 209 pass / 0 fail / exit 0. That bundle kept the truthful timeout-surface contract green in `src/handlers/review.test.ts`, `src/lib/review-utils.test.ts`, `scripts/verify-m048-s01.test.ts`, and `scripts/verify-m048-s03.test.ts`, proving analyzed progress, captured findings, retry state, and explicit publication-phase timing stay truthful; S02’s live/operator proof remained green via `verify:m048:s03` on the `xbmc/kodiai#86` synchronize run.
- Notes: Introduced alongside the urgent small-PR timeout hardening milestone to keep genuine timeout behavior user-visible but accurate.

### R055 — Documented manual rereview triggers must either work end-to-end or be removed from docs/config/tests so operators never rely on a nonexistent path.
- Class: functional
- Status: validated
- Description: Documented manual rereview triggers must either work end-to-end or be removed from docs/config/tests so operators never rely on a nonexistent path.
- Why it matters: A documented rereview trigger that does not actually target Kodiai is an operator trap and makes review_requested debugging untrustworthy.
- Source: issue-84
- Validation: Validated by M051 closeout evidence: `bun test ./src/handlers/review.test.ts ./src/execution/config.test.ts ./src/handlers/mention.test.ts` passed 327/327 with team-only `ai-review` / `aireview` requests skipped and `@kodiai review` staying on `interactive-review` / `review.full`; `! rg -n "uiRereviewTeam|requestUiRereviewTeamOnOpen|ai-review|aireview" docs/runbooks/review-requested-debug.md docs/configuration.md docs/smoke/phase75-live-ops-verification-closure.md .kodiai.yml && rg -n "@kodiai review|interactive-review|review\.full|team-only-request" ...` confirmed the stale UI-team contract is gone while the surviving manual trigger and proof surfaces remain; `bun run tsc --noEmit` completed successfully.
- Notes: M051 settled the manual rereview contract on `@kodiai review` only and retired the unsupported UI-team rereview path from runtime/config/docs/tests.

### R056 — Operators can configure inbound webhook sources that relay selected events to Slack channels with optional filtering and explicit suppression reasons.
- Class: functional
- Status: validated
- Description: Operators can configure inbound webhook sources that relay selected events to Slack channels with optional filtering and explicit suppression reasons.
- Why it matters: External system events need a repeatable, low-noise path into Slack without ad hoc one-off integrations or unverifiable filtering behavior.
- Source: issue-76
- Primary owning slice: M052
- Supporting slices: none
- Validation: `bun run verify:m052` reports `m052_ok`; the committed PR branch also passes `bun test ./src/config.test.ts ./src/slack/webhook-relay-config.test.ts ./src/slack/webhook-relay.test.ts ./src/slack/webhook-relay-delivery.test.ts ./src/routes/slack-relay-webhooks.test.ts ./scripts/verify-m052-s01.test.ts ./scripts/verify-m052-s02.test.ts ./scripts/verify-m052.test.ts` and `bun run tsc --noEmit`. The feature now provides env-backed source config, explicit suppression reasons, explicit delivery failure, and operator docs/smoke guidance.
- Notes: Implemented on branch `m052-slack-webhook-relay` and opened as PR #89 during M052 closeout. The shipped proof surface is `bun run verify:m052`, which composes the S01 contract verifier and S02 route+delivery verifier.

### R057 — Kodiai must persist GitHub issues and issue comments in PostgreSQL with an IssueStore interface that supports CRUD plus vector and full-text retrieval for issue-triage workflows.
- Class: functional
- Status: validated
- Description: Kodiai must persist GitHub issues and issue comments in PostgreSQL with an IssueStore interface that supports CRUD plus vector and full-text retrieval for issue-triage workflows.
- Why it matters: Issue-triage and follow-on review features need a durable, queryable issue corpus instead of transient webhook payloads.
- Source: M021
- Primary owning slice: M021/S01
- Supporting slices: none
- Validation: M021/S01 summary and shipped code in src/knowledge/issue-store.ts prove the IssueStore factory, schema migration, and 15 PostgreSQL-backed tests covering issue/comment CRUD, similarity search, full-text search, and cascade delete.

### R058 — Kodiai must expose opt-in MCP tools for GitHub issue label and comment mutations with repo-aware validation, bounded error handling, and truthful partial-success reporting.
- Class: functional
- Status: validated
- Description: Kodiai must expose opt-in MCP tools for GitHub issue label and comment mutations with repo-aware validation, bounded error handling, and truthful partial-success reporting.
- Why it matters: Triage operators and automated mention flows need safe write surfaces for issue labels and comments that do not guess repo state or hide partial failures.
- Source: M021
- Primary owning slice: M021/S02
- Supporting slices: none
- Validation: M021/S02 summary plus src/execution/mcp/issue-label-server.ts and src/execution/mcp/issue-comment-server.ts prove shipped add_labels/create_comment/update_comment tooling with config gating, case-insensitive label validation, retry on rate limits, closed-issue warnings, truncation, and passing unit/integration coverage.

### R059 — Kodiai must validate issue mentions against repository issue templates and append concise triage guidance or label recommendations on the mention lane without blocking the primary response.
- Class: functional
- Status: validated
- Description: Kodiai must validate issue mentions against repository issue templates and append concise triage guidance or label recommendations on the mention lane without blocking the primary response.
- Why it matters: Issue mentions should help reporters supply missing structured information while preserving the normal mention-response path.
- Source: M021
- Primary owning slice: M021/S03
- Supporting slices: none
- Validation: M021/S03 summary plus src/triage/triage-agent.ts, src/handlers/mention.ts, and src/execution/mention-prompt.ts prove template diffing, needs-info label recommendation, mention-prompt triage context injection, and fail-open cooldown-gated mention integration with passing triage/config/mention/MCP tests.

### R061 — Large PRs return a truthful bounded first review instead of ending as a dead max_turns failure with no useful outcome
- Class: core-capability
- Status: validated
- Description: Large PRs return a truthful bounded first review instead of ending as a dead max_turns failure with no useful outcome
- Why it matters: Large PR review is currently untrustworthy if the system burns turns and leaves maintainers without a useful review contract
- Source: user
- Primary owning slice: M062/S01
- Supporting slices: none
- Validation: Validated by M062. Fresh milestone-close verification passed: `bun test ./scripts/verify-m062-s03.test.ts ./scripts/verify-m062-s01.test.ts` (20/20), `bun test ./src/lib/review-utils.test.ts ./src/lib/partial-review-formatter.test.ts ./src/handlers/review.test.ts` (159/159), `bun run verify:m062:s01 -- --json` (`status_code: "m062_s01_ok"` across 4 scenarios), `bun run verify:m062:s03 -- --json` (`status_code: "m062_s03_ok"` with three `bounded-parity-ok` scenarios and one `dead-end-rejected` zero-evidence scenario), and `bun run tsc --noEmit` (exit 0). The milestone proves large PRs now return a truthful bounded first review instead of a dead `max_turns` failure when structured evidence exists.
- Notes: First-pass contract for the redesign track. This is about useful bounded output, not yet automatic continuation.

### R062 — When a large-PR review is bounded, Kodiai automatically continues review work in the background without requiring a manual follow-up command
- Class: continuity
- Status: validated
- Description: When a large-PR review is bounded, Kodiai automatically continues review work in the background without requiring a manual follow-up command
- Why it matters: The large-PR experience should not depend on humans remembering to ask for deeper review after the first bounded pass
- Source: user
- Primary owning slice: M063/S01
- Supporting slices: none
- Validation: M063/S01 verified automatic bounded-review continuation with fresh evidence: `bun test src/lib/review-continuation-lifecycle.test.ts` (12 pass), `bun test src/handlers/review.test.ts --filter "continuation"` (147 pass, including continuation enqueue/merge/suppression coverage), and `bun test scripts/verify-m063-s01.test.ts && bun run scripts/verify-m063-s01.ts --json` (`status_code: m063_s01_ok`, proving schedule, merge, no-delta settlement, and stale-authority suppression).
- Notes: Validated for the shipped S01 lifecycle contract: automatic continuation through the real handler path, explicit merge/settlement decisions, and stale-authority suppression. Later milestone slices still extend same-surface revision semantics and prompt narrowing.

### R063 — Automatic continuation updates the same visible review surface in place and must not create an additional public comment for the same review lifecycle
- Class: continuity
- Status: validated
- Description: Automatic continuation updates the same visible review surface in place and must not create an additional public comment for the same review lifecycle
- Why it matters: The user experience should stay quiet and legible on GitHub rather than turning one review lifecycle into comment spam
- Source: user
- Primary owning slice: M063/S02
- Supporting slices: none
- Validation: Validated by M063/S02 slice-close verification: `bun test ./src/lib/partial-review-formatter.test.ts ./src/handlers/review.test.ts ./scripts/verify-m063-s02.test.ts ./scripts/verify-m063-s01.test.ts` (162/162 pass), `bun run verify:m063:s02 -- --json` (`status_code: "m063_s02_ok"`; scenarios reported `same-surface-pending`, `same-surface-revised`, and `same-surface-quiet-settlement` with `visibleSurfaceCount: 1` and `continuationSurfaceCount: 0`), and `bun run tsc --noEmit` (exit 0). Continuation now updates one canonical visible review surface anchored to the base reviewOutputKey without creating an extra lifecycle comment.
- Notes: One stable public review identity across first pass and continuation.

### R064 — The visible review must report truthful coverage state, including what was reviewed, what remains, and whether continuation is still in progress or has stopped
- Class: failure-visibility
- Status: validated
- Description: The visible review must report truthful coverage state, including what was reviewed, what remains, and whether continuation is still in progress or has stopped
- Why it matters: Bounded review is only trustworthy if the visible output tells maintainers what Kodiai actually covered and what remains
- Source: user
- Primary owning slice: M062/S02
- Supporting slices: M063/S02
- Validation: Validated by M062. Fresh milestone-close verification passed: `bun test ./src/lib/review-utils.test.ts ./src/lib/partial-review-formatter.test.ts ./src/handlers/review.test.ts` (159/159), `bun run verify:m062:s03 -- --json` (`status_code: "m062_s03_ok"`; timeout, max-turns, and large-PR bounded scenarios all reported `bounded-parity-ok` for bounded reason, covered scope, remaining scope, and continuation state), and `bun run tsc --noEmit` (exit 0). The visible review surfaces now truthfully report covered scope, remaining scope, and continuation status from one coherent contract.
- Notes: S02 completed the visible bounded-review rendering contract; S03 remains responsible for a milestone-level deterministic proof harness that guards this contract against regression.

### R065 — Kodiai may revise earlier findings during continuation, but every revision must be explicit rather than a silent rewrite of previously visible conclusions
- Class: correctness
- Status: validated
- Description: Kodiai may revise earlier findings during continuation, but every revision must be explicit rather than a silent rewrite of previously visible conclusions
- Why it matters: A bounded first pass can be incomplete, but later correction must remain legible to users and operators
- Source: user
- Primary owning slice: M063/S02
- Supporting slices: none
- Validation: Validated by M063/S02 slice-close verification: `bun test ./src/lib/partial-review-formatter.test.ts ./src/handlers/review.test.ts ./scripts/verify-m063-s02.test.ts ./scripts/verify-m063-s01.test.ts` (162/162 pass), `bun run verify:m063:s02 -- --json` (`status_code: "m063_s02_ok"`; the merge-revisions scenario reported `same-surface-revised` with explicit revision visibility and the no-delta scenario reported `same-surface-quiet-settlement` with no public churn), and `bun run tsc --noEmit` (exit 0). Continuation revisions are now rendered explicitly on the canonical surface instead of silently rewriting prior visible conclusions.
- Notes: Revisions are allowed; silent mutation is not.

### R066 — Continuation stops after sufficient high-risk coverage is achieved and must disclose that the review is sufficient-but-bounded rather than exhaustive
- Class: constraint
- Status: validated
- Description: Continuation stops after sufficient high-risk coverage is achieved and must disclose that the review is sufficient-but-bounded rather than exhaustive
- Why it matters: The redesign should optimize for truthful sufficiency rather than pretending exhaustive eventual coverage is always practical
- Source: user
- Primary owning slice: M063/S03
- Supporting slices: M065/S02
- Validation: Validated in M063/S03 with fresh slice-close evidence: `bun test src/execution/review-prompt.test.ts --filter "continuation"`, `bun test scripts/verify-m063-s03.test.ts`, `bun run verify:m063:s03 -- --json`, `bun test src/handlers/review.test.ts --filter "retry"`, `bun run verify:m063:s02 -- --json`, and `bun run tsc --noEmit` all passed. The verifier proves continuation narrows `review-change-context`, omits first-pass-only `review-size-context`, preserves required sections, avoids exhaustive-coverage claims, and the retry handler tests prove stale/superseded continuation cannot overwrite canonical summary or Review Details paths.
- Notes: The stopping contract is explicitly non-exhaustive.

### R067 — New commits supersede stale continuation work cleanly so old background review attempts cannot overwrite or misrepresent the latest PR state
- Class: continuity
- Status: validated
- Description: New commits supersede stale continuation work cleanly so old background review attempts cannot overwrite or misrepresent the latest PR state
- Why it matters: Automatic continuation is unsafe unless stale work yields to newer PR state deterministically
- Source: inferred
- Primary owning slice: M064/S01
- Supporting slices: none
- Validation: M064/S01 reran `bun test src/handlers/review.test.ts` and `bun test scripts/verify-m064-s01.test.ts && bun run verify:m064:s01 -- --json`; canonical continuation-family state preserves newer-attempt authority and the verifier proves stale superseded attempts cannot overwrite the winning attempt.
- Notes: Supersession must be first-class in the continuation lifecycle.

### R068 — Large-PR continuation and comment evolution are backed by durable operator evidence so maintainers can tell why continuation progressed, stopped, failed, or was superseded
- Class: operability
- Status: validated
- Description: Large-PR continuation and comment evolution are backed by durable operator evidence so maintainers can tell why continuation progressed, stopped, failed, or was superseded
- Why it matters: Operators need attributable lifecycle evidence instead of guessing from GitHub-visible output alone
- Source: inferred
- Primary owning slice: M064/S03
- Supporting slices: M065/S02
- Validation: M061/S05 added the integrated `verify-m061-s05` proof surface on the canonical Postgres-backed usage-report path and verified fail-open preflight reporting when telemetry is unavailable plus the DB-independent `phase-m061-token-regression-gate` operator surface. M064 must extend this by proving continuation lifecycle truth resolves from canonical family state directly, with explicit projection-status reporting when supporting evidence lags or fails.
- Notes: M061 validated the earlier operator-evidence surface. M064 tightens the contract so continuation lifecycle evidence must resolve from canonical continuation-family state first, with telemetry/checkpoint/report rows treated as projections.

### R069 — The redesign must preserve small and normal PR behavior and avoid regressing review latency, noise, or publication semantics on non-large PRs
- Class: quality-attribute
- Status: validated
- Description: The redesign must preserve small and normal PR behavior and avoid regressing review latency, noise, or publication semantics on non-large PRs
- Why it matters: Large-PR improvements are not acceptable if they make standard reviews slower, noisier, or less trustworthy
- Source: inferred
- Primary owning slice: M065/S01
- Supporting slices: none
- Validation: M061/S05 pinned and passed mention, review, retrieval, reporting, and verifier regression suites via `bun scripts/phase-m061-token-regression-gate.ts`, preserving non-large-PR behavior and publication semantics while token-reduction work evolves.
- Notes: Regression guard across the rest of the review path.

### R071 — Canonical continuation-family lifecycle state is persisted durably and survives process restarts as the authoritative source of continuation truth.
- Class: functional
- Status: validated
- Description: Canonical continuation-family lifecycle state is persisted durably and survives process restarts as the authoritative source of continuation truth.
- Why it matters: Runtime-only coordinator state is not enough for operator truth or restart-safe supersession semantics.
- Source: M064
- Primary owning slice: M064/S01
- Supporting slices: M064/S02,M064/S03
- Validation: M064/S01 reran `bun test src/handlers/review.test.ts` and `bun test scripts/verify-m064-s01.test.ts && bun run verify:m064:s01 -- --json`; canonical continuation-family rows answer merged, quiet-settled, blocked, and superseded scenarios directly from durable state.
- Notes: Introduced by M064 planning from research candidate requirement on durable canonical continuation-family state.

### R072 — Canonical continuation-family state records the final authoritative attempt identity explicitly so operators can see which attempt held authority without correlating logs.
- Class: operational
- Status: validated
- Description: Canonical continuation-family state records the final authoritative attempt identity explicitly so operators can see which attempt held authority without correlating logs.
- Why it matters: Operators currently infer the winning attempt from telemetry and log correlation, which is fragile under retries and supersession.
- Source: M064
- Primary owning slice: M064/S01
- Supporting slices: M064/S02,M064/S03
- Validation: M064/S01 verifier output returns `authoritativeAttemptId` and `authoritativeAttemptOrdinal` directly from canonical continuation-family state for merged, quiet-settled, blocked, and superseded scenarios; verified by `bun test scripts/verify-m064-s01.test.ts && bun run verify:m064:s01 -- --json`.
- Notes: Introduced by M064 planning from research candidate requirement on explicit authoritative attempt identity.

### R073 — Canonical continuation-family state records final stop reason using a controlled lifecycle enum/contract rather than scattered helper-specific strings.
- Class: operational
- Status: validated
- Description: Canonical continuation-family state records final stop reason using a controlled lifecycle enum/contract rather than scattered helper-specific strings.
- Why it matters: Operators need one direct answer for why continuation stopped, and that answer is currently spread across helpers, logs, and telemetry.
- Source: M064
- Primary owning slice: M064/S01
- Supporting slices: M064/S02,M064/S03
- Validation: M064/S01 verifier output returns controlled `finalStopReason` values (`merged-continuation-results`, `settled-without-update`, `no-follow-up`, `superseded-by-newer-attempt`) directly from canonical continuation-family state; verified by `bun test scripts/verify-m064-s01.test.ts && bun run verify:m064:s01 -- --json`.
- Notes: Introduced by M064 planning from research candidate requirement on explicit final stop reason contract.

### R074 — Projection failures for continuation lifecycle evidence are surfaced as projection status on top of canonical state instead of creating ambiguity about lifecycle truth.
- Class: operational
- Status: validated
- Description: Projection failures for continuation lifecycle evidence are surfaced as projection status on top of canonical state instead of creating ambiguity about lifecycle truth.
- Why it matters: Telemetry, checkpoints, and reports may fail independently; operators still need an unambiguous authoritative lifecycle answer.
- Source: M064
- Primary owning slice: M064/S03
- Supporting slices: M064/S02
- Validation: M064/S03 reran `bun test src/knowledge/continuation-operator-evidence.test.ts && bun test scripts/verify-m064-s03.test.ts && bun run verify:m064:s03 -- --json && bun run verify:m064:s03 && bun test scripts/verify-m064-s01.test.ts && bun test scripts/verify-m064-s02.test.ts && bun run verify:m064:s01 -- --json && bun run verify:m064:s02 -- --json`; the operator-evidence surface now resolves continuation lifecycle truth directly from canonical continuation-family state and renders degraded/pending `projectionStatus` explicitly.
- Notes: Slice-close verification confirmed canonical, degraded, pending, superseded, missing-canonical-row, and invalid-review-output-key report states.

### R075 — Checkpoint persistence acknowledgements must be truthful: writes are awaited and success is reported only after durable save completes.
- Class: correctness
- Status: validated
- Description: Checkpoint persistence acknowledgements must be truthful: writes are awaited and success is reported only after durable save completes.
- Why it matters: A non-awaited checkpoint save can misreport success and undermine continuation evidence durability.
- Source: M064
- Primary owning slice: M064/S02
- Supporting slices: none
- Validation: M064/S02 reran `bun test src/execution/mcp/checkpoint-server.test.ts && bun test src/handlers/review.test.ts && bun test scripts/verify-m064-s02.test.ts && bun run verify:m064:s02 -- --json`; checkpoint acknowledgements now wait for durable save completion and never report `saved: true` on rejected writes.
- Notes: Introduced by M064 planning from research candidate requirement on checkpoint acknowledgment reliability.

### R076 — Kodiai must recognize explicit formatter-suggestion requests such as `@kodiai format suggestions` and `@kodiai suggest formatting fixes` on PR mentions.
- Class: functional
- Status: validated
- Description: Kodiai must recognize explicit formatter-suggestion requests such as `@kodiai format suggestions` and `@kodiai suggest formatting fixes` on PR mentions.
- Why it matters: Maintainers need to request committable formatting suggestions on demand without relying on automatic review behavior.
- Source: user
- Primary owning slice: M053/S01
- Supporting slices: M053/S04
- Validation: M066/S01 verification passed: `bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts --timeout 30000` (245 pass, 0 fail). Parser and full mention-handler tests prove `@kodiai format suggestions` and `@kodiai suggest formatting fixes` route as explicit formatter-suggestion requests.
- Notes: M053 discussion: formatter suggestions are always accessible by explicit mention; repo config does not disable explicit access.

### R077 — Formatter suggestions must be posted as GitHub committable suggested changes on the same PR, not as a new branch, new PR, or bot-authored commit.
- Class: functional
- Status: validated
- Description: Formatter suggestions must be posted as GitHub committable suggested changes on the same PR, not as a new branch, new PR, or bot-authored commit.
- Why it matters: The desired workflow is one-click application inside the current PR, preserving the human GitHub review trust boundary.
- Source: user
- Primary owning slice: M053/S03
- Supporting slices: M053/S02,M053/S04,M053/S05
- Validation: M066/S07/T05 live smoke proof on xbmc/kodiai PR #134 posted a same-PR COMMENTED Kodiai Pull Request Review with review id 4225484818 and fenced suggestion comment 3186219778; `bun run verify:m066:s05 -- --repo xbmc/kodiai --review-output-key <mention-format-suggestions key> --delivery-id 462ed8c0-4843-11f1-8135-1c6010084b2c --json` returned `success: true`, `status_code: "m066_s05_ok"`.
- Notes: Validated without a new branch, new PR, or bot-authored commit; proof is recorded in docs/smoke/m066-formatter-suggestions.md.

### R078 — Formatter execution must be driven by a repository-configured formatter command, initially suitable for `git-clang-format`, with a seam for future formatter adapters.
- Class: integration
- Status: validated
- Description: Formatter execution must be driven by a repository-configured formatter command, initially suitable for `git-clang-format`, with a seam for future formatter adapters.
- Why it matters: Kodiai must own the suggestion generation loop while avoiding a hardcoded one-off implementation that blocks later formatter support.
- Source: user
- Primary owning slice: M053/S01
- Supporting slices: M053/S02
- Validation: M066/S02 verification passed: `bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts ./src/execution/formatter-suggestions.test.ts --timeout 30000` (269 pass, 0 fail). Command-runner fixture tests prove repository-configured formatter commands use only allowlisted placeholders, return structured no-command/no-op/success/failed/timed-out statuses, and produce bounded/redacted diagnostics without relying on Jenkins artifacts.
- Notes: Jenkins artifacts are out of scope; Kodiai computes suggestions independently from the PR workspace.

### R079 — Automatic formatter suggestions during normal reviews must default off; explicit formatter requests remain available regardless of automatic mode.
- Class: constraint
- Status: validated
- Description: Automatic formatter suggestions during normal reviews must default off; explicit formatter requests remain available regardless of automatic mode.
- Why it matters: The user wants to trial the capability on request without changing normal review behavior by default.
- Source: user
- Primary owning slice: M053/S01
- Supporting slices: M053/S04
- Validation: M066/S01 verification passed: config tests prove `review.formatterSuggestions.automatic` defaults false with optional command and bounded `maxSuggestions`, and mention-handler fixtures prove explicit formatter requests still carry `formatterSuggestionRequest` when automatic mode is off.
- Notes: Use config semantics like `review.formatterSuggestions.automatic: false`, not `enabled: false`.

### R080 — Kodiai must support a combined request, `@kodiai review & format suggestions`, that runs normal review and formatter suggestions from one mention.
- Class: functional
- Status: validated
- Description: Kodiai must support a combined request, `@kodiai review & format suggestions`, that runs normal review and formatter suggestions from one mention.
- Why it matters: Maintainers should be able to ask for normal review plus formatting suggestions in one request.
- Source: user
- Primary owning slice: M053/S04
- Supporting slices: M053/S01,M053/S02,M053/S03
- Validation: M053/S04 verification passed: `bun test src/handlers/mention.test.ts src/handlers/formatter-suggestion-orchestration.test.ts --timeout 30000` (157 pass, 0 fail, 925 assertions) and full formatter bundle `bun test src/execution/config.test.ts src/handlers/formatter-suggestion-intent.test.ts src/handlers/mention.test.ts src/execution/formatter-suggestions.test.ts src/execution/formatter-suggestion-publisher.test.ts src/handlers/formatter-suggestion-orchestration.test.ts --timeout 30000` (306 pass, 0 fail, 1419 assertions). Combined-mode mention tests prove `@kodiai review & format suggestions` preserves normal review routing while invoking formatter suggestions after returned-error and thrown-error review executor cases.
- Notes: The semantic review and formatter suggestion subflows should remain independent under the combined intent.

### R081 — Formatter suggestions should publish as one batched PR review containing multiple inline suggestion comments where GitHub accepts the batch.
- Class: functional
- Status: validated
- Description: Formatter suggestions should publish as one batched PR review containing multiple inline suggestion comments where GitHub accepts the batch.
- Why it matters: One batched review reduces notification spam and matches the user's preference for one output with many inline suggestions.
- Source: user
- Primary owning slice: M053/S03
- Supporting slices: M053/S04
- Validation: M066/S03 publisher tests passed in current slice verification: `bun test ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000` (34 pass, 117 assertions) and regression bundle `bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000` (279 pass, 1289 assertions). Tests prove one `pulls.createReview` call carries multiple inline suggestion comments plus review-output idempotency markers, with no standalone comment fallback.
- Notes: Avoid looping standalone comments for the normal formatter suggestion path.

### R082 — Formatter unified diffs must be converted into GitHub suggestion payloads deterministically, posting only hunks that map cleanly to PR diff line ranges.
- Class: quality-attribute
- Status: validated
- Description: Formatter unified diffs must be converted into GitHub suggestion payloads deterministically, posting only hunks that map cleanly to PR diff line ranges.
- Why it matters: GitHub suggestion blocks are only safe when their replacement range is exact; bad mappings create invalid or misleading committable changes.
- Source: inferred
- Primary owning slice: M053/S02
- Supporting slices: M053/S03,M053/S05
- Validation: M066/S02 verification passed: `bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts ./src/execution/formatter-suggestions.test.ts --timeout 30000` (269 pass, 0 fail). Formatter parser/mapper tests prove git unified diffs become deterministic RIGHT-side GitHub suggestion payloads only when every target line maps to the PR diff index; malformed, unsupported, pure insertion/deletion, path-mismatch, and off-diff hunks are skipped rather than guessed.
- Notes: Claude must not invent or repair formatter hunks; invalid/unmappable hunks are skipped.

### R083 — Formatter suggestion posting must enforce caps and skip unsafe hunks with structured visibility into skipped counts and reasons.
- Class: operability
- Status: validated
- Description: Formatter suggestion posting must enforce caps and skip unsafe hunks with structured visibility into skipped counts and reasons.
- Why it matters: Formatting diffs can be large; Kodiai must avoid spamming PRs or posting unsafe suggestions.
- Source: user
- Primary owning slice: M053/S02
- Supporting slices: M053/S03,M053/S04
- Validation: M066/S02 verification passed: `bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts ./src/execution/formatter-suggestions.test.ts --timeout 30000` (269 pass, 0 fail). Mapper tests prove safe candidates are capped by maxSuggestions after validation, capped candidates receive `max-suggestions-exceeded`, and skipped/unsafe/parser diagnostics are returned with counts for downstream publication and logging.
- Notes: Partial success should publish valid suggestions while logging/publicly accounting for skipped hunks.

### R084 — Formatter failures and combined-mode partial failures must be visible without blocking independent successful subflows.
- Class: failure-visibility
- Status: validated
- Description: Formatter failures and combined-mode partial failures must be visible without blocking independent successful subflows.
- Why it matters: A combined request should not lose a useful review or useful formatter suggestions because the other subflow failed.
- Source: user
- Primary owning slice: M053/S04
- Supporting slices: M053/S03,M053/S05
- Validation: M053/S04 verification passed: formatter-orchestration and mention-handler tests prove visible bounded diagnostics for setup-needed/no-op/command failure/timeout/PR-diff-unavailable/mapped-no-suggestions/duplicate/blocked/publisher-failed outcomes, and combined-mode mention tests prove formatter failures do not block successful review paths while review executor failures still attempt formatter suggestions when setup is available. Fresh full bundle passed with 306 pass, 0 fail, 1419 assertions.
- Notes: Formatter failure must not block normal review; normal review failure must not block formatter suggestions when they can run safely.

### R085 — Formatter suggestion support must include a live GitHub smoke proof that at least one Kodiai-generated suggestion is accepted as a committable same-PR suggestion.
- Class: quality-attribute
- Status: validated
- Description: Formatter suggestion support must include a live GitHub smoke proof that at least one Kodiai-generated suggestion is accepted as a committable same-PR suggestion.
- Why it matters: GitHub suggestion acceptance has edge cases that fixture tests alone cannot fully prove.
- Source: user
- Primary owning slice: M053/S05
- Supporting slices: none
- Validation: M053/S05 proof alignment documents the accepted live formatter-suggestion smoke on xbmc/xbmc#28259: explicit `@kodiai review format suggestions` trigger, formatter action `mention-format-suggestions`, same-PR `COMMENTED` Pull Request Review, fenced GitHub `suggestion` comments, delivery/log correlation via formatter `reviewOutputKey`, and canonical verifier surface `bun run verify:m066:s05` returning `status_code: "m066_s05_ok"` in the accepted proof record. Fresh S05 closure reran local verifier and formatter contract suites; GitHub App credentials were absent, so exact live rerun was boundedly skipped per plan.
- Notes: M053/S05 intentionally reuses the accepted M066 verifier/proof surface instead of minting an M053-only verifier or status code. Automatic formatter suggestions remain off/reserved for future runtime wiring; R085 proof is limited to explicit same-PR formatter suggestions.

### R092 — First-class review plan contract: every review run must be able to produce a typed ReviewPlan capturing task type, routing reason, changed-file scope, context sources, budgets, enabled gates, publish/tool policy, retry/publish policy, and a stable plan hash.
- Class: continuity
- Status: validated
- Description: First-class review plan contract: every review run must be able to produce a typed ReviewPlan capturing task type, routing reason, changed-file scope, context sources, budgets, enabled gates, publish/tool policy, retry/publish policy, and a stable plan hash.
- Why it matters: Kodiai's review behavior is currently spread across review.ts, routing, config, prompt, timeout, MCP, and reducer-like gates. Operators need to know what the run intended to do before diagnosing what happened.
- Source: user + issue #131
- Primary owning slice: M067/S01
- Supporting slices: M067/S02, M067/S03, M067/S04, M067/S05
- Validation: M067/S01 implemented and verified a first-class ReviewPlan contract in src/review-orchestration/review-plan.ts, wired it into src/handlers/review.ts before executor dispatch, and passed slice verification: bun test src/review-orchestration/review-plan.test.ts, bun test src/handlers/review.test.ts --timeout 30000, bun run verify:m067:s01, bun run verify:m067:s01 -- --json, bun run tsc --noEmit, and git diff --check.
- Notes: M067 behavior-preserving foundation from issue #131. The plan may begin owning some routing decisions over time, but the first milestone must not silently change production routing behavior.

### R093 — Compact review-plan visibility: Review Details must expose a short operator-facing plan summary while deeper plan structure remains available in telemetry, structured logs, config snapshots, or artifacts.
- Class: failure-visibility
- Status: validated
- Description: Compact review-plan visibility: Review Details must expose a short operator-facing plan summary while deeper plan structure remains available in telemetry, structured logs, config snapshots, or artifacts.
- Why it matters: Plan visibility must help operators debug production reviews without making PR author-facing output noisy.
- Source: user
- Primary owning slice: M067/S01
- Supporting slices: M067/S03, M067/S04, M067/S05
- Validation: M067 S04 verification passed: review-utils tests and verifier CANDIDATE-DETAILS-COMPACT prove exactly one compact Review candidates line, count-only/correlation-only metadata, and no raw title/body/diff/prompt/token/secret leakage.
- Notes: User requested compact operator summary only, with more detail allowed in details/telemetry surfaces.

### R094 — Review graph-validation config reachability: `.kodiai.yml` must be able to preserve and enable `review.graphValidation.enabled`, documentation must describe it, and plan/details surfaces must truthfully report enabled, unavailable, skipped, or applied states.
- Class: integration
- Status: validated
- Description: Review graph-validation config reachability: `.kodiai.yml` must be able to preserve and enable `review.graphValidation.enabled`, documentation must describe it, and plan/details surfaces must truthfully report enabled, unavailable, skipped, or applied states.
- Why it matters: This is a concrete example of prompt/config/tool drift. A typed review plan should prevent unreachable review gates.
- Source: issue #131 + codebase
- Primary owning slice: M067/S02
- Supporting slices: M067/S01, M067/S03, M067/S05
- Validation: M067 S03 reducer input consumes typed `config.review.graphValidation.enabled` and graph-validation status/count metadata without mutating hashed ReviewPlan state; reducer tests, handler graph-validation coverage, and `verify:m067:s03` GRAPH-VALIDATION-CONSUMED passed.
- Notes: Code currently checks `config.review.graphValidation?.enabled`, but config schema inspection showed the field is not exposed in the review schema.

### R095 — Behavior-preserving reducer extraction: current post-processing gates must be wrapped in a structured reducer result without intentionally changing which findings are kept, suppressed, rewritten, deprioritized, deleted, or published.
- Class: continuity
- Status: validated
- Description: Behavior-preserving reducer extraction: current post-processing gates must be wrapped in a structured reducer result without intentionally changing which findings are kept, suppressed, rewritten, deprioritized, deleted, or published.
- Why it matters: The current reducer exists only as inline review-handler logic. Extracting it improves observability/testability, but the live daily-use review tool must remain functional during migration.
- Source: user + issue #131
- Primary owning slice: M067/S03
- Supporting slices: M067/S01, M067/S02, M067/S05
- Validation: M067 S03 extracted current post-review gates into `ReviewReducerResult` / `reduceReviewFindings()` with behavior-preserving unit, handler, verifier, S01/S02 regression, typecheck, and whitespace checks passing on 2026-05-09.
- Notes: Reducer output should include kept, suppressed, rewritten, deprioritized, low-confidence, and audit counts/reasons. If uncertain about already-published comments, leave them alone rather than performing destructive cleanup.

### R096 — Shadow-only candidate finding seam: the agent can optionally record typed draft findings through a candidate-finding tool/artifact path, but current inline publication remains the production-visible path during M067.
- Class: core-capability
- Status: validated
- Description: Shadow-only candidate finding seam: the agent can optionally record typed draft findings through a candidate-finding tool/artifact path, but current inline publication remains the production-visible path during M067.
- Why it matters: Specialist lanes and pre-publication verification need a candidate-finding contract, but introducing it must not increase production risk or visible comment volume.
- Source: user
- Primary owning slice: M067/S04
- Supporting slices: M067/S01, M067/S03, M067/S05
- Validation: M067 S04 verification passed: candidate MCP server exposes optional shadow-only mcp__review_candidate_finding__record_candidate_finding, verifier CANDIDATE-MCP-TOOL-CAPTURE passed, and prompt tests confirm it is excluded from GitHub publish tools.
- Notes: Candidate failures must never block current inline publication in M067. Candidate findings become the primary publication source in a later milestone.

### R097 — Production-safe fail-open degradation: plan construction and candidate capture failures must degrade to current review behavior with structured diagnostics; reducer uncertainty must avoid destructive cleanup of already-published comments.
- Class: failure-visibility
- Status: validated
- Description: Production-safe fail-open degradation: plan construction and candidate capture failures must degrade to current review behavior with structured diagnostics; reducer uncertainty must avoid destructive cleanup of already-published comments.
- Why it matters: Kodiai is a live tool used every day. New orchestration contracts must not turn observability or shadow-path failures into review outages.
- Source: user
- Primary owning slice: M067/S01
- Supporting slices: M067/S03, M067/S04, M067/S05
- Validation: M067 S04 verification passed: fail-open contract covered by candidate normalization tests, MCP degraded responses, executor metadata on success/timeout/failure/error branches, handler degraded/missing metadata tests, and verifier CANDIDATE-FAIL-OPEN.
- Notes: Fail open for observability-only surfaces. Fail safe only for unsafe publication/security paths. Prefer no-op over destructive cleanup when uncertain.

### R098 — Per-slice orchestration verifier: every M067 slice must include a verifier that exercises its orchestration surface end-to-end enough to catch wiring drift, not just isolated unit tests.
- Class: quality-attribute
- Status: validated
- Description: Per-slice orchestration verifier: every M067 slice must include a verifier that exercises its orchestration surface end-to-end enough to catch wiring drift, not just isolated unit tests.
- Why it matters: The work crosses handler, config, MCP, Review Details, telemetry, and live review behavior. A verifier is needed to catch integration drift that local unit tests can miss.
- Source: user
- Primary owning slice: M067/S01
- Supporting slices: M067/S02, M067/S03, M067/S04, M067/S05
- Validation: M067 S04 verification passed: scripts/verify-m067-s04.ts, scripts/verify-m067-s04.test.ts, and package script verify:m067:s04 exist and passed in text and JSON modes with schema/MCP/fail-open/plan/prompt/details/sidecar checks.
- Notes: User explicitly requested a verifier to make sure end-to-end works every time.

### R100 — No production-visible behavior expansion by default: M067 must not introduce new specialist lanes, delayed publication, merge-blocking policy, increased visible comment volume, or default concurrency/cost increases.
- Class: constraint
- Status: validated
- Description: No production-visible behavior expansion by default: M067 must not introduce new specialist lanes, delayed publication, merge-blocking policy, increased visible comment volume, or default concurrency/cost increases.
- Why it matters: The architecture is being rewritten while the daily-use review tool remains live. Scope creep into new behavior would increase production risk before the contracts are proven.
- Source: user
- Primary owning slice: M067/S03
- Supporting slices: M067/S04, M067/S05
- Validation: M067 S03 kept production-visible reducer behavior equivalent; M067 S04 kept candidate capture shadow-only; M067/S06/T03 re-verified visible-volume safety during the gated live-proof retry by stopping before any additional GitHub write when publication preflight failed and preserving exact-key artifact counts of reviewComments=0, issueComments=0, reviews=0, total=0 for the captured automatic synchronize key.
- Notes: This preserves the production-safety boundary while foundational contracts are introduced.

### R102 — Specialist reviewer lanes: add selected specialist lanes that feed the common candidate-finding schema, starting with docs/config/runbook truthfulness before correctness/security lanes.
- Class: core-capability
- Status: validated
- Description: Specialist reviewer lanes: add selected specialist lanes that feed the common candidate-finding schema, starting with docs/config/runbook truthfulness before correctness/security lanes.
- Why it matters: Specialists can improve signal only after the plan, reducer, and candidate contracts exist.
- Source: issue #131
- Primary owning slice: M070/S05
- Supporting slices: M070/S01,M070/S02,M070/S03
- Validation: M070/S05 added deterministic production-like normal-review integration proof for docs/config truth specialist lanes through createReviewHandler, shadow aggregate classification, MCP publication gate, Review Details/runtime evidence projection, and M070 verifier evaluation. Fresh closeout evidence: `bun test ./src/handlers/review-candidate-verification-integration.test.ts ./scripts/verify-m070-s05.test.ts ./scripts/verify-m070.test.ts ./scripts/verify-m070-s03.test.ts ./src/specialists/candidate-verification-publication-evidence.test.ts ./src/specialists/candidate-publication-policy.test.ts ./src/specialists/candidate-verification.test.ts ./src/handlers/review-candidate-verification-publication.test.ts ./src/handlers/review-candidate-verification-evidence.test.ts && bun run verify:m070 --json && bun run verify:m070:s05 --json` exited 0 (gsd_exec ec51400c-33f6-4522-a514-725d7b762589). The S05 verifier reported Review Details rows: 8, runtime log rows: 8, MCP evidence rows: 8, aggregateOnly:true, canaryLeakPresent:false, verifierJsonLeakPresent:false, and no issue categories.
- Notes: Mapped for M070 planning: existing docs/config truth specialist lane gains actionable verification/disagreement semantics without adding new lanes.

### R103 — Candidate verification and disagreement handling: future reducer flow should classify candidates as verified, partially verified, unverified, or disproven and resolve duplicate/disagreeing lane outputs before publication.
- Class: quality-attribute
- Status: validated
- Description: Candidate verification and disagreement handling: future reducer flow should classify candidates as verified, partially verified, unverified, or disproven and resolve duplicate/disagreeing lane outputs before publication.
- Why it matters: Specialist outputs need stronger verification than generation before they can safely affect publication policy.
- Source: issue #131
- Primary owning slice: M070/S01
- Supporting slices: M070/S02,M070/S03,M070/S04,M070/S05,M070/S06
- Validation: M070/S01 added a pure candidate verification/conflict classifier and fixture verifier. Fresh closeout evidence: `bun test ./src/specialists/candidate-verification.test.ts` exited 0 (gsd_exec 42c19ab1-e80e-40f0-b24e-d3910b670756); `bun test ./scripts/verify-m070-s01.test.ts && bun run verify:m070:s01 --json` exited 0 with success:true/status_code:m070_s01_ok and checks for taxonomy, conflict, fail-closed, privacy, and package wiring (gsd_exec 51b2952f-4d2e-4e52-b952-c3880aecb8c3).
- Notes: S01 validates the pure classification contract. Publication gating/integration remain owned by later M070 slices.

### R110 — Candidate findings become the preferred pre-publication finding source: review agents record structured draft findings, reducer/coordinator approval decides what can be published, and approved candidates feed publication.
- Class: core-capability
- Status: validated
- Description: Candidate findings become the preferred pre-publication finding source: review agents record structured draft findings, reducer/coordinator approval decides what can be published, and approved candidates feed publication.
- Why it matters: Issue #131 depends on moving from direct agent publishing toward explicit orchestration where findings pass through a controlled reducer/coordinator gate before reaching GitHub.
- Source: user
- Primary owning slice: M068/S01
- Supporting slices: M068/S02,M068/S03,M068/S05
- Validation: M068 live exact-key proof on xbmc/xbmc#28172 used explicit `@kodiai review` delivery `e15d3ee0-4d6b-11f1-9d31-9ef027295c6d` and reviewOutputKey `kodiai-review-output:v1:inst-109141824:xbmc/xbmc:pr-28172:action-mention-review:delivery-e15d3ee0-4d6b-11f1-9d31-9ef027295c6d:head-kodiai-review-validation-20260411`; `verify:m068:candidate-publication --expect-status m068_ok scripts/fixtures/m068-candidate-approved-proof.json` passed with candidatePublished=4 and directFallback=0.
- Notes: Candidate-approved publication is now proven for the target PR; prior direct-fallback evidence remains tracked as blocked evidence only.

### R111 — Approved candidates are adapted into the existing processed-finding/publication shape so current GitHub publication, idempotency, commentability, and secret-scan machinery remains the final writer.
- Class: integration
- Status: validated
- Description: Approved candidates are adapted into the existing processed-finding/publication shape so current GitHub publication, idempotency, commentability, and secret-scan machinery remains the final writer.
- Why it matters: Reusing the existing GitHub writer lowers blast radius and preserves operational behavior while the candidate path is proven.
- Source: user
- Primary owning slice: M068/S02
- Supporting slices: M068/S03,M068/S05
- Validation: M068/S02 verified approved-candidate publication adapter via `bun test src/review-orchestration/review-candidate-publication-adapter.test.ts`, shared MCP/idempotency regression suite, `bun run verify:m068:s01 --json`, `bun run verify:m068:s02 --json`, and `bun run lint` in gsd_exec 24ddedec-2081-42f2-b2e3-6414287cafc7. S02 verifier passed stable checks for adapter mapping, no parallel publisher, idempotency, commentability, secret-scan blocking, bounded evidence, and processed-finding compatibility.
- Notes: M068 explicitly avoids building a parallel candidate GitHub publisher.

### R112 — Direct GitHub publication remains available only as audited fallback during rollout, and every fallback use is distinguishable from candidate-approved publication in logs, Review Details, and verifier evidence.
- Class: failure-visibility
- Status: validated
- Description: Direct GitHub publication remains available only as audited fallback during rollout, and every fallback use is distinguishable from candidate-approved publication in logs, Review Details, and verifier evidence.
- Why it matters: Kodiai is a daily-use review bot, so the new candidate path must not create silent outages, but fallback must not mask whether the new architecture actually worked.
- Source: user
- Primary owning slice: M068/S03
- Supporting slices: M068/S04,M068/S05
- Validation: M068/S03 verified that direct GitHub publication remains audited fallback and is distinguishable from candidate-approved publication via runtime metadata, Review Details, safe config snapshots, logs, and `bun run verify:m068:s03 --json`. Fresh slice closure verification passed in gsd_exec 79936ce7-aeba-44cf-acd8-0edc8d389948, including handler tests and S03 verifier checks that fallback-only output cannot satisfy candidate-approved success.
- Notes: Fallback is operational safety, not M068 acceptance proof.

### R113 — Candidate lifecycle observability reports recorded, rejected, deduped, rewritten, approved, suppressed, published, and fallback counts/reasons without leaking raw prompts, diffs, candidates, or secrets.
- Class: operability
- Status: validated
- Description: Candidate lifecycle observability reports recorded, rejected, deduped, rewritten, approved, suppressed, published, and fallback counts/reasons without leaking raw prompts, diffs, candidates, or secrets.
- Why it matters: Operators need to understand why review output was kept, dropped, or published without exposing unsafe or noisy raw model/tool payloads.
- Source: user
- Primary owning slice: M068/S03
- Supporting slices: M068/S04,M068/S05
- Validation: M068/S03 verified bounded candidate lifecycle observability for recorded/rejected/deduped/rewritten/approved/suppressed/published/fallback counts and reasons without raw prompts, diffs, candidates, evidence payloads, or secrets. Fresh slice closure verification passed in gsd_exec 79936ce7-aeba-44cf-acd8-0edc8d389948; `bun run verify:m068:s03 --json` passed and reports redaction leak count 0 plus bounded Review Details/snapshot checks.
- Notes: Public Review Details stays compact; deeper state belongs in logs, snapshots, verifier JSON, and bounded smoke artifacts.

### R114 — M068 must produce a live exact-key proof on xbmc/xbmc#28172 where Review Details are published and show candidate-approved publication evidence.
- Class: launchability
- Status: validated
- Description: M068 must produce a live exact-key proof on xbmc/xbmc#28172 where Review Details are published and show candidate-approved publication evidence.
- Why it matters: The architecture changes the review publication contract and must be proven against the real target PR, not only fixtures.
- Source: user
- Primary owning slice: M068/S05
- Supporting slices: M068/S01,M068/S02,M068/S03,M068/S04
- Validation: Accepted live exact-key proof on xbmc/xbmc#28172: trigger `https://github.com/xbmc/xbmc/pull/28172#issuecomment-4423917332`, Review Details `https://github.com/xbmc/xbmc/pull/28172#issuecomment-4423943241`, four inline candidate comments, delivery `e15d3ee0-4d6b-11f1-9d31-9ef027295c6d`, verifier status `m068_ok`.
- Notes: Validated by bounded fixture `scripts/fixtures/m068-candidate-approved-proof.json` and smoke note `docs/smoke/m068-candidate-publication.md`.

### R115 — Fallback-only publication cannot satisfy M068 success; the final acceptance proof must show candidate-approved publication, while fallback-only runs are reported as blocked or partial.
- Class: constraint
- Status: validated
- Description: Fallback-only publication cannot satisfy M068 success; the final acceptance proof must show candidate-approved publication, while fallback-only runs are reported as blocked or partial.
- Why it matters: Without this constraint, the milestone could pass by exercising the old direct-publish architecture and fail to advance issue #131.
- Source: user
- Primary owning slice: M068/S05
- Supporting slices: M068/S03,M068/S04
- Validation: Both sides of the fallback contract are proven: `scripts/fixtures/m068-candidate-approved-proof.json` passes only as `m068_ok`, while `scripts/fixtures/m068-direct-fallback-proof.json` passes only with `--expect-status m068_direct_fallback` and remains rejected as success.
- Notes: The verifier now distinguishes one Review Details artifact from expected inline candidate comments so candidate-approved publication is not misclassified as duplicate Review Details evidence.

### R116 — M068 must not unexpectedly increase visible GitHub comment volume while moving publication behind candidate approval.
- Class: constraint
- Status: validated
- Description: M068 must not unexpectedly increase visible GitHub comment volume while moving publication behind candidate approval.
- Why it matters: The candidate-before-publication path should reduce noise and improve traceability, not create duplicate or expanded visible comments.
- Source: inferred
- Primary owning slice: M068/S05
- Supporting slices: M068/S02,M068/S03
- Validation: The accepted live proof has one bounded Review Details issue comment plus four inline candidate review comments, directFallback=0, and no issue-comment fallback. `verify:m068:candidate-publication --expect-status m068_ok scripts/fixtures/m068-candidate-approved-proof.json` passed.
- Notes: Visible output is bounded and explicit: one Review Details artifact plus candidate-approved inline publication artifacts for the exact key.

### R117 — Specialist reviewer lanes are deferred until the candidate-approved publication contract is proven.
- Class: core-capability
- Status: validated
- Description: Specialist reviewer lanes are deferred until the candidate-approved publication contract is proven.
- Why it matters: Specialists need a safe candidate/reducer publication path before multiple lanes can publish without noise or contradiction.
- Source: user
- Primary owning slice: M070/S02
- Supporting slices: M070/S01,M070/S05
- Validation: M070/S02 wired docs/config truth candidate verification into the normal review publication path and proved safe publication gating with fresh closeout evidence: policy unit tests `bun test ./src/specialists/candidate-publication-policy.test.ts` exit 0 (gsd_exec 3ec5b9dd-2c26-49dd-88c1-f3d5878b6e75); MCP publication gate tests `bun test ./src/execution/mcp/inline-review-server.test.ts ./src/execution/mcp/index.test.ts` exit 0 (gsd_exec 3f96a8f3-8e0e-489f-ac8d-1f6d103f0b9d); handler fixture `bun test ./src/handlers/review-candidate-verification-publication.test.ts` exit 0 (gsd_exec 797e7cb5-5c4d-44af-a9d0-9af072cedc92); closeout regression `bun test ./src/specialists/candidate-verification.test.ts ./scripts/verify-m070-s01.test.ts && bun run verify:m070:s01 --json` exit 0 with success:true/status_code:m070_s01_ok (gsd_exec 29c8874b-0a4b-45a1-bf46-605f99fac500).
- Notes: S02 proves a safe candidate-approved publication contract for the first specialist lane: verified and undisputed safe partial candidates may reach the existing inline adapter, while disputed, unverified, disproven, duplicate, malformed, stale, oversized, missing, and unclassifiable candidates are denied before GitHub-visible publication and cannot satisfy direct fallback.

### R118 — Candidate disagreement and multi-lane conflict handling are deferred until at least one specialist lane exists.
- Class: core-capability
- Status: validated
- Description: Candidate disagreement and multi-lane conflict handling are deferred until at least one specialist lane exists.
- Why it matters: Conflict policy is important, but premature before M068 proves candidate-approved publication and M069 introduces specialist lanes.
- Source: inferred
- Primary owning slice: M070/S04
- Supporting slices: M070/S01,M070/S02,M070/S03,M070/S05,M070/S06
- Validation: M070/S06 closeout verified candidate verification/disagreement handling across classifier, publication policy, Review Details/log projection, production-like integration, and exact-key/live-or-blocked verifier surfaces. Fresh evidence: gsd_exec 5b6f8886-8ae9-43a6-bf72-9e8f57c7a096 ran 86 tests across 10 files with 0 failures, `verify:m070` success:true status_code `m070_fixture_contract_ok`, `verify:m070:s05` success:true status_code `m070_s05_ok`, and `verify:m070:s06 --allow-blocked` success:false status_code `m070_s06_missing_exact_key_blocked` with bounded no-key blocked evidence rather than false success.
- Notes: Live exact-key credentials/keys were unavailable during autonomous closeout, so S06 truthfully proved the production-like verifier and no-key blocked path rather than accepted live candidate-approved success.

### R125 — Issue #131 completion matrix must be evidence-backed and fail closed for implied, memory-only, or unwired evidence.
- Class: failure-visibility
- Status: validated
- Description: Issue #131 completion matrix must be evidence-backed and fail closed for implied, memory-only, or unwired evidence.
- Why it matters: The project needs a truthful answer to whether issue #131 is complete; weak evidence must not green the closure path.
- Source: user
- Primary owning slice: M071/S01
- Supporting slices: M071/S05
- Validation: M071/S05 closure proof passed: `bun test ./src/review-plan/review-plan.test.ts ./src/lib/partial-review-formatter.test.ts ./src/execution/config.test.ts ./src/review-graph/graph-validation-status.test.ts ./src/handlers/review.test.ts ./src/issue-131/evidence-matrix.test.ts ./scripts/verify-m071.test.ts` exited 0 with 335 tests, 0 failures, 1656 assertions; `bun run verify:m071 -- --json` exited 0 with status_code `m071_issue_131_matrix_ok`, all six checks passing, safe report shape, complete=6, partial=0, missing=0, deferred=4, package wiring present/matches, and no issues.
- Notes: Final M071 foundation closure remains scoped to source-evidence proof; larger issue #131 implementation gaps are explicitly deferred to M072-M075.

### R126 — Normal PR review runs must construct a typed ReviewPlan before publication-side effects, including route, scope, context sources, gates, budgets, publish policy, and stable hash.
- Class: core-capability
- Status: validated
- Description: Normal PR review runs must construct a typed ReviewPlan before publication-side effects, including route, scope, context sources, gates, budgets, publish policy, and stable hash.
- Why it matters: Issue #131's repo-grounded plan starts by making Kodiai explain what it intended to do before it reviews or publishes.
- Source: user/inferred
- Primary owning slice: M071/S02
- Supporting slices: M071/S03,M071/S05
- Validation: M071/S02 aggregate proof passed: `bun test src/review-plan/review-plan.test.ts src/handlers/review.test.ts src/issue-131/evidence-matrix.test.ts scripts/verify-m071.test.ts && bun run verify:m071 -- --json` exited 0 with 198 tests passing, `m071_issue_131_matrix_ok`, and verifier rows `review-plan-contract` plus `normal-handler-plan-construction` complete. The normal PR review handler constructs and logs a safe typed ReviewPlan before publication-side effects while fail-opening on diagnostics failures.
- Notes: Validated by S02 closeout. S03/S04/S05 retain separate active requirements for Review Details summary, graph-validation config/status, and final closure matrix.

### R127 — Review Details must expose a compact, safe review-plan summary while detailed plan evidence remains in logs and verifier output.
- Class: operability
- Status: validated
- Description: Review Details must expose a compact, safe review-plan summary while detailed plan evidence remains in logs and verifier output.
- Why it matters: Operators need visible orchestration truth without noisy or unsafe GitHub comments.
- Source: user
- Primary owning slice: M071/S03
- Supporting slices: M071/S02,M071/S05
- Validation: M071/S03 aggregate proof passed: `bun test src/review-plan/review-plan.test.ts src/lib/partial-review-formatter.test.ts src/handlers/review.test.ts src/issue-131/evidence-matrix.test.ts scripts/verify-m071.test.ts && bun run verify:m071 -- --json` exited 0 with 223 tests passing, 0 failures, 1223 assertions, verifier status `m071_issue_131_matrix_ok`, and `review-details-plan-summary` complete with source evidence in `src/review-plan/review-plan.ts`, `src/lib/review-utils.ts`, and `src/handlers/review.ts` while graph/deferred rows remain truthfully partial/deferred.
- Notes: Must not expose raw prompts, raw model output, candidate payloads, secrets, or long identifiers that hide safety fields.

### R128 — review.graphValidation.enabled must be typed, preserved by config parsing, documented, and surfaced truthfully as enabled, applied, skipped, or unavailable.
- Class: quality-attribute
- Status: validated
- Description: review.graphValidation.enabled must be typed, preserved by config parsing, documented, and surfaced truthfully as enabled, applied, skipped, or unavailable.
- Why it matters: Config/prompt/tool drift is one of the failure modes issue #131 explicitly wants the orchestration layer to prevent.
- Source: inferred
- Primary owning slice: M071/S04
- Supporting slices: M071/S02,M071/S05
- Validation: S04 closeout verified typed review.graphValidation config parsing/documentation and truthful ReviewPlan/runtime status surfacing. Evidence: `bun test src/execution/config.test.ts src/review-graph/graph-validation-status.test.ts src/review-plan/review-plan.test.ts src/handlers/review.test.ts src/issue-131/evidence-matrix.test.ts scripts/verify-m071.test.ts` passed (314 tests, 1582 expects), and `bun run verify:m071 -- --json` reported complete=6 partial=0 missing=0 deferred=4 with no issues.
- Notes: Validated by M071/S04. S05 still owns final M071 closure/deferred ownership matrix for larger issue #131 gaps.

### R129 — M071 verifier must distinguish complete, partial, missing, and deferred issue #131 acceptance items with file-path evidence and explicit later milestone ownership.
- Class: operability
- Status: validated
- Description: M071 verifier must distinguish complete, partial, missing, and deferred issue #131 acceptance items with file-path evidence and explicit later milestone ownership.
- Why it matters: The final M071 answer must be code-complete for the foundation while preserving an honest path for remaining issue #131 work.
- Source: user
- Primary owning slice: M071/S05
- Supporting slices: M071/S01,M071/S02,M071/S03,M071/S04
- Validation: M071/S05 verified `verify:m071 -- --json` distinguishes complete, partial, missing, and deferred rows with repo-relative evidence paths and exact deferred ownership. The final report has six complete foundation rows, zero partial rows, zero missing rows, four deferred rows, and owner metadata for M072/S01 candidate publication bridge, M073/S01 reducer extraction, M074/S01 specialist lane proof, and M075/S01 metrics/tier closure.
- Notes: Negative test coverage in `src/issue-131/evidence-matrix.test.ts` and `scripts/verify-m071.test.ts` covers weak package wiring, missing S02/S03/S04 evidence, unsafe report fields, missing concrete evidence paths, and malformed/degraded deferred ownership.

### R130 — Candidate findings must be captured before public GitHub publication and passed through an explicit reducer contract.
- Class: core-capability
- Status: validated
- Description: Candidate findings must be captured before public GitHub publication and passed through an explicit reducer contract.
- Why it matters: Issue #131's repo-grounded plan requires moving verification and utility scoring before visible publication rather than recovering findings from already-published comments.
- Source: user
- Primary owning slice: M072/S01
- Supporting slices: M072/S02,M072/S03,M072/S04,M073,M074
- Validation: M072/S04 closeout ran `bun test scripts/verify-m072.test.ts` (13 pass), `bun run verify:m072 -- --json` (success with passing bridge/package/deferred-owner/report-safety checks), and the targeted S02/S03 integration regression suite (163 pass), proving candidate findings are captured before public GitHub publication and exposed through an explicit safe reducer handoff contract.
- Notes: Validated by source-evidence verifier and integration tests only; live GitHub publication, reducer-approved publication, rollout metrics, and issue #131 final doctrine remain deferred to later milestones.

### R143 — M073 completion requires live or production-like before/after evidence showing reduced token usage and acceptable latency without losing known important review behavior.
- Class: launchability
- Status: validated
- Description: M073 completion requires live or production-like before/after evidence showing reduced token usage and acceptable latency without losing known important review behavior.
- Why it matters: The milestone should not end with internal wiring alone; it must prove the budgeted pipeline actually helps on a realistic review path.
- Source: user
- Primary owning slice: M073/S06
- Supporting slices: M073/S01,M073/S02,M073/S03,M073/S04,M073/S05
- Validation: M073/S06 verifier passed via `bun run verify:m073:s06 --json` (gsd_exec 97ce5b8e-b010-4fb2-9c72-421012bb3c8b): statusCode `m073_s06_ok`, 5/5 upstream evidence rows passed, runtime tokens reduced 21,200 -> 16,200 (23.58%), live duration 138,000 ms under 210,000 ms ceiling, bounded visible projections present, rollback controls present, negative cases covered, and issues empty.
- Notes: Validation is production-like/offline; no live GitHub write was performed because future live PR review writes require explicit user confirmation.

## Deferred

### R017 — Deep restructuring of review.ts and mention.ts into smaller, composable handler modules
- Class: quality-attribute
- Status: deferred
- Description: Deep restructuring of review.ts and mention.ts into smaller, composable handler modules
- Why it matters: Would improve maintainability significantly
- Source: inferred
- Primary owning slice: none
- Supporting slices: none
- Validation: unmapped
- Notes: Deferred — high-risk refactor that warrants its own milestone with comprehensive testing

### R018 — Tooling to detect unused exports, unreachable code, and orphaned modules
- Class: quality-attribute
- Status: deferred
- Description: Tooling to detect unused exports, unreachable code, and orphaned modules
- Why it matters: Manual audit found some; automated tooling would catch ongoing drift
- Source: inferred
- Primary owning slice: none
- Supporting slices: none
- Validation: unmapped
- Notes: Deferred — investigate ts-prune or knip in a future milestone

### R060 — Kodiai must validate issue mentions against repository issue templates and append concise triage guidance or label recommendations on the mention lane without blocking the primary response.
- Class: functional
- Status: deferred
- Description: Kodiai must validate issue mentions against repository issue templates and append concise triage guidance or label recommendations on the mention lane without blocking the primary response.
- Why it matters: Issue mentions should help reporters supply missing structured information while preserving the normal mention-response path.
- Source: M021
- Primary owning slice: M021/S03
- Supporting slices: none
- Validation: M021/S03 summary plus src/triage/triage-agent.ts, src/handlers/mention.ts, and src/execution/mention-prompt.ts prove template diffing, needs-info label recommendation, mention-prompt triage context injection, and fail-open cooldown-gated mention integration with passing triage/config/mention/MCP tests.
- Notes: Duplicate of R059 created during S04/T01 traceability backfill retry after an initial render omission. R059 is the canonical M021/S03 requirement record; ignore R060 for milestone validation and future ownership mapping.

### R086 — Normal review triggers may include formatter suggestions automatically only after repo config explicitly opts into automatic formatter suggestions.
- Class: functional
- Status: deferred
- Description: Normal review triggers may include formatter suggestions automatically only after repo config explicitly opts into automatic formatter suggestions.
- Why it matters: Automatic formatting suggestions may be useful later, but the first release should prove explicit request behavior without changing default reviews.
- Source: user
- Primary owning slice: later
- Supporting slices: M053/S01,M053/S04
- Validation: Unmapped until a later milestone or explicit repo opt-in exercises automatic behavior.
- Notes: The configuration path should be present in M053, but automatic execution can remain disabled until explicitly configured.

### R087 — Multiple formatter adapters beyond the first configured-command seam are deferred.
- Class: integration
- Status: deferred
- Description: Multiple formatter adapters beyond the first configured-command seam are deferred.
- Why it matters: The user wants future support, but first value comes from proving the generic command seam and clang-format-style path.
- Source: inferred
- Primary owning slice: later
- Supporting slices: M053/S01,M053/S02
- Validation: Unmapped; future formatter adapters can reuse the command/diff parser seam.
- Notes: M053 should create a seam for future formatters but does not need to ship a broad formatter adapter library.

### R088 — A dry-run preview workflow for formatter suggestions is deferred.
- Class: admin/support
- Status: deferred
- Description: A dry-run preview workflow for formatter suggestions is deferred.
- Why it matters: Preview adds ceremony and an extra output mode that was not requested for the first version.
- Source: inferred
- Primary owning slice: later
- Supporting slices: none
- Validation: Unmapped.
- Notes: The user chose direct publish on request; preview mode may be useful later if maintainers want extra review before posting suggestions.

### R101 — Candidate findings become the publication source: future review flow should publish reducer-approved candidate findings instead of recovering findings from already-published GitHub comments.
- Class: core-capability
- Status: deferred
- Description: Candidate findings become the publication source: future review flow should publish reducer-approved candidate findings instead of recovering findings from already-published GitHub comments.
- Why it matters: Verification, dedupe, confidence filtering, and prioritization should eventually happen before GitHub-visible publication.
- Source: issue #131
- Primary owning slice: M068 provisional
- Supporting slices: none
- Validation: unmapped
- Notes: Deferred to M068. M067 only creates a shadow-capable seam.

### R104 — Repo doctrine contracts: repositories should be able to declare review invariants in `.kodiai.yml`, such as API compatibility, migration requirements, performance budgets, forbidden patterns, tracing requirements, feature-flag rules, and docs-update requirements.
- Class: integration
- Status: deferred
- Description: Repo doctrine contracts: repositories should be able to declare review invariants in `.kodiai.yml`, such as API compatibility, migration requirements, performance budgets, forbidden patterns, tracing requirements, feature-flag rules, and docs-update requirements.
- Why it matters: Review memory and generated rules should become auditable contracts rather than only prompt hints.
- Source: issue #131
- Primary owning slice: M074/S01
- Supporting slices: M071/S06
- Validation: unmapped
- Notes: Deferred to M074/S01 for repo-doctrine/specialist config contract implementation and proof. M071 supplies foundation-only ReviewPlan/verifier seams and a source-owned handoff contract in `src/issue-131/deferred-handoff.ts`; it does not implement or validate repo doctrine contracts.

### R119 — Provider/model failback and circuit-breaker policy are deferred outside M068.
- Class: failure-visibility
- Status: deferred
- Description: Provider/model failback and circuit-breaker policy are deferred outside M068.
- Why it matters: Provider failback matters for reliability but would broaden M068 beyond the candidate publication contract.
- Source: research
- Primary owning slice: none
- Supporting slices: none
- Validation: unmapped
- Notes: Tracked from issue #131 candidate improvements; not required for candidate-before-publication proof.

### R120 — Long-review progress or heartbeat surfaces are deferred outside M068.
- Class: failure-visibility
- Status: deferred
- Description: Long-review progress or heartbeat surfaces are deferred outside M068.
- Why it matters: Heartbeat/progress is useful for long reviews but not necessary to prove candidate-approved publication.
- Source: research
- Primary owning slice: none
- Supporting slices: none
- Validation: unmapped
- Notes: Tracked from issue #131 candidate improvements; can build on phase timing and Review Details later.

### R134 — Default-on multi-specialist review tiers for every PR are deferred until shadow evidence and rollout metrics prove signal, cost, and safety.
- Class: constraint
- Status: deferred
- Description: Default-on multi-specialist review tiers for every PR are deferred until shadow evidence and rollout metrics prove signal, cost, and safety.
- Why it matters: Adding specialists everywhere before proof would recreate the noise/cost risks issue #131 is trying to control.
- Source: inferred
- Primary owning slice: none
- Supporting slices: none
- Validation: unmapped
- Notes: Later than M075 unless metrics justify enabling broader tiers.

### R135 — Public publication of raw specialist outputs, raw candidate bodies, raw prompts, raw model payloads, or secret-bearing evidence is deferred and not part of the issue #131 closure path.
- Class: constraint
- Status: deferred
- Description: Public publication of raw specialist outputs, raw candidate bodies, raw prompts, raw model payloads, or secret-bearing evidence is deferred and not part of the issue #131 closure path.
- Why it matters: Raw evidence can leak sensitive context, overwhelm operators, and make compact safety fields disappear behind long payloads.
- Source: inferred
- Primary owning slice: none
- Supporting slices: none
- Validation: unmapped
- Notes: Public surfaces should use compact aggregate evidence and reducer-approved findings only.

### R144 — Broad review-product redesign with new default modes and publication semantics is deferred unless it directly serves the token-first budgeted pipeline.
- Class: constraint
- Status: deferred
- Description: Broad review-product redesign with new default modes and publication semantics is deferred unless it directly serves the token-first budgeted pipeline.
- Why it matters: Keeping M073 focused avoids turning a performance/refactor milestone into a broad product rewrite.
- Source: inferred
- Primary owning slice: none
- Supporting slices: none
- Validation: unmapped
- Notes: M073 may make bounded visible behavior changes for cost/latency, but does not own an open-ended review-product redesign.

### R145 — Deep addon-check performance redesign outside the PR review token path is deferred unless execution evidence shows it is part of the same review-efficiency bottleneck.
- Class: constraint
- Status: deferred
- Description: Deep addon-check performance redesign outside the PR review token path is deferred unless execution evidence shows it is part of the same review-efficiency bottleneck.
- Why it matters: Addon-check timeout work may be valuable, but it should not distract from the user-requested review token/caching refactor.
- Source: inferred
- Primary owning slice: none
- Supporting slices: none
- Validation: unmapped
- Notes: The recent addon-check budget increase motivated the discussion, but M073's main scope is review token/caching behavior.

## Out of Scope

### R089 — Kodiai must not depend on or consume `jenkins4kodi` formatting diff artifacts for this capability.
- Class: anti-feature
- Status: out-of-scope
- Description: Kodiai must not depend on or consume `jenkins4kodi` formatting diff artifacts for this capability.
- Why it matters: The user explicitly wants Kodiai to produce formatting suggestions independently of Jenkins.
- Source: user
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: The Jenkins comment on xbmc/xbmc#28259 is example evidence only.

### R090 — Kodiai must not create separate formatting-fix pull requests as part of formatter suggestion handling.
- Class: anti-feature
- Status: out-of-scope
- Description: Kodiai must not create separate formatting-fix pull requests as part of formatter suggestion handling.
- Why it matters: The user explicitly wants same-PR committable suggestions, not another PR.
- Source: user
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: Suggestions stay on the existing PR.

### R091 — Kodiai must not push formatter commits directly to contributor branches as part of this feature.
- Class: anti-feature
- Status: out-of-scope
- Description: Kodiai must not push formatter commits directly to contributor branches as part of this feature.
- Why it matters: Same-PR suggestions preserve human control and avoid changing contributor branches directly.
- Source: user
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: Humans apply suggestions through GitHub if desired.

### R106 — Seven concurrent reviewers by default are explicitly out of scope for this phase of Kodiai's review orchestration evolution.
- Class: anti-feature
- Status: out-of-scope
- Description: Seven concurrent reviewers by default are explicitly out of scope for this phase of Kodiai's review orchestration evolution.
- Why it matters: Copying Cloudflare's seven-agent shape would add cost/concurrency/noise before Kodiai proves the orchestration contracts.
- Source: user + issue #131
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: M067 starts with explicit contracts. Later lanes must be risk-triggered and measured before broad rollout.

### R107 — Merge blocking from the new orchestration architecture is out of scope until signal/noise and verification contracts are proven.
- Class: anti-feature
- Status: out-of-scope
- Description: Merge blocking from the new orchestration architecture is out of scope until signal/noise and verification contracts are proven.
- Why it matters: A new architecture should not gain blocking authority before production metrics prove better signal.
- Source: user + issue #131
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: Existing review comments/approvals continue, but M067 must not add new auto-blocking behavior.

### R108 — Increased visible comment volume in M067 is out of scope.
- Class: anti-feature
- Status: out-of-scope
- Description: Increased visible comment volume in M067 is out of scope.
- Why it matters: The rewrite should improve observability without making PRs noisier.
- Source: user
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: Candidate findings are shadow-only/optional. Review Details additions must stay compact.

### R109 — Delayed-publication migration in M067 is out of scope; current inline publication remains the production-visible path during this milestone.
- Class: anti-feature
- Status: out-of-scope
- Description: Delayed-publication migration in M067 is out of scope; current inline publication remains the production-visible path during this milestone.
- Why it matters: Moving publication later is a behavior change and should happen only after the plan/reducer/candidate contracts are proven.
- Source: user
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: M068 owns moving to reducer-approved candidate publication.

### R121 — M068 must not introduce seven concurrent reviewers by default.
- Class: anti-feature
- Status: out-of-scope
- Description: M068 must not introduce seven concurrent reviewers by default.
- Why it matters: The issue explicitly warns against copying a broad multi-agent setup before signal/noise and cost controls are proven.
- Source: research
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: Specialist lanes remain future, targeted, and risk/path-triggered.

### R122 — M068 must not block merges based on candidate/reducer output.
- Class: anti-feature
- Status: out-of-scope
- Description: M068 must not block merges based on candidate/reducer output.
- Why it matters: Merge blocking requires a proven signal/noise contract and explicit product decision beyond this milestone.
- Source: research
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: Candidate/reducer output may inform review comments only; merge-blocking policy is out of scope.

### R123 — M068 must not hard-remove direct GitHub publish tools; direct publishing remains available as audited fallback during rollout.
- Class: constraint
- Status: out-of-scope
- Description: M068 must not hard-remove direct GitHub publish tools; direct publishing remains available as audited fallback during rollout.
- Why it matters: Hard removal increases production outage risk before the candidate path has live proof.
- Source: user
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: A later milestone may remove direct publishing after candidate-approved publication is proven.

### R124 — M068 must not build a separate candidate GitHub publisher parallel to the existing publication machinery.
- Class: anti-feature
- Status: out-of-scope
- Description: M068 must not build a separate candidate GitHub publisher parallel to the existing publication machinery.
- Why it matters: A parallel publisher would duplicate idempotency, commentability, and secret-scan behavior and increase regression risk.
- Source: user
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: Approved candidates should adapt into the existing processed-finding/publication shape instead.

### R136 — Do not copy Cloudflare's seven-reviewer architecture wholesale for Kodiai.
- Class: anti-feature
- Status: out-of-scope
- Description: Do not copy Cloudflare's seven-reviewer architecture wholesale for Kodiai.
- Why it matters: Kodiai needs a staged, evidence-backed architecture that fits its current review handler, reducer, MCP, Review Details, and telemetry surfaces.
- Source: issue #131
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: Issue #131 explicitly says to start small and the later repo-grounded comment narrows the path to Kodiai's existing orchestration seams.

### R137 — Do not treat GitHub issue commenting, issue closure, memory references, or prose summaries as proof of issue #131 completion without code and verifier evidence.
- Class: anti-feature
- Status: out-of-scope
- Description: Do not treat GitHub issue commenting, issue closure, memory references, or prose summaries as proof of issue #131 completion without code and verifier evidence.
- Why it matters: The user asked for code-complete based on the issue, not ceremony that claims completion without implementation proof.
- Source: user
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: No outward GitHub write action is part of the planning output; future GitHub actions require explicit confirmation.

### R146 — Do not solve review timeout pressure by only increasing timeout or headroom budgets.
- Class: anti-feature
- Status: out-of-scope
- Description: Do not solve review timeout pressure by only increasing timeout or headroom budgets.
- Why it matters: The user explicitly identified this as the thing they do not like about the prior fix.
- Source: user
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: Timeout/headroom changes may remain as fallback behavior, but cannot be the main M073 solution or proof.

### R147 — Do not weaken publication, candidate-verification, reducer, or secret-safety gates to save tokens.
- Class: compliance/security
- Status: out-of-scope
- Description: Do not weaken publication, candidate-verification, reducer, or secret-safety gates to save tokens.
- Why it matters: A cheaper review is unacceptable if it publishes unsafe output, leaks raw evidence, or bypasses verification gates.
- Source: inferred
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: Cost optimization must fail open or bypass safely rather than bypassing security and correctness controls.

## Traceability

| ID | Class | Status | Primary owner | Supporting | Proof |
|---|---|---|---|---|---|
| R001 | quality-attribute | validated | M026/S02 | none | addonRepos Zod field in AppConfig (comma-split transform, configurable via ADDON_REPOS env var); handler gates on config.addonRepos.includes(repo); M030/S01 test 'non-addon repo returns without calling listFiles' passes. |
| R002 | quality-attribute | validated | M026/S01 | none | runAddonChecker in src/lib/addon-checker-runner.ts spawns kodi-addon-checker --branch &lt;branch&gt; &lt;addonDir&gt; subprocess; 19 runner tests pass including 'passes the branch and addonDir to the subprocess'. |
| R003 | operability | validated | M026/S01 | none | resolveCheckerBranch maps PR base branch against ValidKodiVersions (10 known names); test 'covers all 10 expected version names' passes; unknown branch returns null → handler warns and skips. |
| R004 | quality-attribute | validated | M026/S01 | none | parseCheckerOutput strips ANSI codes and matches ^(ERROR|WARN|INFO): (.+) per line; non-matching lines dropped silently; 5 parseCheckerOutput tests pass including ANSI and mixed-line cases. |
| R005 | quality-attribute | validated | M026/S01 | none | formatAddonCheckComment renders HTML marker + heading + ERROR/WARN table (INFO filtered) + summary line; upsertAddonCheckComment posts or updates; tests 'posts comment when findings exist' and 'updates existing comment on second push' pass. |
| R006 | quality-attribute | validated | M026/S02 | none | addonRepos is Zod-validated with comma-split transform; defaults to xbmc/repo-plugins,xbmc/repo-scripts,xbmc/repo-scrapers; overrideable via ADDON_REPOS env var. |
| R007 | quality-attribute | validated | M026/S05 | M026/S03, M026/S04 | Dockerfile updated in M030/S03/T02: apt-get install -y python3 python3-pip followed by pip3 install --no-cache-dir kodi-addon-checker in the same RUN layer. |
| R008 | quality-attribute | validated | M026/S03 | none | Handler iterates all deduped addonIds calling runAddonChecker per addon; test 'runner called per addon with correct addonDir and branch' passes; findings from all addons aggregated before upsert. |
| R009 | quality-attribute | validated | M026/S03 | none | buildAddonCheckMarker provides deterministic HTML marker; upsertAddonCheckComment scans existing comments for marker then calls updateComment (not createComment) if found; test 'updates existing comment on second push (upsert path)' passes. |
| R010 | quality-attribute | validated | M026/S04 | none | Early return before any workspace or subprocess work when !config.addonRepos.includes(repo); test 'non-addon repo returns without calling listFiles' passes; existing review pipeline unaffected. |
| R011 | operability | validated | M026/S03 | none | S03 — docs/deployment.md updated with cross-links to architecture.md, configuration.md, GRACEFUL-RESTART-RUNBOOK.md; docs/README.md created indexing all 17 docs files across 5 sections including 6 runbooks |
| R012 | quality-attribute | validated | M026/S05 | none | S05 — CONTRIBUTING.md created with prerequisites, dev setup, testing (including describe.skipIf pattern), code style, PR process, and architecture.md reference |
| R013 | quality-attribute | validated | M026/S05 | none | S05 — v0.25 entry added with 7 Wiki Content Updates deliverables sourced from PROJECT.md |
| R014 | quality-attribute | validated | M026/S02 | none | S02 — review-utils.ts (451 lines, 19 functions) and mention-utils.ts (106 lines, 2 functions) extracted; review.ts reduced by 386 lines, mention.ts by 90 lines; all tests pass |
| R015 | quality-attribute | validated | M026/S02 | none | S02 — bun test → 2181 pass, 45 skip, 0 fail; DB tests use describe.skipIf(!TEST_DATABASE_URL) |
| R016 | quality-attribute | validated | M026/S01 | none | S01 — git ls-files .planning/ returns 0; README .planning/ references replaced with CHANGELOG.md |
| R017 | quality-attribute | deferred | none | none | unmapped |
| R018 | quality-attribute | deferred | none | none | unmapped |
| R019 | operability | validated | M027 | none | M027/S01 — `bun run audit:embeddings --json` emits deterministic six-corpus integrity/model-status JSON from a read-only transaction and truthfully reports live failures instead of hiding them; M027/S04 — `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json` closed the milestone with `M027-S04-FULL-AUDIT` passing against the preserved six-corpus `s01.audit` envelope, including the audited-only `issue_comments` boundary. |
| R020 | operability | validated | M027 | none | M027/S03 — `bun run repair:embeddings -- --corpus review_comments --json`, `bun run repair:embeddings -- --corpus review_comments --status --json`, `bun run repair:embeddings -- --corpus review_comments --resume --json`, `bun run repair:embeddings -- --corpus issues --dry-run --json`, and `bun run verify:m027:s03 -- --corpus review_comments --json` proved resumable live repair for the degraded corpus plus truthful no-op handling for another corpus through the shared contract; M027/S04 — `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json` closed the milestone with `M027-S04-NON-WIKI-REPAIR-STATE=repair_completed`, interpreting the idempotent `review_comments` rerun truthfully from durable status evidence rather than requiring fresh mutations. |
| R021 | correctness | validated | M027 | none | M027/S01 — `bun run verify:retriever --repo xbmc/xbmc --query "json-rpc subtitle delay" --json` exercises the real `createRetriever(...).retrieve(...)` path, distinguishes query-embedding failure from no-hit states, and returns attributed live hits; M027/S04 — `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json` closed the milestone with `M027-S04-RETRIEVER=retrieval_hits`, preserving `s01.retriever.not_in_retriever=["issue_comments"]` so end-to-end proof stays truthful about live scope. |
| R022 | reliability | validated | M027 | none | M027/S02/S03 — wiki proof (`bun run verify:m027:s02 -- --page-title "JSON-RPC API/v8" --json`) and non-wiki proof (`bun run repair:embeddings -- --corpus review_comments --json` plus `bun run verify:m027:s03 -- --corpus review_comments --json`) both completed representative live bounded repairs without timeout-class failure while preserving resume/status evidence; M027/S04 — `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json` closed the milestone with both repair-state checks passing from durable status-backed evidence (`JSON-RPC API/v8` still `repair_completed`; `review_comments` healthy idempotent rerun still backed by `repair_completed`). |
| R023 | correctness | validated | M027 | none | M027/S01 — `bun run audit:embeddings --json` locks wiki=`voyage-context-3` vs non-wiki=`voyage-code-3`, reports actual model sets per corpus, and surfaces live wiki model mismatch counts; M027/S04 — `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json` closed the milestone from the preserved all-green `s01.audit` envelope, confirming `wiki_pages` remained on `voyage-context-3` while the other audited corpora, including the audited-only `issue_comments`, remained on the non-wiki model boundary. |
| R024 | quality-attribute | validated | M027 | none | M027/S01/S02/S03 — contract tests plus `audit:embeddings`, `verify:retriever`, `verify:m027:s01`, `bun test ./scripts/verify-m027-s02.test.ts`, `bun test ./scripts/verify-m027-s03.test.ts`, `bun run verify:m027:s02 -- --page-title "JSON-RPC API/v8" --json`, and `bun run verify:m027:s03 -- --corpus review_comments --json` now cover audit drift, live retriever truth, wiki repair proof, and non-wiki repair/no-op proof envelopes; M027/S04 — `bun test ./scripts/verify-m027-s04.test.ts` plus `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json` close the milestone with a repeatable machine-checkable final proof that preserves nested S01/S02/S03 evidence and stable milestone-level check IDs. |
| R025 | correctness | validated | M028/S01 | M028/S03, M028/S04 | S01–S04 — Modification-only artifact contract proven end-to-end: WikiUpdateGroup type carries mode/scope (section|page), formatPageComment emits replacement text only, formatSummaryTable emits Wiki Modification Artifacts title and Modifications posted stat. bun run verify:m028:s04 --json overallPassed:true with NO-WHY-IN-RENDER, NO-WHY-IN-SUMMARY, DRY-RUN-CLEAN all passing. 104 rows in DB with real comment IDs confirming full pipeline is modification-first. |
| R026 | correctness | validated | M028/S03 | none | S03 — Live publish to xbmc/wiki issue #5 confirmed: 3 comments posted with modification-only content and <!-- kodiai:wiki-modification:{pageId} --> markers, no **Why:** or voice-mismatch prose. formatPageComment fixed. bun run verify:m028:s03 --json → overallPassed: true with LIVE-MARKER count=80. |
| R027 | product-capability | validated | M028/S01 | M028/S03, M028/S04 | S01 — WikiUpdateGroup type carries explicit mode field (section|page) with replacement text and scope metadata. Section vs page mode is deterministically chosen and machine-checkable in stored artifacts and verifier output. S04 regression harness confirms mode field present in all formatPageComment mock renders. |
| R028 | operability | validated | M028/S02 | M028/S03, M028/S04 | S02–S04 — Durable comment identity via published_comment_id column (migration 031). upsertWikiPageComment scans existing comments by marker and updates in place rather than creating duplicates. 21 legacy sentinel rows (published_comment_id=0) re-published via live upsert in S04; all acquired real GitHub comment IDs. bun run verify:m028:s04 --json SENTINEL-SUPERSEDED=pass (sentinel_rows=0). LIVE-PUBLISHED=pass (count=104). |
| R029 | quality-attribute | validated | M028/S04 | M028/S01, M028/S02, M028/S03 | S04 — 5-check machine-verifiable harness (verify-m028-s04.ts) with negative guards: NO-WHY-IN-RENDER, NO-WHY-IN-SUMMARY, DRY-RUN-CLEAN all assert absence of **Why:**, :warning:, Wiki Update Suggestions. wiki-publisher.test.ts has does-not-contain-suggestion-style-labels test (5 negative guards). Full regression sweep verify:m028:s02, s03, s04 all exit 0. Tests fail immediately if any banned string reappears. |
| R030 | quality-attribute | validated | M035/S01 | M035/S02 | S01 — grep -r 'voyage-code-3' src/ --include='*.ts' | grep -v '.test.ts' returns 0 hits; DEFAULT_EMBEDDING_MODEL and NON_WIKI_TARGET_EMBEDDING_MODEL are "voyage-4"; createRerankProvider with rerank-2.5 model is implemented in embeddings.ts; 9 unit tests pass; tsc --noEmit exits clean. |
| R031 | correctness | active | M039 | none | Regression fixture derived from xbmc/xbmc PR 28127 body/output does not render 'breaking change in body' unless a real author-authored signal remains after stripping. |
| R032 | correctness | active | M039 | none | Handler and formatter regression tests prove Review Details renders percent-left when usageLimit is present and follows the documented unavailable-state contract when it is absent. |
| R033 | functional | active | M040 | none | Fixture-based proof shows graph-aware review selection identifies impacted files/tests/dependents beyond file-level triage alone, while keeping context bounded on large PRs. |
| R034 | quality-attribute | active | M040 | none | Regression tests and milestone verifier demonstrate that trivial single-file PRs bypass or bound graph overhead, and graph build/query failures do not block reviews. |
| R035 | operational | validated | M041 | S03 | verify:m041:s03 --json exits 0 with overallPassed:true. All four checks pass: UNCHANGED-FILE-PRESERVATION (upsertCallCount=0 for fully unchanged file, upsertCallCount=1 for partially changed file), DRIFT-DETECTED-BY-AUDIT (audit_failed on drifted corpus, audit_ok on clean), SELECTIVE-REPAIR-FIXES-ONLY-DRIFTED-ROWS (repaired=3 embedCallCount=3 writeCallCount=3 on 3-drifted/1-fresh corpus), REPAIR-SKIPS-WHEN-NO-DRIFT (status_code=repair_not_needed embedCallCount=0). |
| R036 | functional | validated | M041 | S01,S02 | S01 established the canonical current-code substrate: dedicated canonical_code_chunks/canonical_corpus_backfill_state schema, explicit chunk identity and provenance types, canonical chunker with auditable exclusions/boundaries, and a dedicated ingest path with inserted/replaced/dedup semantics proven by canonical-code store/chunker/ingest tests plus clean tsc. This validates the storage/chunking half of the requirement; retrieval/backfill workflow is advanced further in later slices. |
| R037 | functional | validated | M038 | S01,S02 | Validated by M038/S02. Review Details now includes a bounded Structural Impact section with changed symbols, probable callers/dependents, impacted files, likely tests, and canonical unchanged-code evidence. The deterministic verifier `bun run verify:m038:s02 -- --json` passes both C++ and Python proof scenarios, including structurally grounded breaking-change wording when evidence is present. |
| R038 | correctness | validated | M038 | S02,S03 | Validated by M040/S03. Proof check M040-S03-FAIL-OPEN-VALIDATION confirms neverThrew=true, succeeded=false, originalFindingsPreserved=true when LLM validation gate throws. buildGraphContextSection(null) returns empty text (fail-open). applyGraphAwareSelection() returns usedGraph=false on null graph. queryBlastRadiusFromSnapshot() provides caller/dependent evidence with explicit confidence scores and reason strings. bun run verify:m040:s03 --json exits 0 with overallPassed:true. |
| R039 |  | validated | none | none | Validated by M042/S01 scorer-tier persistence work and fresh milestone validation reruns: `bun run verify:m042:s01` passed `M042-S01-STUCK-TIER-REPRO-FIXED` and `M042-S01-RECALCULATED-TIER-PERSISTS`, proving stored contributor tiers now advance truthfully as score signals accumulate. |
| R040 |  | validated | none | none | Validated by M042/S02 render-surface wiring and fresh milestone validation reruns: `bun run verify:m042:s02` passed `M042-S02-PROFILE-TIER-DRIVES-SURFACE`, `M042-S02-PROMPT-ESTABLISHED-TRUTHFUL`, `M042-S02-DETAILS-ESTABLISHED-TRUTHFUL`, and `M042-S02-CRYSTALP-SURFACES-STAY-ESTABLISHED`, proving review output no longer mislabels the CrystalP-shaped experienced contributor as a newcomer. |
| R041 |  | validated | none | none | Validated by M042/S03 cache/fallback hardening and fresh milestone validation reruns: `bun run verify:m042:s03` passed `M042-S03-CACHE-HIT-SURFACE-TRUTHFUL`, `M042-S03-PROFILE-OVERRIDES-CONTRADICTORY-CACHE`, and `M042-S03-DEGRADED-FALLBACK-NONCONTRADICTORY`, proving lower-fidelity cache and degraded fallback paths do not preserve stale or contradictory contributor labels. |
| R042 |  | validated | none | none | Validated by the named M042 proof-harness path for the CrystalP-shaped repro and fresh milestone validation reruns: `bun run verify:m042:s01`, `bun run verify:m042:s02`, and `bun run verify:m042:s03` all passed, providing a reproducible mechanical regression surface for the original failure and adjacent contributor-history cases. |
| R043 | functional | active | M043 | none | Live production verification on xbmc/kodiai PR #80 shows an explicit `@kodiai review` request causes either a real review/comment publication or a visible failure comment, with no silent-success path. |
| R044 | operational | validated | M043 | none | M043/S01 closure reran `bun test ./src/handlers/mention.test.ts ./src/handlers/review-idempotency.test.ts` (102 pass) and `bash -n deploy.sh` (exit 0). Verified deploy.sh preserves ACA job/app wiring via full-YAML updates and surfaces active revision + /healthz + /readiness evidence; mention publish-path regressions prove `reviewOutputKey`/idempotency/publish-resolution logs and actionable publish-failure fallback comments. |
| R045 | operational | validated | M044/S03 | M044/S01, M044/S02 | `bun run verify:m044 -- --repo xbmc/xbmc --limit 12 --json` produced a deterministic 12-PR recent sample over xbmc/xbmc with verdict summary `clean-valid=11`, `findings-published=1`, `publish-failure=0`, `suspicious-approval=0`, `indeterminate=0`, using GitHub-visible output plus Azure internal publication evidence. `docs/runbooks/recent-review-audit.md` documents the rerun and drill-down flow. |
| R046 | functional | validated | M045/S01 | M045/S02, M045/S03, M047/S01, M047/S02, M047/S03 | Revalidated during M047 closeout by fresh passing results from `bun run verify:m047 -- --json` and the prerequisite bundle (`bun run verify:m047:s02 -- --json && bun run verify:m045:s03 -- --json && bun run verify:m046 -- --json`), proving the contributor-experience contract remains truthful across review prompt/Review Details, retrieval hints, Slack/profile output, identity suppression, and contributor-model evidence without raw-tier drift. |
| R047 | operational | validated | M046/S02 | M046/S01,M046/S03 | 2026-04-10 milestone closeout: `bun test ./src/contributor/fixture-set.test.ts ./src/contributor/xbmc-fixture-refresh.test.ts ./scripts/verify-m046-s01.test.ts ./src/contributor/xbmc-fixture-snapshot.test.ts ./src/contributor/calibration-evaluator.test.ts ./scripts/verify-m046-s02.test.ts ./src/contributor/calibration-change-contract.test.ts ./scripts/verify-m046.test.ts`, `bun run verify:m046 -- --json`, and `bun run tsc --noEmit` all passed. The integrated verifier preserved the nested S01/S02 proof surfaces, retained/excluded counts (3/6), a truthful `replace` verdict, and a complete `m047ChangeContract`. |
| R048 | functional | validated | M047/S03 | M047/S01, M047/S02, M045, M046 | Validated during M047 closeout by fresh passing results from `bun test ./scripts/verify-m047.test.ts`, `bun run verify:m047 -- --json`, `bun run verify:m047:s02 -- --json && bun run verify:m045:s03 -- --json && bun run verify:m046 -- --json`, and `bun run tsc --noEmit`. The integrated `verify:m047` report preserved nested S02/M045/M046 evidence and the five milestone scenarios (`linked-unscored`, `calibrated-retained`, `stale-degraded`, `opt-out`, `coarse-fallback`) across review/runtime, Review Details, retrieval hints, Slack/profile output, identity behavior, and contributor-model evidence. |
| R049 | functional | active | M048 | none | Live xbmc/kodiai review proof shows per-phase timing and a materially improved end-to-end review path versus the current timeout-prone baseline, while any reduced-scope or staged large-PR behavior remains explicit and truthful instead of silently stalling or fabricating completeness. |
| R050 | operational | active | M048/S01 | M048/S02,M048/S03 | unmapped |
| R051 | functional | active | M048/S03 | None | unmapped |
| R052 | functional | validated | M048/S03 | M048/S01 | Reconfirmed during M048 closeout by fresh passing results from `bun test ./src/jobs/queue.test.ts ./src/jobs/aca-launcher.test.ts ./src/execution/prepare-agent-workspace.test.ts ./src/execution/agent-entrypoint.test.ts ./src/execution/executor.test.ts ./src/execution/config.test.ts ./src/execution/review-prompt.test.ts ./src/handlers/review.test.ts ./src/lib/review-utils.test.ts ./src/lib/review-boundedness.test.ts ./src/review-audit/phase-timing-evidence.test.ts ./scripts/verify-m048-s01.test.ts ./scripts/verify-m048-s02.test.ts ./scripts/verify-m048-s03.test.ts`, `bun run tsc --noEmit`, and `REVIEW_OUTPUT_KEY='' bun run verify:m048:s03 -- --review-output-key "$REVIEW_OUTPUT_KEY" --json`. The combined suite preserved the shared bounded-review disclosure contract across prompt generation, handler/publication, Review Details, summary backfill, and verifier fixtures while small unbounded reviews stayed silent. |
| R053 | non-functional | validated | M050 | none | Fresh milestone closeout reran `bun test ./src/lib/timeout-estimator.test.ts ./src/handlers/review.test.ts ./src/lib/review-utils.test.ts ./src/execution/executor.test.ts ./src/review-audit/phase-timing-evidence.test.ts ./scripts/verify-m048-s01.test.ts ./scripts/verify-m048-s02.test.ts ./scripts/verify-m048-s03.test.ts && bun run tsc --noEmit` with 209 pass / 0 fail / exit 0. Live proof from S02 remained the milestone evidence set: `verify:m048:s01` returned `m048_s01_ok` for the opened and synchronize `xbmc/kodiai#86` runs on revision `ca-kodiai--deploy-20260416-143108`, and `verify:m048:s02` reported `latency-improved` with a `-660095ms` targeted delta versus the historical `xbmc/kodi-tv#1240` degraded baseline. |
| R054 | functional | validated | M050 | none | Fresh milestone closeout reran `bun test ./src/lib/timeout-estimator.test.ts ./src/handlers/review.test.ts ./src/lib/review-utils.test.ts ./src/execution/executor.test.ts ./src/review-audit/phase-timing-evidence.test.ts ./scripts/verify-m048-s01.test.ts ./scripts/verify-m048-s02.test.ts ./scripts/verify-m048-s03.test.ts && bun run tsc --noEmit` with 209 pass / 0 fail / exit 0. That bundle kept the truthful timeout-surface contract green in `src/handlers/review.test.ts`, `src/lib/review-utils.test.ts`, `scripts/verify-m048-s01.test.ts`, and `scripts/verify-m048-s03.test.ts`, proving analyzed progress, captured findings, retry state, and explicit publication-phase timing stay truthful; S02’s live/operator proof remained green via `verify:m048:s03` on the `xbmc/kodiai#86` synchronize run. |
| R055 | functional | validated | none | none | Validated by M051 closeout evidence: `bun test ./src/handlers/review.test.ts ./src/execution/config.test.ts ./src/handlers/mention.test.ts` passed 327/327 with team-only `ai-review` / `aireview` requests skipped and `@kodiai review` staying on `interactive-review` / `review.full`; `! rg -n "uiRereviewTeam|requestUiRereviewTeamOnOpen|ai-review|aireview" docs/runbooks/review-requested-debug.md docs/configuration.md docs/smoke/phase75-live-ops-verification-closure.md .kodiai.yml && rg -n "@kodiai review|interactive-review|review\.full|team-only-request" ...` confirmed the stale UI-team contract is gone while the surviving manual trigger and proof surfaces remain; `bun run tsc --noEmit` completed successfully. |
| R056 | functional | validated | M052 | none | `bun run verify:m052` reports `m052_ok`; the committed PR branch also passes `bun test ./src/config.test.ts ./src/slack/webhook-relay-config.test.ts ./src/slack/webhook-relay.test.ts ./src/slack/webhook-relay-delivery.test.ts ./src/routes/slack-relay-webhooks.test.ts ./scripts/verify-m052-s01.test.ts ./scripts/verify-m052-s02.test.ts ./scripts/verify-m052.test.ts` and `bun run tsc --noEmit`. The feature now provides env-backed source config, explicit suppression reasons, explicit delivery failure, and operator docs/smoke guidance. |
| R057 | functional | validated | M021/S01 | none | M021/S01 summary and shipped code in src/knowledge/issue-store.ts prove the IssueStore factory, schema migration, and 15 PostgreSQL-backed tests covering issue/comment CRUD, similarity search, full-text search, and cascade delete. |
| R058 | functional | validated | M021/S02 | none | M021/S02 summary plus src/execution/mcp/issue-label-server.ts and src/execution/mcp/issue-comment-server.ts prove shipped add_labels/create_comment/update_comment tooling with config gating, case-insensitive label validation, retry on rate limits, closed-issue warnings, truncation, and passing unit/integration coverage. |
| R059 | functional | validated | M021/S03 | none | M021/S03 summary plus src/triage/triage-agent.ts, src/handlers/mention.ts, and src/execution/mention-prompt.ts prove template diffing, needs-info label recommendation, mention-prompt triage context injection, and fail-open cooldown-gated mention integration with passing triage/config/mention/MCP tests. |
| R060 | functional | deferred | M021/S03 | none | M021/S03 summary plus src/triage/triage-agent.ts, src/handlers/mention.ts, and src/execution/mention-prompt.ts prove template diffing, needs-info label recommendation, mention-prompt triage context injection, and fail-open cooldown-gated mention integration with passing triage/config/mention/MCP tests. |
| R061 | core-capability | validated | M062/S01 | none | Validated by M062. Fresh milestone-close verification passed: `bun test ./scripts/verify-m062-s03.test.ts ./scripts/verify-m062-s01.test.ts` (20/20), `bun test ./src/lib/review-utils.test.ts ./src/lib/partial-review-formatter.test.ts ./src/handlers/review.test.ts` (159/159), `bun run verify:m062:s01 -- --json` (`status_code: "m062_s01_ok"` across 4 scenarios), `bun run verify:m062:s03 -- --json` (`status_code: "m062_s03_ok"` with three `bounded-parity-ok` scenarios and one `dead-end-rejected` zero-evidence scenario), and `bun run tsc --noEmit` (exit 0). The milestone proves large PRs now return a truthful bounded first review instead of a dead `max_turns` failure when structured evidence exists. |
| R062 | continuity | validated | M063/S01 | none | M063/S01 verified automatic bounded-review continuation with fresh evidence: `bun test src/lib/review-continuation-lifecycle.test.ts` (12 pass), `bun test src/handlers/review.test.ts --filter "continuation"` (147 pass, including continuation enqueue/merge/suppression coverage), and `bun test scripts/verify-m063-s01.test.ts && bun run scripts/verify-m063-s01.ts --json` (`status_code: m063_s01_ok`, proving schedule, merge, no-delta settlement, and stale-authority suppression). |
| R063 | continuity | validated | M063/S02 | none | Validated by M063/S02 slice-close verification: `bun test ./src/lib/partial-review-formatter.test.ts ./src/handlers/review.test.ts ./scripts/verify-m063-s02.test.ts ./scripts/verify-m063-s01.test.ts` (162/162 pass), `bun run verify:m063:s02 -- --json` (`status_code: "m063_s02_ok"`; scenarios reported `same-surface-pending`, `same-surface-revised`, and `same-surface-quiet-settlement` with `visibleSurfaceCount: 1` and `continuationSurfaceCount: 0`), and `bun run tsc --noEmit` (exit 0). Continuation now updates one canonical visible review surface anchored to the base reviewOutputKey without creating an extra lifecycle comment. |
| R064 | failure-visibility | validated | M062/S02 | M063/S02 | Validated by M062. Fresh milestone-close verification passed: `bun test ./src/lib/review-utils.test.ts ./src/lib/partial-review-formatter.test.ts ./src/handlers/review.test.ts` (159/159), `bun run verify:m062:s03 -- --json` (`status_code: "m062_s03_ok"`; timeout, max-turns, and large-PR bounded scenarios all reported `bounded-parity-ok` for bounded reason, covered scope, remaining scope, and continuation state), and `bun run tsc --noEmit` (exit 0). The visible review surfaces now truthfully report covered scope, remaining scope, and continuation status from one coherent contract. |
| R065 | correctness | validated | M063/S02 | none | Validated by M063/S02 slice-close verification: `bun test ./src/lib/partial-review-formatter.test.ts ./src/handlers/review.test.ts ./scripts/verify-m063-s02.test.ts ./scripts/verify-m063-s01.test.ts` (162/162 pass), `bun run verify:m063:s02 -- --json` (`status_code: "m063_s02_ok"`; the merge-revisions scenario reported `same-surface-revised` with explicit revision visibility and the no-delta scenario reported `same-surface-quiet-settlement` with no public churn), and `bun run tsc --noEmit` (exit 0). Continuation revisions are now rendered explicitly on the canonical surface instead of silently rewriting prior visible conclusions. |
| R066 | constraint | validated | M063/S03 | M065/S02 | Validated in M063/S03 with fresh slice-close evidence: `bun test src/execution/review-prompt.test.ts --filter "continuation"`, `bun test scripts/verify-m063-s03.test.ts`, `bun run verify:m063:s03 -- --json`, `bun test src/handlers/review.test.ts --filter "retry"`, `bun run verify:m063:s02 -- --json`, and `bun run tsc --noEmit` all passed. The verifier proves continuation narrows `review-change-context`, omits first-pass-only `review-size-context`, preserves required sections, avoids exhaustive-coverage claims, and the retry handler tests prove stale/superseded continuation cannot overwrite canonical summary or Review Details paths. |
| R067 | continuity | validated | M064/S01 | none | M064/S01 reran `bun test src/handlers/review.test.ts` and `bun test scripts/verify-m064-s01.test.ts && bun run verify:m064:s01 -- --json`; canonical continuation-family state preserves newer-attempt authority and the verifier proves stale superseded attempts cannot overwrite the winning attempt. |
| R068 | operability | validated | M064/S03 | M065/S02 | M061/S05 added the integrated `verify-m061-s05` proof surface on the canonical Postgres-backed usage-report path and verified fail-open preflight reporting when telemetry is unavailable plus the DB-independent `phase-m061-token-regression-gate` operator surface. M064 must extend this by proving continuation lifecycle truth resolves from canonical family state directly, with explicit projection-status reporting when supporting evidence lags or fails. |
| R069 | quality-attribute | validated | M065/S01 | none | M061/S05 pinned and passed mention, review, retrieval, reporting, and verifier regression suites via `bun scripts/phase-m061-token-regression-gate.ts`, preserving non-large-PR behavior and publication semantics while token-reduction work evolves. |
| R070 | launchability | active | M065/S02 | none | mapped |
| R071 | functional | validated | M064/S01 | M064/S02,M064/S03 | M064/S01 reran `bun test src/handlers/review.test.ts` and `bun test scripts/verify-m064-s01.test.ts && bun run verify:m064:s01 -- --json`; canonical continuation-family rows answer merged, quiet-settled, blocked, and superseded scenarios directly from durable state. |
| R072 | operational | validated | M064/S01 | M064/S02,M064/S03 | M064/S01 verifier output returns `authoritativeAttemptId` and `authoritativeAttemptOrdinal` directly from canonical continuation-family state for merged, quiet-settled, blocked, and superseded scenarios; verified by `bun test scripts/verify-m064-s01.test.ts && bun run verify:m064:s01 -- --json`. |
| R073 | operational | validated | M064/S01 | M064/S02,M064/S03 | M064/S01 verifier output returns controlled `finalStopReason` values (`merged-continuation-results`, `settled-without-update`, `no-follow-up`, `superseded-by-newer-attempt`) directly from canonical continuation-family state; verified by `bun test scripts/verify-m064-s01.test.ts && bun run verify:m064:s01 -- --json`. |
| R074 | operational | validated | M064/S03 | M064/S02 | M064/S03 reran `bun test src/knowledge/continuation-operator-evidence.test.ts && bun test scripts/verify-m064-s03.test.ts && bun run verify:m064:s03 -- --json && bun run verify:m064:s03 && bun test scripts/verify-m064-s01.test.ts && bun test scripts/verify-m064-s02.test.ts && bun run verify:m064:s01 -- --json && bun run verify:m064:s02 -- --json`; the operator-evidence surface now resolves continuation lifecycle truth directly from canonical continuation-family state and renders degraded/pending `projectionStatus` explicitly. |
| R075 | correctness | validated | M064/S02 | none | M064/S02 reran `bun test src/execution/mcp/checkpoint-server.test.ts && bun test src/handlers/review.test.ts && bun test scripts/verify-m064-s02.test.ts && bun run verify:m064:s02 -- --json`; checkpoint acknowledgements now wait for durable save completion and never report `saved: true` on rejected writes. |
| R076 | functional | validated | M053/S01 | M053/S04 | M066/S01 verification passed: `bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts --timeout 30000` (245 pass, 0 fail). Parser and full mention-handler tests prove `@kodiai format suggestions` and `@kodiai suggest formatting fixes` route as explicit formatter-suggestion requests. |
| R077 | functional | validated | M053/S03 | M053/S02,M053/S04,M053/S05 | M066/S07/T05 live smoke proof on xbmc/kodiai PR #134 posted a same-PR COMMENTED Kodiai Pull Request Review with review id 4225484818 and fenced suggestion comment 3186219778; `bun run verify:m066:s05 -- --repo xbmc/kodiai --review-output-key <mention-format-suggestions key> --delivery-id 462ed8c0-4843-11f1-8135-1c6010084b2c --json` returned `success: true`, `status_code: "m066_s05_ok"`. |
| R078 | integration | validated | M053/S01 | M053/S02 | M066/S02 verification passed: `bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts ./src/execution/formatter-suggestions.test.ts --timeout 30000` (269 pass, 0 fail). Command-runner fixture tests prove repository-configured formatter commands use only allowlisted placeholders, return structured no-command/no-op/success/failed/timed-out statuses, and produce bounded/redacted diagnostics without relying on Jenkins artifacts. |
| R079 | constraint | validated | M053/S01 | M053/S04 | M066/S01 verification passed: config tests prove `review.formatterSuggestions.automatic` defaults false with optional command and bounded `maxSuggestions`, and mention-handler fixtures prove explicit formatter requests still carry `formatterSuggestionRequest` when automatic mode is off. |
| R080 | functional | validated | M053/S04 | M053/S01,M053/S02,M053/S03 | M053/S04 verification passed: `bun test src/handlers/mention.test.ts src/handlers/formatter-suggestion-orchestration.test.ts --timeout 30000` (157 pass, 0 fail, 925 assertions) and full formatter bundle `bun test src/execution/config.test.ts src/handlers/formatter-suggestion-intent.test.ts src/handlers/mention.test.ts src/execution/formatter-suggestions.test.ts src/execution/formatter-suggestion-publisher.test.ts src/handlers/formatter-suggestion-orchestration.test.ts --timeout 30000` (306 pass, 0 fail, 1419 assertions). Combined-mode mention tests prove `@kodiai review & format suggestions` preserves normal review routing while invoking formatter suggestions after returned-error and thrown-error review executor cases. |
| R081 | functional | validated | M053/S03 | M053/S04 | M066/S03 publisher tests passed in current slice verification: `bun test ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000` (34 pass, 117 assertions) and regression bundle `bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000` (279 pass, 1289 assertions). Tests prove one `pulls.createReview` call carries multiple inline suggestion comments plus review-output idempotency markers, with no standalone comment fallback. |
| R082 | quality-attribute | validated | M053/S02 | M053/S03,M053/S05 | M066/S02 verification passed: `bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts ./src/execution/formatter-suggestions.test.ts --timeout 30000` (269 pass, 0 fail). Formatter parser/mapper tests prove git unified diffs become deterministic RIGHT-side GitHub suggestion payloads only when every target line maps to the PR diff index; malformed, unsupported, pure insertion/deletion, path-mismatch, and off-diff hunks are skipped rather than guessed. |
| R083 | operability | validated | M053/S02 | M053/S03,M053/S04 | M066/S02 verification passed: `bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts ./src/execution/formatter-suggestions.test.ts --timeout 30000` (269 pass, 0 fail). Mapper tests prove safe candidates are capped by maxSuggestions after validation, capped candidates receive `max-suggestions-exceeded`, and skipped/unsafe/parser diagnostics are returned with counts for downstream publication and logging. |
| R084 | failure-visibility | validated | M053/S04 | M053/S03,M053/S05 | M053/S04 verification passed: formatter-orchestration and mention-handler tests prove visible bounded diagnostics for setup-needed/no-op/command failure/timeout/PR-diff-unavailable/mapped-no-suggestions/duplicate/blocked/publisher-failed outcomes, and combined-mode mention tests prove formatter failures do not block successful review paths while review executor failures still attempt formatter suggestions when setup is available. Fresh full bundle passed with 306 pass, 0 fail, 1419 assertions. |
| R085 | quality-attribute | validated | M053/S05 | none | M053/S05 proof alignment documents the accepted live formatter-suggestion smoke on xbmc/xbmc#28259: explicit `@kodiai review format suggestions` trigger, formatter action `mention-format-suggestions`, same-PR `COMMENTED` Pull Request Review, fenced GitHub `suggestion` comments, delivery/log correlation via formatter `reviewOutputKey`, and canonical verifier surface `bun run verify:m066:s05` returning `status_code: "m066_s05_ok"` in the accepted proof record. Fresh S05 closure reran local verifier and formatter contract suites; GitHub App credentials were absent, so exact live rerun was boundedly skipped per plan. |
| R086 | functional | deferred | later | M053/S01,M053/S04 | Unmapped until a later milestone or explicit repo opt-in exercises automatic behavior. |
| R087 | integration | deferred | later | M053/S01,M053/S02 | Unmapped; future formatter adapters can reuse the command/diff parser seam. |
| R088 | admin/support | deferred | later | none | Unmapped. |
| R089 | anti-feature | out-of-scope | none | none | n/a |
| R090 | anti-feature | out-of-scope | none | none | n/a |
| R091 | anti-feature | out-of-scope | none | none | n/a |
| R092 | continuity | validated | M067/S01 | M067/S02, M067/S03, M067/S04, M067/S05 | M067/S01 implemented and verified a first-class ReviewPlan contract in src/review-orchestration/review-plan.ts, wired it into src/handlers/review.ts before executor dispatch, and passed slice verification: bun test src/review-orchestration/review-plan.test.ts, bun test src/handlers/review.test.ts --timeout 30000, bun run verify:m067:s01, bun run verify:m067:s01 -- --json, bun run tsc --noEmit, and git diff --check. |
| R093 | failure-visibility | validated | M067/S01 | M067/S03, M067/S04, M067/S05 | M067 S04 verification passed: review-utils tests and verifier CANDIDATE-DETAILS-COMPACT prove exactly one compact Review candidates line, count-only/correlation-only metadata, and no raw title/body/diff/prompt/token/secret leakage. |
| R094 | integration | validated | M067/S02 | M067/S01, M067/S03, M067/S05 | M067 S03 reducer input consumes typed `config.review.graphValidation.enabled` and graph-validation status/count metadata without mutating hashed ReviewPlan state; reducer tests, handler graph-validation coverage, and `verify:m067:s03` GRAPH-VALIDATION-CONSUMED passed. |
| R095 | continuity | validated | M067/S03 | M067/S01, M067/S02, M067/S05 | M067 S03 extracted current post-review gates into `ReviewReducerResult` / `reduceReviewFindings()` with behavior-preserving unit, handler, verifier, S01/S02 regression, typecheck, and whitespace checks passing on 2026-05-09. |
| R096 | core-capability | validated | M067/S04 | M067/S01, M067/S03, M067/S05 | M067 S04 verification passed: candidate MCP server exposes optional shadow-only mcp__review_candidate_finding__record_candidate_finding, verifier CANDIDATE-MCP-TOOL-CAPTURE passed, and prompt tests confirm it is excluded from GitHub publish tools. |
| R097 | failure-visibility | validated | M067/S01 | M067/S03, M067/S04, M067/S05 | M067 S04 verification passed: fail-open contract covered by candidate normalization tests, MCP degraded responses, executor metadata on success/timeout/failure/error branches, handler degraded/missing metadata tests, and verifier CANDIDATE-FAIL-OPEN. |
| R098 | quality-attribute | validated | M067/S01 | M067/S02, M067/S03, M067/S04, M067/S05 | M067 S04 verification passed: scripts/verify-m067-s04.ts, scripts/verify-m067-s04.test.ts, and package script verify:m067:s04 exist and passed in text and JSON modes with schema/MCP/fail-open/plan/prompt/details/sidecar checks. |
| R099 | operability | blocked | M067/S05 | M067/S01, M067/S02, M067/S03, M067/S04 | M067/S06/T03 re-ran the exact-key publication-readiness preflight and read-only full S05 verifier for the captured automatic synchronize key. Both returned M067-S05-PUBLICATION-READINESS / review_details_not_published; GitHub artifact counts remained reviewComments=0, issueComments=0, reviews=0, total=0, and no additional GitHub write or live trigger was performed. |
| R100 | constraint | validated | M067/S03 | M067/S04, M067/S05 | M067 S03 kept production-visible reducer behavior equivalent; M067 S04 kept candidate capture shadow-only; M067/S06/T03 re-verified visible-volume safety during the gated live-proof retry by stopping before any additional GitHub write when publication preflight failed and preserving exact-key artifact counts of reviewComments=0, issueComments=0, reviews=0, total=0 for the captured automatic synchronize key. |
| R101 | core-capability | deferred | M068 provisional | none | unmapped |
| R102 | core-capability | validated | M070/S05 | M070/S01,M070/S02,M070/S03 | M070/S05 added deterministic production-like normal-review integration proof for docs/config truth specialist lanes through createReviewHandler, shadow aggregate classification, MCP publication gate, Review Details/runtime evidence projection, and M070 verifier evaluation. Fresh closeout evidence: `bun test ./src/handlers/review-candidate-verification-integration.test.ts ./scripts/verify-m070-s05.test.ts ./scripts/verify-m070.test.ts ./scripts/verify-m070-s03.test.ts ./src/specialists/candidate-verification-publication-evidence.test.ts ./src/specialists/candidate-publication-policy.test.ts ./src/specialists/candidate-verification.test.ts ./src/handlers/review-candidate-verification-publication.test.ts ./src/handlers/review-candidate-verification-evidence.test.ts && bun run verify:m070 --json && bun run verify:m070:s05 --json` exited 0 (gsd_exec ec51400c-33f6-4522-a514-725d7b762589). The S05 verifier reported Review Details rows: 8, runtime log rows: 8, MCP evidence rows: 8, aggregateOnly:true, canaryLeakPresent:false, verifierJsonLeakPresent:false, and no issue categories. |
| R103 | quality-attribute | validated | M070/S01 | M070/S02,M070/S03,M070/S04,M070/S05,M070/S06 | M070/S01 added a pure candidate verification/conflict classifier and fixture verifier. Fresh closeout evidence: `bun test ./src/specialists/candidate-verification.test.ts` exited 0 (gsd_exec 42c19ab1-e80e-40f0-b24e-d3910b670756); `bun test ./scripts/verify-m070-s01.test.ts && bun run verify:m070:s01 --json` exited 0 with success:true/status_code:m070_s01_ok and checks for taxonomy, conflict, fail-closed, privacy, and package wiring (gsd_exec 51b2952f-4d2e-4e52-b952-c3880aecb8c3). |
| R104 | integration | deferred | M074/S01 | M071/S06 | unmapped |
| R105 | operability | active | M070/S03 | M070/S03 | unmapped |
| R106 | anti-feature | out-of-scope | none | none | n/a |
| R107 | anti-feature | out-of-scope | none | none | n/a |
| R108 | anti-feature | out-of-scope | none | none | n/a |
| R109 | anti-feature | out-of-scope | none | none | n/a |
| R110 | core-capability | validated | M068/S01 | M068/S02,M068/S03,M068/S05 | M068 live exact-key proof on xbmc/xbmc#28172 used explicit `@kodiai review` delivery `e15d3ee0-4d6b-11f1-9d31-9ef027295c6d` and reviewOutputKey `kodiai-review-output:v1:inst-109141824:xbmc/xbmc:pr-28172:action-mention-review:delivery-e15d3ee0-4d6b-11f1-9d31-9ef027295c6d:head-kodiai-review-validation-20260411`; `verify:m068:candidate-publication --expect-status m068_ok scripts/fixtures/m068-candidate-approved-proof.json` passed with candidatePublished=4 and directFallback=0. |
| R111 | integration | validated | M068/S02 | M068/S03,M068/S05 | M068/S02 verified approved-candidate publication adapter via `bun test src/review-orchestration/review-candidate-publication-adapter.test.ts`, shared MCP/idempotency regression suite, `bun run verify:m068:s01 --json`, `bun run verify:m068:s02 --json`, and `bun run lint` in gsd_exec 24ddedec-2081-42f2-b2e3-6414287cafc7. S02 verifier passed stable checks for adapter mapping, no parallel publisher, idempotency, commentability, secret-scan blocking, bounded evidence, and processed-finding compatibility. |
| R112 | failure-visibility | validated | M068/S03 | M068/S04,M068/S05 | M068/S03 verified that direct GitHub publication remains audited fallback and is distinguishable from candidate-approved publication via runtime metadata, Review Details, safe config snapshots, logs, and `bun run verify:m068:s03 --json`. Fresh slice closure verification passed in gsd_exec 79936ce7-aeba-44cf-acd8-0edc8d389948, including handler tests and S03 verifier checks that fallback-only output cannot satisfy candidate-approved success. |
| R113 | operability | validated | M068/S03 | M068/S04,M068/S05 | M068/S03 verified bounded candidate lifecycle observability for recorded/rejected/deduped/rewritten/approved/suppressed/published/fallback counts and reasons without raw prompts, diffs, candidates, evidence payloads, or secrets. Fresh slice closure verification passed in gsd_exec 79936ce7-aeba-44cf-acd8-0edc8d389948; `bun run verify:m068:s03 --json` passed and reports redaction leak count 0 plus bounded Review Details/snapshot checks. |
| R114 | launchability | validated | M068/S05 | M068/S01,M068/S02,M068/S03,M068/S04 | Accepted live exact-key proof on xbmc/xbmc#28172: trigger `https://github.com/xbmc/xbmc/pull/28172#issuecomment-4423917332`, Review Details `https://github.com/xbmc/xbmc/pull/28172#issuecomment-4423943241`, four inline candidate comments, delivery `e15d3ee0-4d6b-11f1-9d31-9ef027295c6d`, verifier status `m068_ok`. |
| R115 | constraint | validated | M068/S05 | M068/S03,M068/S04 | Both sides of the fallback contract are proven: `scripts/fixtures/m068-candidate-approved-proof.json` passes only as `m068_ok`, while `scripts/fixtures/m068-direct-fallback-proof.json` passes only with `--expect-status m068_direct_fallback` and remains rejected as success. |
| R116 | constraint | validated | M068/S05 | M068/S02,M068/S03 | The accepted live proof has one bounded Review Details issue comment plus four inline candidate review comments, directFallback=0, and no issue-comment fallback. `verify:m068:candidate-publication --expect-status m068_ok scripts/fixtures/m068-candidate-approved-proof.json` passed. |
| R117 | core-capability | validated | M070/S02 | M070/S01,M070/S05 | M070/S02 wired docs/config truth candidate verification into the normal review publication path and proved safe publication gating with fresh closeout evidence: policy unit tests `bun test ./src/specialists/candidate-publication-policy.test.ts` exit 0 (gsd_exec 3ec5b9dd-2c26-49dd-88c1-f3d5878b6e75); MCP publication gate tests `bun test ./src/execution/mcp/inline-review-server.test.ts ./src/execution/mcp/index.test.ts` exit 0 (gsd_exec 3f96a8f3-8e0e-489f-ac8d-1f6d103f0b9d); handler fixture `bun test ./src/handlers/review-candidate-verification-publication.test.ts` exit 0 (gsd_exec 797e7cb5-5c4d-44af-a9d0-9af072cedc92); closeout regression `bun test ./src/specialists/candidate-verification.test.ts ./scripts/verify-m070-s01.test.ts && bun run verify:m070:s01 --json` exit 0 with success:true/status_code:m070_s01_ok (gsd_exec 29c8874b-0a4b-45a1-bf46-605f99fac500). |
| R118 | core-capability | validated | M070/S04 | M070/S01,M070/S02,M070/S03,M070/S05,M070/S06 | M070/S06 closeout verified candidate verification/disagreement handling across classifier, publication policy, Review Details/log projection, production-like integration, and exact-key/live-or-blocked verifier surfaces. Fresh evidence: gsd_exec 5b6f8886-8ae9-43a6-bf72-9e8f57c7a096 ran 86 tests across 10 files with 0 failures, `verify:m070` success:true status_code `m070_fixture_contract_ok`, `verify:m070:s05` success:true status_code `m070_s05_ok`, and `verify:m070:s06 --allow-blocked` success:false status_code `m070_s06_missing_exact_key_blocked` with bounded no-key blocked evidence rather than false success. |
| R119 | failure-visibility | deferred | none | none | unmapped |
| R120 | failure-visibility | deferred | none | none | unmapped |
| R121 | anti-feature | out-of-scope | none | none | n/a |
| R122 | anti-feature | out-of-scope | none | none | n/a |
| R123 | constraint | out-of-scope | none | none | n/a |
| R124 | anti-feature | out-of-scope | none | none | n/a |
| R125 | failure-visibility | validated | M071/S01 | M071/S05 | M071/S05 closure proof passed: `bun test ./src/review-plan/review-plan.test.ts ./src/lib/partial-review-formatter.test.ts ./src/execution/config.test.ts ./src/review-graph/graph-validation-status.test.ts ./src/handlers/review.test.ts ./src/issue-131/evidence-matrix.test.ts ./scripts/verify-m071.test.ts` exited 0 with 335 tests, 0 failures, 1656 assertions; `bun run verify:m071 -- --json` exited 0 with status_code `m071_issue_131_matrix_ok`, all six checks passing, safe report shape, complete=6, partial=0, missing=0, deferred=4, package wiring present/matches, and no issues. |
| R126 | core-capability | validated | M071/S02 | M071/S03,M071/S05 | M071/S02 aggregate proof passed: `bun test src/review-plan/review-plan.test.ts src/handlers/review.test.ts src/issue-131/evidence-matrix.test.ts scripts/verify-m071.test.ts && bun run verify:m071 -- --json` exited 0 with 198 tests passing, `m071_issue_131_matrix_ok`, and verifier rows `review-plan-contract` plus `normal-handler-plan-construction` complete. The normal PR review handler constructs and logs a safe typed ReviewPlan before publication-side effects while fail-opening on diagnostics failures. |
| R127 | operability | validated | M071/S03 | M071/S02,M071/S05 | M071/S03 aggregate proof passed: `bun test src/review-plan/review-plan.test.ts src/lib/partial-review-formatter.test.ts src/handlers/review.test.ts src/issue-131/evidence-matrix.test.ts scripts/verify-m071.test.ts && bun run verify:m071 -- --json` exited 0 with 223 tests passing, 0 failures, 1223 assertions, verifier status `m071_issue_131_matrix_ok`, and `review-details-plan-summary` complete with source evidence in `src/review-plan/review-plan.ts`, `src/lib/review-utils.ts`, and `src/handlers/review.ts` while graph/deferred rows remain truthfully partial/deferred. |
| R128 | quality-attribute | validated | M071/S04 | M071/S02,M071/S05 | S04 closeout verified typed review.graphValidation config parsing/documentation and truthful ReviewPlan/runtime status surfacing. Evidence: `bun test src/execution/config.test.ts src/review-graph/graph-validation-status.test.ts src/review-plan/review-plan.test.ts src/handlers/review.test.ts src/issue-131/evidence-matrix.test.ts scripts/verify-m071.test.ts` passed (314 tests, 1582 expects), and `bun run verify:m071 -- --json` reported complete=6 partial=0 missing=0 deferred=4 with no issues. |
| R129 | operability | validated | M071/S05 | M071/S01,M071/S02,M071/S03,M071/S04 | M071/S05 verified `verify:m071 -- --json` distinguishes complete, partial, missing, and deferred rows with repo-relative evidence paths and exact deferred ownership. The final report has six complete foundation rows, zero partial rows, zero missing rows, four deferred rows, and owner metadata for M072/S01 candidate publication bridge, M073/S01 reducer extraction, M074/S01 specialist lane proof, and M075/S01 metrics/tier closure. |
| R130 | core-capability | validated | M072/S01 | M072/S02,M072/S03,M072/S04,M073,M074 | M072/S04 closeout ran `bun test scripts/verify-m072.test.ts` (13 pass), `bun run verify:m072 -- --json` (success with passing bridge/package/deferred-owner/report-safety checks), and the targeted S02/S03 integration regression suite (163 pass), proving candidate findings are captured before public GitHub publication and exposed through an explicit safe reducer handoff contract. |
| R131 | core-capability | active | M073 | M072/S01,M072/S02,M072/S03,M073,M074 | unmapped |
| R132 | core-capability | active | M074 | M072/S01,M072/S02,M072/S03,M072/S04,M073,M074,M075 | unmapped |
| R133 | operability | active | M075 | M072/S01,M072/S03,M072/S04,M073,M074,M075 | unmapped |
| R134 | constraint | deferred | none | none | unmapped |
| R135 | constraint | deferred | none | none | unmapped |
| R136 | anti-feature | out-of-scope | none | none | n/a |
| R137 | anti-feature | out-of-scope | none | none | n/a |
| R138 | quality-attribute | active | M073/S01 | M073/S02,M073/S03,M073/S04,M073/S05,M073/S06 | mapped |
| R139 | core-capability | active | M073/S02 | M073/S01,M073/S05,M073/S06 | mapped |
| R140 | operability | active | M073/S03 | M073/S01,M073/S04,M073/S06 | mapped |
| R141 | continuity | active | M073/S04 | M073/S02,M073/S03,M073/S06 | mapped |
| R142 | failure-visibility | active | M073/S05 | M073/S02,M073/S03,M073/S04,M073/S06 | mapped |
| R143 | launchability | validated | M073/S06 | M073/S01,M073/S02,M073/S03,M073/S04,M073/S05 | M073/S06 verifier passed via `bun run verify:m073:s06 --json` (gsd_exec 97ce5b8e-b010-4fb2-9c72-421012bb3c8b): statusCode `m073_s06_ok`, 5/5 upstream evidence rows passed, runtime tokens reduced 21,200 -> 16,200 (23.58%), live duration 138,000 ms under 210,000 ms ceiling, bounded visible projections present, rollback controls present, negative cases covered, and issues empty. |
| R144 | constraint | deferred | none | none | unmapped |
| R145 | constraint | deferred | none | none | unmapped |
| R146 | anti-feature | out-of-scope | none | none | n/a |
| R147 | compliance/security | out-of-scope | none | none | n/a |

## Coverage Summary

- Active requirements: 18
- Mapped to slices: 18
- Validated: 99 (R001, R002, R003, R004, R005, R006, R007, R008, R009, R010, R011, R012, R013, R014, R015, R016, R019, R020, R021, R022, R023, R024, R025, R026, R027, R028, R029, R030, R035, R036, R037, R038, R039, R040, R041, R042, R044, R045, R046, R047, R048, R052, R053, R054, R055, R056, R057, R058, R059, R061, R062, R063, R064, R065, R066, R067, R068, R069, R071, R072, R073, R074, R075, R076, R077, R078, R079, R080, R081, R082, R083, R084, R085, R092, R093, R094, R095, R096, R097, R098, R100, R102, R103, R110, R111, R112, R113, R114, R115, R116, R117, R118, R125, R126, R127, R128, R129, R130, R143)
- Unmapped active requirements: 0
