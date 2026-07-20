import { describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";
import {
  MAX_ADDON_RULE_LLM_CHUNK_PATCH_CHARS,
  runAddonRuleReview,
  runDefaultAddonRuleLlm,
} from "./addon-rule-review.ts";

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

  test("does not mark a 53,089-character supplied patch truncated", async () => {
    const result = await review({
      files: [{
        filename: "script.example/default.py",
        status: "modified",
        patch: "x".repeat(53_089),
      }],
    });

    expect(result.incompleteReasons).not.toContain("patch-truncated");
  });

  test("uses a deterministic summary without calling the model on synchronize", async () => {
    const runLlm = mock(async () => ({ summary: "not used", findings: [] }));
    const result = await review({ runLlmReview: false, runLlm });

    expect(runLlm).not.toHaveBeenCalled();
    expect(result.summary).toBe("Reviewed 1 changed addon on `nexus` using 1 scoped patch.");
    expect(result.incompleteReasons).not.toContain("llm-incomplete");
  });
});

describe("runDefaultAddonRuleLlm", () => {
  test("reviews large complete evidence in bounded chunks and aggregates the result", async () => {
    const chunkInputs: Array<Parameters<typeof runDefaultAddonRuleLlm>[0]> = [];
    const paths = ["one.py", "two.py", "three.py"].map((name) => `script.example/${name}`);
    const result = await runDefaultAddonRuleLlm({
      repo: "xbmc/repo-scripts",
      prNumber: 42,
      baseBranch: "matrix",
      rules,
      contexts: [{
        addonId: "script.example",
        allChangedPaths: paths,
        files: paths.map((path, index) => ({
          path,
          status: "modified",
          patch: `@@ -1 +1 @@\n-old_${index}()\n+${"x".repeat(39_980)}()`,
        })),
      }],
    }, logger, async (chunkInput) => {
      chunkInputs.push(chunkInput);
      return JSON.stringify({
        summary: `Reviewed evidence chunk ${chunkInputs.length}.`,
        findings: [],
      });
    });

    expect(chunkInputs).toHaveLength(3);
    for (const input of chunkInputs) {
      const patchChars = input.contexts
        .flatMap((context) => context.files)
        .reduce((total, file) => total + (file.patch?.length ?? 0), 0);
      expect(patchChars).toBeLessThanOrEqual(MAX_ADDON_RULE_LLM_CHUNK_PATCH_CHARS);
    }
    expect(result.summary).toContain("3 evidence chunks");
    expect(result.findings).toEqual([]);
    expect(result.rejectedSummary).toBeUndefined();
    expect(result.rejectedOutput).toBeUndefined();
  });

  test("retains successful chunk findings while marking a failed chunk incomplete", async () => {
    let call = 0;
    const result = await runDefaultAddonRuleLlm({
      repo: "xbmc/repo-scripts",
      prNumber: 42,
      baseBranch: "matrix",
      rules,
      contexts: [{
        addonId: "script.example",
        allChangedPaths: ["script.example/one.py", "script.example/two.py"],
        files: ["one.py", "two.py"].map((name, index) => ({
          path: `script.example/${name}`,
          status: "modified",
          patch: `@@ -1 +1 @@\n-old_${index}()\n+${"x".repeat(39_980)}()`,
        })),
      }],
    }, logger, async (chunkInput) => {
      call += 1;
      if (call === 2) throw new Error("model timeout");
      const file = chunkInput.contexts[0]!.files[0]!;
      return JSON.stringify({
        summary: "The first chunk adds a restricted call.",
        findings: [{
          addonId: "script.example",
          path: file.path,
          line: 1,
          rule: "executable-execution",
          level: "ERROR",
          message: "The added line executes an external program.",
        }],
      });
    });

    expect(result.findings).toEqual([expect.objectContaining({
      path: "script.example/one.py",
      line: 1,
      rule: "executable-execution",
    })]);
    expect(result.rejectedOutput).toBe(true);
  });
});
