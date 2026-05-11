import { describe, expect, test } from "bun:test";

import {
  M069_S02_CHECK_IDS,
  evaluateM069S02Contract,
  main,
  parseM069S02Args,
} from "./verify-m069-s02.ts";

const PASSING_PACKAGE_JSON = JSON.stringify({
  scripts: {
    "verify:m069:s02": "bun scripts/verify-m069-s02.ts",
  },
});

const PASSING_HANDLER = `
import {
  runShadowSpecialistSubflow,
  type ShadowSpecialistSubflowInput,
  type ShadowSpecialistSubflowResult,
} from "../specialists/shadow-specialist-subflow.ts";

type Deps = {
  shadowSpecialistSubflow?: (input: ShadowSpecialistSubflowInput) => Promise<ShadowSpecialistSubflowResult>;
};

function buildShadowSpecialistLogFields(result: ShadowSpecialistSubflowResult) {
  return {
    gate: "shadow-specialist",
    candidateCount: result.candidateCount,
    decisionCount: result.decisionCount,
    duplicateCount: result.duplicateCount,
    disagreementCount: result.disagreementCount,
    tokenCountAvailable: result.metricAvailability.tokenCount,
    costAvailable: result.metricAvailability.costUsd,
    latencyMsAvailable: result.metricAvailability.latencyMs,
    discardedPublicationFields: result.redactionFlags.discardedPublicationFields,
  };
}

async function handle(deps: Deps, allChangedFiles: string[], diffContext: { diffContent: string }, workspace: { dir: string }, event: { id: string }, reviewOutputKey: string) {
  const { shadowSpecialistSubflow = runShadowSpecialistSubflow } = deps;
  const changedFiles = allChangedFiles.filter(Boolean);
  try {
    const result = await shadowSpecialistSubflow({
      changedPaths: changedFiles,
      diffText: diffContext.diffContent,
      diffSnippet: diffContext.diffContent,
      workspaceDir: workspace.dir,
      deliveryId: event.id,
      reviewOutputKey,
    });
    buildShadowSpecialistLogFields(result);
  } catch {
    console.warn("handler-subflow-error", "Shadow specialist subflow failed before normal review; continuing fail-open");
  }
  const diffAnalysis = analyzeDiff({ changedFiles });
  return diffAnalysis;
}
`;

const PASSING_SUBFLOW = `
export type ReadOnlyShadowSpecialistRunnerInput = {
  readonly laneId: "docs-config-truth";
  readonly matchedPaths: readonly string[];
  readonly changedPaths: readonly string[];
  readonly diffText?: string | null;
  readonly diffSnippet?: string | null;
  readonly workspaceDir?: string | null;
  readonly deliveryId?: string | null;
  readonly reviewOutputKey?: string | null;
  readonly correlationKey?: string | null;
  readonly readOnly: true;
};

export type ShadowSpecialistSubflowResult = {
  readonly timeoutReason: "runner-timeout" | null;
  readonly errorReason: "runner-error" | null;
  readonly unclassifiableReason: "malformed-output" | null;
  readonly skipReason: "not-triggered" | null;
  readonly shadowOnly: true;
  readonly publishesFindings: false;
};

export async function runShadowSpecialistSubflow() {
  return {
    timeoutReason: "runner-timeout",
    errorReason: "runner-error",
    unclassifiableReason: "malformed-output",
    skipReason: "not-triggered",
    shadowOnly: true,
    publishesFindings: false,
    readOnly: true,
  };
}
`;

async function evaluateWithFixtures(overrides: {
  packageJsonText?: string;
  handlerText?: string;
  subflowText?: string;
} = {}) {
  return await evaluateM069S02Contract({
    generatedAt: "2026-05-10T23:00:00.000Z",
    readPackageJsonText: async () => overrides.packageJsonText ?? PASSING_PACKAGE_JSON,
    readHandlerText: async () => overrides.handlerText ?? PASSING_HANDLER,
    readSubflowText: async () => overrides.subflowText ?? PASSING_SUBFLOW,
  });
}

describe("verify-m069-s02", () => {
  test("exports stable check ids and parses only bounded CLI flags", () => {
    expect(M069_S02_CHECK_IDS).toEqual([
      "M069-S02-PACKAGE-WIRING",
      "M069-S02-HANDLER-INJECTION-SEAM",
      "M069-S02-HANDLER-ORDERING",
      "M069-S02-READ-ONLY-SUBFLOW-BOUNDARY",
      "M069-S02-FAIL-OPEN-STATUSES",
      "M069-S02-PUBLICATION-SAFETY",
    ]);
    expect(parseM069S02Args([])).toEqual({ json: false, help: false });
    expect(parseM069S02Args(["--json"])).toEqual({ json: true, help: false });
    expect(parseM069S02Args(["--help"])).toEqual({ json: false, help: true });
    expect(() => parseM069S02Args(["--fixture", ".gsd/secret.json"])).toThrow(/invalid_cli_args/);
  });

  test("passes representative package, handler wiring, read-only boundary, fail-open, and publication-safety checks", async () => {
    const report = await evaluateWithFixtures();

    expect(report).toMatchObject({
      command: "verify:m069:s02",
      generated_at: "2026-05-10T23:00:00.000Z",
      success: true,
      status_code: "m069_s02_ok",
      failing_check_id: null,
      issues: [],
      summary: {
        packageScriptWired: true,
        handlerInjectionPresent: true,
        sameJobInjectionDefaultPresent: true,
        handlerOrderingValid: true,
        readOnlyRunnerInputPresent: true,
        failOpenStatusCount: 4,
        publicationForbiddenMatchCount: 0,
        targetedTestCommandCount: 3,
        readsPlanningOrSecrets: false,
        liveServiceRequired: false,
      },
      wiring: {
        handlerImportsSubflow: true,
        handlerDependencyInjectionSeam: true,
        handlerInvokesSubflow: true,
        handlerLogsBoundedFields: true,
        handlerFailOpenCatch: true,
        invocationAfterChangedFiles: true,
        invocationBeforeReviewExecution: true,
      },
      readOnlyBoundary: {
        helperPresent: true,
        runnerInputTypePresent: true,
        runnerInputReadOnlyTrue: true,
        runnerReceivesDiffContext: true,
        runnerInputHasOctokitDependency: false,
        shadowOnlyFieldsPresent: true,
        publishesFindingsFalsePresent: true,
      },
      failOpen: {
        timeoutReasonPresent: true,
        errorReasonPresent: true,
        malformedReasonPresent: true,
        notTriggeredSkipPresent: true,
        handlerCatchContinues: true,
      },
    });
    expect(report.check_ids).toEqual(M069_S02_CHECK_IDS);
    expect(report.checks.every((check) => check.passed)).toBe(true);
    expect(report.targetedTests).toEqual([
      "bun test src/specialists/shadow-specialist-subflow.test.ts",
      "bun test src/handlers/review.test.ts",
      "bun test scripts/verify-m069-s02.test.ts",
    ]);

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("raw prompt");
    expect(serialized).not.toContain("tool payload");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("comment body");
  });

  test("fails with bounded issue when package script wiring drifts", async () => {
    const report = await evaluateWithFixtures({ packageJsonText: JSON.stringify({ scripts: {} }) });

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m069_s02_contract_failed");
    expect(report.failing_check_id).toBe("M069-S02-PACKAGE-WIRING");
    expect(report.issues.join("\n")).toContain("package.json scripts.verify:m069:s02 must equal bun scripts/verify-m069-s02.ts.");
  });

  test("fails with bounded issue when handler injection is missing", async () => {
    const report = await evaluateWithFixtures({
      handlerText: PASSING_HANDLER.replace("await shadowSpecialistSubflow({", "await skippedShadowSpecialistSubflow({"),
    });

    expect(report.success).toBe(false);
    expect(report.failing_check_id).toBe("M069-S02-HANDLER-INJECTION-SEAM");
    expect(report.issues.join("\n")).toContain("review handler must invoke shadowSpecialistSubflow with changed files and diff context.");
  });

  test("fails with bounded issue when publication-looking tools appear in the subflow boundary", async () => {
    const report = await evaluateWithFixtures({
      subflowText: `${PASSING_SUBFLOW}\nconst forbidden = "OctokitDependency";\n`,
    });

    expect(report.success).toBe(false);
    expect(report.failing_check_id).toBe("M069-S02-PUBLICATION-SAFETY");
    expect(report.summary.publicationForbiddenMatchCount).toBe(1);
    expect(report.readOnlyBoundary.forbiddenPublicationMatches).toEqual(["Octokit"]);
    expect(report.issues.join("\n")).toContain("subflow source must not wire publication tools");
  });

  test("main emits parseable JSON on pass, contract failure, and invalid args", async () => {
    const passingStdout: string[] = [];
    const passExitCode = await main(["--json"], {
      stdout: { write: (chunk: string) => void passingStdout.push(chunk) },
      stderr: { write: () => undefined },
      evaluate: async () => await evaluateWithFixtures(),
    });

    expect(passExitCode).toBe(0);
    expect(JSON.parse(passingStdout.join(""))).toMatchObject({
      command: "verify:m069:s02",
      success: true,
      status_code: "m069_s02_ok",
    });

    const failingStdout: string[] = [];
    const failExitCode = await main(["--json"], {
      stdout: { write: (chunk: string) => void failingStdout.push(chunk) },
      stderr: { write: () => undefined },
      evaluate: async () => await evaluateWithFixtures({ packageJsonText: JSON.stringify({ scripts: {} }) }),
    });

    expect(failExitCode).toBe(1);
    expect(JSON.parse(failingStdout.join(""))).toMatchObject({
      command: "verify:m069:s02",
      success: false,
      status_code: "m069_s02_contract_failed",
      failing_check_id: "M069-S02-PACKAGE-WIRING",
    });

    const invalidStdout: string[] = [];
    const invalidExitCode = await main(["--not-a-flag"], {
      stdout: { write: (chunk: string) => void invalidStdout.push(chunk) },
      stderr: { write: () => undefined },
    });

    expect(invalidExitCode).toBe(2);
    expect(JSON.parse(invalidStdout.join(""))).toMatchObject({
      command: "verify:m069:s02",
      success: false,
      status_code: "m069_s02_invalid_arg",
      issues: ["invalid_cli_args: Unknown argument: --not-a-flag"],
    });
  });
});
