# Kodiai

## What This Is

Kodiai is an AI-powered GitHub bot that reviews pull requests, triages issues, answers questions via Slack, and runs autonomous coding tasks (write mode). It watches GitHub webhooks, runs Claude via the Anthropic Agent SDK in isolated Azure Container App jobs, and posts structured findings back to GitHub comments and Slack.

## Core Value

Automated, high-signal code review on every PR — findings land in a structured GitHub comment with severity, confidence, suppression, reviewer context, bounded review details, and truthful author-context guidance.

## Current State

M001–M041 are complete. Kodiai already has contributor profile storage, expertise scoring, persistent contributor tiers, author-tier prompt shaping, review-time author cache, and a lightweight fallback classifier in the PR review path. The current gap is correctness: review output can still describe an obviously experienced contributor as a newcomer because stored profile tiers, recalculation behavior, cache reuse, and runtime fallback are not aligned truthfully.

## Architecture / Key Patterns

- **Entrypoint:** Hono HTTP server (`src/index.ts`) receiving GitHub webhooks + Slack events
- **Execution:** Azure Container App Jobs dispatch per review; agent writes `result.json` to shared Azure Files mount
- **Review flow:** `src/handlers/review.ts` orchestrates PR analysis, author classification, prompt construction, output filtering, and GitHub publication
- **Author classification split today:**
  - `src/contributor/` — persistent contributor profiles, expertise scoring, percentile-based tier calculation, profile store
  - `src/lib/author-classifier.ts` — lightweight PR-time fallback classifier based on author association + merged PR count
  - `src/handlers/review.ts` — prefers contributor profile store, then knowledge-store author cache, then live fallback classification
  - `src/execution/review-prompt.ts` — maps the resulting tier into review tone / explanation guidance
- **Persistence / caches:**
  - contributor profile state in Postgres via `src/contributor/profile-store.ts`
  - author-tier cache in `knowledgeStore` used by the review path
- **Established pattern:** fail-open review execution — enrichment failures should not block review completion, but they must not produce obviously false review context

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract, requirement status, and coverage mapping.

## Milestone Sequence

- [x] M001–M041: MVP through Canonical Repo-Code Corpus and Structural Impact work
- [ ] M042: Contributor Tier Truthfulness — fix persistent contributor-tier advancement, review-surface author labeling, and cache/fallback consistency so experienced contributors are not misclassified as newcomers
