export const M060_S01_RUNTIME_TARGETS = [
  "src/knowledge/isolation.ts",
  "src/knowledge/wiki-fetch.ts",
  "src/knowledge/issue-retrieval.ts",
  "src/knowledge/wiki-popularity-config.ts",
  "src/knowledge/wiki-linkshere-fetcher.ts",
  "src/knowledge/wiki-popularity-scorer.ts",
  "src/knowledge/cluster-scheduler.ts",
] as const;

export const M060_S01_TYPE_ONLY_EXEMPTIONS = [
  "src/knowledge/canonical-code-types.ts",
  "src/knowledge/cluster-types.ts",
  "src/knowledge/code-snippet-types.ts",
  "src/knowledge/issue-types.ts",
  "src/knowledge/review-comment-types.ts",
  "src/knowledge/types.ts",
  "src/knowledge/wiki-publisher-types.ts",
  "src/knowledge/wiki-staleness-types.ts",
  "src/knowledge/wiki-types.ts",
  "src/knowledge/wiki-update-types.ts",
  "src/knowledge/wiki-voice-types.ts",
] as const;

export type M060S01RuntimeTarget = (typeof M060_S01_RUNTIME_TARGETS)[number];
export type M060S01TypeOnlyExemption = (typeof M060_S01_TYPE_ONLY_EXEMPTIONS)[number];
