---
status: complete
phase: 08-deployment
source: [08-01-SUMMARY.md, 08-02-SUMMARY.md]
started: 2026-02-08T19:00:00Z
updated: 2026-02-08T19:50:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Docker Image Builds
expected: Running `docker build -t kodiai .` in the repo root completes successfully, producing a ~274MB image based on oven/bun:1-alpine.
result: pass

### 2. Health Endpoint Returns OK
expected: Hitting https://ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io/health returns `{"status":"ok"}` with a 200 status code.
result: pass

### 3. Readiness Endpoint Returns Ready
expected: Hitting https://ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io/readiness returns `{"status":"ready"}` with a 200 status code.
result: pass

### 4. PR Auto-Review on PR Open
expected: Opening a non-draft PR on a repo where the kodiai GitHub App is installed triggers an automatic review. Inline review comments appear anchored to specific diff lines with suggestion blocks within ~2 minutes.
result: pass

### 5. @kodiai Mention Response
expected: Commenting `@kodiai <question>` on an issue or PR produces a contextual response as a reply comment. A tracking comment ("thinking...") appears within seconds and updates with the final response.
result: issue (fixed)
reported: "Tracking comment posted but never updated. Execution completed successfully (10 turns, $0.21, 44s) but Claude's response was lost. The tracking comment ID is passed to buildMcpServers but never included in the prompt, so Claude doesn't know which comment to update via update_comment MCP tool."
severity: major
fix: "8176a58 — Include trackingCommentId in buildMentionPrompt params and inject it into prompt text. Redeployed as v4. Retest confirmed: tracking comment now updates with full contextual response."

### 6. Container Runs as Non-Root
expected: The deployed container runs as the non-root "bun" user (not root). Verifiable via `az containerapp exec` or checking the Dockerfile's USER directive.
result: pass

## Summary

total: 6
passed: 5
issues: 1 (fixed and verified)
pending: 0
skipped: 0

## Gaps

- truth: "Tracking comment is updated with Claude's contextual response after execution"
  status: fixed
  reason: "User reported: Tracking comment posted but never updated. Execution completed successfully (10 turns, $0.21, 44s) but Claude's response was lost. The tracking comment ID is passed to buildMcpServers but never included in the prompt, so Claude doesn't know which comment to update via update_comment MCP tool."
  severity: major
  test: 5
  root_cause: "mention-prompt.ts:107 tells Claude 'The tracking comment ID will be provided in the system context' but nothing injects it. The commentId is passed through ExecutionContext -> buildMcpServers but never appears in the prompt or system prompt. Claude runs 10 turns but has no comment ID to call update_comment with, so the response is lost."
  fix_commit: "8176a58"
  artifacts:
    - path: "src/execution/mention-prompt.ts"
      issue: "Line 107: promises tracking comment ID in system context but never provides it"
    - path: "src/handlers/mention.ts"
      issue: "Did not pass trackingCommentId to buildMentionPrompt"
  resolution:
    - "Added trackingCommentId param to buildMentionPrompt"
    - "Injected comment ID directly into prompt text with update_comment tool reference"
    - "Added fallback to create_comment if no tracking comment ID available"
