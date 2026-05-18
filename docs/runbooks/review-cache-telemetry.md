# Review cache telemetry runbook

This runbook explains the M073/S03 review cache telemetry inspection surface for prompt-derived review cache reuse and retrieval query embedding reuse. S03 proves observable safe reuse boundaries; it does **not** claim live token reduction, latency reduction, or cost savings.

## Quick commands

Run the offline S03 fixture verifier from the repository root:

```sh
bun scripts/verify-m073-s03.ts --fixture scripts/fixtures/m073-s03-cache-telemetry.json --json
```

Inspect live bounded telemetry through the usage report:

```sh
bun scripts/usage-report.ts --repo owner/repo --since 7d
bun scripts/usage-report.ts --repo owner/repo --delivery delivery-id --since 7d --json
```

The verifier is fixture-only and does not require GitHub, a model, retrieval services, or Postgres. The usage report reads live Postgres when `DATABASE_URL` or `TEST_DATABASE_URL` is configured, and fails open with an explicit access state if telemetry is unavailable.

## What S03 proves

S03 proves that review cache decisions are observable as bounded metadata and that unsafe cache entries are not treated as reusable hits. The compatible surfaces are:

- `review-derived-prompt` — reuse decision for generated review prompt material.
- `retrieval-query-embedding` — reuse decision for retrieval query embeddings.

The compatible statuses are:

- `hit` — a cache entry was reused after bounded safety signals were present.
- `miss` — no compatible reusable entry was found, or a stale entry was invalidated.
- `degraded` — the cache path could not safely prove reuse because a bounded safety signal or bookkeeping path failed.
- `bypass` — the cache path was intentionally skipped, for example because cache use was disabled or retrieval was unavailable.

The compatible reasons are:

- `safe-reuse`
- `cache-miss`
- `bookkeeping-failure`
- `incomplete-fingerprint`
- `expired-stale-entry`
- `disabled-cache`
- `unavailable-retrieval`

Unknown surface/status/reason values should not be published as successful cache telemetry. Fixture verification fails closed; usage-report aggregation filters to bounded vocabulary.

## Telemetry field semantics

Runtime rows in `review_cache_events` and fixture rows in `cacheTelemetryObservations[]` use these bounded fields:

| Field | Meaning | Redaction note |
|---|---|---|
| `deliveryId` | Correlates a review attempt or delivery. | Bounded identifier only; do not add prompt or review content. |
| `repo` | Repository slug for filtering and aggregation. | Use normal repo slug; no secrets. |
| `prNumber` | Pull request number when known. | Numeric only. |
| `cacheSurface` | One of the two approved cache surfaces. | Unknown values fail verifier vocabulary checks. |
| `status` | One of `hit`, `miss`, `degraded`, or `bypass`. | `hit` requires safety metadata. |
| `reason` | Bounded reason for the status. | Required for `degraded` and `bypass`; constrained for `hit` and `miss`. |
| `fingerprintVersion` | Version label for the fingerprint algorithm or safety contract. | Version label only; never a raw fingerprint or cache key. |
| `safetySignalNames` | Names of bounded signals used to prove safe reuse. | Names only, such as `base-ref`, `head-ref`, or `prompt-schema`. |
| `missingSignalNames` | Names of required bounded signals that were unavailable. | Names only; do not include signal values. |
| `invalidationSignalNames` | Names of bounded signals that invalidated stale reuse. | Names only; do not include raw SHAs, cache keys, diffs, or chunks. |
| `bookkeepingErrorCount` | Count of non-blocking cache bookkeeping write/read errors. | Count only; detailed error payloads stay in private logs. |

## Usage-report inspection surface

`scripts/usage-report.ts` now includes a `Review cache telemetry` section next to prompt-section, reuse-evidence, and rate-limit summaries. It aggregates `review_cache_events` by `cacheSurface`, `status`, and `reason`, with bounded counts and signal-name lists:

- `executions`
- `deliveries`
- `prs`
- `bookkeeping_errors`
- `fingerprint_versions`
- `safety_signals`
- `missing_signals`
- `invalidation_signals`

The report supports repo, time, and delivery filters. If the `review_cache_events` table is missing, the cache section emits a bounded note and the overall usage report remains available. If no rows match, it emits an explicit empty-state message.

## Redaction boundary

Do not add any of these to fixtures, usage reports, runbooks, summaries, or public Review Details:

- raw prompts or prompt sections
- diffs, patches, or file contents
- review comments or comment bodies
- candidate payloads or model output
- raw retrieval chunks
- raw fingerprints, hashes, cache keys, embeddings, vectors, or tokens
- secrets or credential-like values

Allowed evidence is limited to bounded identifiers, repo/PR correlation, approved cache surface/status/reason vocabulary, version labels, signal **names**, counts, and deterministic aggregate totals.

## Triage

Start from `failedCheckIds` in verifier JSON or the `Review cache telemetry` usage-report section.

### Hit rows

A valid `hit` means the cache path reused an entry and included a `fingerprintVersion` plus one or more `safetySignalNames`. If a hit fails verification:

1. Confirm `reason` is absent or `safe-reuse`.
2. Confirm `fingerprintVersion` is a short version label, not a hash.
3. Confirm `safetySignalNames` contains bounded names and not raw values.
4. Do not backfill missing safety proof by copying raw fingerprints or cache keys.

### Miss rows

A `miss` should use `cache-miss` or `expired-stale-entry` when a reason is present. For stale entries:

1. Confirm `invalidationSignalNames` is present for `expired-stale-entry`.
2. Use names such as `cache-ttl`, `index-version`, or `prompt-schema`; do not include raw SHAs or cache keys.
3. Treat misses as safe non-reuse, not as token reduction evidence.

### Degraded rows

A `degraded` row means the cache path could not safely prove reuse. Common reasons are `bookkeeping-failure` and `incomplete-fingerprint`.

1. For `bookkeeping-failure`, confirm `bookkeepingErrorCount` is positive and inspect private structured logs for the write/read warning.
2. For `incomplete-fingerprint`, confirm `missingSignalNames` identifies the missing bounded signal names.
3. Do not convert degraded rows to hits unless the safety signals are actually available.

### Bypass rows

A `bypass` row means cache reuse was intentionally skipped. Common reasons are `disabled-cache` and `unavailable-retrieval`.

1. Confirm the reason is bounded and present.
2. Check runtime configuration or retrieval availability.
3. Bypass is safe non-reuse; it is not a failure unless the expected cache path should have been enabled.

## S04 handoff

S04 should consume only the safe projection from S03:

- aggregate status and reason counts by surface
- bounded `missingSignalNames` and `invalidationSignalNames`
- `bookkeepingErrorCount`
- stable verifier check IDs and pass/fail state

S04 must not request raw prompts, diffs, retrieval chunks, raw fingerprints, cache keys, candidate payloads, or model output to explain cache behavior. If S04 needs user-visible disclosure, publish only bounded counts, reason labels, signal names, and verifier status.
