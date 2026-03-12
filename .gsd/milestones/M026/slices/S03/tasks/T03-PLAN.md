---
estimated_steps: 4
estimated_files: 2
---

# T03: Update deployment.md and write docs/README.md index

**Slice:** S03 — Architecture & Operations Docs
**Milestone:** M026

## Description

Review docs/deployment.md for accuracy and add cross-links to the new docs. Write docs/README.md as a comprehensive index page linking all documentation — new conceptual docs, existing runbooks, smoke test records, and the graceful restart runbook.

## Steps

1. Read `docs/deployment.md` and review against `.env.example` and current deploy patterns — fix any stale information, add cross-links to architecture.md and configuration.md
2. Inventory all existing docs files: 6 runbooks in docs/runbooks/, 7 smoke records in docs/smoke/, GRACEFUL-RESTART-RUNBOOK.md
3. Write docs/README.md with sections:
   - **Kodiai Documentation** — brief intro
   - **Architecture & Design** — links to architecture.md, configuration.md
   - **Deployment & Operations** — links to deployment.md, GRACEFUL-RESTART-RUNBOOK.md
   - **Knowledge System** — placeholder noting "Coming soon" (S04 will add knowledge-system.md, issue-intelligence.md, guardrails.md)
   - **Operational Runbooks** — links to all 6 runbooks with brief descriptions
   - **Smoke Tests & UAT Records** — links to all 7 smoke/UAT records
4. Run all slice verification checks to confirm everything passes

## Must-Haves

- [ ] docs/deployment.md has cross-links to architecture.md and configuration.md
- [ ] docs/README.md links to all 16+ existing docs files
- [ ] Index has sections for conceptual docs, deployment, runbooks, and smoke records
- [ ] Knowledge system placeholder section for S04 forward-compatibility
- [ ] All slice verification checks pass

## Verification

- `test -f docs/README.md` — index file exists
- `grep -c 'architecture.md' docs/README.md` — returns ≥1
- `grep -c 'configuration.md' docs/README.md` — returns ≥1
- `grep -c 'deployment.md' docs/README.md` — returns ≥1
- `grep -c 'runbooks/' docs/README.md` — returns ≥1
- `grep -c 'architecture.md\|configuration.md' docs/deployment.md` — returns ≥1 (cross-links added)

## Observability Impact

- Signals added/changed: None
- How a future agent inspects this: None
- Failure state exposed: None

## Inputs

- `docs/deployment.md` — existing deployment doc (moved by S01)
- `docs/architecture.md` — created by T01
- `docs/configuration.md` — created by T02
- Existing runbooks and smoke records in docs/runbooks/ and docs/smoke/

## Expected Output

- `docs/deployment.md` — updated with cross-links
- `docs/README.md` — comprehensive index linking all documentation files
