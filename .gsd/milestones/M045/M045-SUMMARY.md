---
id: M045
title: "Contributor Experience Product Contract and Architecture"
status: complete
completed_at: 2026-04-10T16:18:36.648Z
key_decisions:
  - D066 — Keep `verify:m045:s01` as the shared GitHub contributor-experience fixture/report source.
  - D067 — Extend downstream retrieval and Slack surfaces from the contract seam instead of reading raw tier strings.
  - D068 — Project retrieval hints from the contributor-experience contract and suppress hints for generic states.
  - D069 — Project Slack profile and identity-link copy from the contributor-experience contract and hide raw tier/score semantics.
  - D070 — Preserve the nested S01 verifier report inside S03 and author retrieval expectations locally.
  - D071 — Verify Slack and identity-link surfaces through real exported seams plus independent expectations.
key_files:
  - src/contributor/experience-contract.ts
  - src/handlers/review.ts
  - src/execution/review-prompt.ts
  - src/lib/review-utils.ts
  - src/knowledge/multi-query-retrieval.ts
  - src/knowledge/retrieval-query.ts
  - src/slack/slash-command-handler.ts
  - src/handlers/identity-suggest.ts
  - scripts/verify-m045-s01.ts
  - scripts/verify-m045-s03.ts
  - package.json
lessons_learned:
  - An explicit contract seam is cheaper to keep truthful than trying to coordinate multiple surfaces around shared raw tier strings.
  - Nullable downstream projections are the cleanest way to suppress contributor-specific behavior for generic states without inventing placeholder copy or hints.
  - Operator verifiers should preserve upstream proof reports intact and keep new expectations independent from the helpers under test to avoid false-green drift.
---

# M045: Contributor Experience Product Contract and Architecture

**M045 replaced mixed contributor-tier heuristics with one explicit contributor-experience contract and proved that contract across GitHub review, retrieval, Slack, and identity-link surfaces.**

## What Happened

M045 turned contributor experience from mixed raw tier strings and surface-specific heuristics into one explicit contract seam. S01 introduced `src/contributor/experience-contract.ts`, resolved five truthful contract states (`profile-backed`, `coarse-fallback`, `generic-unknown`, `generic-opt-out`, `generic-degraded`), and projected GitHub review prompt wording plus Review Details from that shared contract. S02 extended the same contract into retrieval shaping, Slack `/kodiai profile` and opt controls, and identity-link messaging so generic states stay generic instead of leaking raw tier or score semantics. S03 then packaged those surfaces into a single operator-facing verifier, `bun run verify:m045:s03`, which preserves the S01 GitHub proof report intact while independently checking retrieval hints, Slack copy, and identity-link truthfulness.

Fresh milestone-close verification passed on 2026-04-10: `bun run verify:m045:s03 -- --json` returned `overallPassed: true` with 5 top-level check IDs and an embedded 10-check S01 report across the five contract scenarios, and `bun run tsc --noEmit` exited 0. Code-change verification also passed: `git diff --stat HEAD $(git merge-base HEAD origin/main) -- ':!.gsd/'` showed 41 non-`.gsd/` files changed, including `src/contributor/experience-contract.ts`, `src/handlers/review.ts`, `src/slack/slash-command-handler.ts`, `src/handlers/identity-suggest.ts`, and the new verifier scripts.

## Decision Re-evaluation

| Decision | Re-evaluation |
| --- | --- |
| D066 | Still valid. One shared S01 fixture/report matrix remains the right source of truth for GitHub contributor-experience wording, and S03 successfully embedded it without drift. |
| D067 | Still valid. Extending the contract seam rather than adding another resolver kept downstream surfaces aligned with the same state model. |
| D068 | Still valid. Nullable, contract-owned retrieval hints proved truthful across profile-backed, coarse-fallback, and generic states in the fresh S03 verifier run. |
| D069 | Still valid. Contract-first Slack/profile and identity-link copy stayed truthful for linked, opted-out, malformed, and help/opt-control scenarios. |
| D070 | Still valid. Preserving the nested S01 report inside S03 gave milestone-close verification one top-level operator verdict without losing GitHub scenario detail. |
| D071 | Still valid. Driving the real Slack and identity seams with synthetic fixtures and independent phrase expectations caught the intended drift surface without self-masking. |

## Horizontal Checklist

No separate horizontal checklist items were surfaced during milestone closure beyond the standard verification, requirement, and knowledge-capture obligations, and none remain unchecked from the preloaded roadmap context.

## Success Criteria Results

- ✅ **Explicit review-surface contract:** The GitHub review surface now uses one explicit five-state contributor-experience contract instead of mixed raw tier heuristics. Fresh evidence: `bun run verify:m045:s03 -- --json` preserved the nested S01 report with all 10 GitHub prompt/details checks passing across `profile-backed`, `coarse-fallback`, `generic-unknown`, `generic-opt-out`, and `generic-degraded` scenarios.
- ✅ **Downstream retrieval + Slack + opt-out coherence:** Retrieval shaping, Slack `/kodiai profile`/help/opt controls, and identity-link messaging now project from the same contract and suppress contributor-specific behavior for generic states. Fresh evidence: the same S03 verifier passed `M045-S03-RETRIEVAL-MULTI-QUERY-CONTRACT`, `M045-S03-RETRIEVAL-LEGACY-QUERY-CONTRACT`, `M045-S03-SLACK-SURFACES-CONTRACT`, and `M045-S03-IDENTITY-LINK-CONTRACT`, covering 5 retrieval scenarios, 6 Slack scenarios, and 4 identity scenarios.
- ✅ **Single operator proof surface:** Operators now have one named verifier command with human-readable and JSON output. Fresh evidence: `bun run verify:m045:s03 -- --json` emitted top-level `check_ids`, per-scenario diagnostics, nested S01 evidence, and `overallPassed: true`; S03 summary and task artifacts already document the same command as the milestone proof surface.

## Definition of Done Results

- ✅ **All slices complete:** `gsd_milestone_status` shows S01, S02, and S03 all `complete`, with task counts 3/3, 2/2, and 2/2 respectively.
- ✅ **All slice summaries exist:** `find .gsd/milestones/M045 -type f` confirmed `S01-SUMMARY.md`, `S02-SUMMARY.md`, and `S03-SUMMARY.md` are present alongside their task summaries and UAT artifacts.
- ✅ **Cross-slice integration works:** `bun run verify:m045:s03 -- --json` passed the embedded S01 GitHub checks plus the S02/S03 retrieval, Slack, and identity-link checks, proving the assembled milestone works coherently across slice boundaries.
- ✅ **Type-level integrity preserved:** `bun run tsc --noEmit` exited 0 at milestone close.
- ✅ **Real code shipped, not only planning artifacts:** `git diff --stat HEAD $(git merge-base HEAD origin/main) -- ':!.gsd/'` showed 41 non-`.gsd/` files changed.

## Requirement Outcomes

- **R046:** No status transition in milestone close. R046 was advanced substantially by M045: S01 defined the contract seam for GitHub review prompt/details, S02 extended the same contract into retrieval hints and Slack/identity surfaces, and S03 added the unified verifier that proves those in-scope surfaces stay coherent. Evidence: `bun run verify:m045:s03 -- --json` returned `overallPassed: true` with embedded S01 checks plus retrieval, Slack, and identity coverage.
- **Status:** R046 remains `active`, not `validated`, because its requirement text explicitly reserves the shipped-surface coherence proof for M047 even though M045 completed the architecture and in-scope surface contract work.

## Deviations

S01/T03 fixed two adjacent strictness blockers outside the original slice file list (`scripts/verify-m044-s01.test.ts` and `src/handlers/review-idempotency.ts`) so the milestone could hold a clean `tsc --noEmit` bar. No milestone-level replan was required.

## Follow-ups

M046 should calibrate contributor fixtures and scoring against the new contract seam before any broader rollout changes. M047 should validate the shipped surfaces against the post-calibration design, then decide whether remaining legacy `authorTier` compatibility paths can be removed. If identity-suggestion anti-spam guarantees need to survive restarts, persist the one-shot suppression state instead of keeping it process-local.
