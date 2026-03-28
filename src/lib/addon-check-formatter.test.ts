import { describe, test, expect } from "bun:test";
import {
  buildAddonCheckMarker,
  formatAddonCheckComment,
} from "./addon-check-formatter.ts";
import type { AddonFinding } from "../handlers/addon-check.ts";

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
});
