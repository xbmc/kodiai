# M048 S03 Research — Truthful Bounded Reviews and Synchronize Continuity

**Date:** 2026-04-12
**Status:** Research complete for planning.

## Requirements focus

- **Owns R049 directly.** This slice is the product-contract work for truthful bounded review behavior and synchronize continuity.
- **Must preserve R034.** Do not add latency/cost overhead on the normal small-PR path just to improve the large/high-risk path.
- **Must preserve R043 / R044.** Explicit mention review execution/publication and operator evidence surfaces must remain intact while bounded-review disclosure changes are added.
- The two candidate requirements from milestone context should be treated as **slice-level acceptance criteria**, not as background assumptions:
  - **Synchronize-trigger continuity:** if a repo intends synchronize-triggered reviews, the effective config must actually enable them or the verifier must fail loudly.
  - **Explicit strict-vs-bounded behavior:** if a strict review is still bounded for latency reasons, the GitHub-visible surface must say so clearly.
- S01/S02 timing surfaces are now table stakes. S03 should **reuse** them, not invent a parallel evidence path.

## Skill discovery (suggest only; not installed)

Directly relevant technologies for this slice are GitHub webhook review triggers and Zod-backed config parsing.

- **GitHub webhooks**
  - Installed skills: none directly targeted at webhook contract design.
  - Promising external skill: `hookdeck/webhook-skills@github-webhooks` — 68 installs
  - Install: `npx skills add hookdeck/webhook-skills@github-webhooks`
- **Zod**
  - Promising external skill: `pproenca/dot-skills@zod` — 1.1K installs
  - Install: `npx skills add pproenca/dot-skills@zod`

I would not install either by default for this slice. The work is mostly repo-local, but those are the two strongest matches if deeper webhook or schema design guidance is needed.

## Scope framing

This slice is **not** new infrastructure work. It is a targeted product-contract slice across three seams:

1. **config intent vs effective runtime behavior**
2. **bounded-review decisioning in the handler**
3. **truthful GitHub/operator disclosure**

Per the `writing-plans` skill, the natural decomposition is by **file responsibility**, not by technical layer. The clean split here is:

- config/parser continuity,
- runtime bounded-execution contract,
- surface rendering + summary disclosure,
- verifier/live-proof plumbing.

## What exists today

### 1. Synchronize webhook handling is already wired end-to-end

`src/handlers/review.ts` already registers `pull_request.synchronize`, and `src/lib/review-utils.ts` already supports `isReviewTriggerEnabled("synchronize", ...)`.

So the webhook lane itself is **not** missing. The deciding gate is repo config.

Relevant files:

- `src/handlers/review.ts`
- `src/lib/review-utils.ts`

### 2. The checked-in repo config intends synchronize reruns, but the effective parsed config disables them

The checked-in `.kodiai.yml` currently contains:

```yml
review:
  profile: strict
  onSynchronize: true
```

But `src/execution/config.ts` expects:

```ts
review.triggers.onSynchronize
```

`reviewSchema` is a normal `z.object(...)`. Per current Zod behavior, unknown object keys are **stripped by default**, not rejected. That means the legacy-looking top-level `review.onSynchronize` key is silently ignored.

I reproduced this against the live repo config:

```bash
bun -e 'import { loadRepoConfig } from "./src/execution/config.ts"; import { isReviewTriggerEnabled } from "./src/lib/review-utils.ts"; const {config,warnings}=await loadRepoConfig(process.cwd()); console.log(JSON.stringify({warnings, triggers:config.review.triggers, synchronizeEnabled:isReviewTriggerEnabled("synchronize", config.review.triggers)}, null, 2));'
```

Observed result:

```json
{
  "warnings": [],
  "triggers": {
    "onOpened": true,
    "onReadyForReview": true,
    "onReviewRequested": true,
    "onSynchronize": false
  },
  "synchronizeEnabled": false
}
```

That is the root continuity bug: **the repo appears configured for synchronize reviews, but the effective runtime config is false-green with no warning**.

Relevant files:

- `.kodiai.yml`
- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/handlers/review.ts`
- `src/lib/review-utils.ts`

### 3. Large-PR boundedness already exists today, even under explicit `strict`

`src/lib/file-risk-scorer.ts` triages any PR above `largePR.fileThreshold` into:

- `fullReviewCount` files at full depth
- `abbreviatedCount` files at critical/major-only depth
- the rest as `mentionOnly`

This runs in `src/handlers/review.ts` **before** prompt build and independently of manual profile choice. `review.profile: strict` does **not** disable large-PR triage.

I reproduced the current repo’s effective large-PR split with its checked-in `review.profile: strict`:

```bash
bun -e 'import { loadRepoConfig } from "./src/execution/config.ts"; import { triageFilesByRisk } from "./src/lib/file-risk-scorer.ts"; const {config}=await loadRepoConfig(process.cwd()); const scores=Array.from({length:80}, (_,i)=>({filePath:`f${i}.ts`,score:80-i,breakdown:{linesChanged:0,pathRisk:0,fileCategory:0,languageRisk:0,fileExtension:0}})); const triage=triageFilesByRisk({riskScores:scores,fileThreshold:config.largePR.fileThreshold,fullReviewCount:config.largePR.fullReviewCount,abbreviatedCount:config.largePR.abbreviatedCount,totalFileCount:80}); console.log(JSON.stringify({manualProfile:config.review.profile,largePR:config.largePR,triage:{isLargePR:triage.isLargePR,full:triage.full.length,abbreviated:triage.abbreviated.length,mentionOnly:triage.mentionOnly.length}}, null, 2));'
```

Observed result:

```json
{
  "manualProfile": "strict",
  "largePR": {
    "fileThreshold": 50,
    "fullReviewCount": 30,
    "abbreviatedCount": 20,
    "riskWeights": {
      "linesChanged": 0.3,
      "pathRisk": 0.3,
      "fileCategory": 0.2,
      "languageRisk": 0.1,
      "fileExtension": 0.1
    }
  },
  "triage": {
    "isLargePR": true,
    "full": 30,
    "abbreviated": 20,
    "mentionOnly": 30
  }
}
```

So a key product truth: **“strict” already does not mean exhaustive review on large PRs**. It already means “strict policy inside the reviewed subset.”

Relevant files:

- `src/lib/file-risk-scorer.ts`
- `src/lib/file-risk-scorer.test.ts`
- `src/handlers/review.ts`
- `src/execution/review-prompt.ts`
- `src/lib/review-utils.ts`

### 4. `timeout.autoReduceScope` is documented broadly, but implemented only for auto profile selection

`docs/configuration.md` says:

- `timeout.autoReduceScope` reduces review depth when approaching timeout.

But the handler applies this only when:

- timeout risk is high,
- `profileSelection.source === "auto"`, and
- `config.timeout.autoReduceScope !== false`.

For manual or keyword profile selection, the handler logs:

- `Skipping scope reduction: user explicitly configured profile`

I reproduced the core logic for a high-risk manual strict scenario:

```bash
bun -e 'import { resolveReviewProfile } from "./src/lib/auto-profile.ts"; import { estimateTimeoutRisk } from "./src/lib/timeout-estimator.ts"; const profile=resolveReviewProfile({keywordProfileOverride:null,manualProfile:"strict",linesChanged:2000}); const timeout=estimateTimeoutRisk({fileCount:80,linesChanged:2000,languageComplexity:0.8,isLargePR:true,baseTimeoutSeconds:600}); console.log(JSON.stringify({profile, timeout, scopeReductionWouldApply: timeout.shouldReduceScope && profile.source === "auto"}, null, 2));'
```

Observed result:

```json
{
  "profile": {
    "selectedProfile": "strict",
    "source": "manual",
    "autoBand": null,
    "linesChanged": 2000
  },
  "timeout": {
    "riskLevel": "high",
    "dynamicTimeoutSeconds": 684,
    "shouldReduceScope": true,
    "reducedFileCount": 50,
    "reasoning": "Complexity score: 0.64 (files: 80, lines: 2000, lang risk: 80%). Risk level: high. Dynamic timeout: 684s (base: 600s)."
  },
  "scopeReductionWouldApply": false
}
```

So there is a real contract drift:

- docs/config say scope reduction is an enabled timeout feature,
- runtime actually **skips it** for manual/keyword explicit profiles.

Relevant files:

- `src/lib/timeout-estimator.ts`
- `src/lib/auto-profile.ts`
- `src/handlers/review.ts`
- `docs/configuration.md`

### 5. Current GitHub surfaces are partly truthful, but still incomplete for bounded strict behavior

What is already truthful:

- `src/execution/review-prompt.ts` renders a **Large PR Triage** section, listing full-review files, abbreviated-review files, and omitted-file count.
- `src/lib/review-utils.ts` renders Review Details scope counts:
  - `Reviewed X/Y files`
  - full / abbreviated / not reviewed
  - expandable list of files not fully reviewed
- Timeout partial reviews and retry copy in `src/lib/partial-review-formatter.ts` are explicit.

What is still incomplete:

- **Auto-reduced** reviews show only the **effective** profile in Review Details; the surface does not say that Kodiai started from a different profile and reduced it for timeout risk.
- **Manual/keyword strict** large PRs already get bounded by triage, but the surface does not explicitly connect “requested strict” to “actual bounded file coverage.”
- The **summary comment template** has no bounded-execution disclosure instruction today. Any truthfulness here currently depends on the nested Review Details block being read.

Relevant files:

- `src/execution/review-prompt.ts`
- `src/lib/review-utils.ts`
- `src/lib/partial-review-formatter.ts`
- `src/handlers/review.ts`

### 6. There is already a proven pattern for exact-sentence disclosure and post-hoc summary enforcement

Search rate-limit degradation already solved a closely related truthfulness problem:

- `src/execution/review-prompt.ts` adds a dedicated section and instructs the model to include one exact sentence in `## What Changed`
- `src/lib/review-utils.ts` provides `ensureSearchRateLimitDisclosureInSummary(...)`
- `src/handlers/review.ts` injects the disclosure into the published summary if needed
- `src/handlers/review.test.ts` verifies the prompt contains the sentence and the final summary contains **exactly one** copy

This is the strongest existing pattern for S03 bounded-review disclosure.

Relevant files:

- `src/execution/review-prompt.ts`
- `src/lib/review-utils.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`

### 7. Existing audit utilities already have the right seam for live synchronize proof

Two existing contracts matter:

- `reviewOutputKey` encodes the action (`opened`, `review_requested`, `synchronize`, etc.) via `src/handlers/review-idempotency.ts`
- `src/review-audit/recent-review-sample.ts` already treats `synchronize` as an automatic review action

That means a new S03 live verifier does not need a new identity scheme. It can build on:

- `parseReviewOutputKey(...)`
- S01/S02 verifier composition
- existing GitHub review artifact discovery / audit utilities

Relevant files:

- `src/handlers/review-idempotency.ts`
- `src/review-audit/recent-review-sample.ts`
- `scripts/verify-m048-s01.ts`
- `scripts/verify-m048-s02.ts`

## Key findings and surprises

1. **The current repo is silently misconfigured for synchronize reviews.**
   - Intent appears enabled in `.kodiai.yml`.
   - Effective parsed config disables it.
   - No warnings are emitted today.

2. **`strict` already means bounded review on large PRs.**
   - Large-PR triage is profile-independent.
   - The repo’s current `review.profile: strict` does not preserve exhaustive coverage once file count crosses the large-PR threshold.

3. **The main S03 decision is product-contract, not parser-only.**
   - If S03 allows high-risk explicit strict reviews to be bounded further, Kodiai must expose both the **requested** and **effective** behavior.
   - Otherwise the surface will become more misleading, not less.

4. **`timeout.autoReduceScope` has documentation drift today.**
   - Planner should decide whether to align docs to reality or reality to docs.
   - M048 context strongly points toward aligning runtime behavior to the truthful bounded-execution contract rather than preserving the current manual-profile carveout as an invisible exception.

## File-level implementation landscape

### `.kodiai.yml`

- Current repo-local misconfiguration.
- Should almost certainly be changed from legacy-looking `review.onSynchronize: true` to `review.triggers.onSynchronize: true`.
- This is the cheapest direct continuity fix for xbmc/kodiai live proof loops.

### `src/execution/config.ts`

Best seam for **config intent vs effective state** handling.

What it does now:

- defines `review.triggers.onSynchronize`
- strips unknown object keys silently
- returns section warnings only for validation failures, not unknown-key drift

What S03 likely needs here:

- explicit legacy-key detection for `review.onSynchronize`
- warning or preflight signal when raw config expresses synchronize intent but parsed effective config is false
- possibly a helper the verifier can call directly instead of duplicating raw-YAML inspection

### `src/execution/config.test.ts`

Natural place for regression coverage of:

- legacy `review.onSynchronize` drift detection
- correctly nested `review.triggers.onSynchronize: true`
- ensuring the parser/verifier no longer false-greens the current repo shape

### `src/handlers/review.ts`

This is the slice’s main orchestration seam.

It already owns:

- trigger gating
- large-PR triage
- profile resolution
- timeout estimation and optional scope reduction
- prompt build
- Review Details publication
- summary update path

If S03 changes bounded behavior, this file must own the single source of truth for:

- requested profile/source
- effective profile/source
- triage-bounded file coverage
- timeout-driven scope reduction or explicit-profile skip
- whether the summary/disclosure injection should run

### `src/lib/review-utils.ts`

Best place for user-facing display helpers.

It already owns:

- Review Details formatting
- search-rate-limit summary injection helper
- profile line rendering
- scope count rendering

Natural S03 addition here:

- one small bounded-execution rendering helper / contract type
- Review Details lines for requested vs effective behavior
- exact-sentence summary injection helper, analogous to search-rate-limit degradation

### `src/lib/review-utils.test.ts`

Current gap: there is **no** test coverage for large-PR scope lines or requested-vs-effective bounded disclosure.

This should become the unit-level contract test bed for the new Review Details wording.

### `src/execution/review-prompt.ts`

Best place to add a bounded-execution section because it already owns:

- large PR triage instructions
- exact-sentence disclosure pattern for degraded search-rate-limit behavior
- summary-comment template rules

Natural S03 addition:

- one bounded-review section that tells the model exactly what to disclose in `## What Changed` when the review is bounded

### `src/execution/review-prompt.test.ts`

Current gap: no test covers large-PR triage wording or bounded-execution disclosure sections.

This file already has the right style for exact-sentence disclosure tests.

### `scripts/verify-m048-s03.ts` (new)

Most likely needed.

Best shape:

- **config preflight** mode: fail if the repo appears to intend synchronize reruns but effective parsed config leaves `onSynchronize=false`
- **surface contract** mode: verify prompt/details/summary disclosure fixtures for bounded strict behavior
- **optional live mode**: given a `reviewOutputKey`, require that it decodes to `action=synchronize` and compose S01/S02 evidence

### `scripts/verify-m048-s03.test.ts` (new)

Should cover:

- arg parsing
- empty env-backed arguments if a live mode is added
- config-drift failure states
- fixture truthfulness states for bounded disclosure
- non-synchronize review-output-key rejection

### `package.json`

Needs a `verify:m048:s03` script if the verifier is added.

### `docs/configuration.md`

Should be updated if runtime semantics change.

Current drift to fix or clarify:

- the effective synchronize trigger shape (`review.triggers.onSynchronize`)
- whether `timeout.autoReduceScope` can bound explicit strict/keyword strict reviews
- what “strict” actually means on large PRs once triage applies

## Recommended seam/task order

### 1. Config continuity first

Do this before any product-surface work.

Goals:

- fix the checked-in `.kodiai.yml` to nested trigger shape
- stop silent false-green behavior for `review.onSynchronize`
- add regression coverage, because the current codebase has no test for this drift class

Why first:

- it unblocks the live proof loop immediately
- it is the cheapest high-confidence win in the slice
- it retires the known current repo regression

### 2. Define one bounded-execution contract object second

Do **not** spread this logic across prompt/details/summary directly.

Build one small contract object in or near `src/handlers/review.ts` that captures:

- requested profile and source
- effective profile and source
- whether large-PR triage reduced file coverage
- whether timeout estimation reduced scope
- whether timeout reduction was skipped because the request was explicit
- one or more human-facing disclosure lines / reason codes

Why second:

- it prevents prompt/details/summary drift
- it gives the verifier one contract to assert against
- it follows the `writing-plans` skill rule to lock file boundaries before task decomposition

### 3. Surface plumbing third

Once the bounded-execution contract exists, thread it into:

- `src/execution/review-prompt.ts`
- `src/lib/review-utils.ts`
- `src/handlers/review.ts` summary-append path

Recommended pattern:

- prompt section instructs the exact sentence when disclosure is required
- Review Details renders the same contract more explicitly
- handler injects the exact sentence post-hoc if the model omits it, mirroring search-rate-limit degradation

Important constraint:

- keep the small-PR path clean; no new disclosure noise on cases that are not actually bounded

### 4. Verifier last

After the runtime/surfaces are in place, add the operator proof command.

Recommended minimum contract:

- local config preflight
- fixture truthfulness report for bounded strict behavior
- optional live review-output-key mode for synchronize proof

## Recommended product stance

If the planner has discretion, I recommend this contract:

- **Explicit `strict`/keyword strict may still be bounded when latency risk is high.**
- **GitHub-visible output must say both the requested strictness and the actual bounded scope/reason.**

Why this is the least surprising path:

- the system already bounds strict reviews on large PRs via triage
- the user asked for truthful faster reviews, not fake exhaustiveness
- adding a new config knob would likely create another drift seam and more operator confusion than value

If this stance is rejected, S03 should still ship:

- synchronize continuity fix + verifier
- explicit disclosure that large-PR triage already bounds strict reviews

But that is the weaker M048 outcome.

## Verification

### Code/test contract

Recommended verification command set after implementation:

```bash
bun test src/execution/config.test.ts src/lib/review-utils.test.ts src/execution/review-prompt.test.ts src/handlers/review.test.ts scripts/verify-m048-s03.test.ts
bun run tsc --noEmit
```

### Assertions that should exist by the end of the slice

- legacy `review.onSynchronize: true` no longer passes silently
- correctly nested `review.triggers.onSynchronize: true` enables `isReviewTriggerEnabled("synchronize", ...)`
- manual/keyword strict high-risk scenarios emit explicit bounded-review disclosure on Review Details
- published summary receives exactly one bounded-disclosure sentence when required
- small PRs do **not** get spurious bounded-execution disclosure
- verifier rejects non-synchronize `reviewOutputKey` inputs in live mode

### Operational/live proof after deploy

After deployment, the operator proof path should be:

1. push a new commit to a PR with corrected `.kodiai.yml`
2. capture the resulting `reviewOutputKey`
3. run:

```bash
bun run verify:m048:s03 -- --review-output-key <key> --json
```

Expected proof shape:

- parsed action is `synchronize`
- embedded S01/S02 evidence still passes or remains truthful about unavailable live data
- GitHub-visible summary / Review Details contain the bounded-disclosure contract when applicable

## Existing gaps the planner should not rediscover

- There are currently **no `src/handlers/review.test.ts` cases for `pull_request.synchronize`**.
- There are currently **no `src/execution/config.test.ts` cases for legacy top-level `review.onSynchronize` drift**.
- There are currently **no `src/lib/review-utils.test.ts` cases covering large-PR scope or requested-vs-effective bounded disclosure**.
- There are currently **no `src/execution/review-prompt.test.ts` cases for large-PR triage or bounded-review disclosure wording**.
- The repo docs show the correct nested trigger shape, but the checked-in `.kodiai.yml` is wrong.

## Sources / concrete evidence

- `.kodiai.yml`
- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/handlers/review.ts`
- `src/lib/review-utils.ts`
- `src/lib/review-utils.test.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/lib/file-risk-scorer.ts`
- `src/lib/file-risk-scorer.test.ts`
- `src/lib/timeout-estimator.ts`
- `src/lib/auto-profile.ts`
- `src/handlers/review-idempotency.ts`
- `src/review-audit/recent-review-sample.ts`
- `scripts/verify-m048-s01.ts`
- `scripts/verify-m048-s02.ts`
- `docs/configuration.md`
- Context7 `/colinhacks/zod` docs on object-schema unknown-key handling (default strip behavior, `strictObject` / `.strict()` for rejection)
