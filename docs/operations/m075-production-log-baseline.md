# M075 Production Log Baseline

Generated from the M075/S01 verifier fixture at `scripts/fixtures/m075-s01-production-log-baseline.json`.

- Baseline generated: `2026-05-20T14:46:09.362Z`
- Source: Azure Log Analytics live collection, published as a sanitized projection
- Windows: `last12h` (`PT12H`) and `last7d` (`P7D`)
- Workspaces queried: 21
- Rows sampled: 400 total, 1 malformed
- Raw rows included: no

The live verifier source was reachable. Raw parsed log rows were intentionally discarded before this artifact was published; only counts, source metadata, first/last sanitized example timestamps, and capped examples are retained. The fixture redaction state therefore describes the published projection, not the discarded raw live rows.

## Source query shapes

The verifier uses bounded Log Analytics query shapes and passes the time window separately via the Azure CLI `-t` argument.

### Last 12 hours

```kusto
ContainerAppConsoleLogs_CL
| project TimeGenerated, Log_s, RevisionName_s, ContainerAppName_s
| order by TimeGenerated asc
| take 200
```

Azure CLI timespan: `PT12H`.

### Last 7 days

```kusto
ContainerAppConsoleLogs_CL
| project TimeGenerated, Log_s, RevisionName_s, ContainerAppName_s
| order by TimeGenerated asc
| take 200
```

Azure CLI timespan: `P7D`.

These are query shapes only. Do not paste raw `Log_s` payloads into docs, fixtures, or task summaries.

## Current baseline counts

| Issue class | Classification | Owner | Last 12h | Last 7d | Status | First/last sanitized example |
|---|---:|---:|---:|---:|---|---|
| `knowledge-store.undefined-write` | app-actionable | S02 | 0 | 0 | historical taxonomy class | none |
| `inline-publication.line-not-commentable` | app-actionable | S03 | 0 | 0 | historical taxonomy class | none |
| `candidate-publication.non-approved-missing-reason` | app-actionable | S04 | 1 | 0 | current in last-12h | `2026-05-20T09:27:51.0183944Z` |
| `review-timeout-classification.expected-bounded-outcome` | transient | S05 | 0 | 0 | structured S05 taxonomy class | none |
| `review-timeout-classification.hard-failure` | app-actionable | S05 | 0 | 0 | structured S05 taxonomy class | none |
| `review-timeout-classification.long-run-threshold` | app-actionable | S05 | 0 | 0 | structured S05 taxonomy class | none |
| `review.timeout-or-long-run` | transient | S05 | 0 | 0 | raw ambiguous fallback class | none |
| `addon-check-classification.expected-bounded-outcome` | transient | S06 | 0 | 0 | structured S06 follow-up class | none |
| `addon-check-classification.actionable-diagnostic` | app-actionable | S06 | 0 | 0 | structured S06 follow-up class | none |
| `addon-check-classification.malformed-evidence` | app-actionable | S06 | 0 | 0 | structured S06 follow-up class | none |
| `addon-check.timeout` | transient | S06 | 0 | 0 | historical taxonomy class | none |
| `azure.platform-noise` | azure-platform | none | 4 | 4 | platform/transient | last12h `2026-05-20T09:25:47.77131Z` to `2026-05-20T09:25:48.6440884Z`; last7d `2026-05-13T15:37:58.1450233Z` to `2026-05-13T15:37:58.9511078Z` |

## Downstream owner mapping

App-actionable and Kodiai-owned transient classes intentionally map to the follow-on M075 slices:

| Class | Downstream slice | Why it matters |
|---|---|---|
| `knowledge-store.undefined-write` | S02 | Eliminate undefined payload writes before they reach the knowledge persistence boundary. |
| `inline-publication.line-not-commentable` | S03 | Reduce approved inline findings targeting GitHub lines that cannot accept comments. |
| `candidate-publication.non-approved-missing-reason` | S04 | Ensure non-approved candidate publication outcomes carry safe reason/mode evidence. |
| `review-timeout-classification.expected-bounded-outcome` | S05 | Structured timeout handling succeeded with bounded partial, max-turns, or retry continuation evidence; track volume separately from failures. |
| `review-timeout-classification.hard-failure` | S05 | Structured timeout handling found zero-evidence, retry-failed, chronic-timeout, or malformed-evidence hard failures that remain actionable. |
| `review-timeout-classification.long-run-threshold` | S05 | Structured timeout handling crossed the long-run threshold and should remain actionable for regression triage. |
| `review.timeout-or-long-run` | S05 | Raw or ambiguous fallback class for legacy timeout/long-run text before structured classification is available. |
| `addon-check-classification.expected-bounded-outcome` | S06 | Structured addon-check handling completed cleanly or reached an expected bounded outcome such as tool-unavailable behavior. |
| `addon-check-classification.actionable-diagnostic` | S06 | Structured addon-check handling produced bounded findings, partial/all timeout, or mixed-incomplete diagnostics that operators can act on. |
| `addon-check-classification.malformed-evidence` | S06 | Structured addon-check handling failed closed on malformed evidence and should stay distinct from legacy raw timeout noise. |
| `addon-check.timeout` | S06 | Legacy raw ambiguous addon-check timeout fallback; S07 should use remaining volume here to detect unstructured production noise. |
| `azure.platform-noise` | none | Azure/Container Apps platform signals are separated from app-fix work and must not receive an app owner. |

## Operator interpretation

- `app-actionable` means the class represents Kodiai behavior that a downstream slice must reduce or explain.
- `transient` means Kodiai owns better classification or mitigation, but the specific event may be load/timing dependent. For S05, `review-timeout-classification.expected-bounded-outcome` is the expected structured timeout-handling bucket, while `review.timeout-or-long-run` is reserved for raw ambiguous legacy text. For S06, `addon-check-classification.expected-bounded-outcome` is the expected structured addon-check bucket, while `addon-check.timeout` is reserved for raw ambiguous legacy timeout text.
- `azure-platform` means the row is platform noise. It is tracked for separation only and has no app-fix owner.
- `historical taxonomy class` with count `0` is retained so future verifiers can detect regressions without losing the M075 taxonomy shape.

## Verification

Run the canonical fixture verifier:

```sh
bun run verify:m075:s01 -- --fixture scripts/fixtures/m075-s01-production-log-baseline.json --json
```

For the final M075 proof gate, operators should use the aggregate local and live commands documented in `docs/operations/m075-final-production-proof.md`:

```sh
bun run verify:m075 -- --json
bun run verify:m075 -- --live --json
```

Expected fixture result:

- `success: true`
- `statusCode: m075_s01_ok`
- both `last12h` and `last7d` windows present
- app-actionable classes have S02-S04 owners
- Kodiai transient classes have S05-S06 owners
- Azure/platform class has `downstreamOwner: null`
- redaction passes with `rawPayloadsExcluded: true` and no violations

Expected aggregate live result for R156 validation:

- `success: true`
- `statusCode: m075_ok`
- health/readiness check ids pass with live source configured
- `live-source.available`, `raw-regression.absent`, `structured-reclassification.visible`, and `live-redaction.safe` pass
- raw targeted issue classes are zero
- Azure platform noise remains separated from app-owned classes
- structured expected-bounded outcomes are allowed, while structured hard/actionable outcomes remain visible for triage
