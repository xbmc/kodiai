# Review live proof and rollback runbook

This runbook explains how operators and future agents run the M073/S06 live-proof verifier, interpret failures, and roll back token-first review behavior if the proof does not satisfy token, latency, visible-publication, redaction, or rollback gates.

S06 is a rollout-readiness proof surface. It consumes bounded evidence from S01-S05 and production-like runtime rows. It does not perform live GitHub writes, publish review comments, or authorize future external writes by itself.

## Safety boundary

The live-proof fixture and verifier output are intentionally text-free. They may include stable IDs, verifier status codes, failed check IDs, aggregate token counts, durations, bounded status/reason counts, and rollback control names. They must not include raw prompts, diffs, review comments, candidate payloads, model output, cache keys, fingerprints, checkpoint text, tokens, secrets, or unapproved production identifiers.

Future live PR review writes require explicit user confirmation before execution. Do not use this runbook as implied permission to comment on a PR, submit a review, update GitHub state, or trigger any other external write.

## Run the verifier

From the repository root:

```sh
bun run verify:m073:s06 --json
```

Equivalent direct command:

```sh
bun scripts/verify-m073-s06.ts --fixture scripts/fixtures/m073-s06-live-proof.json --json
```

Expected successful shape:

- `overallPassed: true`
- `statusCode: "m073_s06_ok"`
- `failedCheckIds: []`
- `checks[]` with stable check IDs and pass/fail status
- `observedTotals` with upstream pass count, baseline/live token totals, token reduction, latency, visible projection counts, rollback control count, and negative-case count
- bounded `issues[]`; empty on success

The verifier is offline. It reads a tracked fixture and does not require live GitHub, telemetry, database, cache, or model access.

## What S06 proves

S06 proves that a production-like token-first review evidence bundle is rollout-ready when all of these are true:

1. S01-S05 verifier outputs are present and passed.
2. A baseline comparison exists for runtime total tokens and duration.
3. Live or production-like runtime rows show token reduction against the S01 baseline.
4. Latency remains below the configured rollout ceiling.
5. Visible Review Details/operator disclosure remains compatible with the S05 bounded projection contract.
6. Rollback controls are named, tested, and point back to a legacy full-context safe mode.
7. Redaction checks localize unsafe field names, unbounded strings, and secret-like values.
8. Tracked negative cases prove the verifier fails token, latency, rollback, and redaction regressions.

## Check IDs and operator response

| Check ID | Pass condition | If it fails |
|---|---|---|
| `fixture.shape` | The fixture root contains `liveProof` and optional bounded `negativeProofCases`. | Fix fixture structure before interpreting rollout readiness. Do not add raw payloads while debugging. |
| `upstream-evidence.present` | S01, S02, S03, S04, and S05 evidence is present, `overallPassed: true`, ok status codes, and empty `failedCheckIds`. | Re-run the named upstream verifier and use that slice runbook. S06 cannot override a failed upstream proof. |
| `baseline-comparison.present` | Baseline/live token and latency comparison fields plus runtime rows are present. | Map runtime telemetry into bounded counts first; do not infer improvement from prose. |
| `token-reduction.met` | Live runtime total tokens are lower than baseline and meet `minimumReductionPercent`. | Block rollout or roll back token-first behavior. Re-check prompt budgets, cache reuse, and continuation compaction inputs. |
| `latency.acceptable` | `liveDurationMs` is positive and does not exceed `maxAllowedLatencyMs`. | Block rollout or roll back the changed behavior if latency exceeds the ceiling. Inspect phase timing with bounded telemetry only. |
| `visible-projection.compatible` | Review Details are visible, compatible with S05 projection counts, and no raw payload was published. | Block rollout. Use `docs/runbooks/review-budget-visible-behavior.md` to repair bounded disclosure. |
| `rollback.ready` | Rollback controls are present, verified, and point to `legacy-full-context`. | Do not roll out. Add or verify the missing disable controls before retrying. |
| `redaction.safe` | Evidence uses bounded fields and no secret-like values or raw payload field names. | Treat as release-blocking. Remove unsafe field/value and keep failure localization in verifier output. |
| `negative-cases.covered` | The tracked fixture includes failing examples for token, latency, rollback, and redaction regressions. | Add or fix bounded negative cases so future agents can trust verifier coverage. |

Start triage with `failedCheckIds`, then inspect bounded `issues`. Do not paste raw prompt text, diffs, comments, candidates, model output, cache keys, checkpoint text, or secrets into the fixture to debug a failure.

## Rollback decision path

Use rollback when any rollout-blocking check fails on production-like or live evidence:

1. **Stop new writes.** Do not initiate live PR review writes unless the user explicitly confirms that external write.
2. **Record the failed check IDs.** Preserve the JSON verifier output as bounded evidence.
3. **Disable token-first controls.** Apply the verified controls listed under `liveProof.rollback.controls`, setting each control to its `disableValue`.
4. **Return to safe mode.** Confirm behavior is back to `legacy-full-context` before retrying a live review.
5. **Re-run the verifier.** Use `bun run verify:m073:s06 --json` after updating the evidence fixture or mapped telemetry.
6. **Escalate only bounded facts.** Share status codes, check IDs, aggregate totals, and issue categories. Do not share raw review payloads.

The tracked S06 fixture names these rollback controls as bounded examples:

- `review.promptBudget.enabled=false`
- `review.cacheReuse.enabled=false`
- `review.continuationCompaction.enabled=false`

If the live deployment uses different flag names, map them into the same bounded `controls[]` shape before claiming rollback readiness.

## Relationship to earlier M073 runbooks

- S01 baseline scorecard: `docs/runbooks/review-token-cost-baseline.md`
- S05 visible budget disclosure: `docs/runbooks/review-budget-visible-behavior.md`

S06 consumes their stable verifier outputs and observed totals. It does not assert on exact prose from Review Details and does not relax any redaction boundary from earlier slices.

## Quick interpretation checklist

- If `overallPassed` is true, the bounded live-proof evidence is ready for a user-confirmed live or production-like rollout step.
- If token reduction fails, roll back or keep disabled until prompt budgets, cache reuse, and continuation compaction produce lower runtime total tokens.
- If latency fails, roll back or keep disabled until phase timing shows acceptable duration.
- If visible projection fails, fix Review Details/operator disclosure before rollout.
- If redaction fails, treat it as release-blocking and remove the unsafe field/value.
- If rollback readiness fails, do not proceed until disable controls are verified.
- Never perform future live PR review writes without explicit user confirmation.
