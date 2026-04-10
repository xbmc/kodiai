# S03: Operator Verifier for Cross-Surface Contract Drift — UAT

**Milestone:** M045
**Written:** 2026-04-10T11:58:09.358Z

# S03: Operator Verifier for Cross-Surface Contract Drift — UAT

**Milestone:** M045
**Written:** 2026-04-10T11:55:00Z

## Preconditions

- Run from the repository root with Bun installed.
- No live GitHub, Slack, or database credentials are required; S03 is intentionally verified with deterministic local fixtures.
- The S03 implementation is present in `scripts/verify-m045-s03.ts` and `scripts/verify-m045-s03.test.ts`.

## Test Case 1 — Operator runs the human-readable verifier report

1. Run `bun run verify:m045:s03`.
2. Confirm the command exits 0.
3. Expected outcome:
   - the first lines identify `M045 S03 proof harness: contributor-experience contract drift` and `Final verdict: PASS`.
   - the report contains the sections `GitHub review (embedded S01)`, `Retrieval:`, `Slack:`, `Identity link:`, and `Checks:`.
   - the `Checks:` section lists exactly these five S03 check IDs as `PASS`:
     - `M045-S03-S01-REPORT-COMPOSED`
     - `M045-S03-RETRIEVAL-MULTI-QUERY-CONTRACT`
     - `M045-S03-RETRIEVAL-LEGACY-QUERY-CONTRACT`
     - `M045-S03-SLACK-SURFACES-CONTRACT`
     - `M045-S03-IDENTITY-LINK-CONTRACT`
4. Edge-case guard:
   - the embedded GitHub section still shows all five S01 scenarios and does not collapse to a single boolean-only summary.

## Test Case 2 — JSON mode exposes machine-checkable drift data

1. Run `bun run verify:m045:s03 -- --json`.
2. Confirm the command exits 0.
3. Expected outcome:
   - the JSON root contains `"command": "verify:m045:s03"` and `"overallPassed": true`.
   - `check_ids` contains the same five S03 check IDs listed in Test Case 1.
   - `githubReview.command` is `verify:m045:s01` and `githubReview.check_ids` contains 10 embedded GitHub contract checks.
   - `retrieval.scenarios` contains `profile-backed`, `coarse-fallback`, `generic-unknown`, `generic-opt-out`, and `generic-degraded`.
   - `slack.scenarios` contains `linked-profile`, `opted-out-profile`, `malformed-tier-profile`, `profile-opt-out`, `profile-opt-in`, and `unknown-command-help`.
   - `identity.scenarios` contains `existing-linked-profile`, `no-high-confidence-match`, `high-confidence-match-dm`, and `slack-api-failure-warning`.
4. Edge-case guard:
   - the `generic-unknown`, `generic-opt-out`, and `generic-degraded` retrieval scenarios do **not** contain `author:` / `Author:` fragments.
   - the `high-confidence-match-dm` scenario DM text includes `/kodiai profile opt-out` and does **not** contain `personalized code reviews`.

## Test Case 3 — Verifier regression tests prove drift detection and non-zero failure behavior

1. Run `bun test ./scripts/verify-m045-s03.test.ts`.
2. Confirm all four named tests pass.
3. Expected outcome:
   - the happy-path report-shape test passes.
   - the malformed retrieval fixture test proves named `missingPhrases` diagnostics are emitted.
   - the human-readable renderer test proves Slack and identity sections are present.
   - the harness test proves JSON mode exits non-zero and writes failing check IDs to stderr when Slack or identity fixtures drift.
4. Edge-case guard:
   - the non-zero drift test specifically exercises Slack copy drift and identity DM wording drift instead of only checking retrieval failures.

## Test Case 4 — Cross-surface regression suite stays green after S03 composition

1. Run:
   `bun test ./src/contributor/experience-contract.test.ts ./src/knowledge/multi-query-retrieval.test.ts ./src/knowledge/retrieval-query.test.ts ./src/slack/slash-command-handler.test.ts ./src/handlers/identity-suggest.test.ts ./scripts/verify-m045-s01.test.ts ./scripts/verify-m045-s03.test.ts`
2. Confirm the command exits 0.
3. Expected outcome:
   - all 59 tests pass.
   - contributor contract projections, retrieval builders, Slack profile/help/opt controls, identity-suggest DM wording, and both verifier scripts remain in sync.
4. Edge-case guard:
   - generic retrieval paths still suppress contributor hints, opted-out Slack output still hides expertise, and Slack API failures in identity suggestion remain fail-open.

## Test Case 5 — Type safety stays clean after adding the operator verifier

1. Run `bun run tsc --noEmit`.
2. Confirm the command exits 0.
3. Expected outcome:
   - the new S03 verifier types, report shapes, synthetic fixtures, and test-only seams compile cleanly with the rest of the repository.
4. Edge-case guard:
   - no TypeScript errors appear from the nested S01 report composition or the Slack/identity fixture types.
