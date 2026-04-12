---
estimated_steps: 4
estimated_files: 8
skills_used:
  - test-driven-development
  - verification-before-completion
---

# T01: Ship contract-approved retrieval hints through review-time retrieval

**Slice:** S02 — Unified Slack, Opt-Out, and Retrieval Semantics
**Milestone:** M045

## Description

Review-time retrieval is still the hidden S02 drift path because `authorClassification.tier` survives even when the contributor-experience contract resolves to a generic state. This task closes that hole end to end. Use the S01 contract seam to project one optional generic `authorHint` for retrieval, assume only `profile-backed` and `coarse-fallback` may emit a hint, and make every generic state (`generic-opt-out`, `generic-unknown`, `generic-degraded`) emit none. Keep the knowledge layer generic enough for `src/handlers/review.ts` and `src/handlers/mention.ts` to share it without importing contributor-contract types into retrieval internals.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| Contract retrieval-hint projection in `src/contributor/experience-contract.ts` | Fail safe to `null` / no retrieval hint and keep the review path running. | N/A — pure in-process projection. | Treat unsupported states as generic and emit no hint. |
| Shared retrieval builders in `src/knowledge/multi-query-retrieval.ts` and `src/knowledge/retrieval-query.ts` | Skip the optional hint instead of preserving raw tier strings. | N/A — pure string construction. | Drop malformed hint text after normalization so query building still succeeds. |
| Review wiring in `src/handlers/review.ts` | Keep retrieval execution fail-open and preserve S01 prompt/details behavior even if hint projection is absent. | Existing retriever timeout behavior remains unchanged; this task must not add retries. | Capture malformed classification as generic/no-hint in tests rather than inventing fallback tiers. |

## Load Profile

- **Shared resources**: review-time embedding/query budget and the existing three-variant retrieval orchestration.
- **Per-operation cost**: still exactly three bounded retrieval queries; only the optional hint token changes.
- **10x breakpoint**: overly verbose hint text would waste embedding/query budget first, so the task must keep the hint normalized, short, and absent for generic states.

## Negative Tests

- **Malformed inputs**: unsupported contract state, empty hint text, and malformed legacy helper inputs normalize to no hint.
- **Error paths**: review retrieval still proceeds when no hint is emitted, and mention retrieval remains unchanged because it never passes the optional field.
- **Boundary conditions**: `profile-backed` and `coarse-fallback` states emit only normalized approved hints, while `generic-opt-out`, `generic-unknown`, and `generic-degraded` emit none.

## Steps

1. Add retrieval-hint projection helpers plus a focused matrix in `src/contributor/experience-contract.test.ts` that proves which contract states may emit an `authorHint` and which must emit `null`.
2. Rename the shared retrieval-builder input from raw tier semantics to an optional generic `authorHint` in `src/knowledge/multi-query-retrieval.ts` and `src/knowledge/retrieval-query.ts`, then align both test files so raw tier labels stop appearing in query expectations.
3. Wire `src/handlers/review.ts` to pass the projected hint instead of `authorClassification.tier`, keeping `src/handlers/mention.ts` untouched because the field stays optional.
4. Extend `src/handlers/review.test.ts` to capture retrieval queries for adapted versus generic states, then rerun the targeted retrieval tests and `bun run verify:m045:s01 -- --json`.

## Must-Haves

- [ ] Retrieval hint policy is owned by the contributor-experience contract seam, not by raw tier strings inside review or knowledge modules.
- [ ] `profile-backed` and `coarse-fallback` states may emit a normalized retrieval hint, while `generic-opt-out`, `generic-unknown`, and `generic-degraded` emit none.
- [ ] Review retrieval keeps its existing fail-open behavior and `src/handlers/mention.ts` remains compatible with the shared query builder.

## Verification

- `bun test ./src/contributor/experience-contract.test.ts ./src/knowledge/multi-query-retrieval.test.ts ./src/knowledge/retrieval-query.test.ts ./src/handlers/review.test.ts`
- `bun run verify:m045:s01 -- --json`

## Observability Impact

- Signals added/changed: captured retrieval queries in review and knowledge tests now show contract-approved `authorHint` usage instead of raw tier labels.
- How a future agent inspects this: run the targeted review + retrieval tests and inspect the recorded query strings for generic versus adapted scenarios.
- Failure state exposed: opt-out/unknown/degraded leaks appear as stray hint fragments in the intent query while adapted-state regressions show missing normalized hints.

## Inputs

- `src/contributor/experience-contract.ts` — existing S01 contract seam that must grow a retrieval projection without reopening prompt/detail behavior.
- `src/contributor/experience-contract.test.ts` — current contract regression harness to extend with retrieval-hint expectations.
- `src/handlers/review.ts` — live review path that still passes `authorClassification.tier` into retrieval query construction.
- `src/handlers/review.test.ts` — end-to-end review-handler regression harness with RET-07 retrieval orchestration coverage.
- `src/knowledge/multi-query-retrieval.ts` — shared three-variant query builder used by review and mention flows.
- `src/knowledge/multi-query-retrieval.test.ts` — regression suite for bounded query construction.
- `src/knowledge/retrieval-query.ts` — legacy single-query helper that must be aligned rather than left as stale pre-S01 behavior.
- `src/knowledge/retrieval-query.test.ts` — expectations that currently codify raw-tier query output.

## Expected Output

- `src/contributor/experience-contract.ts` — new retrieval-hint projection helper(s) that map contract states to optional generic hint strings.
- `src/contributor/experience-contract.test.ts` — matrix coverage proving adapted states emit hints and generic states do not.
- `src/knowledge/multi-query-retrieval.ts` — shared builder updated to accept `authorHint` semantics instead of raw tier semantics.
- `src/knowledge/multi-query-retrieval.test.ts` — query-builder tests aligned to normalized hint output and generic-state omission.
- `src/knowledge/retrieval-query.ts` — legacy helper aligned to the same optional-hint contract.
- `src/knowledge/retrieval-query.test.ts` — stale raw-tier expectations replaced with contract-approved hint assertions.
- `src/handlers/review.ts` — live review retrieval path wired to the projected hint instead of `authorClassification.tier`.
- `src/handlers/review.test.ts` — regression assertions that generic states pass no hint while adapted states pass only the normalized hint.
