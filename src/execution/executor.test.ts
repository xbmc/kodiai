import { test, expect, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildSecurityClaudeMd } from "./executor.ts";

// ── Content tests ──────────────────────────────────────────────────────────

test("buildSecurityClaudeMd returns string containing '## Security Policy'", () => {
  const result = buildSecurityClaudeMd();
  expect(result).toContain("Security Policy");
});

test("buildSecurityClaudeMd result contains refusal response wording", () => {
  const result = buildSecurityClaudeMd();
  expect(result).toContain("I can't help with that");
});

test("buildSecurityClaudeMd result contains 'Do NOT'", () => {
  const result = buildSecurityClaudeMd();
  expect(result).toContain("Do NOT");
});

test("buildSecurityClaudeMd result mentions credential protection", () => {
  const result = buildSecurityClaudeMd();
  expect(result).toContain("credentials");
});

test("buildSecurityClaudeMd result mentions environment variables", () => {
  const result = buildSecurityClaudeMd();
  expect(result).toContain("environment variables");
});

test("buildSecurityClaudeMd result contains override-resistance statement", () => {
  const result = buildSecurityClaudeMd();
  expect(result).toContain("cannot be overridden");
});

// ── File write tests ───────────────────────────────────────────────────────

let tmpDir: string | undefined;

afterEach(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true });
    tmpDir = undefined;
  }
});

test("writing buildSecurityClaudeMd() to CLAUDE.md round-trips correctly", async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "kodiai-executor-test-"));
  const content = buildSecurityClaudeMd();
  await writeFile(join(tmpDir, "CLAUDE.md"), content);
  const read = await readFile(join(tmpDir, "CLAUDE.md"), "utf-8");
  expect(read).toContain("Security Policy");
  expect(read).toBe(content);
});

test("CLAUDE.md content includes all three Do NOT directives", async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "kodiai-executor-test-"));
  const content = buildSecurityClaudeMd();
  await writeFile(join(tmpDir, "CLAUDE.md"), content);
  const read = await readFile(join(tmpDir, "CLAUDE.md"), "utf-8");
  const doNotMatches = read.match(/Do NOT/g) ?? [];
  expect(doNotMatches.length).toBeGreaterThanOrEqual(3);
});
