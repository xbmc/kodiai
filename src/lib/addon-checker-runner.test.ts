import { describe, expect, it } from "bun:test";
import {
  ValidKodiVersions,
  parseCheckerOutput,
  resolveCheckerBranch,
  runAddonChecker,
} from "./addon-checker-runner.ts";

// ---------------------------------------------------------------------------
// parseCheckerOutput
// ---------------------------------------------------------------------------

describe("parseCheckerOutput", () => {
  it("classifies ERROR, WARN, and INFO lines", () => {
    const raw = [
      "ERROR: addon.xml is missing required attribute",
      "WARN: Icon size should be 256x256",
      "INFO: Checking addon: script.hello",
    ].join("\n");

    const findings = parseCheckerOutput(raw, "script.hello");

    expect(findings).toHaveLength(3);
    expect(findings[0]).toEqual({
      level: "ERROR",
      addonId: "script.hello",
      message: "addon.xml is missing required attribute",
    });
    expect(findings[1]).toEqual({
      level: "WARN",
      addonId: "script.hello",
      message: "Icon size should be 256x256",
    });
    expect(findings[2]).toEqual({
      level: "INFO",
      addonId: "script.hello",
      message: "Checking addon: script.hello",
    });
  });

  it("strips ANSI escape codes before parsing", () => {
    const raw = "\x1B[31mERROR\x1B[0m: missing field\x1B[0m";
    const findings = parseCheckerOutput(raw, "my.addon");
    expect(findings).toHaveLength(1);
    expect(findings[0]!.level).toBe("ERROR");
    expect(findings[0]!.message).toBe("missing field");
  });

  it("ignores non-matching lines: XML schema noise, blank lines, debug output", () => {
    const raw = [
      "",
      "   ",
      "Checking addon_checker version: 1.2.3",
      "<?xml version='1.0'?>",
      "<addon id='script.hello'>",
      "DEBUG: some internal state",
      "ERROR: real problem",
      "WARN: real warning",
    ].join("\n");

    const findings = parseCheckerOutput(raw, "script.hello");
    expect(findings).toHaveLength(2);
    expect(findings[0]!.level).toBe("ERROR");
    expect(findings[1]!.level).toBe("WARN");
  });

  it("attaches the provided addonId to every finding", () => {
    const raw = "ERROR: bad\nWARN: also bad\nINFO: note";
    const findings = parseCheckerOutput(raw, "plugin.video.test");
    for (const f of findings) {
      expect(f.addonId).toBe("plugin.video.test");
    }
  });

  it("returns empty array for empty input", () => {
    expect(parseCheckerOutput("", "any.addon")).toEqual([]);
  });

  it("handles mixed ANSI and non-ANSI lines in the same output", () => {
    const raw = [
      "\x1B[32mINFO\x1B[0m: clean line",
      "ERROR: bare line",
      "not a finding",
    ].join("\n");

    const findings = parseCheckerOutput(raw, "test.addon");
    expect(findings).toHaveLength(2);
    expect(findings[0]!.level).toBe("INFO");
    expect(findings[1]!.level).toBe("ERROR");
  });
});

// ---------------------------------------------------------------------------
// resolveCheckerBranch
// ---------------------------------------------------------------------------

describe("resolveCheckerBranch", () => {
  it("returns the branch for each known Kodi version", () => {
    for (const version of ValidKodiVersions) {
      expect(resolveCheckerBranch(version)).toBe(version);
    }
  });

  it("returns null for 'main'", () => {
    expect(resolveCheckerBranch("main")).toBeNull();
  });

  it("returns null for 'master'", () => {
    expect(resolveCheckerBranch("master")).toBeNull();
  });

  it("returns null for 'develop'", () => {
    expect(resolveCheckerBranch("develop")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(resolveCheckerBranch("")).toBeNull();
  });

  it("is case-sensitive — 'Nexus' is not a valid version", () => {
    expect(resolveCheckerBranch("Nexus")).toBeNull();
  });

  it("covers all 10 expected version names", () => {
    expect(ValidKodiVersions).toHaveLength(10);
    const expected = [
      "nexus",
      "omega",
      "matrix",
      "leia",
      "jarvis",
      "isengard",
      "helix",
      "gotham",
      "frodo",
      "dharma",
    ];
    expect([...ValidKodiVersions].sort()).toEqual([...expected].sort());
  });
});

// ---------------------------------------------------------------------------
// runAddonChecker
// ---------------------------------------------------------------------------

describe("runAddonChecker", () => {
  it("returns toolNotFound: true when subprocess returns ENOENT error", async () => {
    const stub = () => Promise.reject({ code: "ENOENT" });

    const result = await runAddonChecker({
      addonDir: "/fake/addon",
      branch: "nexus",
      __runSubprocessForTests: stub,
    });

    expect(result.toolNotFound).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.findings).toHaveLength(0);
  });

  it("returns timedOut: true when subprocess exceeds the time budget", async () => {
    // Stub that never resolves within the budget
    const stub = () => new Promise<never>(() => {});

    const result = await runAddonChecker({
      addonDir: "/fake/addon",
      branch: "nexus",
      timeBudgetMs: 10, // very short budget
      __runSubprocessForTests: stub,
    });

    expect(result.timedOut).toBe(true);
    expect(result.toolNotFound).toBe(false);
    expect(result.findings).toHaveLength(0);
  });

  it("parses findings from stdout even when exit code is 1 (non-zero is not failure)", async () => {
    const stdout = [
      "ERROR: addon.xml missing field",
      "WARN: icon too small",
    ].join("\n");

    const stub = () =>
      Promise.resolve({
        exitCode: 1,
        stdout,
      });

    const result = await runAddonChecker({
      addonDir: "/workspace/script.module.test",
      branch: "omega",
      __runSubprocessForTests: stub,
    });

    expect(result.timedOut).toBe(false);
    expect(result.toolNotFound).toBe(false);
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0]!.level).toBe("ERROR");
    expect(result.findings[1]!.level).toBe("WARN");
    // addonId derived from last path segment
    expect(result.findings[0]!.addonId).toBe("script.module.test");
  });

  it("returns empty findings when stdout is empty (clean addon, exit 0)", async () => {
    const stub = () =>
      Promise.resolve({
        exitCode: 0,
        stdout: "",
      });

    const result = await runAddonChecker({
      addonDir: "/workspace/clean.addon",
      branch: "nexus",
      __runSubprocessForTests: stub,
    });

    expect(result.findings).toHaveLength(0);
    expect(result.timedOut).toBe(false);
    expect(result.toolNotFound).toBe(false);
  });

  it("passes the branch and addonDir to the subprocess", async () => {
    const calls: { addonDir: string; branch: string }[] = [];

    const stub = (params: { addonDir: string; branch: string }) => {
      calls.push(params);
      return Promise.resolve({ exitCode: 0, stdout: "" });
    };

    await runAddonChecker({
      addonDir: "/workspace/my.addon",
      branch: "leia",
      __runSubprocessForTests: stub,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.addonDir).toBe("/workspace/my.addon");
    expect(calls[0]!.branch).toBe("leia");
  });

  it("returns empty findings on unexpected non-ENOENT error (fails open)", async () => {
    const stub = () => Promise.reject(new Error("some unexpected error"));

    const result = await runAddonChecker({
      addonDir: "/fake/addon",
      branch: "matrix",
      __runSubprocessForTests: stub,
    });

    expect(result.findings).toHaveLength(0);
    expect(result.timedOut).toBe(false);
    expect(result.toolNotFound).toBe(false);
  });
});
