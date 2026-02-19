---
created: 2026-02-18T16:58:59.896Z
title: Validate Slack reaction scopes at startup
area: general
files:
  - src/slack/client.ts
  - src/slack/assistant-handler.ts
  - src/index.ts
---

## Problem

Slack "working on it" signaling switched from typing to emoji reactions, but live runs failed with `Slack API reactions.add failed: missing_scope` in Azure logs. This silently removes the intended in-channel progress signal and confuses operators because requests appear accepted while UX feedback is missing.

## Solution

Add a Slack capability preflight for required reaction scopes (at minimum `reactions:write`) during startup or health checks, and surface actionable remediation (scope name + reinstall requirement) before runtime handling. Keep reaction add/remove fail-open for message processing, but emit deterministic operator-visible diagnostics and runbook guidance when scope is missing.
