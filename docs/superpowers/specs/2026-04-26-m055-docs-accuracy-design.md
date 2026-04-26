# M055 Docs Accuracy Pass Design

**Reader:** Maintainer landing cold on the M055 docs gap.

**Post-read action:** Update the top-level docs/license/runbook surfaces so `verify:m055:s01`, `verify:m055:s02`, and `verify:m055:s03` all pass on current `main` without expanding scope beyond the verifier contract.

## Goal

Close the real M055 documentation gaps on current `main` with one focused docs PR. The pass should satisfy the existing verifier scripts exactly: refresh README/CHANGELOG markers, add the missing license/contributing contract language, and add the required docs index and runbooks.

## Scope

In scope:
- `README.md`
- `CHANGELOG.md`
- `LICENSE`
- `CONTRIBUTING.md`
- `docs/INDEX.md`
- `docs/runbooks/deploy-rollback.md`
- `docs/runbooks/key-rotation.md`
- `docs/runbooks/aca-job-debugging.md`
- `docs/runbooks/nightly-sync-failures.md`

Out of scope:
- broader README redesign
- unrequested doc cleanup outside verifier markers
- changing runtime behavior, workflows, or package scripts
- issue `#102` Review Details unification
- M060 knowledge test work

## Constraints

- Keep the pass verifier-driven and minimal.
- Match checked-in repo truth, not live environment folklore.
- Every new runbook must include at least one structured log tag, one real command, and one owning milestone or decision reference because `verify:m055:s03` requires that shape.
- Do not invent commands that do not exist in `package.json` or `scripts/`.

## Approach Options

### Option 1 — Minimal verifier-driven pass (recommended)
Update only the files and phrases the M055 verifiers require.

Pros:
- lowest risk of drift
- easiest to verify
- smallest review surface

Cons:
- leaves broader docs polish for later

### Option 2 — Broader top-level docs refresh
While touching these files, also modernize adjacent stale wording and restructure sections.

Pros:
- cleaner docs after one pass

Cons:
- higher review risk
- easy to overreach beyond M055
- more likely to introduce verifier-unrelated drift

### Option 3 — Slice-by-slice PRs
Do S01, S02, and S03 in separate branches.

Pros:
- smaller diffs per PR

Cons:
- slower
- unnecessary overhead when the verifier surfaces are tightly related

**Recommendation:** Option 1.

## Design

### 1. README / CHANGELOG surface
Update `README.md` so it contains the exact modern markers the verifier expects:
- shipped milestone count/current release line for `v0.31`
- recent features mentioning M051, M052, M053, M054
- explicit nightly workflow descriptions for `nightly-issue-sync` and `nightly-reaction-sync`
- mention of `workflow_dispatch` and GitHub Actions workflow run status handling

Update `CHANGELOG.md` only enough to retain the `## v0.31` section expected by the verifier.

### 2. License / contributing contract
Add a root `LICENSE` file matching the already-intended repo contract. Expand `CONTRIBUTING.md` with explicit sections covering:
- `.gsd/` planning layout and M/S/T naming
- roadmap/plan/summary artifact vocabulary
- `verify:*` contract and CI relationship
- migration rollback rules including `.down.sql`, explicit exceptions, and the warning text required by the verifier
- contributor expectations around `bunx tsc --noEmit`

This is not a prose rewrite; it is a contract pass to make the contributor doc reflect current repo rules.

### 3. Docs index and required runbooks
Add `docs/INDEX.md` as a simple inventory page for the existing docs tree plus the four required runbooks. Add the missing runbooks with truthful, operator-facing content:
- deploy rollback
- key rotation
- ACA job debugging
- nightly sync failures

Each runbook will include:
- at least one structured log tag already used by the repo or workflow surface
- at least one real command from `package.json`, Bun scripts, GitHub Actions, or Azure/container diagnostics already present in the repo docs/tooling
- a short “Owning milestone/decision” note referencing M055/M056/M058/M052 where relevant

## Verification plan

Run exactly:
- `bun run verify:m055:s01`
- `bun run verify:m055:s02`
- `bun run verify:m055:s03`

Optionally spot-read the edited docs after the verifiers pass to ensure the wording is still truthful and not just marker stuffing.

## Risks

- The verifier may look for exact phrases rather than general meaning. Mitigation: read the verifier scripts before editing and satisfy their concrete marker lists.
- Runbook commands could drift from real repo entrypoints. Mitigation: only reference commands that resolve in `package.json` or existing scripts.
- License choice could imply a new policy decision. Mitigation: use the repo’s existing intended OSS contract if already inferable from surrounding material; otherwise keep the license addition narrow and document the choice in contributor-facing text only if the verifier demands it.

## File plan

- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Create: `LICENSE`
- Modify: `CONTRIBUTING.md`
- Create: `docs/INDEX.md`
- Create: `docs/runbooks/deploy-rollback.md`
- Create: `docs/runbooks/key-rotation.md`
- Create: `docs/runbooks/aca-job-debugging.md`
- Create: `docs/runbooks/nightly-sync-failures.md`

## Completion condition

M055 is done when all three verifiers pass on the worktree and the resulting docs still read like truthful operator/contributor documentation rather than verifier bait.
