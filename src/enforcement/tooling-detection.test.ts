import { test, expect } from "bun:test";
import { detectRepoTooling, FORMATTER_CONFIGS, LINTER_CONFIGS } from "./tooling-detection.ts";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("empty workspace returns empty maps", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-tooling-"));
  try {
    const result = await detectRepoTooling(dir);
    expect(result.formatters.size).toBe(0);
    expect(result.linters.size).toBe(0);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("detects .prettierrc as JS/TS formatter", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-tooling-"));
  try {
    await writeFile(join(dir, ".prettierrc"), "{}");
    const result = await detectRepoTooling(dir);
    expect(result.formatters.get("JavaScript")).toContain(".prettierrc");
    expect(result.formatters.get("TypeScript")).toContain(".prettierrc");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("detects .clang-format as C/C++ formatter", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-tooling-"));
  try {
    await writeFile(join(dir, ".clang-format"), "BasedOnStyle: Google");
    const result = await detectRepoTooling(dir);
    expect(result.formatters.get("C++")).toContain(".clang-format");
    expect(result.formatters.get("C")).toContain(".clang-format");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("detects .black.toml as Python formatter", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-tooling-"));
  try {
    await writeFile(join(dir, ".black.toml"), "[tool.black]");
    const result = await detectRepoTooling(dir);
    expect(result.formatters.get("Python")).toContain(".black.toml");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("detects eslintrc.json as JS/TS linter", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-tooling-"));
  try {
    await writeFile(join(dir, ".eslintrc.json"), "{}");
    const result = await detectRepoTooling(dir);
    expect(result.linters.get("JavaScript")).toContain(".eslintrc.json");
    expect(result.linters.get("TypeScript")).toContain(".eslintrc.json");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("detects eslint flat config (eslint.config.js)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-tooling-"));
  try {
    await writeFile(join(dir, "eslint.config.js"), "export default [];");
    const result = await detectRepoTooling(dir);
    expect(result.linters.get("JavaScript")).toContain("eslint.config.js");
    expect(result.linters.get("TypeScript")).toContain("eslint.config.js");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("detects .golangci.yml as Go linter", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-tooling-"));
  try {
    await writeFile(join(dir, ".golangci.yml"), "linters: {}");
    const result = await detectRepoTooling(dir);
    expect(result.linters.get("Go")).toContain(".golangci.yml");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("Go special case: go.mod implies gofmt formatter", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-tooling-"));
  try {
    await writeFile(join(dir, "go.mod"), "module example.com/foo\n\ngo 1.21\n");
    const result = await detectRepoTooling(dir);
    expect(result.formatters.has("Go")).toBe(true);
    const goFormatters = result.formatters.get("Go")!;
    expect(goFormatters).toContain("go.mod (gofmt built-in)");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("Go special case overrides .editorconfig detection", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-tooling-"));
  try {
    await writeFile(join(dir, ".editorconfig"), "[*]\nindent_style = space");
    await writeFile(join(dir, "go.mod"), "module example.com/foo\n\ngo 1.21\n");
    const result = await detectRepoTooling(dir);
    // go.mod special case should override .editorconfig detection for Go
    const goFormatters = result.formatters.get("Go")!;
    expect(goFormatters).toContain("go.mod (gofmt built-in)");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("detects multiple config files for same language", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-tooling-"));
  try {
    await writeFile(join(dir, ".prettierrc"), "{}");
    await writeFile(join(dir, ".editorconfig"), "[*]\nindent_style = space");
    const result = await detectRepoTooling(dir);
    const jsFormatters = result.formatters.get("JavaScript")!;
    expect(jsFormatters).toContain(".prettierrc");
    expect(jsFormatters).toContain(".editorconfig");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("detects formatters and linters simultaneously", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodiai-tooling-"));
  try {
    await writeFile(join(dir, ".prettierrc"), "{}");
    await writeFile(join(dir, ".eslintrc.json"), "{}");
    const result = await detectRepoTooling(dir);
    expect(result.formatters.has("JavaScript")).toBe(true);
    expect(result.linters.has("JavaScript")).toBe(true);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("fail-open: nonexistent workspace returns empty maps", async () => {
  const result = await detectRepoTooling("/tmp/nonexistent-workspace-dir-xyz-" + Date.now());
  expect(result.formatters.size).toBe(0);
  expect(result.linters.size).toBe(0);
});

test("FORMATTER_CONFIGS includes expected languages", () => {
  const languages = Object.keys(FORMATTER_CONFIGS);
  expect(languages).toContain("JavaScript");
  expect(languages).toContain("TypeScript");
  expect(languages).toContain("Python");
  expect(languages).toContain("C++");
  expect(languages).toContain("C");
  expect(languages).toContain("Go");
  expect(languages).toContain("Rust");
  expect(languages).toContain("Java");
});

test("LINTER_CONFIGS includes expected languages", () => {
  const languages = Object.keys(LINTER_CONFIGS);
  expect(languages).toContain("JavaScript");
  expect(languages).toContain("TypeScript");
  expect(languages).toContain("Python");
  expect(languages).toContain("Go");
  expect(languages).toContain("Rust");
});
