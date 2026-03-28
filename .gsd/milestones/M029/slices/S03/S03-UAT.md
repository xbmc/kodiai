# S03 UAT Script — Issue Cleanup Script

**Slice:** M029/S03  
**Script under test:** `scripts/cleanup-wiki-issue.ts`  
**Preconditions for auth-free checks:** Bun installed, repo checked out, `bun install` already run.  
**Preconditions for live checks:** `GITHUB_APP_ID` and `GITHUB_PRIVATE_KEY` env vars set with a GitHub App that has installation access to `xbmc/wiki`.

---

## TC-01: Help output

**What it tests:** `--help` flag exits 0 and prints complete usage information.

**Steps:**
1. `bun scripts/cleanup-wiki-issue.ts --help`

**Expected outcome:**
- Exit code: 0
- Stdout contains: `--owner`, `--repo`, `--issue-number`, `--delete-all`, `--dry-run`, `--no-dry-run`
- Stdout contains the marker string: `<!-- kodiai:wiki-modification:`
- Stdout contains the two example commands

---

## TC-02: TypeScript syntax check

**What it tests:** Script compiles cleanly under Bun's parser.

**Steps:**
1. `bun --check scripts/cleanup-wiki-issue.ts`

**Expected outcome:**
- Exit code: 0
- No output (no syntax errors)

---

## TC-03: Required arg validation — missing `--issue-number`

**What it tests:** Script exits 1 with a clear error when `--issue-number` is omitted.

**Steps:**
1. `bun scripts/cleanup-wiki-issue.ts --owner xbmc --repo wiki`

**Expected outcome:**
- Exit code: 1
- Stdout/stderr contains: `ERROR: --issue-number is required`

---

## TC-04: Required arg validation — invalid `--issue-number`

**What it tests:** Script rejects non-integer `--issue-number` values.

**Steps:**
1. `bun scripts/cleanup-wiki-issue.ts --owner xbmc --repo wiki --issue-number abc`
2. `bun scripts/cleanup-wiki-issue.ts --owner xbmc --repo wiki --issue-number 0`
3. `bun scripts/cleanup-wiki-issue.ts --owner xbmc --repo wiki --issue-number -5`

**Expected outcome:**
- All three: exit code 1
- Output contains: `ERROR: --issue-number must be a positive integer`

---

## TC-05: Required arg validation — missing `--owner`

**What it tests:** Script exits 1 when `--owner` is omitted.

**Steps:**
1. `bun scripts/cleanup-wiki-issue.ts --repo wiki --issue-number 5`

**Expected outcome:**
- Exit code: 1
- Output contains: `ERROR: --owner is required`

---

## TC-06: Required arg validation — missing `--repo`

**What it tests:** Script exits 1 when `--repo` is omitted.

**Steps:**
1. `bun scripts/cleanup-wiki-issue.ts --owner xbmc --issue-number 5`

**Expected outcome:**
- Exit code: 1
- Output contains: `ERROR: --repo is required`

---

## TC-07: Dry-run is the default (no mutation without explicit opt-in)

**What it tests:** Script runs in dry-run mode when neither `--dry-run` nor `--no-dry-run` is passed.

**Steps:**
1. `bun scripts/cleanup-wiki-issue.ts --owner xbmc --repo wiki --issue-number 5` (requires live credentials)

**Expected outcome:**
- Exit code: 0
- Output lines are prefixed `[DRY RUN]` — no `[DELETED]` lines
- `--- Summary ---` block present with `Deleted: 0`
- No GitHub API DELETE calls made (GitHub comment count unchanged)

---

## TC-08: Live dry-run lists non-marked comments (requires credentials)

**What it tests:** Default mode identifies comments lacking the `<!-- kodiai:wiki-modification:` marker.

**Preconditions:** `GITHUB_APP_ID` and `GITHUB_PRIVATE_KEY` set. xbmc/wiki issue #5 must exist.

**Steps:**
1. `bun scripts/cleanup-wiki-issue.ts --owner xbmc --repo wiki --issue-number 5 --dry-run`

**Expected outcome:**
- Exit code: 0
- Each comment is printed with `[DRY RUN]` prefix, its comment ID, and a body snippet
- Non-marked comments show reason `no-marker`
- Marked comments (with `<!-- kodiai:wiki-modification:`) are NOT listed as targets
- `--- Summary ---` block shows: `Total: N`, `Targets: M`, `Deleted: 0`, `Errors: 0`
- No mutations to the issue

---

## TC-09: `--delete-all` mode targets ALL comments in dry-run

**What it tests:** `--delete-all` flag overrides marker filter to target every comment.

**Preconditions:** `GITHUB_APP_ID` and `GITHUB_PRIVATE_KEY` set.

**Steps:**
1. `bun scripts/cleanup-wiki-issue.ts --owner xbmc --repo wiki --issue-number 5 --delete-all --dry-run`

**Expected outcome:**
- Exit code: 0
- Every comment on the issue is listed as a `[DRY RUN]` target (including marker-bearing ones)
- Targets count equals Total count (all comments targeted)
- No mutations

---

## TC-10: Summary block always present

**What it tests:** `--- Summary ---` block is emitted regardless of dry-run vs live mode.

**Steps:**
1. Run any of TC-07, TC-08, TC-09
2. Pipe output through `grep "Summary"`

**Expected outcome:**
- Output contains `--- Summary ---` followed by count lines
- Counts are numeric (not blank)

---

## TC-11: LOG_LEVEL=debug surfaces auth internals

**What it tests:** Debug logging emits additional context without mutating state.

**Preconditions:** `GITHUB_APP_ID` and `GITHUB_PRIVATE_KEY` set.

**Steps:**
1. `LOG_LEVEL=debug bun scripts/cleanup-wiki-issue.ts --owner xbmc --repo wiki --issue-number 5 --dry-run 2>&1 | head -50`

**Expected outcome:**
- Output includes pagination-related debug lines (page numbers or comment counts per page)
- Auth initialization is logged (app ID visible, private key NOT echoed)
- No mutations

---

## TC-12: `[FAILED]` prefix on auth failure

**What it tests:** Auth failures produce `[FAILED]` or `ERROR:` output, not silent failure.

**Steps:**
1. `GITHUB_APP_ID=999999 GITHUB_PRIVATE_KEY=invalid bun scripts/cleanup-wiki-issue.ts --owner xbmc --repo wiki --issue-number 5 --dry-run`

**Expected outcome:**
- Exit code: 1
- Output contains `ERROR:` or `[FAILED]` prefix
- `--- Summary ---` block still printed
- No mutations

---

## Edge Cases

**EC-01: Issue with zero comments**
- Script exits 0
- `--- Summary ---` shows `Total: 0`, `Targets: 0`, `Deleted: 0`, `Errors: 0`

**EC-02: All comments are properly marked**
- Default mode finds no targets
- `--- Summary ---` shows `Targets: 0`
- `[DRY RUN]` lines not printed (no targets)

**EC-03: `--no-dry-run` with `--dry-run` explicitly passed**
- `--no-dry-run` takes precedence (mutations are enabled)
- Per-comment lines use `[DELETED]` prefix (when comment found and deleted)
