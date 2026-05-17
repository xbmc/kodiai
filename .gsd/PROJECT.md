# Project

## What This Is

Kodiai is a GitHub App and review automation service that reviews pull requests, publishes GitHub review outcomes, uses retrieval/knowledge context, and records operational evidence for agents and operators. The current project has a mature review pipeline with review orchestration, retrieval, candidate/reducer publication gates, phase timing, and production deployment on Azure Container Apps.

## Core Value

Kodiai must provide trustworthy PR review signal without wasting model tokens, exceeding runtime budgets, or hiding what it did.

## Project Shape

- **Complexity:** complex
- **Why:** The work crosses review orchestration, prompt construction, retrieval, cache invalidation, continuation behavior, GitHub publication, production telemetry, and live proof requirements.

## Current State

The review system already supports phase timing, Review Details, retrieval context, derived prompt caching, candidate finding/reducer flows, publication safety gates, continuation/retry behavior, and production log visibility. A recent fix increased addon-check and dynamic review timeout headroom, but M073 treats that as a stopgap rather than the desired long-term design.

## Architecture / Key Patterns

- TypeScript/Bun service with Hono routes, GitHub App handlers, Azure Container Apps execution, and structured pino logging.
- `src/handlers/review.ts` orchestrates review lifecycle, queueing, prompt construction, timeout estimation, continuation, Review Details, and publication coordination.
- `src/execution/review-prompt.ts` builds review prompts and exposes prompt-section metrics.
- `src/lib/search-cache.ts` provides TTL cache plus in-flight coalescing for derived/search-like data.
- `src/knowledge/*retrieval*.ts` provides review context retrieval across knowledge corpora.
- `src/review-orchestration/*` contains candidate/reducer/review-plan helpers that must stay bounded and safe.
- Safety and publication gates outrank cost optimization.

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract, requirement status, and coverage mapping.

## Milestone Sequence

- [ ] M073: Token-First Review Efficiency — refactor the review pipeline into a budgeted, cache-aware path that uses fewer tokens first and proves live effectiveness without relying on timeout headroom.
