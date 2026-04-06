# Kodiai

## What This Is

Kodiai is an AI-powered GitHub bot that reviews pull requests, triages issues, answers questions via Slack, and runs autonomous coding tasks (write mode). It watches GitHub webhooks, runs Claude via the Anthropic Agent SDK in isolated Azure Container App jobs, and posts structured findings back to GitHub comments and Slack.

## Core Value

Automated, high-signal code review on every PR — findings land in a structured GitHub comment with severity, confidence, suppression, reviewer context, bounded review details, and truthful author-context guidance.

## Current State

M001–M041 are complete. M042 is in progress.

M042/S01 and M042/S02 are now complete. Kodiai can reproduce the CrystalP-shaped contributor-tier defect, recalculate contributor tiers truthfully when overall scores change, persist the recalculated tier as the stored source of truth, and render that corrected tier into the main review surfaces. The prompt author-experience section and Review Details output now distinguish established and senior contributors explicitly, and the M042/S02 proof harness locks the contributor-profile precedence plus the established-tier prompt/details wording against newcomer and developing regressions.

The remaining M042 work is cache and fallback hardening: S03 needs to prove that cached author-tier reuse and degraded fallback classification preserve truthful contributor labeling across repeated review runs and regression cases.

## Architecture / Key Patterns

- **Entrypoint:** Hono HTTP server (`src/index.ts`) receiving GitHub webhooks + Slack events
- **Execution:** Azure Container App Jobs dispatch per review; agent writes `result.json` to shared Azure Files mount
- **Review flow:** `src/handlers/review.ts` orchestrates PR analysis, author classification, prompt construction, output filtering, and GitHub publication
- **Author classification path after M042/S02:**
  - `src/contributor/` — persistent contributor profiles, expertise scoring, percentile-based tier calculation, profile store
  - `src/contributor/expertise-scorer.ts` — score updates recalculate a target tier from the current score distribution before persisting
  - `src/contributor/tier-calculator.ts` — canonical percentile assignment helpers shared by batch recalculation and scorer-side updates
  - `src/handlers/review.ts` — resolves author tier through explicit precedence: contributor profile → author cache → fallback classifier
  - `src/lib/author-classifier.ts` — lightweight PR-time fallback classifier used only when higher-fidelity state is unavailable
  - `src/execution/review-prompt.ts` — maps the resolved tier into prompt author-experience guidance, with explicit established/senior wording guarded against newcomer/developing regressions
  - `src/lib/review-utils.ts` — renders Review Details with an explicit `Author tier:` line and guidance label derived from the resolved tier
  - `scripts/verify-m042-s01.ts` / `scripts/verify-m042-s02.ts` — deterministic proof harnesses for tier persistence/preference and review-surface truthfulness
- **Persistence / caches:**
  - contributor profile state in Postgres via `src/contributor/profile-store.ts`
  - author-tier cache in `knowledgeStore` used by the review path
- **Established pattern:** fix contributor-experience truthfulness at the persistent source-of-truth layer first, then make render surfaces consume that state explicitly; keep review execution fail-open when enrichment or recalculation dependencies degrade

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract, requirement status, and coverage mapping.

## Milestone Sequence

- [x] M001–M041: MVP through Canonical Repo-Code Corpus and Structural Impact work
- [ ] M042: Contributor Tier Truthfulness
  - [x] S01: Repro and Tier-State Correction
  - [x] S02: Review-Surface Truthfulness Wiring
  - [ ] S03: Cache, Fallback, and Regression Hardening
