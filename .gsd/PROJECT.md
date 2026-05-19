# Project

## What This Is

Kodiai is a GitHub App and review automation service that reviews pull requests, publishes GitHub review outcomes, uses retrieval/knowledge context, and records operational evidence for agents and operators. The current project has a mature review pipeline with review orchestration, retrieval, candidate/reducer publication gates, phase timing, and production deployment on Azure Container Apps.

## Core Value

Kodiai must provide trustworthy PR review signal without wasting model tokens, exceeding runtime budgets, or hiding what it did.

## Project Shape

- **Complexity:** complex
- **Why:** The work crosses review orchestration, prompt construction, retrieval, cache invalidation, continuation behavior, GitHub publication, production telemetry, and live proof requirements.

## Current State

The review system supports phase timing, Review Details, retrieval context, derived prompt caching, candidate finding/reducer flows, publication safety gates, continuation/retry behavior, production log visibility, bounded finding lifecycle evidence, same-PR inline fix evidence, validation-truth status, and `.kodiai.yml` repo doctrine contracts. M074 closed the Clawpatch-inspired review workflow via production-like proof with bounded public output and no branch/PR/push side effects. M073 remains the next planned token-first efficiency milestone.

## Architecture / Key Patterns

- TypeScript/Bun service with Hono routes, GitHub App handlers, Azure Container Apps execution, and structured pino logging.
- `src/handlers/review.ts` orchestrates review lifecycle, queueing, prompt construction, timeout estimation, continuation, Review Details, lifecycle/fix/validation-truth projections, and publication coordination.
- `src/execution/review-prompt.ts` builds review prompts and exposes prompt-section metrics.
- `src/lib/search-cache.ts` provides TTL cache plus in-flight coalescing for derived/search-like data.
- `src/knowledge/*retrieval*.ts` provides review context retrieval across knowledge corpora.
- `src/review-orchestration/*` contains candidate/reducer/review-plan helpers that must stay bounded and safe.
- `src/review-lifecycle/*` contains bounded finding lifecycle, same-PR fix eligibility, and validation-truth reducers used to keep public review evidence compact, correlated, and redaction-safe.
- `src/repo-doctrine/*` plus `.kodiai.yml` `review.doctrine` config support repository-owned review invariant contracts.
- Safety and publication gates outrank cost optimization.

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract, requirement status, and coverage mapping.

## Milestone Sequence

- [ ] M073: Token-First Review Efficiency — refactor the review pipeline into a budgeted, cache-aware path that uses fewer tokens first and proves live effectiveness without relying on timeout headroom.
- [x] M074: Clawpatch Inspired Review Workflow and Inline Fix Evidence — delivered stable finding lifecycle evidence, bounded same-PR inline fix suggestions, validation-truth status, compact Review Details/operator evidence, production-like trigger proof, and `.kodiai.yml` repo doctrine contract remediation.
