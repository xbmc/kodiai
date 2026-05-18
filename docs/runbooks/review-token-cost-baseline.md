# Review token cost baseline scorecard

This runbook explains how to replay the M073/S01 review token-cost baseline, read its pass/fail checks, and hand its text-free metrics to later token-budgeting, cache, continuation, disclosure, and live-proof slices.

S01 is a baseline and scorecard contract only. It does **not** prove that token usage has been reduced, cache behavior has improved, continuations are smaller, or production latency has changed.

## Safety boundary

The baseline evidence and verifier output are intentionally text-free. They may include bounded identifiers, names, counts, statuses, aggregate token/cost values, and durations. They must not include raw prompts, diffs, review comments, candidate payloads, model output, token strings, secrets, or production-specific identifiers beyond generic placeholders.

Use placeholders such as `case-id`, `delivery-id`, `repo/name`, `provider`, and `model` when writing examples. Do not paste live review content into fixtures, reports, issues, or summaries.

## Run the verifier

From the repository root:

```sh
bun scripts/verify-m073-s01.ts --fixture scripts/fixtures/m073-s01-baseline-scorecard.json --json
```

Expected successful shape:

- `overallPassed: true`
- `statusCode: "m073_s01_ok"`
- `failedCheckIds: []`
- `observedTotals` with aggregate replay counts, prompt sizes, runtime tokens/cost, and latency
- `observedCases[]` with the same bounded metrics grouped by replay case

For human-readable output, omit `--json`. The JSON mode is preferred for automation because failed check IDs are stable and machine-readable.

The verifier is offline: it reads a local fixture and does not require live GitHub, telemetry, database, or model access.

## S03 review cache telemetry verifier

S03 has a dedicated runbook for bounded review cache hit/miss/degraded/bypass telemetry, usage-report inspection, and safe S04 handoff: `docs/runbooks/review-cache-telemetry.md`.

Run the offline verifier from the repository root:

```sh
bun scripts/verify-m073-s03.ts --fixture scripts/fixtures/m073-s03-cache-telemetry.json --json
```

The S03 verifier and usage-report cache section prove observable safe reuse boundaries only. They do not claim live token reduction.

## S02 prompt-budget evidence verifier

S02 adds a second offline verifier for prompt-budget enforcement evidence:

```sh
bun scripts/verify-m073-s02.ts --fixture scripts/fixtures/m073-s02-prompt-budget.json --json
```

Package-script equivalent:

```sh
bun run verify:m073:s02 --json
```

Expected successful shape:

- `overallPassed: true`
- `statusCode: "m073_s02_ok"`
- `failedCheckIds: []`
- `observedTotals.sectionCount`, `includedSections`, `trimmedSections`, and `bypassedSections`
- deterministic overflow totals: `totalBudgetChars`, `totalBudgetTokens`, `totalIncludedChars`, `totalIncludedTokens`, `totalTrimmedChars`, and `totalTrimmedTokens`

The S02 fixture is also text-free. It may contain only bounded identifiers, section names, prompt kinds, counts, budgets, statuses, and reason vocabulary. It must not include raw prompts, included text, trimmed text, diffs, comments, candidate payloads, model output, completion content, token strings, secrets, or live production identifiers.

### S02 evidence fields

| Field | Meaning | Safety note |
|---|---|---|
| `promptBudgetEvidence[].caseId`, `deliveryId`, `repo`, `taskType`, `promptKind` | Bounded correlation metadata for a replayed prompt-budget observation. | Use generic replay identifiers such as `delivery-budget-001`; do not paste live IDs unless explicitly approved for fixtures. |
| `sections[].sectionName`, `sectionPosition` | Stable section identity and deterministic order. | Section names are allowed; section contents are not. |
| `sections[].budgetChars`, `budgetTokens` | Configured section budget projected into chars and estimated tokens. | Tokens are estimates from bounded counts, not raw tokenizer output. |
| `sections[].includedChars`, `includedTokens` | Bounded amount retained in the assembled prompt. | Counts only; never include retained text. |
| `sections[].trimmedChars`, `trimmedTokens` | Bounded overflow amount removed from the assembled prompt. | Counts only; this is the downstream-safe overflow proof. |
| `sections[].budgetStatus` | One of `included`, `trimmed`, or `bypassed`. | Unknown statuses fail closed. |
| `sections[].budgetReason` | One of `within-budget`, `section-over-budget`, or `zero-budget`. | Unknown reasons fail closed. |
| `overflowSummary` | Fixture-declared totals that must match deterministic sums from all section outcomes. | Mismatches fail `overflow-totals.deterministic`. |

### S02 check IDs

| Check ID | Pass condition | Failure means |
|---|---|---|
| `fixture.shape` | The fixture root has `promptBudgetEvidence[]` and `overflowSummary`. | The fixture is malformed or cannot be evaluated safely. |
| `budget-evidence.present` | At least one prompt-budget observation is present. | No replayed budget evidence was provided. |
| `budget-outcomes.valid` | Every section has bounded counts, an allowed status, an allowed reason, and status/reason/count consistency. | A budget outcome is malformed, impossible, duplicated, or uses unknown vocabulary. |
| `overflow-totals.deterministic` | `overflowSummary` exactly equals deterministic sums from section outcomes. | The fixture summary cannot prove what was included, trimmed, or bypassed. |
| `redaction.safe` | The fixture contains only bounded, text-free fields and no secret-like values. | Raw prompt/review/model text, oversized strings, or secret-like values were detected. |

### S02 failure triage

Start with `failedCheckIds`, then inspect bounded `issues`. Do not add raw prompt text while debugging.

1. For `fixture.shape`, confirm the JSON root contains `promptBudgetEvidence` as an array and `overflowSummary` as an object.
2. For `budget-evidence.present`, add a replay row from prompt section telemetry that already includes budget outcome fields.
3. For `budget-outcomes.valid`, compare section rows with `src/execution/prompt-budget.ts` and `src/execution/prompt-section-metrics.ts`: `included` rows use `within-budget`, `trimmed` rows use `section-over-budget`, and `bypassed` rows use `zero-budget` with zero included chars.
4. For `overflow-totals.deterministic`, recompute totals from section rows instead of manually guessing summary values.
5. For `redaction.safe`, remove fields named like prompt text, included text, trimmed text, diff, comment, candidate payload, model output, completion content, or content/body/text. Replace examples with section names, statuses, reason codes, and counts.

### S02 downstream handoff

Later slices should consume S02 evidence through `observedTotals`, stable check IDs, and section-level budget outcome fields. The safe handoff answers: which sections were included, trimmed, or bypassed; how much budget was configured; how much was included; and how much overflow was removed. It does **not** authorize reconstructing prompt text, publishing raw fixture rows with additional fields, or treating estimated tokens as billed model usage.

## Scorecard inputs and interpretation

The source contract lives in `src/review-cost-baseline/scorecard.ts`. The verifier projects that contract through `scripts/verify-m073-s01.ts`.

| Area | Input fields | Scorecard output | How to interpret |
|---|---|---|---|
| Replay cases | `cases[].caseId`, `label`, `repo`, `scenario`, `deliveryIds` | `totals.caseCount`, `totals.deliveryCount`, `observedCases[].scenario`, `deliveryCount` | Defines the replay population and correlation boundary. A case is the unit of baseline comparison; a delivery is an execution attempt inside that case. |
| Prompt section size | `promptSections[].promptKind`, `sections[].sectionName`, `charCount`, `estimatedTokens`, `truncated` | `promptEstimatedTokens`, `promptCharCount`, `promptSectionCount`, `truncatedExecutions` | Measures prompt section budget pressure without storing prompt text. Treat `estimatedTokens` as section-level budget input, not model-billed usage. |
| Retrieval/cache state | `retrievalCache[].evidenceType`, `status`, `cacheHitRate`, `reusedUnits`, `primaryWorkUnits`, `skippedQueries`, `retryAttempts` | `retrievalExecutionCount`, `retrievalStatuses`, reuse totals, average hit rate | Describes whether a replay used, missed, bypassed, or degraded reuse paths. It is cache/retrieval evidence, not proof of reduced cost by itself. |
| Continuation/retry attribution | `continuations[].kind`, `parentDeliveryId`, `retryScopeRatio`, `checkpointFilesReviewed`, `retryFilesCount` | `continuationDeliveries`, `retryDeliveries`, `attributedChildDeliveries` | Connects continuation or retry cost to the parent delivery so later compaction work can compare child scope against original scope. |
| Runtime token/cost usage | `runtimeUsage[].provider`, `model`, `sdk`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `estimatedCostUsd`, `durationMs`, `usedFallback` | `runtimeInputTokens`, `runtimeOutputTokens`, `runtimeCacheReadTokens`, `runtimeCacheWriteTokens`, `runtimeTotalTokens`, `runtimeEstimatedCostUsd`, `runtimeDurationMs` | Captures billed/observed runtime usage aggregates. `runtimeTotalTokens` is input plus output tokens; cache read/write tokens remain separate fields for later analysis. |
| Phase latency | `phaseLatencies[].phase`, `status`, `durationMs` | `phaseLatencyExecutions`, `phaseLatencyMs` | Gives replayable phase timing totals and status coverage. It is diagnostic baseline latency, not a performance improvement claim. |
| Redaction | Whole fixture shape | `redaction.safe` check and bounded `issues` | Enforces that evidence remains metric-only and does not leak raw review payloads or secret-like values. |

## Check IDs

| Check ID | Pass condition | Failure means |
|---|---|---|
| `cases.present` | The fixture is valid enough to evaluate and includes at least one replay case. | The fixture is missing, malformed, invalid JSON, or has no replay population. |
| `prompt-sections.present` | Each case has at least one prompt-section observation. | Prompt budget inputs are absent for a case. |
| `retrieval-cache.valid` | Each case has retrieval/cache observations using a bounded status: `hit`, `miss`, `degraded`, or `bypass`. | Cache/reuse evidence is missing or uses an unknown status. |
| `continuation.attributed` | `continuation` and `retry` cases have at least one child delivery with a valid `parentDeliveryId`. Normal cases do not require child attribution. | Continuation/retry cost cannot be traced back to the parent attempt. |
| `runtime-usage.present` | Each case has positive aggregate runtime input/output token totals. | Runtime token/cost evidence is absent or zeroed. |
| `phase-latency.present` | Each case has at least one phase latency row with a duration. | Latency evidence is missing or has no measured duration. |
| `redaction.safe` | Fixture contains only bounded metric fields and no secret-like values. | Fixture or report shape includes raw text fields, oversized string values, or secret-like content. |

## Failure triage

Start with `failedCheckIds`; then inspect the bounded `issues` array. Do not add raw prompt or review content while debugging.

### Malformed fixture or invalid JSON

Symptoms:

- `statusCode: "m073_s01_invalid_json"`
- `statusCode: "m073_s01_fixture_read_failed"`
- `failedCheckIds` includes `cases.present`
- issue text mentions unreadable path, invalid JSON, required arrays, or malformed rows

Actions:

1. Confirm the `--fixture` path is correct and points to a tracked JSON fixture.
2. Validate that the root object includes arrays named `cases`, `promptSections`, `retrievalCache`, `continuations`, `runtimeUsage`, and `phaseLatencies`.
3. Check only structural fields and bounded metrics. Do not paste raw review payloads to make validation easier.

### Missing prompt section metrics

Symptoms:

- `failedCheckIds` includes `prompt-sections.present`
- case issue says no prompt section rows matched the case

Actions:

1. Confirm `promptSections[].caseId` matches a declared `cases[].caseId` exactly.
2. Confirm every row has `deliveryId`, `repo`, `taskType`, `promptKind`, and non-empty `sections`.
3. Confirm every section has `sectionName`, `sectionPosition`, `charCount`, and `estimatedTokens`.
4. Use `src/execution/prompt-section-metrics.ts` as the compatible producer: it builds `PromptSectionMetric` and `PromptSectionRecord` values without storing prompt text.

### Missing retrieval/cache evidence

Symptoms:

- `failedCheckIds` includes `retrieval-cache.valid`
- observed case has zero `retrievalExecutionCount` or an unexpected status

Actions:

1. Confirm `retrievalCache[].caseId` matches a replay case.
2. Use one of the bounded statuses: `hit`, `miss`, `degraded`, or `bypass`.
3. Include non-negative `cacheHitRate`, `reusedUnits`, `primaryWorkUnits`, `skippedQueries`, and `retryAttempts`.
4. For live-compatible reporting, compare with `scripts/usage-report.ts` fields such as `reuseEvidence`, `rateLimits`, and cache token summaries.

### Missing continuation attribution

Symptoms:

- `failedCheckIds` includes `continuation.attributed`
- issue mentions missing valid `parentDeliveryId`
- retry or continuation case has zero `attributedChildDeliveries`

Actions:

1. Confirm the replay case `scenario` is `continuation` or `retry`; those scenarios require parent/child attribution.
2. Confirm child continuation rows use `kind: "continuation"` or `kind: "retry"`.
3. Confirm `parentDeliveryId` points to one of the same case's declared `deliveryIds`.
4. Include bounded scope metrics such as `retryScopeRatio`, `checkpointFilesReviewed`, and `retryFilesCount` when available.
5. Use `src/telemetry/types.ts` `ResilienceEventRecord` fields as the compatible live shape for timeout/retry metadata.

### Missing runtime token/cost evidence

Symptoms:

- `failedCheckIds` includes `runtime-usage.present`
- observed totals have zero `runtimeTotalTokens`
- runtime rows are missing required usage fields

Actions:

1. Confirm `runtimeUsage[].caseId` matches a replay case.
2. Include `provider`, `model`, `sdk`, non-negative input/output/cache token fields, `estimatedCostUsd`, and `usedFallback`.
3. Keep `cacheReadTokens` and `cacheWriteTokens` separate from `runtimeTotalTokens`; the scorecard totals input plus output tokens for `runtimeTotalTokens`.
4. Use `src/telemetry/types.ts` `LlmCostRecord` and `scripts/usage-report.ts` usage summaries as compatible upstream evidence shapes.

### Missing phase latency

Symptoms:

- `failedCheckIds` includes `phase-latency.present`
- observed case has zero `phaseLatencyExecutions` or zero `phaseLatencyMs`

Actions:

1. Confirm `phaseLatencies[].caseId` matches a replay case.
2. Use a known review phase name and status from the execution types.
3. Include non-negative `durationMs` for statuses other than `unavailable`.
4. Use `src/review-audit/phase-timing-evidence.ts` as the compatible producer for live phase timing evidence; it normalizes phase timing summaries into bounded phase names, statuses, and durations.

### Redaction violation

Symptoms:

- `failedCheckIds` includes `redaction.safe`
- issue mentions forbidden raw-text field, oversized string value, or secret-like value

Actions:

1. Remove fields with names such as raw prompt text, diff/patch content, comment body, candidate payload, model output, completion content, or free-form text.
2. Replace raw examples with bounded labels, counts, statuses, and durations.
3. Replace live identifiers with generic placeholders unless the identifier is already a bounded replay ID.
4. If a string exceeds the bounded fixture limit, summarize it as a short category, status, or count instead.
5. Never copy secrets into the fixture or verifier output, even temporarily.

## Downstream handoff

| Downstream slice | Fields to consume | Intended use | Safety note |
|---|---|---|---|
| S02 prompt budgets | `promptSections[].promptKind`, `sectionName`, `charCount`, `estimatedTokens`, `truncated`, plus `totals.promptEstimatedTokens` and `totals.promptCharCount` | Set and verify section-level prompt budgets against the baseline. | Budget from counts and estimates only; do not request or reconstruct prompt text. |
| S03 cache telemetry | `retrievalCache[].evidenceType`, `status`, `cacheHitRate`, `reusedUnits`, `primaryWorkUnits`, `skippedQueries`, `retryAttempts`, plus runtime cache token fields | Compare cache/reuse states and cache token movement against the baseline. | A cache hit is evidence of reuse state, not standalone proof of reduced total cost. |
| S04 continuation compaction | `continuations[].kind`, `parentDeliveryId`, `retryScopeRatio`, `checkpointFilesReviewed`, `retryFilesCount`, `attributedChildDeliveries`, and per-delivery runtime totals | Compare continuation or retry scope to the parent delivery and measure child-attributed cost. | Keep parent/child linkage at delivery-ID granularity; never include checkpoint content. |
| S05 visible bounded disclosure | `checks[].id`, `status`, bounded `message`, bounded `issues`, aggregate totals, case labels/scenarios | Publish safe scorecard status and failure categories without exposing review content. | Do not publish raw fixture rows if they include any field outside the approved metric contract. |
| S06 live proof | `observedTotals`, `observedCases`, `runtimeUsage`, `phaseLatencies`, telemetry-compatible fields from upstream producers | Prove live systems can emit evidence compatible with the S01 replay contract. | Live proof may compare against the baseline, but S01 itself makes no reduction or improvement claim. |

## Compatible upstream evidence producers

- `src/execution/prompt-section-metrics.ts` builds prompt section metrics and prompt-section records from named sections. Use its metric output, not its joined prompt text, for scorecard evidence.
- `scripts/usage-report.ts` already reports aggregate token usage, prompt sections, delivery breakdowns, rate-limit/cache summaries, and reuse evidence in bounded rows.
- `src/telemetry/types.ts` defines compatible telemetry records: `PromptSectionRecord`, `LlmCostRecord`, `RateLimitEventRecord`, and `ResilienceEventRecord`.
- `src/review-audit/phase-timing-evidence.ts` normalizes phase timing evidence into phase names, statuses, durations, correlation fields, and bounded issues.

## Updating or adding replay cases

When adding a case:

1. Add one `cases[]` row with a stable generic `caseId`, scenario, and one or more delivery IDs.
2. Add matching prompt, retrieval/cache, continuation, runtime, and phase latency rows for the same `caseId`.
3. For retry or continuation scenarios, include both parent and child delivery IDs and link the child row with `parentDeliveryId`.
4. Run the verifier in JSON mode and confirm `overallPassed` is true.
5. Review the fixture diff for raw prompt text, diffs, comments, model output, tokens, secrets, or production identifiers before committing.

## Quick interpretation checklist

- If `overallPassed` is true, the replay fixture satisfies the text-free baseline contract.
- If a downstream slice needs prompt budget data, start with prompt section `estimatedTokens` and `charCount`.
- If it needs cache or reuse data, start with retrieval/cache status rows and runtime cache token fields.
- If it needs continuation or retry cost, start with parent/child attribution and child runtime totals.
- If it needs user-visible reporting, publish only check IDs, statuses, bounded issue categories, counts, durations, and aggregate costs.
- If it needs live proof, map live telemetry into the same contract and compare fields without copying raw review content.
