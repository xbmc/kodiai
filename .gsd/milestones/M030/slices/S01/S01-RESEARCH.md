# S01: Handler Scaffold and Repo Detection — Research

**Date:** 2026-03-28

## Summary

S01 is straightforward wiring using established patterns already in the codebase. There is no new technology involved — the slice creates a new handler file (`src/handlers/addon-check.ts`), adds a config field to `src/config.ts`, and registers the handler in `src/index.ts`. The handler pattern to follow is `src/handlers/issue-opened.ts` (no LLM, simpler than review.ts). The idempotency pattern to follow for S03 is already in `src/handlers/review-idempotency.ts`.

The only meaningful decision is where the addon repo list lives: it belongs in `AppConfig` as a Zod-validated `addonRepos: string[]` field, parsed from a comma-separated env var `ADDON_REPOS`, defaulting to `["xbmc/repo-plugins","xbmc/repo-scripts","xbmc/repo-scrapers"]`.

The router dispatch already handles `"pull_request.opened"` and `"pull_request.synchronize"` as event keys — confirmed in `src/webhook/router.ts`. Both `createReviewHandler` and `createIssueOpenedHandler` use the same pattern: a factory function that takes deps, registers events on the router, and returns void.

## Recommendation

Create `src/handlers/addon-check.ts` modeled on `issue-opened.ts` — factory pattern, minimal deps (just `githubApp`, `logger`, `config`), no job queue, no workspace manager for S01. The handler fires for `pull_request.opened` and `pull_request.synchronize`, checks `config.addonRepos` against `payload.repository.full_name`, and logs the addon IDs it would check (extracted from PR file paths). Non-addon repos return immediately without any side effects.

Wire it in `src/index.ts` alongside the other handler registrations, and add the `addonRepos` field to the Zod schema in `src/config.ts`.

## Implementation Landscape

### Key Files

- `src/handlers/addon-check.ts` — **create new**; factory function `createAddonCheckHandler(deps)` matching the `issue-opened.ts` pattern; registers on `"pull_request.opened"` and `"pull_request.synchronize"`
- `src/config.ts` — **modify**; add `addonRepos: z.string().default("xbmc/repo-plugins,xbmc/repo-scripts,xbmc/repo-scrapers").transform(s => s.split(",").map(s => s.trim()).filter(Boolean))` to Zod schema; add `ADDON_REPOS: process.env.ADDON_REPOS` in the parse call
- `src/index.ts` — **modify**; import and call `createAddonCheckHandler` after the other handler registrations, passing `{ eventRouter, githubApp, config, logger }`
- `src/handlers/addon-check.test.ts` — **create new**; unit tests for repo detection and addon dir extraction; follow `issue-opened.test.ts` structure (mock router, mock octokit, mock logger)

### Detecting Affected Addon Dirs from PR Files

To identify addon IDs, call `octokit.rest.pulls.listFiles` (per_page: 100) and extract the first path segment of each file path. In these repos, every addon lives at `<addon-id>/...` — so `plugin.video.foo/addon.xml` → addon ID `plugin.video.foo`. Deduplicate and filter out `.` or any path that looks like a repo-level file (no `/`).

Pattern confirmed in `src/knowledge/wiki-staleness-detector.ts` lines 175–192 as the established API call shape.

### Event Payload Shape

The payload for `pull_request.opened` / `pull_request.synchronize` contains:
- `payload.repository.full_name` — compare against `config.addonRepos` for early return
- `payload.pull_request.number` — needed for `listFiles` call
- `payload.repository.owner.login` + `payload.repository.name` — owner/repo for API call
- `payload.installation.id` — already in `event.installationId` via the router

### Deps Signature

```ts
export function createAddonCheckHandler(deps: {
  eventRouter: EventRouter;
  githubApp: GitHubApp;
  config: AppConfig;        // has config.addonRepos: string[]
  logger: Logger;
}): void
```

No `jobQueue` or `workspaceManager` in S01 — addon dir detection just needs `listFiles`. Both will be added in S03 when the actual checker runs.

### Build Order

1. `src/config.ts` — add `addonRepos` field; verify the transform parses correctly in unit test
2. `src/handlers/addon-check.ts` — create handler with repo gate + addon dir extraction + `logger.info` log
3. `src/handlers/addon-check.test.ts` — unit tests: non-addon repo returns early, addon repo logs correct addon IDs
4. `src/index.ts` — wire handler registration

### Verification Approach

```bash
bun test src/handlers/addon-check.test.ts
```

Tests should prove:
- Handler registered on both `pull_request.opened` and `pull_request.synchronize`
- Non-addon repo (e.g. `xbmc/xbmc`) → handler returns without calling `listFiles`
- Addon repo with files `plugin.video.foo/addon.xml`, `plugin.video.foo/icon.png`, `plugin.audio.bar/addon.xml` → logs addon IDs `["plugin.video.foo", "plugin.audio.bar"]`
- Empty PR (no files) → logs empty addon ID list (no error)

TypeScript check: `bun run tsc --noEmit` to catch type errors in `AppConfig` changes.

## Constraints

- `addonRepos` default must match the three live repos exactly: `xbmc/repo-plugins`, `xbmc/repo-scripts`, `xbmc/repo-scrapers` — these are the repos that actually carry addon submissions
- `listFiles` is paginated at 100 items — for S01 logging purposes this is fine; S02/S03 will handle multi-page PRs if needed
- Handler factory must return `void`, not a promise — same as all other handlers in this codebase (the async work happens inside the registered closure)
- `sanitizeOutgoingMentions` is not needed in S01 (no comment posting until S03)
