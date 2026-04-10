# S01: Sample Selection and Recent Review Audit

**Goal:** Ship the first live recent-review audit surface: parse and normalize `reviewOutputKey`, collect a deterministic lane-aware recent sample from GitHub-visible Kodiai output, correlate each sampled PR to currently available internal publication evidence, and emit truthful provisional verdicts over the real recent `xbmc/xbmc` stream.
**Demo:** Run a real recent-review audit against `xbmc/xbmc` and get a deterministic lane-aware sample plus per-PR provisional verdicts backed by GitHub-visible markers and currently available internal evidence, so operators can stop guessing from approval-only output.

## Must-Haves

- Shared audit identity helpers parse and normalize `reviewOutputKey` markers, including retry-suffixed keys, into structured repo/PR/action/delivery/head identity.
- A GitHub collector reuses the authoritative Kodiai output surfaces (`reviews`, issue comments, review comments), extracts the latest marker-backed artifact per PR, and applies the planned lane-stratified recent-sample rule deterministically.
- An evidence correlator emits structured source-availability data plus truthful provisional verdicts without collapsing missing explicit-lane proof into false success or failure.
- `bun run verify:m044:s01 -- --repo xbmc/xbmc --limit 12 --json` executes against real recent GitHub history and returns sample metadata plus per-PR evidence/provisional verdicts.

## Proof Level

- This slice proves: Operational proof over real `xbmc/xbmc` GitHub history, plus deterministic unit coverage for key parsing, sample selection, and provisional classification behavior. Real GitHub access is required; DB/log access must be reported truthfully when unavailable.

## Integration Closure

This slice closes the GitHub-marker-to-audit-evidence seam and leaves one explicit downstream gap list for S02/S03: any real publication defect exposed by the audit, and any missing explicit-lane durability needed for final non-indeterminate classification.

## Verification

- Adds a stable S01 audit evidence envelope with parsed `reviewOutputKey` identity, lane metadata, per-source availability, and explicit provisional verdict reasons so later slices can distinguish evidence absence from publication failure.

## Tasks

- [x] **T01: Add shared reviewOutputKey parser and retry normalization** `est:45m`
  Extend the shipped marker/idempotency seam with additive parsing helpers that turn a GitHub-visible review-output key or marker into structured identity. Keep the existing builder and marker behavior intact. Cover base keys, retry-suffixed keys, malformed keys, and normalization rules so later audit code does not duplicate versioned regex logic or mis-correlate retries.
  - Files: `src/handlers/review-idempotency.ts`, `src/handlers/review-idempotency.test.ts`
  - Verify: bun test ./src/handlers/review-idempotency.test.ts

- [x] **T02: Build the GitHub-visible recent review collector and lane-stratified selector** `est:1h15m`
  Create focused review-audit modules that use the existing GitHub App bootstrap to scan the authoritative Kodiai output surfaces on recent `xbmc/xbmc` PRs. Extract marker-backed artifacts, keep the latest Kodiai artifact per PR, classify lane from parsed key action, and apply the up-to-six-per-lane fill rule deterministically. Record which GitHub surface produced the artifact and the URLs/operators needed for drill-down.
  - Files: `src/review-audit/recent-review-sample.ts`, `src/review-audit/recent-review-sample.test.ts`
  - Verify: bun test ./src/review-audit/recent-review-sample.test.ts

- [x] **T03: Correlate sampled PRs to current internal publication evidence and provisional verdicts** `est:1h30m`
  Add lane-aware evidence correlation helpers that combine the sampled GitHub artifact with currently available internal proof. For the automatic lane, inspect durable DB-backed review/finding/checkpoint/telemetry evidence as needed. For the explicit lane, preserve source availability explicitly and return `indeterminate` when log-backed publish truth is missing instead of guessing. Cover clean-valid, findings-published, suspicious, publish-failure-shaped, and indeterminate classifications at the helper level.
  - Files: `src/review-audit/evidence-correlation.ts`, `src/review-audit/evidence-correlation.test.ts`
  - Verify: bun test ./src/review-audit/evidence-correlation.test.ts

- [x] **T04: Ship the S01 verifier command and run the first live recent-review audit** `est:1h15m`
  Package the collector and correlator behind a deterministic S01 verifier script following the repo's existing `verify:*` conventions. Add CLI parsing, human-readable plus JSON output, stable per-PR evidence records, and truthful preflight reporting for missing GitHub/DB/log access. Wire a `verify:m044:s01` package script and exercise it against the recent `xbmc/xbmc` sample so the slice closes on a real audit report rather than unit tests alone.
  - Files: `scripts/verify-m044-s01.ts`, `scripts/verify-m044-s01.test.ts`, `package.json`
  - Verify: bun test ./scripts/verify-m044-s01.test.ts && bun run verify:m044:s01 -- --repo xbmc/xbmc --limit 12 --json

## Files Likely Touched

- src/handlers/review-idempotency.ts
- src/handlers/review-idempotency.test.ts
- src/review-audit/recent-review-sample.ts
- src/review-audit/recent-review-sample.test.ts
- src/review-audit/evidence-correlation.ts
- src/review-audit/evidence-correlation.test.ts
- scripts/verify-m044-s01.ts
- scripts/verify-m044-s01.test.ts
- package.json
