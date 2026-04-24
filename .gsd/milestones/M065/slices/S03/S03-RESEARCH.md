# S03 Research — Fresh regression guard and operator rerun packaging

## Summary

S03 is a **targeted research** slice, not a new runtime-design slice. The repo already has the hard seams:

- `scripts/verify-m065.ts` is the top-level milestone verifier and already reserves `M065-FRESH-REGRESSION-PROOF` plus `rollout_obligations.freshRegressionProof` as an explicit pending slot.
- `scripts/phase-m061-token-regression-gate.ts` is the existing fresh non-large regression gate with stable `M061-REG-*` checks and is currently green in this workspace.
- `docs/runbooks/review-requested-debug.md` and `docs/runbooks/recent-review-audit.md` already establish the operator flow style: collect stable identities first, use `reviewOutputKey` / delivery correlation, then rerun machine-readable verifiers.
- `scripts/verify-m055-s03.ts` is the strongest in-repo pattern for making docs/runbook packaging machine-checkable instead of prose-only.

The missing work is packaging these into an M065/S03-shaped surface:

1. a dedicated fresh-regression verifier/report wrapper for M065,
2. top-level `verify:m065` composition of that wrapper,
3. one operator runbook that tells the rerun/drill-down story without inventing new truth sources.

## Requirement focus

### Active requirement this slice supports

- **R070** remains the only active requirement directly mapped to M065, but S03 does not introduce new live-proof truth. It closes rollout packaging around the already-delivered S02 live-proof surface.

### Freshness obligation this slice should enforce

S03 should treat **fresh non-large regression proof** as a rollout-closeout obligation even though `.gsd/REQUIREMENTS.md` still records `R069` as historically validated from M061/S05. The roadmap and D192 already make the intended contract clear: M065 must not close on stale R069 evidence alone.

### Out of scope

- no new lifecycle state source
- no redesign of `reviewOutputKey` or delivery identity semantics
- no runtime changes in `src/handlers/review.ts`
- no replacement of the existing M061 regression gate

## Skill discovery

Directly relevant installed skills already exist:

- `azure-container-apps` — useful only if the executor needs Azure-side evidence interpretation while validating a live rerun path.
- `github-bot` / `gh` — useful only if the executor needs GitHub API help while validating operator instructions.

No additional skill discovery looks necessary. This slice is mainly verifier composition + runbook packaging around already-known repo patterns.

## Implementation landscape

### `scripts/verify-m065.ts`

Current role:

- composes `verify:m062:s03`, `verify:m063:s03`, `verify:m064:s03`, and `verify:m065:s02`
- preserves nested reports under `nested_reports.{m062,m063,m064,s02}`
- reserves `M065-FRESH-REGRESSION-PROOF` via `buildFreshRegressionCheck()` as a skipped/pending placeholder
- sets `rollout_obligations.freshRegressionProof` to `{ state: "pending", source: null, detail: "Reserved for fresh non-large regression proof from S03." }`

Current constraint:

- there is **no** S03 nested report contract yet, so top-level M065 cannot distinguish fresh regression pass/fail/malformed from the current placeholder state.
- current CLI only accepts `--json` / `--help`; there is no top-level pass-through for `--review-output-key`, `--delivery-id`, or `--repo`.

Important test coverage:

- `scripts/verify-m065.test.ts` already pins the pending placeholder behavior and the failure-order semantics. S03 will need to extend, not replace, these tests.

### `scripts/phase-m061-token-regression-gate.ts`

Current role:

- owns the pinned non-large regression suites with stable `M061-REG-*` IDs
- exports `evaluateRegressionGateChecks(...)` and `renderRegressionGateReport(...)`
- runs mention/review/retrieval/reporting/verifier test suites via `spawnSync`
- returns a simple `RegressionGateReport` shape: `{ overallPassed, checks[] }`

Current constraint:

- this gate is machine-usable in-process, but its CLI is **not** shaped like other milestone verifiers:
  - no `generated_at`
  - no `status_code`
  - no `issues`
  - no `--json`
  - no nested-report contract that `verify:m065.ts` can preserve directly

Research conclusion:

- **Do not teach `verify:m065.ts` to parse the textual M061 gate output.**
- The natural seam is a new **M065 S03 wrapper verifier** that imports `evaluateRegressionGateChecks(...)` and re-expresses the result in the normal milestone verifier contract.

### Runbook surfaces

#### `docs/runbooks/review-requested-debug.md`

Key constraints this slice must preserve:

- the only supported manual rerun is **explicit PR-scoped `@kodiai review`**
- reviewer-team requests are debug-only signals, not the supported manual rerun path
- operator correlation should start from `deliveryId`, then pivot to `reviewOutputKey`
- the runbook already names the exact evidence bundle line containing `reviewOutputKey`
- the runbook already teaches drill-down into Azure logs, queue lanes, publish resolution, and canonical operator evidence

#### `docs/runbooks/recent-review-audit.md`

Useful packaging pattern:

- one top-level verifier command
- prerequisites section
- “report fields to inspect first”
- verdict meanings
- one flagged-artifact drill-down flow starting from `reviewOutputKey`

### `scripts/verify-m055-s03.ts`

This is the best precedent if S03 wants machine-checkable packaging for docs/runbooks.

Why it matters:

- it verifies runbook presence and command references instead of treating docs as hand-wavy prose
- it resolves command references against `package.json` / file existence
- it emits stable check IDs and a normal verifier report

Important caveat:

- `verify-m055-s03.ts` assumes `docs/INDEX.md` exists, but this repo currently **does not** have `docs/INDEX.md` (`read docs/INDEX.md` returned ENOENT).
- So S03 should reuse the **runbook-command-reference** idea, not blindly copy the docs-index inventory check.

## What exists today vs what is missing

### Already working now

- `bun run verify:m061:regression` currently passes in this workspace.
- `bun run verify:m065 -- --json` currently fails on `M065-LIVE-LARGE-PR-PROOF` because the seeded S02 representative proof does not have live Azure/GitHub/canonical evidence in this unattended environment.
- In that same output, `M065-FRESH-REGRESSION-PROOF` is still an explicit skipped/pending placeholder.

### Missing for S03

1. **Dedicated S03 verifier surface**
   - likely `scripts/verify-m065-s03.ts`
   - should wrap M061 regression results in a milestone-style contract
   - should be wired as `verify:m065:s03`

2. **Top-level M065 composition of S03**
   - `verify-m065.ts` needs a real nested S03 contract and a real `freshRegressionProof` satisfied/failed state
   - current `buildFreshRegressionCheck()` placeholder must become a contract-preserving wrapper over the S03 report

3. **Operator rerun/runbook packaging**
   - likely a new runbook under `docs/runbooks/` dedicated to M065 rollout proof
   - should explain the supported rerun trigger, identity collection, top-level command, and nested drill-down path

4. **Possibly a docs/runbook verifier**
   - optional but strongly aligned with repo norms if the slice wants packaging to be machine-checkable instead of “docs were written”
   - likely simpler than `verify-m055-s03.ts`: verify required runbook presence + command references + package wiring, without a docs inventory check

## Recommended shape

### 1. Add a dedicated `verify:m065:s03` wrapper

Recommended behavior:

- import and call `evaluateRegressionGateChecks()` from `scripts/phase-m061-token-regression-gate.ts`
- expose stable M065-S03 check IDs, probably one wrapper check per pinned M061 suite, or one top-level freshness check plus nested raw gate results
- emit a standard verifier payload with fields like:
  - `command: "verify:m065:s03"`
  - `generated_at`
  - `success`
  - `status_code`
  - `check_ids`
  - `checks`
  - `nested_reports.regressionGate` or equivalent raw embedded gate result
  - `failing_check_id`
  - `issues`

Why this is the right seam:

- keeps M061 semantics authoritative
- avoids changing the older regression gate contract just to satisfy M065 composition
- gives `verify:m065.ts` something it can validate structurally, like it already does for S02

### 2. Extend `verify:m065.ts` to compose S03, not just reserve it

Recommended changes:

- import `evaluateM065S03`
- extend `nested_reports` with `s03`
- replace placeholder-only `buildFreshRegressionCheck()` with contract-aware logic similar to `buildLiveProofCheck(...)`
- update `buildRolloutObligations(...)` so `freshRegressionProof` becomes:
  - `state: "satisfied"`, `source: "nested_reports.s03"` when S03 passes
  - `state: "pending"` only before S03 exists or in explicitly pending contexts
- keep existing failure-order semantics: malformed nested report first, then failed nested verifier, then pending only

Important boundary:

- do **not** inline M061 suite logic directly into `verify-m065.ts`
- preserve the S03 nested report verbatim the same way S02 is preserved

### 3. Add one operator runbook for M065 closeout

Likely file:

- `docs/runbooks/m065-rollout-proof.md` (name not prescribed, but use an M065-specific runbook rather than overloading the older debug docs)

The runbook should explicitly cover:

1. **Supported rerun trigger**
   - explicit PR-scoped `@kodiai review`
   - reviewer-team requests are not the supported manual rerun path

2. **Identity capture order**
   - start from `deliveryId`
   - find `reviewOutputKey` from the `Evidence bundle` log or GitHub/Azure surfaces already documented in `review-requested-debug.md`
   - keep repo + delivery + base `reviewOutputKey` together as the proof bundle

3. **Verifier order**
   - `bun run verify:m065 -- --json` for milestone-level status
   - `bun run verify:m065:s02 -- --review-output-key <key> --delivery-id <id> --repo <owner/repo> --json` for live-proof drill-down
   - `bun run verify:m061:regression` or `bun run verify:m065:s03 -- --json` for fresh regression proof, depending on the final wrapper design

4. **Nested drill-down mapping**
   - if S02 fails, pivot to:
     - `bun run verify:m048:s01 -- --review-output-key <key> --json`
     - `bun run verify:m049:s02 -- --review-output-key <key> --repo <owner/repo> --json`
     - `bun run verify:m064:s03 -- --review-output-key <key> --json`
   - if regression fails, inspect the failing `M061-REG-*` suite from the wrapper report

5. **No-log-archaeology rule**
   - the runbook should make the stable identifier chain explicit so operators do not infer outcome from ad-hoc logs alone

### 4. Decide whether top-level `verify:m065` should accept passthrough live-proof args

This is the main remaining design ambiguity.

Low-risk option (recommended):

- keep `verify:m065` CLI stable
- let the runbook tell operators to run `verify:m065` for milestone status, then rerun `verify:m065:s02` with the captured identifiers

Higher-change option:

- add optional `--review-output-key`, `--delivery-id`, and `--repo` passthrough args to `verify:m065`
- pass them into S02 when provided

Recommendation:

- **Prefer the low-risk option unless the planner finds an explicit requirement that top-level `verify:m065` itself must be parameterized.**
- The roadmap language can be satisfied by a runbook-driven two-step operator flow without broadening the CLI contract.

## Natural task seams

### Task seam 1 — Fresh regression verifier wrapper

Files:

- `scripts/verify-m065-s03.ts` (new)
- `scripts/verify-m065-s03.test.ts` (new)
- `package.json`

Owns:

- wrapping `phase-m061-token-regression-gate` into M065/S03 contract
- stable M065-S03 check IDs/status codes
- package script wiring

Should be built first because:

- it converts the existing pending placeholder into a composable machine-checkable proof source
- it is independent of docs wording

### Task seam 2 — Top-level M065 composition update

Files:

- `scripts/verify-m065.ts`
- `scripts/verify-m065.test.ts`

Owns:

- importing S03 report
- adding `nested_reports.s03`
- turning `freshRegressionProof` from placeholder to authoritative nested proof state
- preserving failure ordering and drill-down metadata

Depends on Task seam 1.

### Task seam 3 — Operator runbook packaging

Files:

- likely new `docs/runbooks/m065-rollout-proof.md`
- possibly a new verifier for runbook packaging if the planner wants that contract machine-checkable
- possibly `package.json` if that docs verifier gets its own script

Owns:

- operator flow and rerun instructions
- supported trigger wording
- identity-capture order and nested drill-down map

Can proceed in parallel with seam 2 once the S03 command names are known.

## Risks / traps

### 1. Parsing textual regression output in `verify:m065.ts`

Bad idea. It would couple M065 to human-rendered output and bypass the repo’s normal nested verifier contract.

### 2. Treating docs as sufficient proof by themselves

The milestone explicitly wants machine-checkable evidence. Docs should package the operator path, not replace the verifier surface.

### 3. Accidentally implying reviewer-team requests are a supported manual rerun path

`docs/runbooks/review-requested-debug.md` is explicit that they are not. S03 should preserve that wording.

### 4. Copying the M055 docs verifier too literally

`docs/INDEX.md` does not exist here. Reuse the runbook-command-resolution pattern, not the index-inventory assumption.

### 5. Making fresh regression proof depend on live Azure/GitHub availability

Fresh non-large regression proof should stay separate from the live large-PR proof. Reuse the deterministic M061 suite gate and keep it independent.

## Verification plan

### For the S03 wrapper itself

- `bun test scripts/verify-m065-s03.test.ts`
- `bun run verify:m065:s03 -- --json`

The test file should pin:

- stable M065-S03 check IDs
- pass case when all M061 suites pass
- fail case when one pinned suite fails
- malformed/exception handling if the underlying runner throws
- package script wiring

### For top-level composition

- `bun test scripts/verify-m065.test.ts`
- `bun run verify:m065 -- --json`

Expected end state after S03 lands:

- `nested_reports.s03` exists and preserves the authoritative S03 payload
- `M065-FRESH-REGRESSION-PROOF` is no longer skipped/pending when S03 succeeds
- `rollout_obligations.freshRegressionProof.state` becomes `satisfied`
- top-level failure still localizes to S02 or S03 mechanically via stable check IDs and drill-down commands

### For fresh regression evidence itself

- `bun run verify:m061:regression`

This should remain the direct smoke proof that the underlying non-large regression suites still pass.

### For runbook packaging

At minimum:

- verify the new runbook path exists
- verify every referenced `bun run ...` command or script path actually resolves
- if a dedicated docs verifier is added, run it as part of slice verification

## Planner takeaway

This slice should be planned as **one new wrapper verifier + one top-level composition change + one runbook packaging task**.

The safest implementation path is:

1. create `verify:m065:s03` as a wrapper around `phase-m061-token-regression-gate`
2. compose that wrapper into `verify:m065`
3. write the M065 runbook around the already-established `deliveryId -> reviewOutputKey -> nested verifier` operator flow
4. optionally add a small docs verifier if the team wants the runbook packaging itself to be machine-checkable

Do **not** reopen review runtime behavior, canonical truth sources, or the S02 identity model.
