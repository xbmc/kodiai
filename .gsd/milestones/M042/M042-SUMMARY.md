---
id: M042
title: "Contributor Tier Truthfulness"
status: complete
completed_at: 2026-04-06T23:19:00.714Z
key_decisions:
  - Treat the persistent contributor profile tier as the highest-fidelity author-context signal and fix its advancement behavior instead of patching review prompt wording around misclassifications.
  - Keep M042 focused on tier-advancement correctness, review-surface truthfulness, and cache/fallback consistency rather than broad contributor-tier recalibration work.
  - Recalculate and persist contributor tiers inside scorer update paths, then resolve review author tier through explicit contributor-profile → cache → fallback precedence.
  - Bound `author_cache` to fallback-taxonomy values only and ignore unsupported cached tiers fail-open with a warning instead of trusting them as richer contributor knowledge.
key_files:
  - src/contributor/expertise-scorer.ts
  - src/contributor/expertise-scorer.test.ts
  - src/contributor/tier-calculator.ts
  - src/contributor/tier-calculator.test.ts
  - src/handlers/review.ts
  - src/handlers/review.test.ts
  - src/execution/review-prompt.ts
  - src/execution/review-prompt.test.ts
  - src/lib/review-utils.ts
  - src/lib/review-utils.test.ts
  - src/knowledge/types.ts
  - src/knowledge/store.ts
  - scripts/verify-m042-s01.ts
  - scripts/verify-m042-s02.ts
  - scripts/verify-m042-s03.ts
  - package.json
lessons_learned:
  - Contributor-experience truthfulness belongs at persistence time first; render-time patches around stale stored state treat the symptom, not the defect.
  - Lower-fidelity caches need an explicit taxonomy boundary. If cache data can overclaim richer states than the fallback classifier can prove, stale cache becomes a product bug rather than a performance optimization.
  - Full rendered-body assertions with required and banned phrases are the right regression shape for wording-truthfulness work; metadata-only assertions are too weak.
  - Named proof harnesses with stable check IDs make milestone closure materially safer because the final close can rerun the exact behavioral contract instead of trusting prior summaries.
---

# M042: Contributor Tier Truthfulness

**M042 fixed the CrystalP-shaped contributor misclassification by making stored contributor tiers advance truthfully, wiring that corrected state into review surfaces, and bounding cache/fallback paths so lower-fidelity signals cannot reintroduce newcomer-style guidance for established contributors.**

## What Happened

M042 closed the contributor-tier truthfulness defect from the source of record outward. S01 reproduced the stale-tier persistence bug in the scorer path, extracted shared percentile helpers into `src/contributor/tier-calculator.ts`, and changed incremental expertise updates to recalculate and persist contributor tiers when overall scores advance, while keeping the recalculation seam fail-open so review completion is never blocked by enrichment failures. S01 also established the explicit review-resolution precedence contract — contributor profile first, then cache, then fallback — so corrected stored state outranks lower-fidelity signals.

S02 then wired that corrected state into the user-visible review surfaces instead of inventing new heuristics. Prompt author-experience guidance and Review Details wording now render explicit developing/established/senior contributor guidance from the resolved tier, with regression guards that require the right phrases and ban contradictory newcomer/developing copy for established contributors. The CrystalP-shaped repro is covered directly by the slice verifier and proves both prompt and Review Details stay established once the contributor-profile source is correct.

S03 hardened the remaining lower-fidelity paths. `author_cache` is now bounded to fallback-taxonomy values only (`first-time`, `regular`, `core`); unsupported cached values are ignored fail-open with a warning instead of being trusted as richer contributor knowledge. Handler-level regressions prove cache hits, contradictory cache rows, and degraded fallback runs preserve truthful author guidance in the rendered bodies rather than drifting back toward newcomer copy. The exact Search API degradation disclosure sentence is now part of the deterministic proof surface, so degraded behavior is both truthful and mechanically verified.

Milestone closure reran all three slice proof harnesses against the assembled codebase and they all passed. The result is a complete end-to-end truthfulness contract for contributor experience in reviews: persistence-time tier advancement, explicit render-surface consumption, bounded cache reuse, and non-contradictory degraded fallback behavior.

## Success Criteria Results

- **CrystalP-shaped repro no longer mislabels an established contributor as a newcomer.** Met. `bun run verify:m042:s02` passed `M042-S02-CRYSTALP-SURFACES-STAY-ESTABLISHED`, explicitly proving both prompt and Review Details remain established and exclude newcomer/developing guidance for the repro-shaped case.
- **Stored contributor tiers advance truthfully when score signals advance.** Met. `bun run verify:m042:s01` passed `M042-S01-STUCK-TIER-REPRO-FIXED` and `M042-S01-RECALCULATED-TIER-PERSISTS`, proving the scorer now recalculates and persists the updated tier instead of persisting stale low-tier state.
- **Review surfaces consume the corrected contributor-profile tier explicitly.** Met. `bun run verify:m042:s02` passed `M042-S02-PROFILE-TIER-DRIVES-SURFACE`, `M042-S02-PROMPT-ESTABLISHED-TRUTHFUL`, and `M042-S02-DETAILS-ESTABLISHED-TRUTHFUL`, showing the resolved contributor-profile tier drives prompt and Review Details wording directly.
- **Cache reuse and degraded fallback paths cannot reintroduce contradictory low-tier labeling.** Met. `bun run verify:m042:s03` passed `M042-S03-CACHE-HIT-SURFACE-TRUTHFUL`, `M042-S03-PROFILE-OVERRIDES-CONTRADICTORY-CACHE`, and `M042-S03-DEGRADED-FALLBACK-NONCONTRADICTORY`, demonstrating bounded cache reuse, contributor-profile precedence over contradictory cache, and truthful degraded fallback output.
- **Milestone produced real code changes rather than only planning artifacts.** Met. `git diff --name-only HEAD $(git merge-base HEAD main) -- ':!.gsd/'` returned multiple non-`.gsd/` source/test/script files under `src/` and `scripts/`, confirming the milestone changed production code and verification surfaces.

## Definition of Done Results

- **All roadmap slices complete.** Met. S01, S02, and S03 are all complete in the roadmap context and each slice summary exists on disk.
- **All slice summaries exist.** Met. Verified presence of `.gsd/milestones/M042/slices/S01/S01-SUMMARY.md`, `.gsd/milestones/M042/slices/S02/S02-SUMMARY.md`, and `.gsd/milestones/M042/slices/S03/S03-SUMMARY.md`.
- **Cross-slice integration works when assembled.** Met. Milestone closure reran `bun run verify:m042:s01`, `bun run verify:m042:s02`, and `bun run verify:m042:s03`; all passed against the assembled post-slice codebase, proving persistence fixes, review rendering, and cache/degraded-path hardening work together.
- **Verification gate remains green at milestone close.** Met. Fresh milestone-close reruns of the slice proof harnesses all passed, and no missing-artifact or unmet-success-criterion blocker remains after this completion write.
- **Horizontal checklist items addressed.** No separate horizontal checklist was present in the M042 roadmap, so there were no additional horizontal items to verify.

## Requirement Outcomes

- **R039 → validated.** Supported by S01 and fresh milestone-close reruns. `bun run verify:m042:s01` passed `M042-S01-STUCK-TIER-REPRO-FIXED` and `M042-S01-RECALCULATED-TIER-PERSISTS`, proving contributor-tier truthfulness is now enforced at persistence time when scorer updates advance overall score.
- **R040 → validated.** Supported by S02 and fresh milestone-close reruns. `bun run verify:m042:s02` passed `M042-S02-PROFILE-TIER-DRIVES-SURFACE`, `M042-S02-PROMPT-ESTABLISHED-TRUTHFUL`, `M042-S02-DETAILS-ESTABLISHED-TRUTHFUL`, and `M042-S02-CRYSTALP-SURFACES-STAY-ESTABLISHED`, proving review output now renders truthful established-tier guidance from the corrected contributor-profile state.
- **R041 → validated.** Supported by S03 and fresh milestone-close reruns. `bun run verify:m042:s03` passed `M042-S03-CACHE-HIT-SURFACE-TRUTHFUL`, `M042-S03-PROFILE-OVERRIDES-CONTRADICTORY-CACHE`, and `M042-S03-DEGRADED-FALLBACK-NONCONTRADICTORY`, proving cache and degraded fallback paths do not reintroduce contradictory contributor labeling.
- **R042 → validated.** Supported by the full milestone proof-harness path. Fresh reruns of `bun run verify:m042:s01`, `bun run verify:m042:s02`, and `bun run verify:m042:s03` all passed, giving the original repro and adjacent cases a durable, repeatable mechanical regression surface.

### Decision Re-evaluation

| Decision | Re-evaluation | Status |
|---|---|---|
| D042 — persistent contributor profile tier is the highest-fidelity source of truth | Still valid. S01 showed the root cause was stale persisted tier state, and fixing persistence removed pressure to invent review-surface overrides. | Keep |
| D043 — keep M042 focused on correctness, truthfulness wiring, and cache/fallback consistency | Still valid. The milestone closed the concrete defect without expanding into a broader repo-wide recalibration or tone-model redesign effort. | Keep |
| D044 — enforce contributor-tier truthfulness in scorer persistence, then trust contributor-profile state over cache/fallback | Still valid. All slice verifiers and the assembled milestone reruns support this persistence-first contract, and no evidence suggests render-time overrides would be a better source of truth. | Keep |

## Deviations

S02 documented that the existing `runProfileScenario()` seam was not strong enough to serve as the authoritative established/senior end-to-end proof path. The milestone handled this honestly by relying on production render helpers plus deterministic slice verifiers, then closing the remaining cache/degraded-path proof in S03 rather than shipping a misleading green orchestration test.

## Follow-ups

If future product work wants broader contributor-tier recalibration or tone redesign, treat that as a separate milestone. M042 fixed the correctness path; it did not attempt to redefine the overall contributor taxonomy. Also consider extending handler-level live review orchestration proof further if future changes make the current deterministic slice harnesses insufficient.
