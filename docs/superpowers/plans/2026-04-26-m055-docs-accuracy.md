# M055 Docs Accuracy Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the top-level docs, license, and runbook surfaces on current `main` up to the existing M055 verifier contract so `verify:m055:s01`, `verify:m055:s02`, and `verify:m055:s03` all pass.

**Architecture:** This is a verifier-driven documentation pass, not a product refactor. The work stays constrained to the exact files that M055 names: README/CHANGELOG for S01, LICENSE/CONTRIBUTING for S02, and docs index + four runbooks for S03. Verification happens only through the existing M055 proof scripts.

**Tech Stack:** Markdown docs, repository metadata, Bun verifier scripts, Git worktree workflow.

---

## File map

- Modify: `README.md` — refresh shipped milestone count, recent-feature markers, and nightly workflow descriptions required by `verify:m055:s01`.
- Modify: `CHANGELOG.md` — ensure the `## v0.31` release marker remains present for `verify:m055:s01`.
- Create: `LICENSE` — add the missing root license file required by `verify:m055:s02`.
- Modify: `CONTRIBUTING.md` — add planning, migration, and verification contract sections required by `verify:m055:s02`.
- Create: `docs/INDEX.md` — inventory page required by `verify:m055:s03`.
- Create: `docs/runbooks/deploy-rollback.md` — deployment rollback runbook required by `verify:m055:s03`.
- Create: `docs/runbooks/key-rotation.md` — key rotation runbook required by `verify:m055:s03`.
- Create: `docs/runbooks/aca-job-debugging.md` — ACA job debugging runbook required by `verify:m055:s03`.
- Create: `docs/runbooks/nightly-sync-failures.md` — nightly sync failure runbook required by `verify:m055:s03`.

### Task 1: S01 README and CHANGELOG truth surface

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Verify: `scripts/verify-m055-s01.ts`

- [ ] **Step 1: Read the current verifier contract and target docs**

Read:
- `scripts/verify-m055-s01.ts`
- `README.md`
- `CHANGELOG.md`

Focus on the exact strings the verifier requires:
- `31 milestones shipped (v0.1 through v0.31).`
- `M051`, `M052`, `M053`, `new Function()`, `verify:m053`, `M054`, `verify:m054:s01`, `verify:m054:s04`
- `nightly-issue-sync`, `bun scripts/backfill-issues.ts --sync`, `nightly-reaction-sync`, `bun scripts/sync-triage-reactions.ts`, `workflow_dispatch`, `GitHub Actions workflow run status`
- `## v0.31`

- [ ] **Step 2: Update README.md with only the required M055 markers**

Add or revise text so the README explicitly includes the required markers in truthful prose. Use wording like:

```md
Kodiai now has 31 milestones shipped (v0.1 through v0.31).

Recent milestone highlights include:
- M051 — truthful manual rereview contract
- M052 — Slack webhook relay operations and verification surface
- M053 — removal of unsafe `new Function()` usage, verified by `verify:m053`
- M054 — planning artifact / verification contract repair, including `verify:m054:s01` and `verify:m054:s04`

Nightly maintenance workflows:
- `nightly-issue-sync` runs `bun scripts/backfill-issues.ts --sync`
- `nightly-reaction-sync` runs `bun scripts/sync-triage-reactions.ts`
- both workflows support `workflow_dispatch`
- operators should inspect GitHub Actions workflow run status when either nightly job fails
```

Keep the rest of the README stable unless the verifier requires more.

- [ ] **Step 3: Ensure CHANGELOG.md retains a `## v0.31` section**

If missing, add a short truthful section such as:

```md
## v0.31

- Truthful manual rereview contract, Slack webhook relay follow-through, and post-v0.30 documentation alignment.
```

Do not invent feature claims that are not already shipped on `main`.

- [ ] **Step 4: Run the S01 verifier**

Run:
```bash
cd .worktrees/m055-docs-accuracy && bun run verify:m055:s01
```

Expected:
- `M055 S01 docs truth verifier`
- overall `PASS`
- all checks pass, including README shipped count, recent features, nightly workflows, and changelog marker retention.

- [ ] **Step 5: Commit the S01 docs pass**

```bash
cd .worktrees/m055-docs-accuracy
git add README.md CHANGELOG.md
git commit -m "docs: refresh m055 readme and changelog truth"
```

### Task 2: S02 license and contributor contract

**Files:**
- Create: `LICENSE`
- Modify: `CONTRIBUTING.md`
- Verify: `scripts/verify-m055-s02.ts`

- [ ] **Step 1: Read the S02 verifier and current contributing guide**

Read:
- `scripts/verify-m055-s02.ts`
- `CONTRIBUTING.md`

Extract the exact required markers, especially:
- `.gsd/`, `M###`, `S##`, `T##`, `ROADMAP`, `PLAN`, `SUMMARY`
- `.gsd/DECISIONS.md`, `.gsd/REQUIREMENTS.md`
- `src/db/migrate.ts`, `bun run src/db/migrate.ts down <version>`, `.down.sql`, `explicit exception`, `Do **not** assume every historical migration already meets the paired-file rule.`
- `bunx tsc --noEmit`, `verify:*`, `verify:m053`, `verify:m054:s01`, `verify:m055:s01`, `.github/workflows/ci.yml`

- [ ] **Step 2: Add the root LICENSE file**

Create `LICENSE` with the repo’s intended OSS license text. Use standard, complete license prose — not a summary or placeholder. The file must be a conventional root license document.

- [ ] **Step 3: Expand CONTRIBUTING.md with the required contract sections**

Add concise sections covering:

```md
## GSD v2 planning artifacts
- `.gsd/`
- milestone IDs like `M###`
- slice IDs like `S##`
- task IDs like `T##`
- artifact expectations for `ROADMAP`, `PLAN`, and `SUMMARY`
- references to `.gsd/DECISIONS.md` and `.gsd/REQUIREMENTS.md`

## Migration rules
- use `src/db/migrate.ts`
- rollback example: `bun run src/db/migrate.ts down <version>`
- every forward migration must ship with a `.down.sql` sibling unless there is an explicit exception
- Do **not** assume every historical migration already meets the paired-file rule.

## Verification contract
- run `bunx tsc --noEmit`
- run the relevant `verify:*` scripts
- examples: `verify:m053`, `verify:m054:s01`, `verify:m055:s01`
- CI in `.github/workflows/ci.yml` is the final gate, not a substitute for local verification
```

Keep the prose readable, but make sure the exact markers exist.

- [ ] **Step 4: Run the S02 verifier**

Run:
```bash
cd .worktrees/m055-docs-accuracy && bun run verify:m055:s02
```

Expected:
- overall `PASS`
- license file present
- contributing planning markers present
- migration rules markers present
- verification markers present

- [ ] **Step 5: Commit the S02 contract pass**

```bash
cd .worktrees/m055-docs-accuracy
git add LICENSE CONTRIBUTING.md
git commit -m "docs: add m055 contributor contract surfaces"
```

### Task 3: S03 docs index and required runbooks

**Files:**
- Create: `docs/INDEX.md`
- Create: `docs/runbooks/deploy-rollback.md`
- Create: `docs/runbooks/key-rotation.md`
- Create: `docs/runbooks/aca-job-debugging.md`
- Create: `docs/runbooks/nightly-sync-failures.md`
- Verify: `scripts/verify-m055-s03.ts`

- [ ] **Step 1: Read the S03 verifier and inspect existing docs/runbooks**

Read:
- `scripts/verify-m055-s03.ts`
- `docs/` top-level markdown files
- `docs/runbooks/` current contents

Identify the exact runbook marker requirements and any command-name checks the verifier performs.

- [ ] **Step 2: Create `docs/INDEX.md` as a cold-reader inventory**

Write a simple docs index with one bullet per doc/runbook category, including the new runbooks. Structure:

```md
# Docs Index

## Top-level docs
- ...

## Runbooks
- `deploy-rollback.md` — when and how to roll back a deploy or migration lane
- `key-rotation.md` — rotating runtime secrets safely
- `aca-job-debugging.md` — debugging failed Azure Container Apps jobs
- `nightly-sync-failures.md` — triaging nightly sync workflow failures
```

- [ ] **Step 3: Write the four required runbooks with real commands and markers**

Each runbook must include:
- one structured log tag or log phrase already used in the repo/workflows
- one real command that resolves in the repo
- one owning milestone or decision reference

Suggested seed content:

`docs/runbooks/deploy-rollback.md`
```md
# Deploy Rollback

## When to use
Use this when a deploy or migration must be reversed after a failed rollout.

## Signals
- check CI / deploy logs for rollback-related failures
- review paired migration expectations from M056

## Commands
- `bun run verify:m056:s01`
- `bun run verify:m056:s02`
- `bun run src/db/migrate.ts down <version>`

## Owning milestone
- M056
```

`docs/runbooks/key-rotation.md`
```md
# Key Rotation

## When to use
Rotate runtime credentials when a token is revoked, expired, or suspected compromised.

## Signals
- auth failures in GitHub Actions workflow run status or runtime logs

## Commands
- `bun run verify:m055:s02`
- `bun run verify:m058:s02`

## Owning milestone
- M055 / M058
```

`docs/runbooks/aca-job-debugging.md`
```md
# ACA Job Debugging

## When to use
Use this when an Azure Container Apps job fails or times out.

## Signals
- `result.json`
- `agent-diagnostics.log`
- ACA execution status / timeout surfaces

## Commands
- `bun run verify:m048:s03`
- `bun run verify:m055:s03`

## Owning milestone
- M048 / M055
```

`docs/runbooks/nightly-sync-failures.md`
```md
# Nightly Sync Failures

## When to use
Use this when `nightly-issue-sync` or `nightly-reaction-sync` fails.

## Signals
- GitHub Actions workflow run status
- nightly workflow logs

## Commands
- `bun scripts/backfill-issues.ts --sync`
- `bun scripts/sync-triage-reactions.ts`

## Owning milestone
- M052 / M055
```

Adjust wording to match verifier expectations after reading the script.

- [ ] **Step 4: Run the S03 verifier**

Run:
```bash
cd .worktrees/m055-docs-accuracy && bun run verify:m055:s03
```

Expected:
- overall `PASS`
- docs index present
- all required runbooks present
- command references resolve

- [ ] **Step 5: Run the full M055 verifier chain**

Run:
```bash
cd .worktrees/m055-docs-accuracy && bun run verify:m055:s01 && bun run verify:m055:s02 && bun run verify:m055:s03
```

Expected:
- all three verifiers pass sequentially

- [ ] **Step 6: Commit the S03 runbook/index pass**

```bash
cd .worktrees/m055-docs-accuracy
git add docs/INDEX.md docs/runbooks/deploy-rollback.md docs/runbooks/key-rotation.md docs/runbooks/aca-job-debugging.md docs/runbooks/nightly-sync-failures.md
git commit -m "docs: add m055 runbook inventory surfaces"
```

## Self-review

- Spec coverage: Tasks 1–3 cover all S01/S02/S03 acceptance surfaces from the design.
- Placeholder scan: No TODO/TBD markers; each task names exact files and commands.
- Consistency: All verification references use the existing M055 scripts and the same worktree path.
