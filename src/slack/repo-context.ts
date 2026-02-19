const DEFAULT_REPO = "xbmc/xbmc";

const CLARIFYING_QUESTION =
  "I could not determine a single repo context. Which repo should I use? Please reply with owner/repo.";

const REPO_TOKEN_PATTERN =
  /(?:^|[^A-Za-z0-9_.-])([A-Za-z0-9][A-Za-z0-9_.-]*)\/([A-Za-z0-9][A-Za-z0-9_.-]*)(?=$|[^A-Za-z0-9_.-])/g;
const TRAILING_OWNER_PATTERN =
  /(?:^|[\s(\[{<])([A-Za-z0-9][A-Za-z0-9_.-]*)\/(?=$|[\s)\]}>,.!?;:])/;
const LEADING_REPO_PATTERN =
  /(?:^|[\s(\[{<])\/([A-Za-z0-9][A-Za-z0-9_.-]*)(?=$|[\s)\]}>,.!?;:])/;

export type SlackRepoContextResolution =
  | {
      outcome: "default";
      repo: string;
      acknowledgementText: undefined;
      clarifyingQuestion: undefined;
    }
  | {
      outcome: "override";
      repo: string;
      acknowledgementText: string;
      clarifyingQuestion: undefined;
    }
  | {
      outcome: "ambiguous";
      repo: undefined;
      acknowledgementText: undefined;
      clarifyingQuestion: string;
    };

function extractDistinctRepoTokens(text: string): string[] {
  const found: string[] = [];

  for (const match of text.matchAll(REPO_TOKEN_PATTERN)) {
    const owner = (match[1] ?? "").toLowerCase();
    const repo = (match[2] ?? "").toLowerCase();
    if (!owner || !repo) {
      continue;
    }

    if (match.index !== undefined) {
      const rawMatch = match[0] ?? "";
      const token = `${match[1] ?? ""}/${match[2] ?? ""}`;
      const relativeTokenOffset = rawMatch.toLowerCase().lastIndexOf(token.toLowerCase());
      if (relativeTokenOffset >= 0) {
        const tokenEndIndex = match.index + relativeTokenOffset + token.length;
        if (text[tokenEndIndex] === "/") {
          continue;
        }
      }
    }

    found.push(`${owner}/${repo}`);
  }

  return [...new Set(found)];
}

function hasMalformedRepoToken(text: string): boolean {
  return TRAILING_OWNER_PATTERN.test(text) || LEADING_REPO_PATTERN.test(text);
}

export function resolveSlackRepoContext(text: string): SlackRepoContextResolution {
  const repos = extractDistinctRepoTokens(text);

  if (repos.length > 1 || hasMalformedRepoToken(text)) {
    return {
      outcome: "ambiguous",
      repo: undefined,
      acknowledgementText: undefined,
      clarifyingQuestion: CLARIFYING_QUESTION,
    };
  }

  if (repos.length === 1) {
    const repo = repos[0] as string;
    if (repo === DEFAULT_REPO) {
      return {
        outcome: "default",
        repo,
        acknowledgementText: undefined,
        clarifyingQuestion: undefined,
      };
    }

    return {
      outcome: "override",
      repo,
      acknowledgementText: `Using repo context ${repo}.`,
      clarifyingQuestion: undefined,
    };
  }

  return {
    outcome: "default",
    repo: DEFAULT_REPO,
    acknowledgementText: undefined,
    clarifyingQuestion: undefined,
  };
}
