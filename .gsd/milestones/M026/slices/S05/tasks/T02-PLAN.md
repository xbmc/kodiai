---
estimated_steps: 3
estimated_files: 1
---

# T02: Create CONTRIBUTING.md

**Slice:** S05 — README, Contributing & Changelog
**Milestone:** M026

## Description

Create CONTRIBUTING.md at project root. This file does not exist yet. It should cover development setup prerequisites, running tests, code style conventions, PR process, and module ownership overview pointing to docs/architecture.md. Must reflect actual project tooling: Bun (not npm/yarn), bun:test, TEST_DATABASE_URL for DB test skipping, TypeScript strict mode, pino structured logging, and Zod schemas.

## Steps

1. Read package.json scripts section and bunfig.toml for accurate dev/test commands
2. Write CONTRIBUTING.md with sections: Getting Started (prerequisites: Bun, Git; optional: PostgreSQL), Development Setup (clone, bun install, cp .env.example .env, configure), Running the App (bun run dev, bun run start), Testing (bun test, TEST_DATABASE_URL for DB tests, describe.skipIf pattern), Code Style (TypeScript strict via tsconfig, pino logging not console.log, Zod for validation, bun:test for tests), PR Process (branch from main, descriptive commits, tests pass), Project Structure (point to docs/architecture.md for module map)
3. Verify file exists with expected content markers

## Must-Haves

- [ ] CONTRIBUTING.md exists at project root
- [ ] Covers dev prerequisites (Bun, Git)
- [ ] Documents bun test and TEST_DATABASE_URL skip pattern
- [ ] References docs/architecture.md for project structure
- [ ] Documents code style conventions (TypeScript strict, pino, Zod)
- [ ] Does not reference a LICENSE file (none exists)

## Verification

- `test -f CONTRIBUTING.md` — exists
- `grep -c 'bun test' CONTRIBUTING.md` — ≥ 1
- `grep -c 'TEST_DATABASE_URL' CONTRIBUTING.md` — ≥ 1
- `grep -c 'architecture.md' CONTRIBUTING.md` — ≥ 1
- `grep -c 'LICENSE' CONTRIBUTING.md` — 0 (no license reference)

## Observability Impact

- Signals added/changed: None
- How a future agent inspects this: Read CONTRIBUTING.md
- Failure state exposed: None

## Inputs

- `package.json` — scripts section for accurate dev/test commands
- `bunfig.toml` — test configuration
- `.env.example` — environment variable reference
- `tsconfig.json` — TypeScript configuration for code style section
- S03 forward intelligence: docs/architecture.md has 20-entry module map for contributor orientation

## Expected Output

- `CONTRIBUTING.md` — new file at project root with complete contributor guide
