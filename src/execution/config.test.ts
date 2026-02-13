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
    expect(config.review.mode).toBe("standard");
    expect(config.review.severity.minLevel).toBe("minor");
    expect(config.review.focusAreas).toEqual([]);
    expect(config.review.ignoredAreas).toEqual([]);
    expect(config.review.maxComments).toBe(7);
    expect(config.review.pathInstructions).toEqual([]);
    expect(config.review.profile).toBeUndefined();
    expect(config.review.fileCategories).toBeUndefined();
    expect(config.mention.enabled).toBe(true);
    expect(config.mention.acceptClaudeAlias).toBe(true);
    expect(config.telemetry.enabled).toBe(true);
    expect(config.telemetry.costWarningUsd).toBe(0);
    expect(config.knowledge.shareGlobal).toBe(false);
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
      onSynchronize: false,
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
      "review:\n  triggers:\n    onOpened: true\n    onReadyForReview: true\n    onReviewRequested: true\n    onFutureEvent: true\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.review.triggers.onOpened).toBe(true);
    expect(config.review.triggers.onReadyForReview).toBe(true);
    expect(config.review.triggers.onReviewRequested).toBe(true);
    expect((config.review.triggers as Record<string, unknown>).onFutureEvent).toBeUndefined();
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
    expect(config.telemetry.enabled).toBe(true);
    expect(config.telemetry.costWarningUsd).toBe(0);
    expect(warnings.length).toBeGreaterThan(0);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("reads telemetry config from YAML", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "telemetry:\n  enabled: false\n  costWarningUsd: 2.5\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.telemetry.enabled).toBe(false);
    expect(config.telemetry.costWarningUsd).toBe(2.5);
    expect(warnings).toEqual([]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("knowledge.shareGlobal defaults false and parses true when configured", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    const defaults = await loadRepoConfig(dir);
    expect(defaults.config.knowledge.shareGlobal).toBe(false);

    await writeFile(join(dir, ".kodiai.yml"), "knowledge:\n  shareGlobal: true\n");
    const configured = await loadRepoConfig(dir);
    expect(configured.config.knowledge.shareGlobal).toBe(true);
    expect(configured.warnings).toEqual([]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("invalid knowledge section falls back to defaults with warning", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(join(dir, ".kodiai.yml"), "knowledge:\n  shareGlobal: maybe\n");
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.knowledge.shareGlobal).toBe(false);
    expect(warnings.some((w) => w.section === "knowledge")).toBe(true);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("falls back to telemetry defaults when telemetry section is invalid", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "telemetry:\n  enabled: notaboolean\nreview:\n  autoApprove: false\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.telemetry.enabled).toBe(true); // default
    expect(config.telemetry.costWarningUsd).toBe(0); // default
    expect(config.review.autoApprove).toBe(false); // preserved
    const telemetryWarning = warnings.find((w) => w.section === "telemetry");
    expect(telemetryWarning).toBeDefined();
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("mention.allowedUsers defaults to empty array", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.mention.allowedUsers).toEqual([]);
    expect(warnings).toEqual([]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("reads mention.allowedUsers from YAML", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "mention:\n  allowedUsers:\n    - alice\n    - bob\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.mention.allowedUsers).toEqual(["alice", "bob"]);
    expect(config.mention.enabled).toBe(true);
    expect(config.mention.acceptClaudeAlias).toBe(true);
    expect(warnings).toEqual([]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("parses review.mode: enhanced from YAML", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "review:\n  mode: enhanced\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.review.mode).toBe("enhanced");
    expect(warnings).toEqual([]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("parses review.severity.minLevel from YAML", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "review:\n  severity:\n    minLevel: major\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.review.severity.minLevel).toBe("major");
    expect(warnings).toEqual([]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("parses review.focusAreas from YAML", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "review:\n  focusAreas:\n    - security\n    - correctness\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.review.focusAreas).toEqual(["security", "correctness"]);
    expect(warnings).toEqual([]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("parses review.ignoredAreas from YAML", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "review:\n  ignoredAreas:\n    - style\n    - documentation\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.review.ignoredAreas).toEqual(["style", "documentation"]);
    expect(warnings).toEqual([]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("parses review.maxComments from YAML", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "review:\n  maxComments: 15\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.review.maxComments).toBe(15);
    expect(warnings).toEqual([]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("rejects invalid review.maxComments (out of range)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "review:\n  maxComments: 50\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.review.maxComments).toBe(7); // default after fallback
    expect(warnings.length).toBe(1);
    expect(warnings[0]!.section).toBe("review");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("rejects invalid review.mode value", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "review:\n  mode: turbo\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.review.mode).toBe("standard"); // default after fallback
    expect(warnings.length).toBe(1);
    expect(warnings[0]!.section).toBe("review");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("parses pathInstructions with single string path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "review:\n  pathInstructions:\n    - path: src/api/**\n      instructions: Check auth and input validation\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.review.pathInstructions).toEqual([
      {
        path: "src/api/**",
        instructions: "Check auth and input validation",
      },
    ]);
    expect(warnings).toEqual([]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("parses pathInstructions with array paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "review:\n  pathInstructions:\n    - path:\n        - src/db/**\n        - src/repo/**\n      instructions: Check transaction and consistency behavior\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.review.pathInstructions).toEqual([
      {
        path: ["src/db/**", "src/repo/**"],
        instructions: "Check transaction and consistency behavior",
      },
    ]);
    expect(warnings).toEqual([]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("pathInstructions defaults to empty array when omitted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(join(dir, ".kodiai.yml"), "review:\n  enabled: true\n");
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.review.pathInstructions).toEqual([]);
    expect(warnings).toEqual([]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("profile accepts strict, balanced, and minimal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    for (const profile of ["strict", "balanced", "minimal"] as const) {
      await writeFile(join(dir, ".kodiai.yml"), `review:\n  profile: ${profile}\n`);
      const { config, warnings } = await loadRepoConfig(dir);
      expect(config.review.profile).toBe(profile);
      expect(warnings).toEqual([]);
    }
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("profile is optional when omitted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(join(dir, ".kodiai.yml"), "review:\n  enabled: true\n");
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.review.profile).toBeUndefined();
    expect(warnings).toEqual([]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("parses fileCategories overrides", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "review:\n  fileCategories:\n    source:\n      - app/**\n    test:\n      - qa/**\n    config:\n      - settings/**\n    docs:\n      - docs/**\n    infra:\n      - deploy/**\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.review.fileCategories).toEqual({
      source: ["app/**"],
      test: ["qa/**"],
      config: ["settings/**"],
      docs: ["docs/**"],
      infra: ["deploy/**"],
    });
    expect(warnings).toEqual([]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("fileCategories is optional when omitted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(join(dir, ".kodiai.yml"), "review:\n  enabled: true\n");
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.review.fileCategories).toBeUndefined();
    expect(warnings).toEqual([]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("invalid pathInstructions falls back to review defaults via section fallback", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "review:\n  maxComments: 10\n  pathInstructions:\n    - path: src/api/**\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.review.pathInstructions).toEqual([]);
    expect(config.review.maxComments).toBe(7);
    expect(warnings.length).toBe(1);
    expect(warnings[0]!.section).toBe("review");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("new context-aware fields coexist with existing Phase 26 review fields", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "review:\n  enabled: true\n  autoApprove: false\n  mode: enhanced\n  severity:\n    minLevel: major\n  focusAreas:\n    - security\n  ignoredAreas:\n    - style\n  maxComments: 10\n  profile: minimal\n  pathInstructions:\n    - path: src/api/**\n      instructions: Check auth boundaries\n  fileCategories:\n    docs:\n      - handbook/**\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.review.enabled).toBe(true);
    expect(config.review.autoApprove).toBe(false);
    expect(config.review.mode).toBe("enhanced");
    expect(config.review.maxComments).toBe(10);
    expect(config.review.severity.minLevel).toBe("major");
    expect(config.review.focusAreas).toEqual(["security"]);
    expect(config.review.ignoredAreas).toEqual(["style"]);
    expect(config.review.profile).toBe("minimal");
    expect(config.review.pathInstructions).toEqual([
      {
        path: "src/api/**",
        instructions: "Check auth boundaries",
      },
    ]);
    expect(config.review.fileCategories).toEqual({ docs: ["handbook/**"] });
    expect(warnings).toEqual([]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("parses review.suppressions as simple string patterns", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "review:\n  suppressions:\n    - missing JSDoc\n    - glob:*unused*\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.review.suppressions).toEqual(["missing JSDoc", "glob:*unused*"]);
    expect(warnings).toEqual([]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("parses review.suppressions object patterns with optional metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "review:\n  suppressions:\n    - pattern: regex:missing.*handling\n      severity:\n        - major\n      category:\n        - correctness\n      paths:\n        - src/**\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.review.suppressions).toEqual([
      {
        pattern: "regex:missing.*handling",
        severity: ["major"],
        category: ["correctness"],
        paths: ["src/**"],
      },
    ]);
    expect(warnings).toEqual([]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("review.minConfidence parses and defaults correctly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(join(dir, ".kodiai.yml"), "review:\n  minConfidence: 40\n");
    const loaded = await loadRepoConfig(dir);
    expect(loaded.config.review.minConfidence).toBe(40);

    await writeFile(join(dir, ".kodiai.yml"), "review:\n  enabled: true\n");
    const defaults = await loadRepoConfig(dir);
    expect(defaults.config.review.minConfidence).toBe(0);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("invalid review.minConfidence falls back review section to defaults", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "review:\n  minConfidence: 150\n  suppressions:\n    - missing docs\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.review.minConfidence).toBe(0);
    expect(config.review.suppressions).toEqual([]);
    expect(warnings.some((w) => w.section === "review")).toBe(true);
  } finally {
    await rm(dir, { recursive: true });
  }
});

// Knowledge embeddings and sharing config tests

test("default config has knowledge.embeddings with correct defaults", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.knowledge.embeddings.enabled).toBe(true);
    expect(config.knowledge.embeddings.model).toBe("voyage-code-3");
    expect(config.knowledge.embeddings.dimensions).toBe(1024);
    expect(warnings).toEqual([]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("default config has knowledge.sharing.enabled === false", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.knowledge.sharing.enabled).toBe(false);
    expect(warnings).toEqual([]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("custom embeddings config parses correctly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "knowledge:\n  embeddings:\n    enabled: false\n    model: voyage-code-2\n    dimensions: 512\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.knowledge.embeddings.enabled).toBe(false);
    expect(config.knowledge.embeddings.model).toBe("voyage-code-2");
    expect(config.knowledge.embeddings.dimensions).toBe(512);
    expect(warnings).toEqual([]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("custom sharing config parses correctly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "knowledge:\n  sharing:\n    enabled: true\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.knowledge.sharing.enabled).toBe(true);
    expect(warnings).toEqual([]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("backward compat: knowledge.shareGlobal: true still parses without error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "knowledge:\n  shareGlobal: true\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.knowledge.shareGlobal).toBe(true);
    // sharing and embeddings should still have defaults
    expect(config.knowledge.sharing.enabled).toBe(false);
    expect(config.knowledge.embeddings.enabled).toBe(true);
    expect(config.knowledge.embeddings.model).toBe("voyage-code-3");
    expect(warnings).toEqual([]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

// Phase 31: onSynchronize trigger and retrieval settings

test("onSynchronize defaults to false and existing configs without it still parse", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    // Default without .kodiai.yml
    const defaults = await loadRepoConfig(dir);
    expect(defaults.config.review.triggers.onSynchronize).toBe(false);

    // Existing config without onSynchronize
    await writeFile(
      join(dir, ".kodiai.yml"),
      "review:\n  triggers:\n    onOpened: true\n    onReadyForReview: false\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.review.triggers.onSynchronize).toBe(false);
    expect(config.review.triggers.onOpened).toBe(true);
    expect(config.review.triggers.onReadyForReview).toBe(false);
    expect(warnings).toEqual([]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("retrieval section defaults are applied when omitted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    // No config file at all
    const defaults = await loadRepoConfig(dir);
    expect(defaults.config.knowledge.retrieval.enabled).toBe(true);
    expect(defaults.config.knowledge.retrieval.topK).toBe(5);
    expect(defaults.config.knowledge.retrieval.distanceThreshold).toBe(0.3);
    expect(defaults.config.knowledge.retrieval.maxContextChars).toBe(2000);

    // Config with knowledge section but no retrieval sub-section
    await writeFile(
      join(dir, ".kodiai.yml"),
      "knowledge:\n  shareGlobal: true\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.knowledge.retrieval.enabled).toBe(true);
    expect(config.knowledge.retrieval.topK).toBe(5);
    expect(config.knowledge.retrieval.distanceThreshold).toBe(0.3);
    expect(config.knowledge.retrieval.maxContextChars).toBe(2000);
    expect(warnings).toEqual([]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("retrieval section custom values are honored", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-test-"));
  try {
    await writeFile(
      join(dir, ".kodiai.yml"),
      "knowledge:\n  retrieval:\n    enabled: false\n    topK: 10\n    distanceThreshold: 0.5\n    maxContextChars: 3000\n",
    );
    const { config, warnings } = await loadRepoConfig(dir);
    expect(config.knowledge.retrieval.enabled).toBe(false);
    expect(config.knowledge.retrieval.topK).toBe(10);
    expect(config.knowledge.retrieval.distanceThreshold).toBe(0.5);
    expect(config.knowledge.retrieval.maxContextChars).toBe(3000);
    expect(warnings).toEqual([]);
  } finally {
    await rm(dir, { recursive: true });
  }
});
