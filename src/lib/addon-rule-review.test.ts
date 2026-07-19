import { describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";
import { runAddonRuleReview } from "./addon-rule-review.ts";

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  child: () => logger,
} as unknown as Logger;

const rules = {
  kind: "wiki" as const,
  url: "https://kodi.wiki/view/Add-on_rules",
  text: "Kodi rules",
};

const files = [{
  filename: "script.example/default.py",
  status: "modified",
  additions: 1,
  deletions: 1,
  patch: "@@ -1 +1 @@\n-old()\n+new()",
}];

function review(overrides: Partial<Parameters<typeof runAddonRuleReview>[0]> = {}) {
  return runAddonRuleReview({
    repo: "xbmc/repo-scripts",
    prNumber: 42,
    baseBranch: "nexus",
    validBranches: ["matrix", "nexus", "omega", "piers"],
    files,
    logger,
    loadRules: async () => rules,
    runLlm: async () => ({
      summary: "script.example changes one Python patch on nexus.",
      findings: [],
    }),
    ...overrides,
  });
}

describe("runAddonRuleReview", () => {
  test("returns the bounded model summary for a complete review", async () => {
    const result = await review();

    expect(result.summary).toBe("script.example changes one Python patch on nexus.");
    expect(result.findings).toEqual([]);
    expect(result.incompleteReasons).toEqual([]);
  });

  test("uses a deterministic summary when the model summary is rejected", async () => {
    const result = await review({
      runLlm: async () => ({ findings: [], rejectedSummary: true }),
    });

    expect(result.summary).toBe("Reviewed 1 changed addon on `nexus` using 1 scoped patch.");
    expect(result.incompleteReasons).toContain("llm-incomplete");
  });

  test("keeps deterministic results when the model fails", async () => {
    const result = await review({
      baseBranch: "master",
      runLlm: async () => {
        throw new Error("model timeout");
      },
    });

    expect(result.findings).toContainEqual(expect.objectContaining({ rule: "target-branch" }));
    expect(result.incompleteReasons).toContain("llm-incomplete");
  });

  test("does not call the model without a scoped patch and reports missing evidence", async () => {
    const runLlm = mock(async () => ({ summary: "not used", findings: [] }));
    const result = await review({
      files: [{ filename: "script.example/default.py", status: "modified" }],
      runLlm,
    });

    expect(runLlm).not.toHaveBeenCalled();
    expect(result.incompleteReasons).toContain("patch-unavailable");
    expect(result.summary).toBe("Reviewed 1 changed addon on `nexus`; no scoped patches were available.");
  });

  test("records fallback rules as bounded incompleteness", async () => {
    const result = await review({
      loadRules: async () => ({ ...rules, kind: "fallback" }),
    });

    expect(result.incompleteReasons).toContain("rules-fallback");
  });

  test("uses a deterministic summary without calling the model on synchronize", async () => {
    const runLlm = mock(async () => ({ summary: "not used", findings: [] }));
    const result = await review({ runLlmReview: false, runLlm });

    expect(runLlm).not.toHaveBeenCalled();
    expect(result.summary).toBe("Reviewed 1 changed addon on `nexus` using 1 scoped patch.");
    expect(result.incompleteReasons).not.toContain("llm-incomplete");
  });
});
