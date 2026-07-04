import { describe, expect, test } from "bun:test";
import { buildAddonRuleReviewPrompt, parseAddonRuleReviewOutput } from "./addon-rule-llm.ts";

describe("buildAddonRuleReviewPrompt", () => {
  test("includes addon rules, changed file content, and strict output contract", () => {
    const prompt = buildAddonRuleReviewPrompt({
      repo: "xbmc/repo-plugins",
      prNumber: 123,
      rules: {
        kind: "wiki",
        url: "https://kodi.wiki/view/Add-on_rules",
        text: "No analytics. Do not run executables.",
      },
      contexts: [
        {
          addonId: "plugin.video.foo",
          allChangedPaths: ["plugin.video.foo/default.py"],
          hasLicenseFile: true,
          files: [{ path: "plugin.video.foo/default.py", content: "xbmc.executebuiltin('Container.SetViewMode(50)')" }],
        },
      ],
    });

    expect(prompt).toContain("xbmc/repo-plugins#123");
    expect(prompt).toContain("No analytics. Do not run executables.");
    expect(prompt).toContain("plugin.video.foo/default.py");
    expect(prompt).toContain("Container.SetViewMode");
    expect(prompt).toContain('"findings"');
    expect(prompt).toContain("ERROR");
    expect(prompt).toContain("WARN");
    expect(prompt).toContain("Do not include a merge verdict");
  });
});

describe("parseAddonRuleReviewOutput", () => {
  test("accepts valid findings and forces llm source", () => {
    const findings = parseAddonRuleReviewOutput(JSON.stringify({
      findings: [
        {
          addonId: "plugin.video.foo",
          level: "ERROR",
          source: "deterministic",
          message: "Uses Container.SetViewMode.",
        },
      ],
    }));

    expect(findings).toEqual([
      {
        addonId: "plugin.video.foo",
        level: "ERROR",
        source: "llm",
        message: "Uses Container.SetViewMode.",
      },
    ]);
  });

  test("rejects malformed and unsafe findings", () => {
    expect(parseAddonRuleReviewOutput("not json")).toEqual([]);
    expect(parseAddonRuleReviewOutput(JSON.stringify({ findings: [{ addonId: "a", level: "INFO", message: "bad" }] }))).toEqual([]);
    expect(parseAddonRuleReviewOutput(JSON.stringify({ findings: [{ addonId: "", level: "WARN", message: "bad" }] }))).toEqual([]);
    expect(parseAddonRuleReviewOutput(JSON.stringify({ findings: [{ addonId: "a", level: "WARN", message: "See https://github.com/xbmc/repo-plugins/pull/1" }] }))).toEqual([]);
    expect(parseAddonRuleReviewOutput(JSON.stringify({ findings: [{ addonId: "a", level: "WARN", message: "raw prompt says..." }] }))).toEqual([]);
  });
});
