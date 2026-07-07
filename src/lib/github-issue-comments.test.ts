import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  findIssueCommentByMarkerPaged,
  findIssueCommentsByMarkerPaged,
  findPullReviewByMarkerPaged,
  findReviewCommentsByMarkerPaged,
  hasReviewCommentMarkerPaged,
  listIssueCommentsPaged,
  listPullReviewsPaged,
  listReviewCommentsPaged,
  scanPagedItems,
  scanIssueCommentsPaged,
} from "./github-issue-comments.ts";

const ALLOWED_DIRECT_MARKER_SCAN_FILES = new Set([
  "src/lib/github-issue-comments.ts",
]);

function productionTypeScriptFiles(): Record<string, string> {
  const repoRoot = join(import.meta.dir, "..", "..");
  const files: Record<string, string> = {};

  function scan(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        scan(path);
        continue;
      }
      if (!path.endsWith(".ts") || path.endsWith(".test.ts") || path.endsWith("test-helpers.ts")) {
        continue;
      }

      files[relative(repoRoot, path)] = readFileSync(path, "utf8");
    }
  }

  scan(join(repoRoot, "src"));
  return files;
}

function findDirectMarkerCommentScans(files: Record<string, string>): string[] {
  const listCommentsPattern =
    /\boctokit(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*\.\s*rest\s*\.\s*(?:issues|pulls)\s*\.\s*(?:listComments|listReviewComments|listReviews)\s*\(/s;
  const markerBodyMatchPattern =
    /(?:body\s*\?\.\s*includes\s*\(\s*(?:params\.)?marker|body\s*\.\s*includes\s*\(\s*(?:params\.)?marker|body\s*\.\s*includes\s*\(\s*[A-Z0-9_]*MARKER|body\s*\?\.\s*includes\s*\(\s*[A-Z0-9_]*MARKER)/s;

  return Object.entries(files)
    .filter(([file]) => !ALLOWED_DIRECT_MARKER_SCAN_FILES.has(file))
    .filter(([, source]) => listCommentsPattern.test(source) && markerBodyMatchPattern.test(source))
    .map(([file]) => file)
    .sort();
}

describe("comment marker scan architecture", () => {
  test("detects direct marker scans that bypass the paged helpers", () => {
    expect(findDirectMarkerCommentScans({
      "src/handlers/unsafe.ts": `
        const { data } = await octokit.rest.issues.listComments({ owner, repo, issue_number });
        return data.find((comment) => comment.body?.includes(marker));
      `,
      "src/handlers/safe.ts": `
        return findIssueCommentByMarkerPaged(octokit, { owner, repo, issueNumber, marker });
      `,
      "src/lib/github-issue-comments.ts": `
        const { data } = await octokit.rest.issues.listComments({ owner, repo, issue_number });
        return data.find((comment) => comment.body?.includes(params.marker));
      `,
    })).toEqual(["src/handlers/unsafe.ts"]);
  });

  test("keeps production marker lookups behind the paged comment helpers", () => {
    expect(findDirectMarkerCommentScans(productionTypeScriptFiles())).toEqual([]);
  });
});

describe("scanPagedItems", () => {
  test("stops when a callback matches and reports scanned count", async () => {
    const calls: number[] = [];

    const result = await scanPagedItems({
      perPage: 2,
      maxItems: 10,
      fetchPage: async ({ page, perPage }) => {
        calls.push(page);
        return page === 1
          ? [{ id: 1 }, { id: 2 }]
          : [{ id: 3 }, { id: 4 }];
      },
      onItem: (item) => item.id === 3,
    });

    expect(result).toEqual({ scanned: 3, stopped: true, hitCap: false });
    expect(calls).toEqual([1, 2]);
  });

  test("reports a hit cap when full pages exhaust the max item budget", async () => {
    const result = await scanPagedItems({
      perPage: 2,
      maxItems: 3,
      fetchPage: async ({ page, perPage }) =>
        Array.from({ length: perPage }, (_, index) => ({ id: page * 10 + index })),
      onItem: () => false,
    });

    expect(result).toEqual({ scanned: 3, stopped: false, hitCap: true });
  });
});

describe("findIssueCommentByMarkerPaged", () => {
  test("lists issue comments across pages", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const octokit = {
      rest: {
        issues: {
          listComments: async (params: { page?: number; per_page?: number }) => {
            calls.push(params);
            if (params.page === 1) {
              return {
                data: Array.from({ length: 2 }, (_, index) => ({
                  id: index + 1,
                  body: `issue comment ${index + 1}`,
                })),
              };
            }
            return {
              data: [{ id: 3, body: "issue comment 3" }],
            };
          },
        },
      },
    };

    const result = await listIssueCommentsPaged(octokit, {
      owner: "acme",
      repo: "repo",
      issueNumber: 42,
      perPage: 2,
      sort: "created",
      direction: "desc",
    });

    expect(result.comments.map((comment) => comment.id)).toEqual([1, 2, 3]);
    expect(result.scannedPages).toBe(2);
    expect(result.hitPageCap).toBe(false);
    expect(calls).toEqual([
      { owner: "acme", repo: "repo", issue_number: 42, per_page: 2, page: 1, sort: "created", direction: "desc" },
      { owner: "acme", repo: "repo", issue_number: 42, per_page: 2, page: 2, sort: "created", direction: "desc" },
    ]);
  });

  test("lists pull reviews across pages", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const octokit = {
      rest: {
        pulls: {
          listReviews: async (params: { page?: number; per_page?: number }) => {
            calls.push(params);
            if (params.page === 1) {
              return {
                data: [
                  { id: 1, body: "review 1" },
                  { id: 2, body: "review 2" },
                ],
              };
            }
            return {
              data: [{ id: 3, body: "review 3" }],
            };
          },
        },
      },
    };

    const result = await listPullReviewsPaged(octokit, {
      owner: "acme",
      repo: "repo",
      prNumber: 42,
      perPage: 2,
    });

    expect(result.reviews.map((review) => review.id)).toEqual([1, 2, 3]);
    expect(result.scannedPages).toBe(2);
    expect(result.hitPageCap).toBe(false);
    expect(calls).toEqual([
      { owner: "acme", repo: "repo", pull_number: 42, per_page: 2, page: 1 },
      { owner: "acme", repo: "repo", pull_number: 42, per_page: 2, page: 2 },
    ]);
  });

  test("supports custom issue comment scans across pages", async () => {
    const calls: Array<{ page?: number; per_page?: number }> = [];
    const seenIds: number[] = [];
    const octokit = {
      rest: {
        issues: {
          listComments: async (params: { page?: number; per_page?: number }) => {
            calls.push(params);
            if (params.page === 1) {
              return {
                data: [
                  { id: 1, body: "<!-- kodiai:wiki-modification:10 -->" },
                  ...Array.from({ length: 99 }, (_, index) => ({
                    id: index + 2,
                    body: "ordinary comment",
                  })),
                ],
              };
            }
            return {
              data: [{ id: 201, body: "<!-- kodiai:wiki-modification:20 -->" }],
            };
          },
        },
      },
    };

    const result = await scanIssueCommentsPaged(octokit, {
      owner: "acme",
      repo: "repo",
      issueNumber: 42,
      onComment: (comment) => {
        if (typeof comment.id === "number" && comment.body?.includes("wiki-modification")) {
          seenIds.push(comment.id);
        }
        return false;
      },
    });

    expect(result).toEqual({ scanned: 101, stopped: false, hitCap: false });
    expect(seenIds).toEqual([1, 201]);
    expect(calls.map((call) => call.page)).toEqual([1, 2]);
  });

  test("finds a marker after the first page", async () => {
    const calls: Array<{ page?: number; per_page?: number }> = [];
    const octokit = {
      rest: {
        issues: {
          listComments: async (params: { page?: number; per_page?: number }) => {
            calls.push(params);
            if (params.page === 1) {
              return {
                data: Array.from({ length: 100 }, (_, index) => ({
                  id: index + 1,
                  body: "ordinary comment",
                })),
              };
            }
            return {
              data: [{ id: 201, body: "found <!-- marker -->" }],
            };
          },
        },
      },
    };

    const result = await findIssueCommentByMarkerPaged(octokit, {
      owner: "acme",
      repo: "repo",
      issueNumber: 42,
      marker: "<!-- marker -->",
    });

    expect(result?.id).toBe(201);
    expect(calls.map((call) => call.page)).toEqual([1, 2]);
  });

  test("collects all issue comments matching a marker across pages", async () => {
    const octokit = {
      rest: {
        issues: {
          listComments: async (params: { page?: number; per_page?: number }) => {
            if (params.page === 1) {
              return {
                data: [
                  {
                    id: 1,
                    body: "found <!-- marker -->",
                    created_at: "2026-01-01T00:00:00Z",
                    user: { login: "kodiai[bot]" },
                  },
                  ...Array.from({ length: 99 }, (_, index) => ({
                    id: index + 2,
                    body: "ordinary comment",
                  })),
                ],
              };
            }
            return {
              data: [
                {
                  id: 101,
                  body: "also found <!-- marker -->",
                  created_at: "2026-01-01T00:01:00Z",
                  user: { login: "kodiai[bot]" },
                },
              ],
            };
          },
        },
      },
    };

    const matches = await findIssueCommentsByMarkerPaged(octokit, {
      owner: "acme",
      repo: "repo",
      issueNumber: 42,
      marker: "<!-- marker -->",
    });

    expect(matches.map((match) => match.id)).toEqual([1, 101]);
    expect(matches[1]).toMatchObject({
      created_at: "2026-01-01T00:01:00Z",
      user: { login: "kodiai[bot]" },
    });
  });
});

describe("review comment marker helpers", () => {
  test("lists review comments across pages with bounded created-asc scan metadata", async () => {
    const calls: Array<{
      page?: number;
      per_page?: number;
      sort?: string;
      direction?: string;
    }> = [];
    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async (params: {
            page?: number;
            per_page?: number;
            sort?: string;
            direction?: string;
          }) => {
            calls.push(params);
            if (params.page === 1) {
              return {
                data: Array.from({ length: 2 }, (_, index) => ({
                  id: index + 1,
                  body: `page one ${index + 1}`,
                  created_at: `2026-01-01T00:0${index}:00Z`,
                  in_reply_to_id: undefined,
                  user: { login: "reviewer" },
                })),
              };
            }
            if (params.page === 2) {
              return {
                data: [{
                  id: 3,
                  body: "page two",
                  created_at: "2026-01-01T00:02:00Z",
                  in_reply_to_id: 1,
                  user: { login: "alice" },
                }],
              };
            }
            return { data: [] };
          },
        },
      },
    };

    const result = await listReviewCommentsPaged(octokit, {
      owner: "acme",
      repo: "repo",
      prNumber: 42,
      perPage: 2,
      maxPages: 3,
      sort: "created",
      direction: "asc",
    });

    expect(result.comments.map((comment) => comment.id)).toEqual([1, 2, 3]);
    expect(result).toMatchObject({
      scannedPages: 2,
      hitPageCap: false,
    });
    expect(calls).toEqual([
      expect.objectContaining({ page: 1, per_page: 2, sort: "created", direction: "asc" }),
      expect.objectContaining({ page: 2, per_page: 2, sort: "created", direction: "asc" }),
    ]);
  });

  test("defaults review comment listing to a ten-page cap", async () => {
    const calls: Array<{ page?: number; per_page?: number }> = [];
    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async (params: { page?: number; per_page?: number }) => {
            calls.push(params);
            return {
              data: Array.from({ length: params.per_page ?? 100 }, (_, index) => ({
                id: ((params.page ?? 1) - 1) * 100 + index + 1,
                body: "full page",
              })),
            };
          },
        },
      },
    };

    const result = await listReviewCommentsPaged(octokit, {
      owner: "acme",
      repo: "repo",
      prNumber: 42,
    });

    expect(result.hitPageCap).toBe(true);
    expect(result.scannedPages).toBe(10);
    expect(calls).toHaveLength(10);
  });

  test("checks review comment markers after the first page", async () => {
    const calls: Array<{ page?: number; per_page?: number }> = [];
    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async (params: { page?: number; per_page?: number }) => {
            calls.push(params);
            if (params.page === 1) {
              return {
                data: Array.from({ length: 100 }, () => ({
                  body: "ordinary review comment",
                })),
              };
            }
            return {
              data: [{ body: "found <!-- inline-marker -->" }],
            };
          },
        },
      },
    };

    const result = await hasReviewCommentMarkerPaged(octokit, {
      owner: "acme",
      repo: "repo",
      prNumber: 42,
      marker: "<!-- inline-marker -->",
    });

    expect(result).toBe(true);
    expect(calls.map((call) => call.page)).toEqual([1, 2]);
  });

  test("collects all review comments matching a marker across pages", async () => {
    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async (params: { page?: number; per_page?: number }) => {
            if (params.page === 1) {
              return {
                data: [
                  { id: 1, path: "src/a.ts", line: 10, body: "found <!-- marker -->" },
                  { id: 2, path: "src/b.ts", line: 20, body: "ordinary" },
                  ...Array.from({ length: 98 }, (_, index) => ({
                    id: index + 3,
                    path: "src/fill.ts",
                    line: 1,
                    body: "ordinary",
                  })),
                ],
              };
            }
            return {
              data: [
                {
                  id: 101,
                  path: "src/c.ts",
                  start_line: 30,
                  line: 33,
                  body: "also found <!-- marker -->",
                },
              ],
            };
          },
        },
      },
    };

    const matches = await findReviewCommentsByMarkerPaged(octokit, {
      owner: "acme",
      repo: "repo",
      prNumber: 42,
      marker: "<!-- marker -->",
    });

    expect(matches.map((match) => match.id)).toEqual([1, 101]);
    expect(matches[1]).toMatchObject({
      path: "src/c.ts",
      start_line: 30,
      line: 33,
    });
  });

  test("preserves review comment metadata for marker matches", async () => {
    const octokit = {
      rest: {
        pulls: {
          listReviewComments: async () => ({
            data: [{
              id: 501,
              body: "found <!-- marker -->",
              html_url: "https://github.test/acme/repo/pull/42#discussion_r501",
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-01T00:05:00Z",
              in_reply_to_id: 400,
              path: "src/example.ts",
              line: 12,
              user: { login: "reviewer" },
            }],
          }),
        },
      },
    };

    const matches = await findReviewCommentsByMarkerPaged(octokit, {
      owner: "acme",
      repo: "repo",
      prNumber: 42,
      marker: "<!-- marker -->",
    });

    expect(matches).toEqual([{
      id: 501,
      body: "found <!-- marker -->",
      html_url: "https://github.test/acme/repo/pull/42#discussion_r501",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:05:00Z",
      in_reply_to_id: 400,
      path: "src/example.ts",
      line: 12,
      user: { login: "reviewer" },
    }]);
  });
});

describe("findPullReviewByMarkerPaged", () => {
  test("returns the latest pull review containing a marker across pages", async () => {
    const calls: Array<{ page?: number; per_page?: number }> = [];
    const octokit = {
      rest: {
        pulls: {
          listReviews: async (params: { page?: number; per_page?: number }) => {
            calls.push(params);
            if (params.page === 1) {
              return {
                data: [
                  { id: 10, body: "older <!-- review-marker -->" },
                  ...Array.from({ length: 99 }, (_, index) => ({
                    id: index + 11,
                    body: "ordinary review",
                  })),
                ],
              };
            }
            return {
              data: [{ id: 220, body: "newer <!-- review-marker -->" }],
            };
          },
        },
      },
    };

    const match = await findPullReviewByMarkerPaged(octokit, {
      owner: "acme",
      repo: "repo",
      prNumber: 42,
      marker: "<!-- review-marker -->",
    });

    expect(match).toEqual({ id: 220, body: "newer <!-- review-marker -->" });
    expect(calls.map((call) => call.page)).toEqual([1, 2]);
  });

  test("respects max item caps when finding pull reviews by marker", async () => {
    const calls: Array<{ page?: number; per_page?: number }> = [];
    const octokit = {
      rest: {
        pulls: {
          listReviews: async (params: { page?: number; per_page?: number }) => {
            calls.push(params);
            if (params.page === 1) {
              return {
                data: [
                  { id: 10, body: "older <!-- review-marker -->" },
                  { id: 11, body: "ordinary review" },
                ],
              };
            }
            return {
              data: [{ id: 220, body: "newer <!-- review-marker -->" }],
            };
          },
        },
      },
    };

    const match = await findPullReviewByMarkerPaged(octokit, {
      owner: "acme",
      repo: "repo",
      prNumber: 42,
      marker: "<!-- review-marker -->",
      perPage: 2,
      maxItems: 2,
    });

    expect(match).toEqual({ id: 10, body: "older <!-- review-marker -->" });
    expect(calls.map((call) => call.page)).toEqual([1]);
  });
});
