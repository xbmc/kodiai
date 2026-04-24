# S02: Representative live large-PR proof

**Goal:** Prove one safe but representative live large-PR run from stable captured identifiers by composing runtime timing evidence, exact visible review-surface proof, and canonical continuation-family operator evidence, then surface that proof verbatim through `verify:m065`.
**Demo:** Operators can run the M065 live-proof path against one safe representative large PR and see a passing/failing machine-readable result anchored on the captured base `reviewOutputKey`, delivery identity, visible review evidence, and canonical continuation-family operator evidence.

## Must-Haves

- `bun test scripts/verify-m065-s02.test.ts` passes and proves the live-proof verifier fails truthfully for invalid identifiers, delivery mismatches, missing Azure runtime evidence, missing/duplicate/wrong-surface GitHub artifacts, missing canonical operator evidence, and unrepresentative live bundles.
- `bun test scripts/verify-m065.test.ts` passes with `M065-LIVE-LARGE-PR-PROOF` no longer hardcoded pending when a valid S02 report is injected, while nested drill-down metadata remains preserved.
- `bun run verify:m065:s02 -- --review-output-key <captured-key> --repo <owner/repo> --json` emits a machine-readable report anchored on the base `reviewOutputKey`, delivery identity, visible review evidence, runtime phase timing evidence, and continuation-family operator evidence.
- `bun run verify:m065 -- --json` preserves the nested S02 report under a stable drill-down key and, when S02 proof is supplied, leaves `M065-FRESH-REGRESSION-PROOF` as the first remaining pending/failed rollout obligation for S03.

## Proof Level

- This slice proves: This slice proves: integration
- Real runtime required: yes
- Human/UAT required: no

## Integration Closure

- Upstream surfaces consumed: `scripts/verify-m065.ts`, `scripts/verify-m048-s01.ts`, `scripts/verify-m049-s02.ts`, `scripts/verify-m064-s03.ts`, `src/review-audit/phase-timing-evidence.ts`, `src/review-audit/review-output-artifacts.ts`, `src/knowledge/continuation-operator-evidence.ts`
- New wiring introduced in this slice: a dedicated `verify:m065:s02` verifier plus top-level `verify:m065` composition of its nested live-proof report.
- What remains before the milestone is truly usable end-to-end: S03 must add fresh non-large regression proof and final operator rerun packaging.

## Verification

- The slice adds one machine-readable live-proof surface and threads its stable identifiers into `verify:m065`, so operators can start from `reviewOutputKey`/delivery identity and localize failures to runtime timing, visible review artifact, or canonical operator evidence without log archaeology.

## Tasks

- [x] **T01: Pin the `verify:m065:s02` contract with failing tests and CLI wiring** `est:75m`
  Create the new live-proof verifier contract before implementation drift sets in. Define the report shape around explicit operator-supplied identifiers (`--review-output-key`, optional `--delivery-id`, optional `--repo`) and pin stable check IDs plus drill-down report keys in a dedicated unit test file. Add package script wiring for `verify:m065:s02`, cover malformed/missing args and mismatch scenarios, and keep the report centered on nested subproof blocks instead of prose summaries. Note in the task plan that the selected live proof target is operator-provided rather than auto-discovered; the verifier validates a captured run, it does not search for one.
  - Files: `scripts/verify-m065-s02.ts`, `scripts/verify-m065-s02.test.ts`, `package.json`
  - Verify: bun test scripts/verify-m065-s02.test.ts

- [x] **T02: Compose representative live-proof evidence across runtime, visible surface, and operator truth** `est:105m`
  Implement the S02 verifier by composing existing proof seams instead of redesigning runtime behavior. The task should normalize identity from the base `reviewOutputKey`, cross-check explicit `deliveryId`/`repo` overrides, reuse Azure phase timing evidence, exact GitHub review artifact proof, and continuation-family operator evidence, then fail explicitly when the bundle is unrepresentative or contradictory. Keep the logic narrow: no PR discovery, no retry-key anchoring, and no hidden success when any subproof is missing. If a small shared helper naturally emerges for representative-bundle evaluation or stable check construction, extract it under `src/review-audit/` only if it reduces duplication.
  - Files: `scripts/verify-m065-s02.ts`, `scripts/verify-m065-s02.test.ts`, `src/review-audit/phase-timing-evidence.ts`, `src/review-audit/review-output-artifacts.ts`, `src/knowledge/continuation-operator-evidence.ts`
  - Verify: bun test scripts/verify-m065-s02.test.ts

- [ ] **T03: Wire the S02 report into `verify:m065` and keep S03 pending** `est:75m`
  Replace the current S02 placeholder in the top-level milestone verifier with the real nested `verify:m065:s02` report while preserving the S01 composition pattern. Update `verify-m065.ts` and its tests so `M065-LIVE-LARGE-PR-PROOF` reflects the injected S02 result instead of a hardcoded pending slot, but leave `M065-FRESH-REGRESSION-PROOF` pending for S03. The task must preserve stable drill-down metadata, keep nested authoritative reports intact, and verify that the top-level command still exits truthfully: valid-but-pending remains allowed when only the fresh regression proof is missing.
  - Files: `scripts/verify-m065.ts`, `scripts/verify-m065.test.ts`, `scripts/verify-m065-s02.ts`, `package.json`
  - Verify: bun test scripts/verify-m065.test.ts && bun test scripts/verify-m065-s02.test.ts

## Files Likely Touched

- scripts/verify-m065-s02.ts
- scripts/verify-m065-s02.test.ts
- package.json
- src/review-audit/phase-timing-evidence.ts
- src/review-audit/review-output-artifacts.ts
- src/knowledge/continuation-operator-evidence.ts
- scripts/verify-m065.ts
- scripts/verify-m065.test.ts
