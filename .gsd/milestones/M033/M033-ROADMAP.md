# M033: 

## Vision
Remove a live credential from the agent container env, plug two gaps in the outgoing secret scan, and harden the security policy prompt against social engineering — three targeted fixes that close the highest-priority attack surfaces identified in operational review.

## Slice Overview
| ID | Slice | Risk | Depends | Done | After this |
|----|-------|------|---------|------|------------|
| S01 | Remove GITHUB_INSTALLATION_TOKEN from container env | low | — | ✅ | bun test ./src/jobs/aca-launcher.test.ts passes; GITHUB_INSTALLATION_TOKEN absent from test spec env array; APPLICATION_SECRET_NAMES includes it. |
| S02 | Add Anthropic token patterns to outgoing secret scan | low | — | ✅ | bun test ./src/lib/sanitizer.test.ts passes with new pattern assertions. |
| S03 | Harden security policy prompt against execution bypass | low | — | ⬜ | bun test ./src/execution/review-prompt.test.ts passes with assertions for new security policy clauses. |
