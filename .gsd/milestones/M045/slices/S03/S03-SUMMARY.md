---
id: S03
parent: M045
milestone: M045
provides:
  - A single operator-facing `verify:m045:s03` command that checks GitHub review wording, retrieval hint presence/absence, Slack profile/opt/help copy, and identity-link truthfulness together.
  - Stable human-readable and JSON report modes with named pass/fail results, per-surface scenario diagnostics, and non-zero exit status on drift.
  - A reusable verifier composition pattern for preserving upstream proof harnesses while adding new downstream surface checks.
requires:
  - slice: S01
    provides: The canonical GitHub contributor-experience contract scenarios and embedded `verify:m045:s01` report that S03 preserves intact.
  - slice: S02
    provides: Contract-owned retrieval hints, Slack copy, and identity-link messaging that S03 validates from one operator-facing command.
affects:
  - M045 milestone validation/completion
key_files:
  - scripts/verify-m045-s03.ts
  - scripts/verify-m045-s03.test.ts
  - package.json
  - .gsd/KNOWLEDGE.md
key_decisions:
  - D070 — Keep the S01 GitHub verifier report nested and intact inside S03, and author retrieval expectations locally so the operator verifier can detect drift instead of replaying helper logic under test.
  - D071 — Verify Slack and identity-link contract surfaces by driving real exported seams with synthetic fixtures and independent phrase expectations.
patterns_established:
  - Compose operator verifiers around existing proof harnesses by preserving upstream reports intact as nested evidence instead of flattening them into one boolean.
  - For drift-sensitive copy verification, drive the real exported seam with synthetic fixtures but keep required/banned phrase expectations local to the verifier so helper drift cannot self-mask.
  - Reset process-local state explicitly (`resetIdentitySuggestionStateForTests()`) when verifier scenarios exercise stateful identity-suggestion logic across multiple fixtures.
observability_surfaces:
  - `bun run verify:m045:s03` renders one human-readable operator report with named surface groups, scenario IDs, and top-level S03 check IDs.
  - `bun run verify:m045:s03 -- --json` exposes machine-checkable `check_ids`, `status_code`, nested embedded S01 results, and phrase-level `missingPhrases` / `unexpectedPhrases` diagnostics.
  - `scripts/verify-m045-s03.test.ts` proves non-zero exit behavior and stderr surfacing when Slack, retrieval, or identity expectations drift.
drill_down_paths:
  - .gsd/milestones/M045/slices/S03/tasks/T01-SUMMARY.md
  - .gsd/milestones/M045/slices/S03/tasks/T02-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-10T11:58:09.358Z
blocker_discovered: false
---

# S03: Operator Verifier for Cross-Surface Contract Drift

**Shipped `bun run verify:m045:s03`, a single operator-facing verifier that preserves the S01 GitHub proof and independently checks retrieval, Slack, and identity-link contributor-experience contract drift in human and JSON modes.**

## What Happened

S03 finished the M045 proof surface without changing runtime behavior. `scripts/verify-m045-s03.ts` now composes the existing S01 GitHub contract verifier intact, preserving all 10 embedded S01 check IDs, per-scenario status codes, and scenario detail instead of collapsing the GitHub proof to one boolean. On top of that nested GitHub report, the script adds an independent retrieval matrix across `profile-backed`, `coarse-fallback`, `generic-unknown`, `generic-opt-out`, and `generic-degraded` contract states, checking both `buildRetrievalVariants()` and `buildRetrievalQuery()` for approved hint inclusion or omission and surfacing phrase-level `missingPhrases` / `unexpectedPhrases` diagnostics when drift appears.

The slice then extended the verifier across the remaining downstream surfaces that can drift after S01/S02. Slack proof runs the real `handleKodiaiCommand()` seam against synthetic in-memory contributor-profile fixtures for linked profile output, opted-out output, malformed-tier fallback, `profile opt-out`, `profile opt-in`, and unknown-command help. Identity proof runs the real `suggestIdentityLink()` seam with deterministic fetch stubs and `resetIdentitySuggestionStateForTests()` so the verifier can assert truthful linked-profile DM wording, explicit `/kodiai profile opt-out` guidance, and fail-open warning behavior without making live Slack calls. The human-readable and JSON report modes now expose one top-level verdict, five named S03 check IDs, nested GitHub results, and per-surface scenario diagnostics that operators can use to triage cross-surface contract drift quickly.

## Verification

Fresh slice verification passed:
- `bun test ./scripts/verify-m045-s03.test.ts` → exit 0, 4 pass, 0 fail.
- `bun run verify:m045:s03` → exit 0, final verdict `PASS`, with five S03 checks passing and embedded S01/retrieval/Slack/identity scenario output present.
- `bun run verify:m045:s03 -- --json` → exit 0, `overallPassed: true`, five top-level S03 `check_ids`, nested `githubReview.command: verify:m045:s01`, and expected retrieval/Slack/identity scenario diagnostics.
- `bun test ./src/contributor/experience-contract.test.ts ./src/knowledge/multi-query-retrieval.test.ts ./src/knowledge/retrieval-query.test.ts ./src/slack/slash-command-handler.test.ts ./src/handlers/identity-suggest.test.ts ./scripts/verify-m045-s01.test.ts ./scripts/verify-m045-s03.test.ts` → exit 0, 59 pass, 0 fail.
- `bun run tsc --noEmit` → exit 0.

## Requirements Advanced

- R046 — Added the final M045 operator proof surface so the contributor-experience contract can be verified coherently across GitHub review prompt/details, retrieval shaping, Slack profile/help/opt controls, and identity-link copy from one command.

## Requirements Validated

None.

## New Requirements Surfaced

- None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

None.

## Known Limitations

- The S03 verifier is intentionally local and deterministic. It proves cross-surface contract coherence through synthetic fixtures and real exported seams, not through live Slack or GitHub traffic.
- Milestone-level validation and completion still need to consume this new verifier output; S03 delivers the proof surface, not the milestone closeout itself.

## Follow-ups

- Use `bun run verify:m045:s03` as the milestone-validation proof surface for M045 completion.
- Reuse the same nested-report plus local-expectation pattern when later milestones need one operator verifier that composes multiple already-shipped proof harnesses.

## Files Created/Modified

- `scripts/verify-m045-s03.ts` — Composed the S01 GitHub verifier, added retrieval/Slack/identity fixture matrices, rendered human and JSON reports, and enforced non-zero exit behavior on drift.
- `scripts/verify-m045-s03.test.ts` — Pinned happy-path report shape plus retrieval, Slack, and identity drift diagnostics and non-zero harness behavior.
- `package.json` — Added the `verify:m045:s03` package script for the operator-facing verifier entrypoint.
- `.gsd/KNOWLEDGE.md` — Recorded the verifier-composition rule that expectations must stay independent from the helpers they validate.
