---
phase: 99
title: "Wiki Staleness Detection — Verification"
status: passed
verified_at: "2026-02-25T20:50:00Z"
---

# Phase 99 Verification

## Goal Restatement

Kodiai automatically identifies wiki pages invalidated by code changes and delivers evidence-backed staleness reports on schedule. Two-tier detection: cheap heuristic pass first, LLM evaluation only on flagged subset (capped at 20 pages/cycle). Reports delivered as threaded Slack messages to `#ai-wiki`. On-demand trigger via `@kodiai wiki-check`.

## Requirement Coverage Check

| Requirement | Plan(s) | Status | Verification |
|-------------|---------|--------|--------------|
| WIKI-01: Scheduled job compares wiki page content against recent code changes | 99-02, 99-03 | PASS | `wikiStalenessDetector.start()` called in index.ts; 7-day `setInterval` in detector |
| WIKI-02: File-path-level evidence with commit SHAs | 99-02 | PASS | `StalePage` has `commitSha` + `changedFilePath`; thread reply format includes both |
| WIKI-03: Staleness report to `#ai-wiki` with top-N stale pages | 99-01, 99-02 | PASS | `deliverStalenessReport` posts standalone summary + thread replies; `postStandaloneMessage` added to SlackClient |
| WIKI-04: Staleness threshold configurable via env var | 99-01 | PASS | `WIKI_STALENESS_THRESHOLD_DAYS` -> `config.wikiStalenessThresholdDays` -> passed to detector |
| WIKI-05: Two-tier detection: heuristic first, LLM capped at 20 | 99-02 | PASS | `heuristicPass()` -> `candidates.slice(0, LLM_CAP)` where `LLM_CAP = 20` |

## Integration Checks

- [x] `src/db/migrations/012-wiki-staleness-run-state.sql` exists and creates `wiki_staleness_run_state` table
- [x] `AppConfig` has `slackWikiChannelId`, `wikiStalenessThresholdDays`, `wikiGithubOwner`, `wikiGithubRepo`
- [x] `SlackClient` interface has `postStandaloneMessage(input: SlackStandaloneMessageInput): Promise<{ ts: string }>`
- [x] `createSlackClient()` implements `postStandaloneMessage` returning `{ ts }` from Slack API response
- [x] `src/knowledge/wiki-staleness-types.ts` exports: `WikiPageCandidate`, `StalePage`, `WikiStalenessScanResult`, `WikiStalenessRunState`, `WikiStalenessDetectorOptions`, `WikiStalenessScheduler`
- [x] `src/knowledge/wiki-staleness-detector.ts` exports `createWikiStalenessDetector` and `heuristicScore`
- [x] `heuristicScore` filters tokens <= 3 chars, returns 0 when no overlap
- [x] `runScan()` returns `{ skipped: true, skipReason: "empty_wiki_store" }` when `countBySource()` returns 0
- [x] `runScan()` caps LLM evaluation at 20 pages (`LLM_CAP = 20`)
- [x] `deliverStalenessReport` only called when `stalePages.length > 0`
- [x] On scan failure, failure notification posted to `wikiChannelId` (if configured)
- [x] `src/index.ts` imports and instantiates `createWikiStalenessDetector`
- [x] Detector only instantiated when `config.slackWikiChannelId` is truthy
- [x] `_wikiStalenessDetectorRef` stopped in shutdown manager `closeDb` callback
- [x] `/wiki[-\s]?check/i` regex in `onAllowedBootstrap` intercepts `@kodiai wiki-check`
- [x] On-demand trigger uses `requestTracker.trackJob()` for clean shutdown
- [x] On-demand trigger fires `runScan()` fire-and-forget (no await before return)

## TypeScript / Tests

- [x] No new TypeScript errors introduced (pre-existing `config.knowledge` errors unrelated)
- [x] `heuristicScore` unit tests pass (0 on no overlap, positive on overlap, ignores short tokens)
- [x] `runScan` skip behavior test passes (empty wiki store -> skipped)
- [x] `postStandaloneMessage` test passes (returns `ts` from Slack response)
- [x] 13/13 tests passing across 2 test files

## Anti-Pattern Checks (must NOT be present)

- [x] Agent SDK (`query()`) NOT used for staleness LLM evaluation -- uses `generateWithFallback()` with `TASK_TYPES.STALENESS_EVIDENCE`
- [x] Empty report NOT posted -- `deliverStalenessReport` only called when `stalePages.length > 0`
- [x] `wiki_sync_state` table NOT modified or referenced by staleness detector
- [x] More than 20 pages NOT sent to LLM in a single cycle
- [x] Deferred pages (beyond 20-page cap) NOT included in the Slack report
- [x] `RepoConfig` / `.kodiai.yml` NOT used for wiki staleness config (uses env vars via `config.ts`)
- [x] `streamText()` NOT used anywhere in new files (use `generateText()` only)

## Verdict

**PASSED** -- All 5 requirements verified, all integration checks confirmed, all anti-pattern checks clear, 13/13 tests passing.
