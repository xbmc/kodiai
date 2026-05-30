# M075 Review Timeout Classification

M075/S05 adds a structured `gate=review-timeout-classification` signal for review timeout and long-run handling. Operators should prefer this structured gate over raw message text when investigating review timeout behavior.

## Safe structured fields

The runtime log and resilience telemetry projection is intentionally bounded:

- `gate`: always `review-timeout-classification`
- `classification`: `expected-bounded-outcome`, `hard-failure`, or `unknown`
- `gateResult`: mirrors `classification`
- `mode`: closed vocabulary such as `bounded-partial-timeout`, `zero-evidence-hard-timeout`, `max-turns-continuation`, `chronic-timeout-skip`, `retry-enqueued`, `retry-completed`, `retry-failed`, or `long-run-threshold-exceeded`
- `reasonCodes`: non-empty closed reason tokens, capped by the classifier
- bounded counts: checkpoint, retry, chronic-timeout, and long-run threshold counters only
- correlation: `deliveryId` and `reviewOutputKey`
- redaction flags: prove raw payloads were omitted rather than copied into telemetry

Do not add raw prompts, model output, candidate bodies, diffs, GitHub response payloads, raw logs, or secrets to this surface.

## Production taxonomy

Structured S05 rows map to dedicated production classes:

| Taxonomy class | Classification | Action |
|---|---|---|
| `review-timeout-classification.expected-bounded-outcome` | transient | Expected bounded timeout handling. Track rate and correlate by `deliveryId`/`reviewOutputKey`; do not page as a hard failure by itself. |
| `review-timeout-classification.hard-failure` | app-actionable | Investigate zero-evidence, retry-failed, chronic-timeout, or malformed-evidence modes. |
| `review-timeout-classification.long-run-threshold` | app-actionable | Investigate long-run regressions even when the row is structured and redaction-safe. |
| `review.timeout-or-long-run` | transient | Raw ambiguous fallback for legacy or unstructured timeout text. Prefer structured classes when `gate=review-timeout-classification` is present. |

## S07 expected log signatures

S07 should query for `gate == "review-timeout-classification"` first and then group by `classification`, `mode`, and `reasonCodes`.

Expected healthy signatures:

- bounded partial timeout: `classification=expected-bounded-outcome`, `mode=bounded-partial-timeout`, reasons include `partial-timeout` and `checkpoint-present`
- max turns continuation: `classification=expected-bounded-outcome`, `mode=max-turns-continuation`, reasons include `max-turns` and `continuation-pending`
- retry progress: `classification=expected-bounded-outcome`, `mode=retry-enqueued` or `retry-completed`

Actionable signatures:

- zero evidence: `classification=hard-failure`, `mode=zero-evidence-hard-timeout`
- retry failed: `classification=hard-failure`, `mode=retry-failed`
- chronic skip: `classification=hard-failure`, `mode=chronic-timeout-skip`
- long-run threshold: `classification=hard-failure`, `mode=long-run-threshold-exceeded`

## Local verification

Run the fixture verifier:

```sh
bun run verify:m075:s05 -- --fixture scripts/fixtures/m075-s05-review-timeout-classification.json --json
```

Expected result:

- `success: true`
- `statusCode: m075_s05_ok`
- eight required modes covered
- non-empty safe reason codes
- package script present
- structured taxonomy classes present
- redaction passes with no raw canary keys or values
