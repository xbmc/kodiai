# S02 Research — Representative live large-PR proof

## Summary

S02 owns the only new proof obligation in M065 that cannot be satisfied by inherited deterministic verifiers: a **machine-checkable live evidence bundle** for one safe but representative large-PR run. The slice should extend `scripts/verify-m065.ts` by replacing the current pending `liveLargePrProof` placeholder with a real verifier result, not by changing runtime behavior in `src/handlers/review.ts`.

The repo already has nearly all required proof primitives:

- `scripts/verify-m065.ts` composes M062/M063/M064 and reserves `rollout_obligations.liveLargePrProof` plus top-level check `M065-LIVE-LARGE-PR-PROOF` for S02.
- `scripts/verify-m048-s01.ts` is the strongest prior-art shape for a live verifier: CLI args, Azure preflight, `reviewOutputKey` + `deliveryId` correlation, structured report, truthful missing-evidence failures.
- `scripts/verify-m049-s02.ts` already proves the **visible GitHub surface** from one `reviewOutputKey`: exactly one matching visible artifact, right surface (`review`), right review state (`APPROVED`), and body contract validation.
- `scripts/verify-m064-s03.ts` and `src/knowledge/continuation-operator-evidence.ts` already prove the **canonical operator path** from `reviewOutputKey` to continuation-family truth.
- `src/review-audit/phase-timing-evidence.ts` already proves the **runtime timing/evidence seam** from Azure logs for one `reviewOutputKey`/`deliveryId` pair.

The natural implementation is therefore: add a new live-proof verifier script that accepts stable captured identifiers, reuses those three existing proof surfaces, and have `verify:m065` call it and surface its report verbatim.

## Requirement Focus

### Active requirement this slice directly supports

- **R070** — prove the redesigned large-PR lifecycle on at least one real large PR with in-place visible review evolution.

### Requirement implications for planning

S02 is where R070 becomes real. To satisfy the roadmap and context, the live proof must prove all of these on one captured run:

1. start from a stable base `reviewOutputKey`
2. preserve/cross-check delivery identity
3. show bounded first-pass execution on a real large PR path
4. show same-surface visible review evolution rather than ad-hoc duplicate outputs
5. show canonical continuation-family truth agrees with the operator-visible identity

S02 does **not** own fresh non-large regression proof; that remains S03, though S02 should avoid hardcoding report shape that prevents S03 from attaching fresh regression evidence later.

## Installed Skill Discovery

Directly relevant installed skills already available:

- `azure-container-apps` — relevant if S02 needs operational guidance around Azure Log Analytics or ACA environment assumptions.
- `github-bot` / `gh` — relevant if planning expands into live GitHub artifact capture or PR selection automation.

No missing external skill looked necessary from the current code shape. This slice is mostly verifier composition over existing GitHub/Azure/review-audit seams.

## Implementation Landscape

### 1. Current M065 seam to extend

**File:** `scripts/verify-m065.ts`

What exists now:

- stable top-level check ids:
  - `M065-M062-PREREQUISITE`
  - `M065-M063-PREREQUISITE`
  - `M065-M064-PREREQUISITE`
  - `M065-LIVE-LARGE-PR-PROOF`
  - `M065-FRESH-REGRESSION-PROOF`
- `rollout_obligations.liveLargePrProof` is still a placeholder with `state: "pending"`
- `buildRolloutChecks()` hardcodes the live-proof check as skipped/pending
- `evaluateM065()` only composes M062/M063/M064 today

Planner implication:

- keep `verify:m065` as the single milestone entrypoint
- replace only the live-proof placeholder with real evaluation data
- preserve the S01 pattern: nested authoritative report objects remain first-class, not flattened into prose

### 2. Best live-verifier shape to copy

**File:** `scripts/verify-m048-s01.ts`

Useful patterns already implemented:

- CLI accepts stable identity inputs (`--review-output-key`, optional `--delivery-id`)
- derives/cross-checks delivery identity from `parseReviewOutputKey(...)`
- queries Azure logs with truthful preflight/missing-evidence reporting
- returns machine-readable JSON with:
  - `status_code`
  - `sourceAvailability`
  - `query`
  - `evidence`
  - `issues`

Planner implication:

- S02 should create a new verifier in the same family style, likely `scripts/verify-m065-s02.ts`
- inputs should start from `--review-output-key` and optionally accept explicit repo / delivery override only for cross-checking, not as the primary truth source

### 3. Visible-surface proof already exists

**Files:**

- `src/review-audit/review-output-artifacts.ts`
- `scripts/verify-m049-s02.ts`

Reusable contract already present:

- `collectReviewOutputArtifacts(...)` finds all GitHub artifacts matching a requested `reviewOutputKey`
- `evaluateExactReviewOutputProof(...)` enforces:
  - exactly one matching visible artifact
  - the artifact is a pull-request review, not comment drift
  - `reviewState === "APPROVED"`
  - body matches the collapsed approval body contract and exact marker

Why this matters for S02:

- roadmap/context require **visible review evidence** and same-surface evolution
- this is already the repo’s strongest machine-checkable proof for the visible surface keyed by `reviewOutputKey`

Planner implication:

- do not hand-roll GitHub review-shape validation in the new S02 verifier
- either call into the existing helper functions directly or reuse the same evaluation shape from `verify-m049-s02.ts`

### 4. Canonical operator evidence already exists

**Files:**

- `src/knowledge/continuation-operator-evidence.ts`
- `scripts/verify-m064-s03.ts`

What exists now:

- `resolveContinuationOperatorEvidence(...)` parses a user-visible `reviewOutputKey`, derives the family key, normalizes to base identity, and resolves canonical family state from the knowledge store
- `buildContinuationOperatorEvidenceReport(...)` exposes:
  - `baseReviewOutputKey`
  - `familyKey`
  - `deliveryId`
  - `effectiveDeliveryId`
  - `retryAttempt`
  - authoritative attempt/outcome/final stop reason/projection status
- `verify-m064-s03.ts` already packages this into operator-facing verifier output

Planner implication:

- the S02 live verifier should treat this as the authoritative proof for “canonical continuation-family operator evidence”
- start from the base `reviewOutputKey`; do not anchor S02 on retry identities or ad-hoc log parsing

### 5. Runtime/large-PR evidence seam already exists

**Files:**

- `src/review-audit/phase-timing-evidence.ts`
- `scripts/verify-m048-s01.ts`

What exists now:

- `buildPhaseTimingEvidence(...)` filters `Review phase timing summary` rows by `reviewOutputKey` and optional `deliveryId`
- validates the structured phase payload and required phases
- returns matched `conclusion`, `published`, total duration, revision/app metadata, and phase timings

Constraint:

- this seam proves the run happened and exposes phase timing, but it does **not** by itself prove “large enough” or “continuation actually exercised”

Planner implication:

- S02 likely needs a thin new helper or verifier-level check that interprets the live evidence as a representative large-PR lifecycle run, instead of assuming any valid phase summary is enough

## Natural Seams for Task Decomposition

### Task seam A — define the S02 live-proof contract and report shape

Likely files:

- `scripts/verify-m065-s02.ts` (new)
- `scripts/verify-m065-s02.test.ts` (new)
- possibly small helper module under `src/review-audit/` only if shared logic emerges naturally

Goal:

- pin the exact input contract and report schema for the live proof
- keep it stable enough for `verify:m065` to embed as nested evidence

Recommended report contents:

- `command: "verify:m065:s02"`
- requested identifiers: `reviewOutputKey`, optional explicit `deliveryId`, repo
- normalized/canonical identifiers: base `reviewOutputKey`, family key, delivery/effective delivery identity
- subproof blocks:
  - `phaseTiming` / runtime evidence
  - `visibleSurface` / exact GitHub artifact proof
  - `operatorEvidence` / canonical continuation-family truth
- top-level stable check ids for:
  - identity correlation
  - representative large-pr runtime evidence
  - exact visible same-surface proof
  - canonical operator evidence agreement

### Task seam B — implement representative-run evaluation

Likely files:

- `scripts/verify-m065-s02.ts`
- maybe new helper under `src/review-audit/` if the representative checks are reused/testable in isolation

Goal:

- combine existing proof surfaces into one verdict for a single captured run

Important design point:

- The slice research and roadmap repeatedly say “safe but representative,” not “any successful live review.”
- The verifier therefore needs an explicit failure mode for **unrepresentative evidence**.

At minimum, the verifier should fail if any of these are missing or contradictory:

- `reviewOutputKey` does not parse / normalize to a stable base identity
- explicit `deliveryId` conflicts with the encoded key / operator evidence
- no phase timing evidence exists for the run
- no exact visible review artifact exists, or duplicates exist
- operator evidence does not resolve or disagrees with the requested family/base identity

Open point the planner must settle early:

- how to prove “representative large-PR path” mechanically

Current best candidate, based on existing seams:

- use phase timing evidence + canonical operator evidence + visible artifact proof together, and require the canonical operator evidence to indicate continuation-family truth that is meaningful (`pending`, `canonical`, `degraded`, or `superseded`) rather than a missing row
- additionally require a known live run that was selected because it is already known to be large/continuation-worthy, instead of trying to infer PR size entirely from this verifier

That suggests **captured input selection is part of the contract**: the verifier should validate a specific operator-provided proof target, not discover candidate PRs itself.

### Task seam C — wire live proof into `verify:m065`

Likely files:

- `scripts/verify-m065.ts`
- `scripts/verify-m065.test.ts`
- `package.json`

Goal:

- call the new S02 live verifier from the top-level M065 command
- replace the pending `M065-LIVE-LARGE-PR-PROOF` check with real success/failure data
- keep S03’s fresh-regression slot pending

Design constraint from S01 summary:

- M065 nested reports must remain authoritative and drill-down-friendly
- S02 should therefore appear as a nested report or equivalent top-level structured payload, not just a string in `rollout_obligations`

## What To Build or Prove First

1. **Pin the live-proof input/report contract first.**
   Without this, the planner risks mixing capture, verification, and `verify:m065` wiring into one opaque change.

2. **Define the minimum evidence bundle before coding.**
   The milestone context already points to the required identifiers. The codebase confirms the minimum bundle should include:
   - base `reviewOutputKey`
   - delivery identity (`deliveryId`, and possibly effective delivery identity from parsed/operator evidence)
   - visible GitHub proof for the exact review output
   - canonical continuation-family operator evidence
   - runtime phase timing evidence from Azure logs

3. **Only then wire `verify:m065`.**
   This keeps S02 independent and testable, and prevents drift in the milestone-level composition contract.

## Verification Strategy

### Deterministic tests to add

- `bun test scripts/verify-m065-s02.test.ts`

The test file should pin:

- CLI parsing / invalid-arg handling
- malformed or missing `reviewOutputKey`
- delivery mismatch handling
- missing Azure evidence
- missing/duplicate/wrong-surface visible artifact handling
- operator-evidence mismatch / missing canonical row
- happy-path assembly of all nested evidence blocks

Prefer dependency injection/mocked helpers like the existing verifier tests; do not require live GitHub/Azure in unit tests.

### Existing tests likely to update

- `bun test scripts/verify-m065.test.ts`

Expected updates:

- `M065-LIVE-LARGE-PR-PROOF` should no longer be hardcoded pending once S02 lands
- verify nested report preservation and stable drill-down metadata after wiring the S02 report in

### Slice-level smoke command after implementation

- `bun run verify:m065 -- --json`

Expected after S02 (before S03):

- still non-green overall, because fresh regression proof remains pending
- but live-proof slot should be satisfied when valid inputs/environment are present
- failing/pending top-level check should move to `M065-FRESH-REGRESSION-PROOF`

### Direct live-proof command to support operator reruns

Recommended new command:

- `bun run verify:m065:s02 -- --review-output-key <key> [--delivery-id <id>] [--repo <owner/repo>] --json`

Why:

- aligns with the repo’s existing command-shaped verifier pattern
- gives S03/runbook work a stable drill-down command to reference
- keeps reruns grounded on the exact stable identifiers named in milestone context

## Constraints and Gotchas

- **Do not move milestone logic into `src/handlers/review.ts`.** The research/context and existing code both point away from runtime branching and toward verifier/report composition.
- **Do not infer success from logs alone.** The live proof should combine logs, visible GitHub artifact proof, and canonical operator evidence.
- **Do not anchor on retry identities.** `src/knowledge/continuation-operator-evidence.ts` and milestone research both confirm base `reviewOutputKey` is the canonical starting point.
- **Do not auto-discover a PR as part of the verifier.** That adds operator ambiguity. Prefer explicit operator-supplied proof target identifiers.
- **Do not consume S03’s ownership.** Fresh non-large regression proof remains separate.

## Recommendation

Plan S02 as three tasks:

1. **Create `verify-m065-s02` and its tests** around a strict live-evidence bundle contract centered on `reviewOutputKey`.
2. **Compose existing proof helpers** (`buildPhaseTimingEvidence`, `collectReviewOutputArtifacts`/`evaluateExactReviewOutputProof`, `resolveContinuationOperatorEvidence`) into one machine-checkable live verdict.
3. **Wire the new report into `verify:m065`** so the milestone-level live-proof obligation is satisfied structurally while fresh regression proof remains pending for S03.

That keeps the slice aligned with the AGENTS rule to use the lightest sufficient seam first and with S01’s composition pattern: preserve authority, expose drill-down metadata, and make reruns start from stable identifiers.
