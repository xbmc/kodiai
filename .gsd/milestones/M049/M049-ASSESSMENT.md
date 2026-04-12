---
date: 2026-04-12
verdict: passed
revision: ca-kodiai--0000100
delivery_id: 0d00c0b0-3676-11f1-9236-3ac1c3ce9ea3
execution_name: caj-kodiai-agent-yeks2jk
decision_refs:
  - D099
---

# M049 Assessment: production proof for shared review-output publication gate

## Scope

This is a production handoff note for the shared idempotency preflight fix. **M049 remains queued**; no slice or task state was advanced here. The purpose of this proof was to verify that one explicit `@kodiai review` execution can publish both:

- one summary issue comment
- multiple inline PR comments

without falling through to approval or suppressing inline publication as a replay.

## Outcome

**Passed** on revision `ca-kodiai--0000100`.

- No `APPROVED` review was created.
- Kodiai posted one summary issue comment and five inline PR comments.
- App logs and workspace artifacts confirm executor-side publication with both MCP publish tools connected.
- The earlier summary-vs-inline idempotency collision is no longer present in production.

## Trigger and execution chain

- Trigger comment: `https://github.com/xbmc/xbmc/pull/28172#issuecomment-4231629452`
- Trigger comment id: `4231629452`
- Delivery id: `0d00c0b0-3676-11f1-9236-3ac1c3ce9ea3`
- ACA execution: `caj-kodiai-agent-yeks2jk`
- Workspace: `/mnt/kodiai-workspaces/0d00c0b0-3676-11f1-9236-3ac1c3ce9ea3`
- ACA execution window: `2026-04-12T13:50:36+00:00` -> `2026-04-12T13:55:03+00:00`
- Pre-trigger app health:
  - `/healthz` -> `{"status":"ok","db":"connected"}`
  - `/readiness` -> `{"status":"ready"}`

## GitHub-visible evidence

### Summary issue comment

- Comment id: `4231642782`
- Created at: `2026-04-12T13:54:54Z`
- Body contained the expected `kodiai:review-output-key` marker for delivery `0d00c0b0-3676-11f1-9236-3ac1c3ce9ea3`
- Verdict section was `:red_circle: Address before merging -- 5 blocking issue(s) found`

### Inline PR comments

Five inline PR comments were published:

- `3069551550` — `xbmc/addons/AddonInstaller.cpp:190`
- `3069551591` — `xbmc/addons/AddonInstaller.cpp:246`
- `3069551618` — `xbmc/addons/AddonInstaller.cpp:264`
- `3069551645` — `xbmc/addons/AddonManager.cpp:116`
- `3069551671` — `xbmc/addons/AddonManager.cpp:151`

### Review state after trigger

GitHub created five `COMMENTED` review submissions corresponding to the inline comments, and **zero `APPROVED` reviews** after the trigger. That is the expected safe outcome for this noisy validation PR.

## Internal evidence

### Workspace artifacts

Downloaded artifact directory:

- `/tmp/pr28172-inline-success-dqpM2z`

Files inspected:

- `/tmp/pr28172-inline-success-dqpM2z/agent-config.json`
- `/tmp/pr28172-inline-success-dqpM2z/agent-diagnostics.log`
- `/tmp/pr28172-inline-success-dqpM2z/result.json`

### `agent-diagnostics.log`

Confirmed:

- `startup taskType=review.full model=claude-sonnet-4-5-20250929 maxTurns=25`
- `materialized repo bundle cwd=/tmp/kodiai-agent-repo-BRHcEb/repo`
- `sdk init tools=... mcp__github_comment__create_comment ... mcp__github_inline_comment__create_inline_comment`
- `mcpServers=github_comment:connected,github_inline_comment:connected,github_ci:connected`
- `sdk completed subtype=success turns=10 session=77a3f0bf-35a2-45bf-9397-cd1f4532215e`
- `sdk tool-use names=Bash,ToolSearch,mcp__github_comment__create_comment,mcp__github_inline_comment__create_inline_comment repoInspection=true`

### `result.json`

Confirmed:

- `conclusion: "success"`
- `stopReason: "end_turn"`
- `usedRepoInspectionTools: true`
- `toolUseNames` included both MCP publish tools
- `resultText` reported 5 blocking issues and said the findings were posted as inline comments

### App logs on `ca-kodiai--0000100`

Confirmed:

- `ACA Job dispatched` for execution `caj-kodiai-agent-yeks2jk`
- `Published inline review output with idempotency marker` logged five times, once per inline comment id
- `publishResolution: "executor"`
- `executorPublished: true`
- The later explicit-review publish path was skipped with `skipReason: "output-already-published"` **after** executor publication had already succeeded. In this run that is the correct terminal state, not the old premature inline-suppression bug.

## Root cause retired

Prior production behavior used separate idempotency checks for summary and inline publication surfaces. Once the summary issue comment stamped the shared `reviewOutputKey`, the inline publisher treated the same execution as a replay and suppressed inline comments.

Decision `D099` records the fix: use **one shared run-scoped idempotency preflight** across `github_comment` and `github_inline_comment`. That preserves replay suppression for later executions while allowing the same execution to publish both surfaces.

## What remains separate

This proof closes the summary-vs-inline publication defect. It does **not** advance M049 execution state, and it does not replace the separate clean-approval UX/body work queued in M049.
