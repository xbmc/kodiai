---
estimated_steps: 30
estimated_files: 4
skills_used: []
---

# T01: Extract a reusable xbmc snapshot loader and validation seam

---
estimated_steps: 20
estimated_files: 4
skills_used:
  - test-driven-development
  - verification-before-completion
---

Move S01’s checked-in snapshot contract into a reusable source module so S02 can consume typed retained/excluded contributor rows without copying verifier-only Zod schemas. This task should add a loader/validator for `fixtures/contributor-calibration/xbmc-snapshot.json`, preserve provenance records plus diagnostics, and refactor `scripts/verify-m046-s01.ts` to reuse the shared helper. Keep the seam deterministic and offline-only: it should validate the checked-in snapshot exactly as written, not trigger refresh logic or live GitHub access.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| Checked-in snapshot file `fixtures/contributor-calibration/xbmc-snapshot.json` | Fail fast with actionable validation errors instead of returning partial contributor rows. | N/A — local file only. | Reject malformed JSON or missing diagnostics/provenance fields rather than auto-healing them. |
| Existing S01 verifier in `scripts/verify-m046-s01.ts` | Keep `verify:m046:s01` green by swapping it onto the shared loader instead of forking snapshot-contract logic. | N/A — local code only. | Treat loader/verifier contract drift as a regression test failure so S02 cannot consume stale semantics. |

## Load Profile

- **Shared resources**: one checked-in snapshot file plus local unit tests only.
- **Per-operation cost**: one JSON parse, one schema validation pass, and small helper transforms.
- **10x breakpoint**: schema drift hurts maintainability first, so keep the helper focused on loading/validation rather than report logic.

## Negative Tests

- **Malformed inputs**: bad JSON, missing `diagnostics`, missing `provenanceRecords`, and duplicate/malformed retained or excluded rows.
- **Error paths**: snapshot parse or validation errors bubble up as explicit failures instead of empty arrays.
- **Boundary conditions**: degraded snapshots still load with diagnostics intact, and excluded alias/bot rows remain visible to downstream evaluators.

## Steps

1. Write failing tests for snapshot loading/validation, covering valid checked-in data, malformed JSON, missing provenance records, and missing diagnostics.
2. Add a dedicated source helper that exports the snapshot types the evaluator needs plus `loadXbmcFixtureSnapshot` / `assertValidXbmcFixtureSnapshot` style entrypoints.
3. Refactor `scripts/verify-m046-s01.ts` (and its tests if needed) to consume the shared helper instead of its private snapshot-contract copy.
4. Re-run the focused tests and keep the helper export surface small enough for S02’s evaluator and verifier to import directly.

## Must-Haves

- [ ] S02 can load typed retained/excluded snapshot rows plus diagnostics from one shared source module.
- [ ] `verify:m046:s01` reuses the shared snapshot loader so S01 and S02 cannot silently drift on snapshot semantics.
- [ ] Tests pin malformed snapshot failures and preserve degraded/excluded-row visibility.

## Inputs

- ``src/contributor/fixture-set.ts` — shared retained/excluded fixture vocabulary and manifest validation helpers.`
- ``src/contributor/xbmc-fixture-refresh.ts` — exported snapshot/result types that define the checked-in snapshot shape.`
- ``scripts/verify-m046-s01.ts` — current snapshot inspection logic that should be de-duplicated.`
- ``fixtures/contributor-calibration/xbmc-snapshot.json` — checked-in retained/excluded contributor truth that the loader must validate.`

## Expected Output

- ``src/contributor/xbmc-fixture-snapshot.ts` — reusable loader/validator for the checked-in xbmc snapshot.`
- ``src/contributor/xbmc-fixture-snapshot.test.ts` — regression coverage for valid, malformed, and degraded snapshot loading.`
- ``scripts/verify-m046-s01.ts` — refactored to consume the shared loader instead of private snapshot parsing.`
- ``src/contributor/index.ts` — exports the new loader seam for downstream evaluator/verifier code.`

## Verification

bun test ./src/contributor/xbmc-fixture-snapshot.test.ts ./scripts/verify-m046-s01.test.ts && bun run verify:m046:s01 -- --json
