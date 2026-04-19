---
estimated_steps: 4
estimated_files: 3
skills_used:
  - test-driven-development
  - verification-before-completion
---

# T02: Make the M048 verifier summaries preserve tri-state publication truth

**Slice:** S03 — Residual operator truthfulness cleanup
**Milestone:** M051

## Description

Once T01 makes incomplete phase evidence explicitly invalid, the verifier surface must stop lying about what it found. This task repairs the operator-facing wording in `deriveM048S01Outcome()` so `no evidence`, `evidence present but incomplete`, and `publication unknown` remain distinct states. It also pins the downstream `verify:m048:s03` report surface so S03 cannot silently drift back to the old misleading summary text.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `PhaseTimingEvidence` consumed by `scripts/verify-m048-s01.ts` | Report `unknown` / truthful summary text instead of pretending the payload was absent or unpublished. | N/A — this task consumes already-fetched evidence and adds no new remote dependency. | Distinguish `evidence present but incomplete` from `no evidence` and keep `published: null` as `publication unknown`. |
| Downstream live-report reuse in `scripts/verify-m048-s03.ts` | Keep the shared summary string visible in the S03 report instead of re-deriving wording locally. | N/A — local report formatting only. | Add test coverage so downstream output cannot silently drift back to older wording when S01 changes. |

## Negative Tests

- **Malformed inputs**: evidence with `conclusion: null`, `published: null`; `conclusion: "success", published: null`; and `conclusion: "timeout", published: null` each need dedicated assertions.
- **Error paths**: `!evidence` must remain the only path that prints `no correlated phase evidence available`.
- **Boundary conditions**: downstream `verify:m048:s03` report output must preserve the repaired S01 summary string unchanged when live phase timing is present.

## Steps

1. Add failing regressions in `scripts/verify-m048-s01.test.ts` for `evidence present but incomplete`, `success + publication unknown`, and `timeout + publication unknown`.
2. Update `scripts/verify-m048-s01.ts` so `deriveM048S01Outcome()` keeps the no-evidence summary only for `!evidence` and renders `publication unknown` whenever `published === null`.
3. Extend `scripts/verify-m048-s03.test.ts` so the downstream live report proves it reuses the repaired S01 summary text unchanged.
4. Run the targeted S01/S03 tests plus `scripts/verify-m048-s02.test.ts` as a downstream class-shape guard.

## Must-Haves

- [ ] `no correlated phase evidence available` is reserved for the true `!evidence` path.
- [ ] `published: null` is rendered as `publication unknown`, never as `no published output`.
- [ ] The repaired S01 summary text is pinned in `verify:m048:s03` so downstream operator output cannot drift independently.

## Verification

- `bun test ./scripts/verify-m048-s01.test.ts ./scripts/verify-m048-s03.test.ts`
- `bun test ./scripts/verify-m048-s02.test.ts`

## Observability Impact

- Signals added/changed: `verify:m048:s01` human/json `outcome.summary` strings become tri-state truthful and `verify:m048:s03` keeps exposing that shared summary line.
- How a future agent inspects this: run the targeted S01/S03 tests and inspect the asserted summary strings in both report surfaces.
- Failure state exposed: incomplete evidence now shows up as `unknown` / `publication unknown` wording rather than silently collapsing into `no evidence` or `not published`.

## Inputs

- `scripts/verify-m048-s01.ts` — current S01 verifier logic that collapses incomplete evidence into misleading summaries.
- `scripts/verify-m048-s01.test.ts` — existing regression harness to extend with null-field summary cases.
- `scripts/verify-m048-s02.test.ts` — downstream class-based regression guard that should stay green after the wording repair.
- `scripts/verify-m048-s03.ts` — downstream report surface that prints `report.live.phaseTiming.outcome.summary`.
- `scripts/verify-m048-s03.test.ts` — downstream regression harness to pin the shared summary text.

## Expected Output

- `scripts/verify-m048-s01.ts` — repaired outcome-summary logic that preserves `no evidence` versus `publication unknown` truth.
- `scripts/verify-m048-s01.test.ts` — explicit regressions for incomplete evidence and publication-unknown wording.
- `scripts/verify-m048-s03.test.ts` — downstream report assertions proving S03 reuses the repaired S01 summary text unchanged.
