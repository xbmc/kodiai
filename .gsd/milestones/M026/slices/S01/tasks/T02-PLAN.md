---
estimated_steps: 5
estimated_files: 4
---

# T02: Update .gitignore, expand .env.example, and move deployment.md

**Slice:** S01 — Dead Code Removal & Repo Hygiene
**Milestone:** M026

## Description

Three config-level changes: (1) add data/ and .planning/ to .gitignore, (2) rewrite .env.example with all 24 env vars grouped and documented, (3) move deployment.md to docs/ for the S03 boundary.

## Steps

1. Add `data/` and `.planning/` entries to `.gitignore`
2. Rewrite `.env.example` with all 24 env vars from the research inventory, grouped by category (GitHub App, Claude, Server, Database, Slack, Wiki, Bot User, Telemetry/Internal), with required/optional markers and brief descriptions. Mark CLAUDE_CODE_ENTRYPOINT as internal/set-automatically.
3. Create `docs/` directory if it doesn't exist
4. `git mv deployment.md docs/deployment.md`
5. Commit: `chore(S01): update .gitignore, expand .env.example, move deployment.md`

## Must-Haves

- [ ] .gitignore has `data/` entry
- [ ] .gitignore has `.planning/` entry
- [ ] .env.example has 24+ env vars with descriptions
- [ ] Each var marked as required or optional
- [ ] Vars grouped by category with section headers
- [ ] docs/deployment.md exists (moved from root)
- [ ] Root deployment.md no longer exists

## Verification

- `grep -q 'data/' .gitignore && echo PASS` → PASS
- `grep -q '.planning/' .gitignore && echo PASS` → PASS
- `grep -c '^[A-Z_]*=' .env.example` → >= 24
- `grep -c 'required\|optional' .env.example` → >= 20
- `test -f docs/deployment.md && echo PASS` → PASS
- `test -f deployment.md && echo FAIL || echo PASS` → PASS

## Observability Impact

- Signals added/changed: None
- How a future agent inspects this: None
- Failure state exposed: None

## Inputs

- S01-RESEARCH.md env var inventory (24 vars with source files and required status)
- Current `.env.example` (7 vars)
- Current `.gitignore`
- `deployment.md` at project root (2.8KB)

## Expected Output

- `.gitignore` — 2 new entries added
- `.env.example` — rewritten with 24+ documented vars
- `docs/deployment.md` — moved from root
