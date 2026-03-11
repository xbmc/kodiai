---
id: T02
parent: S01
milestone: M026
provides:
  - .gitignore covers data/ and .planning/ directories
  - .env.example documents all 26 env vars with categories and required/optional markers
  - deployment.md moved to docs/
key_files:
  - .gitignore
  - .env.example
  - docs/deployment.md
key_decisions:
  - Listed GITHUB_PRIVATE_KEY and GITHUB_PRIVATE_KEY_BASE64 as separate entries (both marked required* as alternatives) rather than collapsing them
patterns_established: []
observability_surfaces:
  - none
duration: ~3min
verification_result: passed
completed_at: 2026-03-11
blocker_discovered: false
---

# T02: Update .gitignore, expand .env.example, and move deployment.md

**Added data/ and .planning/ to .gitignore, rewrote .env.example with 26 documented env vars, and moved deployment.md to docs/.**

## What Happened

Three config-level hygiene changes:

1. Added `data/` and `.planning/` entries to `.gitignore` with descriptive comments.
2. Rewrote `.env.example` from 7 vars to 26 vars, organized into 9 category sections (GitHub App, Claude Code, Server, Database, Slack, Wiki, Bot User, Embeddings, Telemetry/Internal). Each var has a required/optional/internal marker and a brief description. CLAUDE_CODE_ENTRYPOINT is marked as internal/set-automatically.
3. Created `docs/` directory and ran `git mv deployment.md docs/deployment.md`.

## Verification

All task-level checks passed:
- `grep -q 'data/' .gitignore` → PASS
- `grep -q '.planning/' .gitignore` → PASS
- `grep -c '^[A-Z_]*=' .env.example` → 26 (≥24 ✓)
- `grep -c 'required\|optional\|internal' .env.example` → 29 (≥20 ✓)
- `test -f docs/deployment.md` → PASS
- `test -f deployment.md` → PASS (gone)

Slice-level checks passing so far (from T01 + T02):
- db-path.ts gone ✓
- test-delta-verification.ts gone ✓
- SQLite refs in types.ts: 0 ✓
- .gitignore data/ ✓
- .gitignore .planning/ ✓
- .env.example vars: 26 ✓
- docs/deployment.md exists ✓
- root deployment.md gone ✓

Remaining slice checks (for later tasks): .planning/ git removal, merged branch cleanup, README .planning/ reference removal.

## Diagnostics

None — no runtime changes.

## Deviations

The research inventory listed 24 env vars but after listing GITHUB_PRIVATE_KEY and GITHUB_PRIVATE_KEY_BASE64 as separate entries (they're alternatives), the total came to 26. This is a net positive.

## Known Issues

None.

## Files Created/Modified

- `.gitignore` — Added `data/` and `.planning/` entries
- `.env.example` — Rewritten with 26 documented env vars in 9 categories
- `docs/deployment.md` — Moved from project root via `git mv`
