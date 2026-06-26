import { describe, expect, mock, test } from "bun:test";
import { fetchAllPullRequestFiles } from "./github-pr-files.ts";

describe("fetchAllPullRequestFiles", () => {
  test("collects every paginated pull request file", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      filename: `src/page-one-${index}.ts`,
      status: "modified",
      additions: 1,
      deletions: 0,
      patch: "@@ -1 +1 @@",
    }));
    const listFiles = mock((params: { owner: string; repo: string; pull_number: number; per_page: number; page: number }) => Promise.resolve({
      data: params.page === 1
        ? firstPage
        : [
            {
              filename: "src/two.ts",
              status: "renamed",
              previous_filename: "src/old-two.ts",
              additions: 2,
              deletions: 1,
              patch: "@@ -2 +2 @@",
            },
          ],
    }));
    const octokit = {
      rest: {
        pulls: {
          listFiles,
        },
      },
    };

    const files = await fetchAllPullRequestFiles({
      octokit,
      owner: "xbmc",
      repo: "kodiai",
      pullNumber: 130,
    });

    expect(files).toHaveLength(101);
    expect(files.at(-1)).toEqual({
      filename: "src/two.ts",
      status: "renamed",
      previousFilename: "src/old-two.ts",
      additions: 2,
      deletions: 1,
      patch: "@@ -2 +2 @@",
    });
    expect(listFiles).toHaveBeenCalledTimes(2);
    expect(listFiles.mock.calls[0]?.[0]).toEqual({
      owner: "xbmc",
      repo: "kodiai",
      pull_number: 130,
      per_page: 100,
      page: 1,
    });
    expect(listFiles.mock.calls[1]?.[0]).toEqual({
      owner: "xbmc",
      repo: "kodiai",
      pull_number: 130,
      per_page: 100,
      page: 2,
    });
  });

  test("fetches remaining pages from Link header with bounded parallel pagination", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      filename: `src/page-one-${index}.ts`,
      status: "modified",
      additions: 1,
      deletions: 0,
      patch: "@@ -1 +1 @@",
    }));
    const listFiles = mock((params: { page: number }) => Promise.resolve({
      headers: params.page === 1
        ? { link: '<https://api.github.test/repos/acme/repo/pulls/1/files?page=3>; rel="last"' }
        : {},
      data: params.page === 1
        ? firstPage
        : [{ filename: `src/page-${params.page}.ts`, status: "modified" }],
    }));
    const octokit = {
      rest: {
        pulls: {
          listFiles,
        },
      },
    };

    const files = await fetchAllPullRequestFiles({
      octokit,
      owner: "xbmc",
      repo: "kodiai",
      pullNumber: 130,
    });

    expect(files.map((file) => file.filename).slice(-2)).toEqual(["src/page-2.ts", "src/page-3.ts"]);
    expect(listFiles).toHaveBeenCalledTimes(3);
  });

  test("retries each paginated file request at the helper boundary", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((handler: Parameters<typeof setTimeout>[0]) => {
      if (typeof handler === "function") handler();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof globalThis.setTimeout;

    try {
      const firstPage = Array.from({ length: 100 }, (_, index) => ({
        filename: `src/page-one-${index}.ts`,
        status: "modified",
      }));
      let pageTwoAttempts = 0;
      const listFiles = mock((params: { page: number }) => {
        if (params.page === 1) {
          return Promise.resolve({
            headers: { link: '<https://api.github.test/repos/acme/repo/pulls/1/files?page=2>; rel="last"' },
            data: firstPage,
          });
        }
        pageTwoAttempts++;
        if (pageTwoAttempts === 1) {
          const error = new Error("temporary GitHub failure") as Error & { status: number };
          error.status = 500;
          throw error;
        }
        return Promise.resolve({ headers: {}, data: [{ filename: "src/retried.ts", status: "modified" }] });
      });

      const files = await fetchAllPullRequestFiles({
        octokit: { rest: { pulls: { listFiles } } },
        owner: "xbmc",
        repo: "kodiai",
        pullNumber: 130,
      });

      expect(files.at(-1)?.filename).toBe("src/retried.ts");
      expect(pageTwoAttempts).toBe(2);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });
});
