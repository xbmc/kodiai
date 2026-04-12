# S01: Contract-Driven GitHub Review Behavior — UAT

**Milestone:** M045
**Written:** 2026-04-09T16:07:04.567Z

## Preconditions

- Run from the repository root with Bun installed.
- No live GitHub or database credentials are required; this slice uses deterministic fixtures and unit tests.
- The working tree contains the S01 implementation.

## Test Case 1 — Full GitHub contributor-experience contract matrix

1. Run `bun run verify:m045:s01 -- --json`.
   - Expected: exit 0 and JSON output with `overallPassed: true`.
2. Confirm `scenarios` contains exactly five entries: `profile-backed`, `coarse-fallback`, `generic-unknown`, `generic-opt-out`, and `generic-degraded`.
   - Expected: each scenario reports `prompt.passed: true` and `reviewDetails.passed: true`.
3. Inspect the scenario-specific outputs.
   - Expected for `profile-backed`: prompt includes `Contributor-experience contract: profile-backed.` and Review Details contains `profile-backed (using linked contributor profile guidance)`.
   - Expected for `coarse-fallback`: prompt includes `Contributor-experience contract: coarse-fallback.` and the scenario bans senior/profile-backed shorthand such as `core/senior contributor`.
   - Expected for `generic-unknown`: Review Details contains `generic-unknown (no reliable contributor signal available)`.
   - Expected for `generic-opt-out`: Review Details contains `generic-opt-out (contributor-specific guidance disabled by opt-out)`.
   - Expected for `generic-degraded`: prompt includes `## Search API Degradation Context` and the exact sentence `Analysis is partial due to API limits.`
   - Expected across all five: each check reports empty `missingPhrases` and empty `unexpectedPhrases` arrays.

## Test Case 2 — Runtime handler contract resolution and observability

1. Run `bun test ./src/handlers/review.test.ts`.
2. Confirm these named tests pass:
   - `profile-backed contributor guidance resolves without knowledgeStore gating`
   - `coarse fallback keeps contract-scoped wording without overclaiming profile-backed certainty`
   - `generic unknown contract keeps prompt behavior neutral when no safe contributor signal exists`
   - `opted-out contributor profiles stay generic instead of resurrecting profile-backed guidance`
   - `degraded search enrichment falls back to a generic degraded contract instead of legacy regular wording`
   - `logs contributor-experience state, source, and degradation path for inspection`
3. Expected outcome: review-time resolution, opt-out handling, degraded disclosure, and the structured handler log fields all remain green.

## Test Case 3 — Shared prompt and Review Details contract projections

1. Run `bun test ./src/contributor/experience-contract.test.ts ./src/execution/review-prompt.test.ts ./src/lib/review-utils.test.ts`.
2. Confirm the pass output covers the five contract projections and the explicit prompt/detail wording guards.
3. Expected outcome: coarse-fallback and generic states stay neutral/truthful, and Review Details does not reintroduce raw `- Author tier:` output.

## Test Case 4 — M042 continuity guards still follow the shared contract

1. Run `bun run verify:m042:s02 && bun run verify:m042:s03`.
2. Expected outcome: both commands print `Final verdict: PASS`.
3. Confirm the output still proves:
   - profile-backed/established GitHub review surfaces remain truthful,
   - cache-hit coarse fallback stays non-contradictory,
   - degraded fallback still discloses partial analysis instead of overclaiming contributor certainty.

## Test Case 5 — Type safety and packaged command wiring

1. Run `bun run tsc --noEmit`.
   - Expected: exit 0.
2. Run `bun run verify:m045:s01`.
   - Expected: human-readable output lists all five scenarios and shows PASS for prompt and Review Details.
3. Edge-case expectation: if a future change reintroduces banned phrases or drops required disclosure text, the failing verifier output should name the `scenarioId`, `surface`, and phrase mismatch instead of failing generically.
