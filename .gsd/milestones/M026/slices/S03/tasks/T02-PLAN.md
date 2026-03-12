---
estimated_steps: 4
estimated_files: 2
---

# T02: Write configuration.md — complete .kodiai.yml reference

**Slice:** S03 — Architecture & Operations Docs
**Milestone:** M026

## Description

Create docs/configuration.md documenting every `.kodiai.yml` option by systematically walking the Zod schema in `src/execution/config.ts`. Each top-level section gets its own documentation section with every field's type, default, and description. Separates repo config (.kodiai.yml) from app config (env vars, covered by .env.example).

## Steps

1. Read `src/execution/config.ts` fully — walk every Zod schema export to catalog all fields, types, defaults, and any JSDoc comments
2. Write docs/configuration.md with:
   - **Overview** — what .kodiai.yml is, where it lives, two-pass safeParse behavior
   - **Top-level Options** — model, maxTurns, timeoutSeconds, systemPromptAppend, models, defaultModel, defaultFallbackModel
   - **Review** section — all ~25 fields including triggers, autoApprove, skipPaths, severity, focusAreas, maxComments, suppressions, pathInstructions, profile, outputLanguage, prioritization
   - **Mention** section — enabled, acceptClaudeAlias, allowedUsers, prompt, conversation limits
   - **Write** section — enabled, allowPaths, denyPaths, minIntervalSeconds, secretScan
   - **Knowledge** section — shareGlobal, sharing, embeddings, retrieval with hunkEmbedding
   - **Telemetry** section — enabled, costWarningUsd
   - **Language Rules** section — severity floors, tooling overrides
   - **Large PR** section — triage thresholds, risk weights
   - **Feedback** section — auto-suppression thresholds
   - **Timeout** section — dynamic timeout config
   - **Triage** section — duplicateThreshold, labels, troubleshooting
   - **Guardrails** section — epistemic guardrail strictness
   - **Environment Variables** — brief note pointing to .env.example (not duplicating it)
3. Add a minimal example .kodiai.yml at the top showing common configuration
4. Verify all major config sections are covered by grepping for key terms

## Must-Haves

- [ ] Every top-level .kodiai.yml key has a documentation section
- [ ] Nested fields documented for review, mention, write, and knowledge sections
- [ ] Types and defaults match src/execution/config.ts Zod schema exactly
- [ ] Common .kodiai.yml example included
- [ ] Clear separation from env var config (points to .env.example)
- [ ] Two-pass safeParse behavior documented (full schema → per-section fallback)

## Verification

- `test -f docs/configuration.md` — file exists
- `grep -c '##' docs/configuration.md` — returns ≥8 (one per major section)
- `grep -c 'model\|review\|mention\|knowledge\|write\|triage\|guardrails\|feedback\|telemetry' docs/configuration.md` — returns ≥9

## Observability Impact

- Signals added/changed: None
- How a future agent inspects this: None
- Failure state exposed: None

## Inputs

- `src/execution/config.ts` — complete .kodiai.yml Zod schema (911 lines, source of truth)
- S03-RESEARCH.md configuration structure section

## Expected Output

- `docs/configuration.md` — complete .kodiai.yml reference documentation with all fields, types, defaults, and examples
