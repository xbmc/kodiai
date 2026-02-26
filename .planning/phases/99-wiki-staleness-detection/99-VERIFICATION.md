---
phase: 99
title: "Wiki Staleness Detection — Verification"
---

# Phase 99 Verification

## Goal Restatement

Kodiai automatically identifies wiki pages invalidated by code changes and delivers evidence-backed staleness reports on schedule. Two-tier detection: cheap heuristic pass first, LLM evaluation only on flagged subset (capped at 20 pages/cycle). Reports delivered as threaded Slack messages to `#ai-wiki`. On-demand trigger via `@kodiai wiki-check`.

## Requirement Coverage Check

| Requirement | Plan(s) | Verification |
|-------------|---------|--------------|
| WIKI-01: Scheduled job compares wiki page content against recent code changes | 99-02, 99-03 | `wikiStalenessDetector.start()` called in index.ts; 7-day `setInterval` in detector |
| WIKI-02: File-path-level evidence with commit SHAs | 99-02 | `StalePage` has `commitSha` + `changedFilePath`; thread reply format includes both |
| WIKI-03: Staleness report to `#ai-wiki` with top-N stale pages | 99-01, 99-02 | `deliverStalenessReport` posts standalone summary + thread replies; `postStandaloneMessage` added to SlackClient |
| WIKI-04: Staleness threshold configurable via env var | 99-01 | `WIKI_STALENESS_THRESHOLD_DAYS` → `config.wikiStalenessThresholdDays` → passed to detector |
| WIKI-05: Two-tier detection: heuristic first, LLM capped at 20 | 99-02 | `heuristicPass()` → `candidates.slice(0, LLM_CAP)` where `LLM_CAP = 20` |

## Integration Checks

- [ ] `src/db/migrations/012-wiki-staleness-run-state.sql` exists and creates `wiki_staleness_run_state` table
- [ ] `AppConfig` has `slackWikiChannelId`, `wikiStalenessThresholdDays`, `wikiGithubOwner`, `wikiGithubRepo`
- [ ] `SlackClient` interface has `postStandaloneMessage(input: SlackStandaloneMessageInput): Promise<{ ts: string }>`
- [ ] `createSlackClient()` implements `postStandaloneMessage` returning `{ ts }` from Slack API response
- [ ] `src/knowledge/wiki-staleness-types.ts` exports: `WikiPageCandidate`, `StalePage`, `WikiStalenessScanResult`, `WikiStalenessRunState`, `WikiStalenessDetectorOptions`, `WikiStalenessScheduler`
- [ ] `src/knowledge/wiki-staleness-detector.ts` exports `createWikiStalenessDetector` and `heuristicScore`
- [ ] `heuristicScore` filters tokens <= 3 chars, returns 0 when no overlap
- [ ] `runScan()` returns `{ skipped: true, skipReason: "empty_wiki_store" }` when `countBySource()` returns 0
- [ ] `runScan()` caps LLM evaluation at 20 pages (`LLM_CAP = 20`)
- [ ] `deliverStalenessReport` only called when `stalePages.length > 0`
- [ ] On scan failure, failure notification posted to `wikiChannelId` (if configured)
- [ ] `src/index.ts` imports and instantiates `createWikiStalenessDetector`
- [ ] Detector only instantiated when `config.slackWikiChannelId` is truthy
- [ ] `_wikiStalenessDetectorRef` stopped in shutdown manager `closeDb` callback
- [ ] `/wiki[-\s]?check/i` regex in `onAllowedBootstrap` intercepts `@kodiai wiki-check`
- [ ] On-demand trigger uses `requestTracker.trackJob()` for clean shutdown
- [ ] On-demand trigger fires `runScan()` fire-and-forget (no await before return)

## TypeScript / Tests

- [ ] `bun run typecheck` passes with no errors
- [ ] `heuristicScore` unit tests pass (0 on no overlap, positive on overlap, ignores short tokens)
- [ ] `runScan` skip behavior test passes (empty wiki store → skipped)
- [ ] `postStandaloneMessage` test passes (returns `ts` from Slack response)

## Anti-Pattern Checks (must NOT be present)

- [ ] Agent SDK (`query()`) NOT used for staleness LLM evaluation — uses `generateWithFallback()` with `TASK_TYPES.STALENESS_EVIDENCE`
- [ ] Empty report NOT posted — `deliverStalenessReport` only called when `stalePages.length > 0`
- [ ] `wiki_sync_state` table NOT modified or referenced by staleness detector
- [ ] More than 20 pages NOT sent to LLM in a single cycle
- [ ] Deferred pages (beyond 20-page cap) NOT included in the Slack report
- [ ] `RepoConfig` / `.kodiai.yml` NOT used for wiki staleness config (uses env vars via `config.ts`)
- [ ] `streamText()` NOT used anywhere in new files (use `generateText()` only)
