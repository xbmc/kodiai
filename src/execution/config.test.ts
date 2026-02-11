import { test, expect } from "bun:test";
import { loadRepoConfig, type ConfigWarning } from "./config.ts";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("returns defaults when no .kodiai.yml exists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.model).toBe("claude-sonnet-4-5-20250929");
    expect(config.maxTurns).toBe(25);
    expect(config.write.enabled).toBe(false);
    expect(config.write.allowPaths).toEqual([]);
    expect(config.write.denyPaths).toEqual([
      ".github/",
      ".git/",
      ".planning/",
      ".kodiai.yml",
      ".env",
      ".env.*",
      "**/*.pem",
      "**/*.key",
      "**/*.p12",
      "**/*.pfx",
      "**/*credentials*",
      "**/*secret*",
    ]);
    expect(config.write.minIntervalSeconds).toBe(0);
    expect(config.write.secretScan.enabled).toBe(true);
    expect(config.review.enabled).toBe(true);
    expect(config.review.uiRereviewTeam).toBeUndefined();
    expect(config.review.requestUiRereviewTeamOnOpen).toBe(false);
    expect(config.review.triggers.onOpened).toBe(true);
    expect(config.review.triggers.onReadyForReview).toBe(true);
    expect(config.review.triggers.onReviewRequested).toBe(true);
    expect(config.review.autoApprove).toBe(true);
    expect(config.review.uiRereviewTeam).toBeUndefined();
    expect(config.review.requestUiRereviewTeamOnOpen).toBe(false);
    expect(config.review.skipAuthors).toEqual([]);
    expect(config.review.skipPaths).toEqual([]);
    expect(config.review.prompt).toBeUndefined();
    expect(config.mention.enabled).toBe(true);
    expect(config.mention.acceptClaudeAlias).toBe(true);
    expect(config.systemPromptAppend).toBeUndefined();
    expect(warnings).toEqual([]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("reads and validates .kodiai.yml when present", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "model: claude-opus-4-20250514\nmaxTurns: 10\nreview:\n  autoApprove: true\n",
    );
    const { config } = await loadRepoConfig(dir);
    expect(config.model).toBe("claude-opus-4-20250514");
    expect(config.maxTurns).toBe(10);
    expect(config.write.enabled).toBe(false); // default preserved
    expect(config.write.allowPaths).toEqual([]);
    expect(config.write.denyPaths).toEqual([
      ".github/",
      ".git/",
      ".planning/",
      ".kodiai.yml",
      ".env",
      ".env.*",
      "**/*.pem",
      "**/*.key",
      "**/*.p12",
      "**/*.pfx",
      "**/*credentials*",
      "**/*secret*",
    ]);
    expect(config.write.minIntervalSeconds).toBe(0);
    expect(config.write.secretScan.enabled).toBe(true);
    expect(config.review.autoApprove).toBe(true);
    expect(config.review.enabled).toBe(true); // default preserved
    expect(config.review.triggers.onOpened).toBe(true); // default preserved
    expect(config.review.triggers.onReadyForReview).toBe(true); // default preserved
    expect(config.review.triggers.onReviewRequested).toBe(true); // default preserved
    expect(config.mention.enabled).toBe(true); // default preserved
    expect(config.mention.acceptClaudeAlias).toBe(true); // default preserved
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("accepts write.enabled: true", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(join(dir, ".kodiai.yml"), "write:\n  enabled: true\n");
    const { config } = await loadRepoConfig(dir);
    expect(config.write.enabled).toBe(true);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("parses write policy config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "write:\n  enabled: true\n  minIntervalSeconds: 30\n  allowPaths:\n    - 'src/'\n  denyPaths:\n    - '.github/'\n  secretScan:\n    enabled: false\n",
    );
    const { config } = await loadRepoConfig(dir);
    expect(config.write.enabled).toBe(true);
    expect(config.write.minIntervalSeconds).toBe(30);
    expect(config.write.allowPaths).toEqual(["src/"]);
    expect(config.write.denyPaths).toEqual([".github/"]);
    expect(config.write.secretScan.enabled).toBe(false);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("strips unknown write keys without error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(join(dir, ".kodiai.yml"), "write:\n  enabled: false\n  mode: all\n");
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.write.enabled).toBe(false);
    expect((config.write as Record<string, unknown>).mode).toBeUndefined();
    expect(warnings).toEqual([]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("defaults mention.acceptClaudeAlias to true when mention block is omitted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(join(dir, ".kodiai.yml"), "review:\n  enabled: true\n");
    const { config } = await loadRepoConfig(dir);
    expect(config.mention.acceptClaudeAlias).toBe(true);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("accepts mention.acceptClaudeAlias: false", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "mention:\n  acceptClaudeAlias: false\n",
    );
    const { config } = await loadRepoConfig(dir);
    expect(config.mention.acceptClaudeAlias).toBe(false);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("strips unknown mention keys without error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "mention:\n  acceptClaudeAlias: true\n  acceptClaudeAliass: true\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.mention.acceptClaudeAlias).toBe(true);
    expect((config.mention as Record<string, unknown>).acceptClaudeAliass).toBeUndefined();
    expect(warnings).toEqual([]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("rejects invalid YAML", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(join(dir, ".kodiai.yml"), "{{invalid yaml");
    await expect(loadRepoConfig(dir)).rejects.toThrow("YAML parse error");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("falls back to defaults for invalid values with warning", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(join(dir, ".kodiai.yml"), "maxTurns: 999\n");
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.maxTurns).toBe(25);
    expect(warnings.length).toBe(1);
    expect(warnings[0]!.section).toBe("maxTurns");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("parses review.skipAuthors from YAML", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      'review:\n  skipAuthors:\n    - "dependabot[bot]"\n    - "renovate[bot]"\n',
    );
    const { config } = await loadRepoConfig(dir);
    expect(config.review.skipAuthors).toEqual([
      "dependabot[bot]",
      "renovate[bot]",
    ]);
    expect(config.review.skipPaths).toEqual([]);
    expect(config.review.enabled).toBe(true);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("parses review.skipPaths from YAML", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "review:\n  skipPaths:\n    - '*.lock'\n    - 'package-lock.json'\n",
    );
    const { config } = await loadRepoConfig(dir);
    expect(config.review.skipPaths).toEqual(["*.lock", "package-lock.json"]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("parses review.prompt from YAML", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      'review:\n  prompt: "Focus on security issues"\n',
    );
    const { config } = await loadRepoConfig(dir);
    expect(config.review.prompt).toBe("Focus on security issues");
    expect(config.review.enabled).toBe(true);
    expect(config.review.autoApprove).toBe(true);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("parses review.triggers from YAML", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "review:\n  triggers:\n    onOpened: true\n    onReadyForReview: false\n    onReviewRequested: true\n",
    );
    const { config } = await loadRepoConfig(dir);
    expect(config.review.triggers).toEqual({
      onOpened: true,
      onReadyForReview: false,
      onReviewRequested: true,
    });
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("defaults review_requested trigger when triggers block is omitted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(join(dir, ".kodiai.yml"), "review:\n  enabled: true\n");
    const { config } = await loadRepoConfig(dir);
    expect(config.review.triggers.onOpened).toBe(true);
    expect(config.review.triggers.onReadyForReview).toBe(true);
    expect(config.review.triggers.onReviewRequested).toBe(true);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("allows explicitly disabling onReviewRequested", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "review:\n  triggers:\n    onOpened: true\n    onReadyForReview: true\n    onReviewRequested: false\n",
    );
    const { config } = await loadRepoConfig(dir);
    expect(config.review.triggers.onReviewRequested).toBe(false);
    expect(config.review.triggers.onOpened).toBe(true);
    expect(config.review.triggers.onReadyForReview).toBe(true);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("strips unknown review.triggers keys without error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "review:\n  triggers:\n    onOpened: true\n    onReadyForReview: true\n    onReviewRequested: true\n    onSynchronize: true\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.review.triggers.onOpened).toBe(true);
    expect(config.review.triggers.onReadyForReview).toBe(true);
    expect(config.review.triggers.onReviewRequested).toBe(true);
    expect((config.review.triggers as Record<string, unknown>).onSynchronize).toBeUndefined();
    expect(warnings).toEqual([]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

// Forward-compatibility tests

test("strips unknown top-level keys without error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "futureFeature: true\nmodel: claude-sonnet-4-5-20250929\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.model).toBe("claude-sonnet-4-5-20250929");
    expect((config as Record<string, unknown>).futureFeature).toBeUndefined();
    expect(warnings).toEqual([]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("strips unknown nested keys in review section", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "review:\n  enabled: true\n  futureField: hello\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.review.enabled).toBe(true);
    expect((config.review as Record<string, unknown>).futureField).toBeUndefined();
    expect(warnings).toEqual([]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("strips unknown keys in write.secretScan", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "write:\n  enabled: true\n  secretScan:\n    enabled: true\n    extraField: 42\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.write.secretScan.enabled).toBe(true);
    expect((config.write.secretScan as Record<string, unknown>).extraField).toBeUndefined();
    expect(warnings).toEqual([]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

// Graceful degradation tests

test("falls back to review defaults when review section is invalid, preserves valid write", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "review:\n  enabled: notaboolean\nwrite:\n  enabled: true\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.review.enabled).toBe(true); // default
    expect(config.write.enabled).toBe(true); // preserved
    expect(warnings.length).toBe(1);
    expect(warnings[0]!.section).toBe("review");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("falls back to write defaults when write section is invalid, preserves valid review", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "write:\n  enabled: notaboolean\nreview:\n  autoApprove: false\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.write.enabled).toBe(false); // default
    expect(config.review.autoApprove).toBe(false); // preserved
    expect(warnings.length).toBe(1);
    expect(warnings[0]!.section).toBe("write");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("falls back to mention defaults when mention section is invalid", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "mention:\n  enabled: 42\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.mention.enabled).toBe(true); // default
    expect(warnings.length).toBe(1);
    expect(warnings[0]!.section).toBe("mention");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("falls back to defaults for individual top-level scalars", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "maxTurns: 999\nmodel: claude-opus-4-20250514\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.maxTurns).toBe(25); // default (999 exceeds max 100)
    expect(config.model).toBe("claude-opus-4-20250514"); // preserved
    expect(warnings.length).toBe(1);
    expect(warnings[0]!.section).toBe("maxTurns");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("multiple sections invalid produces multiple warnings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "write:\n  enabled: notaboolean\nmention:\n  enabled: 42\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.write.enabled).toBe(false); // default
    expect(config.mention.enabled).toBe(true); // default
    expect(warnings.length).toBe(2);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("completely invalid config (not an object) falls back to all defaults", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(join(dir, ".kodiai.yml"), "justAString");
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.model).toBe("claude-sonnet-4-5-20250929");
    expect(config.maxTurns).toBe(25);
    expect(config.write.enabled).toBe(false);
    expect(config.review.enabled).toBe(true);
    expect(config.mention.enabled).toBe(true);
    expect(warnings.length).toBeGreaterThan(0);
  } finally {
    await rm(dir, { recursive: true });
  }
});
