import { test, expect } from "bun:test";
import { loadRepoConfig } from "./config.ts";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("returns defaults when no .kodiai.yml exists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    const config = await loadRepoConfig(dir);
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
    expect(config.review.triggers.onOpened).toBe(true);
    expect(config.review.triggers.onReadyForReview).toBe(true);
    expect(config.review.triggers.onReviewRequested).toBe(true);
    expect(config.review.autoApprove).toBe(true);
    expect(config.review.skipAuthors).toEqual([]);
    expect(config.review.skipPaths).toEqual([]);
    expect(config.review.prompt).toBeUndefined();
    expect(config.mention.enabled).toBe(true);
    expect(config.mention.acceptClaudeAlias).toBe(true);
    expect(config.systemPromptAppend).toBeUndefined();
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
    const config = await loadRepoConfig(dir);
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
    const config = await loadRepoConfig(dir);
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
    const config = await loadRepoConfig(dir);
    expect(config.write.enabled).toBe(true);
    expect(config.write.minIntervalSeconds).toBe(30);
    expect(config.write.allowPaths).toEqual(["src/"]);
    expect(config.write.denyPaths).toEqual([".github/"]);
    expect(config.write.secretScan.enabled).toBe(false);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("rejects unsupported write keys", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(join(dir, ".kodiai.yml"), "write:\n  enabled: false\n  mode: all\n");
    await expect(loadRepoConfig(dir)).rejects.toThrow("Invalid .kodiai.yml");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("defaults mention.acceptClaudeAlias to true when mention block is omitted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(join(dir, ".kodiai.yml"), "review:\n  enabled: true\n");
    const config = await loadRepoConfig(dir);
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
    const config = await loadRepoConfig(dir);
    expect(config.mention.acceptClaudeAlias).toBe(false);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("rejects unsupported mention keys", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "mention:\n  acceptClaudeAlias: true\n  acceptClaudeAliass: true\n",
    );
    await expect(loadRepoConfig(dir)).rejects.toThrow("Invalid .kodiai.yml");
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

test("rejects invalid values", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(join(dir, ".kodiai.yml"), "maxTurns: 999\n");
    await expect(loadRepoConfig(dir)).rejects.toThrow("Invalid .kodiai.yml");
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
    const config = await loadRepoConfig(dir);
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
    const config = await loadRepoConfig(dir);
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
    const config = await loadRepoConfig(dir);
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
    const config = await loadRepoConfig(dir);
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
    const config = await loadRepoConfig(dir);
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
    const config = await loadRepoConfig(dir);
    expect(config.review.triggers.onReviewRequested).toBe(false);
    expect(config.review.triggers.onOpened).toBe(true);
    expect(config.review.triggers.onReadyForReview).toBe(true);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("rejects unsupported review.triggers keys", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "review:\n  triggers:\n    onOpened: true\n    onReadyForReview: true\n    onReviewRequested: true\n    onSynchronize: true\n",
    );
    await expect(loadRepoConfig(dir)).rejects.toThrow("Invalid .kodiai.yml");
  } finally {
    await rm(dir, { recursive: true });
  }
});
