# S03: Architecture & Operations Docs

**Goal:** Write architecture, configuration, and deployment documentation that lets an open-source contributor understand the system without reading source code.
**Demo:** docs/ contains architecture.md, configuration.md, updated deployment.md, and README.md index linking all docs including existing runbooks and smoke records.

## Must-Haves

- docs/architecture.md explains system design, module map, request lifecycle, data layer, and key abstractions
- docs/configuration.md documents every .kodiai.yml option with type, default, and description (matching src/execution/config.ts Zod schema)
- docs/deployment.md reviewed for accuracy and cross-linked to other docs
- docs/README.md indexes all docs files (new conceptual docs + existing runbooks + smoke records)
- Architecture doc references knowledge system at high level and defers details to S04's docs/knowledge-system.md
- Audience is open-source contributors, not operators

## Proof Level

- This slice proves: contract (file existence, content structure, cross-reference integrity)
- Real runtime required: no
- Human/UAT required: yes (read-through for accuracy and completeness — per milestone verification classes)

## Verification

- `test -f docs/architecture.md && echo PASS` — architecture doc exists
- `test -f docs/configuration.md && echo PASS` — configuration doc exists
- `test -f docs/README.md && echo PASS` — docs index exists
- `grep -c '##' docs/architecture.md` — has multiple sections (≥5)
- `grep -c '##' docs/configuration.md` — has multiple sections (≥8, one per top-level config key)
- `grep -l 'architecture.md' docs/README.md` — index links to architecture doc
- `grep -l 'configuration.md' docs/README.md` — index links to configuration doc
- `grep -l 'deployment.md' docs/README.md` — index links to deployment doc
- `grep -l 'runbooks/' docs/README.md` — index links to runbooks
- `grep -c 'model\|review\|mention\|knowledge\|write\|triage\|guardrails\|feedback\|telemetry' docs/configuration.md` — covers all major config sections (≥9)

## Observability / Diagnostics

- Runtime signals: none (documentation-only slice, no runtime changes)
- Inspection surfaces: none
- Failure visibility: none
- Redaction constraints: none

## Integration Closure

- Upstream surfaces consumed: `docs/deployment.md` (moved by S01), `src/execution/config.ts` (Zod schema), `src/index.ts` (wiring graph), `.env.example` (env var reference)
- New wiring introduced in this slice: none (pure documentation)
- What remains before the milestone is truly usable end-to-end: S04 (knowledge-system.md, issue-intelligence.md, guardrails.md), S05 (README rewrite, CONTRIBUTING.md, CHANGELOG.md)

## Tasks

- [x] **T01: Write architecture.md — system design and module map** `est:45m`
  - Why: R008 — no architectural documentation exists; contributors must read 212 source files to understand the system
  - Files: `docs/architecture.md`
  - Do: Write system overview, module map table (20+ directories), request lifecycle (review and mention flows), data layer description, key abstractions (stores, retriever, task router, executor). Reference knowledge system at high level and defer to future docs/knowledge-system.md. Source from src/index.ts (wiring), research module map, and research request lifecycle.
  - Verify: `test -f docs/architecture.md && grep -c '##' docs/architecture.md` returns ≥5
  - Done when: architecture.md has system overview, module map, review lifecycle, mention lifecycle, data layer, and key abstractions sections

- [x] **T02: Write configuration.md — complete .kodiai.yml reference** `est:45m`
  - Why: R009 — users have no reference for config options; only way to learn is reading 911 lines of Zod schema
  - Files: `docs/configuration.md`, `src/execution/config.ts`
  - Do: Read src/execution/config.ts Zod schema systematically. Document every top-level section (model, maxTurns, timeoutSeconds, systemPromptAppend, models, defaultModel, defaultFallbackModel, write, review, mention, telemetry, knowledge, languageRules, largePR, feedback, timeout, triage, guardrails) with type, default, and description. Include nested fields. Separate from env var config (point to .env.example for that). Add usage examples for common configurations.
  - Verify: `grep -c 'model\|review\|mention\|knowledge\|write\|triage\|guardrails\|feedback\|telemetry' docs/configuration.md` returns ≥9
  - Done when: Every top-level .kodiai.yml key documented with type and default; nested fields covered for review, mention, write, and knowledge sections

- [x] **T03: Update deployment.md and write docs/README.md index** `est:20m`
  - Why: R011 — deployment.md needs cross-links; existing runbooks/smoke records are undiscoverable without an index
  - Files: `docs/deployment.md`, `docs/README.md`
  - Do: Review deployment.md for accuracy against current .env.example and deploy patterns. Add cross-links to architecture.md and configuration.md. Write docs/README.md as an index page with sections: Conceptual Docs (architecture, configuration, deployment), Knowledge System (placeholder for S04), Operational Runbooks (6 runbooks), Smoke Tests & UAT Records (7 smoke records), and GRACEFUL-RESTART-RUNBOOK.md.
  - Verify: `test -f docs/README.md && grep -c 'runbooks/' docs/README.md` returns ≥1; `grep -l 'architecture.md' docs/README.md` finds the file
  - Done when: docs/README.md links all 16+ docs files; deployment.md has cross-links to architecture.md and configuration.md

## Files Likely Touched

- `docs/architecture.md` (new)
- `docs/configuration.md` (new)
- `docs/deployment.md` (updated with cross-links)
- `docs/README.md` (new)
