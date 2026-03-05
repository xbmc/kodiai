import { describe, it, expect, mock, beforeEach } from "bun:test";
import { heuristicScore, DOMAIN_STOPWORDS, createWikiStalenessDetector } from "./wiki-staleness-detector.ts";
import type { WikiStalenessDetectorOptions } from "./wiki-staleness-types.ts";

describe("heuristicScore", () => {
  it("returns 0 when no token overlap", () => {
    const score = heuristicScore(["Audio playback configuration"], ["src/video/renderer.ts"]);
    expect(score).toBe(0);
  });

  it("scores positively when file path tokens appear in chunk text", () => {
    // "playback" and "settings" are non-stopword tokens that overlap
    const score = heuristicScore(["playback settings configuration"], ["src/playback/settings.ts"]);
    expect(score).toBeGreaterThan(0);
  });

  it("ignores short tokens (<=3 chars)", () => {
    const score = heuristicScore(["api and sdk"], ["src/api/sdk.ts"]);
    expect(score).toBe(0); // "api", "sdk", "and", "src" all <= 3 chars
  });

  it("scores multiple overlapping tokens", () => {
    const score = heuristicScore(
      ["rendering pipeline codec transformation"],
      ["src/rendering/pipeline/codec.ts"],
    );
    expect(score).toBeGreaterThanOrEqual(2); // "rendering", "pipeline", "codec" all match
  });

  it("handles empty inputs gracefully", () => {
    expect(heuristicScore([], ["src/foo.ts"])).toBe(0);
    expect(heuristicScore(["some text"], [])).toBe(0);
    expect(heuristicScore([], [])).toBe(0);
  });

  it("filters domain stopwords from scoring", () => {
    // "player", "video", "kodi" are all stopwords -- should NOT contribute to score
    const score = heuristicScore(
      ["player video kodi addon configuration"],
      ["src/player/video/kodi.ts"],
    );
    expect(score).toBe(0);
  });

  it("gives heading tokens 3x weight", () => {
    // "playercorefactory" in heading should score 3, in body text would score 1
    const headingScore = heuristicScore(
      ["== PlayerCoreFactory ==\nSome body text about internals"],
      ["src/playercorefactory.ts"],
    );
    const bodyScore = heuristicScore(
      ["playercorefactory is used for internal init"],
      ["src/playercorefactory.ts"],
    );
    expect(headingScore).toBe(3); // heading weight
    expect(bodyScore).toBe(1);   // regular weight
  });

  it("handles mixed headings and body with stopwords", () => {
    // "codec" in heading gets 3x, "player" in heading is stopword (filtered)
    const score = heuristicScore(
      ["== Player Codec Settings ==\nDetails about codec configuration"],
      ["src/player/codec/settings.ts"],
    );
    // "player" -> stopword, "codec" -> heading token (3x), "settings" -> heading token (3x)
    expect(score).toBe(6);
  });

  it("exports DOMAIN_STOPWORDS set", () => {
    expect(DOMAIN_STOPWORDS).toBeInstanceOf(Set);
    expect(DOMAIN_STOPWORDS.has("player")).toBe(true);
    expect(DOMAIN_STOPWORDS.has("video")).toBe(true);
    expect(DOMAIN_STOPWORDS.has("kodi")).toBe(true);
    expect(DOMAIN_STOPWORDS.has("addon")).toBe(true);
    expect(DOMAIN_STOPWORDS.has("tests")).toBe(true);
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
          rest: {
            pulls: {
              list: mock(async () => ({ data: [] })),
              listFiles: mock(async () => ({ data: [] })),
            },
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

  it("does not post to Slack when no merged PRs found in window", async () => {
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
