# M063 Research — Continuation-driven review execution

## Executive Summary

The codebase already contains a real continuation prototype, but it is still framed as timeout recovery rather than a first-class review lifecycle. The core path lives in `src/handlers/review.ts` and already does five important things: (1) normalize a bounded first pass from checkpoint/boundedness evidence, (2) publish a bounded partial comment, (3) queue one reduced-scope retry, (4) merge retry results back into the existing partial comment, and (5) block stale attempts from publishing through `ReviewWorkCoordinator`.

The main strategic conclusion for roadmap planning: **prove lifecycle extraction and public-surface coherence first, before broadening continuation behavior.** Today the hard part is not inventing continuation from scratch; it is turning scattered timeout-specialized seams into a reusable continuation contract without duplicating visible comments or replaying first-pass token cost.

## What Exists Today

### 1. Handler-level continuation prototype already exists

The timeout/retry block in `src/handlers/review.ts:4659+` is effectively the M063 prototype:

- reads checkpoint state via `knowledgeStore.getCheckpoint(reviewOutputKey)`
- derives a publishable bounded first pass via `normalizeReviewFirstPass(...)`
- publishes a bounded partial PR comment via `formatPartialReviewComment(...)`
- persists `partialCommentId` back into checkpoint state
- queues a reduced-scope retry using `reviewOutputKey + "-retry-1"`
- runs the retry with a narrower prompt and disabled top-level summary publishing
- merges retry progress back into the original comment and refreshes Review Details
- deletes checkpoint rows after successful merge / retry completion

This is already close to the desired product behavior, but only for timeout-driven follow-up and only with a hard-coded one-retry model.

### 2. Authority and supersession seams are already present

`src/jobs/review-work-coordinator.ts` gives the milestone a strong internal authority seam:

- `claim(...)` creates an attempt within a PR family
- `setPhase(...)` promotes a claimed attempt to authoritative once it becomes active
- `canPublish(attemptId)` ensures only the latest authoritative attempt can publish
- `getSnapshot(...)` exposes supersession state for diagnostics

This is exactly the right primitive for R062/R063/R066. The key M063 move is to reuse it for continuation passes as the product lifecycle, not just as timeout safety plumbing.

### 3. Stable review identity is strong, but split from continuation identity

`src/handlers/review-idempotency.ts` defines the visible review identity:

- base identity is `reviewOutputKey`
- retries derive `reviewOutputKey-retry-N`
- `parseReviewOutputKey(...)` normalizes retry keys back to `baseReviewOutputKey`
- `ensureReviewOutputNotPublished(...)` scans GitHub comments/reviews for the marker to prevent duplicate publication

This is promising for “one public review, many internal passes.” The important boundary is already visible: **internal pass identity can vary, but public marker identity must remain stable.**

### 4. First-pass truth contract is already normalized

`src/lib/review-first-pass.ts` is the strongest reusable seam in the milestone.

`normalizeReviewFirstPass(...)` separates:

- `bounded-first-pass`
- `zero-evidence-failure`

And includes:

- bounded reason (`timeout` / `max-turns` / `large-pr`)
- evidence source (`checkpoint` / `boundedness` / `none`)
- covered scope
- remaining scope
- publication eligibility
- `continuationPending`

This means M063 does **not** need to invent a new first-pass truth model. It needs to decide how continuation advances or settles that contract over multiple internal passes.

### 5. Public wording is coherent, but still split across two surfaces

There are currently two public continuation-related surfaces:

- bounded partial comment via `src/lib/partial-review-formatter.ts`
- Review Details via helpers in `src/lib/review-utils.ts` and `upsertReviewDetailsComment(...)` in `src/handlers/review.ts`

M062 already aligned these surfaces on bounded reason, covered scope, remaining scope, and continuation state. The deterministic verifier `scripts/verify-m062-s03.ts` proves that parity.

That gives M063 a stable baseline: the milestone should preserve this semantic parity, but likely reduce duplicated lifecycle ownership between the partial comment and Review Details.

### 6. Prompt shaping already supports narrowed retry scope

`src/execution/review-prompt.ts` already supports bounded scale and retry shaping:

- section budgets for change/size/graph/knowledge/instructions
- bounded review disclosure injection
- checkpoint instructions
- retry path in `review.ts` passes a reduced `changedFiles` set and custom retry instructions

This is the main evidence that token-disciplined continuation is feasible without a new prompt stack. The missing piece is a first-class continuation prompt contract that is explicitly narrower by design and measurable against the first pass.

### 7. Checkpoint persistence exists, but payload is too thin for rich continuation

Checkpoint data in `src/knowledge/types.ts` / `src/knowledge/store.ts` currently stores:

- `filesReviewed`
- `findingCount`
- `summaryDraft`
- `totalFiles`
- optional `partialCommentId`

That is enough for timeout fallback publication and reduced-scope retry planning. It is probably **not** enough for explicit finding revision semantics, settled/no-meaningful-delta state, or robust multi-pass continuation attribution.

## Constraints Imposed by the Current Codebase

### `review.ts` is the main risk concentration

`src/handlers/review.ts` owns too much at once:

- trigger gating
- workspace setup
- config loading
- idempotency
- boundedness resolution
- prompt assembly
- executor dispatch
- timeout handling
- retry scheduling
- retry merge
- publication
- telemetry

M063 should avoid adding more lifecycle logic directly into this file. The safest slice boundary is to extract continuation planning / merge / settlement decisions into a dedicated module while leaving `review.ts` as the orchestrator.

### Current continuation is timeout-specialized, not lifecycle-shaped

The current follow-up path is keyed to timeout behavior:

- only one retry
- reduced timeout
- reduced scope derived from `computeRetryScope(...)`
- summary publishing disabled for retry
- merge logic assumes “retry after timeout” rather than “continuation pass N with explicit revision semantics”

This is the biggest mismatch with milestone intent. The code has the right ingredients, but the surrounding model is still “recover from timeout” instead of “continue the same review lifecycle.”

### Public review surface ownership is ambiguous

Today continuation touches at least two visible artifacts:

- the bounded partial issue comment
- the separate Review Details comment

The product contract says one stable public review surface. Existing code can update one comment in place, but still treats Review Details as a parallel surface. The roadmap should decide early whether M063 means:

1. one canonical public summary comment with nested Review Details, or
2. one canonical lifecycle identity spread across summary + Review Details, but never additional lifecycle comments

The current codebase supports both, but the milestone should choose one explicitly.

### Coordinator authority is in-memory

`ReviewWorkCoordinator` is process-local. That is fine for current same-process queue coordination, but it constrains how far M063 should go.

Research conclusion: **M063 should reuse the current coordinator semantics, not expand scope into durable distributed continuation ownership unless forced by evidence.** Durable cross-process authority is more naturally a later hardening milestone if needed.

### Idempotency is marker-based, not semantic-state-based

`ensureReviewOutputNotPublished(...)` is good at suppressing duplicate visible outputs. It is not a full continuation-state machine. That is acceptable, but it means M063 must keep a clean separation between:

- output identity / duplicate suppression
- continuation lifecycle state / settlement / revision decisions

Trying to overload marker scanning into full continuation state would likely create fragile behavior.

## What Should Be Proven First

### First proof target: extract continuation planning from timeout plumbing

The first slice should prove that the timeout block can be refactored into an explicit continuation planner/contract without changing visible behavior.

Why first:

- it isolates the highest-risk logic seam in `review.ts`
- it enables every later slice without forcing immediate product-surface changes
- it gives planners a place to encode continuation pass state, settlement, and prompt narrowing rules

Minimal success proof:

- existing timeout + reduced-scope retry behavior still works
- publication authority still respects `ReviewWorkCoordinator`
- existing M062 visible truthfulness remains unchanged

### Second proof target: same public review surface across continuation

After planner extraction, prove that continuation updates only the existing public lifecycle surface.

What to prove:

- continuation never creates an extra lifecycle comment when updating an existing bounded review
- same marker / base review identity is preserved
- Review Details and summary stay semantically aligned

This slice should likely own R063 and most of R065.

### Third proof target: measurable prompt narrowing

Only after lifecycle and publication seams are stable should the milestone prove token discipline.

Why third:

- prompt narrowing metrics depend on a stable continuation contract
- premature optimization risks cementing the wrong continuation boundaries
- existing prompt-section telemetry already gives a proof surface

What to prove:

- continuation prompt uses narrower changed-file scope and/or shorter context blocks than first pass
- persisted checkpoint/state is reused instead of replaying broad first-pass context
- deterministic verification can compare first-pass vs continuation prompt budgets

## Natural Slice Boundaries

### Candidate Slice 1 — Continuation lifecycle extraction

**Goal:** turn timeout/retry logic into an explicit internal continuation contract.

Likely scope:

- extract a continuation planner/merger module from `src/handlers/review.ts`
- encode pass state, eligibility, settlement/no-delta outcomes, and merge inputs explicitly
- keep current visible behavior and single retry policy initially

Key files:

- `src/handlers/review.ts`
- new continuation module under `src/lib/` or `src/review/`
- tests in `src/handlers/review.test.ts`

Why first:

- highest concentration of lifecycle risk
- unlocks every later slice without prematurely changing product wording

### Candidate Slice 2 — Public review surface + explicit revision semantics

**Goal:** preserve one stable public review surface while making revisions explicit.

Likely scope:

- define canonical continuation publication/update contract
- decide ownership between bounded partial comment and Review Details
- add explicit revised/superseded finding wording rather than silent overwrite
- ensure continuation with no meaningful delta does not churn the public surface

Key files:

- `src/lib/partial-review-formatter.ts`
- `src/lib/review-utils.ts`
- `src/handlers/review.ts`
- `src/handlers/review-idempotency.ts`

Why second:

- depends on an extracted lifecycle contract
- directly advances R063 and R065

### Candidate Slice 3 — Token-disciplined continuation shaping + proof

**Goal:** continuation should be measurably narrower than first pass.

Likely scope:

- formalize continuation prompt inputs
- reuse checkpoint/persisted state instead of replaying first-pass context
- add deterministic proof comparing prompt sections / file scope / budgets
- potentially enrich checkpoint payload with continuation-relevant state

Key files:

- `src/execution/review-prompt.ts`
- `src/handlers/review.ts`
- `src/execution/mcp/checkpoint-server.ts`
- `src/knowledge/types.ts`
- `src/knowledge/store.ts`
- verifier script(s)

Why third:

- it is architectural, but lower risk once lifecycle ownership is clear
- it closes R066 and part of R062 with measurable evidence

## Boundary Contracts That Matter

### 1. Internal pass identity vs public review identity

This is the most important boundary in the milestone.

- internal pass identity may be `reviewOutputKey-retry-N` or similar
- public lifecycle identity must remain the base `reviewOutputKey`
- stale internal passes must be allowed to lose authority without corrupting public state

This boundary already exists in `parseReviewOutputKey(...)`; M063 should preserve and formalize it.

### 2. First-pass truth contract vs continuation settlement contract

`normalizeReviewFirstPass(...)` should remain the source of truth for whether the initial bounded review is publishable.

M063 likely needs a separate but adjacent continuation contract for:

- pending
- completed with meaningful delta
- settled with no meaningful delta
- stopped / superseded

Do **not** overload `ReviewFirstPassPayload` to represent the entire multi-pass lifecycle unless the design stays very small.

### 3. Publication eligibility vs publish authority

Current code cleanly separates:

- `normalizeReviewFirstPass().publication.eligible` → should anything bounded be publicly publishable?
- `ReviewWorkCoordinator.canPublish(...)` → is this attempt still authoritative?

That separation is good. M063 should keep it.

### 4. Prompt narrowing inputs vs durable checkpoint state

The continuation planner needs a deterministic interface for “what is left to review” that does not require reconstructing the world from raw prompt inputs each time.

Today checkpoints only persist minimal progress. If richer continuation is needed, evolve checkpoint data deliberately rather than inferring too much from comment text or GitHub state.

## Known Failure Modes That Should Shape Slice Ordering

### 1. Silent duplication of lifecycle comments

Because the current code already has summary comments, bounded partial comments, and Review Details comments, M063 can easily regress into visible comment spam if publication ownership is not defined early.

This is why public-surface work should be a dedicated slice, not incidental cleanup.

### 2. Superseded continuation overwriting newer state

The existing test seam around publish-rights loss is good, but continuation expansion raises the risk surface. Any broader continuation model should keep `canPublishReviewWorkOutput(...)` as a last-mile guard for every update path.

### 3. Continuation becoming token replay

The prompt system is already rich and can become expensive. Without an explicit continuation input contract, it would be easy to reuse the same prompt-builder path with only cosmetic narrowing and accidentally replay most of first-pass cost.

This argues for explicit prompt proof rather than “we passed fewer files, probably enough.”

### 4. Checkpoint data being too weak for revision semantics

Current checkpoint shape is good for progress but not for explicit finding revision. If revision semantics require finding-level continuity, planners should expect either:

- checkpoint enrichment, or
- a separate continuation merge model based on existing published findings / inline comments

This is a real scope decision, not just an implementation detail.

## Requirements Analysis

### Active requirements that are table stakes

- **R062** automatic continuation after bounded large-PR first pass — fully central
- **R063** same visible review surface, no extra public comment — fully central
- **R065** explicit revision, not silent rewrite — central product trust requirement
- **R066** sufficient-but-bounded continuation, not exhaustive theater — central architectural constraint

These are all well-scoped and aligned with the codebase.

### Likely omission / ambiguity

The current requirements do not explicitly state what happens when continuation adds **no meaningful new user-visible value**.

This is called out in the milestone context as an open question, and it matters because the handler already has a “retry produced no additional results — keeping original partial review” path. The roadmap should decide whether that remains silent, updates state quietly, or adds explicit settled wording on the same surface.

### Candidate requirement (not yet binding)

**Candidate:** continuation may settle without a public rewrite when no meaningful delta exists, but the authoritative lifecycle state must still become non-pending somewhere deterministic.

Why it may matter:

- avoids pointless comment churn
n- closes the lifecycle truthfully
- prevents “continuation pending forever” drift

This should be evaluated before becoming a formal requirement.

### Candidate requirement (not yet binding)

**Candidate:** continuation publication/update must be guarded by the same publish-rights check at every final write path, including Review Details refresh.

Why it may matter:

- current code already does this in several places
- milestone acceptance explicitly depends on stale continuation never overwriting newer authoritative state
- formalizing it would reduce regression risk

This may remain advisory if existing requirements plus tests are sufficient.

### Clearly out of scope

- durable cross-process continuation authority beyond current coordinator semantics
- universal continuation for all review classes
- operator-tunable continuation aggressiveness
- full operational dashboard redesign around continuation

These would expand the milestone beyond the user-visible contract.

## Existing Tests and Proof Surfaces to Reuse

### Strong reusable tests

- `src/jobs/review-work-coordinator.test.ts` — authority / supersession semantics
- `src/handlers/review-idempotency.test.ts` — stable identity / retry-key parsing / duplicate-output suppression
- `src/lib/review-first-pass.test.ts` — publishable bounded first-pass vs zero-evidence hard failure
- `src/lib/partial-review-formatter.test.ts` — bounded comment wording and retry merge wording
- `src/lib/review-utils.test.ts` — Review Details truthfulness
- `src/handlers/review.test.ts` around timeout + retry merge + publish-rights loss — closest existing integration proof

### Strong reusable verifier pattern

- `scripts/verify-m062-s03.ts` already proves semantic parity between bounded comment and Review Details

M063 should likely add a verifier in the same style for:

- first pass → continuation update on same public surface
- continuation state transition from pending → settled/completed
- prompt narrowing evidence vs first pass

## Skill Discovery Notes

Directly relevant installed skills already present:

- `azure-container-apps` — relevant for the Azure review execution environment
- `github-bot` — relevant for GitHub API/publication behavior
- `debug-like-expert` / `systematic-debugging` — useful if continuation regressions become hard to reproduce

Relevant technology without an installed project skill:

- **Hono**
  - promising external skill: `yusukebe/hono-skill@hono` (4.8K installs)
  - install command: `npx skills add yusukebe/hono-skill@hono`
  - lower-priority alternatives also exist, but this is the strongest by install count

No installation is recommended yet; this is only a candidate if future slice work needs deeper Hono-specific guidance.

## Recommended Roadmap Shape

1. **Start with lifecycle extraction**, not UX wording or prompt optimization.
2. **Make public-surface ownership explicit** before broadening continuation triggers.
3. **Add prompt/token proof only after continuation boundaries are stable.**
4. **Keep M063 large-PR-first and same-process-first.** Reuse current coordinator semantics.
5. **Treat checkpoint evolution as optional until revision semantics demand it.** Do not expand persistence blindly.

## Planner Takeaways

- The codebase already contains the continuation skeleton; the milestone is about promoting it into the product contract.
- `normalizeReviewFirstPass(...)`, `ReviewWorkCoordinator`, and `reviewOutputKey` parsing are the three strongest existing seams.
- `src/handlers/review.ts` is the main risk and should not absorb more complexity without extraction.
- The biggest design decision is not whether continuation exists; it is **what owns the single public review lifecycle** and **how revision/no-delta settlement is made explicit without comment churn**.
- The most valuable first slice is the one that creates an explicit continuation contract while preserving current M062 truthfulness.
