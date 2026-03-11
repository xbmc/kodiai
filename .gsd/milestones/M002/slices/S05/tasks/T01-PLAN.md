# T01: 15-write-pipeline 01

**Slice:** S05 — **Milestone:** M002

## Description

Enable mention-driven changes end-to-end by letting the model edit files, while keeping branch/commit/push/PR creation in trusted code.

This phase does NOT add broad policy guardrails (path allow/deny, secret scanning) beyond existing safety primitives; those are Phase 16.

## Must-Haves

- [ ] "Writes still require explicit write intent and write.enabled=true"
- [ ] "Write-mode can modify files in the workspace without granting the model git push privileges"
- [ ] "When changes are produced, Kodiai opens a PR on the base repo and replies with the PR link"
- [ ] "No token leaks to logs/errors during push failures"

## Files

- `src/execution/executor.ts`
- `src/execution/types.ts`
- `src/execution/mcp/index.ts`
- `src/jobs/workspace.ts`
- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
