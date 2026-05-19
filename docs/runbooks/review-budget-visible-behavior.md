# Review budget visible behavior runbook

This runbook explains how operators and later live-proof work should inspect the M073/S05 visible budget behavior evidence. S05 is the public disclosure boundary for budget-aware review behavior: it explains when a review was complete, scoped, or fallback-driven without exposing raw prompts, diffs, cache keys, candidates, model output, or checkpoint content.

S05 consumes the bounded outcomes from:

- S02 prompt budgets: included, trimmed, and bypassed section counts and token estimates.
- S03 cache telemetry: hit, miss, degraded, and bypass cache observations plus bounded reasons.
- S04 continuation compaction: compacted, fallback, degraded, and bypass continuation observations plus bounded fallback/count fields.

It does **not** prove live production cost reduction by itself. It proves the visible/operator-facing disclosure shape is bounded, deterministic, and redaction-safe.

## Run the verifier

From the repository root:

```sh
bun scripts/verify-m073-s05.ts --fixture scripts/fixtures/m073-s05-visible-budget.json --json
```

Package-script equivalent:

```sh
bun run verify:m073:s05 --json
```

Expected successful shape:

- `overallPassed: true`
- `statusCode: "m073_s05_ok"`
- `failedCheckIds: []`
- `observedTotals.projectionCount` includes the replayed visible budget projections
- `observedTotals.statusCounts` includes complete, scoped, and fallback states
- `observedTotals.reasonCounts` includes bounded visible reasons
- aggregate prompt/cache/continuation counts match the deterministic fixture summary

The verifier is offline. It reads a tracked JSON fixture and does not require live GitHub, telemetry, database, cache, or model access.

## Allowed public evidence fields

Visible review output and Review Details may expose only bounded projection fields and aggregate counts. Allowed categories are:

| Category | Allowed examples | Notes |
|---|---|---|
| Scenario/status | `happy-path`, `scoped-review`, `fallback-review`, `complete`, `scoped`, `fallback` | Scenario labels describe bounded behavior classes, not raw review content. |
| Visible reason | `within-budget`, `prompt-budget-limited`, `continuation-compacted`, `continuation-fallback`, `cache-degraded` | Reason vocabulary is intentionally small and stable for automation. |
| Prompt budget counts | section count, trimmed section count, bypassed section count, trimmed token estimate | Counts may explain why a review was scoped. They must not identify omitted text. |
| Cache counts | observation count, hit/miss/degraded/bypass counts, missing-signal and invalidation counts | Counts may explain cache state. Raw cache keys and fingerprints are forbidden. |
| Continuation counts | compacted/fallback/degraded/bypass counts, included delta count, reused checkpoint count, omitted/remaining scope counts | Counts may explain fallback or compacted retry behavior. Checkpoint text is forbidden. |
| Verifier metadata | command name, status code, failed check IDs, bounded issue messages | Issues are intentionally capped and must not echo rejected payload values. |

## Redaction boundary

Never publish or add these fields to S05 fixtures, Review Details, visible review comments, runbooks, summaries, or issues:

- raw prompts, prompt fragments, included text, trimmed text, or prompt section bodies
- raw diffs, patches, review comments, suggested changes, or candidate findings
- model input/output, completion content, tool payloads, or specialist candidate payloads
- raw cache keys, raw fingerprints, embedding vectors, checkpoint text, or checkpoint file content
- token strings, API keys, secrets, private local paths, or live production identifiers that are not explicitly approved bounded IDs

If debugging requires an example, replace it with a short category, status, reason code, count, or generic placeholder such as `delivery-id`, `repo/name`, `case-id`, or `checkpoint-count`.

## Scoped-review language

Use scoped-review language when the projection reports `visibleStatus: "scoped"` or `visibleReason: "prompt-budget-limited"`.

Safe phrasing:

- "Review was scoped because prompt-budget limits trimmed or bypassed some bounded sections."
- "Review Details show trimmed section and token-estimate counts; omitted content is not shown."
- "The verifier proves bounded disclosure, not that hidden content was safe or irrelevant."

Avoid phrasing that overclaims:

- Do not say the model reviewed every omitted section.
- Do not say trimmed content was unimportant.
- Do not reconstruct which exact prompt text, diff hunk, candidate, or file content was omitted unless the existing safe review surface already exposes that fact independently.
- Do not rely on exact English wording for automation; consume `visibleStatus`, `visibleReason`, `failedCheckIds`, and `observedTotals` instead.

## Check IDs

| Check ID | Pass condition | Failure means |
|---|---|---|
| `fixture.shape` | The fixture root has `visibleBudgetProjections[]` and a compatible summary shape. | The fixture is malformed or cannot be evaluated safely. |
| `projection-cases.present` | At least one visible budget projection is present. | There is no replayed visible disclosure evidence. |
| `scenario-coverage.present` | The fixture includes happy-path, scoped-review, and fallback-review examples. | S05 cannot prove the required visible behavior classes. |
| `vocabulary.bounded` | Scenarios, statuses, reasons, and nested status/reason maps use approved bounded vocabulary. | The public surface may drift into free-form or unreviewed terms. |
| `projection-safety.valid` | Scenario/status/reason combinations and counts are internally consistent. | The visible explanation may overclaim, underclaim, or contradict upstream budget/cache/continuation state. |
| `totals.deterministic` | `visibleBudgetSummary` exactly equals deterministic sums from all projections. | Public/operator summaries cannot be trusted. |
| `redaction.safe` | The fixture contains only bounded fields and no secret-like values. | Raw text, raw keys, candidate/model content, oversized strings, or secrets were detected. |

## Failure triage

Start with `failedCheckIds`, then inspect bounded `issues`. Do not paste raw review payloads while debugging.

1. For `fixture.shape`, confirm the JSON root contains `visibleBudgetProjections` as an array and `visibleBudgetSummary` as an object.
2. For `projection-cases.present`, add bounded replay projections produced from the S05 public projection contract, not raw review output.
3. For `scenario-coverage.present`, include one representative `happy-path`, `scoped-review`, and `fallback-review` projection.
4. For `vocabulary.bounded`, replace free-form text with approved status and reason codes from the projection contract.
5. For `projection-safety.valid`, align scenario/status/reason combinations with the behavior: scoped reviews need prompt-budget-limited budget evidence; fallback reviews need continuation fallback evidence; complete happy paths should not claim omitted budget or fallback work.
6. For `totals.deterministic`, recompute `visibleBudgetSummary` from `visibleBudgetProjections` instead of editing totals by hand.
7. For `redaction.safe`, remove forbidden field names and replace payload examples with counts, statuses, reasons, or generic placeholders. The verifier must not echo unsafe payload values.

## S06 live-proof handoff

S06 should use S05 outputs as a contract, not as exact prose.

Consume these stable fields:

- `overallPassed`, `statusCode`, and `failedCheckIds`
- `checks[].id`, `checks[].status`, bounded `checks[].message`, and bounded `checks[].issues`
- `observedTotals.projectionCount`
- `observedTotals.statusCounts` and `observedTotals.reasonCounts`
- prompt/cache/continuation aggregate count fields from `observedTotals`
- Review Details fields that map to the same bounded projection vocabulary

Do not assert on exact human-readable Review Details wording. Wording may change as long as the bounded status, reason, and aggregate count contract remains stable and redaction-safe.

For live proof, S06 should map live Review Details/operator evidence into the same shape used by `scripts/fixtures/m073-s05-visible-budget.json`, run the S05 verifier or equivalent checks, and separately verify that existing safety gates still block raw prompts, cache keys, candidates, diffs, and model output from public surfaces.

## S07 remediation handoff

Before final M073 validation, run the S07 remediation proof:

```sh
bun run verify:m073:s07 --json
```

S07 links S02 budget rows back to S01 baseline rows and records that R131 is formally re-scoped rather than completed by M073. Operators should read `docs/smoke/m073-s07-remediation.md` for the latest linkage totals, R131 disposition, and non-publication boundary. This runbook remains the S05 visible-disclosure contract; it should not be used as standalone R131 validation.

## Quick interpretation checklist

- If `overallPassed` is true, the fixture satisfies the bounded visible budget disclosure contract.
- If status is `complete`, Review Details may say no budget scoping or fallback affected visible review behavior.
- If status is `scoped`, Review Details may mention prompt-budget limits with counts only.
- If status is `fallback`, Review Details may mention continuation fallback with counts only.
- Cache degraded/miss/bypass states may be summarized as bounded reasons and counts, not keys or fingerprints.
- Any verifier redaction failure is a release-blocking evidence failure until the unsafe field or value is removed.
