---
estimated_steps: 24
estimated_files: 5
skills_used:
  - test-driven-development
  - verification-before-completion
---

# T03: Ship the xbmc refresh/verify entrypoint and proof report

**Slice:** S01 — xbmc Fixture Set and Provenance Collector
**Milestone:** M046

## Description

Complete the slice by exposing one operator-facing entrypoint that refreshes and verifies the checked-in fixture pack. The CLI should support human-readable and JSON output, bounded live refresh through the collector, and explicit non-zero failures when coverage, provenance, normalization, or source-availability guarantees break. Wire a package script so S02 can call the same command, then refresh the checked-in snapshot through the final path so the demo is true without manual JSON surgery.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| Verifier CLI/report assembly | Emit a named failing `status_code` and keep JSON/human output structurally valid. | Keep refresh timeouts bounded and report the source as unavailable instead of hanging. | Reject malformed snapshot/manifest content as a verifier failure with actionable diagnostics. |
| Package script wiring in `package.json` | Fix the entrypoint path instead of telling later slices to run the script ad hoc. | N/A — local config only. | Treat mismatched CLI args/output modes as regression-test failures. |
| Checked-in snapshot + manifest pair | Fail when coverage/provenance drift appears instead of silently passing stale data. | N/A — file inputs only. | Detect manifest/snapshot mismatches and fail non-zero with the exact missing coverage or provenance field. |

## Load Profile

- **Shared resources**: the checked-in fixture files plus one bounded live refresh pass.
- **Per-operation cost**: one verifier script, one test file, one package script, and one snapshot refresh.
- **10x breakpoint**: verbose diagnostics becoming unreadable; keep check IDs and status codes concise and stable.

## Negative Tests

- **Malformed inputs**: corrupted snapshot JSON, missing cohort coverage, missing provenance arrays, and alias collisions reported by the refresh module.
- **Error paths**: missing GitHub env/install, refresh source unavailability, and mismatched manifest/snapshot counts.
- **Boundary conditions**: `--json` and human-readable output both expose the same verdicts, and `--refresh` rewrites the snapshot before verifying it.

## Steps

1. Write failing verifier tests that pin human-readable output, JSON structure, named check IDs/status codes, and non-zero failures for coverage/provenance drift.
2. Implement `scripts/verify-m046-s01.ts` with `--json`, `--refresh`, `--repo`, and optional `--workspace` support using the refresh module and checked-in fixture files as the proof surfaces.
3. Wire `verify:m046:s01` into `package.json`, then run the final refresh path to regenerate the checked-in snapshot through the shipped CLI.
4. Re-run verifier tests, human/json CLI modes, and typecheck so the slice ends with one durable proof command.

## Must-Haves

- [ ] `bun run verify:m046:s01 -- --json` verifies the checked-in fixture pack without rewriting it.
- [ ] `bun run verify:m046:s01 -- --refresh --json` rebuilds the snapshot and then verifies it.
- [ ] Human and JSON output surface retained/excluded counts, cohort coverage, provenance completeness, and source availability with stable check IDs/status codes.

## Verification

- `bun test ./scripts/verify-m046-s01.test.ts`
- `bun run verify:m046:s01 -- --json`
- `bun run verify:m046:s01 -- --refresh --json`
- `bun run tsc --noEmit`

## Observability Impact

- Signals added/changed: stable verifier `check_ids`, `status_code`, retained/excluded counts, cohort coverage, provenance completeness, and source-availability diagnostics.
- How a future agent inspects this: run `bun run verify:m046:s01 -- --json` or `bun run verify:m046:s01 -- --refresh --json` and inspect the emitted report plus the checked-in snapshot.
- Failure state exposed: coverage drift, missing provenance, malformed fixture files, missing GitHub access, or refresh path regressions.

## Inputs

- `src/contributor/fixture-set.ts` — fixture contract and validation helpers from T01.
- `src/contributor/xbmc-fixture-refresh.ts` — refresh module from T02.
- `fixtures/contributor-calibration/xbmc-manifest.json` — curated contributor manifest that remains the human-edited source of truth.
- `fixtures/contributor-calibration/xbmc-snapshot.json` — checked-in evidence snapshot to verify and refresh.
- `package.json` — script wiring surface for the shipped verifier command.

## Expected Output

- `scripts/verify-m046-s01.ts` — refresh/verify CLI with human-readable and JSON report modes.
- `scripts/verify-m046-s01.test.ts` — regression tests for report shape, coverage/provenance drift failures, and CLI mode behavior.
- `package.json` — `verify:m046:s01` package script.
- `fixtures/contributor-calibration/xbmc-snapshot.json` — refreshed checked-in snapshot produced through the shipped CLI path.
