import { describe, expect, test } from "bun:test";
import type { AddonCheckClassificationResult } from "./addon-check-classification.ts";
import { buildAddonCheckMarker, formatAddonCheckComment } from "./addon-check-formatter.ts";

const marker = "<!-- kodiai:addon-check:xbmc/repo-scripts:2862 -->";

function classification(mode: AddonCheckClassificationResult["mode"]): AddonCheckClassificationResult {
  return {
    gate: "addon-check-classification",
    classification: mode.includes("timeout") ? "actionable-diagnostic" : "expected-bounded-outcome",
    mode,
    reasonCodes: mode === "all-timeout" ? ["all-timeout"] : ["completed-clean"],
    actionableDiagnostic: mode.includes("timeout"),
    expectedBoundedOutcome: true,
    counts: {
      addonCount: 1,
      completedCount: mode === "all-timeout" ? 0 : 1,
      timedOutCount: mode === "all-timeout" ? 1 : 0,
      toolNotFoundCount: 0,
      findingCount: 0,
      errorCount: 0,
      warningCount: 0,
      timeBudgetMs: 240_000,
    },
    redaction: {
      rawCheckerOutputOmitted: true,
      workspacePathsOmitted: true,
      githubPayloadOmitted: true,
      boundedReasonCodes: true,
      unsafeInputOmitted: false,
      rawCanaryDetected: false,
      addonIdentifiersOmitted: true,
    },
  };
}

describe("buildAddonCheckMarker", () => {
  test("produces the stable idempotent marker", () => {
    expect(buildAddonCheckMarker("xbmc", "repo-scripts", 2862)).toBe(marker);
  });
});

describe("formatAddonCheckComment", () => {
  test("renders the exact concise clean review", () => {
    const comment = formatAddonCheckComment([], marker, classification("completed-clean"), {
      rulesSource: { kind: "wiki", url: "https://kodi.wiki/view/Add-on_rules" },
      summary: "`script.audiooffsetmanager` updates from 1.5.0 to 2.1.0 on the valid `nexus` target branch.",
      findings: [],
      incompleteReasons: [],
    });

    expect(comment).toBe([
      marker,
      "## Kodiai Add-on Review",
      "",
      "### Summary",
      "",
      "`script.audiooffsetmanager` updates from 1.5.0 to 2.1.0 on the valid `nexus` target branch.",
      "",
      "### Findings",
      "",
      "No addon-rule violations were found in the reviewed diff.",
      "",
      "### Verdict",
      "",
      "No addon-rule violations found. Final approval remains with a human reviewer.",
    ].join("\n"));
  });

  test("renders concrete finding bullets and an advisory count verdict", () => {
    const comment = formatAddonCheckComment([
      {
        addonId: "plugin.video.example",
        level: "ERROR",
        message: "Runs a downloaded executable.",
      },
    ], marker, classification("completed-with-findings"), {
      rulesSource: { kind: "wiki", url: "https://kodi.wiki/view/Add-on_rules" },
      summary: "`plugin.video.example` changes download handling on `nexus`.",
      findings: [{
        addonId: "plugin.video.example",
        path: "plugin.video.example/resources/lib/client.py",
        rule: "download-consent",
        level: "WARN",
        source: "llm",
        message: "The changed download path has no visible user-consent prompt; confirm consent before download.",
      }],
      incompleteReasons: [],
    });

    expect(comment).toContain("- **ERROR** `plugin.video.example`: Runs a downloaded executable.");
    expect(comment).toContain("- **WARN** `plugin.video.example/resources/lib/client.py`: The changed download path has no visible user-consent prompt; confirm consent before download.");
    expect(comment).toContain("Needs human review: 1 error and 1 warning found. Final approval remains with a human reviewer.");
    expect(comment).not.toContain("| Addon | Level");
    expect(comment).not.toContain("deterministic");
    expect(comment).not.toContain("llm");
  });

  test("reduces checker timeout diagnostics to one useful caveat", () => {
    const comment = formatAddonCheckComment([], marker, classification("all-timeout"), {
      rulesSource: { kind: "wiki", url: "https://kodi.wiki/view/Add-on_rules" },
      summary: "Reviewed `script.example` on `nexus` using its changed Python patch.",
      findings: [],
      incompleteReasons: [],
    });

    expect(comment).toContain("⚠️ Review incomplete: kodi-addon-checker timed out before checking every changed addon.");
    expect(comment).toContain("No addon-rule violations found, but the review is incomplete. Final approval remains with a human reviewer.");
    expect(comment).not.toContain("Mode:");
    expect(comment).not.toContain("Reason codes:");
    expect(comment).not.toContain("240000ms");
    expect(comment).not.toContain("Raw checker output");
  });

  test("describes an unavailable checker without calling it a timeout", () => {
    const comment = formatAddonCheckComment([], marker, classification("tool-unavailable"), {
      rulesSource: { kind: "wiki", url: "https://kodi.wiki/view/Add-on_rules" },
      summary: "Reviewed `script.example` on `nexus`.",
      findings: [],
      incompleteReasons: [],
    });

    expect(comment).toContain("⚠️ Review incomplete: kodi-addon-checker was unavailable.");
    expect(comment).not.toContain("timed out");
  });

  test("renders bounded rule-review incompleteness without internal codes", () => {
    const comment = formatAddonCheckComment([], marker, classification("completed-clean"), {
      rulesSource: { kind: "fallback", url: "https://kodi.wiki/view/Add-on_rules" },
      summary: "Reviewed one changed addon on `nexus`.",
      findings: [],
      incompleteReasons: ["rules-fallback", "patch-truncated"],
    });

    expect(comment).toContain("⚠️ Review incomplete: the live rules were unavailable and at least one patch was truncated.");
    expect(comment).not.toContain("rules-fallback");
    expect(comment).not.toContain("patch-truncated");
  });

  test("excludes INFO findings and escapes multiline bullet content", () => {
    const comment = formatAddonCheckComment([
      { addonId: "script.`odd`", level: "INFO", message: "not public" },
      { addonId: "script.`odd`", level: "WARN", message: "first line\nsecond line" },
    ], marker, classification("completed-with-findings"), {
      rulesSource: { kind: "wiki", url: "https://kodi.wiki/view/Add-on_rules" },
      summary: "Reviewed script.odd.",
      findings: [],
      incompleteReasons: [],
    });

    expect(comment).not.toContain("not public");
    expect(comment).toContain("`script.\\`odd\\``: first line second line");
  });
});
