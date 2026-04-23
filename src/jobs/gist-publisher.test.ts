import { describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";
import type { BotUserClient } from "../auth/bot-user.ts";
import { createGistPublisher } from "./gist-publisher.ts";

type LogCall = { bindings: Record<string, unknown>; message: string };

function createMockLogger() {
  const infoCalls: LogCall[] = [];
  return {
    logger: createMockLoggerWithArrays(infoCalls),
    infoCalls,
  };
}

function createMockLoggerWithArrays(infoCalls: LogCall[]): Logger {
  return {
    info: (bindings: Record<string, unknown>, message: string) => {
      infoCalls.push({ bindings, message });
    },
    debug: mock(() => undefined),
    warn: mock(() => undefined),
    error: mock(() => undefined),
    trace: mock(() => undefined),
    fatal: mock(() => undefined),
    child: () => createMockLoggerWithArrays(infoCalls),
  } as unknown as Logger;
}

function createEnabledBotClient(createGist = mock(async () => ({
  data: { html_url: "https://gist.github.com/kodiai/abc123", id: "abc123" },
}))): BotUserClient {
  return {
    enabled: true,
    login: "kodiai-bot",
    octokit: {
      rest: {
        gists: {
          create: createGist,
        },
      },
    } as unknown as BotUserClient["octokit"],
  };
}

describe("createGistPublisher", () => {
  test("disabled mode reports unavailable publisher and throws on create", async () => {
    const { logger } = createMockLogger();
    const publisher = createGistPublisher(
      {
        enabled: false,
        login: "",
        octokit: {} as BotUserClient["octokit"],
      },
      logger,
    );

    expect(publisher.enabled).toBe(false);
    await expect(
      publisher.createPatchGist({
        owner: "xbmc",
        repo: "xbmc",
        summary: "Fix playback regression",
        patch: "diff --git a/file b/file",
      }),
    ).rejects.toThrow("Gist publisher is not available. Bot user client is not configured.");
  });

  test("creates a secret gist with repo summary description and timestamped patch filename", async () => {
    const createGist = mock(async () => ({
      data: {
        html_url: "https://gist.github.com/kodiai/def456",
        id: "def456",
      },
    }));
    const { logger, infoCalls } = createMockLogger();
    const publisher = createGistPublisher(createEnabledBotClient(createGist), logger);

    const result = await publisher.createPatchGist({
      owner: "xbmc",
      repo: "xbmc",
      summary: "Fix playback regression",
      patch: "diff --git a/src/player.ts b/src/player.ts\n+patched\n",
    });

    expect(publisher.enabled).toBe(true);
    expect(result).toEqual({
      htmlUrl: "https://gist.github.com/kodiai/def456",
      id: "def456",
    });
    expect(createGist).toHaveBeenCalledTimes(1);

    const createArgs = (createGist.mock.calls as unknown as Array<[{
      description: string;
      public: boolean;
      files: Record<string, { content: string }>;
    }]>)[0]![0];

    expect(createArgs.description).toBe("[kodiai] Patch for xbmc/xbmc: Fix playback regression");
    expect(createArgs.public).toBe(false);

    const filenames = Object.keys(createArgs.files);
    expect(filenames).toHaveLength(1);
    expect(filenames[0]).toMatch(/^xbmc-xbmc-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.patch$/);
    expect(createArgs.files[filenames[0]!]!.content).toBe("diff --git a/src/player.ts b/src/player.ts\n+patched\n");

    expect(infoCalls).toContainEqual({
      bindings: {
        owner: "xbmc",
        repo: "xbmc",
        filename: filenames[0],
      },
      message: "Creating secret gist with patch",
    });
    expect(infoCalls).toContainEqual({
      bindings: {
        id: "def456",
        htmlUrl: "https://gist.github.com/kodiai/def456",
      },
      message: "Secret gist created",
    });
  });
});
