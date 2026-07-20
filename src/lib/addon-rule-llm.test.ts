import { describe, expect, test } from "bun:test";
import type { AddonRuleAddonContext } from "./addon-rule-context.ts";
import { projectAddonRuleEvidence } from "./addon-rule-evidence.ts";
import {
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
  test("uses a native schema and only added-line evidence", () => {
    expect(ADDON_RULE_REVIEW_SCHEMA).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["summary", "findings"],
      properties: {
        summary: { type: "string", maxLength: 600 },
        findings: { type: "array", maxItems: 20 },
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
});

describe("parseAddonRuleReviewOutput", () => {
  test("accepts strict structured JSON through the text compatibility wrapper", () => {
    const result = parseAddonRuleReviewOutput(JSON.stringify({
      summary: "plugin.video.foo changes its view-mode handling on nexus.",
      findings: [{
        addonId: "plugin.video.foo",
        path: "plugin.video.foo/default.py",
        line: 1,
        rule: "skin-view-mode",
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
        rule: "skin-view-mode",
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
        rule: "skin-view-mode",
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
      rule: "rule",
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
