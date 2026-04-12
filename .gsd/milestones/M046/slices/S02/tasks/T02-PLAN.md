---
estimated_steps: 33
estimated_files: 5
skills_used: []
---

# T02: Build the pure calibration evaluator for live-vs-intended model paths

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

## Inputs

- ``src/contributor/xbmc-fixture-snapshot.ts` — shared validated snapshot loader introduced in T01.`
- ``src/contributor/expertise-scorer.ts` — current live and batch scoring math plus signal-weight helpers.`
- ``src/contributor/tier-calculator.ts` — percentile tiering behavior and tie-order risk surface.`
- ``src/contributor/experience-contract.ts` — M045 contract mapping that the evaluator must project through.`
- ``src/handlers/review.ts` — actual runtime call path proving only `pr_authored` incremental updates run today.`
- ``src/slack/slash-command-handler.ts` — linked-profile surface that treats default newcomer profiles as profile-backed.`

## Expected Output

- ``src/contributor/calibration-evaluator.ts` — deterministic evaluator and recommendation logic for live vs intended model paths.`
- ``src/contributor/calibration-evaluator.test.ts` — regression tests for cohort truth, contract projection, tie instability, and freshness/unscored diagnostics.`
- ``src/contributor/expertise-scorer.ts` — minimal deterministic extraction only if needed to reuse score math honestly without changing runtime behavior.`
- ``src/contributor/index.ts` — exports the evaluator for the verifier script.`

## Verification

bun test ./src/contributor/calibration-evaluator.test.ts

## Observability Impact

Adds evaluator-level fidelity/degradation flags, per-contributor freshness diagnostics, and explicit instability findings that the verifier can expose verbatim when calibration assumptions break.
