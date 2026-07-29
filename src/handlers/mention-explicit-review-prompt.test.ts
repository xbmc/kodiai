import { describe, expect, test } from "bun:test";
import { TASK_TYPES } from "../llm/task-types.ts";
import { buildMentionExplicitReviewPrompt } from "./mention-explicit-review-prompt.ts";
import type { MentionEvent } from "./mention-types.ts";

function makeMention(overrides: Partial<MentionEvent> = {}): MentionEvent & { prNumber: number } {
  return {
    surface: "pr_comment",
    owner: "octo-org",
    repo: "widget",
    issueNumber: 42,
    commentId: 99,
    commentBody: "@kodiai review this",
    commentAuthor: "mona",
    commentCreatedAt: "2026-07-06T12:00:00Z",
    headRef: "head-sha-from-event",
    headSha: "head-sha-from-event",
    baseRef: "main",
    headRepoOwner: "octo-org",
    headRepoName: "widget",
    diffHunk: undefined,
    filePath: undefined,
    fileLine: undefined,
    inReplyToId: undefined,
    issueBody: null,
    issueTitle: "Improve widget",
    ...overrides,
    prNumber: overrides.prNumber ?? 42,
  };
}

function makeConfig() {
  return {
    maxTurns: 25,
    timeoutSeconds: 600,
    timeout: {
      dynamicScaling: true,
    },
    largePR: {
      fileThreshold: 10,
      fullReviewCount: 4,
      abbreviatedCount: 6,
      riskWeights: {
        linesChanged: 1,
        pathRisk: 1,
        fileCategory: 1,
        languageRisk: 1,
        fileExtension: 1,
      },
    },
    review: {
      prompt: "Focus on correctness.",
      mode: "standard",
      severity: { minLevel: "minor" },
      focusAreas: [],
      ignoredAreas: [],
      maxComments: 7,
      suppressions: [],
      minConfidence: 60,
      fileCategories: {},
      pathInstructions: [],
      outputLanguage: "en",
    },
  };
}

describe("buildMentionExplicitReviewPrompt", () => {
  test("builds review prompt metadata and logs the explicit mention review routing decision", async () => {
    const entries: Array<{ obj: Record<string, unknown>; msg: string }> = [];
    const mention = makeMention();

    const result = await buildMentionExplicitReviewPrompt({
      mention,
      config: makeConfig() as never,
      deliveryId: "delivery-1",
      workspaceDir: "/tmp/workspace",
      workspaceToken: "workspace-token",
      retrievalContext: undefined,
      reviewPrecedents: [],
      wikiKnowledge: [],
      unifiedResults: [],
      contextWindow: undefined,
      logger: {
        info: (obj: Record<string, unknown>, msg: string) => entries.push({ obj, msg }),
        debug: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      } as never,
      getPullRequest: async () => ({
        head: { sha: "head-sha", ref: "feature" },
        base: { sha: "base-sha", ref: "main" },
        title: "Improve widget routing",
        body: "Adds safer routing.",
        user: { login: "mona" },
        additions: 12,
        deletions: 3,
        labels: [{ name: "backend" }],
        draft: false,
      }),
      collectPromptDiff: async () => ({
        changedFiles: ["src/widget.ts"],
        numstatLines: ["12\t3\tsrc/widget.ts"],
        diffRange: "main...HEAD",
        diffContent: "diff --git a/src/widget.ts b/src/widget.ts\n+const widget = true;\n",
      }),
      fetchPullRequestFiles: async () => [],
    });

    expect(result.headSha).toBe("head-sha");
    expect(result.baseSha).toBe("base-sha");
    expect(result.promptFileCount).toBe(1);
    expect(result.prDiffCommentabilityIndex).toBeDefined();
    expect(result.routing.taskType).toBe(TASK_TYPES.REVIEW_SMALL_DIFF);
    expect(result.prompt).toContain("Improve widget routing");
    expect(result.promptSections).toHaveLength(1);
    expect(result.dynamicTimeoutSeconds).toBeGreaterThan(0);
    expect(result.maxTurnsOverride).toBeUndefined();
    expect(entries).toContainEqual(expect.objectContaining({
      msg: "Mention review routing decision",
      obj: expect.objectContaining({
        surface: mention.surface,
        owner: mention.owner,
        repo: mention.repo,
        prNumber: mention.prNumber,
        gate: "review-routing",
        taskType: TASK_TYPES.REVIEW_SMALL_DIFF,
        lane: "interactive-review",
      }),
    }));
  });
});
