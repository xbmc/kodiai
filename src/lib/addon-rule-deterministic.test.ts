import { describe, expect, test } from "bun:test";
import type { AddonRuleAddonContext } from "./addon-rule-context.ts";
import { runDeterministicAddonRuleChecks } from "./addon-rule-deterministic.ts";

const validBranches = ["matrix", "nexus", "omega", "piers"];

function context(overrides: Partial<AddonRuleAddonContext> = {}): AddonRuleAddonContext {
  return {
    addonId: "plugin.video.foo",
    allChangedPaths: [],
    files: [],
    ...overrides,
  };
}

function run(
  contexts: AddonRuleAddonContext[],
  baseBranch = "nexus",
) {
  return runDeterministicAddonRuleChecks({ baseBranch, validBranches, contexts });
}

describe("runDeterministicAddonRuleChecks", () => {
  test.each(["master", "main", "leia", "develop"])(
    "flags invalid target branch %s",
    (baseBranch) => {
      const findings = run([context()], baseBranch);

      expect(findings).toContainEqual(expect.objectContaining({
        addonId: "plugin.video.foo",
        level: "ERROR",
        source: "deterministic",
        rule: "target-branch",
        message: expect.stringContaining(`\"${baseBranch}\"`),
      }));
    },
  );

  test.each(validBranches)("accepts supported target branch %s", (baseBranch) => {
    expect(run([context()], baseBranch)).not.toContainEqual(expect.objectContaining({
      rule: "target-branch",
    }));
  });

  test("flags changed development artifacts, forbidden binaries, and translation paths", () => {
    const findings = run([
      context({
        allChangedPaths: [
          "plugin.video.foo/.github/workflows/ci.yml",
          "plugin.video.foo/tests/test_main.py",
          "plugin.video.foo/resources/blob.dll",
          "plugin.video.foo/resources/icon.png",
          "plugin.video.foo/resources/font.ttf",
          "plugin.video.foo/resources/language/resource.language.en_US/strings.po",
        ],
      }),
    ]);

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "development-artifact", path: expect.stringContaining(".github") }),
      expect.objectContaining({ rule: "forbidden-binary", path: expect.stringContaining("blob.dll") }),
      expect.objectContaining({ rule: "translation-path", path: expect.stringContaining("en_US") }),
    ]));
    expect(findings.map((finding) => finding.message).join("\n")).not.toContain("icon.png");
    expect(findings.map((finding) => finding.message).join("\n")).not.toContain("font.ttf");
  });

  test("requires a changed license for a newly added addon", () => {
    const findings = run([
      context({
        allChangedPaths: ["plugin.video.foo/addon.xml"],
        files: [{
          path: "plugin.video.foo/addon.xml",
          status: "added",
          patch: "+<addon id=\"plugin.video.foo\"></addon>",
        }],
      }),
    ]);

    expect(findings).toContainEqual(expect.objectContaining({
      rule: "license-file",
      level: "ERROR",
    }));
  });

  test("does not assess an unchanged license for an addon update", () => {
    const findings = run([
      context({
        allChangedPaths: ["plugin.video.foo/resources/lib/main.py"],
        files: [{
          path: "plugin.video.foo/resources/lib/main.py",
          status: "modified",
          patch: "@@ -1 +1 @@\n-old()\n+new()",
        }],
      }),
    ]);

    expect(findings).not.toContainEqual(expect.objectContaining({ rule: "license-file" }));
  });

  test("flags a changed license file that is not named LICENSE.txt", () => {
    const findings = run([
      context({
        allChangedPaths: ["plugin.video.foo/LICENSE"],
        files: [{ path: "plugin.video.foo/LICENSE", status: "added", omittedReason: "out-of-scope" }],
      }),
    ]);

    expect(findings).toContainEqual(expect.objectContaining({
      rule: "license-file-name",
      level: "ERROR",
      path: "plugin.video.foo/LICENSE",
      message: expect.stringContaining("LICENSE.txt"),
    }));
  });

  test("reports the first added CRLF line with its new-file coordinate", () => {
    const path = "plugin.video.foo/resources/lib/main.py";
    const findings = run([
      context({
        allChangedPaths: [path],
        files: [{
          path,
          status: "modified",
          patch: "@@ -10,2 +20,3 @@\n context\n-old()\n+new()\r\n+next_line()\r\n context",
        }],
      }),
    ]);

    expect(findings).toContainEqual(expect.objectContaining({
      rule: "unix-line-endings",
      level: "ERROR",
      path,
      line: 21,
    }));
  });

  test("checks a complete newly added addon manifest from added patch lines", () => {
    const patch = [
      "+<addon id=\"plugin.video.foo\">",
      "+  <extension point=\"xbmc.addon.metadata\">",
      "+    <summary lang=\"en-us\">Bad language code</summary>",
      "+    <description lang=\"fr_FR\">Description seulement</description>",
      "+    <license>Unknown Homegrown License</license>",
      "+  </extension>",
      "+</addon>",
    ].join("\n");
    const findings = run([
      context({
        allChangedPaths: ["plugin.video.foo/addon.xml", "plugin.video.foo/LICENSE"],
        files: [{ path: "plugin.video.foo/addon.xml", status: "added", patch }],
      }),
    ]);

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "manifest-english-summary", level: "ERROR" }),
      expect.objectContaining({ rule: "manifest-english-description", level: "ERROR" }),
      expect.objectContaining({ rule: "manifest-language-code", level: "ERROR" }),
      expect.objectContaining({ rule: "manifest-license-spdx", level: "WARN" }),
    ]));
  });

  test("checks only added manifest lines for an existing addon", () => {
    const findings = run([
      context({
        allChangedPaths: ["plugin.video.foo/addon.xml"],
        files: [{
          path: "plugin.video.foo/addon.xml",
          status: "modified",
          patch: "@@ -2 +2 @@\n-<summary lang=\"en_GB\">Old</summary>\n+<summary lang=\"en-us\">New</summary>",
        }],
      }),
    ]);

    expect(findings).toContainEqual(expect.objectContaining({ rule: "manifest-language-code" }));
    expect(findings).not.toContainEqual(expect.objectContaining({ rule: "manifest-english-description" }));
    expect(findings).not.toContainEqual(expect.objectContaining({ rule: "license-file" }));
  });
});
