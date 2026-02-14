export type BracketTag = {
  tag: string;
  recognized: boolean;
  source: "title" | "body" | "commit";
  commitSha?: string;
};

export type ConventionalCommitType = {
  type: string;
  isBreaking: boolean;
  source: "title" | "commit";
};

export type ParsedPRIntent = {
  bracketTags: BracketTag[];
  conventionalType: ConventionalCommitType | null;
  breakingChangeDetected: boolean;
  breakingChangeSources: Array<{
    source: "title" | "body" | "commit";
    excerpt: string;
    commitSha?: string;
  }>;
  noReview: boolean;
  isWIP: boolean;
  profileOverride: "strict" | "balanced" | "minimal" | null;
  focusAreas: string[];
  styleOk: boolean;
  recognized: string[];
  unrecognized: string[];
};

export const DEFAULT_EMPTY_INTENT: ParsedPRIntent = {
  bracketTags: [],
  conventionalType: null,
  breakingChangeDetected: false,
  breakingChangeSources: [],
  noReview: false,
  isWIP: false,
  profileOverride: null,
  focusAreas: [],
  styleOk: false,
  recognized: [],
  unrecognized: [],
};

export function parsePRIntent(
  _title: string,
  _body: string | null,
  _commits?: Array<{ sha: string; message: string }>,
): ParsedPRIntent {
  throw new Error("not implemented");
}

export function buildKeywordParsingSection(_intent: ParsedPRIntent): string {
  throw new Error("not implemented");
}
