---
id: T02
parent: S02
milestone: M048
key_files:
  - src/execution/executor.ts
  - src/execution/agent-entrypoint.ts
  - src/execution/prepare-agent-workspace.test.ts
  - .gsd/KNOWLEDGE.md
key_decisions:
  - Use `resolveRepoTransport(...)` as the worker's canonical handoff contract so `repoTransport` metadata, malformed-config failures, and legacy bundle fallback all stay consistent in one place.
  - Record review transport diagnostics by kind/head/base rather than logging workspace-internal paths, preserving observability without expanding leaked filesystem detail.
duration: 
verification_result: mixed
completed_at: 2026-04-13T01:21:18.939Z
blocker_discovered: false
---

# T02: Restored the fast review-bundle handoff by fixing Bun git-ref staging and teaching the worker entrypoint to consume repoTransport metadata truthfully.

**Restored the fast review-bundle handoff by fixing Bun git-ref staging and teaching the worker entrypoint to consume repoTransport metadata truthfully.**

## What Happened

I kept the new transport coverage red first by reproducing the failing `prepareAgentWorkspace(...)` and `agent-entrypoint.ts` paths before changing production code. The first failure was in `src/execution/executor.ts`: Bun's `$` shell was parsing the bare `%(refname:strip=3)` expression in `git for-each-ref` as shell syntax, so the optimized review-bundle staging path crashed before git ran. I fixed that by quoting the format expression so review-bundle candidate detection works under Bun and the cheaper bundle path is actually reachable again.

I then finished the remote handoff seam in `src/execution/agent-entrypoint.ts` by switching the worker to the canonical `repoTransport` contract that the executor already writes. The entrypoint now resolves transport metadata through `resolveRepoTransport(...)`, materializes `review-bundle` transports by cloning the head branch from the bundle, preserves origin-based git behavior when an origin URL is present, and fails early into `result.json` when repoTransport metadata is malformed instead of invoking the SDK against a broken cwd. I also added transport diagnostics that record which transport path ran (`review-bundle` vs `bundle-all`, plus head/base refs for review bundles) without logging workspace-internal paths.

I did not need to change `src/execution/executor.test.ts` or `src/handlers/review.test.ts`; local reality already had the continuity/idempotency coverage the plan called for. I reran those suites to prove the `executor handoff`/`remote runtime` timing surfaces and review publication behavior stayed unchanged. I also aligned the stale test-only repoTransport type in `src/execution/prepare-agent-workspace.test.ts` and appended the Bun `for-each-ref --format` quoting gotcha to `.gsd/KNOWLEDGE.md` so future agents do not repeat the same failure.

## Verification

Verified the task contract with the focused T02 suite (`bun test ./src/execution/prepare-agent-workspace.test.ts ./src/execution/agent-entrypoint.test.ts ./src/execution/executor.test.ts ./src/handlers/review.test.ts`) and the repo typecheck (`bun run tsc --noEmit`); both passed. I also ran the broader S02 slice test bundle from the slice plan, and it passed for every existing file, including the unchanged ACA launcher coverage and the wired `verify-m048-s01` tests. To avoid a false green, I separately verified that `scripts/verify-m048-s02.ts` / `scripts/verify-m048-s02.test.ts` are still absent and that `bun run verify:m048:s02 -- --baseline-review-output-key "$BASELINE_REVIEW_OUTPUT_KEY" --candidate-review-output-key "$REVIEW_OUTPUT_KEY" --json` currently fails with `Script not found "verify:m048:s02"`; that live compare verifier remains pending downstream work rather than being silently treated as complete.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/execution/prepare-agent-workspace.test.ts ./src/execution/agent-entrypoint.test.ts ./src/execution/executor.test.ts ./src/handlers/review.test.ts` | 0 | ✅ pass | 6487ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 11180ms |
| 3 | `bun test ./src/jobs/aca-launcher.test.ts ./src/execution/prepare-agent-workspace.test.ts ./src/execution/agent-entrypoint.test.ts ./src/execution/executor.test.ts ./src/handlers/review.test.ts ./scripts/verify-m048-s01.test.ts ./scripts/verify-m048-s02.test.ts` | 0 | ✅ pass | 6483ms |
| 4 | `BASELINE_REVIEW_OUTPUT_KEY='' REVIEW_OUTPUT_KEY='' bun run verify:m048:s02 -- --baseline-review-output-key "$BASELINE_REVIEW_OUTPUT_KEY" --candidate-review-output-key "$REVIEW_OUTPUT_KEY" --json` | 1 | ❌ fail | 7ms |

## Deviations

Did not edit `src/execution/executor.test.ts` or `src/handlers/review.test.ts`; those files already contained the executor-phase and publication/idempotency continuity assertions the plan asked for, so I reused and reran that coverage instead of duplicating it.

## Known Issues

`scripts/verify-m048-s02.ts`, `scripts/verify-m048-s02.test.ts`, and the `verify:m048:s02` package script are still not present. Because Bun ignores missing path filters inside multi-file `bun test` bundles, the broader slice test command can exit 0 without proving that missing comparator path; the live compare verification remains pending T03.

## Files Created/Modified

- `src/execution/executor.ts`
- `src/execution/agent-entrypoint.ts`
- `src/execution/prepare-agent-workspace.test.ts`
- `.gsd/KNOWLEDGE.md`
