# M034: 

## Vision
Surface Claude Code usage context from the agent run itself so operators can see weekly limit utilization and token usage directly under the Review Details collapsible in GitHub comments. Slack is a later surface, not this milestone.

## Slice Overview
| ID | Slice | Risk | Depends | Done | After this |
|----|-------|------|---------|------|------------|
| S01 | Capture Claude Code usage events | high | — | ✅ | After this, `result.json` includes Claude Code usage-limit data when the SDK emits a rate-limit event, and tests prove the last event wins. |
| S02 | Render usage and tokens in Review Details | medium | S01 | ⬜ | After this, the GitHub PR comment's Review Details section shows usage percentage, reset timing, token usage, and cost. |
