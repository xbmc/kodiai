import { describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";
import { StructuredGenerationError } from "../llm/structured-generate.ts";
import type { AddonRuleEvidenceContext } from "./addon-rule-evidence.ts";
import { MAX_ADDON_RULE_LLM_PROMPT_CHARS } from "./addon-rule-evidence.ts";
import type { AddonRuleLlmInput } from "./addon-rule-llm.ts";
import {
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
  test("splits a 53,089-character new file into complete bounded prompts", async () => {
    const { input, sourceLines } = largeSingleFileInput();
    const promptLengths: number[] = [];
    const reviewedLines: string[] = [];
    const returnedLines: number[] = [];

    const result = await runDefaultAddonRuleLlm(input, logger, async ({
      prompt,
      evidence,
      validate,
    }) => {
      promptLengths.push(prompt.length);
      reviewedLines.push(...evidence.flatMap((context) => (
        context.files.flatMap((file) => file.addedLines.map(({ text }) => text))
      )));
      const finding = findingFor(evidence);
      returnedLines.push(...finding.map(({ line }) => line));
      return validate({ summary: "Reviewed this evidence chunk.", findings: finding });
    });

    expect(input.contexts[0]!.files[0]!.patch).toHaveLength(53_089);
    expect(promptLengths.length).toBeGreaterThan(1);
    expect(promptLengths.every((length) => length <= MAX_ADDON_RULE_LLM_PROMPT_CHARS)).toBe(true);
    expect(reviewedLines).toEqual(sourceLines);
    expect(new Set(reviewedLines).size).toBe(sourceLines.length);
    expect(result.findings.map(({ line }) => line)).toEqual(returnedLines);
    expect(result.rejectedOutput).toBeUndefined();
  });

  test("all successful chunks remove model incompleteness", async () => {
    const result = await runDefaultAddonRuleLlm(largeSingleFileInput().input, logger, async ({
      validate,
      evidence,
    }) => validate({
      summary: "Reviewed this evidence chunk.",
      findings: findingFor(evidence),
    }));

    expect(result.rejectedOutput).toBeUndefined();
    expect(result.findings.every((finding) => finding.line !== undefined)).toBe(true);
  });

  test("one exhausted structured chunk retains successful findings and marks incomplete", async () => {
    const callsByChunk = new Map<number, number>();
    const result = await runDefaultAddonRuleLlm(largeSingleFileInput().input, logger, async ({
      chunkIndex,
      validate,
      evidence,
    }) => {
      callsByChunk.set(chunkIndex, (callsByChunk.get(chunkIndex) ?? 0) + 1);
      if (chunkIndex === 1) {
        throw new StructuredGenerationError("timeout", "deadline", true);
      }
      return validate({ summary: "Reviewed.", findings: findingFor(evidence) });
    });

    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.rejectedOutput).toBe(true);
    expect([...callsByChunk.values()].every((calls) => calls === 1)).toBe(true);
  });

  test("marks a final domain-validation rejection incomplete", async () => {
    const result = await runDefaultAddonRuleLlm(largeSingleFileInput().input, logger, async ({
      chunkIndex,
      validate,
      evidence,
    }) => {
      if (chunkIndex === 1) {
        return validate({
          summary: "Reviewed.",
          findings: [{ ...findingFor(evidence)[0], line: 999_999 }],
        });
      }
      return validate({ summary: "Reviewed.", findings: findingFor(evidence) });
    });

    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.rejectedOutput).toBe(true);
  });

  test("caps aggregated findings and marks the review incomplete", async () => {
    const result = await runDefaultAddonRuleLlm(largeSingleFileInput().input, logger, async ({
      validate,
      evidence,
    }) => {
      const finding = findingFor(evidence)[0]!;
      return validate({
        summary: "Reviewed.",
        findings: Array.from({ length: 20 }, (_, index) => ({
          ...finding,
          rule: `rule-${index}`,
        })),
      });
    });

    expect(result.findings).toHaveLength(20);
    expect(result.rejectedOutput).toBe(true);
  });

  test("marks omitted oversized lines and files incomplete", async () => {
    const baseInput = largeSingleFileInput().input;
    const oversizedLine = `@@ -0,0 +1 @@\n+${"x".repeat(MAX_ADDON_RULE_LLM_PROMPT_CHARS)}`;
    const oversizedPath = `script.example/${"x".repeat(MAX_ADDON_RULE_LLM_PROMPT_CHARS)}.py`;
    const inputs = [
      {
        ...baseInput,
        contexts: [{
          addonId: "script.example",
          allChangedPaths: ["script.example/generated.py"],
          files: [{ path: "script.example/generated.py", status: "added", patch: oversizedLine }],
        }],
      },
      {
        ...baseInput,
        contexts: [{
          addonId: "script.example",
          allChangedPaths: [oversizedPath],
          files: [{ path: oversizedPath, status: "added", patch: "@@ -0,0 +1 @@\n+line" }],
        }],
      },
    ];

    for (const input of inputs) {
      const result = await runDefaultAddonRuleLlm(input, logger, async ({ validate }) => (
        validate({ summary: "Reviewed available evidence.", findings: [] })
      ));
      expect(result.rejectedOutput).toBe(true);
    }
  });

  test("logs bounded chunk categories without model or source content", async () => {
    const records: unknown[] = [];
    const capturingLogger = {
      ...logger,
      info: (record: unknown) => records.push(record),
      warn: (record: unknown) => records.push(record),
    } as unknown as Logger;
    const secret = "source-and-provider-secret";

    await runDefaultAddonRuleLlm(largeSingleFileInput().input, capturingLogger, async ({
      chunkIndex,
      validate,
    }) => {
      if (chunkIndex === 1) {
        throw new StructuredGenerationError("provider", secret, true, {
          cause: { output: secret },
        });
      }
      return validate({ summary: "Reviewed.", findings: [] });
    });

    expect(JSON.stringify(records)).not.toContain(secret);
    expect(records).toContainEqual(expect.objectContaining({
      errorKind: "provider",
      chunkIndex: 2,
      chunkCount: expect.any(Number),
      durationCategory: "under-1s",
    }));
    expect(records).toContainEqual(expect.objectContaining({
      chunkCount: expect.any(Number),
      promptChars: expect.any(Array),
      evidenceLineCount: 800,
      omittedOversizedLines: 0,
      omittedFiles: 0,
    }));
  });
});

function largeSingleFileInput(): { input: AddonRuleLlmInput; sourceLines: string[] } {
  const lineCount = 800;
  const header = `@@ -0,0 +1,${lineCount} @@\n`;
  const sourceLines = Array.from({ length: lineCount }, (_, index) => `numbered_${index + 1}`);
  const unpaddedPatch = `${header}${sourceLines.map((line) => `+${line}\n`).join("")}`;
  const padding = 53_089 - unpaddedPatch.length;
  for (const [index, line] of sourceLines.entries()) {
    const linePadding = Math.floor(padding / lineCount) + (index < padding % lineCount ? 1 : 0);
    sourceLines[index] = `${line}${"x".repeat(linePadding)}`;
  }
  const patch = `${header}${sourceLines.map((line) => `+${line}\n`).join("")}`;
  const path = "script.example/generated.py";
  return {
    input: {
      repo: "xbmc/repo-scripts",
      prNumber: 42,
      baseBranch: "matrix",
      rules,
      contexts: [{
        addonId: "script.example",
        allChangedPaths: [path],
        files: [{ path, status: "added", additions: lineCount, deletions: 0, patch }],
      }],
    },
    sourceLines,
  };
}

function findingFor(evidence: readonly AddonRuleEvidenceContext[]) {
  return evidence.flatMap((context) => context.files.flatMap((file) => {
    const firstLine = file.addedLines[0];
    return firstLine == null ? [] : [{
      addonId: context.addonId,
      path: file.path,
      line: firstLine.line,
      rule: "executable-execution",
      level: "WARN" as const,
      message: "A reviewer must confirm this added line follows the execution rule.",
    }];
  }));
}
