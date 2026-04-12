---
estimated_steps: 24
estimated_files: 3
skills_used: []
---

# T01: Compose the S03 verifier around S01 and retrieval drift checks

This task establishes the operator-facing proof harness in `scripts/verify-m045-s03.ts` without changing runtime behavior. Reuse `evaluateM045S01()` and its named check/report output instead of recreating GitHub prompt/details expectations, then add independent retrieval drift fixtures so the first version of S03 already proves the GitHub review surface plus retrieval shaping/omission from one command. Keep required and banned retrieval phrases local to the S03 verifier; do not generate expected strings by calling the same helper under test.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| Embedded S01 report from `scripts/verify-m045-s01.ts` | Fail the S03 verifier with a named composition failure instead of silently dropping GitHub review results. | N/A — local in-process evaluation only. | Treat missing nested `check_ids`, `checks`, or scenario data as verifier drift and fail fast. |
| Retrieval builders in `src/knowledge/multi-query-retrieval.ts` and `src/knowledge/retrieval-query.ts` | Record named retrieval-check failures; do not patch runtime behavior from inside the verifier. | N/A — pure string construction. | Treat malformed or empty query text as drift and surface missing/banned phrase diagnostics. |
| Contract fixtures from `src/contributor/experience-contract.ts` | Default expectations to generic/no-hint behavior rather than inventing fallback tiers. | N/A — local fixture creation. | Add explicit negative fixtures for unsupported state/tier combinations so malformed inputs fail predictably. |

## Load Profile

- **Shared resources**: fixed in-process report assembly plus two retrieval-string builders; no live network or persistent state.
- **Per-operation cost**: one `evaluateM045S01()` call plus a small deterministic retrieval fixture matrix that exercises both builders.
- **10x breakpoint**: report drift or fixture sprawl would hurt readability first, so keep the matrix fixed, named, and bounded.

## Negative Tests

- **Malformed inputs**: unsupported contract state/tier combinations, missing embedded S01 fields, and blank query text all fail with named diagnostics.
- **Error paths**: retrieval checks still render a complete report when one surface fails; the verifier must not stop after the first bad fixture.
- **Boundary conditions**: `profile-backed` and `coarse-fallback` emit only approved hint phrases, while `generic-opt-out`, `generic-unknown`, and `generic-degraded` emit no `author:` / `Author:` fragment and no raw tier vocabulary.

## Steps

1. Define S03 report types, check IDs, and fixture helpers in `scripts/verify-m045-s03.ts`, importing `evaluateM045S01()` so the operator report preserves nested GitHub review checks and scenario detail.
2. Build retrieval fixtures from `projectContributorExperienceContract()` and assert both `buildRetrievalVariants()` and `buildRetrievalQuery()` require approved hint wording for adapted states and ban contributor hints for generic states.
3. Add human-readable rendering, `--json` handling, exit-code behavior, and a `verify:m045:s03` package script while keeping the report deterministic and script-local.
4. Write `scripts/verify-m045-s03.test.ts` cases that pin the happy-path report shape plus a malformed retrieval fixture failure with named diagnostics.

## Must-Haves

- [ ] The S03 report embeds the full S01 result set and preserves S01 named check IDs/status codes.
- [ ] Retrieval drift coverage exercises both the live multi-query builder and the legacy single-query helper against contract-approved inclusion/omission rules.
- [ ] `bun run verify:m045:s03` and `bun run verify:m045:s03 -- --json` execute through `package.json` and fail non-zero when any retrieval or embedded GitHub check fails.

## Inputs

- ``scripts/verify-m045-s01.ts` — existing GitHub review contract matrix and report shape that S03 must embed rather than recreate.`
- ``src/contributor/experience-contract.ts` — source of truth for contributor-experience states and retrieval-hint projection.`
- ``src/knowledge/multi-query-retrieval.ts` — live review retrieval builder that must be checked for approved `author:` hint inclusion/omission.`
- ``src/knowledge/retrieval-query.ts` — legacy single-query helper that should stay aligned with the live retrieval vocabulary.`
- ``scripts/verify-m045-s01.test.ts` — existing verifier test style and report-shape expectations to follow.`

## Expected Output

- ``scripts/verify-m045-s03.ts` — new operator verifier with embedded S01 report support and named retrieval drift checks.`
- ``scripts/verify-m045-s03.test.ts` — regression coverage for report shape, JSON output, and retrieval drift failures.`
- ``package.json` — `verify:m045:s03` entrypoint for the new verifier command.`

## Verification

bun test ./scripts/verify-m045-s03.test.ts && bun run verify:m045:s03 -- --json

## Observability Impact

- Signals added/changed: S03 introduces stable cross-surface `check_ids`, `status_code` values, and nested GitHub report fields for operator triage.
- How a future agent inspects this: run `bun run verify:m045:s03` or `bun run verify:m045:s03 -- --json` and inspect the retrieval section plus embedded S01 check list.
- Failure state exposed: missing embedded GitHub checks or leaked retrieval hints appear as named failures with phrase-level diagnostics.
