# S01: Handler scaffold and repo detection

**Goal:** Create the addon-check handler that fires on pull_request.opened and pull_request.synchronize events, gates on config.addonRepos, and logs the addon IDs it would check by inspecting PR file paths.
**Demo:** After this: After this: handler fires on a repo-plugins PR and logs the addon IDs it would check; non-addon repos produce no output.

## Tasks
- [x] **T01: Added addonRepos to AppConfig, created the addon-check handler scaffold, and verified all 5 unit test scenarios pass** — Add the addonRepos Zod field to src/config.ts, create src/handlers/addon-check.ts following the issue-opened.ts factory pattern, and write unit tests in src/handlers/addon-check.test.ts that cover all four scenarios described in the research doc.

### Steps

1. In `src/config.ts`, add `addonRepos` to the Zod schema and the parse call:
   - Schema: `addonRepos: z.string().default("xbmc/repo-plugins,xbmc/repo-scripts,xbmc/repo-scrapers").transform(s => s.split(",").map(s => s.trim()).filter(Boolean))`
   - Parse call: `addonRepos: process.env.ADDON_REPOS`
   - `AppConfig` type is derived via `z.infer` so this is automatic.

2. Create `src/handlers/addon-check.ts`:
   - Export `createAddonCheckHandler(deps: { eventRouter: EventRouter; githubApp: GitHubApp; config: AppConfig; logger: Logger }): void`
   - Register on both `"pull_request.opened"` and `"pull_request.synchronize"`
   - Inside the handler: cast payload to extract `repository.full_name`, `pull_request.number`, `repository.owner.login`, `repository.name`, `installation.id` (available as `event.installationId`)
   - Early return (with debug log) if `payload.repository.full_name` is not in `config.addonRepos`
   - Call `octokit.rest.pulls.listFiles({ owner, repo, pull_number, per_page: 100 })` to get PR files
   - Extract addon IDs: for each file path, take the first path segment (split on `/`)[0], filter out paths with no `/` (root-level files), deduplicate, sort
   - Log `logger.info({ addonIds, prNumber, repo }, "Addon check: would check addons")`
   - Wrap entire handler in try/catch, log errors as `logger.error` (non-fatal, same as issue-opened.ts)
   - Child logger carries `{ handler: "addon-check", repo, prNumber, deliveryId: event.id }`

3. Create `src/handlers/addon-check.test.ts` following the structure of `issue-opened.test.ts`:
   - Helper: `createMockLogger()`, `createMockEventRouter()`, `createMockOctokit(files: string[])`, `createMockGithubApp(files)`
   - `createMockOctokit` stubs `rest.pulls.listFiles` returning `{ data: files.map(filename => ({ filename })) }`
   - Test: "registers on pull_request.opened and pull_request.synchronize" — call createAddonCheckHandler, check router.captured has both keys
   - Test: "non-addon repo returns without calling listFiles" — config.addonRepos = ["xbmc/repo-plugins"], payload repo = "xbmc/xbmc"; spy on listFiles; handler should not call it
   - Test: "addon repo logs correct addon IDs" — repo = "xbmc/repo-plugins", files = ["plugin.video.foo/addon.xml", "plugin.video.foo/icon.png", "plugin.audio.bar/addon.xml"]; expect logger.info called with addonIds = ["plugin.audio.bar", "plugin.video.foo"] (sorted)
   - Test: "empty PR (no files) logs empty addon ID list" — repo = "xbmc/repo-plugins", files = []; expect logger.info called with addonIds = []
   - Test: "root-level files (no slash) are excluded from addon IDs" — files = [".github/workflows/test.yml", "README.md", "plugin.video.foo/addon.xml"]; expect addonIds = ["plugin.video.foo"] (README.md excluded because no `/`; .github/workflows/test.yml → first segment = ".github")

   Wait — ".github/workflows/test.yml" DOES have a slash, so first segment is ".github". That's a valid addon-like segment. The filter should only exclude paths with no slash at all (bare filenames like "README.md"). Review the logic: `file.filename.includes("/")` → if no slash, skip; else take `file.filename.split("/")[0]`. This correctly excludes "README.md" and includes ".github" — adjust test to use files ["README.md", "plugin.video.foo/addon.xml"] to keep it clean.
  - Estimate: 45m
  - Files: src/config.ts, src/handlers/addon-check.ts, src/handlers/addon-check.test.ts
  - Verify: bun test src/handlers/addon-check.test.ts
- [x] **T02: Wired createAddonCheckHandler into src/index.ts unconditionally and fixed addonRepos TypeScript errors in 10 stub files** — Import and call createAddonCheckHandler in src/index.ts, passing the minimal deps (eventRouter, githubApp, config, logger). Verify the full TypeScript compilation passes.

### Steps

1. In `src/index.ts`, add the import:
   ```ts
   import { createAddonCheckHandler } from "./handlers/addon-check.ts";
   ```

2. Find the handler registration block (around line 411-441 where createIssueOpenedHandler etc. are called). Add after the existing handler registrations:
   ```ts
   createAddonCheckHandler({
     eventRouter,
     githubApp,
     config,
     logger,
   });
   ```
   Note: no jobQueue, workspaceManager, or sql needed — the handler only needs octokit for listFiles.

3. Run `bun run tsc --noEmit` to verify types are correct end-to-end. Fix any issues (likely none given the factory signature is explicit).
  - Estimate: 15m
  - Files: src/index.ts
  - Verify: bun run tsc --noEmit
