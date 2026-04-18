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

### R055 — Documented manual rereview triggers must either work end-to-end or be removed from docs/config/tests so operators never rely on a nonexistent path.
- Class: functional
- Status: active
- Description: Documented manual rereview triggers must either work end-to-end or be removed from docs/config/tests so operators never rely on a nonexistent path.
- Why it matters: A documented rereview trigger that does not actually target Kodiai is an operator trap and makes review_requested debugging untrustworthy.
- Source: issue-84
- Validation: Either the UI team rereview path is proven live end-to-end, or the unsupported team path is removed and `@kodiai review` is documented and tested as the only supported manual rereview trigger.
- Notes: Covers the ai-review/aireview team path drift tracked in GitHub issue #84.

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
| R055 | functional | active | none | none | Either the UI team rereview path is proven live end-to-end, or the unsupported team path is removed and `@kodiai review` is documented and tested as the only supported manual rereview trigger. |

## Coverage Summary

- Active requirements: 9
- Mapped to slices: 9
- Validated: 44 (R001, R002, R003, R004, R005, R006, R007, R008, R009, R010, R011, R012, R013, R014, R015, R016, R019, R020, R021, R022, R023, R024, R025, R026, R027, R028, R029, R030, R035, R036, R037, R038, R039, R040, R041, R042, R044, R045, R046, R047, R048, R052, R053, R054)
- Unmapped active requirements: 0
