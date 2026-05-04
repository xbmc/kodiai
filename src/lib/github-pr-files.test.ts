import { describe, expect, mock, test } from "bun:test";
import type { Octokit } from "@octokit/rest";
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
    } as unknown as Octokit;

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
});
