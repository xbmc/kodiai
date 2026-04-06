# Kodiai

## What This Is

Kodiai is an AI-powered GitHub bot that reviews pull requests, triages issues, answers questions via Slack, and runs autonomous coding tasks (write mode). It watches GitHub webhooks, runs Claude via the Anthropic Agent SDK in isolated Azure Container App jobs, and posts structured findings back to GitHub comments and Slack.

## Core Value

Automated, high-signal code review on every PR — findings land in a structured GitHub comment with severity, confidence, suppression, reviewer context, bounded review details, and truthful author-context guidance.

## Current State

M001–M041 are complete. M042 is now complete through S03.

Kodiai can now carry contributor-tier truthfulness across the full M042 path:
- scorer-side expertise updates recalculate and persist truthful contributor tiers when overall scores advance
- review rendering prefers contributor-profile state over cache and fallback classification
- prompt and Review Details surfaces render explicit established/senior/developing guidance without regressing to newcomer copy for advanced contributors
- author-tier cache reuse is bounded to fallback-taxonomy values only, so stale or malformed cache rows cannot overclaim contributor seniority
- degraded/retry review paths preserve the same resolved author tier and thread the exact Search API degradation disclosure sentence without contradicting the rendered author guidance
- deterministic proof harnesses now cover all three slices: persistence/source-of-truth (`verify:m042:s01`), review-surface truthfulness (`verify:m042:s02`), and cache/fallback hardening (`verify:m042:s03`)

The CrystalP-shaped regression is therefore covered at persistence time, render time, and cache/degradation time, with slice verifiers that milestone closure can rerun unchanged.

## Architecture / Key Patterns

- **Entrypoint:** Hono HTTP server (`src/index.ts`) receiving GitHub webhooks + Slack events
- **Execution:** Azure Container App Jobs dispatch per review; agent writes `result.json` to shared Azure Files mount
- **Review flow:** `src/handlers/review.ts` orchestrates PR analysis, author classification, prompt construction, output filtering, and GitHub publication
- **Contributor-tier truthfulness path after M042:**
  - `src/contributor/` — persistent contributor profiles, expertise scoring, percentile-based tier calculation, profile store
  - `src/contributor/expertise-scorer.ts` — score updates recalculate a target tier from the current score distribution before persisting
  - `src/contributor/tier-calculator.ts` — canonical percentile assignment helpers shared by batch recalculation and scorer-side updates
  - `src/handlers/review.ts` — resolves author tier through explicit precedence: contributor profile → bounded author cache → fallback classifier
  - `src/knowledge/store.ts` / `src/knowledge/types.ts` — author-cache contract is bounded to fallback-taxonomy values (`first-time`, `regular`, `core`)
  - `src/lib/author-classifier.ts` — lightweight PR-time fallback classifier used only when higher-fidelity state is unavailable
  - `src/execution/review-prompt.ts` — maps the resolved tier into prompt author-experience guidance, with explicit established/senior wording and a stable degradation disclosure sentence for Search API fallback
  - `src/lib/review-utils.ts` — renders Review Details with an explicit `Author tier:` line and guidance label derived from the resolved tier
  - `scripts/verify-m042-s01.ts`, `scripts/verify-m042-s02.ts`, `scripts/verify-m042-s03.ts` — deterministic proof harnesses for persistence truthfulness, review-surface truthfulness, and cache/fallback truthfulness
- **Established pattern:** fix contributor-experience truthfulness at the persistent source-of-truth layer first, then make render surfaces consume that state explicitly, then bound cache/degradation behavior so lower-fidelity paths cannot overclaim what only contributor-profile state can prove

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract, requirement status, and coverage mapping.

## Milestone Sequence

- [x] M001–M041: MVP through Canonical Repo-Code Corpus and Structural Impact work
- [x] M042: Contributor Tier Truthfulness
  - [x] S01: Repro and Tier-State Correction
  - [x] S02: Review-Surface Truthfulness Wiring
  - [x] S03: Cache, Fallback, and Regression Hardening
