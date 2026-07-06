import { describe, expect, test } from "bun:test";
import { buildReviewPromptEnrichment } from "./review-prompt-enrichment.ts";

function makeLogger() {
  const entries: Array<{ level: "info" | "warn"; obj: any; msg: string }> = [];
  return {
    entries,
    logger: {
      info: (obj: any, msg: string) => entries.push({ level: "info", obj, msg }),
      warn: (obj: any, msg: string) => entries.push({ level: "warn", obj, msg }),
    },
  };
}

describe("buildReviewPromptEnrichment", () => {
  test("collects cluster matches and linked issues for the review prompt", async () => {
    const { logger, entries } = makeLogger();
    const clusterCalls: unknown[] = [];
    const linkCalls: unknown[] = [];

    const result = await buildReviewPromptEnrichment({
      repo: "owner/repo",
      prTitle: "Fix login cache",
      prBody: "Fixes #42",
      commitMessages: ["fix login cache"],
      promptFiles: ["src/auth.ts", "src/cache.ts"],
      filesByCategory: {
        source: ["src/auth.ts"],
        test: ["test/auth.test.ts"],
      },
      clusterMatcher: async (input) => {
        clusterCalls.push(input);
        return [
          {
            clusterId: 1,
            slug: "auth-cache",
            label: "Auth cache invalidation",
            memberCount: 4,
            similarityScore: 0.91,
            filePathOverlap: 0.5,
            combinedScore: 0.8,
            representativeSample: "Check cache invalidation after auth state changes.",
          },
        ];
      },
      issueStore: {} as any,
      embeddingProvider: {
        generate: async () => ({
          embedding: new Float32Array([0.1, 0.2]),
          model: "test",
          dimensions: 2,
        }),
      } as any,
      linkPRToIssues: async (input) => {
        linkCalls.push(input);
        return {
          referencedIssues: [
            {
              issueNumber: 42,
              repo: "owner/repo",
              title: "Login cache stale",
              state: "open",
              descriptionSummary: "The login cache can go stale.",
              linkType: "referenced",
              keyword: "fixes",
            },
          ],
          semanticMatches: [],
        };
      },
      logger: logger as any,
      baseLog: { deliveryId: "delivery-1" },
    });

    expect(clusterCalls).toHaveLength(1);
    expect((clusterCalls[0] as any).prFilePaths).toEqual(["src/auth.ts", "src/cache.ts"]);
    expect(result.clusterPatterns).toHaveLength(1);
    expect(linkCalls).toHaveLength(1);
    expect((linkCalls[0] as any).diffSummary).toBe("src/auth.ts, test/auth.test.ts");
    expect(result.linkedIssues?.referencedIssues[0]?.issueNumber).toBe(42);
    expect(entries.some((entry) => entry.msg === "Cluster patterns matched for PR review")).toBe(true);
    expect(entries.some((entry) => entry.msg === "PR-issue linking completed")).toBe(true);
  });

  test("fails open when enrichment providers throw", async () => {
    const { logger, entries } = makeLogger();

    const result = await buildReviewPromptEnrichment({
      repo: "owner/repo",
      prTitle: "Fix login cache",
      prBody: null,
      commitMessages: [],
      promptFiles: ["src/auth.ts"],
      filesByCategory: {
        source: ["src/auth.ts"],
      },
      clusterMatcher: async () => {
        throw new Error("cluster unavailable");
      },
      issueStore: {} as any,
      embeddingProvider: {
        generate: async () => ({
          embedding: new Float32Array([0.1]),
          model: "test",
          dimensions: 1,
        }),
      } as any,
      linkPRToIssues: async () => {
        throw new Error("issue linker unavailable");
      },
      logger: logger as any,
      baseLog: { deliveryId: "delivery-1" },
    });

    expect(result.clusterPatterns).toEqual([]);
    expect(result.linkedIssues).toBeUndefined();
    expect(entries.map((entry) => entry.msg)).toContain("Cluster pattern matching failed (fail-open)");
    expect(entries.map((entry) => entry.msg)).toContain("PR-issue linking failed (fail-open)");
  });
});
