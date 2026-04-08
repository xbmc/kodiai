# Kodiai

## What This Is

Kodiai is an AI-powered GitHub bot that reviews pull requests, triages issues, answers questions via Slack, and runs autonomous coding tasks (write mode). It watches GitHub webhooks, runs Claude via the Anthropic Agent SDK in isolated Azure Container App jobs, and posts structured findings back to GitHub comments and Slack.

## Core Value

Automated, high-signal code review on every PR — findings land in a structured GitHub comment with severity, confidence, suppression, reviewer context, and execution details. The surrounding systems exist to make that review surface truthful, attributable, and safe to operate.

## Current State

The full review stack is deployed: webhook ingestion, PR review (full + retry + inline), issue triage, Slack assistant, write-mode agent execution, MCP tooling, knowledge/wiki workflows, contributor profiling, and multi-model routing.

M043 is functionally repaired but not fully closed. The local deterministic workflow contract is green again on `pr/multi-m035-m042-clean`: `DATABASE_URL=postgresql://kodiai:kodiai@localhost:5432/kodiai bun test` passes and `bunx tsc --noEmit` passes after the BIGINT comment-id normalization, voyage-4 contract refreshes, embedding sweep model fix, and deterministic wiki style test seam landed. Production explicit `@kodiai review` is also restored on the newly deployed revision `ca-kodiai--0000076`: fresh delivery `bab62150-3329-11f1-96a5-aecd0f6e5943` reached `taskType="review.full"`, emitted `reviewOutputPublicationState=publish`, ended with `publishResolution="approval-bridge"`, and produced one fresh `@kodiai[bot]` approval review on PR #80.

The remaining gap is branch synchronization, not runtime behavior. `git status --short --branch` shows the local PR branch is divergent from `origin/pr/multi-m035-m042-clean` (`ahead 28, behind 9`) with the repaired files still local-only, so PR #80 on GitHub still shows a stale failing `test` check. Until that branch is reconciled and pushed, milestone M043 should remain in `needs-attention` rather than complete.

## Architecture / Key Patterns

- **Entrypoint:** Hono HTTP server (`src/index.ts`) receiving GitHub webhooks and Slack events.
- **Execution:** Azure Container App Jobs dispatch per review; the agent writes `result.json` to a shared Azure Files mount.
- **Agent SDK:** `@anthropic-ai/claude-agent-sdk` via `src/execution/agent-entrypoint.ts`.
- **MCP:** Per-job bearer tokens with stateless HTTP MCP servers; registry and transport wiring live under `src/execution/mcp/`.
- **Explicit mention review bridge:** `src/handlers/mention.ts` routes explicit `@kodiai review` requests through `taskType=review.full`, uses `src/handlers/review-idempotency.ts` for marker-based skip detection, and classifies terminal publish outcomes such as `skip-existing-output`, `idempotency-skip`, and `duplicate-suppressed`.
- **Deploy/runtime proof surfaces:** `deploy.sh` prints the active ACA revision plus `/healthz` and `/readiness` URLs; the operator runbook uses `ContainerAppConsoleLogs_CL` queries keyed on `taskType=review.full`, `reviewOutputKey`, and publish-resolution logs.
- **Workspace artifact debugging:** When a live ACA execution succeeds but the app has not yet emitted terminal publish logs, inspect Azure Files workspace artifacts (`agent-config.json`, `agent-diagnostics.log`, `result.json`) before guessing at handler behavior.
- **Explicit review mention budget rule:** PR mentions promoted to `taskType="review.full"` must inherit repo-config `maxTurns` and the full review tool surface. Conversational mention caps are for `mention.response`, not explicit review.

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract, requirement status, and coverage mapping.

## Milestone Sequence

- [x] M001–M042: MVP through contributor-tier truthfulness and mention-review production repair groundwork
- [ ] M043: Restore Mention Review Publication and Reverify PR #80
  - [x] S01: Live Mention Publish Repair
  - [x] S02: Publish Failure Hardening and Deploy Safety
  - [x] S03: Backport Hotfixes onto PR #80
  - [x] S04: Finish PR #80 Review Fixes
  - [x] S05: Final Production and PR Proof — local deterministic proof and live production mention proof are both green, but the remote PR branch and GitHub `test` check are still stale until the repaired branch is reconciled and pushed.
