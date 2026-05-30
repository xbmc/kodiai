# M075 Addon Check Classification

M075/S06 adds a structured `gate=addon-check-classification` signal for addon-check completion, findings, timeouts, tool-unavailable paths, and malformed evidence. Operators should prefer this structured gate over raw addon-check timeout text when investigating PR review behavior.

## Safe structured fields

The runtime log, PR review diagnostic, taxonomy fixture, and verifier projection are intentionally bounded:

- `gate`: always `addon-check-classification`
- `classification`: `expected-bounded-outcome`, `actionable-diagnostic`, or `unknown`
- `gateResult`: mirrors `classification` in runtime log rows
- `mode`: closed vocabulary: `completed-clean`, `completed-with-findings`, `partial-timeout`, `all-timeout`, `mixed-incomplete`, `tool-unavailable`, or `unknown-malformed-evidence`
- `reasonCodes`: non-empty safe tokens capped by the classifier
- bounded counts: `addonCount`, `completedCount`, `timedOutCount`, `toolNotFoundCount`, `findingCount`, `errorCount`, `warningCount`, and `timeBudgetMs`
- correlation: `deliveryId`, `repo`, and `prNumber`
- redaction flags: `rawCheckerOutputOmitted`, `workspacePathsOmitted`, `githubPayloadOmitted`, `addonIdentifiersOmitted`, `boundedReasonCodes`, `unsafeInputOmitted`, and `rawCanaryDetected`

Do not add raw checker stdout/stderr, workspace paths, addon identifiers, GitHub payloads, raw logs, diffs, model output, prompts, or secrets to this surface.

## Production taxonomy

Structured S06 rows map before raw legacy timeout text:

| Taxonomy class | Classification | Action |
|---|---|---|
| `addon-check-classification.expected-bounded-outcome` | transient | Expected bounded addon-check result, including clean completion and tool-unavailable skip behavior. Track rates and correlate by `deliveryId`, `repo`, and `prNumber`; do not treat as ambiguous timeout noise. |
| `addon-check-classification.actionable-diagnostic` | app-actionable | Review bounded diagnostics for findings, partial timeouts, all-timeout outcomes, or mixed incomplete outcomes. |
| `addon-check-classification.malformed-evidence` | app-actionable | Investigate malformed classifier input or fail-closed evidence. The verifier expects this to stay distinct from legacy timeout text. |
| `addon-check.timeout` | transient | Raw ambiguous fallback for legacy or unstructured addon-check timeout text. S07 should use this as the remaining-noise detector. |

## S07 expected log signatures

S07 should query for `gate == "addon-check-classification"` first and then group by `classification`, `mode`, and `reasonCodes`.

Expected bounded signatures:

- clean completion: `classification=expected-bounded-outcome`, `mode=completed-clean`, reasons include `completed-clean`
- tool unavailable: `classification=expected-bounded-outcome`, `mode=tool-unavailable`, reasons include `tool-unavailable`

Actionable signatures:

- completed with findings: `classification=actionable-diagnostic`, `mode=completed-with-findings`, reasons include `findings-present`
- partial timeout: `classification=actionable-diagnostic`, `mode=partial-timeout`, reasons include `partial-timeout`
- all timeout: `classification=actionable-diagnostic`, `mode=all-timeout`, reasons include `all-timeout`
- mixed incomplete: `classification=actionable-diagnostic`, `mode=mixed-incomplete`, reasons include `mixed-incomplete`
- malformed evidence: `classification=unknown`, `mode=unknown-malformed-evidence`, reasons include `unknown-evidence` and `safe-degraded`

## Local verification

Run the fixture verifier:

```sh
bun run verify:m075:s06 -- --fixture scripts/fixtures/m075-s06-addon-check-classification.json --json
```

Expected result:

- `success: true`
- `statusCode: m075_s06_ok`
- seven required modes covered
- non-empty safe reason codes
- package script present
- structured taxonomy classes present before the `addon-check.timeout` fallback
- redaction passes with no raw checker output, workspace paths, GitHub payloads, addon identifiers, or secret canaries
