import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  createIssueCommentWithPublicationPipeline,
  createIssueWithPublicationPipeline,
  createPullRequestWithPublicationPipeline,
  createPullReviewWithPublicationPipeline,
  createReviewCommentWithPublicationPipeline,
  createReviewReplyWithPublicationPipeline,
  prepareGitHubPublication,
  updateIssueCommentWithPublicationPipeline,
  updateIssueWithPublicationPipeline,
  updatePullReviewWithPublicationPipeline,
  updateReviewCommentWithPublicationPipeline,
} from "./github-publication.ts";

function createOctokitHarness() {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  return {
    calls,
    octokit: {
      rest: {
        issues: {
          createComment: async (params: Record<string, unknown>) => {
            calls.push({ method: "issues.createComment", params });
            return { data: { id: 101 } };
          },
          updateComment: async (params: Record<string, unknown>) => {
            calls.push({ method: "issues.updateComment", params });
            return { data: { id: params.comment_id } };
          },
          create: async (params: Record<string, unknown>) => {
            calls.push({ method: "issues.create", params });
            return { data: { number: 7 } };
          },
          update: async (params: Record<string, unknown>) => {
            calls.push({ method: "issues.update", params });
            return { data: { number: params.issue_number } };
          },
        },
        pulls: {
          create: async (params: Record<string, unknown>) => {
            calls.push({ method: "pulls.create", params });
            return { data: { number: 9, html_url: "https://example.test/pull/9" } };
          },
          createReplyForReviewComment: async (params: Record<string, unknown>) => {
            calls.push({ method: "pulls.createReplyForReviewComment", params });
            return { data: { id: 202 } };
          },
          createReviewComment: async (params: Record<string, unknown>) => {
            calls.push({ method: "pulls.createReviewComment", params });
            return { data: { id: 404, path: params.path } };
          },
          updateReviewComment: async (params: Record<string, unknown>) => {
            calls.push({ method: "pulls.updateReviewComment", params });
            return { data: { id: params.comment_id } };
          },
          createReview: async (params: Record<string, unknown>) => {
            calls.push({ method: "pulls.createReview", params });
            return { data: { id: 303 } };
          },
        },
      },
      request: async (route: string, params: Record<string, unknown>) => {
        calls.push({ method: route, params });
        return { data: { id: params.review_id } };
      },
    } as never,
  };
}

describe("github publication pipeline helpers", () => {
  test("keeps production outbound publication preflight behind the GitHub publication facade", () => {
    const repoRoot = join(import.meta.dir, "..", "..");
    const allowed = new Set([
      "src/lib/github-publication-architecture.ts",
      "src/lib/github-publication.ts",
      "src/lib/sanitizer.ts",
    ]);
    const offenders: string[] = [];

    function scan(dir: string): void {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
          scan(path);
          continue;
        }
        if (!path.endsWith(".ts") || path.endsWith(".test.ts")) continue;

        const rel = relative(repoRoot, path);
        if (allowed.has(rel)) continue;

        const source = readFileSync(path, "utf8");
        if (source.includes("prepareOutgoingBodyForPublication")) {
          offenders.push(rel);
        }
      }
    }

    scan(join(repoRoot, "src"));

    expect(offenders).toEqual([]);
  });

  test("exposes the shared publication preparation result for guarded two-pass flows", () => {
    const result = prepareGitHubPublication(
      "safe marker <!-- kodiai:review-output-key:test -->",
      { botHandles: ["kodiai"], preserveKodiaiMarkers: true },
    );

    expect(result).toMatchObject({
      body: expect.stringContaining("<!-- kodiai:review-output-key:test -->"),
      blocked: false,
    });
  });

  test("sanitize body-bearing issue comment and review reply calls through the shared publication pipeline", async () => {
    const { octokit, calls } = createOctokitHarness();
    const body = "Hi @kodiai, token gh\u200bu_" + "A".repeat(36);

    await createIssueCommentWithPublicationPipeline(octokit, {
      owner: "xbmc",
      repo: "kodiai",
      issue_number: 1,
      body,
      botHandles: ["kodiai"],
      preserveKodiaiMarkers: true,
    });
    await updateIssueCommentWithPublicationPipeline(octokit, {
      owner: "xbmc",
      repo: "kodiai",
      comment_id: 2,
      body,
      botHandles: ["kodiai"],
      preserveKodiaiMarkers: true,
    });
    await createReviewReplyWithPublicationPipeline(octokit, {
      owner: "xbmc",
      repo: "kodiai",
      pull_number: 3,
      comment_id: 4,
      body,
      botHandles: ["kodiai"],
      preserveKodiaiMarkers: true,
    });

    expect(calls.map((call) => call.method)).toEqual([
      "issues.createComment",
      "issues.updateComment",
      "pulls.createReplyForReviewComment",
    ]);
    for (const call of calls) {
      expect(call.params.body).toContain("kodiai");
      expect(call.params.body).not.toContain("@kodiai");
      expect(call.params.body).toContain("[REDACTED_GITHUB_TOKEN]");
      expect(call.params.body).not.toContain("ghu_");
      expect(call.params.body).not.toContain("gh\u200bu_");
    }
  });

  test("sanitizes pull review body and inline review comments through the same publication pipeline", async () => {
    const { octokit, calls } = createOctokitHarness();

    await createPullReviewWithPublicationPipeline(octokit, {
      owner: "xbmc",
      repo: "kodiai",
      pull_number: 5,
      event: "COMMENT",
      body: "<!-- kodiai:review-output-key:test -->\n@kodiai summary",
      comments: [
        {
          path: "src/index.ts",
          line: 10,
          body: "@kodiai inline gh\u200bu_" + "B".repeat(36),
        },
      ],
      botHandles: ["kodiai"],
      preserveKodiaiMarkers: true,
    });

    const params = calls[0]?.params;
    expect(params?.body).toContain("<!-- kodiai:review-output-key:test -->");
    expect(params?.body).toContain("kodiai summary");
    expect(params?.body).not.toContain("@kodiai summary");
    expect((params?.comments as Array<{ body: string }>)[0]?.body).toContain("kodiai inline");
    expect((params?.comments as Array<{ body: string }>)[0]?.body).not.toContain("@kodiai inline");
    expect((params?.comments as Array<{ body: string }>)[0]?.body).toContain("[REDACTED_GITHUB_TOKEN]");
  });

  test("sanitizes issue bodies and inline review comments through the shared publication pipeline", async () => {
    const { octokit, calls } = createOctokitHarness();
    const body = "Issue body @kodiai gh\u200bu_" + "D".repeat(36);

    await createIssueWithPublicationPipeline(octokit, {
      owner: "xbmc",
      repo: "kodiai",
      title: "tracking",
      body,
      botHandles: ["kodiai"],
    });
    await updateIssueWithPublicationPipeline(octokit, {
      owner: "xbmc",
      repo: "kodiai",
      issue_number: 8,
      body,
      botHandles: ["kodiai"],
    });
    await createReviewCommentWithPublicationPipeline(octokit, {
      owner: "xbmc",
      repo: "kodiai",
      pull_number: 9,
      commit_id: "abc",
      path: "src/index.ts",
      line: 10,
      body,
      botHandles: ["kodiai"],
    });

    expect(calls.map((call) => call.method)).toEqual([
      "issues.create",
      "issues.update",
      "pulls.createReviewComment",
    ]);
    for (const call of calls) {
      expect(call.params.body).toContain("Issue body kodiai");
      expect(call.params.body).not.toContain("@kodiai");
      expect(call.params.body).toContain("[REDACTED_GITHUB_TOKEN]");
    }
  });

  test("sanitizes pull request creation bodies through the shared publication pipeline", async () => {
    const { octokit, calls } = createOctokitHarness();

    await createPullRequestWithPublicationPipeline(octokit, {
      owner: "xbmc",
      repo: "kodiai",
      title: "write-mode fix",
      head: "bot:write-mode-fix",
      base: "main",
      body: "PR body @kodiai gh\u200bu_" + "E".repeat(36),
      botHandles: ["kodiai"],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("pulls.create");
    expect(calls[0]?.params.body).toContain("PR body kodiai");
    expect(calls[0]?.params.body).not.toContain("@kodiai");
    expect(calls[0]?.params.body).toContain("[REDACTED_GITHUB_TOKEN]");
  });

  test("sanitizes pull review updates through the shared publication pipeline", async () => {
    const { octokit, calls } = createOctokitHarness();

    await updatePullReviewWithPublicationPipeline(octokit, {
      owner: "xbmc",
      repo: "kodiai",
      pull_number: 5,
      review_id: 6,
      body: "<!-- kodiai:review-output-key:test -->\n@kodiai update gh\u200bu_" + "C".repeat(36),
      botHandles: ["kodiai"],
      preserveKodiaiMarkers: true,
    });

    expect(calls[0]?.method).toBe("PUT /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}");
    expect(calls[0]?.params.body).toContain("<!-- kodiai:review-output-key:test -->");
    expect(calls[0]?.params.body).toContain("kodiai update");
    expect(calls[0]?.params.body).not.toContain("@kodiai update");
    expect(calls[0]?.params.body).toContain("[REDACTED_GITHUB_TOKEN]");
  });

  test("sanitizes review comment updates through the shared publication pipeline", async () => {
    const { octokit, calls } = createOctokitHarness();

    await updateReviewCommentWithPublicationPipeline(octokit, {
      owner: "xbmc",
      repo: "kodiai",
      comment_id: 12,
      body: "@kodiai update gh\u200bu_" + "F".repeat(36),
      botHandles: ["kodiai"],
      preserveKodiaiMarkers: true,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("pulls.updateReviewComment");
    expect(calls[0]?.params.body).toContain("kodiai update");
    expect(calls[0]?.params.body).not.toContain("@kodiai");
    expect(calls[0]?.params.body).toContain("[REDACTED_GITHUB_TOKEN]");
  });
});
