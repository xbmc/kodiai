import { describe, expect, test } from "bun:test";
import type { AddonRuleAddonContext } from "./addon-rule-context.ts";
import { runDeterministicAddonRuleChecks } from "./addon-rule-deterministic.ts";

function context(overrides: Partial<AddonRuleAddonContext>): AddonRuleAddonContext {
  return {
    addonId: "plugin.video.foo",
    allChangedPaths: [],
    files: [],
    hasLicenseFile: false,
    ...overrides,
  };
}

describe("runDeterministicAddonRuleChecks", () => {
  test("flags dev artifacts, forbidden binaries, missing license, and invalid translation paths", () => {
    const findings = runDeterministicAddonRuleChecks([
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
      expect.objectContaining({ level: "ERROR", source: "deterministic", message: expect.stringContaining("development-only") }),
      expect.objectContaining({ level: "ERROR", source: "deterministic", message: expect.stringContaining("Forbidden binary") }),
      expect.objectContaining({ level: "ERROR", source: "deterministic", message: expect.stringContaining("Missing license file") }),
      expect.objectContaining({ level: "ERROR", source: "deterministic", message: expect.stringContaining("translation directory") }),
    ]));
    expect(findings.map((finding) => finding.message).join("\n")).not.toContain("icon.png");
    expect(findings.map((finding) => finding.message).join("\n")).not.toContain("font.ttf");
  });

  test("flags missing English metadata and invalid language codes in addon.xml", () => {
    const findings = runDeterministicAddonRuleChecks([
      context({
        allChangedPaths: ["plugin.video.foo/addon.xml", "plugin.video.foo/LICENSE.txt"],
        hasLicenseFile: true,
        files: [
          {
            path: "plugin.video.foo/addon.xml",
            content: [
              "<addon id=\"plugin.video.foo\">",
              "  <extension point=\"xbmc.addon.metadata\">",
              "    <summary lang=\"en-us\">Bad language code</summary>",
              "    <description lang=\"fr_FR\">Description seulement</description>",
              "    <license>Unknown Homegrown License</license>",
              "  </extension>",
              "</addon>",
            ].join("\n"),
          },
        ],
      }),
    ]);

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: "ERROR", message: expect.stringContaining("summary") }),
      expect.objectContaining({ level: "ERROR", message: expect.stringContaining("description") }),
      expect.objectContaining({ level: "ERROR", message: expect.stringContaining("language code") }),
      expect.objectContaining({ level: "WARN", message: expect.stringContaining("SPDX") }),
    ]));
  });

  test("does not flag a clean addon manifest and allowed assets", () => {
    const findings = runDeterministicAddonRuleChecks([
      context({
        allChangedPaths: [
          "plugin.video.foo/addon.xml",
          "plugin.video.foo/LICENSE",
          "plugin.video.foo/resources/icon.jpg",
          "plugin.video.foo/resources/language/resource.language.en_gb/strings.po",
        ],
        hasLicenseFile: true,
        files: [
          {
            path: "plugin.video.foo/addon.xml",
            content: [
              "<addon id=\"plugin.video.foo\">",
              "  <extension point=\"xbmc.addon.metadata\">",
              "    <summary lang=\"en_GB\">Summary</summary>",
              "    <description lang=\"en_GB\">Description</description>",
              "    <license>GPL-2.0-or-later</license>",
              "  </extension>",
              "</addon>",
            ].join("\n"),
          },
        ],
      }),
    ]);

    expect(findings).toEqual([]);
  });

  test("does not require the license file to be part of the PR diff", () => {
    const findings = runDeterministicAddonRuleChecks([
      context({
        allChangedPaths: ["plugin.video.foo/resources/lib/main.py"],
        hasLicenseFile: true,
        files: [
          {
            path: "plugin.video.foo/resources/lib/main.py",
            content: "print('hello')",
          },
        ],
      }),
    ]);

    expect(findings.map((finding) => finding.message).join("\n")).not.toContain("Missing license file");
  });
});
