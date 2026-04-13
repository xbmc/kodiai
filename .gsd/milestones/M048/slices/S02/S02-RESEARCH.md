# M048 / S02 Research — Single-Worker Path Latency Reduction

**Date:** 2026-04-12  
**Status:** Targeted research complete for planning.

## Requirement targeting

- **R049** is the direct slice contract: make the real one-worker review path faster without faking completeness or silently changing what was reviewed.
- **R034** remains a continuity guardrail: do not buy latency wins by regressing small-PR cost/latency on the common path.
- **R043 / R044** remain table stakes: explicit mention review execution, publication reliability, and operator evidence surfaces must survive unchanged.
- **R050** is the inherited measurement surface from S01, not the primary requirement owned by S02. The six-phase timing contract is now the baseline proof surface that S02 must use rather than replace.
- The two candidate additions called out in milestone context are **not** the main S02 implementation targets:
  - **synchronize-trigger continuity** belongs with config/product continuity work in S03 unless S02 must touch it to unblock live proof.
  - **explicit strict-vs-bounded disclosure** is also a product-contract task for S03, not the first single-worker plumbing bet.

## Skill-informed constraints

- The installed **`azure-container-apps`** skill points at the right bias for this slice: prefer **cold-start/storage-path reductions**, keep large assets **close via storage mounts**, and keep proof on **Log Analytics/application instrumentation** rather than speculative topology changes.
- That aligns with the milestone’s measurement-first strategy: reduce fixed workspace / ACA / polling overhead first, then decide whether deeper architectural changes are warranted.

## Skill discovery (suggest only — do not install)

Directly relevant technologies without an already-installed dedicated skill:

- **Claude Agent SDK**
  - Suggested: `npx skills add jezweb/claude-skills@claude-agent-sdk`
  - Why: highest-install result found (**423 installs**); directly relevant to the remote agent runtime inside `agent-entrypoint.ts`.
- **Azure Files / Azure Storage File Share (TypeScript)**
  - Suggested: `npx skills add sickn33/antigravity-awesome-skills@azure-storage-file-share-ts`
  - Why: highest-install TS-specific result found (**51 installs**); directly relevant to the Azure Files-backed workspace path.
  - Lower-install but official-docs-backed alternative: `npx skills add microsoftdocs/agent-skills@azure-files` (**17 installs**).

## Summary recommendation

Plan S02 as **two cheap-win tasks plus live proof reuse**, not as a redesign slice.

1. **Reduce ACA polling tail latency first** in `src/jobs/aca-launcher.ts`.
   - This is the safest likely win.
   - The current fixed **10s** poll interval is buried in code, has no dedicated tests, and already has a **5s precedent** in `scripts/test-aca-job.ts`.
2. **Then reduce real executor handoff / repo staging overhead** in the existing one-worker path.
   - The main seam is the **bundle + materialize** path spanning `src/execution/executor.ts` and `src/execution/agent-entrypoint.ts`.
   - Keep the existing single-job publication/idempotency contract intact.
3. **Reuse the S01 six-phase proof surface** (`verify:m048:s01`, Review Details, Azure phase summary logs) rather than inventing a second latency store.

The slice should **not** fold in S03’s trigger/profile/product-contract work unless needed to unblock live verification.

## Implementation landscape

### `src/handlers/review.ts`

This remains the top-level review orchestrator and the owner of the public six-phase timing summary.

Relevant facts for S02:
- `workspace preparation` is timed around workspace creation, PR head/base fetches, and repo config load.
- `retrieval/context assembly` is timed before `executor.execute(...)`.
- The handler merges executor-returned phases into the six-phase public contract and logs one correlated `Review phase timing summary` payload.
- The public timing surface is now contractually fixed by S01; S02 should reduce real work **inside** these phases, not rename or reshuffle them.

### `src/execution/executor.ts`

This is the main S02 execution seam.

What it does now:
- Starts `executor handoff` timing **at the beginning of `execute()`**, before model resolution, prompt building, Azure workspace creation, repo staging, spec build, and job dispatch.
- Creates an Azure Files workspace directory.
- Calls `prepareAgentWorkspace(...)` to stage the repo snapshot plus prompt/config.
- Launches the ACA job, then calls `pollUntilComplete(...)`.
- Returns only two executor-owned phases: `executor handoff` and `remote runtime`.

Important consequence:
- **`executor handoff` is already the right “fixed overhead” bucket** for most S02 plumbing wins.
- Do **not** “improve” the metric by moving the timer boundary later; that would be surface cheating, not latency reduction.

### `prepareAgentWorkspace(...)` in `src/execution/executor.ts`

This is the most likely single-worker overhead hotspot.

Current behavior:
- If `sourceRepoDir` contains `.git` — which is true for normal PR review workspaces — it **always** writes `repo.bundle`.
- If the repo is shallow, it explicitly runs `git fetch --unshallow ...` first.
- It then runs `git bundle create <workspaceDir>/repo.bundle --all`.
- Non-git directories use a recursive copy path, but PR review workspaces do not take that path.

Key planning implication:
- **Every git-backed review currently pays bundle transport cost.**
- The tracked-symlink test is not a special case; the bundle path is the normal case for review executions.

### `src/execution/agent-entrypoint.ts`

This is the second half of the transport seam.

Current behavior:
- If `agent-config.json` contains `repoBundlePath`, `materializeRepoBundle(...)` does `git clone <bundle>` into a temp dir before SDK execution.
- The SDK then runs against that temp checkout, not directly against the shared Azure Files workspace.

Important surprise:
- This is **architectural drift from D015’s original “agent reads the shared workspace” rationale**.
- The executor comment still says `WORKSPACE_DIR` holds a full repo copy under `./repo`, but the implementation for git workspaces now stages a **bundle** and re-materializes it remotely instead.
- That drift is not automatically bad, but it is the clearest S02 optimization seam.

### `src/jobs/aca-launcher.ts`

This is the cheapest likely win.

Current behavior:
- `pollUntilComplete(...)` defaults to **`pollIntervalMs = 10_000`**.
- It has no config surface.
- There are **no focused unit tests** for poll cadence / retry behavior in `src/jobs/aca-launcher.test.ts`.
- `scripts/test-aca-job.ts` already uses **`pollIntervalMs: 5_000`** for its live smoke flow.

Planning implication:
- There is a ready-made low-risk latency improvement path here.
- The missing tests are the real blocker, not architecture.

### S01 proof / continuity files that should mostly stay stable

- `src/execution/types.ts`
- `src/review-audit/phase-timing-evidence.ts`
- `src/review-audit/log-analytics.ts`
- `scripts/verify-m048-s01.ts`
- `src/lib/review-utils.ts`

These now encode the stable six-phase contract. S02 should treat them as **continuity surfaces**, not primary optimization targets.

## Key findings and surprises

### 1. The six public phases are now a hard contract, not a suggestion

`src/execution/types.ts` and `src/review-audit/phase-timing-evidence.ts` enforce the exact six phase names/order:
- queue wait
- workspace preparation
- retrieval/context assembly
- executor handoff
- remote runtime
- publication

If S02 changes names/order or narrows phase boundaries just to make numbers look better, it will break S01 verifier assumptions and violate the truthful-latency goal.

### 2. `executor handoff` already includes most of the fixed single-worker overhead

Because `executorHandoffStartedAt` is captured at the start of `execute()`, this phase already includes:
- repo config/model resolution
- local CLAUDE policy write
- Azure Files workspace dir creation
- bundle/unshallow work
- job spec build
- ACA start call

That is useful: S02 can improve a single public phase without handler surgery.

### 3. Shallow bundles are not safe to use as-is

I ran a local simulation of a shallow single-branch clone and attempted to bundle it without unshallowing first. Cloning from that bundle failed with:
- `Could not read ...`
- `Failed to traverse parents of commit ...`
- `remote did not send all necessary objects`

So the current `fetch --unshallow` step in `prepareAgentWorkspace(...)` is a **correctness constraint**, not accidental bloat. Any S02 transport optimization must preserve this invariant.

### 4. But `--all` bundle cost scales badly with ref breadth

Local measurements on the current repo showed two very different cost envelopes:

- **Current full multi-ref checkout:**
  - `git bundle create --all`: **~12.2s**
  - bundle size: **~778.6MB**
  - clone from bundle: **~27.3s**
- **Simulated shallow single-branch clone after explicit `fetch --unshallow`:**
  - unshallow: **~1.1s**
  - `git bundle create --all`: **~0.5s**
  - bundle size: **~13.5MB**
  - clone from bundle: **~1.0s**

Interpretation:
- the full-checkout number is **not** the production PR-workspace baseline,
- but it proves `--all` can become very expensive when the local repo contains broader ref history,
- and it reinforces that S02 should avoid accidentally widening the ref set while optimizing.

### 5. There is likely duplicate depth work between handler diff recovery and executor bundling

The review path can currently do all of the following:
- clone depth 50 in `workspaceManager.create(...)`
- fetch base branch depth 1 in `review.ts`
- deepen / unshallow further in `collectDiffContext(...)` when merge-base is missing
- then check shallow status again in `prepareAgentWorkspace(...)` and potentially run another `fetch --unshallow`

This is the most plausible “hidden fixed overhead” beyond the 10s poll interval.

The planner should explicitly verify whether the repo is still shallow by the time executor staging begins on the real PR path, and whether the second unshallow is necessary in all cases.

### 6. `scripts/test-aca-job.ts` already contains a lower-latency polling precedent

The shipped live smoke script passes `pollIntervalMs: 5_000`, while production code still defaults to `10_000`.

That makes a first S02 change obvious and low-risk:
- either lower the default,
- or make the cadence adaptive,
- but in either case add tests first because the launcher currently has no dedicated polling coverage.

### 7. There is no dedicated automated “before vs after” latency comparer yet

`verify:m048:s01` verifies one review’s phase evidence and correlation. It does **not** compare two runs or enforce an improvement threshold.

That means S02 proof can be done in one of two ways:
- **minimal scope:** capture baseline and post-change JSON from `verify:m048:s01` and compare manually/operator-side,
- **slightly broader scope:** add a tiny compare helper or extend the verifier with a second review key.

I would keep the second option optional unless the planner wants a stricter acceptance artifact.

## Natural task seams

### Seam A — ACA polling tail reduction

**Primary files:**
- `src/jobs/aca-launcher.ts`
- `src/jobs/aca-launcher.test.ts`
- `scripts/test-aca-job.ts` (optional smoke alignment)

**Why this is a clean task:**
- isolated module,
- obvious latency lever,
- low publication/idempotency risk,
- currently under-tested so the work naturally bundles refactor + tests.

**What to prove:**
- lower/faster poll cadence still handles retries/timeouts/failures truthfully,
- no changes to the six-phase public contract,
- no Azure API thrash from an over-aggressive interval.

### Seam B — repo staging / bundle materialization overhead

**Primary files:**
- `src/execution/executor.ts`
- `src/execution/agent-entrypoint.ts`
- `src/execution/prepare-agent-workspace.test.ts`
- `src/execution/agent-entrypoint.test.ts`
- `src/execution/executor.test.ts`

**Why this is a clean task:**
- the handoff/runtime seam is already encapsulated in executor + entrypoint,
- the handler’s public phase contract can remain untouched,
- the transport contract already has focused tests for bundle validity, symlinks, and remote diff behavior.

**What to prove:**
- remote repo still supports the git operations the agent uses (`diff/log/show` and origin-based comparisons),
- tracked symlinks still survive,
- shallow-repo correctness does not regress,
- publication/idempotency behavior is unchanged.

### Seam C — live acceptance / operator proof reuse

**Primary files:**
- `scripts/verify-m048-s01.ts`
- `src/review-audit/phase-timing-evidence.ts`
- possibly a tiny new compare script if the planner wants strict automated delta proof

**Why this is separate:**
- the existing proof surface is already present,
- S02 can likely close with reuse rather than a new observability buildout.

## Constraints the planner should preserve

### Preserve the S01 evidence contract

- Keep the exact six public phases.
- Keep `reviewOutputKey` + `deliveryId` correlation.
- Keep Review Details / Azure verifier compatibility.

### Preserve D013 / D015 security intent

- The remote ACA job must still receive **zero application secrets** beyond the allowed agent auth inputs.
- If repo transport changes, do not regress the isolation model that moved execution off the orchestrator process.

### Preserve R043 / R044 publication behavior

- One execution request should still yield one canonical GitHub-visible outcome.
- Inline comment publication/idempotency helpers should not need redesign for S02.

### Do not smuggle S03 into S02

- `.kodiai.yml` trigger-shape fixes and explicit strict-vs-bounded disclosure remain valid milestone work, but they are not the cheapest S02 latency lever.
- Only touch them here if they are strictly necessary to obtain repeatable live proof.

## Verification plan

### Focused local regression

Run at least:

```bash
bun test ./src/jobs/aca-launcher.test.ts ./src/execution/prepare-agent-workspace.test.ts ./src/execution/agent-entrypoint.test.ts ./src/execution/executor.test.ts ./src/handlers/review.test.ts
bun run tsc --noEmit
```

If the proof/CLI surface changes at all, also run:

```bash
bun test ./scripts/verify-m048-s01.test.ts ./src/review-audit/phase-timing-evidence.test.ts
```

### Live proof

After deploy:

1. Trigger a fresh real `xbmc/kodiai` review on the same path used for the S01 baseline.
2. Capture the new `reviewOutputKey`.
3. Run:

```bash
bun run verify:m048:s01 -- --review-output-key <live-key> --json
```

4. Compare the resulting per-phase durations against the pre-S02 baseline.

### Acceptance signal for this slice

A credible S02 closeout should show **materially lower** time in at least one of these without breaking review publication:
- `workspace preparation`
- `executor handoff`
- polling-driven tail inside `remote runtime`

The closeout should also explicitly confirm:
- review output still publishes normally,
- idempotency behavior still works,
- S01 timing evidence remains structurally valid.

## Sources

- `.gsd/DECISIONS.md` — especially **D100–D106** plus older ACA/Azure Files decisions **D013** and **D015**.
- `src/handlers/review.ts`
- `src/execution/executor.ts`
- `src/execution/agent-entrypoint.ts`
- `src/jobs/aca-launcher.ts`
- `src/jobs/workspace.ts`
- `scripts/verify-m048-s01.ts`
- Microsoft Learn: **Reducing cold-start time on Azure Container Apps** (`https://learn.microsoft.com/en-us/azure/container-apps/cold-start`)
- Microsoft Learn: **Create an Azure Files volume mount in Azure Container Apps** (`https://learn.microsoft.com/en-us/azure/container-apps/storage-mounts-azure-files`)
- Microsoft Learn: **Monitor logs in Azure Container Apps with Log Analytics** (`https://learn.microsoft.com/en-us/azure/container-apps/log-monitoring`)
