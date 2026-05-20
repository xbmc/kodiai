# Project

## What This Is

Kodiai is a production GitHub review bot for Kodi/XBMC repositories. It receives webhook and mention-triggered review requests, prepares review context, runs an agent in an isolated Azure Container Apps job, publishes bounded Review Details and review comments, records operational telemetry, and uses candidate-publication safety gates to prevent unsafe or unapproved output from reaching public GitHub surfaces.

## Core Value

Kodiai must provide useful, safe PR review signal in production while preserving publication safety: no unapproved candidate output, no secret leakage, no silent publication failure, and operator-visible evidence when review or publication behavior degrades.

## Project Shape

- **Complexity:** complex
- **Why:** The project spans GitHub webhooks/review APIs, Azure Container Apps jobs, Log Analytics, database-backed knowledge capture, candidate publication policy, Review Details output, and production rollout verification.

## Current State

Kodiai is deployed in Azure Container Apps and currently reports healthy `/healthz` and `/readiness` endpoints. v0.38 has been released and production verification showed explicit review handling works for `xbmc/xbmc#28172`. The most recent production-log audit found app-level issue classes that need cleanup: undefined knowledge-store writes, inline comment publication failures for non-commentable GitHub diff lines, candidate publication blocked states with incomplete reason detail, timeout/addon-check ambiguity, and the need to separate Azure platform transient signals from Kodiai-actionable failures.

## Architecture / Key Patterns

Kodiai is TypeScript/Bun. The main review path runs through webhook/mention handlers, review orchestration, an Azure Container Apps job executor, MCP publication tools, candidate publication policy/runtime evidence, Review Details rendering, and Log Analytics-backed operational verification. Existing safety patterns include bounded Review Details, candidate-approved publication, direct-fallback evidence rejection, secret/redaction gates, idempotency markers, and verifier scripts that consume fixture or production-shaped evidence.

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract, requirement status, and coverage mapping.

## Milestone Sequence

- [ ] M075: Production Log Cleanup and Publication Reliability — Clean up production-log issue classes from the last audit, redesign unsafe/noisy publication outcomes where needed, and prove the result with tests plus post-change production log evidence.
