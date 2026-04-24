# M065 Research — Live hardening and rollout proof

## What exists now

The redesign proof chain is already split cleanly across deterministic verifier seams:

- `scripts/verify-m062-s01.ts` proves bounded first-pass normalization and identity/coverage truth.
- `scripts/verify-m063-s01.ts` proves continuation scheduling, settlement shape, and stale-authority suppression.
- `scripts/verify-m063-s02.ts` proves same-surface ownership, marker continuity, Review Details attachment, visible revision semantics, and quiet no-delta settlement.
- `scripts/verify-m063-s03.ts` proves continuation prompt narrowing and truthful bounded wording.
- `scripts/verify-m064-s01.ts` and `scripts/verify-m064-s02.ts` prove canonical continuation-family authority plus failure/supersession projection.
- `scripts/verify-m064-s03.ts` proves the operator lookup/report seam from `reviewOutputKey` to canonical family truth.

This is the key strategic fact for M065: the repo already has the nested proof surfaces the milestone wants. The missing work is composition, one live proof surface, and operator packaging around that live proof.

## Existing patterns to reuse

### 1. Command-shaped verifier pattern

Verifier scripts in this repo follow a consistent contract:

- stable command name in `package.json`
- `--json` machine-readable mode
- explicit status codes and per-check/per-scenario records
- human-readable report renderer
- exit code driven by report success

M062–M064 follow this pattern already. M065 should extend it rather than invent a new proof format.

### 2. Nested evidence, not flattened prose

The prior milestone verifiers are intentionally attributable. They report scenario/check IDs rather than one collapsed boolean. M065 should preserve that structure by embedding or passing through sub-verifier outputs instead of re-stating their conclusions in prose.

### 3. Live-proof prior art from M048/M044/M061/Phase 75

There is already strong prior art for live, operator-facing proof:

- `scripts/verify-m048-s01.ts` is a live Azure-backed verifier that accepts a `reviewOutputKey`, derives/cross-checks delivery identity, queries Azure Log Analytics, and emits structured outcome/evidence/status codes.
- `scripts/verify-m044-s01.ts` is a recent-review audit verifier over live GitHub/Azure/DB evidence, with truthful preflight reporting.
- `scripts/phase75-live-ops-verification-closure.ts` plus `docs/smoke/phase75-live-ops-verification-closure.md` and `docs/runbooks/review-requested-debug.md` show the repo’s preferred “collect live identities first, then run one machine-readable verifier” operator flow.

This is likely the right shape for M065 live proof: capture live identifiers from one real PR run, then feed them into a verifier rather than trying to trigger and observe everything inside a single opaque script.

### 4. Operator drill-down pattern

`docs/runbooks/review-requested-debug.md` and `docs/runbooks/recent-review-audit.md` already show the repo’s runbook style:

- one top-level command
- preflight expectations
- exact fields to inspect first
- escalation / drill-down path using delivery IDs and `reviewOutputKey`

M065 should package its operator guidance in this same style.

## Important codebase constraints

### Canonical truth is keyed by base review identity

`src/handlers/review.ts` persists canonical continuation-family state via `persistContinuationFamilyState(...)`, always normalizing to the base `reviewOutputKey` (retry suffix stripped). `src/knowledge/store.ts` enforces one row per `(family_key, base_review_output_key)` with ordinal-guarded upsert.

Implication: M065 should treat the live proof’s base `reviewOutputKey` as the anchor identifier. Any rollout verifier that keys on retry output identity alone will be fighting the shipped authority model.

### Operator lookup already starts from `reviewOutputKey`

`src/knowledge/continuation-operator-evidence.ts` resolves a user-visible `reviewOutputKey` into canonical continuation-family truth and returns a report with status, family key, delivery identity, attempt authority, stop reason, and projection status.

Implication: the live proof should expose at least one captured `reviewOutputKey`, because that is already the shortest operator drill-down path.

### The review handler is huge; avoid adding another broad orchestration seam inside it

`src/handlers/review.ts` is already the large orchestration surface. M065 should prefer new verifier/reporting code in `scripts/` and small helper modules over adding milestone-specific branching in the runtime handler.

### R069 is currently validated only from older evidence

`.gsd/REQUIREMENTS.md` shows `R069` validated via M061 regression evidence. That is useful prior proof, but not enough for M065 closeout by itself because the milestone explicitly says regression must be checked during rollout proof.

Implication: M065 should refresh small/normal PR regression evidence rather than relying only on historical validation text.

## What should be proven first

### First proof target: composition without drift

The first slice should build the composed deterministic verifier that wraps M062/M063/M064 and preserves nested evidence.

Why first:

- It is the lowest-risk, highest-leverage step.
- It defines the top-level contract before live-proof plumbing starts.
- It reduces later ambiguity about what the live proof must add versus what prior verifiers already cover.
- It exposes whether any current verifier outputs need slight standardization to compose cleanly.

### Second proof target: minimum credible live evidence contract

Before implementing a full live prover, define the exact live identifiers and evidence surfaces required for a passing live proof.

Based on existing code, the minimum viable live artifact set likely needs:

- base `reviewOutputKey`
- base delivery ID / effective delivery ID
- proof that first pass was bounded rather than full
- proof that continuation occurred or settled truthfully
- proof that the visible surface stayed same-surface / in-place
- proof that canonical continuation-family state agrees with the visible/operator surface

If this contract is fuzzy, the live proof will become hand-wavy.

### Third proof target: fresh non-large regression proof

The milestone needs an explicit check that ordinary PR behavior did not get worse. That should be a distinct proof obligation, not a side note in the live proof.

## Natural slice boundaries

### Slice 1 — Top-level composed verifier

Goal:

- add one `verify:m065:*` top-level verifier family entrypoint
- compose M062/M063/M064 deterministic proofs
- preserve nested status codes / subreports
- report one milestone-level PASS/FAIL with drill-down paths

Likely files:

- new `scripts/verify-m065-s01.ts` or `scripts/verify-m065.ts`
- `package.json` script wiring
- likely unit tests for composition semantics

Boundary contract:

- deterministic only
- no live GitHub/Azure side effects
- sub-verifiers remain authoritative

### Slice 2 — Live proof capture and verification

Goal:

- define a machine-readable live-proof input contract
- verify one real large-PR run from captured identities
- reuse Azure/GitHub/operator lookup seams rather than recreating them

Likely shape:

- a verifier that accepts captured identity inputs, similar to Phase 75 / M048 live verifiers
- perhaps a checked-in JSON artifact or documented CLI flags for the proof run
- correlation across `reviewOutputKey`, delivery ID, visible surface, and canonical operator evidence

Boundary contract:

- one real PR path
- safe but representative
- failure if evidence is missing, unrepresentative, or contradictory

### Slice 3 — Regression and operator packaging

Goal:

- fresh explicit proof for non-large/small PR behavior
- operator runbook for rerun + drill-down
- probably a single top-level runbook pointing to nested commands and failure interpretation

Likely reused surfaces:

- `verify:m061:regression` for regression reuse if still relevant
- `verify:m044` / Phase 75 patterns for live operational evidence
- `verify:m064:s03` for operator lookup from `reviewOutputKey`

Boundary contract:

- no new review runtime behavior
- packaging and closeout evidence only

## Real risks that should drive ordering

### Risk: flattening nested evidence

The milestone context explicitly warns against this, and the repo structure agrees. If M065 rephrases prior checks into one summary, operators lose failure localization. This is the main design risk of the composed verifier.

Recommended response:

- make subreports first-class fields in the M065 JSON output
- do not duplicate sub-verifier logic
- fail M065 when any nested verifier fails, but keep the original nested statuses visible

### Risk: “live proof” becomes merely “some logs existed”

There is already infrastructure for live Azure/GitHub evidence, but a weak implementation could accept a safe-but-unrepresentative PR or a run that never actually exercised continuation.

Recommended response:

- require evidence that the first pass was bounded
- require evidence that continuation-family truth reached a meaningful end state
- require same-surface/public evolution checks, not just executor completion
- reject live runs that never actually exercised the large-PR lifecycle of interest

### Risk: wrong rerun surface

`docs/runbooks/review-requested-debug.md` is explicit: the supported manual re-review procedure is PR-scoped `@kodiai review`; team reviewer requests are not the supported manual rerun path.

Recommended response:

- the M065 runbook should distinguish:
  - the live proof trigger path being audited
  - the supported operator rerun path for reproducing/debugging
- do not imply that reviewer-team requests are the general rerun mechanism

### Risk: stale historical regression evidence treated as fresh launch proof

`R069` is validated historically, but M065’s contract requires fresh explicit regression proof.

Recommended response:

- re-run a current regression gate as part of M065
- keep regression evidence separate from the live large-PR proof

### Risk: milestone-number collision with older rollout proof work

The repo already has `verify:m055:s01`, `verify:m055:s02`, and `verify:m055:s03`, and `PROJECT.md` marks M055 complete. M065 is a different rollout/closeout milestone in the current roadmap.

Recommended response:

- do not piggyback on M055 naming or output files
- make M065 commands and reports clearly distinct to avoid operator confusion

## Likely proving target

The strongest repo evidence points to `xbmc/xbmc` as the representative live environment:

- `verify:m044` defaults to `xbmc/xbmc`
- `docs/runbooks/xbmc-cutover.md` and `docs/runbooks/xbmc-ops.md` are already the real-world ops surface
- several smoke docs treat `xbmc/xbmc` as the production-like proving environment

Research conclusion:

- `xbmc/xbmc` is the most obvious representative large-PR proving target if app installation, logs, and safe test PR selection are available.
- The live proof should prefer a controlled, low-risk large PR in that environment rather than a synthetic local harness.

Open operational detail still needing milestone planning:

- whether the proof PR is an existing known large PR, a dedicated safe test PR, or a captured historical run replayed through current evidence tooling

## Requirements analysis

### Active requirement

- `R070` is the only active requirement directly mapped to M065.

### Table stakes already implied by existing system

These do not need new requirement IDs unless the user wants stronger closure guarantees:

- composed verifier must preserve nested M062–M064 evidence
- live proof must be machine-checkable, not prose-only
- operator rerun path must start from stable identifiers already used in the codebase (`reviewOutputKey`, delivery IDs)
- canonical continuation-family truth remains authoritative over ad-hoc log interpretation

### Likely omission / candidate requirement

Candidate requirement:

- **Fresh rollout-time non-large regression evidence** — require a fresh rerun of the non-large review regression gate as part of M065 closeout, not only inherited validation text.

Why candidate, not automatically binding:

- it is strongly suggested by the milestone context and R069, but `.gsd/REQUIREMENTS.md` does not yet say that M065 must refresh R069 with fresh evidence.

Candidate requirement:

- **Minimum live-proof evidence bundle contract** — define the exact identifiers and artifacts a live proof must capture (at minimum base `reviewOutputKey`, delivery identity, visible-surface proof, canonical operator-evidence proof).

Why candidate:

- this is currently an implementation expectation rather than an explicit requirement, but writing it down would reduce ambiguity for slice planning.

### Clearly out of scope

- multi-run soak campaign
- new runtime lifecycle semantics
- redesigning review publication identity again
- replacing prior milestone verifiers rather than composing them

## Skill discovery suggestions

Installed skills already directly relevant:

- `azure-container-apps` — relevant for Azure Container Apps / Log Analytics operational proof.
- `github-bot` / `github-workflows` / `gh` — relevant if milestone execution needs GitHub API or workflow-level evidence capture.

Promising uninstalled skills found:

- Hono: `npx skills add yusukebe/hono-skill@hono` — 4.8K installs. Useful only if M065 ends up touching HTTP/webhook surface code rather than staying verifier-only.
- PostgreSQL: `npx skills add wshobson/agents@postgresql-table-design` — 14.7K installs. Only mildly relevant here; the milestone mostly consumes existing DB truth surfaces rather than redesigning schema.

Recommendation: no new skill looks necessary for the likely M065 path unless planning expands into HTTP-surface changes or deeper DB redesign.

## Recommended milestone strategy

1. Build the composed deterministic verifier first.
2. Define the live-proof evidence contract before writing live-proof code.
3. Implement live proof by reusing existing `reviewOutputKey`/delivery/Azure/operator-evidence seams.
4. Add fresh explicit non-large regression proof as a separate check.
5. Finish with one runbook that tells operators how to run the top-level verifier and how to drill into the captured live identifiers.

## Roadmap-planner takeaway

M065 is not a runtime redesign milestone. It is a proof-composition and launch-evidence milestone.

The codebase already has the hard technical seams. The planner should optimize for:

- preserving nested authority from M062–M064
- keeping the live proof narrow but real
- making the operator path start from the same stable identifiers the system already trusts
- keeping regression proof explicit and fresh rather than inherited
