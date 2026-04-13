---
id: S03
parent: M048
milestone: M048
provides:
  - Truthful synchronize-trigger continuity from checked-in repo config through effective handler gating.
  - One bounded-review disclosure contract shared by prompt, Review Details, GitHub summary publication, and verifier fixtures.
  - An operator verifier that proves local config/disclosure health now and can prove the live synchronize path later with the existing `reviewOutputKey` evidence seam.
requires:
  - slice: S01
    provides: Shared `reviewOutputKey` correlation contract, six-phase Review Details/Azure evidence seam, and `verify:m048:s01` live report embedding.
  - slice: S02
    provides: Env-backed verifier skip behavior for empty live keys and the established rule to reuse higher-level proof surfaces instead of inventing parallel evidence.
affects:
  []
key_files:
  - .kodiai.yml
  - src/execution/config.ts
  - src/execution/config.test.ts
  - src/lib/review-boundedness.ts
  - src/lib/review-boundedness.test.ts
  - src/lib/review-utils.ts
  - src/execution/review-prompt.ts
  - src/handlers/review.ts
  - src/handlers/review.test.ts
  - scripts/verify-m048-s03.ts
  - scripts/verify-m048-s03.test.ts
  - package.json
  - .gsd/KNOWLEDGE.md
key_decisions:
  - D112 — use one shared review-boundedness contract across prompt, Review Details, summary backfill, and verifier checks.
  - D113 — make `verify:m048:s03` a local-preflight plus optional-live proof command that reuses the existing S01/S02 evidence seams.
  - D114 — derive bounded-review disclosure from one canonical handler-side contract instead of per-surface wording.
  - D115 — keep legacy `review.onSynchronize` disabled-with-warning instead of auto-enabling it from the unsupported top-level key.
patterns_established:
  - Inspect raw parsed YAML before Zod normalization when compatibility behavior depends on legacy unknown keys that would otherwise be stripped.
  - Compute bounded-review disclosure once and reuse it across prompt shaping, GitHub Review Details, summary backfill, and operator verification.
  - Treat env-backed live verifier flags as optional unless a real value is supplied; reject only real non-synchronize keys and keep empty inputs on the truthful local-only path.
observability_surfaces:
  - Config warning logging for ignored legacy synchronize intent.
  - GitHub Review Details lines for requested profile, effective profile, and bounded-review/timeout state.
  - GitHub summary `## What Changed` bounded-review disclosure sentence injected exactly once when needed.
  - `verify:m048:s03` JSON/human report with `synchronizeConfig`, `boundedDisclosure`, and optional nested S01 phase-timing evidence.
drill_down_paths:
  - .gsd/milestones/M048/slices/S03/tasks/T01-SUMMARY.md
  - .gsd/milestones/M048/slices/S03/tasks/T02-SUMMARY.md
  - .gsd/milestones/M048/slices/S03/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-13T04:32:47.944Z
blocker_discovered: false
---

# S03: Truthful Bounded Reviews and Synchronize Continuity

**Completed truthful bounded-review disclosure and synchronize-trigger continuity by wiring the checked-in nested trigger config, effective handler gating, GitHub-visible bounded-review surfaces, and a two-stage `verify:m048:s03` command onto the existing `reviewOutputKey`/phase-timing evidence path.**

## What Happened

## Delivered

This slice closed the remaining M048 product-truthfulness gap on the review path without adding new normal-path noise.

- `.kodiai.yml` now uses the supported nested shape `review.triggers.onSynchronize: true`, and `loadRepoConfig(...)` fails loudly on legacy top-level `review.onSynchronize` intent by emitting an explicit compatibility warning instead of silently stripping the key.
- The review handler now gates `pull_request.synchronize` on the effective parsed trigger state, so runtime behavior follows the normalized config contract rather than the raw YAML shape.
- `src/lib/review-boundedness.ts` introduced one shared bounded-review contract that resolves requested profile, effective profile, large-PR triage coverage, timeout auto-reduction state, reason codes, and the exact disclosure sentence.
- That contract is now reused in the three product-facing surfaces that mattered for S03: prompt generation, GitHub Review Details formatting, and summary publication/backfill. Large/manual-strict and timeout-reduced reviews disclose requested versus effective scope exactly once when needed; small unbounded reviews remain silent.
- `scripts/verify-m048-s03.ts` and `scripts/verify-m048-s03.test.ts` added the slice verifier. Local mode proves checked-in synchronize intent plus bounded-disclosure fixtures; optional live mode accepts only `action=synchronize` review keys and embeds the existing `verify:m048:s01` phase-timing report instead of inventing a second evidence schema.
- During closeout, D115 was recorded to preserve legacy `review.onSynchronize` as disabled-with-warning rather than auto-enabling it, and `.gsd/KNOWLEDGE.md` now documents the raw-YAML-before-Zod rule for legacy unknown-key compatibility checks.

## What the slice actually proved

The code/test contract for S03 is complete:

- checked-in repo config, parser behavior, and handler gating all agree on `review.triggers.onSynchronize`,
- legacy top-level synchronize intent now fails loudly instead of false-greening,
- bounded strict reviews disclose requested versus effective scope consistently across prompt instructions, Review Details, summary publication, and verifier fixtures,
- small and unbounded reviews stay on the quiet path,
- and `verify:m048:s03` is wired as the canonical operator proof surface for both local drift detection and optional live synchronize evidence.

What remains operationally pending is the fresh deployed synchronize run. In this auto-mode environment no real synchronize `REVIEW_OUTPUT_KEY` was injected, so the live verifier path passed truthfully in local-only mode (`live.skipped: true`) rather than proving a newly published deployed synchronize review end to end.

## Operational Readiness (Q8)

- **Health signal:** `bun run verify:m048:s03 -- --json` returns `m048_s03_ok` with `local.synchronizeConfig.passed=true` and `local.boundedDisclosure.passed=true`; on live runs, the same report should show `live.action: "synchronize"` and a nested `verify:m048:s01` phase-timing report.
- **Failure signal:** `m048_s03_sync_config_drift`, `m048_s03_bounded_disclosure_failed`, `m048_s03_live_key_mismatch`, missing/duplicated bounded-review disclosure on GitHub-visible output, or unexpected disclosure noise on small reviews.
- **Recovery procedure:** fix `.kodiai.yml` to the nested trigger shape, rerun the slice test command plus `bun run verify:m048:s03 -- --json`, deploy the corrected revision, push a new commit to an xbmc/kodiai PR, capture the resulting synchronize `reviewOutputKey`, and rerun `bun run verify:m048:s03 -- --review-output-key "$REVIEW_OUTPUT_KEY" --json`.
- **Monitoring gaps:** final milestone proof still needs one fresh deployed synchronize-triggered review so the live verifier can confirm the nested phase-timing evidence against a real post-S03 publish.


## Verification

- `bun test ./src/execution/config.test.ts ./src/lib/review-boundedness.test.ts ./src/lib/review-utils.test.ts ./src/execution/review-prompt.test.ts ./src/handlers/review.test.ts ./scripts/verify-m048-s03.test.ts` — passed fresh at slice close (426 pass, 0 fail).
- `bun run tsc --noEmit` — passed fresh at slice close (exit 0).
- `bun run verify:m048:s03 -- --json` — passed fresh and returned `status_code: "m048_s03_ok"` with `effectiveOnSynchronize: true`, all bounded-disclosure fixtures passing, and local-only live mode skipped truthfully.
- `bun run verify:m048:s03 -- --review-output-key "$REVIEW_OUTPUT_KEY" --json` — passed fresh in automation with `status_code: "m048_s03_ok"`; because the env var expanded empty in this environment, the verifier stayed in truthful local-only mode instead of misparsing the next flag or fabricating live evidence.
- Observability surfaces verified: the S03 verifier emits the expected `synchronizeConfig` and `boundedDisclosure` sections, and handler/publication tests confirm Review Details plus GitHub summary disclosure behavior on bounded and unbounded paths.

## Requirements Advanced

- R051 — Aligned checked-in config, parser warnings, and handler gating on `review.triggers.onSynchronize`, then added `verify:m048:s03` so synchronize drift now fails loudly before deployment and can be proven live later with a synchronize review key.

## Requirements Validated

- R052 — Fresh slice-close verification proved large-PR strict and timeout-reduced reviews disclose requested versus effective scope exactly once on GitHub-visible summary + Review Details surfaces, and `verify:m048:s03 -- --json` passed the bounded-disclosure fixture contract.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

A fresh deployed synchronize-triggered review could not be exercised in auto-mode because no real synchronize `REVIEW_OUTPUT_KEY` was injected. The slice therefore verified the truthful local-only and empty-env paths, not a new live publish from this environment.

## Known Limitations

Final milestone proof still requires one deployed synchronize-triggered xbmc review so `verify:m048:s03` can run with a real synchronize `reviewOutputKey` and confirm the live nested phase-timing evidence end to end.

## Follow-ups

After deployment, push a new commit to an `xbmc/kodiai` PR, capture the resulting synchronize `reviewOutputKey`, rerun `bun run verify:m048:s03 -- --review-output-key "$REVIEW_OUTPUT_KEY" --json`, and use that live report during M048 milestone validation alongside the existing S01/S02 evidence.

## Files Created/Modified

- `.kodiai.yml` — Switched the checked-in repo config to the supported nested synchronize trigger shape.
- `src/execution/config.ts` — Detected ignored legacy `review.onSynchronize` intent and surfaced explicit compatibility warnings instead of silently stripping it.
- `src/lib/review-boundedness.ts` — Added the shared bounded-review contract and summary backfill helper.
- `src/handlers/review.ts` — Threaded bounded-review disclosure and synchronize gating through the live review handler.
- `scripts/verify-m048-s03.ts` — Added the S03 verifier with local preflight, bounded-disclosure fixtures, and optional live synchronize evidence reuse.
- `.gsd/KNOWLEDGE.md` — Recorded the raw-YAML-before-Zod compatibility-warning gotcha for future work.
