---
estimated_steps: 5
estimated_files: 1
---

# T01: Write architecture.md — system design and module map

**Slice:** S03 — Architecture & Operations Docs
**Milestone:** M026

## Description

Create docs/architecture.md that explains the Kodiai system design for open-source contributors. Covers system overview, module map, request lifecycles (review and mention), data layer, and key abstractions. References the knowledge system at a high level and defers detail to the future docs/knowledge-system.md (S04).

## Steps

1. Read `src/index.ts` to understand full dependency graph and initialization order
2. Read key entry points: `src/webhook/router.ts`, `src/handlers/review.ts` (first ~100 lines for flow), `src/handlers/mention.ts` (first ~100 lines for flow), `src/execution/executor.ts`
3. Write docs/architecture.md with these sections:
   - **Overview** — what Kodiai is, high-level architecture (webhook-driven GitHub App)
   - **Module Map** — table of all 20+ src/ directories with purpose and key files
   - **Request Lifecycle: Code Review** — webhook → verify → dedup → filter → route → handler → job queue → workspace → config → diff → prompt → executor → LLM → publish
   - **Request Lifecycle: Mentions** — webhook → containsMention → handler → job → workspace → context build → executor with MCP → sanitize → publish
   - **Data Layer** — PostgreSQL with pgvector, single connection pool, migrations
   - **Key Abstractions** — stores, retriever, task router, executor, job queue, workspace manager
   - **Knowledge System** — one-paragraph overview of 5-corpus retrieval with forward link to docs/knowledge-system.md
4. Ensure all directory names and file references match current codebase (post-S01/S02 state)
5. Verify the doc has the right sections and sufficient depth

## Must-Haves

- [ ] System overview explains Kodiai as a webhook-driven GitHub App
- [ ] Module map covers all major src/ directories (≥15 entries)
- [ ] Review request lifecycle documented end-to-end (12 steps)
- [ ] Mention request lifecycle documented end-to-end
- [ ] Data layer section covers PostgreSQL + pgvector
- [ ] Knowledge system referenced at high level with forward link to docs/knowledge-system.md
- [ ] Audience is contributors, not operators — explains "how it works" not "how to debug"

## Verification

- `test -f docs/architecture.md` — file exists
- `grep -c '##' docs/architecture.md` — returns ≥5 (multiple sections)
- `grep -c 'knowledge-system.md' docs/architecture.md` — returns ≥1 (forward link present)
- `grep -c 'PostgreSQL\|pgvector' docs/architecture.md` — returns ≥1 (data layer covered)

## Observability Impact

- Signals added/changed: None
- How a future agent inspects this: None
- Failure state exposed: None

## Inputs

- `src/index.ts` — full initialization and wiring graph (774 lines)
- `src/webhook/router.ts` — event routing pattern
- `src/handlers/review.ts` — review handler flow (read top ~100 lines)
- `src/handlers/mention.ts` — mention handler flow (read top ~100 lines)
- `src/execution/executor.ts` — LLM execution engine
- S03-RESEARCH.md module map and request lifecycle sections

## Expected Output

- `docs/architecture.md` — comprehensive architecture documentation covering system design, module boundaries, request lifecycles, and data layer
