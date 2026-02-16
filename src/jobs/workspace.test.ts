import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildWritePolicyRefusalMessage } from "../handlers/mention.ts";
import { enforceWritePolicy, WritePolicyError } from "./workspace.ts";

async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "kodiai-workspace-test-"));
}

describe("enforceWritePolicy", () => {
  test("passes when no denyPaths or allowPaths are configured", async () => {
    const dir = await createTempDir();
    try {
      await expect(
        enforceWritePolicy({
          dir,
          stagedPaths: ["src/foo.ts"],
          allowPaths: [],
          denyPaths: [],
          secretScanEnabled: false,
        }),
      ).resolves.toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects path matching denyPaths", async () => {
    const dir = await createTempDir();
    try {
      const promise = enforceWritePolicy({
        dir,
        stagedPaths: [".github/workflows/ci.yml"],
        allowPaths: [],
        denyPaths: [".github/"],
        secretScanEnabled: false,
      });

      await expect(promise).rejects.toBeInstanceOf(WritePolicyError);
      await expect(promise).rejects.toMatchObject({
        code: "write-policy-denied-path",
        rule: "denyPaths",
        path: ".github/workflows/ci.yml",
        pattern: ".github/",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects path outside allowPaths", async () => {
    const dir = await createTempDir();
    try {
      const promise = enforceWritePolicy({
        dir,
        stagedPaths: ["README.md"],
        allowPaths: ["src/"],
        denyPaths: [],
        secretScanEnabled: false,
      });

      await expect(promise).rejects.toMatchObject({
        code: "write-policy-not-allowed",
        rule: "allowPaths",
        path: "README.md",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("passes path inside allowPaths", async () => {
    const dir = await createTempDir();
    try {
      await expect(
        enforceWritePolicy({
          dir,
          stagedPaths: ["src/index.ts"],
          allowPaths: ["src/"],
          denyPaths: [],
          secretScanEnabled: false,
        }),
      ).resolves.toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("denyPaths wins over allowPaths", async () => {
    const dir = await createTempDir();
    try {
      const promise = enforceWritePolicy({
        dir,
        stagedPaths: [".github/foo.yml"],
        allowPaths: ["src/", ".github/"],
        denyPaths: [".github/"],
        secretScanEnabled: false,
      });

      await expect(promise).rejects.toMatchObject({
        code: "write-policy-denied-path",
        rule: "denyPaths",
        path: ".github/foo.yml",
        pattern: ".github/",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("buildWritePolicyRefusalMessage", () => {
  test("formats denyPaths refusal with matched pattern", () => {
    const message = buildWritePolicyRefusalMessage(
      new WritePolicyError("write-policy-denied-path", "blocked", {
        path: "README.md",
        rule: "denyPaths",
        pattern: "README.md",
      }),
      [],
    );

    expect(message).toContain("Write request refused");
    expect(message).toContain("Reason: write-policy-denied-path");
    expect(message).toContain("Rule: denyPaths");
    expect(message).toContain("File: README.md");
    expect(message).toContain("Matched pattern: README.md");
  });

  test("formats allowPaths refusal with config snippet", () => {
    const message = buildWritePolicyRefusalMessage(
      new WritePolicyError("write-policy-not-allowed", "blocked", {
        path: "README.md",
        rule: "allowPaths",
      }),
      ["src/"],
    );

    expect(message).toContain("Smallest config change");
    expect(message).toContain("allowPaths");
    expect(message).toContain("- 'README.md'");
    expect(message).toContain("Current allowPaths: 'src/'");
  });

  test("formats secretScan refusal with safe remediation", () => {
    const message = buildWritePolicyRefusalMessage(
      new WritePolicyError("write-policy-secret-detected", "blocked", {
        path: "config.ts",
        rule: "secretScan",
        detector: "regex:github-pat",
      }),
      [],
    );

    expect(message).toContain("Detector: regex:github-pat");
    expect(message).toContain("Remove/redact the secret-like content and retry");
    expect(message).not.toContain("ghp_");
  });

  test("formats no-changes refusal", () => {
    const message = buildWritePolicyRefusalMessage(
      new WritePolicyError("write-policy-no-changes", "No staged changes to commit"),
      [],
    );

    expect(message).toContain("No file changes were produced");
  });
});
