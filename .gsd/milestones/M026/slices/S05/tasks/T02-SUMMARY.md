---
id: T02
parent: S05
milestone: M026
provides:
  - CONTRIBUTING.md with complete contributor guide
key_files:
  - CONTRIBUTING.md
key_decisions:
  - Showed describe.skipIf pattern with concrete code example rather than just describing it
patterns_established:
  - none
observability_surfaces:
  - none
duration: 1 step
verification_result: passed
completed_at: 2026-03-11
blocker_discovered: false
---

# T02: Create CONTRIBUTING.md

**Created CONTRIBUTING.md with dev setup, testing (including TEST_DATABASE_URL skip pattern), code style conventions, PR process, and architecture.md reference.**

## What Happened

Created CONTRIBUTING.md at project root covering all required sections: prerequisites (Bun, Git, optional PostgreSQL), development setup (clone, install, env config), running the app (dev/start scripts), testing (bun test, TEST_DATABASE_URL with describe.skipIf code example), code style (TypeScript strict, pino logging, Zod validation, bun:test), PR process, and project structure pointing to docs/architecture.md.

## Verification

- `test -f CONTRIBUTING.md` — pass
- `grep -c 'bun test' CONTRIBUTING.md` — 3 (≥ 1 ✓)
- `grep -c 'TEST_DATABASE_URL' CONTRIBUTING.md` — 4 (≥ 1 ✓)
- `grep -c 'architecture.md' CONTRIBUTING.md` — 1 (≥ 1 ✓)
- `grep -c 'LICENSE' CONTRIBUTING.md` — 0 (no license reference ✓)

### Slice-level checks passing after T02

- `test -f CONTRIBUTING.md` — pass
- `grep -c 'bun test' CONTRIBUTING.md` — pass
- `grep -c 'architecture.md' CONTRIBUTING.md` — pass

## Diagnostics

None — documentation-only change.

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `CONTRIBUTING.md` — new contributor guide at project root
