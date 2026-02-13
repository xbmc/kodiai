import { describe, expect, test } from "bun:test";
import {
  classifyFindingDeltas,
  type FindingForDelta,
} from "./delta-classifier.ts";
import type { PriorFinding } from "../knowledge/types.ts";

/** Trivial fingerprint function for predictable test matching */
const fingerprintFn = (title: string): string =>
  title.toLowerCase().replace(/\s+/g, "-");

function makePrior(overrides: Partial<PriorFinding> = {}): PriorFinding {
  return {
    filePath: "src/app.ts",
    title: "Unused variable detected",
    titleFingerprint: fingerprintFn("Unused variable detected"),
    severity: "minor",
    category: "style",
    startLine: 10,
    endLine: 12,
    commentId: 100,
    ...overrides,
  };
}

function makeCurrent(overrides: Partial<FindingForDelta> = {}): FindingForDelta {
  return {
    filePath: "src/app.ts",
    title: "Unused variable detected",
    severity: "minor",
    category: "style",
    commentId: 42,
    suppressed: false,
    confidence: 85,
    ...overrides,
  };
}

describe("classifyFindingDeltas", () => {
  test("labels all findings as new when no prior findings exist", () => {
    const currentFindings: FindingForDelta[] = [
      makeCurrent({ filePath: "src/a.ts", title: "SQL injection risk" }),
      makeCurrent({ filePath: "src/b.ts", title: "Missing null check" }),
    ];

    const result = classifyFindingDeltas({
      currentFindings,
      priorFindings: [],
      fingerprintFn,
    });

    expect(result.current).toHaveLength(2);
    expect(result.current[0].deltaStatus).toBe("new");
    expect(result.current[1].deltaStatus).toBe("new");
    expect(result.resolved).toHaveLength(0);
    expect(result.counts).toEqual({ new: 2, resolved: 0, stillOpen: 0 });
  });

  test("labels matching finding as still-open when prior fingerprint matches", () => {
    const title = "Unused variable detected";
    const filePath = "src/app.ts";

    const priorFindings: PriorFinding[] = [
      makePrior({ filePath, title, titleFingerprint: fingerprintFn(title) }),
    ];
    const currentFindings: FindingForDelta[] = [
      makeCurrent({ filePath, title }),
    ];

    const result = classifyFindingDeltas({
      currentFindings,
      priorFindings,
      fingerprintFn,
    });

    expect(result.current).toHaveLength(1);
    expect(result.current[0].deltaStatus).toBe("still-open");
    expect(result.resolved).toHaveLength(0);
    expect(result.counts).toEqual({ new: 0, resolved: 0, stillOpen: 1 });
  });

  test("includes prior finding in resolved when not present in current", () => {
    const priorFindings: PriorFinding[] = [
      makePrior({
        filePath: "src/db.ts",
        title: "SQL injection risk",
        titleFingerprint: fingerprintFn("SQL injection risk"),
        severity: "critical",
        category: "security",
      }),
    ];

    const result = classifyFindingDeltas({
      currentFindings: [],
      priorFindings,
      fingerprintFn,
    });

    expect(result.current).toHaveLength(0);
    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0]).toEqual({
      filePath: "src/db.ts",
      title: "SQL injection risk",
      severity: "critical",
      category: "security",
    });
    expect(result.counts).toEqual({ new: 0, resolved: 1, stillOpen: 0 });
  });

  test("handles mixed scenario with new, still-open, and resolved findings", () => {
    const priorFindings: PriorFinding[] = [
      makePrior({
        filePath: "src/app.ts",
        title: "Unused variable detected",
        titleFingerprint: fingerprintFn("Unused variable detected"),
        severity: "minor",
        category: "style",
      }),
      makePrior({
        filePath: "src/db.ts",
        title: "SQL injection risk",
        titleFingerprint: fingerprintFn("SQL injection risk"),
        severity: "critical",
        category: "security",
      }),
    ];

    const currentFindings: FindingForDelta[] = [
      // This matches the prior "Unused variable detected" on src/app.ts -> still-open
      makeCurrent({
        filePath: "src/app.ts",
        title: "Unused variable detected",
      }),
      // This is new -- no prior match
      makeCurrent({
        filePath: "src/api.ts",
        title: "Missing error handling",
        severity: "major",
        category: "correctness",
      }),
    ];

    const result = classifyFindingDeltas({
      currentFindings,
      priorFindings,
      fingerprintFn,
    });

    expect(result.current).toHaveLength(2);

    const stillOpen = result.current.find(
      (f) => f.deltaStatus === "still-open",
    );
    expect(stillOpen).toBeDefined();
    expect(stillOpen!.filePath).toBe("src/app.ts");
    expect(stillOpen!.title).toBe("Unused variable detected");

    const newFinding = result.current.find((f) => f.deltaStatus === "new");
    expect(newFinding).toBeDefined();
    expect(newFinding!.filePath).toBe("src/api.ts");
    expect(newFinding!.title).toBe("Missing error handling");

    // SQL injection risk was in prior but not in current -> resolved
    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0].title).toBe("SQL injection risk");
    expect(result.resolved[0].filePath).toBe("src/db.ts");
  });

  test("counts are accurate for mixed scenario", () => {
    const priorFindings: PriorFinding[] = [
      makePrior({
        filePath: "src/app.ts",
        title: "Unused variable",
        titleFingerprint: fingerprintFn("Unused variable"),
      }),
      makePrior({
        filePath: "src/db.ts",
        title: "SQL injection",
        titleFingerprint: fingerprintFn("SQL injection"),
      }),
      makePrior({
        filePath: "src/auth.ts",
        title: "Missing auth check",
        titleFingerprint: fingerprintFn("Missing auth check"),
      }),
    ];

    const currentFindings: FindingForDelta[] = [
      makeCurrent({ filePath: "src/app.ts", title: "Unused variable" }),
      makeCurrent({ filePath: "src/new.ts", title: "Brand new issue" }),
      makeCurrent({ filePath: "src/other.ts", title: "Another new issue" }),
    ];

    const result = classifyFindingDeltas({
      currentFindings,
      priorFindings,
      fingerprintFn,
    });

    expect(result.counts).toEqual({
      new: 2,
      resolved: 2,
      stillOpen: 1,
    });
  });

  test("empty current findings with prior findings produces all resolved", () => {
    const priorFindings: PriorFinding[] = [
      makePrior({
        filePath: "src/a.ts",
        title: "Issue A",
        titleFingerprint: fingerprintFn("Issue A"),
        severity: "major",
        category: "correctness",
      }),
      makePrior({
        filePath: "src/b.ts",
        title: "Issue B",
        titleFingerprint: fingerprintFn("Issue B"),
        severity: "minor",
        category: "style",
      }),
    ];

    const result = classifyFindingDeltas({
      currentFindings: [],
      priorFindings,
      fingerprintFn,
    });

    expect(result.current).toHaveLength(0);
    expect(result.resolved).toHaveLength(2);
    expect(result.counts).toEqual({ new: 0, resolved: 2, stillOpen: 0 });
  });

  test("uses fingerprintFn to compute fingerprints (not raw title comparison)", () => {
    // Prior has a fingerprint that matches the fingerprint of a differently-cased title
    const priorFindings: PriorFinding[] = [
      makePrior({
        filePath: "src/app.ts",
        title: "Unused Variable Detected",
        // fingerprintFn normalizes to lowercase+dashes
        titleFingerprint: fingerprintFn("Unused Variable Detected"),
      }),
    ];

    // Current has differently-cased title that produces the same fingerprint
    const currentFindings: FindingForDelta[] = [
      makeCurrent({
        filePath: "src/app.ts",
        title: "unused variable detected",
      }),
    ];

    const result = classifyFindingDeltas({
      currentFindings,
      priorFindings,
      fingerprintFn,
    });

    // Both titles produce the same fingerprint "unused-variable-detected"
    // so this should be classified as still-open
    expect(result.current[0].deltaStatus).toBe("still-open");
    expect(result.counts.stillOpen).toBe(1);
    expect(result.counts.new).toBe(0);
  });
});
