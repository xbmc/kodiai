---
estimated_steps: 4
estimated_files: 3
skills_used:
  - test-driven-development
  - verification-before-completion
  - systematic-debugging
---

# T02: Ship the integrated verify:m046 proof harness

**Slice:** S03 — Explicit Calibration Verdict and M047 Change Contract
**Milestone:** M046

## Description

Why: The slice only closes when operators can run one command that composes S01 and S02 into a truthful milestone-level verdict plus the concrete M047 change contract.

Do: Add `scripts/verify-m046.ts` and `scripts/verify-m046.test.ts`, evaluate S01 once, feed that exact report into S02 via the existing injection seam, preserve both nested reports intact, derive `m047ChangeContract`, add stable top-level consistency checks and status codes, render human and JSON output from one report object, and wire `verify:m046` in `package.json`.

Done when: `bun run verify:m046` and `bun run verify:m046 -- --json` report the current truthful `replace` verdict plus the structured change contract, while malformed nested reports, count drift, missing recommendation, or contradictory contract state fail with named status codes.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `scripts/verify-m046-s01.ts` and `scripts/verify-m046-s02.ts` | Fail with named top-level status codes instead of inferring a verdict from broken prerequisites. | Reuse the existing bounded local proof behavior; do not add new retries or hidden network work. | Reject malformed nested reports, missing counts, or missing recommendation data as proof-surface failures. |
| `src/contributor/calibration-change-contract.ts` | Treat missing or contradictory contract output as a top-level verifier failure. | N/A — pure local helper. | Reject empty buckets or duplicate mechanisms rather than rendering an ambiguous M047 contract. |
| `package.json` script wiring | Keep one canonical `verify:m046` entrypoint so future slices do not reconstruct the composition flow ad hoc. | N/A — local config only. | Treat broken arg parsing or script drift as regression-test failures. |

## Load Profile

- **Shared resources**: one checked-in fixture snapshot, one S01 evaluation, one S02 evaluation against that same S01 report, and one top-level renderer.
- **Per-operation cost**: one integrated proof pass plus report rendering in human or JSON mode.
- **10x breakpoint**: duplicated prerequisite evaluation and report drift matter before compute, so preserve one S01 report object and one shared renderer.

## Negative Tests

- **Malformed inputs**: malformed nested S01 report, malformed nested S02 report, missing final recommendation, or contradictory `m047ChangeContract` output.
- **Error paths**: retained/excluded count drift, missing verdict, and unknown CLI args all fail non-zero with named status codes.
- **Boundary conditions**: the current truthful `replace` verdict exits 0, human and JSON output stay aligned, and retained/excluded counts agree across nested reports.

## Steps

1. Write failing tests for `scripts/verify-m046.ts` that pin report shape, top-level check IDs/status codes, truthful `replace` exit 0, malformed nested report failures, and canonical package-script wiring.
2. Implement `scripts/verify-m046.ts` with report types, nested S01/S02 composition, one-shot S01 reuse via `_evaluateS01`, contract derivation, and shared human/JSON rendering.
3. Add the `verify:m046` package script and keep the top-level report close to `verify:m045:s03` / `verify:m027:s04` composition patterns so downstream tooling can consume it mechanically.
4. Run the focused verifier tests plus the shipped command in human and JSON modes, then rerun the full M046 regression bundle and `bun run tsc --noEmit`.

## Must-Haves

- [ ] `scripts/verify-m046.ts` returns one stable machine-readable report containing nested S01 and S02 evidence, a top-level verdict block, and `m047ChangeContract`.
- [ ] The current truthful `replace` verdict exits 0; only broken proof surfaces or contradictory contract state exit non-zero.
- [ ] Human-readable output and `--json` output come from one report object and stay pinned by regression tests.
- [ ] `package.json` exposes one canonical `verify:m046` script entrypoint.

## Verification

- `bun test ./scripts/verify-m046.test.ts && bun run verify:m046 && bun run verify:m046 -- --json`
- `bun test ./src/contributor/xbmc-fixture-snapshot.test.ts ./src/contributor/calibration-evaluator.test.ts ./scripts/verify-m046-s01.test.ts ./scripts/verify-m046-s02.test.ts ./scripts/verify-m046.test.ts && bun run verify:m046:s01 -- --json && bun run verify:m046:s02 -- --json && bun run verify:m046 -- --json && bun run tsc --noEmit`

## Observability Impact

- Signals added/changed: top-level check IDs/status codes, nested fixture/calibration summaries, and explicit `m047ChangeContract` diagnostics in the integrated report.
- How a future agent inspects this: run `bun run verify:m046 -- --json`, `bun run verify:m046`, and `bun test ./scripts/verify-m046.test.ts`.
- Failure state exposed: malformed nested reports, count drift, missing recommendation, or contradictory contract state appear as named top-level failures instead of ambiguous prose.

## Inputs

- `src/contributor/calibration-change-contract.ts` — structured keep/change/replace helper from T01.
- `scripts/verify-m046-s01.ts` — fixture proof surface that must be evaluated once and preserved intact.
- `scripts/verify-m046-s02.ts` — calibration proof surface that already emits the authoritative keep/retune/replace recommendation.
- `package.json` — canonical script wiring for the new top-level verifier.

## Expected Output

- `scripts/verify-m046.ts` — integrated milestone proof harness that composes S01 and S02 into the final verdict surface.
- `scripts/verify-m046.test.ts` — regression tests for report shape, exit semantics, contract presence, and human/JSON alignment.
- `package.json` — `verify:m046` script entrypoint for operators and downstream slices.
