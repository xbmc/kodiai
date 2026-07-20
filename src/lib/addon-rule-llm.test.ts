import { describe, expect, test } from "bun:test";
import type { AddonRuleAddonContext } from "./addon-rule-context.ts";
import { projectAddonRuleEvidence } from "./addon-rule-evidence.ts";
import {
  ADDON_RULE_MODEL_RULE_IDS,
  ADDON_RULE_REVIEW_SCHEMA,
  buildAddonRuleReviewPrompt,
  parseAddonRuleReviewOutput,
  type AddonRuleLlmInput,
  validateAddonRuleReviewOutput,
} from "./addon-rule-llm.ts";

const contexts: AddonRuleAddonContext[] = [{
  addonId: "plugin.video.foo",
  allChangedPaths: ["plugin.video.foo/default.py"],
  files: [{
    path: "plugin.video.foo/default.py",
    status: "modified",
    patch: "@@ -1 +1 @@\n-old()\n+xbmc.executebuiltin('Container.SetViewMode(50)')",
  }],
}];

const lineContexts: AddonRuleAddonContext[] = [{
  addonId: "plugin.video.foo",
  allChangedPaths: [
    "plugin.video.foo/default.py",
    "plugin.video.foo/without-patch.py",
  ],
  files: [{
    path: "plugin.video.foo/default.py",
    status: "modified",
    patch: "@@ -10,3 +20,4 @@\n context\n-old()\n+new()\n+track_usage()\n context",
  }, {
    path: "plugin.video.foo/without-patch.py",
    status: "modified",
    omittedReason: "patch-unavailable",
  }],
}];

describe("buildAddonRuleReviewPrompt", () => {
  test("limits the schema and prompt to contextual model rules", () => {
    const expectedRules = [
      "filesystem-boundaries",
      "download-consent",
      "executable-execution",
      "addon-modification",
      "direct-database-access",
      "skin-view-sort-mode",
      "usage-analytics",
      "obfuscation",
    ] as const;
    const ruleSchema = (((ADDON_RULE_REVIEW_SCHEMA.properties as Record<string, unknown>)
      .findings as Record<string, unknown>).items as Record<string, unknown>)
      .properties as Record<string, Record<string, unknown>>;

    expect(ADDON_RULE_MODEL_RULE_IDS).toEqual(expectedRules);
    expect(ruleSchema.rule?.enum).toEqual(expectedRules);

    const input = {
      repo: "xbmc/repo-plugins",
      prNumber: 123,
      baseBranch: "nexus",
      rules: { kind: "wiki", url: "https://kodi.wiki/view/Add-on_rules", text: "Rules." },
      contexts: lineContexts,
    } satisfies AddonRuleLlmInput;
    const prompt = buildAddonRuleReviewPrompt(input);

    for (const rule of expectedRules) expect(prompt).toContain(rule);
    for (const deterministicCategory of [
      "target branches",
      "development artifacts",
      "binaries",
      "license naming/content",
      "translation paths",
      "addon.xml metadata/dependencies",
      "line endings",
    ]) expect(prompt).toContain(deterministicCategory);
    for (const excludedCategory of [
      "print",
      "xbmc.log",
      "Python version/syntax/type hints",
      "general compatibility/correctness/style/architecture",
      "hard-coded non-UI/log/error strings",
      "localization of Python library strings",
      "test coverage",
      "dependency-use claims requiring repository-wide evidence",
    ]) expect(prompt).toContain(excludedCategory);
  });

  test("uses a native schema and only added-line evidence", () => {
    expect(ADDON_RULE_REVIEW_SCHEMA).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["summary", "findings"],
      properties: {
        summary: {
          type: "string",
          maxLength: 600,
          pattern: "^(?!\\s)[\\s\\S]*\\S(?![\\s\\S])$",
        },
        findings: {
          type: "array",
          maxItems: 20,
          items: {
            properties: {
              rule: {
                enum: [
                  "filesystem-boundaries",
                  "download-consent",
                  "executable-execution",
                  "addon-modification",
                  "direct-database-access",
                  "skin-view-sort-mode",
                  "usage-analytics",
                  "obfuscation",
                ],
              },
              message: { pattern: "^(?!\\s)[\\s\\S]*\\S(?![\\s\\S])$" },
            },
          },
        },
      },
    });

    const input = {
      repo: "xbmc/repo-plugins",
      prNumber: 123,
      baseBranch: "nexus",
      rules: {
        kind: "wiki",
        url: "https://kodi.wiki/view/Add-on_rules",
        text: "No analytics. Do not run executables.",
      },
      contexts: lineContexts,
    } satisfies AddonRuleLlmInput;
    const prompt = buildAddonRuleReviewPrompt(input, projectAddonRuleEvidence(lineContexts));

    expect(prompt).toContain("xbmc/repo-plugins#123");
    expect(prompt).toContain("Target branch: nexus");
    expect(prompt).toContain("Review only the supplied added-line evidence");
    expect(prompt).toContain("Do not review Python or JavaScript correctness, syntax, logic, style, architecture, or maintainability");
    expect(prompt).toContain('"line":21');
    expect(prompt).toContain('"text":"track_usage()"');
    expect(prompt).not.toContain("-old()");
    expect(prompt).not.toContain("Return only JSON");
    expect(prompt).toContain("Return the result using the supplied JSON schema");
    expect(prompt).not.toContain("Full changed files are provided");
    expect(prompt).not.toContain("Prefer Kodi addon submission-rule findings");
  });

  test("derives added-line evidence for the one-argument compatibility call", () => {
    const prompt = buildAddonRuleReviewPrompt({
      repo: "xbmc/repo-plugins",
      prNumber: 123,
      baseBranch: "nexus",
      rules: {
        kind: "wiki",
        url: "https://kodi.wiki/view/Add-on_rules",
        text: "No analytics.",
      },
      contexts: lineContexts,
    });

    expect(prompt).toContain('"line":21');
    expect(prompt).toContain('"text":"track_usage()"');
    expect(prompt).not.toContain("-old()");
    expect(prompt).not.toContain("undefined");
  });
});

describe("validateAddonRuleReviewOutput", () => {
  const validValue = {
    summary: "The patch adds analytics handling.",
    findings: [{
      addonId: "plugin.video.foo",
      path: "plugin.video.foo/default.py",
      line: 21,
      rule: "usage-analytics",
      level: "WARN",
      message: "The added call appears to send usage data.",
    }],
  };

  test("accepts a finding grounded to an exact added-line coordinate", () => {
    expect(validateAddonRuleReviewOutput(validValue, lineContexts)).toEqual({
      summary: "The patch adds analytics handling.",
      findings: [{
        addonId: "plugin.video.foo",
        path: "plugin.video.foo/default.py",
        line: 21,
        rule: "usage-analytics",
        level: "WARN",
        source: "llm",
        message: "The added call appears to send usage data.",
      }],
    });
  });

  test("accepts every contextual rule and atomically rejects a generic rule", () => {
    for (const rule of ADDON_RULE_MODEL_RULE_IDS) {
      expect(validateAddonRuleReviewOutput({
        ...validValue,
        findings: [{ ...validValue.findings[0], rule }],
      }, lineContexts).findings[0]?.rule).toBe(rule);
    }

    expect(() => validateAddonRuleReviewOutput({
      ...validValue,
      findings: [
        validValue.findings[0],
        { ...validValue.findings[0], rule: "python-style" },
      ],
    }, lineContexts)).toThrow("Structured addon review output failed domain validation");
  });

  test("rejects an unknown path or a coordinate outside the added-line allowlist", () => {
    expect(() => validateAddonRuleReviewOutput({
      ...validValue,
      findings: [{ ...validValue.findings[0], path: "plugin.video.foo/unknown.py" }],
    }, lineContexts)).toThrow("Structured addon review output failed domain validation");

    for (const line of [20, 0, 21.5, "21", undefined]) {
      expect(() => validateAddonRuleReviewOutput({
        ...validValue,
        findings: [{ ...validValue.findings[0], line }],
      }, lineContexts)).toThrow("Structured addon review output failed domain validation");
    }
  });

  test("rejects malformed, unsafe, and unbounded structured values atomically", () => {
    const invalidValues = [
      null,
      { findings: [] },
      { summary: "", findings: [] },
      { summary: "x".repeat(601), findings: [] },
      { summary: "raw prompt says...", findings: [] },
      { summary: "Safe.", findings: Array.from({ length: 21 }, () => validValue.findings[0]) },
      { ...validValue, findings: [{ ...validValue.findings[0], message: "x".repeat(401) }] },
      { ...validValue, findings: [{ ...validValue.findings[0], extra: true }] },
    ];

    for (const value of invalidValues) {
      expect(() => validateAddonRuleReviewOutput(value, lineContexts)).toThrow(
        "Structured addon review output failed domain validation",
      );
    }
  });

  test("enforces raw trimmed string bounds identically to the schema", () => {
    const exactMax = {
      summary: "s".repeat(600),
      findings: [{
        ...validValue.findings[0],
        message: "m".repeat(400),
      }],
    };
    expect(validateAddonRuleReviewOutput(exactMax, lineContexts)).toMatchObject(exactMax);

    const invalidValues = [
      { ...validValue, summary: ` ${"s".repeat(600)}` },
      { ...validValue, summary: "   " },
      { ...validValue, findings: [{ ...validValue.findings[0], rule: ` ${"r".repeat(80)}` }] },
      { ...validValue, findings: [{ ...validValue.findings[0], rule: "\t" }] },
      { ...validValue, findings: [{ ...validValue.findings[0], message: `${"m".repeat(400)} ` }] },
      { ...validValue, findings: [{ ...validValue.findings[0], message: "\n" }] },
    ];
    for (const value of invalidValues) {
      expect(() => validateAddonRuleReviewOutput(value, lineContexts)).toThrow(
        "Structured addon review output failed domain validation",
      );
    }
  });

  test("rejects unknown addons, mismatched addon paths, and top-level extras", () => {
    const originalContexts: AddonRuleAddonContext[] = [...lineContexts, {
      addonId: "plugin.video.bar",
      allChangedPaths: ["plugin.video.bar/default.py"],
      files: [{
        path: "plugin.video.bar/default.py",
        status: "modified",
        patch: "@@ -1 +1 @@\n-old_bar()\n+new_bar()",
      }],
    }];
    const invalidValues = [
      {
        ...validValue,
        findings: [{ ...validValue.findings[0], addonId: "plugin.video.unknown" }],
      },
      {
        ...validValue,
        findings: [{ ...validValue.findings[0], addonId: "plugin.video.bar" }],
      },
      { ...validValue, extra: true },
    ];

    for (const value of invalidValues) {
      expect(() => validateAddonRuleReviewOutput(value, originalContexts)).toThrow(
        "Structured addon review output failed domain validation",
      );
    }
  });

  test("rejects mixed valid and invalid findings atomically", () => {
    expect(() => validateAddonRuleReviewOutput({
      ...validValue,
      findings: [
        validValue.findings[0],
        { ...validValue.findings[0], line: 20 },
      ],
    }, lineContexts)).toThrow("Structured addon review output failed domain validation");
  });
});

describe("parseAddonRuleReviewOutput", () => {
  test("accepts strict structured JSON through the text compatibility wrapper", () => {
    const result = parseAddonRuleReviewOutput(JSON.stringify({
      summary: "plugin.video.foo changes its view-mode handling on nexus.",
      findings: [{
        addonId: "plugin.video.foo",
        path: "plugin.video.foo/default.py",
        line: 1,
        rule: "skin-view-sort-mode",
        level: "ERROR",
        message: "The changed line calls Container.SetViewMode, which add-ons may not force.",
      }],
    }), contexts);

    expect(result).toEqual({
      summary: "plugin.video.foo changes its view-mode handling on nexus.",
      findings: [{
        addonId: "plugin.video.foo",
        path: "plugin.video.foo/default.py",
        line: 1,
        rule: "skin-view-sort-mode",
        level: "ERROR",
        source: "llm",
        message: "The changed line calls Container.SetViewMode, which add-ons may not force.",
      }],
    });
  });

  test("rejects the whole text response when a finding line is invalid", () => {
    const finding = {
      addonId: "plugin.video.foo",
      path: "plugin.video.foo/default.py",
      rule: "usage-analytics",
      level: "WARN",
      message: "The added call appears to send usage data.",
    };

    const valid = parseAddonRuleReviewOutput(JSON.stringify({
      summary: "The patch adds analytics handling.",
      findings: [{ ...finding, line: 21 }],
    }), lineContexts);
    expect(valid.findings[0]).toMatchObject({ line: 21 });

    for (const line of [20, 0, 21.5, "21"]) {
      const invalid = parseAddonRuleReviewOutput(JSON.stringify({
        summary: "The patch adds analytics handling.",
        findings: [{ ...finding, line }],
      }), lineContexts);
      expect(invalid).toEqual({ findings: [], rejectedOutput: true });
    }

    const unavailable = parseAddonRuleReviewOutput(JSON.stringify({
      summary: "The patch adds analytics handling.",
      findings: [{
        ...finding,
        path: "plugin.video.foo/without-patch.py",
        line: 21,
      }],
    }), lineContexts);
    expect(unavailable).toEqual({ findings: [], rejectedOutput: true });
  });

  test("rejects an overlong summary atomically", () => {
    const result = parseAddonRuleReviewOutput(JSON.stringify({
      summary: "x".repeat(601),
      findings: [{
        addonId: "plugin.video.foo",
        path: "plugin.video.foo/default.py",
        line: 1,
        rule: "skin-view-sort-mode",
        level: "WARN",
        message: "Confirm the changed view-mode call is removed.",
      }],
    }), contexts);

    expect(result).toEqual({ findings: [], rejectedOutput: true });
  });

  test("rejects ungrounded, unsafe, overlong, and oversized findings", () => {
    const base = {
      addonId: "plugin.video.foo",
      path: "plugin.video.foo/default.py",
      line: 1,
      rule: "usage-analytics",
      level: "WARN",
      message: "Safe message.",
    };

    expect(parseAddonRuleReviewOutput("not json", contexts).findings).toEqual([]);
    expect(parseAddonRuleReviewOutput(JSON.stringify({ summary: "Safe.", findings: [{ ...base, path: "plugin.video.foo/unchanged.py" }] }), contexts).findings).toEqual([]);
    expect(parseAddonRuleReviewOutput(JSON.stringify({ summary: "Safe.", findings: [{ ...base, message: "raw prompt says..." }] }), contexts).findings).toEqual([]);
    expect(parseAddonRuleReviewOutput(JSON.stringify({ summary: "Safe.", findings: [{ ...base, message: "x".repeat(401) }] }), contexts).findings).toEqual([]);
    expect(parseAddonRuleReviewOutput(JSON.stringify({ summary: "Safe.", findings: Array.from({ length: 21 }, () => base) }), contexts)).toMatchObject({
      findings: [],
      rejectedOutput: true,
    });
  });
});
