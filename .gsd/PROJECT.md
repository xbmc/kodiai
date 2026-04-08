# Kodiai

## What This Is

Kodiai is an AI-powered GitHub bot that reviews pull requests, triages issues, answers questions via Slack, and runs autonomous coding tasks (write mode). It watches GitHub webhooks, runs Claude via the Anthropic Agent SDK in isolated Azure Container App jobs, and posts structured findings back to GitHub comments and Slack.

## Core Value

Automated, high-signal code review on every PR — findings land in a structured GitHub comment with severity, confidence, suppression, reviewer context, and execution details. The surrounding systems exist to make that review surface truthful, attributable, and safe to operate.

## Current State

The full review stack is deployed: webhook ingestion, PR review (full + retry + inline), issue triage, Slack assistant, write-mode agent execution, MCP tooling, knowledge/wiki workflows, contributor profiling, and multi-model routing.

M043 is still open, but all five slices are now complete. S01 restored truthful explicit `@kodiai review` publication wiring in production, S02 hardened publish-failure diagnostics and deploy safety, S03 rebased PR #80 onto current `origin/main`, backported the approved mention/idempotency hotfix surface, aligned deploy/runbook docs to the live ACA contract, and removed tracked `.gsd` review noise from the branch surface, and S04 closed the remaining deterministic PR review findings on the cleaned branch.

S05 reran the final closeout proof lanes on current state and converted the result into blocker-grade evidence. The deterministic CI-shaped lane still fails under the exact workflow DB contract (`DATABASE_URL=postgresql://kodiai:kodiai@localhost:5432/kodiai bun test`) with 11 red tests; the first blocker is `KnowledgeStore > recordFindings persists deterministic comment linkage fields`, where raw SQL readback of migrated BIGINT comment IDs now returns string values. `bunx tsc --noEmit` passes. The live production explicit-mention lane is also still red: the active revision `ca-kodiai--hotfix-125330` passes `/healthz` and `/readiness`, and delivery `66b4ee50-32bc-11f1-9eeb-89b961f025e8` reaches `taskType=review.full` and ACA job completion, but no `reviewOutputKey`, no publish-path rows, and no GitHub-visible review outcome are emitted. PR #80 remains open/dirty with a failing `test` check. Milestone closure is blocked until both proof lanes are green.

## Architecture / Key Patterns

- **Entrypoint:** Hono HTTP server (`src/index.ts`) receiving GitHub webhooks and Slack events.
- **Execution:** Azure Container App Jobs dispatch per review; the agent writes `result.json` to a shared Azure Files mount.
- **Agent SDK:** `@anthropic-ai/claude-agent-sdk` via `src/execution/agent-entrypoint.ts`.
- **MCP:** Per-job bearer tokens with stateless HTTP MCP servers; registry and transport wiring live under `src/execution/mcp/`.
- **Explicit mention review bridge:** `src/handlers/mention.ts` routes explicit `@kodiai review` requests through `taskType=review.full`, uses `src/handlers/review-idempotency.ts` for marker-based skip detection, and classifies terminal publish outcomes such as `skip-existing-output`, `idempotency-skip`, and `duplicate-suppressed`.
- **Deploy/runtime proof surfaces:** `deploy.sh` prints the active ACA revision plus `/healthz` and `/readiness` URLs; the operator runbook uses `ContainerAppConsoleLogs_CL` queries keyed on `taskType=review.full`, `reviewOutputKey`, and publish-resolution logs.
- **Review output truthfulness:** Structural evidence, author-tier messaging, and Review Details metadata are rendered from shared contracts rather than duplicated literals so degraded or partial states are expressed truthfully.
- **Final closeout proof pattern:** Deterministic milestone-close reruns use the workflow DATABASE_URL exactly, then `bun test --bail=1` to anchor the first blocker. Live proof uses active revision + `/healthz` + `/readiness` + `deliveryId` + exact `reviewOutputKey` + publish-path row presence/absence as the authoritative chain.

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract, requirement status, and coverage mapping.

## Milestone Sequence

- [x] M001–M042: MVP through contributor-tier truthfulness and mention-review production repair groundwork
- [ ] M043: Restore Mention Review Publication and Reverify PR #80
  - [x] S01: Live Mention Publish Repair
  - [x] S02: Publish Failure Hardening and Deploy Safety
  - [x] S03: Backport Hotfixes onto PR #80
  - [x] S04: Finish PR #80 Review Fixes
  - [x] S05: Final Production and PR Proof — final proof reruns are complete, but milestone closure remains blocked on the still-red deterministic lane and the still-red live explicit-mention publish lane.
