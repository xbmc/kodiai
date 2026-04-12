---
estimated_steps: 24
estimated_files: 4
skills_used:
  - test-driven-development
---

# T01: Define the xbmc fixture contract, normalization rules, and curated manifest

**Slice:** S01 — xbmc Fixture Set and Provenance Collector
**Milestone:** M046

## Description

Lock the truth model before any live collection runs. Add a typed fixture contract plus normalization/exclusion helpers that make contributor identity, cohort coverage, and provenance requirements explicit in code. Seed a checked-in curated manifest that names the retained contributors and the explicit exclusions S01 cares about: clear seniors, clear newcomers, ambiguous-middle samples, bots, and alias/ambiguous identities. The first tests in this slice should fail on duplicate normalized identities, missing exclusion reasons, missing cohort coverage, or retained samples without provenance placeholders so later refresh work cannot silently drift the corpus.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| Curated fixture manifest (`fixtures/contributor-calibration/xbmc-manifest.json`) | Fail fast on duplicate normalized identities, missing cohort labels, or missing exclusion reasons. | N/A — local file only. | Reject malformed entries instead of auto-healing or dropping them silently. |
| Normalization/exclusion helpers in `src/contributor/fixture-set.ts` | Keep the contract local and deterministic; do not guess alias merges from runtime-only data. | N/A — pure local code. | Treat unsupported cohort/exclusion/provenance shapes as test failures so T02 inherits a safe contract. |

## Load Profile

- **Shared resources**: one checked-in manifest and local unit tests only.
- **Per-operation cost**: contract helpers plus a focused fixture test file.
- **10x breakpoint**: schema churn and duplicate identities hurt maintainability first, so keep the manifest small and explicit.

## Negative Tests

- **Malformed inputs**: duplicate normalized IDs, empty exclusion reasons, unsupported cohort labels, and retained samples with missing provenance placeholders.
- **Error paths**: malformed manifest rows must fail the test suite instead of being skipped.
- **Boundary conditions**: prove the curated set contains at least one senior, newcomer, and ambiguous-middle retained sample plus at least one explicit exclusion.

## Steps

1. Write failing fixture-contract tests that assert normalized-identity uniqueness, explicit exclusion reasons, required cohort coverage, and required provenance placeholders.
2. Implement `src/contributor/fixture-set.ts` helpers/types for fixture records, exclusion reasons, cohort labels, and normalization checks.
3. Add the initial curated manifest plus a deterministic snapshot scaffold under `fixtures/contributor-calibration/`.
4. Re-run the focused tests and keep the manifest/snapshot sorted and stable for T02 refresh work.

## Must-Haves

- [ ] The curated manifest distinguishes retained contributors from explicit exclusions instead of mixing them implicitly.
- [ ] Normalization rules and tests reject duplicate identities and missing provenance placeholders.
- [ ] The retained set already covers senior, newcomer, and ambiguous-middle cohorts needed by the milestone demo.

## Verification

- `bun test ./src/contributor/fixture-set.test.ts`
- `test -s fixtures/contributor-calibration/xbmc-manifest.json`

## Inputs

- `.gsd/milestones/M046/M046-RESEARCH.md` — research guidance on fixture shape, cohort selection, alias cleanup, and risky gaps in the current scoring path.
- `.gsd/DECISIONS.md` — D072/D073 decision context for checked-in xbmc-first fixture truth and live-path vs intended-path evaluation.
- `src/contributor/types.ts` — existing contributor type vocabulary to align the fixture contract with downstream consumers.
- `src/contributor/identity-matcher.ts` — existing normalization/matching patterns worth mirroring or deliberately not reusing.

## Expected Output

- `src/contributor/fixture-set.ts` — fixture record types, normalization helpers, coverage checks, and explicit exclusion/provenance validation.
- `src/contributor/fixture-set.test.ts` — regression tests for normalized identity uniqueness, exclusion reasons, cohort coverage, and provenance placeholders.
- `fixtures/contributor-calibration/xbmc-manifest.json` — curated retained/excluded contributor manifest with cohort and reason metadata.
- `fixtures/contributor-calibration/xbmc-snapshot.json` — deterministic scaffold file that T02 will replace with collected evidence.
