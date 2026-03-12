import { describe, expect, test } from "bun:test";
import { demoteExternalClaimSeverities, type DemotableFinding } from "./severity-demoter.ts";
import type { FindingClaimClassification, ClaimClassification } from "./claim-classifier.ts";

function makeFinding(
  overrides: Partial<DemotableFinding> & { severity: string; commentId: number },
): DemotableFinding {
  return {
    title: "Test finding",
    ...overrides,
  } as DemotableFinding;
}

function makeClassification(
  summaryLabel: "primarily-diff-grounded" | "primarily-external" | "mixed",
  claims: ClaimClassification[] = [],
): FindingClaimClassification {
  return { summaryLabel, claims };
}

describe("demoteExternalClaimSeverities", () => {
  test("demotes CRITICAL + primarily-external to medium", () => {
    const findings = [
      makeFinding({
        commentId: 1,
        severity: "critical",
        title: "Fake version claim",
        claimClassification: makeClassification("primarily-external", [
          { text: "version 1.13.0 introduced bug", label: "external-knowledge", confidence: 0.9 },
        ]),
      }),
    ];
    const result = demoteExternalClaimSeverities(findings);
    expect(result[0]!.severity).toBe("medium");
    expect(result[0]!.preDemotionSeverity).toBe("critical");
    expect(result[0]!.severityDemoted).toBe(true);
    expect(result[0]!.demotionReason).toBeDefined();
  });

  test("demotes MAJOR + primarily-external to medium", () => {
    const findings = [
      makeFinding({
        commentId: 2,
        severity: "major",
        title: "API behavior claim",
        claimClassification: makeClassification("primarily-external", [
          { text: "library always throws on null", label: "external-knowledge", confidence: 0.85 },
        ]),
      }),
    ];
    const result = demoteExternalClaimSeverities(findings);
    expect(result[0]!.severity).toBe("medium");
    expect(result[0]!.preDemotionSeverity).toBe("major");
    expect(result[0]!.severityDemoted).toBe(true);
  });

  test("does NOT demote CRITICAL + primarily-diff-grounded", () => {
    const findings = [
      makeFinding({
        commentId: 3,
        severity: "critical",
        title: "Real bug in diff",
        claimClassification: makeClassification("primarily-diff-grounded"),
      }),
    ];
    const result = demoteExternalClaimSeverities(findings);
    expect(result[0]!.severity).toBe("critical");
    expect(result[0]!.severityDemoted).toBeUndefined();
    expect(result[0]!.preDemotionSeverity).toBeUndefined();
  });

  test("does NOT demote CRITICAL + mixed", () => {
    const findings = [
      makeFinding({
        commentId: 4,
        severity: "critical",
        title: "Mixed claim finding",
        claimClassification: makeClassification("mixed"),
      }),
    ];
    const result = demoteExternalClaimSeverities(findings);
    expect(result[0]!.severity).toBe("critical");
    expect(result[0]!.severityDemoted).toBeUndefined();
  });

  test("does NOT demote medium + primarily-external (already at/below cap)", () => {
    const findings = [
      makeFinding({
        commentId: 5,
        severity: "medium",
        title: "Medium external claim",
        claimClassification: makeClassification("primarily-external"),
      }),
    ];
    const result = demoteExternalClaimSeverities(findings);
    expect(result[0]!.severity).toBe("medium");
    expect(result[0]!.severityDemoted).toBeUndefined();
  });

  test("does NOT demote minor + primarily-external (already below cap)", () => {
    const findings = [
      makeFinding({
        commentId: 6,
        severity: "minor",
        title: "Minor external claim",
        claimClassification: makeClassification("primarily-external"),
      }),
    ];
    const result = demoteExternalClaimSeverities(findings);
    expect(result[0]!.severity).toBe("minor");
    expect(result[0]!.severityDemoted).toBeUndefined();
  });

  test("fail-open: undefined claimClassification does not trigger demotion", () => {
    const findings = [
      makeFinding({
        commentId: 7,
        severity: "critical",
        title: "No classification data",
      }),
    ];
    const result = demoteExternalClaimSeverities(findings);
    expect(result[0]!.severity).toBe("critical");
    expect(result[0]!.severityDemoted).toBeUndefined();
  });

  test("fail-open: null summaryLabel does not trigger demotion", () => {
    const findings = [
      makeFinding({
        commentId: 8,
        severity: "critical",
        title: "Broken classification",
        claimClassification: { summaryLabel: undefined as any, claims: [] },
      }),
    ];
    const result = demoteExternalClaimSeverities(findings);
    expect(result[0]!.severity).toBe("critical");
    expect(result[0]!.severityDemoted).toBeUndefined();
  });

  test("returns new objects (immutable, does not mutate inputs)", () => {
    const original = makeFinding({
      commentId: 9,
      severity: "critical",
      title: "Immutability test",
      claimClassification: makeClassification("primarily-external"),
    });
    const originalSeverity = original.severity;
    const result = demoteExternalClaimSeverities([original]);
    expect(original.severity).toBe(originalSeverity); // input unchanged
    expect(result[0]).not.toBe(original); // different object
    expect(result[0]!.severity).toBe("medium"); // output demoted
  });

  test("empty findings array returns empty array", () => {
    const result = demoteExternalClaimSeverities([]);
    expect(result).toEqual([]);
  });

  test("mixed array: only primarily-external findings are demoted", () => {
    const findings = [
      makeFinding({
        commentId: 10,
        severity: "critical",
        title: "External claim",
        claimClassification: makeClassification("primarily-external"),
      }),
      makeFinding({
        commentId: 11,
        severity: "critical",
        title: "Grounded claim",
        claimClassification: makeClassification("primarily-diff-grounded"),
      }),
      makeFinding({
        commentId: 12,
        severity: "major",
        title: "Mixed claim",
        claimClassification: makeClassification("mixed"),
      }),
    ];
    const result = demoteExternalClaimSeverities(findings);
    expect(result[0]!.severity).toBe("medium");
    expect(result[0]!.severityDemoted).toBe(true);
    expect(result[1]!.severity).toBe("critical");
    expect(result[1]!.severityDemoted).toBeUndefined();
    expect(result[2]!.severity).toBe("major");
    expect(result[2]!.severityDemoted).toBeUndefined();
  });

  test("demotionReason includes evidence from external-knowledge claims", () => {
    const findings = [
      makeFinding({
        commentId: 13,
        severity: "critical",
        title: "Version claim",
        claimClassification: makeClassification("primarily-external", [
          { text: "version 1.13.0 has bug", label: "external-knowledge", evidence: "version number not in diff", confidence: 0.9 },
          { text: "diff shows import change", label: "diff-grounded", confidence: 0.95 },
          { text: "API deprecated in v2", label: "external-knowledge", evidence: "deprecation not visible in diff", confidence: 0.8 },
        ]),
      }),
    ];
    const result = demoteExternalClaimSeverities(findings);
    expect(result[0]!.demotionReason).toContain("version number not in diff");
    expect(result[0]!.demotionReason).toContain("deprecation not visible in diff");
  });

  test("logs demotion when logger is provided", () => {
    const logs: Array<{ obj: Record<string, unknown>; msg: string }> = [];
    const mockLogger = {
      info: (obj: Record<string, unknown>, msg: string) => {
        logs.push({ obj, msg });
      },
    };
    const findings = [
      makeFinding({
        commentId: 14,
        severity: "critical",
        title: "Logged finding",
        claimClassification: makeClassification("primarily-external"),
      }),
    ];
    demoteExternalClaimSeverities(findings, mockLogger);
    expect(logs.length).toBe(1);
    expect(logs[0]!.obj.findingTitle).toBe("Logged finding");
    expect(logs[0]!.obj.originalSeverity).toBe("critical");
    expect(logs[0]!.obj.newSeverity).toBe("medium");
    expect(logs[0]!.obj.summaryLabel).toBe("primarily-external");
    expect(logs[0]!.msg).toContain("Severity demoted");
  });

  test("does NOT log when no demotion occurs", () => {
    const logs: Array<{ obj: Record<string, unknown>; msg: string }> = [];
    const mockLogger = {
      info: (obj: Record<string, unknown>, msg: string) => {
        logs.push({ obj, msg });
      },
    };
    const findings = [
      makeFinding({
        commentId: 15,
        severity: "critical",
        title: "No demotion",
        claimClassification: makeClassification("primarily-diff-grounded"),
      }),
    ];
    demoteExternalClaimSeverities(findings, mockLogger);
    expect(logs.length).toBe(0);
  });
});
