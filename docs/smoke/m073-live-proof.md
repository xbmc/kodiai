# M073 live-proof smoke artifact

This smoke artifact records the production-like S06 proof for the token-first review pipeline. It is intentionally aggregate-only: no raw prompts, diffs, review comments, candidate payloads, model output, cache keys, fingerprints, checkpoint content, token strings, or secrets are included.

## Evidence sources

| Source | Role | Safe fields consumed |
|---|---|---|
| `docs/runbooks/review-token-cost-baseline.md` | Baseline interpretation and safety boundary | verifier status, aggregate runtime tokens, aggregate duration, phase latency guidance |
| `docs/runbooks/review-budget-visible-behavior.md` | Public disclosure and operator boundary | visible status/reason vocabulary, redaction rules, S06 handoff guidance |
| `scripts/fixtures/m073-s01-baseline-scorecard.json` | Replay baseline | bounded case IDs, aggregate runtime usage, phase latency rows |
| `scripts/fixtures/m073-s05-visible-budget.json` | Visible projection proof | bounded projection counts, statuses, reasons, prompt/cache/continuation summaries |
| `scripts/fixtures/m073-s06-live-proof.json` | S06 live-proof fixture | upstream pass status, before/after totals, latency ceiling, rollback controls, negative cases |

## Production-like proof summary

| Signal | Baseline | Production-like proof | Result |
|---|---:|---:|---|
| Runtime tokens | 21,200 | 16,200 | 23.58% reduction |
| Runtime duration | 198,000 ms | 138,000 ms | within 210,000 ms ceiling |
| Runtime rows | 3 baseline deliveries | 2 bounded proof rows | normal and retry/fallback coverage |
| Visible projections | 3 | 3 | complete, scoped, and fallback coverage |
| Rollback controls | n/a | 3 verified controls | rollback-ready |

## Phase latency rows

| Case | Phase | Status | Duration |
|---|---|---|---:|
| normal-full-review | context-assembly | completed | 7,200 ms |
| normal-full-review | remote-runtime | completed | 38,000 ms |
| normal-full-review | publication | completed | 2,400 ms |
| retry-timeout-review | context-assembly | completed | 11,600 ms |
| retry-timeout-review | remote-runtime | fallback | 100,000 ms |
| retry-timeout-review | publication | completed | 3,200 ms |

## Budget, cache, continuation, and visible disclosure

| Area | Aggregate proof |
|---|---|
| Prompt budget | 5 sections; 2 included, 2 trimmed, 1 bypassed; 925 included token estimate; 350 trimmed token estimate |
| Cache | 7 observations; 1 hit, 2 misses, 2 degraded, 2 bypassed |
| Continuation | 7 observations; 1 compacted, 4 fallback, 1 degraded, 1 bypassed; 29 included deltas; 3 reused checkpoints |
| Visible disclosure | Review Details visible; projection-compatible; raw payload publication false |
| Visible status counts | complete: 1, scoped: 1, fallback: 1 |
| Visible reason counts | within-budget: 1, prompt-budget-limited: 1, continuation-fallback: 1 |

## Rollback path

The production-like proof is rollback-ready when these controls are verified with the listed disable value:

| Control | Disable value | Verified |
|---|---|---|
| `review.promptBudget.enabled` | `false` | yes |
| `review.cacheReuse.enabled` | `false` | yes |
| `review.continuationCompaction.enabled` | `false` | yes |

The last known safe mode is `legacy-full-context`. Operators should disable the controls above if the live-proof verifier reports token regression, latency regression, visible projection incompatibility, rollback gaps, or redaction failures.

## Redaction and failure localization

The S06 fixture localizes unsafe rollout evidence through stable verifier check IDs. The required redaction-sensitive checks are:

- `fixture.shape`
- `redaction.safe`
- `visible-projection.compatible`

Negative cases in `scripts/fixtures/m073-s06-live-proof.json` prove that token regression, latency regression, rollback gaps, and unsafe payload field names fail closed without requiring live GitHub writes.

## Verification command

```sh
bun scripts/verify-m073-s06.ts --fixture scripts/fixtures/m073-s06-live-proof.json --json
```

Expected result:

- `overallPassed: true`
- `statusCode: "m073_s06_ok"`
- `failedCheckIds: []`
- observed totals report 5 upstream evidence rows, 2 runtime proof rows, 23.58% token reduction, 138,000 ms live duration, 3 rollback controls, and 4 negative cases.

## Final T04 proof-bundle run

The final M073/S06 proof bundle was run through the package verifier with production-like, offline evidence only. No live GitHub writes were performed or implied.

| Command | Exit Code | Status Code | Failed Checks | Duration |
|---|---:|---|---|---:|
| `bun run verify:m073:s06 --json` | 0 | `m073_s06_ok` | none | 126 ms |

Final observed totals: 5 of 5 upstream evidence rows passed, 2 runtime proof rows were evaluated, runtime tokens dropped from 21,200 to 16,200 (23.58% reduction), proof latency was 138,000 ms under the 210,000 ms ceiling, visible projection count remained 3, rollback control count remained 3, and 4 negative cases were covered.
