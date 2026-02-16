import { describe, expect, test } from "bun:test";
import { buildIssueCodeContext } from "./issue-code-context.ts";

const WORKSPACE_DIR = "/repo";

function createAdapters(params: {
  files: string[];
  grepByTerm?: Record<string, Array<{ path: string; line?: number }>>;
  throwOnGrep?: boolean;
}) {
  return {
    globFiles: async () => params.files,
    grepInFiles: async ({ term }: { term: string }) => {
      if (params.throwOnGrep) {
        throw new Error("grep failed");
      }
      return params.grepByTerm?.[term] ?? [];
    },
    readFile: async () => "",
  };
}

describe("buildIssueCodeContext", () => {
  test("strong signal yields ranked paths with reasoned pointers", async () => {
    const result = await buildIssueCodeContext({
      workspaceDir: WORKSPACE_DIR,
      question: "Where is mention context for issue replies handled?",
      adapters: createAdapters({
        files: [
          "src/execution/mention-context.ts",
          "src/handlers/mention.ts",
          "README.md",
        ],
        grepByTerm: {
          mention: [
            { path: "src/execution/mention-context.ts", line: 77 },
            { path: "src/handlers/mention.ts", line: 676 },
          ],
          context: [{ path: "src/execution/mention-context.ts", line: 70 }],
          issue: [{ path: "src/handlers/mention.ts", line: 320 }],
        },
      }),
    });

    expect(result.paths.length).toBeGreaterThan(0);
    expect(result.paths[0]?.path).toBe("src/execution/mention-context.ts");
    expect(result.paths[0]?.reason).toContain("path matches");
    expect(result.paths[0]?.reason).toContain("content matches");
    expect(result.contextBlock).toContain("## Likely Code Pointers");
  });

  test("content matches add line anchors", async () => {
    const result = await buildIssueCodeContext({
      workspaceDir: WORKSPACE_DIR,
      question: "Which file handles write mode request?",
      adapters: createAdapters({
        files: ["src/handlers/mention.ts"],
        grepByTerm: {
          write: [{ path: "src/handlers/mention.ts", line: 455 }],
          mode: [{ path: "src/handlers/mention.ts", line: 585 }],
        },
      }),
    });

    expect(result.paths).toEqual([
      {
        path: "src/handlers/mention.ts",
        line: 455,
        reason: "content matches: mode, write",
      },
    ]);
    expect(result.contextBlock).toContain("`src/handlers/mention.ts:455`");
  });

  test("weak signal yields empty paths and empty context block", async () => {
    const result = await buildIssueCodeContext({
      workspaceDir: WORKSPACE_DIR,
      question: "please help",
      adapters: createAdapters({
        files: ["src/handlers/mention.ts", "src/execution/mention-context.ts"],
      }),
    });

    expect(result).toEqual({ paths: [], contextBlock: "" });
  });

  test("duplicate candidates collapse and respect maxPaths", async () => {
    const result = await buildIssueCodeContext({
      workspaceDir: WORKSPACE_DIR,
      question: "mention handler context",
      maxPaths: 1,
      adapters: createAdapters({
        files: [
          "src/handlers/mention.ts",
          "src/handlers/mention.ts",
          "src/execution/mention-context.ts",
        ],
        grepByTerm: {
          mention: [
            { path: "src/handlers/mention.ts", line: 100 },
            { path: "src/handlers/mention.ts", line: 110 },
          ],
          context: [{ path: "src/execution/mention-context.ts", line: 70 }],
        },
      }),
    });

    expect(result.paths).toHaveLength(1);
    expect(result.paths[0]?.path).toBe("src/execution/mention-context.ts");
  });

  test("ties sort by path ascending after score", async () => {
    const result = await buildIssueCodeContext({
      workspaceDir: WORKSPACE_DIR,
      question: "auth",
      maxPaths: 2,
      adapters: createAdapters({
        files: ["src/b-auth.ts", "src/a-auth.ts"],
        grepByTerm: {
          auth: [
            { path: "src/b-auth.ts", line: 2 },
            { path: "src/a-auth.ts", line: 3 },
          ],
        },
      }),
    });

    expect(result.paths.map((entry) => entry.path)).toEqual([
      "src/a-auth.ts",
      "src/b-auth.ts",
    ]);
  });

  test("adapter errors are caught and return safe empty output", async () => {
    const result = await buildIssueCodeContext({
      workspaceDir: WORKSPACE_DIR,
      question: "where is mention handling",
      adapters: createAdapters({
        files: ["src/handlers/mention.ts"],
        throwOnGrep: true,
      }),
    });

    expect(result).toEqual({ paths: [], contextBlock: "" });
  });
});
