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

## Coverage Summary

- Active requirements: 4
- Mapped to slices: 4
- Validated: 32 (R001, R002, R003, R004, R005, R006, R007, R008, R009, R010, R011, R012, R013, R014, R015, R016, R019, R020, R021, R022, R023, R024, R025, R026, R027, R028, R029, R030, R035, R036, R037, R038)
- Unmapped active requirements: 0
