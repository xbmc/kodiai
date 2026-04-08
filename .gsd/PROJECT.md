# Kodiai

## What This Is

Kodiai is an AI-powered GitHub bot that reviews pull requests, triages issues, answers questions via Slack, and runs autonomous coding tasks (write mode). It watches GitHub webhooks, runs Claude via the Anthropic Agent SDK in isolated Azure Container App jobs, and posts structured findings back to GitHub comments and Slack.

## Core Value

Automated, high-signal code review on every PR — findings land in a structured GitHub comment with severity, confidence, suppression, reviewer context, and execution details. The surrounding systems exist to make that review surface truthful, attributable, and safe to operate.

## Current State

The full review stack is deployed: webhook ingestion, PR review (full + retry + inline), issue triage, Slack assistant, write-mode agent execution, MCP tooling, knowledge/wiki workflows, contributor profiling, and multi-model routing.

M043 is in progress. S01 restored truthful explicit `@kodiai review` publication in production, S02 hardened publish-failure diagnostics and deploy safety, S03 rebased PR #80 onto current `origin/main`, backported the approved mention/idempotency hotfix surface, aligned deploy/runbook docs to the live ACA contract, and removed tracked `.gsd` review noise from the branch surface. S04 then closed the remaining deterministic PR review findings on the cleaned branch: the structural-impact prompt now reports `partial-evidence` truthfully for partial payloads, the remaining misleading or stale review comments were resolved with targeted regressions, and the inherited deploy/debug proof strings were reverified on the branch. The remaining milestone work is S05: rerun final production explicit-mention proof and final PR #80 verification on the cleaned branch.

## Architecture / Key Patterns

- **Entrypoint:** Hono HTTP server (`src/index.ts`) receiving GitHub webhooks and Slack events.
- **Execution:** Azure Container App Jobs dispatch per review; the agent writes `result.json` to a shared Azure Files mount.
- **Agent SDK:** `@anthropic-ai/claude-agent-sdk` via `src/execution/agent-entrypoint.ts`.
- **MCP:** Per-job bearer tokens with stateless HTTP MCP servers; registry and transport wiring live under `src/execution/mcp/`.
- **Explicit mention review bridge:** `src/handlers/mention.ts` routes explicit `@kodiai review` requests through `taskType=review.full`, uses `src/handlers/review-idempotency.ts` for marker-based skip detection, and classifies terminal publish outcomes such as `skip-existing-output`, `idempotency-skip`, and `duplicate-suppressed`.
- **Deploy/runtime proof surfaces:** `deploy.sh` prints the active ACA revision plus `/healthz` and `/readiness` URLs; the operator runbook uses `ContainerAppConsoleLogs_CL` queries keyed on `taskType=review.full`, `reviewOutputKey`, and publish-resolution logs.
- **Review prompt truthfulness:** `src/execution/review-prompt.ts` keeps structural-impact status aligned across the structural evidence section and the breaking-change helper using the shared `partial-evidence` vs `evidence-present` contract.
- **Review output:** GitHub comment formatting lives in `src/lib/review-utils.ts`, including Review Details usage/token visibility when the agent emits rate-limit data.

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract, requirement status, and coverage mapping.

## Milestone Sequence

- [x] M001–M042: MVP through contributor-tier truthfulness and mention-review production repair groundwork
- [ ] M043: Restore Mention Review Publication and Reverify PR #80
  - [x] S01: Live Mention Publish Repair
  - [x] S02: Publish Failure Hardening and Deploy Safety
  - [x] S03: Backport Hotfixes onto PR #80
  - [x] S04: Finish PR #80 Review Fixes
  - [ ] S05: Final Production and PR Proof
