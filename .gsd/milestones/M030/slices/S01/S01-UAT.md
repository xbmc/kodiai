# S01: Handler scaffold and repo detection — UAT

**Milestone:** M030
**Written:** 2026-03-28T15:46:15.395Z

# S01 UAT: Handler scaffold and repo detection

## Preconditions
- App is running with default `ADDON_REPOS` (xbmc/repo-plugins, xbmc/repo-scripts, xbmc/repo-scrapers)
- GitHub App installation exists for xbmc org

## Test Cases

### TC-01: Handler registers on both pull_request events
**What:** `createAddonCheckHandler` registers handlers for both `pull_request.opened` and `pull_request.synchronize`.
**How:** Inspect the EventRouter after calling `createAddonCheckHandler`. Both event keys must be present.
**Expected:** Router has entries for both `pull_request.opened` and `pull_request.synchronize`.
**Evidence:** Unit test `registers on pull_request.opened and pull_request.synchronize` — passes.

### TC-02: Non-addon repo produces no output
**What:** A PR on a repo not in `addonRepos` (e.g., `xbmc/xbmc`) triggers the handler but exits early without calling `listFiles`.
**How:** Trigger with `repository.full_name = "xbmc/xbmc"`, config `addonRepos = ["xbmc/repo-plugins"]`.
**Expected:** `listFiles` is never called. No info log emitted. Debug log confirms repo not in addonRepos.
**Evidence:** Unit test `non-addon repo returns without calling listFiles` — passes.

### TC-03: Addon repo logs correct addon IDs (sorted, deduplicated)
**What:** A PR on `xbmc/repo-plugins` with files from two addons logs both addon IDs sorted alphabetically.
**How:** Files: `["plugin.video.foo/addon.xml", "plugin.video.foo/icon.png", "plugin.audio.bar/addon.xml"]`.
**Expected:** `logger.info` called with `addonIds: ["plugin.audio.bar", "plugin.video.foo"]` (sorted, deduplicated).
**Evidence:** Unit test `addon repo logs correct addon IDs` — passes.

### TC-04: Empty PR logs empty addon ID list
**What:** A PR with zero changed files logs an empty array (not an error).
**How:** Files: `[]`.
**Expected:** `logger.info` called with `addonIds: []`.
**Evidence:** Unit test `empty PR (no files) logs empty addon ID list` — passes.

### TC-05: Root-level files are excluded
**What:** Root-level files (no `/` in path) like `README.md` are excluded; files with a `/` (even `.github/`) are treated as having an addon directory first segment.
**How:** Files: `["README.md", "plugin.video.foo/addon.xml"]`.
**Expected:** `addonIds: ["plugin.video.foo"]` — `README.md` excluded because no slash.
**Evidence:** Unit test `root-level files (no slash) are excluded` — passes.

### TC-06: addonRepos default config
**What:** When `ADDON_REPOS` env var is not set, `config.addonRepos` defaults to the three standard xbmc repos.
**How:** Parse config with no `ADDON_REPOS` env var set.
**Expected:** `config.addonRepos` equals `["xbmc/repo-plugins", "xbmc/repo-scripts", "xbmc/repo-scrapers"]`.

### TC-07: TypeScript clean compilation
**What:** Adding `addonRepos` to `AppConfig` must not break any existing TypeScript consumers.
**How:** Run `bun run tsc --noEmit`.
**Expected:** Exit code 0, no errors.
**Evidence:** tsc --noEmit exits 0.

### TC-08: Handler wired into production entrypoint
**What:** `createAddonCheckHandler` is called in `src/index.ts` so the handler is active in the running app.
**How:** Grep `src/index.ts` for `createAddonCheckHandler`.
**Expected:** Import and unconditional call are present.
**Evidence:** T02 implementation confirmed — handler registered after existing handlers, outside optional store guards.

