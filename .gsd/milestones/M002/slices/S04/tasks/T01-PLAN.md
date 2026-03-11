# T01: 14-write-mode-foundations 01

**Slice:** S04 — **Milestone:** M002

## Description

Lay the foundations for mention-driven code changes by introducing an explicit write-intent path with safe defaults and strong traceability.

Purpose: Enable v0.2 work without risking accidental writes.
Output: Config + routing + trace markers in place; still deny-by-default.

## Must-Haves

- [ ] "Write operations remain deny-by-default; existing review + Q&A behavior is unchanged"
- [ ] "There is a clear, explicit 'write request' intent path that can be enabled per repo"
- [ ] "Write-mode executions are traceable (deliveryId + trigger comment + resulting branch/commit/PR links)"

## Files

- `src/execution/config.ts`
- `src/handlers/mention.ts`
- `src/execution/mention-prompt.ts`
- `docs/runbooks/mentions.md`
