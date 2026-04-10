# S02: Calibration Evaluator for Live vs Intended Model Paths

**Goal:** Turn the checked-in xbmc contributor fixture pack into a deterministic calibration proof surface that compares Kodiai’s current live incremental path against the intended full-signal model path, projects both through the M045 contributor-experience contract, and emits an explicit keep/retune/replace recommendation without inventing missing file-level evidence.
**Demo:** Run the calibration verifier and get a per-contributor report showing fixture evidence, current live incremental-path outcomes, intended full-signal-path outcomes, percentile/tie instability checks, and freshness/unscored-profile findings mapped back to the M045 contract.

## Must-Haves

- ## Must-Haves
- Consume the checked-in xbmc snapshot through one reusable source helper instead of duplicating S01’s snapshot schema inside every verifier.
- Preserve S01 retained vs excluded contributor truth so retained anchors stay evaluable and excluded bot/alias/ambiguous identities remain visible controls, not silent inputs.
- Produce a per-contributor evaluator result that includes fixture evidence, modeled live-path outcome, modeled intended-path outcome, M045 contract projection, percentile/tie-instability findings, and freshness/unscored-profile diagnostics.
- Make the snapshot-only modeling choice explicit: do not fabricate changed-file arrays or silently hydrate live GitHub data during offline proof runs; surface fidelity/degradation reasons in the report.
- Ship `bun run verify:m046:s02 -- --json` with stable check IDs / status codes and a report-level `keep` / `retune` / `replace` recommendation that directly advances R047.
- ## Threat Surface
- **Abuse**: Poisoned fixture rows, silent reintroduction of excluded identities, or invented file-level replay assumptions could falsely certify the current model as sound.
- **Data exposure**: Only checked-in public contributor identifiers, provenance URLs, score/tier diagnostics, and verifier status codes should appear; never print GitHub app secrets, tokens, or private review data.
- **Input trust**: `fixtures/contributor-calibration/xbmc-snapshot.json`, retained/excluded contributor rows, and any modeled live/intended assumptions are untrusted until validated through the shared snapshot contract.
- ## Requirement Impact
- **Requirements touched**: R047.
- **Re-verify**: `bun run verify:m046:s01 -- --json`, the new snapshot loader tests, evaluator tests, and `bun run verify:m046:s02 -- --json` must all agree on retained/excluded truth and the final recommendation surface.
- **Decisions revisited**: D072, D075.
- ## Verification
- `bun test ./src/contributor/xbmc-fixture-snapshot.test.ts ./src/contributor/calibration-evaluator.test.ts ./scripts/verify-m046-s01.test.ts ./scripts/verify-m046-s02.test.ts`
- `bun run verify:m046:s01 -- --json`
- `bun run verify:m046:s02 -- --json`
- `bun run tsc --noEmit`

## Proof Level

- This slice proves: - This slice proves: integration.
- Real runtime required: no.
- Human/UAT required: no.

## Integration Closure

- Upstream surfaces consumed: `src/contributor/fixture-set.ts`, `src/contributor/xbmc-fixture-refresh.ts`, `src/contributor/expertise-scorer.ts`, `src/contributor/tier-calculator.ts`, `src/contributor/experience-contract.ts`, `src/handlers/review.ts`, `src/slack/slash-command-handler.ts`, and `scripts/verify-m046-s01.ts`.
- New wiring introduced in this slice: a reusable snapshot loader, a pure calibration evaluator, and the `verify:m046:s02` CLI/report surface.
- What remains before the milestone is truly usable end-to-end: downstream slices can consume the shipped verdict, but S02 itself should already emit the keep/retune/replace recommendation required by R047.

## Verification

- Runtime signals: evaluator fidelity/degradation reasons, per-contributor live/intended contract states, freshness/unscored diagnostics, percentile/tie-instability findings, and the final recommendation.
- Inspection surfaces: `bun run verify:m046:s02 -- --json`, the human-readable verifier output, and the checked-in fixture snapshot consumed by the loader.
- Failure visibility: named verifier `status_code` values plus per-contributor diagnostics when retained/excluded truth, recommendation generation, or modeled-path assumptions drift.
- Redaction constraints: keep output limited to public contributor identifiers and checked-in provenance; never echo secrets or token-bearing env.

## Tasks

- [x] **T01: Extract a reusable xbmc snapshot loader and validation seam** `est:75m`
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
  - Files: `src/contributor/xbmc-fixture-snapshot.ts`, `src/contributor/xbmc-fixture-snapshot.test.ts`, `scripts/verify-m046-s01.ts`, `src/contributor/index.ts`
  - Verify: bun test ./src/contributor/xbmc-fixture-snapshot.test.ts ./scripts/verify-m046-s01.test.ts && bun run verify:m046:s01 -- --json

- [x] **T02: Build the pure calibration evaluator for live-vs-intended model paths** `est:105m`
  ---
estimated_steps: 24
estimated_files: 5
skills_used:
  - test-driven-development
  - systematic-debugging
  - verification-before-completion
---

Implement a deterministic evaluator that consumes the validated xbmc snapshot and produces the slice’s actual proof object. The evaluator must stay honest about what the fixture pack can and cannot prove: model current live behavior from the snapshot’s coarse evidence and known runtime constraints, model intended full-signal behavior without fabricating changed-file arrays, and attach explicit fidelity/degradation reasons anywhere the checked-in snapshot cannot replay the real scorer literally. Each retained contributor row should report fixture evidence, a modeled current live-path outcome, a modeled intended-path outcome, the resulting M045 contract state for each path, percentile/tie-instability findings, and freshness/unscored-profile diagnostics. Use the retained anchors (`fuzzard`, `KOPRajs`, `fkoemep`) as the cohort truth, and keep excluded rows visible only as control diagnostics.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| Snapshot loader from `src/contributor/xbmc-fixture-snapshot.ts` | Stop evaluation with a typed error instead of inferring contributor truth from partial data. | N/A — local file/helper only. | Refuse to evaluate when retained/excluded truth or provenance diagnostics are malformed. |
| Scoring/tiering helpers in `src/contributor/expertise-scorer.ts` and `src/contributor/tier-calculator.ts` | Keep runtime math reuse minimal and deterministic; if a helper cannot be reused honestly, isolate evaluator-only math rather than mutating live behavior. | N/A — local code only. | Treat tie-order or score-shape surprises as explicit evaluator diagnostics rather than silently normalizing them away. |
| Contract projection in `src/contributor/experience-contract.ts` | Reuse the shipped M045 contract helper instead of re-describing contributor states in prose. | N/A — pure local projection. | Fail tests if evaluator output drifts from the actual contract states Kodiai uses in review/slack surfaces. |

## Load Profile

- **Shared resources**: in-memory snapshot rows, scoring helpers, percentile tiering, and contract projection only.
- **Per-operation cost**: one deterministic evaluation pass over three retained contributors plus excluded control diagnostics.
- **10x breakpoint**: tie/small-N instability and score-compression logic become the limiting factors before raw compute cost does.

## Negative Tests

- **Malformed inputs**: retained rows missing PR/review provenance, excluded rows accidentally entering the evaluated cohort, and malformed commit-count relationships.
- **Error paths**: evaluator surfaces explicit fidelity/degradation reasons when file-level replay or review counts are unavailable from the checked-in snapshot.
- **Boundary conditions**: two- and three-contributor cohorts, equal scores with reordered inputs, and linked-but-unscored profiles defaulting to profile-backed newcomer guidance.

## Steps

1. Write failing evaluator tests that pin per-contributor output shape, retained/excluded cohort handling, contract projection, tie instability, and linked-but-unscored freshness findings.
2. Add a pure evaluator module that accepts the validated snapshot plus an optional reference time and returns deterministic live-path / intended-path report rows with explicit fidelity metadata.
3. Reuse existing scorer/tier/contract helpers where they are truthful, but do not fabricate changed-file arrays or live GitHub hydration just to make the numbers look precise.
4. Add report-level recommendation logic (`keep`, `retune`, `replace`) with rationale based on cohort ordering, live-vs-intended divergence, instability, and freshness diagnostics.
5. Export the evaluator seam for the verifier and keep excluded rows available as control diagnostics instead of silently dropping them.

## Must-Haves

- [ ] Each retained contributor row includes fixture evidence, modeled live and intended outcomes, contract states, instability findings, and freshness/unscored diagnostics.
- [ ] The evaluator makes the snapshot-only fidelity limits explicit instead of inventing file-level replay or hidden live hydration.
- [ ] Report-level recommendation logic can explain why the current mechanism should be kept, retuned, or replaced.
  - Files: `src/contributor/calibration-evaluator.ts`, `src/contributor/calibration-evaluator.test.ts`, `src/contributor/expertise-scorer.ts`, `src/contributor/tier-calculator.ts`, `src/contributor/index.ts`
  - Verify: bun test ./src/contributor/calibration-evaluator.test.ts

- [ ] **T03: Ship verify:m046:s02 with stable per-contributor verdict reporting** `est:90m`
  ---
estimated_steps: 22
estimated_files: 4
skills_used:
  - test-driven-development
  - verification-before-completion
---

Expose the evaluator as the slice’s operator-facing proof harness. The verifier should first confirm the S01 fixture dependency is still sound, then load the checked-in snapshot, run the evaluator, and emit human-readable plus `--json` output with stable check IDs / status codes. The shipped report must show each retained contributor’s fixture evidence, modeled live-path outcome, modeled intended-path outcome, contract projection, percentile/tie-instability results, and freshness/unscored findings, while keeping excluded identities visible as explicit controls. Exit non-zero when prerequisite fixture validity fails, when the evaluator cannot produce a recommendation, or when retained/excluded contributor truth drifts from the S01 contract.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| Upstream fixture verifier `verify:m046:s01` / shared snapshot loader | Fail with a named prerequisite status code rather than printing a misleading calibration verdict. | Use the existing bounded S01 verifier behavior; do not add new polling or live retries in S02. | Reject malformed snapshot/evaluator inputs as verifier failures with actionable detail. |
| Calibration evaluator in `src/contributor/calibration-evaluator.ts` | Bubble evaluator failures into stable check IDs / status codes instead of swallowing them in prose. | N/A — pure local evaluation. | Treat missing recommendation, missing retained rows, or contract-state drift as failing checks. |
| Package script wiring in `package.json` | Keep one canonical `verify:m046:s02` entrypoint so downstream slices do not reconstruct the proof flow ad hoc. | N/A — local config only. | Treat broken CLI args or mismatched human/JSON shapes as regression-test failures. |

## Load Profile

- **Shared resources**: local snapshot file, evaluator output, and one prerequisite S01 verifier invocation.
- **Per-operation cost**: one proof script, one test file, one package script entry, and one evaluation pass.
- **10x breakpoint**: human-readable output clarity degrades before compute does, so keep check IDs/status codes and contributor summaries concise.

## Negative Tests

- **Malformed inputs**: corrupted snapshot JSON, missing retained contributors, and excluded identities leaking into the evaluated cohort.
- **Error paths**: failed upstream fixture verification, evaluator exceptions, and missing keep/retune/replace recommendation all produce non-zero exits with named status codes.
- **Boundary conditions**: `--json` and human output stay aligned, and the report remains useful when the snapshot is degraded but still loadable.

## Steps

1. Write failing verifier tests that pin JSON structure, human-readable report sections, stable check IDs/status codes, and non-zero exits for prerequisite/evaluator failures.
2. Implement `scripts/verify-m046-s02.ts` to call the shared snapshot loader and evaluator, compose per-contributor + report-level checks, and render human / JSON output from one report object.
3. Add the `verify:m046:s02` package script and keep the report shape close to `verify:m046:s01` / `verify:m045:s03` patterns so future slices can consume it mechanically.
4. Run the shipped verifier against the checked-in fixture snapshot and keep the final output explicit about live-path compression, intended-path gaps, instability, freshness, and the final recommendation.

## Must-Haves

- [ ] `bun run verify:m046:s02 -- --json` returns a stable machine-readable report with per-contributor diagnostics and a final keep/retune/replace recommendation.
- [ ] Human-readable output and JSON are generated from the same report object so drift is testable.
- [ ] Prerequisite fixture failures, evaluator failures, and missing recommendations all exit non-zero with named status codes.
  - Files: `scripts/verify-m046-s02.ts`, `scripts/verify-m046-s02.test.ts`, `package.json`, `src/contributor/calibration-evaluator.ts`
  - Verify: bun test ./scripts/verify-m046-s02.test.ts && bun run verify:m046:s02 -- --json

## Files Likely Touched

- src/contributor/xbmc-fixture-snapshot.ts
- src/contributor/xbmc-fixture-snapshot.test.ts
- scripts/verify-m046-s01.ts
- src/contributor/index.ts
- src/contributor/calibration-evaluator.ts
- src/contributor/calibration-evaluator.test.ts
- src/contributor/expertise-scorer.ts
- src/contributor/tier-calculator.ts
- scripts/verify-m046-s02.ts
- scripts/verify-m046-s02.test.ts
- package.json
