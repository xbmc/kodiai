# S02: kodi-addon-checker subprocess and output parsing — UAT

**Milestone:** M030
**Written:** 2026-03-28T16:11:21.771Z

# S02 UAT: kodi-addon-checker subprocess and output parsing

## Preconditions
- Working directory: `/home/keith/src/kodiai`
- `bun` installed
- No DB or network required — all tests use injectable stubs

---

## Test Case 1: Output parser — ANSI stripping and line classification

**What:** Verify `parseCheckerOutput` strips ANSI codes, classifies ERROR/WARN/INFO, ignores noise, and attaches addonId.

**Command:**
```
bun test src/lib/addon-checker-runner.test.ts --reporter=verbose
```

**Expected:**
- `classifies ERROR, WARN, and INFO lines` — pass
- `strips ANSI escape codes before parsing` — pass
- `ignores non-matching lines: XML schema noise, blank lines, debug output` — pass
- `attaches the provided addonId to every finding` — pass
- `returns empty array for empty input` — pass
- `handles mixed ANSI and non-ANSI lines in the same output` — pass

---

## Test Case 2: Branch resolver — valid and invalid branch names

**What:** Verify `resolveCheckerBranch` accepts all 10 Kodi release branches and rejects non-Kodi names.

**Expected (from same test run):**
- `returns the branch for each known Kodi version` — pass (covers all 10: nexus, omega, matrix, leia, jarvis, isengard, helix, gotham, frodo, dharma)
- `returns null for 'main'`, `'master'`, `'develop'`, empty string — pass
- `is case-sensitive — 'Nexus' is not a valid version` — pass
- `covers all 10 expected version names` — pass

---

## Test Case 3: Subprocess runner — tool-not-found

**What:** Verify `runAddonChecker` returns `{ toolNotFound: true }` when the subprocess stub returns `{ error: { code: 'ENOENT' } }`.

**Expected:**
- `returns toolNotFound: true when subprocess returns ENOENT error` — pass

---

## Test Case 4: Subprocess runner — timeout

**What:** Verify `runAddonChecker` returns `{ timedOut: true }` when the subprocess stub sleeps past the budget.

**Expected:**
- `returns timedOut: true when subprocess exceeds the time budget` — pass (11ms elapsed per test output)

---

## Test Case 5: Subprocess runner — non-zero exit is not failure

**What:** Verify `runAddonChecker` parses findings normally even when the subprocess exits with code 1 (kodi-addon-checker exits 1 when it finds violations).

**Expected:**
- `parses findings from stdout even when exit code is 1 (non-zero is not failure)` — pass
- Findings array is non-empty and contains the expected ERROR/WARN/INFO entries

---

## Test Case 6: Subprocess runner — args passthrough

**What:** Verify the subprocess is invoked with `['--branch', branch, addonDir]`.

**Expected:**
- `passes the branch and addonDir to the subprocess` — pass

---

## Test Case 7: Subprocess runner — non-ENOENT error fails open

**What:** Verify unexpected errors (e.g. OOM, permission denied) return `{ findings: [], timedOut: false, toolNotFound: false }` rather than throwing.

**Expected:**
- `returns empty findings on unexpected non-ENOENT error (fails open)` — pass

---

## Test Case 8: Handler — unknown base branch skips

**What:** Verify the handler warns and returns early when the PR base branch is not a known Kodi version (e.g., `main`).

**Command:**
```
bun test src/handlers/addon-check.test.ts --reporter=verbose
```

**Expected:**
- `unknown base branch warns and skips (does not enqueue)` — pass
- `jobQueue.enqueue` is NOT called
- warn log contains `'addon-check: unknown kodi branch, skipping'` with `baseBranch` binding

---

## Test Case 9: Handler — workspace created with head branch

**What:** Verify `workspaceManager.create` is called with the PR head ref (not base ref).

**Expected:**
- `workspace.create called with head branch on non-fork PR` — pass
- `workspaceManager.create` receives the `head.ref` value

---

## Test Case 10: Handler — runner called per addon with correct args

**What:** Verify `runAddonChecker` is called once per discovered addonId with `addonDir = path.join(workspace.dir, addonId)` and `branch = kodiVersion`.

**Expected:**
- `runner called per addon with correct addonDir and branch` — pass

---

## Test Case 11: Handler — findings logged with structured bindings

**What:** Verify each finding is logged with `addonId`, `level`, and `message` bindings at info level.

**Expected:**
- `findings logged with addonId, level, message bindings` — pass

---

## Test Case 12: Handler — cleanup called even on runner error

**What:** Verify `workspace.cleanup()` is called in the finally block even when an exception is thrown inside the job.

**Expected:**
- `workspace.cleanup called even when runner throws` — pass
- Workspace cleanup is unconditional regardless of runner success/failure

---

## Test Case 13: TypeScript integrity

**What:** Verify no type errors introduced by new files.

**Command:**
```
bun run tsc --noEmit
```

**Expected:** exit 0, no output

---

## Summary Execution

Run all three gates in sequence:

```bash
bun test src/lib/addon-checker-runner.test.ts
bun test src/handlers/addon-check.test.ts
bun run tsc --noEmit
```

**Expected totals:** 19 pass + 11 pass + tsc exit 0 — all gates green.
