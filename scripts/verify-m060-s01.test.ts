import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { EvaluationReport } from "./verify-m060-s01.ts";
import {
  M060_S01_CHECK_IDS,
  buildM060S01ProofHarness,
  evaluateM060S01CoverageContract,
  parseM060S01Args,
  renderM060S01Report,
} from "./verify-m060-s01.ts";

const EXPECTED_CHECK_IDS = [
  "M060-S01-PACKAGE-WIRING",
  "M060-S01-REGISTRY-WIRING",
  "M060-S01-RUNTIME-TARGET-MANIFEST",
  "M060-S01-DIRECT-TEST-COVERAGE",
  "M060-S01-TYPE-ONLY-EXEMPTIONS",
] as const;

const PASSING_RUNTIME_TARGETS = [
  "src/knowledge/isolation.ts",
  "src/knowledge/wiki-fetch.ts",
  "src/knowledge/issue-retrieval.ts",
  "src/knowledge/wiki-popularity-config.ts",
  "src/knowledge/wiki-linkshere-fetcher.ts",
  "src/knowledge/wiki-popularity-scorer.ts",
  "src/knowledge/cluster-scheduler.ts",
] as const;

const PASSING_TYPE_ONLY_EXEMPTIONS = [
  "src/knowledge/canonical-code-types.ts",
  "src/knowledge/cluster-types.ts",
  "src/knowledge/code-snippet-types.ts",
  "src/knowledge/issue-types.ts",
  "src/knowledge/review-comment-types.ts",
  "src/knowledge/types.ts",
  "src/knowledge/wiki-publisher-types.ts",
  "src/knowledge/wiki-staleness-types.ts",
  "src/knowledge/wiki-types.ts",
  "src/knowledge/wiki-update-types.ts",
  "src/knowledge/wiki-voice-types.ts",
] as const;

const PASSING_PACKAGE_JSON = JSON.stringify(
  {
    name: "kodiai",
    scripts: {
      "verify:m060:s01": "bun scripts/verify-m060-s01.ts",
    },
  },
  null,
  2,
);

const PASSING_REGISTRY = `# Script Registry

| path | purpose | owner | lifecycle | usage |
| --- | --- | --- | --- | --- |
| scripts/verify-m060-s01.test.ts | Regression tests for the M060 S01 direct-test coverage verifier. | M060 | internal | none |
| scripts/verify-m060-s01.ts | Verification CLI for the M060 S01 knowledge direct-test coverage contract. | M060 | active | package:verify:m060:s01 |
`;

function buildTrackedFiles(opts: {
  omitTestsFor?: string[];
  includeTestsForExemptions?: string[];
} = {}): string[] {
  const tracked = [
    "package.json",
    "scripts/REGISTRY.md",
    ...PASSING_RUNTIME_TARGETS,
    ...PASSING_RUNTIME_TARGETS.map((target) => target.replace(/\.ts$/u, ".test.ts")),
    ...PASSING_TYPE_ONLY_EXEMPTIONS,
  ];

  for (const target of opts.omitTestsFor ?? []) {
    const testPath = target.replace(/\.ts$/u, ".test.ts");
    const index = tracked.indexOf(testPath);
    if (index !== -1) tracked.splice(index, 1);
  }

  for (const target of opts.includeTestsForExemptions ?? []) {
    tracked.push(target.replace(/\.ts$/u, ".test.ts"));
  }

  return tracked.sort();
}

function buildSourceMap(overrides: Record<string, string> = {}): Record<string, string> {
  const sources: Record<string, string> = {
    "scripts/REGISTRY.md": PASSING_REGISTRY,
    "package.json": PASSING_PACKAGE_JSON,
  };

  for (const filePath of PASSING_TYPE_ONLY_EXEMPTIONS) {
    sources[filePath] = `export type ${filePath.replace(/[^a-z]/giu, "_")} = { ok: true };\n`;
  }

  return { ...sources, ...overrides };
}

function buildFileExists(trackedFiles: string[]) {
  const fileSet = new Set(trackedFiles);
  return async (filePath: string): Promise<boolean> => fileSet.has(filePath.replace(/\\/g, "/"));
}

describe("verify m060 s01 coverage contract", () => {
  test("exports stable check ids and cli parsing", () => {
    expect(M060_S01_CHECK_IDS).toEqual(EXPECTED_CHECK_IDS);
    expect(parseM060S01Args([])).toEqual({ json: false });
    expect(parseM060S01Args(["--json"])).toEqual({ json: true });
    expect(() => parseM060S01Args(["--wat"])).toThrow(/invalid_cli_args/i);
  });

  test("passes for the wired direct-test coverage contract", async () => {
    const trackedFiles = buildTrackedFiles();
    const report = await evaluateM060S01CoverageContract({
      generatedAt: "2026-04-21T17:00:00.000Z",
      readTextFile: async (filePath: string) => {
        const normalized = filePath.replace(/\\/g, "/");
        const mapped = buildSourceMap()[normalized.replace(/^.*?(package\.json|scripts\/REGISTRY\.md|src\/knowledge\/.*)$/u, "$1")];
        if (mapped != null) return mapped;
        throw new Error(`Unexpected path: ${filePath}`);
      },
      listTrackedFiles: async () => trackedFiles,
      fileExists: buildFileExists(trackedFiles),
      loadManifest: async () => ({
        runtimeTargets: PASSING_RUNTIME_TARGETS,
        typeOnlyExemptions: PASSING_TYPE_ONLY_EXEMPTIONS,
      }),
    });

    expect(report.command).toBe("verify:m060:s01");
    expect(report.check_ids).toEqual(EXPECTED_CHECK_IDS);
    expect(report.overallPassed).toBe(true);
    expect(report.checks).toEqual([
      expect.objectContaining({ id: "M060-S01-PACKAGE-WIRING", passed: true, status_code: "package_wiring_ok" }),
      expect.objectContaining({ id: "M060-S01-REGISTRY-WIRING", passed: true, status_code: "registry_rows_ok" }),
      expect.objectContaining({ id: "M060-S01-RUNTIME-TARGET-MANIFEST", passed: true, status_code: "runtime_targets_ok" }),
      expect.objectContaining({ id: "M060-S01-DIRECT-TEST-COVERAGE", passed: true, status_code: "direct_tests_ok" }),
      expect.objectContaining({ id: "M060-S01-TYPE-ONLY-EXEMPTIONS", passed: true, status_code: "type_only_exemptions_ok" }),
    ]);

    const rendered = renderM060S01Report(report);
    expect(rendered).toContain("Coverage contract: PASS");
    expect(rendered).toContain("M060-S01-DIRECT-TEST-COVERAGE PASS");
    expect(rendered).toContain("M060-S01-TYPE-ONLY-EXEMPTIONS PASS");
  });

  test("fails with stable status codes for missing direct tests, bad wiring, and runtime-bearing exemptions", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const trackedFiles = buildTrackedFiles({ omitTestsFor: ["src/knowledge/cluster-scheduler.ts"] });

    const result = await buildM060S01ProofHarness({
      json: true,
      stdout: { write: (chunk: string) => void stdout.push(chunk) },
      stderr: { write: (chunk: string) => void stderr.push(chunk) },
      readTextFile: async (filePath: string) => {
        const normalized = filePath.replace(/\\/g, "/");
        const relative = normalized.replace(/^.*?(package\.json|scripts\/REGISTRY\.md|src\/knowledge\/.*)$/u, "$1");
        const map = buildSourceMap({
          "package.json": JSON.stringify({ scripts: {} }),
          "scripts/REGISTRY.md": "# Script Registry\n",
          "src/knowledge/issue-types.ts": "export const notTypeOnly = 1;\n",
        });
        const value = map[relative];
        if (value != null) return value;
        throw new Error(`Unexpected path: ${filePath}`);
      },
      listTrackedFiles: async () => trackedFiles,
      fileExists: buildFileExists(trackedFiles),
      loadManifest: async () => ({
        runtimeTargets: PASSING_RUNTIME_TARGETS,
        typeOnlyExemptions: PASSING_TYPE_ONLY_EXEMPTIONS,
      }),
    });

    const report = JSON.parse(stdout.join("")) as EvaluationReport;
    expect(result.exitCode).toBe(1);
    expect(report.overallPassed).toBe(false);
    expect(report.checks).toEqual([
      expect.objectContaining({ id: "M060-S01-PACKAGE-WIRING", passed: false, status_code: "package_wiring_missing" }),
      expect.objectContaining({ id: "M060-S01-REGISTRY-WIRING", passed: false, status_code: "registry_rows_missing" }),
      expect.objectContaining({ id: "M060-S01-RUNTIME-TARGET-MANIFEST", passed: true, status_code: "runtime_targets_ok" }),
      expect.objectContaining({ id: "M060-S01-DIRECT-TEST-COVERAGE", passed: false, status_code: "direct_tests_missing" }),
      expect.objectContaining({ id: "M060-S01-TYPE-ONLY-EXEMPTIONS", passed: false, status_code: "type_only_exemption_invalid" }),
    ]);
    expect(report.checks[3]?.detail).toContain("cluster-scheduler.ts -> src/knowledge/cluster-scheduler.test.ts");
    expect(report.checks[4]?.detail).toContain("src/knowledge/issue-types.ts: runtime exports detected");
    expect(stderr.join(" ")).toContain("package_wiring_missing");
    expect(stderr.join(" ")).toContain("registry_rows_missing");
    expect(stderr.join(" ")).toContain("direct_tests_missing");
    expect(stderr.join(" ")).toContain("type_only_exemption_invalid");
  });

  test("surfaces malformed manifest inputs and boundary conditions with stable status codes", async () => {
    const trackedFiles = buildTrackedFiles();
    const duplicateManifest = await evaluateM060S01CoverageContract({
      readTextFile: async (filePath: string) => {
        const normalized = filePath.replace(/\\/g, "/");
        const relative = normalized.replace(/^.*?(package\.json|scripts\/REGISTRY\.md|src\/knowledge\/.*)$/u, "$1");
        const value = buildSourceMap()[relative];
        if (value != null) return value;
        throw new Error(`Unexpected path: ${filePath}`);
      },
      listTrackedFiles: async () => trackedFiles,
      fileExists: buildFileExists(trackedFiles),
      loadManifest: async () => ({
        runtimeTargets: [...PASSING_RUNTIME_TARGETS, "src/knowledge/isolation.ts"],
        typeOnlyExemptions: PASSING_TYPE_ONLY_EXEMPTIONS,
      }),
    });

    expect(duplicateManifest.checks[2]).toEqual(
      expect.objectContaining({
        id: "M060-S01-RUNTIME-TARGET-MANIFEST",
        passed: false,
        status_code: "runtime_target_duplicate_entries",
      }),
    );

    const outsideScopeManifest = await evaluateM060S01CoverageContract({
      readTextFile: async (filePath: string) => {
        const normalized = filePath.replace(/\\/g, "/");
        const relative = normalized.replace(/^.*?(package\.json|scripts\/REGISTRY\.md|src\/knowledge\/.*)$/u, "$1");
        const value = buildSourceMap()[relative];
        if (value != null) return value;
        throw new Error(`Unexpected path: ${filePath}`);
      },
      listTrackedFiles: async () => trackedFiles,
      fileExists: buildFileExists(trackedFiles),
      loadManifest: async () => ({
        runtimeTargets: PASSING_RUNTIME_TARGETS,
        typeOnlyExemptions: ["scripts/verify-m060-s01.ts"],
      }),
    });

    expect(outsideScopeManifest.checks[4]).toEqual(
      expect.objectContaining({
        id: "M060-S01-TYPE-ONLY-EXEMPTIONS",
        passed: false,
        status_code: "type_only_exemption_outside_scope",
      }),
    );

    const emptyLists = await evaluateM060S01CoverageContract({
      readTextFile: async (filePath: string) => {
        const normalized = filePath.replace(/\\/g, "/");
        const relative = normalized.replace(/^.*?(package\.json|scripts\/REGISTRY\.md|src\/knowledge\/.*)$/u, "$1");
        const value = buildSourceMap()[relative];
        if (value != null) return value;
        throw new Error(`Unexpected path: ${filePath}`);
      },
      listTrackedFiles: async () => trackedFiles,
      fileExists: buildFileExists(trackedFiles),
      loadManifest: async () => ({ runtimeTargets: [], typeOnlyExemptions: [] }),
    });

    expect(emptyLists.checks[2]).toEqual(
      expect.objectContaining({
        id: "M060-S01-RUNTIME-TARGET-MANIFEST",
        passed: false,
        status_code: "runtime_targets_incomplete",
      }),
    );
    expect(emptyLists.checks[4]).toEqual(
      expect.objectContaining({
        id: "M060-S01-TYPE-ONLY-EXEMPTIONS",
        passed: false,
        status_code: "type_only_exemptions_incomplete",
      }),
    );
  });

  test("flags malformed package json, unreadable tracked-file state, and exemption files that gain direct tests", async () => {
    const trackedFiles = buildTrackedFiles();
    const malformedPackage = await evaluateM060S01CoverageContract({
      readTextFile: async (filePath: string) => {
        const normalized = filePath.replace(/\\/g, "/");
        const relative = normalized.replace(/^.*?(package\.json|scripts\/REGISTRY\.md|src\/knowledge\/.*)$/u, "$1");
        const map = buildSourceMap({ "package.json": "{ not valid json" });
        const value = map[relative];
        if (value != null) return value;
        throw new Error(`Unexpected path: ${filePath}`);
      },
      listTrackedFiles: async () => trackedFiles,
      fileExists: buildFileExists(trackedFiles),
      loadManifest: async () => ({
        runtimeTargets: PASSING_RUNTIME_TARGETS,
        typeOnlyExemptions: PASSING_TYPE_ONLY_EXEMPTIONS,
      }),
    });

    expect(malformedPackage.checks[0]).toEqual(
      expect.objectContaining({ id: "M060-S01-PACKAGE-WIRING", passed: false, status_code: "package_json_invalid" }),
    );

    const unreadableTracked = await evaluateM060S01CoverageContract({
      readTextFile: async (filePath: string) => {
        const normalized = filePath.replace(/\\/g, "/");
        const relative = normalized.replace(/^.*?(package\.json|scripts\/REGISTRY\.md|src\/knowledge\/.*)$/u, "$1");
        const value = buildSourceMap()[relative];
        if (value != null) return value;
        throw new Error(`Unexpected path: ${filePath}`);
      },
      listTrackedFiles: async () => {
        throw new Error("git ls-files failed");
      },
      fileExists: async () => false,
      loadManifest: async () => ({
        runtimeTargets: PASSING_RUNTIME_TARGETS,
        typeOnlyExemptions: PASSING_TYPE_ONLY_EXEMPTIONS,
      }),
    });

    expect(unreadableTracked.checks[2]).toEqual(
      expect.objectContaining({ id: "M060-S01-RUNTIME-TARGET-MANIFEST", passed: false, status_code: "tracked_files_unreadable" }),
    );
    expect(unreadableTracked.checks[3]).toEqual(
      expect.objectContaining({ id: "M060-S01-DIRECT-TEST-COVERAGE", passed: false, status_code: "direct_tests_missing" }),
    );

    const exemptionTrackedFiles = buildTrackedFiles({ includeTestsForExemptions: ["src/knowledge/types.ts"] });
    const exemptionHasTest = await evaluateM060S01CoverageContract({
      readTextFile: async (filePath: string) => {
        const normalized = filePath.replace(/\\/g, "/");
        const relative = normalized.replace(/^.*?(package\.json|scripts\/REGISTRY\.md|src\/knowledge\/.*)$/u, "$1");
        const value = buildSourceMap()[relative];
        if (value != null) return value;
        throw new Error(`Unexpected path: ${filePath}`);
      },
      listTrackedFiles: async () => exemptionTrackedFiles,
      fileExists: buildFileExists(exemptionTrackedFiles),
      loadManifest: async () => ({
        runtimeTargets: PASSING_RUNTIME_TARGETS,
        typeOnlyExemptions: PASSING_TYPE_ONLY_EXEMPTIONS,
      }),
    });

    expect(exemptionHasTest.checks[4]).toEqual(
      expect.objectContaining({
        id: "M060-S01-TYPE-ONLY-EXEMPTIONS",
        passed: false,
        status_code: "type_only_exemption_has_direct_test",
      }),
    );
  });

  test("wires the canonical package script", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["verify:m060:s01"]).toBe("bun scripts/verify-m060-s01.ts");
  });
});
