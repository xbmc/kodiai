# S03: Architecture & Operations Docs — UAT

**Milestone:** M026
**Written:** 2026-03-11

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: This slice produces only documentation files with no runtime changes — verification is file existence, structural completeness, and cross-reference integrity

## Preconditions

- Repository cloned with docs/ directory accessible
- S01 completed (deployment.md moved to docs/)

## Smoke Test

`test -f docs/architecture.md && test -f docs/configuration.md && test -f docs/README.md && echo PASS`

## Test Cases

### 1. Architecture doc exists with comprehensive structure

1. `test -f docs/architecture.md`
2. `grep -c '##' docs/architecture.md`
3. **Expected:** File exists; section count ≥5 (actual: 22)

### 2. Configuration doc covers all major config sections

1. `test -f docs/configuration.md`
2. `grep -c 'model\|review\|mention\|knowledge\|write\|triage\|guardrails\|feedback\|telemetry' docs/configuration.md`
3. **Expected:** File exists; keyword count ≥9 (actual: 133)

### 3. Docs index links all documentation

1. `test -f docs/README.md`
2. `grep -l 'architecture.md' docs/README.md`
3. `grep -l 'configuration.md' docs/README.md`
4. `grep -l 'deployment.md' docs/README.md`
5. `grep -l 'runbooks/' docs/README.md`
6. **Expected:** All grep commands find matches

### 4. Deployment doc has cross-links

1. `grep -c 'architecture.md\|configuration.md' docs/deployment.md`
2. **Expected:** Count ≥2

### 5. Architecture doc references knowledge system

1. `grep -c 'knowledge-system.md' docs/architecture.md`
2. **Expected:** Count ≥1 (forward link to S04 output)

## Edge Cases

### Broken forward links

1. `test -f docs/knowledge-system.md`
2. **Expected:** File does NOT exist yet — this is a known forward link that S04 will resolve

## Failure Signals

- Any of the 4 documentation files missing from docs/
- architecture.md with fewer than 5 ## sections
- configuration.md missing major config keywords (model, review, mention, knowledge, write, triage, guardrails)
- docs/README.md missing links to architecture.md, configuration.md, deployment.md, or runbooks/

## Requirements Proved By This UAT

- R008 — Architecture documentation: docs/architecture.md exists with system design, module map (20 entries), review lifecycle, mention lifecycle, data layer, and key abstractions
- R009 — Configuration reference documentation: docs/configuration.md documents every .kodiai.yml option from Zod schema with types, defaults, and descriptions
- R011 — Deployment and operations documentation: docs/deployment.md consolidated in docs/ with cross-links; docs/README.md indexes all 17 docs files

## Not Proven By This UAT

- Documentation accuracy vs runtime behavior (no live runtime verification — this is documentation only)
- Forward links to knowledge-system.md (created by S04)
- R007 (comprehensive README) — partially advanced but completed by S05
- R010 (knowledge system docs) — deferred to S04
- R012 (contributing guide) — deferred to S05

## Notes for Tester

- Read-through of architecture.md and configuration.md for accuracy is the primary human verification
- The docs/README.md Knowledge System section says "Coming soon" — this is intentional, S04 fills it
- configuration.md was hand-written from the Zod schema; spot-check a few fields against src/execution/config.ts for accuracy
