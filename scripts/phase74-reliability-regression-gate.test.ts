import { describe, expect, test } from "bun:test";
import {
  evaluateCapabilityChecks,
  evaluateScenarioChecks,
  parseIssueWriteStatus,
  renderSummary,
  runGate,
  type CapabilityProbe,
} from "./phase74-reliability-regression-gate.ts";

const baseCapability: CapabilityProbe = {
  owner: "xbmc",
  repo: "xbmc",
  permissionLevel: "WRITE",
  pushPermission: true,
  defaultBranch: "master",
  archived: false,
  source: "fixture",
};

const baseScenario = {
  scenarioName: "phase74-combined-regression",
  issueWriteReply: [
    "Write request failed before PR publication completed.",
    "",
    "status: pr_creation_failed",
    "failed_step: create-pr",
    "diagnostics: Resource not accessible by integration",
    "",
    "Retry command: @kodiai apply: same change",
  ].join("\n"),
  artifacts: {
    branchPush: true,
    prUrl: "https://github.com/xbmc/xbmc/pull/123",
    issueLinkbackUrl: "https://github.com/xbmc/xbmc/issues/27874#issuecomment-1",
  },
  retrieval: {
    maxChars: 1200,
    renderedChars: 890,
    fallbackText: "- [major/reliability] src/handlers/mention.ts -- fallback evidence",
  },
};

describe("phase74 status parsing", () => {
  test("parses status fields and Opened PR URL", () => {
    const parsed = parseIssueWriteStatus(
      [
        "status: pr_creation_failed",
        "failed_step: create-pr",
        "diagnostics: API rejected request",
        "Retry command: @kodiai apply: retry",
        "Opened PR: https://github.com/xbmc/xbmc/pull/900",
      ].join("\n"),
    );

    expect(parsed.status).toBe("pr_creation_failed");
    expect(parsed.failedStep).toBe("create-pr");
    expect(parsed.diagnostics).toBe("API rejected request");
    expect(parsed.retryCommand).toBe("@kodiai apply: retry");
    expect(parsed.openedPrUrl).toBe("https://github.com/xbmc/xbmc/pull/900");
  });

  test("uses unknown-cause diagnostic fallback when diagnostics is absent", () => {
    const parsed = parseIssueWriteStatus("status: pr_creation_failed\nfailed_step: create-pr");
    expect(parsed.diagnostics).toBe("Unknown publish failure");
  });
});

describe("phase74 capability preflight checks", () => {
  test("fails capability checks when runtime lacks push/PR prerequisites", () => {
    const checks = evaluateCapabilityChecks({
      ...baseCapability,
      permissionLevel: "READ",
      pushPermission: false,
    });

    expect(checks.find((check) => check.id === "CAP-74-01")?.passed).toBe(false);
    expect(checks.find((check) => check.id === "CAP-74-02")?.passed).toBe(false);
    expect(checks.find((check) => check.id === "CAP-74-03")?.passed).toBe(false);
  });
});

const successScenario = {
  scenarioName: "phase74-success-path-regression",
  issueWriteReply: [
    "status: success",
    "pr_url: https://github.com/xbmc/xbmc/pull/456",
    "issue_linkback_url: https://github.com/xbmc/xbmc/issues/27874#issuecomment-99",
    "",
    "Opened PR: https://github.com/xbmc/xbmc/pull/456",
  ].join("\n"),
  artifacts: {
    branchPush: true,
    prUrl: "https://github.com/xbmc/xbmc/pull/456",
    issueLinkbackUrl: "https://github.com/xbmc/xbmc/issues/27874#issuecomment-99",
  },
  retrieval: {
    maxChars: 1200,
    renderedChars: 600,
    fallbackText: "- [major/reliability] src/handlers/mention.ts -- success evidence",
  },
};

describe("phase74 success-path status envelope regression", () => {
  test("parses success reply with pr_url and issue_linkback_url markers", () => {
    const parsed = parseIssueWriteStatus(successScenario.issueWriteReply);
    expect(parsed.status).toBe("success");
    expect(parsed.prUrl).toBe("https://github.com/xbmc/xbmc/pull/456");
    expect(parsed.issueLinkbackUrl).toBe(
      "https://github.com/xbmc/xbmc/issues/27874#issuecomment-99",
    );
    expect(parsed.openedPrUrl).toBe("https://github.com/xbmc/xbmc/pull/456");
  });

  test("passes all REL checks for complete success envelope with artifact triad", () => {
    const parsed = parseIssueWriteStatus(successScenario.issueWriteReply);
    const checks = evaluateScenarioChecks(successScenario, parsed);
    const relChecks = checks.filter((c) => c.id.startsWith("REL-74"));
    expect(relChecks.every((c) => c.passed)).toBe(true);
  });

  test("fails REL-74-05 when success reply omits pr_url marker", () => {
    const reply = [
      "status: success",
      "issue_linkback_url: https://github.com/xbmc/xbmc/issues/27874#issuecomment-99",
    ].join("\n");
    const parsed = parseIssueWriteStatus(reply);
    const checks = evaluateScenarioChecks(successScenario, parsed);
    expect(checks.find((c) => c.id === "REL-74-05")?.passed).toBe(false);
  });

  test("fails REL-74-05 when success reply omits issue_linkback_url marker", () => {
    const reply = [
      "status: success",
      "pr_url: https://github.com/xbmc/xbmc/pull/456",
    ].join("\n");
    const parsed = parseIssueWriteStatus(reply);
    const checks = evaluateScenarioChecks(successScenario, parsed);
    expect(checks.find((c) => c.id === "REL-74-05")?.passed).toBe(false);
  });

  test("fails REL-74-04 when success path lacks artifact triad", () => {
    const parsed = parseIssueWriteStatus(successScenario.issueWriteReply);
    const checks = evaluateScenarioChecks(
      {
        ...successScenario,
        artifacts: { branchPush: false, prUrl: null, issueLinkbackUrl: null },
      },
      parsed,
    );
    expect(checks.find((c) => c.id === "REL-74-04")?.passed).toBe(false);
  });

  test("full gate report passes for complete success scenario", () => {
    const report = runGate({
      owner: "xbmc",
      repo: "xbmc",
      scenario: successScenario,
      capabilityProbe: baseCapability,
    });
    expect(report.overallPassed).toBe(true);
    const summary = renderSummary(report);
    expect(summary).toContain("Final verdict: PASS");
  });

  test("full gate report fails with REL-74-05 when success markers missing", () => {
    const brokenReply = "status: success\nOpened PR: https://github.com/xbmc/xbmc/pull/456";
    const report = runGate({
      owner: "xbmc",
      repo: "xbmc",
      scenario: { ...successScenario, issueWriteReply: brokenReply },
      capabilityProbe: baseCapability,
    });
    expect(report.overallPassed).toBe(false);
    const summary = renderSummary(report);
    expect(summary).toContain("REL-74-05");
    expect(summary).toContain("Final verdict: FAIL");
  });
});

describe("phase74 combined degraded + retrieval + issue-write scenario checks", () => {
  test("passes reliability and retrieval checks for deterministic combined scenario", () => {
    const parsed = parseIssueWriteStatus(baseScenario.issueWriteReply);
    const checks = evaluateScenarioChecks(baseScenario, parsed);
    expect(checks.every((check) => check.passed)).toBe(true);
  });

  test("fails retrieval check when rendered section exceeds maxChars", () => {
    const parsed = parseIssueWriteStatus(baseScenario.issueWriteReply);
    const checks = evaluateScenarioChecks(
      {
        ...baseScenario,
        retrieval: {
          ...baseScenario.retrieval,
          renderedChars: 1400,
        },
      },
      parsed,
    );

    expect(checks.find((check) => check.id === "RET-74-01")?.passed).toBe(false);
  });

  test("fails when failure status does not provide known failed_step", () => {
    const parsed = parseIssueWriteStatus(
      [
        "status: pr_creation_failed",
        "failed_step: unexpected-step",
        "diagnostics: unknown",
      ].join("\n"),
    );
    const checks = evaluateScenarioChecks(baseScenario, parsed);
    expect(checks.find((check) => check.id === "REL-74-02")?.passed).toBe(false);
  });
});

describe("phase74 gate report", () => {
  test("overallPassed false leads to non-zero gating outcome data", () => {
    const report = runGate({
      owner: "xbmc",
      repo: "xbmc",
      scenario: {
        ...baseScenario,
        retrieval: {
          ...baseScenario.retrieval,
          renderedChars: 5000,
        },
      },
      capabilityProbe: baseCapability,
    });

    expect(report.overallPassed).toBe(false);
    expect(report.checks.some((check) => check.id === "RET-74-01" && !check.passed)).toBe(true);
  });

  test("summary output lists failed check IDs for actionable operators", () => {
    const report = runGate({
      owner: "xbmc",
      repo: "xbmc",
      scenario: {
        ...baseScenario,
        issueWriteReply: "status: pr_creation_failed\nfailed_step: create-pr",
      },
      capabilityProbe: {
        ...baseCapability,
        pushPermission: false,
      },
    });

    const summary = renderSummary(report);
    expect(summary).toContain("Final verdict: FAIL");
    expect(summary).toContain("CAP-74-02");
  });
});
