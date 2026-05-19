# Issue #131 Deferred Handoff Contract

M071 is a foundation-only milestone for issue #131. It proves ReviewPlan construction, safe Review Details projection, graph-validation config truthfulness, and a fail-closed package verifier. It does **not** implement the larger candidate publication, reducer, specialist lane, repo-doctrine, or rollout-metrics work. M074/S07 now owns and verifies the repo-doctrine portion of the deferred handoff with source-backed `.kodiai.yml` doctrine contracts and aggregate-only review evidence.

The durable source contract lives in `src/issue-131/deferred-handoff.ts`. Future verifier wiring should consume that module, not this narrative document, when exposing machine-readable ownership state.

## Source-owned rows

| Row id | Requirements | Owner | Consumer/owner label | Promotion proof |
|---|---|---|---|---|
| `candidate-finding-mcp-publication-bridge` | R130 | M072/S01 | M072/S01 candidate-publication bridge owner | Source-owned candidate capture before public GitHub publication, reducer handoff input shape, and package verifier row proving the bridge without raw candidate payloads. |
| `reducer-extraction` | R130, R132 | M073/S01 | M073/S01 reducer extraction owner | Typed reducer contract, fixture-backed reduction behavior, and verifier evidence that publication consumes reducer-approved findings rather than direct model output. |
| `specialist-lane-proof` | R131 | M074/S01 | M074/S01 specialist config contract owner | Bounded specialist shadow evidence and source tests proving specialist-lane inputs stay private until promoted. |
| `metrics-tier-closure` | R133 | M075/S01 | M075/S01 metrics and rollout closure owner | Verifier and runtime telemetry showing rollout gates, cost/noise controls, and tier closure evidence before final issue #131 promotion. |
| `repo-doctrine-contract-ownership` | R104 | M074/S07 | M074/S07 repo-doctrine contract implementation owner | `.kodiai.yml` `review.doctrine` schema, source parser integration, ReviewPlan/prompt/reducer/Review Details consumption, and `verify:m074:s07` proof for API, migration, performance, tracing, feature-flag, forbidden-pattern, and docs-update invariants. |

## R104 ownership correction

R104 is not M071-owned and should not be treated as implemented by M071. M071 supplies foundation seams that later repo-doctrine work can consume. M074/S07 is the source-backed downstream owner for repo doctrine contracts: it implements bounded `.kodiai.yml` `review.doctrine` parsing, routes aggregate-only doctrine projections through the review path, and proves the executable coverage with `bun run verify:m074:s07` plus source tests.

## Safety boundaries

- This document is handoff narrative only; it is not verifier evidence.
- Verifiers should depend on checked-in source contracts and source tests, not planning artifacts.
- Handoff rows must not expose raw prompts, raw model output, raw comments, raw diffs, or equivalent review artifacts.
