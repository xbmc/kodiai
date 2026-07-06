import { describe, expect, test } from "bun:test";
import { hydrateMentionFindingContext } from "./mention-finding-context.ts";
import type { FindingByCommentId } from "../knowledge/types.ts";

const finding: FindingByCommentId = {
  severity: "major",
  category: "correctness",
  filePath: "src/file.ts",
  startLine: 42,
  title: "Original finding title",
};

function makeLogger() {
  const warnCalls: unknown[][] = [];
  return {
    warnCalls,
    logger: {
      warn: (...args: unknown[]) => warnCalls.push(args),
    },
  };
}

describe("hydrateMentionFindingContext", () => {
  test("returns undefined without a review-thread parent id", async () => {
    const { logger } = makeLogger();
    let lookupCalls = 0;

    const result = await hydrateMentionFindingContext({
      owner: "acme",
      repo: "repo",
      inReplyToId: undefined,
      findingLookup: async () => {
        lookupCalls += 1;
        return finding;
      },
      logger: logger as never,
    });

    expect(result).toBeUndefined();
    expect(lookupCalls).toBe(0);
  });

  test("returns finding metadata from the lookup", async () => {
    const { logger } = makeLogger();
    const lookupArgs: Array<{ repo: string; commentId: number }> = [];

    const result = await hydrateMentionFindingContext({
      owner: "acme",
      repo: "repo",
      inReplyToId: 123,
      findingLookup: async (repo, commentId) => {
        lookupArgs.push({ repo, commentId });
        return finding;
      },
      logger: logger as never,
    });

    expect(result).toEqual(finding);
    expect(lookupArgs).toEqual([{ repo: "acme/repo", commentId: 123 }]);
  });

  test("returns undefined when lookup returns null", async () => {
    const { logger } = makeLogger();

    const result = await hydrateMentionFindingContext({
      owner: "acme",
      repo: "repo",
      inReplyToId: 123,
      findingLookup: async () => null,
      logger: logger as never,
    });

    expect(result).toBeUndefined();
  });

  test("fails open and logs when lookup throws", async () => {
    const { logger, warnCalls } = makeLogger();

    const result = await hydrateMentionFindingContext({
      owner: "acme",
      repo: "repo",
      inReplyToId: 123,
      findingLookup: async () => {
        throw new Error("lookup failed");
      },
      logger: logger as never,
    });

    expect(result).toBeUndefined();
    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]?.[0]).toMatchObject({
      owner: "acme",
      repo: "repo",
      inReplyToId: 123,
    });
    expect(warnCalls[0]?.[1]).toBe("Failed to hydrate finding context; proceeding without finding metadata");
  });
});
