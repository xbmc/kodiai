---
id: T02
parent: S03
milestone: M026
provides:
  - docs/configuration.md — complete .kodiai.yml reference with all fields, types, defaults, and examples
key_files:
  - docs/configuration.md
key_decisions:
  - Used table format for field metadata (type/range/default) for scanability
  - Documented deprecated shareGlobal field with migration note to sharing.enabled
patterns_established:
  - Field documentation pattern: heading → metadata table → description → example (when useful)
observability_surfaces:
  - none
duration: 15m
verification_result: passed
completed_at: 2026-03-11
blocker_discovered: false
---

# T02: Write configuration.md — complete .kodiai.yml reference

**Created docs/configuration.md documenting every .kodiai.yml option from the Zod schema with types, defaults, ranges, descriptions, and usage examples.**

## What Happened

Read all 911 lines of `src/execution/config.ts` and systematically documented every Zod schema field. The doc covers all 14 top-level config sections (model, maxTurns, timeoutSeconds, systemPromptAppend, models, defaultModel, defaultFallbackModel, review, mention, write, knowledge, telemetry, languageRules, largePR, feedback, timeout, triage, guardrails) with every nested field documented including types, ranges, and defaults matching the schema exactly.

Included:
- Quick-start example YAML at the top showing common configuration
- Two-pass safeParse loading behavior explanation
- All ~25 review fields including triggers, suppressions (both simple and structured), prioritization weights, pathInstructions, fileCategories
- All mention fields including conversation limits
- All write fields including default deny list and secretScan
- Full knowledge tree: sharing, embeddings, retrieval with hunkEmbedding sub-config
- All triage fields including troubleshooting retrieval config
- Environment variables section pointing to .env.example (not duplicating it)

## Verification

- `test -f docs/configuration.md` → PASS
- `grep -c '##' docs/configuration.md` → 81 (≥8 required)
- `grep -c 'model|review|mention|knowledge|write|triage|guardrails|feedback|telemetry' docs/configuration.md` → 133 (≥9 required)
- Two-pass safeParse behavior documented (2 references)
- .env.example referenced (2 references)
- Slice checks: architecture.md exists (PASS), configuration.md exists (PASS), docs/README.md not yet (T03)

## Diagnostics

None — documentation-only task with no runtime changes.

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `docs/configuration.md` — complete .kodiai.yml reference documentation (all 14 top-level sections, ~80 documented fields)
