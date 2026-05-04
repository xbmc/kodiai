import type { Octokit } from "@octokit/rest";

export type PullRequestFileMetadata = {
  filename: string;
  status?: string;
  previousFilename?: string;
  additions?: number | null;
  deletions?: number | null;
  patch?: string | null;
};

export async function fetchAllPullRequestFiles(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  pullNumber: number;
}): Promise<PullRequestFileMetadata[]> {
  const { octokit, owner, repo, pullNumber } = params;
  const files: PullRequestFileMetadata[] = [];
  let page = 1;

  while (true) {
    const response = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
      page,
    });

    for (const file of response.data) {
      files.push({
        filename: file.filename,
        status: file.status,
        previousFilename: file.previous_filename,
        additions: file.additions,
        deletions: file.deletions,
        patch: file.patch,
      });
    }

    if (response.data.length < 100) {
      return files;
    }
    page += 1;
  }
}
