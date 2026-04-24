---
estimated_steps: 5
estimated_files: 5
skills_used:
  - test-driven-development
  - systematic-debugging
  - verify-before-complete
---

# T02: Compose representative live-proof evidence across runtime, visible surface, and operator truth

**Slice:** S02 — Representative live large-PR proof
**Milestone:** M065

## Description

Implement the S02 verifier by composing existing proof seams instead of changing runtime review behavior. The evaluator must start from the base `reviewOutputKey`, cross-check explicit `--delivery-id` and `--repo` overrides, reuse phase timing evidence from Azure, exact visible review proof from GitHub, and canonical continuation-family operator evidence, then fail explicitly when the bundle is contradictory or not representative enough to count as the milestone’s minimum credible live proof.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| Azure phase timing lookup via `scripts/verify-m048-s01.ts` / `src/review-audit/phase-timing-evidence.ts` | Return a failing S02 subcheck with truthful Azure-unavailable or no-matching-runtime-evidence status | Return a failing runtime-evidence subcheck; do not infer success from GitHub/operator evidence alone | Return a failing runtime-evidence contract status and preserve the malformed payload issue list |
| GitHub visible artifact proof via `scripts/verify-m049-s02.ts` / `src/review-audit/review-output-artifacts.ts` | Return a failing visible-surface subcheck and preserve duplicate/missing/wrong-surface detail | Treat collection timeout as GitHub-unavailable and fail the live proof | Surface metadata/body drift without flattening it into a generic failure |
| Canonical operator evidence via `scripts/verify-m064-s03.ts` / `src/knowledge/continuation-operator-evidence.ts` | Return a failing operator-evidence subcheck | Not expected for the deterministic lookup path; if surfaced, fail the lookup subcheck | Fail when the canonical lookup returns invalid/missing/contradictory family state |

## Load Profile

- **Shared resources**: GitHub API quota, Azure Log Analytics queries, and continuation-family knowledge-store lookups.
- **Per-operation cost**: one Azure proof evaluation, one GitHub artifact collection/proof evaluation, and one canonical operator-evidence lookup per verifier run.
- **10x breakpoint**: GitHub/Azure access latency and rate limits; the verifier should remain single-target and operator-driven rather than broad discovery.

## Negative Tests

- **Malformed inputs**: malformed `reviewOutputKey`, explicit `deliveryId` mismatch, explicit `repo` mismatch, and retry-key input that must normalize back to the base key.
- **Error paths**: Azure unavailable, Azure no-match, duplicate GitHub artifacts, wrong artifact surface, wrong review state, body drift, missing canonical row, invalid canonical lookup, and contradictory identity correlation across subproofs.
- **Boundary conditions**: operator evidence resolves `pending`, `canonical`, `degraded`, or `superseded`; S02 should only count representative live proof when the chosen acceptable states and required identity agreement are satisfied.

## Steps

1. Extend `scripts/verify-m065-s02.test.ts` with injected/mocked subproof coverage for all required failing and passing bundle combinations.
2. Implement argument validation and identity normalization in `scripts/verify-m065-s02.ts`, deriving base review identity from `parseReviewOutputKey(...)` and treating explicit overrides only as cross-checks.
3. Compose the runtime, visible-surface, and operator-evidence seams into one report with stable subcheck ids, normalized identity fields, and nested subproof payloads.
4. Add representative-bundle evaluation that blocks success when any required subproof is missing, contradictory, or not sufficient to show the intended large-PR lifecycle path.
5. Make the test suite pass without introducing PR discovery, retry-key anchoring, or hidden fallbacks that bypass missing live evidence.

## Must-Haves

- [ ] `scripts/verify-m065-s02.ts` returns a machine-readable report with normalized/base identity, nested subproof blocks, stable subcheck ids, and truthful failing issues.
- [ ] The happy path proves one captured live run only when runtime timing evidence, exact visible review proof, and canonical operator evidence agree on the same identity.
- [ ] The negative tests prove S02 cannot go green from partial, contradictory, or unrepresentative evidence.

## Verification

- `bun test scripts/verify-m065-s02.test.ts`
- `bun test scripts/verify-m065-s02.test.ts --filter "representative live bundle"`

## Observability Impact

- Signals added/changed: per-subproof status codes, failing subcheck id, normalized/base `reviewOutputKey`, delivery identity, and nested issues for runtime/GitHub/operator evidence.
- How a future agent inspects this: `bun run verify:m065:s02 -- --review-output-key <captured-key> --repo <owner/repo> --json`.
- Failure state exposed: whether the live proof failed at identity correlation, runtime evidence, visible review proof, operator evidence, or representative-bundle sufficiency.

## Inputs

- `scripts/verify-m065-s02.ts` — contract scaffold from T01.
- `scripts/verify-m065-s02.test.ts` — failing contract tests to extend with composition coverage.
- `scripts/verify-m048-s01.ts` — Azure runtime evidence verifier patterns and report fields.
- `scripts/verify-m049-s02.ts` — exact visible review artifact proof patterns and failure statuses.
- `scripts/verify-m064-s03.ts` — canonical continuation-family operator evidence patterns.
- `src/review-audit/phase-timing-evidence.ts` — runtime phase timing normalization helpers.
- `src/review-audit/review-output-artifacts.ts` — exact review artifact collection/proof helpers.
- `src/knowledge/continuation-operator-evidence.ts` — canonical operator-evidence lookup/report helpers.

## Expected Output

- `scripts/verify-m065-s02.ts` — implemented S02 live-proof verifier.
- `scripts/verify-m065-s02.test.ts` — passing composition and negative-path coverage.
