import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { EvaluationReport } from "./verify-m060-s02.ts";
import {
  M060_S02_CHECK_IDS,
  buildM060S02ProofHarness,
  evaluateM060S02BoundaryContract,
  parseM060S02Args,
  renderM060S02Report,
} from "./verify-m060-s02.ts";

const EXPECTED_CHECK_IDS = [
  "M060-S02-PACKAGE-WIRING",
  "M060-S02-REGISTRY-WIRING",
  "M060-S02-DECISION-RENDER",
  "M060-S02-SUMMARY-BOUNDARY",
] as const;

const PASSING_PACKAGE_JSON = JSON.stringify(
  {
    name: "kodiai",
    scripts: {
      "verify:m060:s02": "bun scripts/verify-m060-s02.ts",
    },
  },
  null,
  2,
);

const PASSING_REGISTRY = `# Script Registry

| path | purpose | owner | lifecycle | usage |
| --- | --- | --- | --- | --- |
| scripts/verify-m060-s02.test.ts | Regression tests for the M060 S02 ownership-boundary verifier. | M060 | internal | none |
| scripts/verify-m060-s02.ts | Verification CLI for the M060 S02 M060-vs-M027 ownership-boundary contract. | M060 | active | package:verify:m060:s02 |
`;

const PASSING_DECISIONS = `# Decisions Register

| # | When | Scope | Decision | Choice | Rationale | Revisable? | Made By |
|---|------|-------|----------|--------|-----------|------------|---------|
| D171 | M060/S02 planning | testing | How M060/S02 should define the ownership boundary between M060 and M027 knowledge verification | Define the boundary by proof class, not file exclusivity: M060 owns direct same-name unit tests plus explicit type-only exemptions for selected \`src/knowledge\` modules, while M027 owns persisted-corpus audit, repair/status, and live retriever acceptance proofs. S02 should document that split in tracked narrative artifacts and enforce it with a deterministic repo-local verifier instead of changing M027 runtime verifier behavior. | Several \`src/knowledge\` modules legitimately participate in both milestones for different reasons, so a file-only split would be false and brittle. A proof-class boundary matches existing verifier behavior, prevents duplicate or misleading claims, and gives future slices one machine-checkable contract for where unit proof ends and corpus-integrity proof begins. | Yes | agent |
`;

const PASSING_SUMMARY = `# M027 Summary

## M060/M027 ownership boundary

- **M060/M027 ownership boundary** — canonical proof-class split for overlapping \`src/knowledge\` surfaces.
- **M060 owns direct same-name unit tests** for the runtime targets listed in \`src/knowledge/test-coverage-exemptions.ts\`, plus the explicit type-only exemptions in that same manifest. The canonical unit-test contract source is \`bun run verify:m060:s01\`.
- **M027 owns persisted-corpus audit, repair/status, and live retriever acceptance proof** across stored corpora. The canonical corpus-level proof family is \`bun run verify:m027:s01\`, \`bun run verify:m027:s02\`, \`bun run verify:m027:s03\`, and \`bun run verify:m027:s04\`.
- File overlap is allowed when the proof class differs. The same source file can participate in M060 unit-test ownership and M027 corpus-integrity acceptance proof without conflict.
- \`issue_comments\` remains truthful current scope: audited and repairable under M027, but outside the live retriever and therefore not evidence of retriever coverage.
- \`D171\` in \`.gsd/DECISIONS.md\` is the canonical architectural rationale for this boundary and should remain the verifier-readable decision surface.
`;

function createReadTextFile(overrides: Record<string, string | Error> = {}) {
  const map: Record<string, string | Error> = {
    package: PASSING_PACKAGE_JSON,
    registry: PASSING_REGISTRY,
    decisions: PASSING_DECISIONS,
    summary: PASSING_SUMMARY,
    ...overrides,
  };

  return async (filePath: string): Promise<string> => {
    const normalized = filePath.replace(/\\/g, "/");
    if (normalized.endsWith("/package.json")) {
      const value = map.package!;
      if (value instanceof Error) throw value;
      return value;
    }
    if (normalized.endsWith("/scripts/REGISTRY.md")) {
      const value = map.registry!;
      if (value instanceof Error) throw value;
      return value;
    }
    if (normalized.endsWith("/.gsd/DECISIONS.md")) {
      const value = map.decisions!;
      if (value instanceof Error) throw value;
      return value;
    }
    if (normalized.endsWith("/.gsd/milestones/M027/M027-SUMMARY.md")) {
      const value = map.summary!;
      if (value instanceof Error) throw value;
      return value;
    }

    throw new Error(`Unexpected path: ${filePath}`);
  };
}

describe("verify m060 s02 ownership boundary contract", () => {
  test("exports stable check ids and cli parsing", () => {
    expect(M060_S02_CHECK_IDS).toEqual(EXPECTED_CHECK_IDS);
    expect(parseM060S02Args([])).toEqual({ json: false });
    expect(parseM060S02Args(["--json"])).toEqual({ json: true });
    expect(() => parseM060S02Args(["--wat"])).toThrow(/invalid_cli_args/i);
  });

  test("passes for the wired ownership-boundary contract", async () => {
    const report = await evaluateM060S02BoundaryContract({
      generatedAt: "2026-04-21T18:30:00.000Z",
      readTextFile: createReadTextFile(),
    });

    expect(report.command).toBe("verify:m060:s02");
    expect(report.check_ids).toEqual(EXPECTED_CHECK_IDS);
    expect(report.overallPassed).toBe(true);
    expect(report.checks).toEqual([
      expect.objectContaining({ id: "M060-S02-PACKAGE-WIRING", passed: true, status_code: "package_wiring_ok" }),
      expect.objectContaining({ id: "M060-S02-REGISTRY-WIRING", passed: true, status_code: "registry_rows_ok" }),
      expect.objectContaining({ id: "M060-S02-DECISION-RENDER", passed: true, status_code: "decision_render_ok" }),
      expect.objectContaining({ id: "M060-S02-SUMMARY-BOUNDARY", passed: true, status_code: "boundary_markers_ok" }),
    ]);

    const rendered = renderM060S02Report(report);
    expect(rendered).toContain("Boundary contract: PASS");
    expect(rendered).toContain("Manifest anchor:");
    expect(rendered).toContain("M060-S02-SUMMARY-BOUNDARY PASS");
  });

  test("fails with stable status codes for missing wiring and missing canonical markers", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const result = await buildM060S02ProofHarness({
      json: true,
      stdout: { write: (chunk: string) => void stdout.push(chunk) },
      stderr: { write: (chunk: string) => void stderr.push(chunk) },
      readTextFile: createReadTextFile({
        package: JSON.stringify({ scripts: {} }),
        registry: "# Script Registry\n",
        decisions: PASSING_DECISIONS.replace("deterministic repo-local verifier", "repo-local check"),
        summary: PASSING_SUMMARY.replace("File overlap is allowed when the proof class differs.", "No overlap guidance here."),
      }),
    });

    const report = JSON.parse(stdout.join("")) as EvaluationReport;
    expect(result.exitCode).toBe(1);
    expect(report.overallPassed).toBe(false);
    expect(report.checks).toEqual([
      expect.objectContaining({ id: "M060-S02-PACKAGE-WIRING", passed: false, status_code: "package_wiring_missing" }),
      expect.objectContaining({ id: "M060-S02-REGISTRY-WIRING", passed: false, status_code: "registry_rows_missing" }),
      expect.objectContaining({ id: "M060-S02-DECISION-RENDER", passed: false, status_code: "decision_marker_missing" }),
      expect.objectContaining({ id: "M060-S02-SUMMARY-BOUNDARY", passed: false, status_code: "boundary_marker_missing" }),
    ]);
    expect(report.checks[2]?.detail).toContain("deterministic repo-local verifier");
    expect(report.checks[3]?.detail).toContain("File overlap is allowed when the proof class differs.");
    expect(stderr.join(" ")).toContain("package_wiring_missing");
    expect(stderr.join(" ")).toContain("registry_rows_missing");
    expect(stderr.join(" ")).toContain("decision_marker_missing");
    expect(stderr.join(" ")).toContain("boundary_marker_missing");
  });

  test("surfaces unreadable and malformed dependency states with stable status codes", async () => {
    const packageInvalid = await evaluateM060S02BoundaryContract({
      readTextFile: createReadTextFile({ package: "{ not valid json" }),
    });
    expect(packageInvalid.checks[0]).toEqual(
      expect.objectContaining({ id: "M060-S02-PACKAGE-WIRING", passed: false, status_code: "package_json_invalid" }),
    );

    const summaryUnreadable = await evaluateM060S02BoundaryContract({
      readTextFile: createReadTextFile({ summary: new Error("enoent") }),
    });
    expect(summaryUnreadable.checks[3]).toEqual(
      expect.objectContaining({ id: "M060-S02-SUMMARY-BOUNDARY", passed: false, status_code: "summary_file_unreadable" }),
    );
    expect(summaryUnreadable.checks[3]?.detail).toContain(".gsd/milestones/M027/M027-SUMMARY.md");

    const decisionUnreadable = await evaluateM060S02BoundaryContract({
      readTextFile: createReadTextFile({ decisions: new Error("permission denied") }),
    });
    expect(decisionUnreadable.checks[2]).toEqual(
      expect.objectContaining({ id: "M060-S02-DECISION-RENDER", passed: false, status_code: "decision_file_unreadable" }),
    );
    expect(decisionUnreadable.checks[2]?.detail).toContain(".gsd/DECISIONS.md");
  });

  test("flags missing rendered D171 row and missing M027 proof command markers", async () => {
    const missingDecision = await evaluateM060S02BoundaryContract({
      readTextFile: createReadTextFile({
        decisions: PASSING_DECISIONS.replace("| D171 |", "| D999 |"),
      }),
    });
    expect(missingDecision.checks[2]).toEqual(
      expect.objectContaining({ id: "M060-S02-DECISION-RENDER", passed: false, status_code: "decision_render_missing" }),
    );

    const missingVerifierFamily = await evaluateM060S02BoundaryContract({
      readTextFile: createReadTextFile({
        summary: PASSING_SUMMARY
          .replace(", \`bun run verify:m027:s03\`, and \`bun run verify:m027:s04\`.", ".")
          .replace("outside the live retriever and therefore not evidence of retriever coverage.", "not part of the retriever scope."),
      }),
    });
    expect(missingVerifierFamily.checks[3]).toEqual(
      expect.objectContaining({ id: "M060-S02-SUMMARY-BOUNDARY", passed: false, status_code: "boundary_marker_missing" }),
    );
    expect(missingVerifierFamily.checks[3]?.detail).toContain("outside the live retriever");
  });

  test("wires the canonical package script", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["verify:m060:s02"]).toBe("bun scripts/verify-m060-s02.ts");
  });
});
