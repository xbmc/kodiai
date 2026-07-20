import { describe, expect, test } from "bun:test";
import type { AddonRuleAddonContext } from "./addon-rule-context.ts";
import {
  collectAddedRightSideEvidence,
  packAddonRuleEvidence,
  projectAddonRuleEvidence,
  type AddonRuleEvidenceContext,
} from "./addon-rule-evidence.ts";

function allLines(contexts: readonly AddonRuleEvidenceContext[]) {
  return contexts.flatMap((context) => context.files.flatMap((file) => file.addedLines));
}

function renderPrompt(contexts: readonly AddonRuleEvidenceContext[]): string {
  const evidence = contexts.flatMap((context) => context.files.map((file) => [
    context.addonId,
    context.allChangedPaths.join(","),
    file.path,
    file.status ?? "",
    file.additions ?? "",
    file.deletions ?? "",
    file.addedLines.map((line) => `${line.line}:${line.text}`).join("\n"),
  ].join("|"))).join("\n");
  return `${"p".repeat(100)}${evidence}`;
}

describe("collectAddedRightSideEvidence", () => {
  test("extracts exact right-side added lines across hunks", () => {
    const patch = [
      "diff --git a/script.example/default.py b/script.example/default.py",
      "--- a/script.example/default.py",
      "+++ b/script.example/default.py",
      "@@ -10,3 +20,4 @@",
      " context",
      "-old()",
      "+new()",
      "+track_usage()",
      " context",
      "@@ -40 +50 @@",
      "-gone()",
      "+replacement()",
      "\\ No newline at end of file",
    ].join("\n");

    expect(collectAddedRightSideEvidence(patch)).toEqual([
      { line: 21, text: "new()" },
      { line: 22, text: "track_usage()" },
      { line: 50, text: "replacement()" },
    ]);
  });
});

describe("projectAddonRuleEvidence", () => {
  test("keeps only patched files and preserves deletion-only file metadata", () => {
    const contexts: AddonRuleAddonContext[] = [{
      addonId: "script.example",
      allChangedPaths: [
        "script.example/deleted.py",
        "script.example/missing.py",
      ],
      files: [{
        path: "script.example/deleted.py",
        status: "modified",
        additions: 0,
        deletions: 1,
        patch: "@@ -1 +1,0 @@\n-old()",
      }, {
        path: "script.example/missing.py",
        status: "modified",
        additions: 1,
        deletions: 0,
        omittedReason: "patch-unavailable",
      }],
    }];

    expect(projectAddonRuleEvidence(contexts)).toEqual([{
      addonId: "script.example",
      allChangedPaths: contexts[0]!.allChangedPaths,
      files: [{
        path: "script.example/deleted.py",
        status: "modified",
        additions: 0,
        deletions: 1,
        addedLines: [],
      }],
    }]);
  });
});

describe("packAddonRuleEvidence", () => {
  test("splits one large file while bounding every complete rendered prompt", () => {
    const input: AddonRuleAddonContext[] = [{
      addonId: "a",
      allChangedPaths: ["a/f.py"],
      files: [{
        path: "a/f.py",
        status: "modified",
        additions: 100,
        deletions: 0,
        patch: [
          "@@ -0,0 +1,100 @@",
          ...Array.from({ length: 100 }, (_, index) => `+line-${index + 1}`),
        ].join("\n"),
      }],
    }];
    const projected = projectAddonRuleEvidence(input);

    const packed = packAddonRuleEvidence(projected, renderPrompt, 180);

    expect(packed.chunks.length).toBeGreaterThan(1);
    expect(packed.chunks.every((chunk) => renderPrompt(chunk).length <= 180)).toBe(true);
    expect(packed.chunks.flatMap(allLines)).toEqual(allLines(projected));
    expect(packed.omittedOversizedLines).toBe(0);
    for (const chunk of packed.chunks) {
      expect(chunk).toHaveLength(1);
      expect(chunk[0]?.allChangedPaths).toEqual(["a/f.py"]);
      expect(chunk[0]?.files).toHaveLength(1);
      expect(chunk[0]?.files[0]).toMatchObject({
        path: "a/f.py",
        status: "modified",
        additions: 100,
        deletions: 0,
      });
    }
  });

  test("omits a source line that cannot fit without truncating its text", () => {
    const oversizedText = "x".repeat(100);
    const projected: AddonRuleEvidenceContext[] = [{
      addonId: "a",
      allChangedPaths: ["a/f.py"],
      files: [{
        path: "a/f.py",
        status: "modified",
        additions: 2,
        deletions: 0,
        addedLines: [
          { line: 1, text: oversizedText },
          { line: 2, text: "fits" },
        ],
      }],
    }];

    const packed = packAddonRuleEvidence(projected, renderPrompt, 160);

    expect(packed.omittedOversizedLines).toBe(1);
    expect(packed.chunks.every((chunk) => renderPrompt(chunk).length <= 160)).toBe(true);
    expect(renderPrompt(packed.chunks.flat()).includes(oversizedText)).toBe(false);
    expect(packed.chunks.flatMap(allLines)).toEqual([{ line: 2, text: "fits" }]);
  });

  test("retains deletion-only files as metadata-only packed evidence", () => {
    const projected: AddonRuleEvidenceContext[] = [{
      addonId: "a",
      allChangedPaths: ["a/deleted.py"],
      files: [{
        path: "a/deleted.py",
        status: "modified",
        additions: 0,
        deletions: 3,
        addedLines: [],
      }],
    }];

    expect(packAddonRuleEvidence(projected, renderPrompt, 180)).toEqual({
      chunks: [projected],
      omittedOversizedLines: 0,
    });
  });
});
