# M044 Research — Audit Recent XBMC Review Correctness

## Executive Summary

The strongest existing seam for M044 is already in the shipped review markers, not in GitHub search text or ad-hoc log spelunking. `src/handlers/review-idempotency.ts` builds a visible `reviewOutputKey` marker that is embedded into reviews/comments on GitHub and already encodes the repo, PR number, action, delivery ID, and head SHA. That means the audit does **not** need to rediscover delivery identity from GitHub deliveries first; it can start from real GitHub-visible Kodiai artifacts, extract `reviewOutputKey`, then correlate inward to DB/log evidence.

The big asymmetry is lane durability:

- **Automatic review lane** (`src/handlers/review.ts`) has stronger durable internal evidence because it records `reviews` and `findings` rows in Postgres (`src/knowledge/store.ts`, `src/db/migrations/001-initial-schema.sql`).
- **Explicit `@kodiai review` lane** (`src/handlers/mention.ts`) has the clearest terminal publish states (`approval-bridge`, `idempotency-skip`, `duplicate-suppressed`, `publish-failure-fallback`, `publish-failure-comment-failed`), but those states currently live in logs/runbooks, not a durable DB table.

That asymmetry should shape slice order. The first thing to prove is not a production fix; it is whether recent GitHub-visible review markers can be deterministically sampled and correlated far enough inward to classify both lanes truthfully. If that correlation is weak for explicit mentions because log-only evidence is too transient, the likely M044 repair is observability/persistence hardening rather than review-generation logic.

## What Exists Today

### 1) The authoritative public correlation key already exists on GitHub

`src/handlers/review-idempotency.ts` provides the core audit identity contract:

- `buildReviewOutputKey(...)` generates a versioned key containing:
  - installation ID
  - owner/repo
  - PR number
  - action
  - delivery ID
  - head SHA
- `buildReviewOutputMarker(reviewOutputKey)` emits `<!-- kodiai:review-output-key:... -->`
- `ensureReviewOutputNotPublished(...)` defines the authoritative GitHub output surfaces by scanning:
  - PR review comments
  - issue/PR top-level comments
  - PR reviews

This is the key finding for M044: the audit can reuse the exact same surface contract the runtime already treats as authoritative instead of inventing a separate heuristic.

### 2) Automatic review lane already distinguishes clean reviews from published findings

`src/handlers/review.ts` has the important automatic-lane behavior already pinned in code/tests:

- Review Details are published even when execution reports `published: false`.
- If a summary comment exists, Review Details are appended into it.
- If no summary exists, Review Details are posted standalone.
- If no issues were found and no output marker already exists, the handler submits a silent approval.
- Evidence-bundle logs distinguish:
  - `outcome=published-output`
  - `outcome=submitted-approval`

`src/handlers/review.test.ts` explicitly covers the “`published: false` but Review Details still published” contract, which means approval + Review Details is a legitimate clean-review shape on the automatic lane and must not be treated as failure by default.

### 3) Explicit mention review lane already has richer terminal publish states

`src/handlers/mention.ts` contains the repaired M043 explicit bridge:

- Runs explicit `@kodiai review` as `taskType="review.full"`
- Reuses `reviewOutputKey`
- Performs idempotency scan before approval publish
- Emits terminal `publishResolution` values:
  - `approval-bridge`
  - `idempotency-skip`
  - `duplicate-suppressed`
  - `publish-failure-fallback`
  - `publish-failure-comment-failed`

`src/handlers/mention.test.ts` pins all of those branches. This gives M044 a reliable explicit-lane truth source **if** the audit can still access the logs that carry it.

### 4) Automatic-lane internal durability is better than explicit-lane durability

`src/knowledge/store.ts` records automatic review executions into durable tables:

- `reviews` rows store repo, PR number, delivery ID, finding totals, conclusion
- `findings` rows store comment metadata and `review_output_key`

This means an automatic review that internally found issues but failed to publish them can still leave durable evidence in Postgres.

That same durability does **not** exist for explicit mention reviews. `src/handlers/mention.ts` records generic telemetry, but it does **not** persist `publishResolution` or `reviewOutputKey` into a durable execution table.

### 5) Telemetry is useful, but insufficient by itself

`src/telemetry/types.ts` / `src/telemetry/store.ts` persist:

- `telemetry_events` with `delivery_id`, `repo`, `pr_number`, `event_type`, `conclusion`
- `rate_limit_events`
- `resilience_events` (including `review_output_key`, but only for timeout/retry paths)

That helps with time-windowing and delivery existence, but it does **not** durably capture the fields M044 most needs across both lanes:

- `reviewOutputKey`
- `reviewOutputPublicationState`
- `publishResolution`
- `executorPublished` vs final published outcome

So telemetry can support the audit, but cannot replace GitHub markers + DB findings + Azure log evidence.

### 6) The repo already has the verifier/script patterns M044 should reuse

There are strong existing implementation patterns for a repeatable audit verifier:

- `scripts/retriever-verify.ts` — small CLI with `--json` plus human-readable output
- `scripts/phase74-reliability-regression-gate.ts` — live verifier shape with explicit usage/help text, stable checks, and shelling out to `gh`
- `scripts/phase75-live-ops-verification-closure.ts` — operator-driven verifier that preserves exact identities and blocks on ambiguous evidence
- `scripts/backfill-pr-evidence.ts` — reusable GitHub App bootstrap (`createGitHubApp`, `getRepoInstallationContext`, `getInstallationOctokit`) for repo-scoped live data collection

M044 does **not** need a brand-new verifier style.

## Critical Findings and Surprises

### The review marker is more valuable than the current runbooks make explicit

Because `reviewOutputKey` is visible on GitHub and already embeds `deliveryId` and `action`, the audit can work in the right direction:

1. Start from GitHub-visible Kodiai output.
2. Extract `reviewOutputKey`.
3. Parse lane + delivery identity from it.
4. Correlate to DB/log evidence.

That is much better than starting from deliveries and manually guessing which PR/output they correspond to.

### There is no shared parser for `reviewOutputKey`

The codebase has builders and marker scanners, but no first-class `parseReviewOutputKey(...)` helper. Existing code mostly treats the marker as an opaque string or strips it with regex (`src/execution/mention-context.ts`, `src/lib/review-utils.ts`).

That is a natural seam for M044. Without a shared parser, the verifier will end up duplicating versioned key knowledge in ad-hoc regex code.

### Retry output keys are a hidden audit wrinkle

`src/handlers/review.ts` creates retry keys by appending `-retry-1` to the base `reviewOutputKey` string. That means the GitHub-visible marker can represent either:

- a base execution key
- or a retry-suffixed key

A parser/helper for M044 should normalize this explicitly and return:

- base key
- optional retry attempt number
- base delivery ID
- derived retry delivery ID when applicable

Otherwise the audit can mis-correlate retry-published output.

### Automatic lane has weaker terminal publication semantics than explicit mention lane

Explicit mentions already have named publish-resolution outcomes.
Automatic reviews do not. In `src/handlers/review.ts`, the auto lane currently has:

- evidence bundles for `published-output` and `submitted-approval`
- warning/error logs for Review Details append/publication failure or approval failure
- no explicit terminal `publishResolution` enum comparable to the mention lane
- no fallback comment when silent approval submission fails

That asymmetry is likely to matter if S01 uncovers suspicious automatic approvals or silent publication failures.

### The runbooks are richer for explicit mentions than for automatic review auditing

`docs/runbooks/review-requested-debug.md` is strong on the explicit `@kodiai review` bridge and delivery/log correlation. It is much less explicit about a repeatable, PR-sampled audit of recent automatic reviews. M044 will likely need to extend docs in that direction even if no product bug is found.

## What Should Be Proven First

### First proof: deterministic sample selection from GitHub-visible artifacts

Before touching production logic, prove that the audit can pick a recent sample without manual archaeology.

Best candidate rule:

1. List recent PRs for `xbmc/xbmc` in descending updated order.
2. For each PR, scan the same three authoritative GitHub surfaces already used by idempotency:
   - reviews
   - issue comments
   - review comments
3. Extract every `reviewOutputKey` / Review Details marker found in Kodiai-authored bodies.
4. Collapse to the **latest Kodiai review artifact per PR**.
5. Parse lane from the key action:
   - `mention-review` => explicit lane
   - `opened`, `ready_for_review`, `review_requested`, `synchronize` => automatic lane

If this step is shaky, the rest of the milestone is shaky.

### Second proof: lane-balanced sample coverage

A naive “latest 12 PRs overall” rule can easily starve the explicit lane. Because milestone acceptance explicitly cares about both automatic and explicit `@kodiai review`, I recommend a deterministic **lane-stratified** rule instead:

- up to 6 most recent distinct PRs from the automatic lane
- up to 6 most recent distinct PRs from the explicit lane
- if one lane has fewer than 6, fill remaining slots from the other lane by recency and report the lane counts truthfully

This is the smallest deterministic rule that actually protects milestone intent.

### Third proof: per-lane correlation depth

Once the sample exists, prove that each sample PR can be correlated inward far enough to produce one of the required verdict classes:

- `clean-valid`
- `findings-published`
- `publish-failure`
- `suspicious-approval`
- `indeterminate`

If explicit mention cases cannot be classified because logs are missing or expired, that is likely the first real architecture gap M044 exposes.

## Recommended Slice Boundaries

### Slice S01 — Sample selection and evidence correlation

Goal: prove the audit can select and classify a recent cross-lane sample read-only.

Likely deliverables:

- shared parser/helper for `reviewOutputKey` (+ retry suffix normalization)
- GitHub collector reusing the existing authoritative surfaces
- lane-stratified sample selector
- evidence correlator that assembles per-PR GitHub-visible and internal evidence
- first manual/semiautomated audit report over the recent sample

Risk retired by S01:

- whether M044 is fundamentally feasible with current durable surfaces
- whether both lanes can be audited without guesswork
- whether explicit mention evidence is durable enough for a repeatable recent-window audit

### Slice S02 — Audit-driven publication/correctness repair

Goal: fix the actual defect the audit exposes.

This slice should stay conditional on S01’s findings. The most plausible repair targets from current code are:

- missing durable persistence for explicit-lane publication truth
- lack of automatic-lane terminal publication state / fallback visibility
- incorrect clean-vs-findings classification logic if the audit uncovers wrong approvals
- parser/scanner drift if GitHub-visible markers cannot be normalized robustly

If S01 finds no product bug, S02 can shrink to observability hardening only.

### Slice S03 — Repeatable verifier and runbook

Goal: package the audited logic into a repeatable operator surface.

Likely deliverables:

- `bun run verify:m044[:...]` style CLI
- human-readable summary + `--json`
- stable per-check / per-PR status codes
- explicit preflight reporting for missing GitHub/DB/Azure access
- runbook section documenting the command, prerequisites, and verdict meanings

This slice should come **after** S01 proves the evidence model and after any S02 repair stabilizes the truth contract.

## Boundary Contracts That Matter

### 1) GitHub surface contract

The audit should reuse the same surface contract runtime idempotency already trusts:

- PR reviews
- issue/PR comments
- review comments

Do not add heuristic-only surfaces just because they are convenient.

### 2) Review output key contract

The audit needs a real parser for the shipped key format, including:

- version
- installation ID
- owner/repo
- PR number
- action
- delivery ID
- head SHA
- optional retry suffix

The parser should validate that parsed repo/PR match the GitHub object being inspected.

### 3) Lane-specific internal evidence contract

The verifier should not collapse both lanes into one generic backend lookup.

Recommended split:

- **Automatic lane evidence resolver**
  - GitHub-visible markers/surfaces
  - `reviews` / `findings` tables
  - `telemetry_events` / `resilience_events` when helpful
  - optional logs for publication-edge cases
- **Explicit mention lane evidence resolver**
  - GitHub-visible markers/surfaces
  - `telemetry_events` for delivery existence/time window
  - Azure/Kusto logs for `publishResolution` and idempotency signals

### 4) Classification contract

The classifier should take structured evidence and emit a single verdict plus rationale, not free-text operator prose.

It should preserve missing-source information explicitly so `indeterminate` is a first-class truthful outcome.

### 5) Verifier output contract

The repo’s existing verifiers suggest the right shape:

- human-readable output by default
- `--json` machine-readable output
- stable check IDs / status codes
- raw evidence preserved in JSON rather than discarded into prose

## Known Failure Modes That Should Shape Slice Ordering

### Clean approval + Review Details is valid on the automatic lane

Pinned in `src/handlers/review.ts` and `src/handlers/review.test.ts`.
This is the main false-positive risk. The audit must prove clean validity before it tries to hunt failures.

### `duplicate-suppressed` is recovery, not failure

Pinned in `src/handlers/mention.ts` / `src/handlers/mention.test.ts`.
If approval publish throws but output already landed, the explicit lane suppresses the fallback error comment. The audit must classify this as successful publication recovery, not as missing output.

### `publish-failure-fallback` is visible failure, not silent success

Also pinned in mention tests/runbook. This is the best known failure-shaped control case for the milestone because it cleanly distinguishes “publish failed but user was told so” from “clean approval”.

### Automatic lane can still fail publication more opaquely than explicit mention lane

In `src/handlers/review.ts`, silent approval submission failure is logged but not turned into an explicit terminal publish-resolution state or fallback comment. If the audit finds ambiguous automatic-lane cases, that asymmetry is the first place to look.

### Log retention / availability may be the real blocker for explicit-lane repeatability

Current explicit-lane truth is log-centric. If recent-dozen explicit reviews fall outside practical Kusto availability or access is inconsistent, S02 may need durable persistence rather than publication logic changes.

## Requirement Read-Through

### R045 is the right table-stakes requirement

`R045` already captures the core milestone need well:

- repeatable audit over recent Kodiai PR reviews
- ability to distinguish valid clean approvals from missing/unpublished findings
- use of GitHub-visible output plus internal publication evidence
- truthful indeterminate states

That is the correct core contract.

### What R045 does not say explicitly enough

These are the most important gaps in the requirement wording today:

1. **Deterministic cross-lane sample rule**
   - The current requirement says “recent sample” but not how to guarantee both lanes get represented when available.
2. **Per-PR raw evidence surface**
   - Operators will need more than a verdict string; they need `reviewOutputKey`, parsed delivery identity, lane, GitHub URLs, and which evidence sources were present/missing.
3. **Access/preflight truthfulness**
   - A rerunnable verifier needs to state whether GitHub App auth, DB access, and Azure log access are available before it pretends to classify anything.

### Candidate requirements worth considering

These should remain explicit candidate scope, not silently adopted:

- **Candidate requirement:** the verifier emits machine-readable per-PR evidence records containing parsed `reviewOutputKey`, lane, delivery identity, verdict, and source availability.
- **Candidate requirement:** the recent-dozen selector is lane-stratified when both lanes have qualifying PRs.
- **Candidate requirement:** missing GitHub/DB/Azure access produces explicit `indeterminate` / preflight failures rather than partial silent omission.

### What should stay out of scope

Still out of scope based on repo context and current milestone wording:

- automatic reposting or retriggering reviews
- repo-wide historical backfill beyond the recent sample
- always-on monitoring/alerting infrastructure
- redesign of review style/tone/approval policy without audit evidence

## Advisory Implementation Direction

If I were slicing this milestone, I would steer toward a verifier architecture like this:

1. **Shared key/parser layer**
   - parse marker bodies
   - normalize retry suffixes
   - map action -> lane
2. **GitHub collector**
   - uses `createGitHubApp(...)` and installation Octokit
   - scans the exact three authoritative surfaces
   - returns latest Kodiai artifact per PR
3. **Lane-specific evidence resolvers**
   - automatic lane: DB + GitHub
   - explicit lane: logs + GitHub
4. **Classifier**
   - structured evidence in, verdict/rationale out
5. **CLI/report wrapper**
   - default human output
   - `--json`
   - stable status codes
6. **Runbook**
   - env prerequisites
   - example command
   - meaning of each verdict

That keeps the hard logic reusable while isolating environment-specific IO.

## Skill Discovery

Directly relevant existing installed skill:

- **`gh`** — already installed in this environment; relevant for GitHub API/CLI operations if the verifier or runbook leans on `gh`.

Promising not-yet-installed skills for core M044 technologies:

- **Azure Kusto / Log Analytics**
  - Skill: `microsoft/azure-skills@azure-kusto`
  - Why relevant: explicit-lane audit truth currently depends on Kusto/Log Analytics queries over delivery ID / `reviewOutputKey`
  - Install: `npx skills add microsoft/azure-skills@azure-kusto`
  - Signal: very high install count from `npx skills find "azure log analytics"`
- **Azure Container Apps**
  - Skill: `microsoftdocs/agent-skills@azure-container-apps`
  - Why relevant: secondary but directly relevant to the production hosting/runtime side of the audit
  - Install: `npx skills add microsoftdocs/agent-skills@azure-container-apps`
  - Signal: lower install count than Azure Kusto, but more directly aligned than generic Azure deployment skills

I did **not** install any new skills.

## Planner Takeaways

- Prove sample selection and key correlation **before** assuming a code defect.
- Reuse `reviewOutputKey` as the primary identity seam; it is the best existing audit primitive in the codebase.
- Keep automatic and explicit lanes separate in the evidence model.
- Expect S02 to be observability/persistence work if explicit-lane truth is too log-dependent.
- Add a shared parser for `reviewOutputKey` early; it is the cleanest reusable primitive M044 can contribute.
- Favor a lane-stratified “recent dozen” rule so the milestone cannot accidentally certify only one lane.
