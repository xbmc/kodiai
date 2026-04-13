---
id: M048
title: "PR Review Latency Reduction and Bounded Execution"
status: complete
completed_at: 2026-04-13T13:53:42.603Z
key_decisions:
  - D104 — Capture latency at the real queue/executor/handler seams and merge it into one correlated six-phase timing contract.
  - D105 — Keep GitHub Review Details publication timing truthful via a degraded snapshot until the write completes.
  - D106 — Correlate S01 live evidence tightly by reviewOutputKey, effective deliveryId, and exact phase-summary message.
  - D108 — Use a shared 5s ACA polling cadence with debug-only malformed/unknown status drift diagnostics.
  - D109 — Compare only S02-targeted latency phases while tracking publication continuity separately.
  - D110 — Use resolveRepoTransport(...) as the canonical optimized review handoff contract.
  - D112/D114 — Compute bounded-review disclosure once and reuse it across prompt, Review Details, summary backfill, and verifier surfaces.
  - D113/D115 — Treat synchronize continuity as checked-in config plus verifier truth, with legacy top-level intent disabled-with-warning rather than auto-mapped.
key_files:
  - .kodiai.yml
  - package.json
  - scripts/test-aca-job.ts
  - scripts/verify-m048-s01.ts
  - scripts/verify-m048-s02.ts
  - scripts/verify-m048-s03.ts
  - src/execution/agent-entrypoint.ts
  - src/execution/config.ts
  - src/execution/executor.ts
  - src/execution/review-prompt.ts
  - src/handlers/review.ts
  - src/jobs/aca-launcher.ts
  - src/jobs/queue.ts
  - src/lib/review-boundedness.ts
  - src/lib/review-utils.ts
  - src/review-audit/phase-timing-evidence.ts
lessons_learned:
  - One shared evidence contract is cheaper and safer than parallel verifier schemas; S02/S03 stayed coherent because they embedded or reused the S01 phase-timing surface instead of inventing their own.
  - Truthful degraded/skipped states are part of the product contract, not a fallback detail; the env-backed verifiers and bounded-review surfaces are reliable specifically because missing live inputs stay explicit.
  - Milestone completion can be correct even when deployment-only proof remains pending, but the requirement ledger must distinguish 'validated' from 'active pending live evidence' instead of flattening everything into a green milestone.
---

# M048: PR Review Latency Reduction and Bounded Execution

**M048 shipped a truthful six-phase latency evidence contract, reduced single-worker review overhead, and added bounded-review/synchronize verification surfaces without hiding the remaining live-proof gap.**

## What Happened

M048 closed the code-and-operator-surface part of the latency reduction effort without pretending the remaining deployed proof already exists. S01 established one correlated six-phase `Review phase timing summary` contract across queue, handler, executor, Review Details, and Azure-backed verification. S02 then reduced fixed single-worker overhead by shortening ACA polling cadence and restoring the cheaper review-bundle transport/materialization seam while keeping publication continuity on a separate proof track. S03 finished the product-truthfulness side by making synchronize-trigger intent explicit in checked-in config, centralizing bounded-review disclosure into one shared contract, and shipping a verifier that proves local config/disclosure health now while reusing the existing phase-timing evidence seam for optional live proof later.

Fresh milestone-close verification confirmed the integrated shape is still intact: `git diff --stat HEAD $(git merge-base HEAD main) -- ':!.gsd/'` showed non-`.gsd/` code changes across 47 files; `gsd_milestone_status` reported S01/S02/S03 complete with all 9 tasks done; `find .gsd/milestones/M048 -maxdepth 3 -type f \( -name 'S*-SUMMARY.md' -o -name 'T*-SUMMARY.md' \) | sort` confirmed all three slice summaries exist; and the full M048 verification suite passed with 530 tests green, `bun run tsc --noEmit`, `verify:m048:s01`, `verify:m048:s02`, and `verify:m048:s03` all returning truthful success states.

## Decision Re-evaluation

| Decision | Verdict | Notes |
| --- | --- | --- |
| D104 | Keep | The shared six-phase seam is still the right observability boundary; the fresh suite exercised queue, executor, handler, Review Details, and verifier consumers against one contract. |
| D105 | Keep, revisit later if we add a second-pass GitHub update | The degraded Review Details publication line is still the truthful GitHub-facing representation because a single write cannot know its own final end-to-end publication duration. |
| D106 | Keep | Tight `reviewOutputKey`/`deliveryId`/exact-message correlation is still necessary to avoid false-green Azure evidence. |
| D108 | Keep | The 5s ACA polling cadence remained compatible with timeout and terminal-status behavior in the fresh launcher tests. |
| D109 | Keep, revisit after a fresh deployed before/after pair if needed | Comparing only the phases S02 actually targets while tracking publication continuity separately remains the right proof split. |
| D110 | Keep | `resolveRepoTransport(...)` remains the correct single handoff seam for optimized review-bundle execution, legacy fallback, and malformed-config failure. |
| D111 | Keep | Transport diagnostics by kind/head/base still provide enough visibility without leaking workspace-internal paths. |
| D112 | Keep | One bounded-review truth contract still prevents drift across prompt, Review Details, summary backfill, and verifier fixtures. |
| D113 | Keep, revisit after fresh live synchronize evidence if operator needs change | Local preflight plus optional live proof kept closeout deterministic while preserving a truthful path to runtime evidence. |
| D114 | Keep | Handler-side boundedness resolution remained the correct single source of disclosure wording in the fresh suite. |
| D115 | Keep | Leaving legacy `review.onSynchronize` disabled-with-warning is still the right compatibility behavior because auto-mapping would hide config drift. |

The remaining gap is operational rather than architectural: no fresh deployed baseline/candidate latency pair or synchronize-triggered live review key was available in this automation run, so M048 closes with R050 and R051 still active while R052 stays validated.

## Success Criteria Results

- ✅ **Durable phase timing exists on the real review path surfaces.** S01 delivered one canonical six-phase contract across `src/jobs/queue.ts`, `src/execution/executor.ts`, `src/handlers/review.ts`, `src/lib/review-utils.ts`, `src/review-audit/phase-timing-evidence.ts`, and `scripts/verify-m048-s01.ts`. Fresh closeout verification kept that contract green via `bun test ... ./src/jobs/queue.test.ts ... ./src/review-audit/phase-timing-evidence.test.ts ./scripts/verify-m048-s01.test.ts` and `REVIEW_OUTPUT_KEY='' bun run verify:m048:s01 -- --review-output-key "$REVIEW_OUTPUT_KEY" --json`, which returned the truthful skipped live-proof state instead of a false failure.
- ✅ **Single-worker fixed overhead was reduced without breaking publication continuity accounting.** S02 landed the 5s ACA polling cadence in `src/jobs/aca-launcher.ts`, restored the optimized review-bundle handoff/materialization seam in `src/execution/executor.ts` and `src/execution/agent-entrypoint.ts`, and added `scripts/verify-m048-s02.ts` to compare only `workspace preparation`, `executor handoff`, and `remote runtime` while tracking publication continuity separately. Fresh closeout verification kept these contracts green through the combined 530-test suite and `BASELINE_REVIEW_OUTPUT_KEY='' REVIEW_OUTPUT_KEY='' bun run verify:m048:s02 -- --baseline-review-output-key "$BASELINE_REVIEW_OUTPUT_KEY" --candidate-review-output-key "$REVIEW_OUTPUT_KEY" --json`, which returned `m048_s02_skipped_missing_review_output_keys` truthfully.
- ✅ **Bounded-review disclosure and synchronize continuity are explicit and operator-verifiable.** S03 shipped the supported nested synchronize trigger in `.kodiai.yml`, config compatibility warnings in `src/execution/config.ts`, the shared bounded-review contract in `src/lib/review-boundedness.ts`, prompt/Review Details/summary reuse across `src/execution/review-prompt.ts`, `src/lib/review-utils.ts`, and `src/handlers/review.ts`, and the `scripts/verify-m048-s03.ts` verifier. Fresh closeout verification passed `REVIEW_OUTPUT_KEY='' bun run verify:m048:s03 -- --review-output-key "$REVIEW_OUTPUT_KEY" --json`, which confirmed effective `onSynchronize: true`, green bounded-disclosure fixtures, and a truthful skipped live-proof branch when no synchronize review key was supplied.
- ℹ️ **Operational follow-up remains:** the milestone code and verifier surfaces are complete, but a fresh deployed baseline/candidate pair and a live synchronize-triggered review key are still needed to validate R050/R051 in production. This did not block the milestone because the coded success criteria above were met and verified, but it remains tracked follow-up work.

## Definition of Done Results

- ✅ **All slices complete.** `gsd_milestone_status` reported S01, S02, and S03 all `complete`, with 9/9 tasks done.
- ✅ **Slice summaries exist.** `find .gsd/milestones/M048 -maxdepth 3 -type f \( -name 'S*-SUMMARY.md' -o -name 'T*-SUMMARY.md' \) | sort` returned `S01-SUMMARY.md`, `S02-SUMMARY.md`, and `S03-SUMMARY.md`.
- ✅ **Real code shipped, not just planning artifacts.** `git diff --stat HEAD $(git merge-base HEAD main) -- ':!.gsd/'` showed non-`.gsd/` changes across 47 tracked code/config/docs files.
- ✅ **Cross-slice integration still works.** Fresh milestone-close verification passed 530 tests across the integrated M048 surface, plus `bun run tsc --noEmit`, `verify:m048:s01`, `verify:m048:s02`, and `verify:m048:s03`.
- ✅ **Horizontal checklist.** No separate Horizontal Checklist was present in the inlined roadmap context, so there were no additional checklist items to verify.

## Requirement Outcomes

- **R052 — remains validated (reconfirmed at closeout).** `gsd_requirement_update` refreshed the validation record after fresh milestone-close verification. Evidence: the combined 530-test suite, `bun run tsc --noEmit`, and `REVIEW_OUTPUT_KEY='' bun run verify:m048:s03 -- --review-output-key "$REVIEW_OUTPUT_KEY" --json` all passed while preserving the exact bounded-review disclosure contract across prompt, GitHub-visible summary, Review Details, and verifier fixtures.
- **R050 — remains active.** Evidence from S01/S02 plus fresh closeout verification proves the six-phase timing surface, Azure-backed verifier, and latency-compare tooling exist and pass locally, but no fresh deployed baseline/candidate review pair was available in this automation run to validate the live production latency evidence requirement.
- **R051 — remains active.** Fresh `verify:m048:s03` local proof confirmed the checked-in nested synchronize trigger is effective and legacy top-level intent would fail loudly, but no fresh live synchronize `reviewOutputKey` was supplied to validate runtime continuity end to end.
- **No requirements were invalidated or re-scoped during milestone closeout.**

## Deviations

Milestone closeout did not produce fresh deployed latency or synchronize runtime evidence because no live review keys were injected into this automation environment. The code-and-verifier milestone criteria were still met; the remaining work is explicitly tracked as operational follow-up.

## Follow-ups

Deploy the M048 code if not already live, capture a fresh baseline/candidate review pair within the verifier's 14-day window, rerun `verify:m048:s02`, capture a fresh synchronize-triggered `reviewOutputKey`, rerun `verify:m048:s03` in live mode, and update R050/R051 when deployed proof is available.
