import { describe, test, expect } from "bun:test";
import {
  buildAddonCheckMarker,
  formatAddonCheckComment,
} from "./addon-check-formatter.ts";
import type { AddonFinding } from "../handlers/addon-check.ts";
import { classifyAddonCheckOutcome } from "./addon-check-classification.ts";

describe("buildAddonCheckMarker", () => {
  test("produces the expected HTML marker format", () => {
    const marker = buildAddonCheckMarker("xbmc", "repo-plugins", 42);
    expect(marker).toBe(
      "<!-- kodiai:addon-check:xbmc/repo-plugins:42 -->",
    );
  });

  test("embeds owner, repo, and prNumber correctly", () => {
    const marker = buildAddonCheckMarker("my-org", "my-repo", 100);
    expect(marker).toContain("my-org/my-repo:100");
  });
});

describe("formatAddonCheckComment", () => {
  const marker = buildAddonCheckMarker("xbmc", "repo-plugins", 1);

  test("marker appears on the first line", () => {
    const findings: AddonFinding[] = [];
    const comment = formatAddonCheckComment(findings, marker);
    const firstLine = comment.split("\n")[0];
    expect(firstLine).toBe(marker);
  });

  test("clean pass when findings are empty", () => {
    const comment = formatAddonCheckComment([], marker);
    expect(comment).toContain("✅ No issues found by kodi-addon-checker.");
    expect(comment).not.toContain("| Addon |");
  });

  test("clean pass when all findings are INFO", () => {
    const findings: AddonFinding[] = [
      { level: "INFO", addonId: "plugin.video.foo", message: "some info" },
      { level: "INFO", addonId: "plugin.video.foo", message: "another info" },
    ];
    const comment = formatAddonCheckComment(findings, marker);
    expect(comment).toContain("✅ No issues found by kodi-addon-checker.");
    expect(comment).not.toContain("| Addon |");
  });

  test("renders table with ERROR and WARN, excludes INFO", () => {
    const findings: AddonFinding[] = [
      { level: "ERROR", addonId: "plugin.video.foo", message: "missing changelog" },
      { level: "WARN", addonId: "plugin.video.foo", message: "deprecated api" },
      { level: "INFO", addonId: "plugin.video.foo", message: "info line" },
    ];
    const comment = formatAddonCheckComment(findings, marker);
    expect(comment).toContain("| Addon | Level | Message |");
    expect(comment).toContain("| plugin.video.foo | ERROR | missing changelog |");
    expect(comment).toContain("| plugin.video.foo | WARN | deprecated api |");
    expect(comment).not.toContain("info line");
  });

  test("summary line counts only ERROR and WARN", () => {
    const findings: AddonFinding[] = [
      { level: "ERROR", addonId: "plugin.video.foo", message: "err1" },
      { level: "ERROR", addonId: "plugin.video.bar", message: "err2" },
      { level: "WARN", addonId: "plugin.video.foo", message: "warn1" },
      { level: "INFO", addonId: "plugin.video.foo", message: "info1" },
    ];
    const comment = formatAddonCheckComment(findings, marker);
    expect(comment).toContain("_2 error(s), 1 warning(s) found._");
  });

  test("summary shows zero counts correctly", () => {
    const findings: AddonFinding[] = [
      { level: "WARN", addonId: "plugin.video.foo", message: "some warning" },
    ];
    const comment = formatAddonCheckComment(findings, marker);
    expect(comment).toContain("_0 error(s), 1 warning(s) found._");
  });

  test("includes heading in all cases", () => {
    expect(formatAddonCheckComment([], marker)).toContain("## Kodiai Addon Check");

    const findings: AddonFinding[] = [
      { level: "ERROR", addonId: "plugin.video.foo", message: "err" },
    ];
    expect(formatAddonCheckComment(findings, marker)).toContain("## Kodiai Addon Check");
  });

  test("no table rows in clean pass output", () => {
    const comment = formatAddonCheckComment([], marker);
    const lines = comment.split("\n");
    const tableRows = lines.filter((l) => l.startsWith("|"));
    expect(tableRows.length).toBe(0);
  });

  test("multiple addons appear as separate table rows", () => {
    const findings: AddonFinding[] = [
      { level: "ERROR", addonId: "plugin.video.foo", message: "err in foo" },
      { level: "WARN", addonId: "plugin.audio.bar", message: "warn in bar" },
    ];
    const comment = formatAddonCheckComment(findings, marker);
    expect(comment).toContain("| plugin.video.foo | ERROR | err in foo |");
    expect(comment).toContain("| plugin.audio.bar | WARN | warn in bar |");
  });

  test("all-timeout renders bounded incomplete diagnostic instead of clean pass", () => {
    const classification = classifyAddonCheckOutcome({
      addons: [{ timedOut: true }, { timedOut: true }],
      timeBudgetMs: 1234,
    });
    const comment = formatAddonCheckComment([], marker, classification);

    expect(comment).toContain("⚠️ **Addon check incomplete.**");
    expect(comment).toContain("- Mode: `all-timeout`");
    expect(comment).toContain("`all-timeout`");
    expect(comment).toContain("Addons checked: 0/2; timed out: 2; tool unavailable: 0.");
    expect(comment).toContain("Time budget: 1234ms per addon.");
    expect(comment).not.toContain("✅ No issues found by kodi-addon-checker.");
    expect(comment).not.toContain("| Addon |");
  });

  test("partial-timeout with findings renders both diagnostic and findings table", () => {
    const classification = classifyAddonCheckOutcome({
      addons: [
        { completed: true, findingCount: 1, errorCount: 1, warningCount: 0 },
        { timedOut: true },
      ],
      timeBudgetMs: 250,
    });
    const findings: AddonFinding[] = [
      { level: "ERROR", addonId: "plugin.video.foo", message: "missing changelog" },
    ];
    const comment = formatAddonCheckComment(findings, marker, classification);

    expect(comment).toContain("- Mode: `partial-timeout`");
    expect(comment).toContain("`partial-timeout`");
    expect(comment).toContain("`findings-present`");
    expect(comment).toContain("| plugin.video.foo | ERROR | missing changelog |");
    expect(comment).toContain("_1 error(s), 0 warning(s) found._");
    expect(comment).not.toContain("✅ No issues found by kodi-addon-checker.");
  });

  test("clean completed classification preserves existing green no-findings message", () => {
    const classification = classifyAddonCheckOutcome({
      addons: [{ completed: true, findingCount: 0, errorCount: 0, warningCount: 0 }],
      timeBudgetMs: 250,
    });
    const comment = formatAddonCheckComment([], marker, classification);

    expect(comment).toContain("✅ No issues found by kodi-addon-checker.");
    expect(comment).not.toContain("Addon check incomplete");
  });

  test("malformed diagnostic input degrades to generic bounded incomplete diagnostic", () => {
    const comment = formatAddonCheckComment([], marker, {
      reasonCodes: ["all-timeout", "secret=/home/user/raw", "all-timeout"],
      counts: {
        addonCount: 50_000,
        completedCount: -1,
        timedOutCount: 2.8,
        toolNotFoundCount: Number.POSITIVE_INFINITY,
        findingCount: 4,
        errorCount: 0,
        warningCount: 0,
        timeBudgetMs: 9_999_999,
      },
    } as never);

    expect(comment).toContain("- Mode: `unknown-malformed-evidence`");
    expect(comment).toContain("`all-timeout`");
    expect(comment).toContain("Addons checked: 0/10000; timed out: 2; tool unavailable: 0.");
    expect(comment).toContain("Time budget: 3600000ms per addon.");
    expect(comment).not.toContain("secret");
    expect(comment).not.toContain("/home/user/raw");
  });
});
