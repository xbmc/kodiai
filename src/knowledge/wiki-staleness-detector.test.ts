import { describe, it, expect, mock, beforeEach } from "bun:test";
import { heuristicScore, createWikiStalenessDetector } from "./wiki-staleness-detector.ts";
import type { WikiStalenessDetectorOptions } from "./wiki-staleness-types.ts";

describe("heuristicScore", () => {
  it("returns 0 when no token overlap", () => {
    const score = heuristicScore(["Audio playback configuration"], ["src/video/renderer.ts"]);
    expect(score).toBe(0);
  });

  it("scores positively when file path tokens appear in chunk text", () => {
    const score = heuristicScore(["audio playback settings"], ["src/audio/player.ts"]);
    expect(score).toBeGreaterThan(0);
  });

  it("ignores short tokens (<=3 chars)", () => {
    const score = heuristicScore(["api and sdk"], ["src/api/sdk.ts"]);
    expect(score).toBe(0); // "api", "sdk", "and", "src" all <= 3 chars
  });

  it("scores multiple overlapping tokens", () => {
    const score = heuristicScore(
      ["video player rendering pipeline"],
      ["src/video/player/rendering.ts"],
    );
    expect(score).toBeGreaterThanOrEqual(2); // "video", "player", "rendering" all match
  });

  it("handles empty inputs gracefully", () => {
    expect(heuristicScore([], ["src/foo.ts"])).toBe(0);
    expect(heuristicScore(["some text"], [])).toBe(0);
    expect(heuristicScore([], [])).toBe(0);
  });
});

describe("createWikiStalenessDetector", () => {
  function makeMockOpts(overrides: Partial<WikiStalenessDetectorOptions> = {}): WikiStalenessDetectorOptions {
    return {
      sql: mock(() => Promise.resolve([])) as any,
      wikiPageStore: {
        countBySource: mock(async () => 0),
        writeChunks: mock(async () => {}),
        deletePageChunks: mock(async () => {}),
        replacePageChunks: mock(async () => {}),
        softDeletePage: mock(async () => {}),
        searchByEmbedding: mock(async () => []),
        searchByFullText: mock(async () => []),
        getPageChunks: mock(async () => []),
        getSyncState: mock(async () => null),
        updateSyncState: mock(async () => {}),
        getPageRevision: mock(async () => null),
      } as any,
      githubApp: {
        getRepoInstallationContext: mock(async () => ({
          installationId: 1,
          defaultBranch: "master",
        })),
        getInstallationOctokit: mock(async () => ({
          paginate: mock(async () => []),
          repos: {
            listCommits: {},
            getCommit: mock(async () => ({ data: { files: [] } })),
          },
        })),
        getAppSlug: mock(() => "test-app"),
        initialize: mock(async () => {}),
        getInstallationToken: mock(async () => "test-token"),
      } as any,
      slackClient: {
        postStandaloneMessage: mock(async () => ({ ts: "1234.5678" })),
        postThreadMessage: mock(async () => {}),
        addReaction: mock(async () => {}),
        removeReaction: mock(async () => {}),
        getTokenScopes: mock(async () => []),
      } as any,
      taskRouter: {
        resolve: mock(() => ({
          modelId: "claude-3-5-haiku-latest",
          provider: "anthropic",
          sdk: "vercel",
          fallbackModelId: null,
          fallbackProvider: "anthropic",
        })),
      } as any,
      logger: {
        info: mock(() => {}),
        warn: mock(() => {}),
        error: mock(() => {}),
        debug: mock(() => {}),
        child: mock(() => ({
          info: mock(() => {}),
          warn: mock(() => {}),
          error: mock(() => {}),
          debug: mock(() => {}),
          child: mock(() => ({})),
        })),
      } as any,
      githubOwner: "xbmc",
      githubRepo: "xbmc",
      wikiChannelId: "C12345",
      stalenessThresholdDays: 30,
      ...overrides,
    };
  }

  it("runScan skips when wiki store has no pages", async () => {
    const opts = makeMockOpts();
    const detector = createWikiStalenessDetector(opts);
    const result = await detector.runScan();
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("empty_wiki_store");
  });

  it("does not post to Slack when no commits found in window", async () => {
    const mockSql = mock(() => Promise.resolve([])) as any;
    const opts = makeMockOpts({
      sql: mockSql,
      wikiPageStore: {
        countBySource: mock(async () => 10),
      } as any,
    });

    const detector = createWikiStalenessDetector(opts);
    const result = await detector.runScan();

    expect(result.stalePages).toHaveLength(0);
    expect(opts.slackClient.postStandaloneMessage).not.toHaveBeenCalled();
  });
});
