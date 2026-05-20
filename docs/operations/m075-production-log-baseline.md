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
| `review.timeout-or-long-run` | transient | S05 | 0 | 0 | historical taxonomy class | none |
| `addon-check.timeout` | transient | S06 | 0 | 0 | historical taxonomy class | none |
| `azure.platform-noise` | azure-platform | none | 4 | 4 | platform/transient | last12h `2026-05-20T09:25:47.77131Z` to `2026-05-20T09:25:48.6440884Z`; last7d `2026-05-13T15:37:58.1450233Z` to `2026-05-13T15:37:58.9511078Z` |

## Downstream owner mapping

App-actionable and Kodiai-owned transient classes intentionally map to the follow-on M075 slices:

| Class | Downstream slice | Why it matters |
|---|---|---|
| `knowledge-store.undefined-write` | S02 | Eliminate undefined payload writes before they reach the knowledge persistence boundary. |
| `inline-publication.line-not-commentable` | S03 | Reduce approved inline findings targeting GitHub lines that cannot accept comments. |
| `candidate-publication.non-approved-missing-reason` | S04 | Ensure non-approved candidate publication outcomes carry safe reason/mode evidence. |
| `review.timeout-or-long-run` | S05 | Separate and reduce review timeout or chronic long-run behavior. |
| `addon-check.timeout` | S06 | Separate and reduce addon-check timeout behavior. |
| `azure.platform-noise` | none | Azure/Container Apps platform signals are separated from app-fix work and must not receive an app owner. |

## Operator interpretation

- `app-actionable` means the class represents Kodiai behavior that a downstream slice must reduce or explain.
- `transient` means Kodiai owns better classification or mitigation, but the specific event may be load/timing dependent.
- `azure-platform` means the row is platform noise. It is tracked for separation only and has no app-fix owner.
- `historical taxonomy class` with count `0` is retained so future verifiers can detect regressions without losing the M075 taxonomy shape.

## Verification

Run the canonical fixture verifier:

```sh
bun run verify:m075:s01 -- --fixture scripts/fixtures/m075-s01-production-log-baseline.json --json
```

Expected result:

- `success: true`
- `statusCode: m075_s01_ok`
- both `last12h` and `last7d` windows present
- app-actionable classes have S02-S04 owners
- Kodiai transient classes have S05-S06 owners
- Azure/platform class has `downstreamOwner: null`
- redaction passes with `rawPayloadsExcluded: true` and no violations
