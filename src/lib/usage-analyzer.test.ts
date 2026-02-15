import { describe, expect, test } from "bun:test";
import {
  analyzePackageUsage,
  buildSearchTerms,
  parseGitGrepOutput,
  withTimeBudget,
} from "./usage-analyzer.ts";

describe("buildSearchTerms", () => {
  test("extracts terms from package name, dot-call patterns, and backticks", () => {
    const terms = buildSearchTerms("react-router", [
      "BREAKING: `foo.bar()` removed; use `foo.baz()` instead.",
      "Also renamed `SomeType`.",
      "Call sites: foo.bar() and foo.baz()",
    ]);

    expect(terms).toContain("react-router");
    expect(terms).toContain("foo.bar()");
    expect(terms).toContain("foo.baz()");
    expect(terms).toContain("SomeType");
    expect(new Set(terms).size).toBe(terms.length);
  });
});

describe("parseGitGrepOutput", () => {
  test("parses file:line:snippet output", () => {
    const result = parseGitGrepOutput(
      "src/a.ts:12:import x from \"react\"\nsrc/b.ts:7:foo.bar()\n",
    );

    expect(result).toEqual([
      { filePath: "src/a.ts", line: 12, snippet: 'import x from "react"' },
      { filePath: "src/b.ts", line: 7, snippet: "foo.bar()" },
    ]);
  });
});

describe("withTimeBudget", () => {
  test("returns null when time budget is exceeded", async () => {
    const slow = new Promise<string>((resolve) => setTimeout(() => resolve("ok"), 50));
    const result = await withTimeBudget(slow, 5);
    expect(result).toBeNull();
  });
});

describe("analyzePackageUsage", () => {
  test("fails open when workspaceDir does not exist", async () => {
    const result = await analyzePackageUsage({
      workspaceDir: "/path/does/not/exist",
      packageName: "react",
      breakingChangeSnippets: ["BREAKING: `foo.bar()` removed"],
      ecosystem: "npm",
      timeBudgetMs: 100,
    });

    expect(result.evidence).toEqual([]);
    expect(result.timedOut).toBe(false);
    expect(result.searchTerms).toContain("react");
  });

  test("returns timedOut=true when git grep exceeds the budget", async () => {
    const result = await analyzePackageUsage({
      workspaceDir: "/tmp/irrelevant",
      packageName: "react",
      breakingChangeSnippets: [],
      ecosystem: "npm",
      timeBudgetMs: 10,
      __runGrepForTests: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          exitCode: 0,
          stdout: "src/index.ts:1:import x from 'react'\n",
        };
      },
    });

    expect(result.timedOut).toBe(true);
    expect(result.evidence).toEqual([]);
    expect(result.searchTerms).toContain("react");
  });
});
