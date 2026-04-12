# M048 Research — PR Review Latency Reduction and Bounded Execution

**Date:** 2026-04-12
**Status:** Research complete for roadmap planning.

## Scope framing

M048 should be planned as a **measurement-first latency milestone**, not a speculative parallelism milestone.

The codebase already has truthful bounded-review behavior in several places, but it does **not** yet have operator-grade phase timing for the live review path. There are also two likely high-leverage plumbing issues already visible in code: fixed serial overhead around workspace/bundle/ACA handoff, and configuration/product choices that currently keep large reviews in a very expensive shape.

## Skill discovery (suggested, not installed)

Directly relevant technologies with promising external skills:

- **Hono**
  - Found: `yusukebe/hono-skill@hono` — ~3K installs
  - Install: `npx skills add yusukebe/hono-skill@hono`
- **Claude Agent SDK**
  - Found: `jezweb/claude-skills@claude-agent-sdk` — ~423 installs
  - Install: `npx skills add jezweb/claude-skills@claude-agent-sdk`

I did **not** find a clearly compelling telemetry/Postgres-specific skill worth recommending for this milestone; the search results were generic observability/database skills rather than a strong fit for Kodiai’s review-latency problem.

## What exists today

### 1. Review orchestration already has clear logical phases

`src/handlers/review.ts` already performs most of the end-to-end review pipeline in one place:

- webhook/job queue entry
- workspace creation
- PR head/base fetch
- config load + trigger gating
- diff collection / diff analysis
- large-PR triage
- structural-impact query
- retrieval/context assembly
- profile selection + timeout estimation
- prompt build
- single `executor.execute(...)`
- post-run extraction / filtering / Review Details publication
- timeout partial-review + reduced-scope retry path
- telemetry writes

This means the code already has natural instrumentation seams. The missing part is **durable phase timing**, not phase boundaries.

### 2. Execution is still single-worker by design

`src/execution/executor.ts` dispatches **one ACA job per review execution**. The contract is still:

- one review execution
- one `reviewOutputKey`
- one result artifact (`result.json`)
- one publication flow

That architecture strongly favors doing the cheap wins first. Parallel review-worker fan-out would cut across publication, idempotency, finding deduplication, and truthfulness contracts.

### 3. Retrieval is already parallelized more than the milestone brief might imply

`src/knowledge/retrieval.ts` and `src/knowledge/multi-query-retrieval.ts` already do meaningful concurrency:

- three retrieval variants
- bounded concurrent variant execution
- `Promise.allSettled(...)` fan-out across learning memory, review comments, wiki, code snippets, canonical code, and issues
- rerank/dedup/RRF merge afterward

Planner implication: **do not assume retrieval is the dominant serial bottleneck**. Measure it before allocating a whole slice to retrieval tuning.

### 4. Structural-impact code already solved a similar observability problem

`src/structural-impact/orchestrator.ts` runs graph + canonical-code lookups concurrently with:

- shared timeout
- fail-open degradations
- cache support
- per-source observability signals (`graph-ok`, `graph-timeout`, `corpus-ok`, `cache-hit`, etc.)

This is the strongest reusable pattern for M048 phase timing. It already models how Kodiai likes to expose bounded, truthful, partial results.

## Key findings and surprises

### A. There is no operator-grade phase timing yet

The code records only coarse telemetry today:

- `telemetry_events`: total execution duration + token/cost/conclusion
- `retrieval_quality_events`: retrieval quality, not wall-clock phase timing
- `resilience_events`: timeout/retry metadata
- `rate_limit_events`, `llm_cost_events`

What is missing:

- queue wait duration
- workspace clone/fetch duration
- diff-analysis duration
- structural-impact duration
- retrieval duration
- prompt-assembly duration
- repo-bundle/Azure Files staging duration
- ACA launch latency
- ACA remote runtime vs poll lag
- publish/update comment duration

`src/lib/review-utils.ts` renders good Review Details, but it currently shows profile, findings, scope, tokens, and structural-impact status — **not phase timings**.

### B. There is already hidden queue latency, but it is not surfaced operationally

`src/jobs/queue.ts` tracks:

- `waitMs` from enqueue to actual start
- job execution `durationMs`

That data is logged, but not written into telemetry or Review Details. For real live-path latency, this is important: queue delay is part of user-perceived review time, especially with per-installation concurrency = 1.

### C. The current repo config likely defeats the main automatic timeout mitigation

The checked-in `.kodiai.yml` sets:

- `review.profile: strict`

In `src/handlers/review.ts`, timeout auto-scope reduction only applies when:

- timeout risk is high **and**
- `profileSelection.source === "auto"`

If profile source is `manual`, the code logs **"Skipping scope reduction: user explicitly configured profile"**.

Planner implication: on this repo, large/high-risk PRs are currently biased toward the slowest review shape. This is likely directly relevant to the timeout-prone baseline.

This is not just an implementation detail — it is a **product contract question**:

- should explicit `strict` remain absolute even when it makes the run timeout-prone?
- or should Kodiai downgrade/scope-bound even explicit strict reviews, as long as the surface says so plainly?

That decision should be made deliberately in planning.

### D. The current synchronize-trigger config is effectively mis-shaped

The checked-in `.kodiai.yml` uses:

```yml
review:
  onSynchronize: true
```

But the config schema expects:

```yml
review:
  triggers:
    onSynchronize: true
```

And `isReviewTriggerEnabled(...)` reads from `config.review.triggers.onSynchronize`.

Planner implication: the milestone context’s warning is confirmed in code shape — synchronize reruns are still likely disabled despite the apparent intent to enable them. This is a cheap but high-value continuity fix because it materially affects live proof loops.

### E. Executor handoff has obvious fixed serial overhead

The current path does all of the following before the agent can really work:

1. shallow clone workspace (`depth: 50`)
2. fetch PR head ref onto the base repo clone
3. fetch base branch explicitly
4. sometimes recover merge-base / deeper fetch for diff handling
5. stage repo into Azure Files workspace
6. in `prepareAgentWorkspace(...)`, create a **git bundle** with `git bundle create ... --all`
7. remote container materializes the repo bundle again before SDK execution
8. ACA polling uses a **fixed 10s interval**

Potentially important consequence:

- even when the agent itself is fast enough, wall-clock time still includes clone/fetch/bundle/materialize/poll lag
- the fixed 10s poll interval alone can add nearly 10 seconds of avoidable tail latency to every successful run

This looks like the most obvious cheap-win slice after instrumentation.

### F. Retry logic is truthful, but it is not the main latency strategy

The timeout path in `src/handlers/review.ts` is already honest:

- it publishes a partial-review comment when timed out
- it says when retry is skipped
- it only retries once
- it avoids retry noise when inline output was already published
- the merged partial-review text explicitly says it completed with reduced scope

That is good continuity to preserve. But it is a **recovery path**, not a primary latency solution. M048 should not plan around “timeout then retry” as the main improvement story.

### G. Parallel shard-and-merge would be invasive

If planner eventually chooses fan-out, it must preserve at least these contracts:

- one GitHub-visible publish outcome per review request
- one truthful statement of coverage/scope
- deterministic finding deduplication across shards
- deterministic severity/category normalization across shards
- idempotent `reviewOutputKey` behavior
- retry/partial-review semantics that do not double-publish

Current code is not shaped for this yet. It is possible, but it is not the cheapest next slice.

## Natural slice boundaries

### Slice 1 — Measure and prove where time is spent

**Goal:** create a durable latency proof surface before changing behavior.

Likely files:

- `src/handlers/review.ts`
- `src/execution/executor.ts`
- `src/jobs/queue.ts`
- `src/telemetry/types.ts`
- `src/telemetry/store.ts`
- `src/review-audit/log-analytics.ts`
- new verifier script, likely alongside `scripts/verify-m044-s01.ts`

What this slice should do:

- add structured phase timing capture on the live review path
- include queue wait as a first-class phase
- include workspace, retrieval, structural impact, executor handoff, ACA wait/runtime, and publish phases
- reuse the M044 Azure Log Analytics pattern for operator proof
- produce one repeatable verifier/report for a live xbmc/kodiai review

**Why first:** it retires the biggest planning risk — changing the wrong part of the pipeline.

### Slice 2 — Remove avoidable fixed overhead on the single-worker path

**Goal:** make the existing one-worker path materially faster before changing semantics.

Likely files:

- `src/execution/executor.ts`
- `src/jobs/aca-launcher.ts`
- `src/jobs/workspace.ts`
- possibly `src/execution/agent-entrypoint.ts`

Most likely wins:

- reduce ACA poll lag
- trim bundle/materialization overhead
- avoid unnecessary unshallow/bundle breadth where honest and safe
- separate orchestrator-side staging time from remote-agent runtime

**Why second:** these are cheap, architecture-preserving wins and likely affect every review.

### Slice 3 — Rework large-PR bounded behavior and profile/trigger continuity

**Goal:** make the slowest review class explicit, honest, and less timeout-prone.

Likely files:

- `.kodiai.yml`
- `src/execution/config.ts`
- `src/handlers/review.ts`
- `src/lib/timeout-estimator.ts`
- `src/lib/review-utils.ts`
- `src/execution/review-prompt.ts`

Decisions needed:

- whether manual `strict` may still be bounded under high timeout risk
- whether large-PR triage thresholds should become more aggressive
- whether synchronize-trigger continuity becomes part of milestone scope

**Why third:** product behavior changes should be guided by measured latency first.

### Slice 4 — Conditional exploration of parallel review fan-out

**Goal:** only if Slice 1 proves the dominant time is inside remote agent runtime and S2/S3 are insufficient.

Likely files would span:

- `src/handlers/review.ts`
- `src/execution/executor.ts`
- review publication/idempotency helpers
- new shard-merge modules and tests

This should be explicitly gated behind evidence. It is not the first roadmap bet.

## Boundary contracts the planner should preserve

### Truthfulness contract

The current system already tells the truth in several places:

- large-PR prompt triage names full vs abbreviated vs not reviewed files
- Review Details shows scope counts and “files not fully reviewed”
- partial-review comments explicitly say they are partial/timed out/reduced-scope

M048 should preserve this and extend it to any new bounded behavior.

### Single-publication/idempotency contract

`reviewOutputKey` and the review-output idempotency helpers assume a single canonical publish outcome. Any latency optimization that changes execution topology must preserve that.

### Fail-open contract

Retrieval, structural impact, graph, rate-limit telemetry, and several enrichments already fail open. Latency instrumentation should do the same: **never** make the review path more brittle just to capture timings.

### Operator-proof contract

M044 already established the pattern for using Azure Log Analytics and structured artifact correlation for live proof. M048 should reuse that instead of inventing a one-off proof surface.

## What should be proven first

1. **Real live phase breakdown** on xbmc/kodiai for at least one production-like review run.
2. Whether fixed overhead (queue + workspace + bundle + ACA poll) is large enough to materially improve latency without changing review semantics.
3. Whether current manual `strict` configuration is a primary reason high-risk reviews still timeout.
4. Whether synchronize reruns are currently blocked by config shape in real practice.

Only after that should planner decide whether parallel shard-and-merge is worth the complexity.

## Requirements analysis

### Active/table-stakes requirements and continuity constraints

- **R049** is the active milestone requirement and should stay the top-line contract.
- From milestone context, **R034 / R043 / R044** remain table stakes even if not expanded in the compact requirements file:
  - do not regress small-PR latency/cost unnecessarily
  - do not break explicit mention review execution/publication
  - keep operator evidence surfaces intact

### Candidate requirement additions

These should be considered explicitly rather than silently assumed:

1. **Operator-visible phase timing candidate requirement**
   - Kodiai should expose durable per-phase latency for queue wait, workspace prep, retrieval/context assembly, executor/ACA runtime, and publication on live reviews.
   - Rationale: this is currently missing and is required for M048 proof, not just convenience.

2. **Synchronize-trigger continuity candidate requirement**
   - When a repo intends synchronize-triggered reviews, the configured shape must actually activate them or the verifier must fail loudly.
   - Rationale: this directly affects live iteration speed and proof repeatability.

3. **Explicit strict-vs-bounded behavior candidate requirement**
   - If explicit `strict` can still be bounded for latency reasons, the GitHub-visible surface must say so clearly.
   - Rationale: this is a product-contract choice, not a hidden implementation detail.

### Advisory only, not requirement-worthy yet

- Parallel shard-and-merge review
- fine-grained per-tool timing inside the remote agent loop
- broader multi-job execution redesign

Those are valid research directions, but they should remain advisory until single-worker measurements prove they are necessary.

## Planner recommendations

1. **Start with observability + proof, not optimization.** The code already has enough seams to instrument without broad refactors.
2. **Prioritize cheap wall-clock wins next:** queue visibility, workspace/bundle/handoff, and ACA poll cadence.
3. **Treat large-PR behavior as a product decision, not only a tuning knob.** The current manual strict config likely blocks the auto-scope safeguard.
4. **Fix trigger continuity early if it is cheap.** The current config/schema mismatch is likely real and affects live verification loops.
5. **Defer parallel fan-out unless measured evidence says single-worker plumbing wins are insufficient.**

## Recommended slice order

1. **Latency phase instrumentation + live verifier**
2. **Single-worker executor/workspace overhead reduction**
3. **Large-PR/profile/trigger behavior changes with explicit disclosure**
4. **Optional shard-and-merge exploration only if needed**

## Resume notes for planners

- The two highest-value code findings for planning are:
  1. `.kodiai.yml` currently uses a mis-shaped synchronize trigger
  2. `.kodiai.yml` currently forces manual `strict`, which causes timeout auto-scope reduction to skip
- The best reusable observability pattern is the structural-impact orchestrator signal model plus the M044 Azure Log Analytics verifier pattern.
- The biggest likely cheap latency wins are outside the retrieval pipeline.
