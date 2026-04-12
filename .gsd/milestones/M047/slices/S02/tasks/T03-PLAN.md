---
estimated_steps: 4
estimated_files: 5
skills_used:
  - test-driven-development
  - verification-before-completion
---

# T03: Ship trust-aware Slack/retrieval proof for S02

**Slice:** S02 — Contract-first Slack, retrieval, and profile continuity rollout
**Milestone:** M047

## Description

Turn the slice into a durable proof surface instead of a one-off set of handler tests. Keep `verify:m045:s03` honest by making its positive Slack/profile fixtures explicitly trusted, then add a new `verify:m047:s02` harness that composes S01’s stored-profile state matrix with Slack/profile continuity, retrieval author hints, and opted-out identity suppression.

## Steps

1. Make `scripts/verify-m045-s03.ts` truth-aware by carrying `trustMarker` through its in-memory contributor-profile fixtures, preserving `includeOptedOut` behavior, and updating its tests so active linked scenarios are genuinely trusted.
2. Implement `scripts/verify-m047-s02.ts` and tests with stable scenarios for calibrated, linked-unscored, legacy, stale, malformed, and opted-out stored profiles across Slack/profile output, link/opt continuity copy, retrieval author hints, and identity-suggestion suppression.
3. Keep expected phrases local to the verifier instead of deriving them from the same helper under test, and reuse `verify:m047:s01` outputs or seams where that reduces drift without importing review logic twice.
4. Add `verify:m047:s02` to `package.json` and rerun `verify:m047:s01`, `verify:m045:s03`, the new verifier, and focused retrieval tests together as the slice-close proof bundle.

## Must-Haves

- [ ] `verify:m045:s03` no longer certifies active linked Slack/profile behavior from fixtures that lack the current trust marker.
- [ ] `verify:m047:s02` reports stable scenario diagnostics for trusted and untrusted stored-profile states across Slack/profile, retrieval, and identity surfaces.
- [ ] The full proof bundle keeps `verify:m047:s01` and retrieval tests green while adding the new slice-level verifier.

## Verification

- `bun test ./scripts/verify-m045-s03.test.ts ./scripts/verify-m047-s02.test.ts ./src/knowledge/retrieval-query.test.ts ./src/knowledge/multi-query-retrieval.test.ts`
- `bun run verify:m047:s01 && bun run verify:m045:s03 && bun run verify:m047:s02 && bun run tsc --noEmit`

## Observability Impact

- Signals added/changed: `verify:m047:s02` becomes the operator inspection surface for Slack/profile continuity, retrieval-hint alignment, and opted-out identity suppression.
- How a future agent inspects this: run `bun run verify:m047:s02 -- --json` and compare its scenario report with `bun run verify:m047:s01 -- --json` and `bun run verify:m045:s03 -- --json`.
- Failure state exposed: named scenario/status-code drift for trusted vs untrusted Slack output, retrieval author hints, or identity-suggestion suppression.

## Inputs

- `scripts/verify-m045-s03.ts` — existing cross-surface verifier whose positive Slack/profile fixtures still need trust-aware stored-profile semantics.
- `scripts/verify-m045-s03.test.ts` — harness tests that should pin trust-aware fixture behavior and report drift.
- `scripts/verify-m047-s01.ts` — upstream stored-profile review truth matrix that S02 should compose rather than reimplement.
- `src/contributor/profile-surface-resolution.ts` — new Slack/profile resolver seam from T01.
- `src/slack/slash-command-handler.ts` — handler surface the verifier must exercise truthfully.
- `src/handlers/identity-suggest.ts` — opted-out suppression behavior the verifier must prove stays aligned.
- `src/knowledge/retrieval-query.ts` — legacy retrieval query builder whose author hints must stay contract-first.
- `src/knowledge/multi-query-retrieval.ts` — multi-query retrieval builder that must stay aligned with the same author-hint semantics.
- `package.json` — canonical script wiring for `verify:m047:s02`.

## Expected Output

- `scripts/verify-m047-s02.ts` — new slice-level proof harness for Slack/profile, retrieval, and identity continuity.
- `scripts/verify-m047-s02.test.ts` — verifier tests that pin JSON/human output and scenario drift.
- `scripts/verify-m045-s03.ts` — trust-aware cross-surface fixture plumbing for existing M045 proof.
- `scripts/verify-m045-s03.test.ts` — updated M045 proof tests that fail when trusted fixtures lose their trust marker semantics.
- `package.json` — `verify:m047:s02` script entry.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `scripts/verify-m047-s01.ts` / stored-profile scenario seams | Fail the S02 proof harness with named prerequisite or scenario status codes instead of printing a misleading green cross-surface verdict. | Use the existing bounded local verifier behavior; do not add long-running polling. | Treat missing trust or contract fields as proof drift and fail the scenario explicitly. |
| `scripts/verify-m045-s03.ts` in-memory contributor-profile fixtures | Keep trusted positive fixtures explicit and fail tests if the harness silently drops `trustMarker` or `includeOptedOut` semantics. | N/A — local deterministic harness only. | Reject fixture shapes that cannot represent trusted vs untrusted stored profiles rather than defaulting them to active linked guidance. |
| `package.json` script wiring | Keep one canonical `verify:m047:s02` entrypoint for downstream slices and milestone composition. | N/A — local config only. | Treat missing or mismatched script wiring as a failing verifier test, not a manual follow-up. |

## Load Profile

- **Shared resources**: local proof scripts, deterministic scenario fixtures, retrieval builders, and one package-script entry.
- **Per-operation cost**: one scenario matrix evaluation across Slack/profile, retrieval, and identity surfaces plus the existing S01 verifier.
- **10x breakpoint**: report readability and scenario drift become the limiting factors before compute does, so scenario count and status-code shape must stay bounded and stable.

## Negative Tests

- **Malformed inputs**: trusted fixtures missing `trustMarker`, malformed stored tiers, omitted scenario metadata, and retrieval fixtures with blank or contributor-leaking author hints.
- **Error paths**: upstream S01 verifier failure, human/JSON report drift, missing package script wiring, or helper reuse that regenerates expectations from the same code under test.
- **Boundary conditions**: calibrated trusted profile, linked-unscored row, legacy row, stale row, malformed row, opted-out row, and coarse/generic retrieval-hint outcomes.
