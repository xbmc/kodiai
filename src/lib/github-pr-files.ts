import { mapWithConcurrency } from "./concurrency.ts";
import { retryGitHubTransient } from "./github-retry.ts";

export type PullRequestFileMetadata = {
  filename: string;
  status?: string;
  previousFilename?: string;
  additions?: number | null;
  deletions?: number | null;
  patch?: string | null;
};

type ListPullRequestFilesParams = {
  owner: string;
  repo: string;
  pull_number: number;
  per_page: number;
  page: number;
};

type ListPullRequestFilesResponse = {
  data: Array<{
    filename: string;
    status?: string;
    previous_filename?: string | null;
    additions?: number | null;
    deletions?: number | null;
    patch?: string | null;
  }>;
  headers?: {
    link?: string;
  };
};

export type PullRequestFilesClient = {
  rest: {
    pulls: {
      listFiles(params: ListPullRequestFilesParams): Promise<ListPullRequestFilesResponse>;
    };
  };
};

function mapPullRequestFile(file: {
  filename: string;
  status?: string;
  previous_filename?: string | null;
  additions?: number | null;
  deletions?: number | null;
  patch?: string | null;
}): PullRequestFileMetadata {
  return {
    filename: file.filename,
    status: file.status,
    previousFilename: file.previous_filename ?? undefined,
    additions: file.additions,
    deletions: file.deletions,
    patch: file.patch,
  };
}

function parseLastPageFromLinkHeader(linkHeader: string | undefined): number | null {
  if (!linkHeader) return null;

  for (const part of linkHeader.split(",")) {
    if (!/rel="last"/.test(part)) continue;
    const pageMatch = part.match(/[?&]page=(\d+)/);
    if (!pageMatch) return null;
    return Number.parseInt(pageMatch[1]!, 10);
  }

  return null;
}

export async function fetchAllPullRequestFiles(params: {
  octokit: PullRequestFilesClient;
  owner: string;
  repo: string;
  pullNumber: number;
}): Promise<PullRequestFileMetadata[]> {
  const { octokit, owner, repo, pullNumber } = params;

  const fetchPage = (page: number) =>
    retryGitHubTransient(() =>
      octokit.rest.pulls.listFiles({
        owner,
        repo,
        pull_number: pullNumber,
        per_page: 100,
        page,
      })
    );

  const firstResponse = await fetchPage(1);
  const files = firstResponse.data.map(mapPullRequestFile);
  if (firstResponse.data.length < 100) {
    return files;
  }

  const lastPage = parseLastPageFromLinkHeader(firstResponse.headers?.link);
  if (!lastPage || lastPage <= 1) {
    let page = 2;
    while (true) {
      const response = await fetchPage(page);

      files.push(...response.data.map(mapPullRequestFile));
      if (response.data.length < 100) {
        return files;
      }
      page += 1;
    }
  }

  const remainingPages = Array.from({ length: lastPage - 1 }, (_, index) => index + 2);
  const remainingFiles = await mapWithConcurrency(remainingPages, 4, async (page) => {
    const response = await fetchPage(page);
    return response.data.map(mapPullRequestFile);
  });

  files.push(...remainingFiles.flat());
  return files;
}
