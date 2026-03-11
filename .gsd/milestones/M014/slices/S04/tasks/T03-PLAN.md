# T03: 80-slack-operator-hardening 03

**Slice:** S04 — **Milestone:** M014

## Description

Publish the Slack operator runbook and command wiring needed for repeatable deployment and incident response.

Purpose: SLK-06 is not complete until operators can both verify behavior and quickly debug production incidents using documented, deterministic procedures.
Output: New Slack integration runbook, ops playbook cross-link, and package script aliases for smoke/regression execution.

## Must-Haves

- [ ] "Runbook documents Slack integration deployment flow, required environment variables, and incident debugging steps"
- [ ] "Operators can run explicit smoke and regression commands from the runbook without guesswork"
- [ ] "Slack incident triage maps directly from observable symptoms to concrete checks and code pointers"

## Files

- `package.json`
- `docs/runbooks/slack-integration.md`
- `docs/runbooks/xbmc-ops.md`
