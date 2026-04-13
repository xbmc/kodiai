---
id: S02
parent: M048
milestone: M048
provides:
  - A faster single-worker ACA polling path without changing phase boundaries.
  - A cheaper review-bundle handoff/materialization seam for downstream review execution work.
  - A reusable before/after compare command for live latency proof on the existing M048 evidence surface.
requires:
  - slice: S01
    provides: Six-phase timing contract, Review Details evidence shape, and the `verify:m048:s01` Azure-backed verifier surface.
affects:
  - S03
key_files:
  - src/jobs/aca-launcher.ts
  - src/jobs/aca-launcher.test.ts
  - scripts/test-aca-job.ts
  - src/execution/executor.ts
  - src/execution/agent-entrypoint.ts
  - src/execution/prepare-agent-workspace.test.ts
  - scripts/verify-m048-s01.ts
  - scripts/verify-m048-s02.ts
  - scripts/verify-m048-s02.test.ts
  - package.json
  - .gsd/KNOWLEDGE.md
key_decisions:
  - D108 — shared 5s ACA polling cadence with debug-only malformed/unknown status drift logs.
  - D109 — compare only targeted latency phases while evaluating publication continuity separately.
  - D110 — treat resolveRepoTransport(...) as the canonical worker handoff contract for optimized review execution.
  - D111 — expose review transport diagnostics by kind/head/base without logging workspace-internal paths.
patterns_established:
  - Env-backed verifier scripts must not consume the next `--flag` when a required value expands to empty; return a named skipped status instead.
  - Embed the full S01 verifier report inside higher-level compare tooling instead of inventing a second evidence contract.
  - Canonicalize repo transport resolution in one seam so optimized handoff, malformed-metadata failure, and legacy fallback stay consistent.
observability_surfaces:
  - GitHub Review Details six-phase timing matrix.
  - `Review phase timing summary` rows in Azure Log Analytics.
  - `verify:m048:s01` phase-evidence output.
  - `verify:m048:s02` baseline/candidate compare report with publication continuity state.
  - ACA polling debug diagnostics and review transport kind/head/base diagnostics.
drill_down_paths:
  - .gsd/milestones/M048/slices/S02/tasks/T01-SUMMARY.md
  - .gsd/milestones/M048/slices/S02/tasks/T02-SUMMARY.md
  - .gsd/milestones/M048/slices/S02/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-13T01:45:03.068Z
blocker_discovered: false
---

# S02: Single-Worker Path Latency Reduction

**Reduced fixed single-worker review-path overhead with 5s ACA polling, cheaper review-bundle handoff/materialization, and a compare verifier that preserves the six-phase/publication contract while skipping truthfully when live review keys are absent.**

## What Happened

## Delivered

This slice landed the three planned latency-reduction seams without moving the S01 timing boundaries.

- `src/jobs/aca-launcher.ts` now uses a shared 5s ACA poll cadence, keeps timeout/terminal semantics unchanged, and emits focused debug diagnostics for malformed or unknown execution-status drift. `scripts/test-aca-job.ts` uses the same exported cadence, and the launcher tests cover success, retry, malformed payload, and timeout behavior.
- `src/execution/executor.ts` and `src/execution/agent-entrypoint.ts` restored the cheaper review-bundle handoff/materialization path. The worker now resolves transport metadata through one canonical `resolveRepoTransport(...)` seam, preserves origin-based git behavior when available, keeps shallow-repo correctness, and fails early on malformed transport metadata instead of running against a broken cwd.
- `scripts/verify-m048-s02.ts` plus `scripts/verify-m048-s02.test.ts` and `package.json` added the operator compare command. It embeds the full S01 verifier reports for baseline and candidate, compares only `workspace preparation`, `executor handoff`, and `remote runtime`, and reports publication continuity separately so a faster runtime cannot hide GitHub publication regressions.
- During slice closeout, the compare verifier was hardened to match the S01 env-backed verifier behavior: when automation expands `BASELINE_REVIEW_OUTPUT_KEY` / `REVIEW_OUTPUT_KEY` to empty values, the script now returns a named skipped status instead of misclassifying the run as an invalid compare request.

## What the slice actually proved

The code/test contract for the single-worker fast path is complete:

- focused ACA polling coverage proves the shorter cadence does not move timeout or terminal semantics,
- executor/entrypoint/handler coverage proves the faster repo handoff still supports real review git operations and does not regress publication/idempotency behavior,
- the new compare verifier is wired, tested, and now runnable in unattended automation without false-negative failures when live keys are absent.

What is still operationally pending is the final real-world latency proof on a freshly deployed revision. In this automation environment there was no injected baseline/candidate review key pair, so the live compare command could only prove the truthful skipped path rather than a measured negative latency delta on the real xbmc review path.

## Operational Readiness (Q8)

- **Health signal:** `verify:m048:s02` returns a structured baseline/candidate report with targeted phase deltas and publication continuity state; ACA polling debug logs show the shared 5s cadence; review transport diagnostics identify `review-bundle` vs `bundle-all` without leaking workspace paths.
- **Failure signal:** `m048_s02_publication_regressed`, `m048_s02_inconclusive`, degraded/unavailable targeted phases, missing phase-summary rows, or a skipped compare result caused by absent env-backed review keys.
- **Recovery procedure:** supply fresh baseline/candidate review keys from the last 14 days, rerun `verify:m048:s02`, inspect Review Details plus Azure phase-summary evidence, and if the compare remains inconclusive verify that the deployed revision is emitting `Review phase timing summary` rows before re-running the live review.
- **Monitoring gaps:** this slice still needs one fresh deployed before/after review pair to prove the production latency delta and advance `R050` from active to validated.


## Verification

- `bun test ./src/jobs/aca-launcher.test.ts ./src/execution/prepare-agent-workspace.test.ts ./src/execution/agent-entrypoint.test.ts ./src/execution/executor.test.ts ./src/handlers/review.test.ts ./scripts/verify-m048-s01.test.ts ./scripts/verify-m048-s02.test.ts` — passed (196 pass, 0 fail).
- `bun run tsc --noEmit` — passed (exit 0).
- `BASELINE_REVIEW_OUTPUT_KEY='' REVIEW_OUTPUT_KEY='' bun run verify:m048:s02 -- --baseline-review-output-key "$BASELINE_REVIEW_OUTPUT_KEY" --candidate-review-output-key "$REVIEW_OUTPUT_KEY" --json` — passed (exit 0) and returned `m048_s02_skipped_missing_review_output_keys`, proving the env-backed automation path now skips truthfully instead of failing on empty compare inputs.
- Observability/diagnostic surfaces remain intact: the compare verifier still emits targeted phase deltas plus publication continuity fields, and the runtime logs/Review Details contract from S01 remains the shared evidence source.

## Requirements Advanced

- R050 — Reduced fixed single-worker overhead and added the S02 compare/report surface while preserving the six-phase/publication evidence contract; final live validation still requires a fresh deployed review pair.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

The planned live before/after compare could not be executed end-to-end in auto-mode because no fresh baseline/candidate review keys were injected into the environment. The compare verifier now handles that automation case truthfully by returning a named skipped status instead of failing the slice gate.

## Known Limitations

A fresh deployed S02 review pair inside the verifier's 14-day window is still required to prove the actual production latency win and fully validate `R050`. Current automation verified the code/test contract and the truthful skipped live-compare path, not the live negative latency delta itself.

## Follow-ups

After deployment, trigger a fresh xbmc review on the same path as the S01 baseline, capture the new candidate key, rerun `verify:m048:s02`, and record the targeted delta plus publication continuity result as milestone-level evidence before closing M048.

## Files Created/Modified

- `src/jobs/aca-launcher.ts` — Reduced the default ACA poll cadence to 5s and added drift-focused debug diagnostics without changing timeout/terminal semantics.
- `src/execution/executor.ts` — Restored the fast review-bundle staging path and aligned executor-side transport metadata with the worker contract.
- `src/execution/agent-entrypoint.ts` — Materializes canonical repoTransport metadata, preserves origin-based git behavior, and fails early on malformed transport config.
- `scripts/verify-m048-s02.ts` — Added the operator compare verifier and hardened the empty-env compare path to skip truthfully.
- `.gsd/KNOWLEDGE.md` — Captured the env-backed verifier empty-value parsing rule and other S02 gotchas for future slices.
