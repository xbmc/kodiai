# S05 Research — Integrated Token-Reduction Proof and Regression Gate

## Summary

S05 is **targeted research**, not deep architecture work. The milestone already has the hard production seams: canonical Postgres reporting in `scripts/usage-report.ts`, slice verifiers for S01-S04, bounded prompt-section telemetry for mention/review, and truthful reuse evidence in `rate_limit_events`. The remaining work is to **compose those seams into one milestone-level proof surface plus one pinned regression gate**.

The biggest practical gap is not telemetry plumbing anymore. It is **proof composition**:
1. proving integrated token reduction on representative mention/review paths using the canonical usage-report data shape,
2. proving truthful reuse/fail-open behavior is still visible,
3. pinning the exact test suites that guard normal behavior so token savings do not regress publication semantics or prompt truthfulness.

A second concrete gap: `package.json` currently exposes `verify:m061:s01` and `verify:m061:s02`, but **does not expose `verify:m061:s03` or `verify:m061:s04`** even though those scripts exist. S05 should treat script wiring as part of the operator surface, not as cleanup.

## Requirement targeting

Preloaded slice context says S05 advances/validates:
- **R068** — operator-facing evidence must make progress/stop/fallback states attributable on canonical surfaces.
- **R069** — normal/small-path behavior must stay protected by regression coverage.

Milestone context also says M061 should still be planned against roadmap-owned token-efficiency requirements **R056-R060** even though `REQUIREMENTS.md` is currently out of phase. For S05, that means:
- do **not** invent a second proof store,
- do **not** infer reduction from prose,
- do **not** hide degraded/unavailable telemetry,
- do **pin** regression checks for mention/review/reuse/reporting behavior.

## Relevant rules from loaded skills

These rules directly shape the slice:
- **`observability` skill**: use durable, agent-readable signals rather than ad hoc logs. For S05 that means composing `usage-report` + `verify-m061-s0*` surfaces, not adding a one-off proof format.
- **`verify-before-complete` / `verification-before-completion`**: evidence before claims. S05 should end with a verifier/regression gate that runs now, not with narrative claims that earlier slices “probably” reduced tokens.
- **AGENTS hard rules**: read before edit, use the lightest sufficient tool first, and work is not done until relevant verification passes. That favors a small number of scripts/tests over more runtime instrumentation.

## Skill discovery

Installed skills already relevant:
- `observability`
- `test`
- `verify-before-complete`

External skill candidates worth considering later, not required for this slice:
- `npx skills add supabase/agent-skills@supabase-postgres-best-practices` — strongest Postgres result by installs; relevant only if query/report shape expands further.
- `npx skills add lammesen/skills@bun-expert` — relevant if Bun CLI/runtime quirks remain part of the operator proof story.

## Implementation landscape

### Canonical reporting/query seam
- **`scripts/usage-report.ts`** is the core shared seam.
  - Exposes `queryUsageReport()` / `queryUsageReportWithTimeout()`.
  - Already returns everything S05 needs in one shape: `summary`, `taskTypes`, `deliveryBreakdown`, `promptSections`, `rateLimits`, `reuseEvidence`.
  - Delivery rows already include both `promptEstimatedTokens` and `llmInputTokens`, which is enough to build operator-facing token-reduction comparisons without raw prompt capture.
  - Reuse rows already normalize event types into:
    - `retrieval.query-embedding`
    - `mention.derived-context`
    - `review.derived-prompt`
  - Fail-open DB behavior is already correct: `missing` and `unavailable` return structured preflight instead of hanging.

### Existing slice proof surfaces to compose
- **`scripts/verify-m061-s01.ts`** — baseline telemetry/reporting proof for `review.full`, `mention.response`, `slack.response`, prompt sections, delivery attribution, cache evidence.
- **`scripts/verify-m061-s02.ts`** — mention-context diet proof; asserts fine-grained `mention.context` sections and canonical `mention.user-prompt` section.
- **`scripts/verify-m061-s03.ts`** — review section budget proof; asserts named `review.user-prompt` sections, truncation evidence, delivery attribution.
- **`scripts/verify-m061-s04.ts`** — reuse proof; asserts retrieval reuse hits plus truthful mention/review cache hit/miss/degraded/bypass states.

These scripts already share a stable structure:
- CLI arg parsing via `parseArgs`
- preflight-only fail-open report when DB unavailable
- `evaluate*` pure function over usage-report-shaped data
- human renderer + JSON mode

That makes S05 naturally suited to either:
1. a **milestone composition verifier** that calls/evaluates S01-S04 proof functions and adds integrated-token checks, or
2. a **single new evaluator** over `UsageReportQueryResult` that restates the integrated criteria directly.

Option 1 is lower risk because it reuses existing proof contracts.

### Runtime telemetry seams already complete
- **`src/execution/mention-context.ts`** emits stable mention context section names such as:
  - `mention-conversation-history`
  - `mention-pr-metadata`
  - `mention-inline-review-context`
  - `mention-review-thread-context`
  - `scale-notes`
- **`src/execution/mention-prompt.ts`** keeps one canonical prompt section: `mention-user-prompt`.
- **`src/execution/review-prompt.ts`** emits stable named review sections and budgets them before converting to `PromptBuildResult`.
- **`src/handlers/mention.ts`** records:
  - `review.user-prompt` for explicit review mentions,
  - `mention.user-prompt` for normal mention responses,
  - `reuse.retrieval-query-embedding.mention`,
  - `reuse.mention-derived-context`.
- **`src/handlers/review.ts`** records:
  - `review.user-prompt`,
  - `reuse.retrieval-query-embedding.main`,
  - `reuse.review-derived-prompt`.
- **`src/telemetry/store.ts`** persists prompt sections text-free via `recordPromptSections()` and rate-limit/reuse evidence via `recordRateLimitEvent()`.

S05 does **not** need more runtime instrumentation unless planner finds a missing comparison dimension.

### Existing regression-gate pattern
- **`scripts/phase80-slack-regression-gate.ts`** is the cleanest template for the regression half of S05.
  - Pinned suite list.
  - Stable check IDs.
  - `spawnSync` execution.
  - concise pass/fail report.
- S05 can copy this structure for a token-efficiency regression gate instead of inventing another harness abstraction.

## What is missing for S05

### 1. No integrated M061 verifier exists yet
There is no `scripts/verify-m061.ts` or `scripts/verify-m061-s05.ts` in the repo. S05 needs one milestone/slice-level proof entrypoint.

### 2. No pinned final regression gate exists for the token-efficiency track
There is no script that runs the exact mention/review/retrieval/reporting suites required to prove “lower spend without regression.”

### 3. `package.json` wiring is incomplete
Current scripts expose `verify:m061:s01` and `verify:m061:s02`, but not S03/S04. S05 should correct that while adding its own entrypoint(s).

### 4. Live-proof vs fail-open-proof must be handled explicitly
Current environment limitations from S03/S04 showed Postgres may be unreachable. S05 must preserve the same contract:
- if DB is reachable, integrated proof should evaluate real telemetry,
- if DB is not reachable, the proof must **say so explicitly** and still run the regression gate / local suites.

## Recommended design

### A. Build one integrated canonical verifier script
**Primary file:** `scripts/verify-m061-s05.ts`

Recommended shape:
- parse `--repo`, `--since`, `--json`
- use `queryUsageReportWithTimeout()` directly
- evaluate these categories:
  1. **preflight** — Postgres reachable or explicit fail-open state
  2. **baseline coverage present** — equivalent to S01 task-path/delivery/prompt-section visibility
  3. **mention reduction proof present** — mention.response rows show fine-grained context + canonical user prompt (S02)
  4. **review compaction proof present** — review.full rows show named sections + truncation evidence + delivery attribution (S03)
  5. **reuse proof present** — retrieval/mention/review reuse evidence rows with truthful states (S04)
  6. **integrated token signal present** — canonical telemetry shows token reduction characteristics on representative paths

For the integrated token signal, prefer **relative/operator-truthful checks**, not hardcoded historical token numbers. The usage-report shape already supports checks like:
- `mention.response` delivery rows should show smaller `promptEstimatedTokens` than `review.full` deliveries in mixed representative telemetry.
- mention deliveries should usually carry fewer prompt sections than review.full deliveries.
- review.full prompt-section totals should be attributable across named sections rather than one coarse row.
- reuse evidence should show non-zero `reusedUnits` / hit executions where representative retries or duplicate-query paths exist.

Avoid magic absolute thresholds unless planner finds an already-documented baseline contract.

### B. Compose, don’t duplicate, slice proof logic where practical
If implementation stays simple, S05 should import and reuse:
- `evaluateM061S02MentionContextProof`
- `evaluateM061S03ReviewSectionProof`
- `evaluateM061S04Proof`
- optionally `evaluateM061S01BaselineProof`

That gives two advantages:
- S05 becomes a true integration proof instead of a parallel restatement.
- Existing slice tests keep protecting the milestone proof surface indirectly.

### C. Build a separate pinned regression gate script
**Primary file:** `scripts/phase-m061-token-regression-gate.ts` or `scripts/verify-m061-s05-regression.ts`

Use the `phase80-slack-regression-gate.ts` pattern.

Pin the suites already named by slice summaries and current code seams. Minimal credible set:
- `src/execution/mention-context.test.ts`
- `src/execution/mention-prompt.test.ts`
- `src/handlers/mention.test.ts`
- `src/execution/review-prompt.test.ts`
- `src/handlers/review.test.ts`
- `src/knowledge/retrieval.test.ts`
- `src/knowledge/retrieval.e2e.test.ts`
- `src/knowledge/multi-query-retrieval.test.ts`
- `scripts/usage-report.test.ts`
- `scripts/verify-m061-s01.test.ts`
- `scripts/verify-m061-s02.test.ts`
- `scripts/verify-m061-s03.test.ts`
- `scripts/verify-m061-s04.test.ts`

This is the cleanest way to satisfy **R069-style regression protection** without bloating the integrated verifier itself.

### D. Update package scripts with the full operator surface
`package.json` should add at least:
- `verify:m061:s03`
- `verify:m061:s04`
- `verify:m061:s05`
- one regression-gate alias for the pinned suite runner

This is operator-facing proof surface work, not optional polish.

## Natural task seams

### Task seam 1 — integrated proof evaluator
Files:
- `scripts/verify-m061-s05.ts` (new)
- maybe `scripts/verify-m061-s05.test.ts` (new)
- maybe light updates to `scripts/usage-report.ts` only if S05 needs one extra derived aggregate

Why first:
- It defines the final acceptance surface.
- Planner can lock the integrated criteria before wiring scripts/tests.

### Task seam 2 — regression gate runner
Files:
- `scripts/<m061 regression gate>.ts` (new)
- `scripts/<m061 regression gate>.test.ts` (new)

Why independent:
- Pure orchestration over pinned commands.
- Can be built/tested without DB access.

### Task seam 3 — package/operator wiring
Files:
- `package.json`
- possibly docs/runbook references if planner finds any existing M061 smoke docs

Why last:
- Depends on final script names.

## Verification plan

### Contract/unit verification
Run the direct script tests first:
- `bun test scripts/usage-report.test.ts scripts/verify-m061-s01.test.ts scripts/verify-m061-s02.test.ts scripts/verify-m061-s03.test.ts scripts/verify-m061-s04.test.ts`
- plus new S05 verifier/regression-gate tests.

### Target subsystem regression
Run the pinned suites from the new regression gate, likely equivalent to:
- `bun test src/execution/mention-context.test.ts src/execution/mention-prompt.test.ts src/handlers/mention.test.ts`
- `bun test src/execution/review-prompt.test.ts src/handlers/review.test.ts`
- `bun test src/knowledge/retrieval.test.ts src/knowledge/retrieval.e2e.test.ts src/knowledge/multi-query-retrieval.test.ts`

### Smoke verification
- `bun scripts/verify-m061-s05.ts --json`
- new regression gate script
- `bun run lint`

If Postgres is unavailable, the integrated verifier should still exit with explicit `databaseAccess: missing|unavailable` preflight output rather than hanging; the regression gate should still provide meaningful pass/fail coverage.

## Risks / planner watchouts

- **Do not hardcode “token reduction” to a specific numeric threshold** unless you find a committed baseline artifact. The current canonical data model is better suited to truthful relative/structural checks than synthetic absolute promises.
- **Do not add a second query path** for S05. Reuse `queryUsageReportWithTimeout()`.
- **Do not mix live-telemetry proof with test execution in one opaque script**; keep verifier and regression gate separate so fail-open DB behavior does not hide test failures.
- **Do not forget explicit script wiring**. S03/S04 already exist but are not exposed in `package.json`.
- **Be careful with Bun CLI entrypoints**. S02 recorded a harness-specific hang for some direct `bun run` entrypoints, while exported CLI helpers and tests were reliable. Prefer the established `run*Cli` pattern and bounded DB timeouts.

## Recommendation

Build S05 as **two small scripts plus wiring**, not as more runtime telemetry work:
1. `scripts/verify-m061-s05.ts` — milestone-integrated canonical proof, composed from existing usage-report/S01-S04 seams, fail-open on DB access.
2. `scripts/<m061 regression gate>.ts` — pinned suite runner protecting mention/review/retrieval/reporting behavior.
3. `package.json` aliases for S03/S04/S05 and the regression gate.

That is the shortest path to a repeatable operator proof surface that satisfies the slice title and uses the seams already established by S01-S04.
