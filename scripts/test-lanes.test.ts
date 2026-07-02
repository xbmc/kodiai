import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildTestLanePlan,
  classifyTestFile,
  discoverTestFiles,
  parseTestLaneArgs,
} from "./test-lanes.ts";

describe("test lane runner", () => {
  test("classifies only runtime TEST_DATABASE_URL readers as DB-backed tests", () => {
    const envName = "TEST_" + "DATABASE_URL";
    expect(classifyTestFile(`const url = process.env.${envName};\n`)).toBe("db");
    expect(classifyTestFile(`const url = Bun.env.${envName};\n`)).toBe("db");
    expect(classifyTestFile(`expect(detail).toContain("${envName}");\n`)).toBe("unit");
  });

  test("discovers test files deterministically and splits unit from DB lanes", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "kodiai-test-lanes-"));
    await mkdir(path.join(cwd, "src", "knowledge"), { recursive: true });
    await mkdir(path.join(cwd, "scripts"), { recursive: true });
    await writeFile(path.join(cwd, "src", "alpha.test.ts"), "test('unit', () => {})\n");
    const envName = "TEST_" + "DATABASE_URL";
    await writeFile(
      path.join(cwd, "src", "knowledge", "store.test.ts"),
      `const TEST_DB_URL = process.env.${envName};\n`,
    );
    await writeFile(path.join(cwd, "scripts", "verify.test.ts"), `expect("${envName}").toBeTruthy();\n`);
    await writeFile(path.join(cwd, "src", "ignore.ts"), "not a test\n");

    await expect(discoverTestFiles(["src", "scripts"], cwd)).resolves.toEqual([
      "scripts/verify.test.ts",
      "src/alpha.test.ts",
      "src/knowledge/store.test.ts",
    ]);

    await expect(buildTestLanePlan({ roots: ["src", "scripts"], cwd })).resolves.toEqual({
      unit: ["scripts/verify.test.ts", "src/alpha.test.ts"],
      db: ["src/knowledge/store.test.ts"],
    });
  });

  test("classifies discovered test files with bounded concurrent reads", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "kodiai-test-lanes-"));
    await mkdir(path.join(cwd, "src"), { recursive: true });
    await writeFile(path.join(cwd, "src", "a.test.ts"), "test('a', () => {})\n");
    await writeFile(path.join(cwd, "src", "b.test.ts"), "test('b', () => {})\n");

    let activeReads = 0;
    let maxActiveReads = 0;
    let firstReadStarted!: () => void;
    let releaseFirstRead!: () => void;
    const firstReadStartedPromise = new Promise<void>((resolve) => {
      firstReadStarted = resolve;
    });
    const releaseFirstReadPromise = new Promise<void>((resolve) => {
      releaseFirstRead = resolve;
    });
    let readCount = 0;
    const planPromise = buildTestLanePlan({
      roots: ["src"],
      cwd,
      readTextFile: async () => {
        readCount++;
        activeReads++;
        maxActiveReads = Math.max(maxActiveReads, activeReads);
        if (readCount === 1) {
          firstReadStarted();
          await releaseFirstReadPromise;
        }
        activeReads--;
        return "test('unit', () => {})\n";
      },
    });

    await firstReadStartedPromise;
    await Promise.resolve();
    await Promise.resolve();
    expect(maxActiveReads).toBeGreaterThan(1);
    releaseFirstRead();

    await expect(planPromise).resolves.toEqual({
      unit: ["src/a.test.ts", "src/b.test.ts"],
      db: [],
    });
  });

  test("parses lane, list, and custom roots", () => {
    expect(parseTestLaneArgs(["unit", "--list", "--root", "src"])).toEqual({
      lane: "unit",
      listOnly: true,
      roots: ["src"],
    });
    expect(() => parseTestLaneArgs([])).toThrow(/expected lane/);
    expect(() => parseTestLaneArgs(["unit", "db"])).toThrow(/more than once/);
  });
});
