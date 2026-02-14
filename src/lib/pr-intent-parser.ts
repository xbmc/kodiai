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
  breakingChangeSources: Array<{ source: "title" | "body" | "commit"; excerpt: string; commitSha?: string }>;
  noReview: boolean;
  isWIP: boolean;
  profileOverride: "strict" | "balanced" | "minimal" | null;
  focusAreas: string[];
  styleOk: boolean;
  recognized: string[];
  unrecognized: string[];
};

type CommitMessage = { sha: string; message: string };
type BreakingSource = { source: "title" | "body" | "commit"; excerpt: string; commitSha?: string };

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

const RECOGNIZED_TAGS = new Set(["wip", "draft", "no-review", "strict-review", "balanced-review", "minimal-review", "security-review", "style-ok"]);
const CONVENTIONAL_REGEX = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(!)?(\([^)]+\))?\s*:/i;
const BREAKING_PATTERNS = [/\bbreaking\s+change[s]?\b/i, /\bthis\s+breaks\b/i, /\bbreaking\s+api\b/i, /\bBREAKING[- ]CHANGE\b/];

function extractBracketTags(text: string, source: "title" | "body" | "commit", commitSha?: string): BracketTag[] {
  const tags: BracketTag[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/\[([^\]]+)\]/g)) {
    const tag = (match[1] ?? "").trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push({ tag, recognized: RECOGNIZED_TAGS.has(tag), source, ...(commitSha ? { commitSha } : {}) });
  }
  return tags;
}

function extractConventionalType(title: string): ConventionalCommitType | null {
  const normalized = title.replace(/^(\s*\[[^\]]+\]\s*)+/, "");
  const match = normalized.match(CONVENTIONAL_REGEX);
  if (!match) return null;
  return { type: match[1]!.toLowerCase(), isBreaking: Boolean(match[2]), source: "title" };
}

function stripCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ");
}

function resolveProfileOverride(tags: string[]): "strict" | "balanced" | "minimal" | null {
  const rank: Record<string, number> = { "minimal-review": 1, "balanced-review": 2, "strict-review": 3 };
  let best: "strict" | "balanced" | "minimal" | null = null;
  let score = 0;
  for (const tag of tags) {
    const next = rank[tag] ?? 0;
    if (next > score) {
      score = next;
      best = tag.replace("-review", "") as "strict" | "balanced" | "minimal";
    }
  }
  return best;
}

function sampleCommitMessages(commits: CommitMessage[]): CommitMessage[] {
  if (commits.length <= 50) return commits;
  const sampled: CommitMessage[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < 10; i += 1) {
    sampled.push(commits[i]!);
    seen.add(i);
  }
  for (let i = 10; i < commits.length - 10; i += 1) {
    if ((i + 1) % 5 === 0 && !seen.has(i)) {
      sampled.push(commits[i]!);
      seen.add(i);
    }
  }
  for (let i = commits.length - 10; i < commits.length; i += 1) {
    if (!seen.has(i)) sampled.push(commits[i]!);
  }
  return sampled;
}

function detectBreakingChange(title: string, body: string | null, commits: CommitMessage[], conventionalType: ConventionalCommitType | null): BreakingSource[] {
  const sources: BreakingSource[] = [];
  if (conventionalType?.isBreaking) sources.push({ source: "title", excerpt: title });

  const bodyText = stripCode(body ?? "");
  if (BREAKING_PATTERNS.some((p) => p.test(bodyText))) {
    sources.push({ source: "body", excerpt: bodyText.trim().slice(0, 120) });
  }

  for (const commit of commits) {
    if (BREAKING_PATTERNS.some((p) => p.test(commit.message))) {
      sources.push({ source: "commit", excerpt: commit.message, commitSha: commit.sha });
    }
  }
  return sources;
}

export function parsePRIntent(title: string, body: string | null, commits?: CommitMessage[]): ParsedPRIntent {
  const sampledCommits = sampleCommitMessages(commits ?? []);
  const rawTags = [...extractBracketTags(title, "title")];
  for (const commit of sampledCommits) rawTags.push(...extractBracketTags(commit.message, "commit", commit.sha));

  const bracketTags: BracketTag[] = [];
  const seenTag = new Set<string>();
  for (const tag of rawTags) {
    if (seenTag.has(tag.tag)) continue;
    seenTag.add(tag.tag);
    bracketTags.push(tag);
  }

  const recognized = bracketTags.filter((t) => t.recognized).map((t) => t.tag);
  const unrecognized = bracketTags.filter((t) => !t.recognized).map((t) => t.tag);
  const conventionalType = extractConventionalType(title);
  const breakingChangeSources = detectBreakingChange(title, body, sampledCommits, conventionalType);

  return {
    bracketTags,
    conventionalType,
    breakingChangeDetected: breakingChangeSources.length > 0,
    breakingChangeSources,
    noReview: recognized.includes("no-review"),
    isWIP: recognized.includes("wip"),
    profileOverride: resolveProfileOverride(recognized),
    focusAreas: recognized.includes("security-review") ? ["security"] : [],
    styleOk: recognized.includes("style-ok"),
    recognized,
    unrecognized,
  };
}

function formatTagSource(tag: BracketTag): string {
  const renderedTag = `[${tag.tag.toUpperCase()}]`;
  return tag.source === "commit" ? `${renderedTag} in commit ${tag.commitSha}` : `${renderedTag} in ${tag.source}`;
}

export function buildKeywordParsingSection(intent: ParsedPRIntent): string {
  const hasSignals = intent.recognized.length > 0 || intent.unrecognized.length > 0 || intent.conventionalType !== null || intent.breakingChangeDetected;
  if (!hasSignals) return "- Keyword parsing: No keywords detected";

  const lines = ["- Keyword parsing:"];
  const recognizedSources = intent.bracketTags.filter((tag) => tag.recognized).map(formatTagSource);
  if (recognizedSources.length > 0) lines.push(`  - recognized: ${recognizedSources.join(", ")}`);
  if (intent.unrecognized.length > 0) lines.push(`  - ignored [${intent.unrecognized.join("], [")}]`);
  if (intent.conventionalType) {
    const suffix = intent.conventionalType.isBreaking ? " (breaking)" : "";
    lines.push(`  - conventional type: ${intent.conventionalType.type}${suffix}`);
  }
  for (const source of intent.breakingChangeSources) {
    lines.push(source.source === "commit" ? `  - breaking change in commit ${source.commitSha}` : `  - breaking change in ${source.source}`);
  }
  return lines.join("\n");
}
