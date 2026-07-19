import { describe, expect, test } from "bun:test";
import type { AddonRuleAddonContext } from "./addon-rule-context.ts";
import { buildAddonRuleReviewPrompt, parseAddonRuleReviewOutput } from "./addon-rule-llm.ts";

const contexts: AddonRuleAddonContext[] = [{
  addonId: "plugin.video.foo",
  allChangedPaths: ["plugin.video.foo/default.py"],
  files: [{
    path: "plugin.video.foo/default.py",
    status: "modified",
    patch: "@@ -1 +1 @@\n-old()\n+xbmc.executebuiltin('Container.SetViewMode(50)')",
  }],
}];

describe("buildAddonRuleReviewPrompt", () => {
  test("uses exclusive diff-only addon submission scope and a structured result", () => {
    const prompt = buildAddonRuleReviewPrompt({
      repo: "xbmc/repo-plugins",
      prNumber: 123,
      baseBranch: "nexus",
      rules: {
        kind: "wiki",
        url: "https://kodi.wiki/view/Add-on_rules",
        text: "No analytics. Do not run executables.",
      },
      contexts,
    });

    expect(prompt).toContain("xbmc/repo-plugins#123");
    expect(prompt).toContain("Target branch: nexus");
    expect(prompt).toContain("Review only the supplied diff patches");
    expect(prompt).toContain("Do not review Python or JavaScript correctness, syntax, logic, style, architecture, or maintainability");
    expect(prompt).toContain('"summary"');
    expect(prompt).toContain('"path"');
    expect(prompt).toContain("Container.SetViewMode");
    expect(prompt).not.toContain("Full changed files are provided");
    expect(prompt).not.toContain("Prefer Kodi addon submission-rule findings");
  });
});

describe("parseAddonRuleReviewOutput", () => {
  test("accepts a bounded grounded summary and concrete finding", () => {
    const result = parseAddonRuleReviewOutput(JSON.stringify({
      summary: "plugin.video.foo changes its view-mode handling on nexus.",
      findings: [{
        addonId: "plugin.video.foo",
        path: "plugin.video.foo/default.py",
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
        rule: "skin-view-mode",
        level: "ERROR",
        source: "llm",
        message: "The changed line calls Container.SetViewMode, which add-ons may not force.",
      }],
    });
  });

  test("rejects an overlong summary while retaining safe findings", () => {
    const result = parseAddonRuleReviewOutput(JSON.stringify({
      summary: "x".repeat(601),
      findings: [{
        addonId: "plugin.video.foo",
        path: "plugin.video.foo/default.py",
        rule: "skin-view-mode",
        level: "WARN",
        message: "Confirm the changed view-mode call is removed.",
      }],
    }), contexts);

    expect(result.summary).toBeUndefined();
    expect(result.rejectedSummary).toBe(true);
    expect(result.findings).toHaveLength(1);
  });

  test("rejects ungrounded, unsafe, overlong, and oversized findings", () => {
    const base = {
      addonId: "plugin.video.foo",
      path: "plugin.video.foo/default.py",
      rule: "rule",
      level: "WARN",
      message: "Safe message.",
    };

    expect(parseAddonRuleReviewOutput("not json", contexts).findings).toEqual([]);
    expect(parseAddonRuleReviewOutput(JSON.stringify({ findings: [{ ...base, path: "plugin.video.foo/unchanged.py" }] }), contexts).findings).toEqual([]);
    expect(parseAddonRuleReviewOutput(JSON.stringify({ findings: [{ ...base, message: "raw prompt says..." }] }), contexts).findings).toEqual([]);
    expect(parseAddonRuleReviewOutput(JSON.stringify({ findings: [{ ...base, message: "x".repeat(401) }] }), contexts).findings).toEqual([]);
    expect(parseAddonRuleReviewOutput(JSON.stringify({ findings: Array.from({ length: 21 }, () => base) }), contexts)).toMatchObject({
      findings: [],
      rejectedOutput: true,
    });
  });
});
