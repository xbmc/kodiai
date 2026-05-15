import { describe, expect, test } from "bun:test";
import type { RepoConfig } from "../execution/config.ts";
import {
  graphValidationAppliedRuntimeStatus,
  graphValidationGateForReviewPlan,
  graphValidationSkippedRuntimeStatus,
  graphValidationThrownRuntimeStatus,
  resolveGraphValidationPreStatus,
} from "./graph-validation-status.ts";
import type { GraphValidationFinding, GraphValidationResult } from "./validation.ts";

function configWithGraphValidation(enabled: boolean): Pick<RepoConfig, "review"> {
  return {
    review: {
      graphValidation: {
        enabled,
        maxFindingsToValidate: 7,
        contextMaxChars: 700,
      },
    } as RepoConfig["review"],
  };
}

function validationResult(overrides: Partial<GraphValidationResult<GraphValidationFinding>> = {}): GraphValidationResult<GraphValidationFinding> {
  return {
    findings: [],
    validatedCount: 2,
    confirmedCount: 1,
    uncertainCount: 1,
    succeeded: true,
    ...overrides,
  };
}

describe("graph validation status", () => {
  test("maps disabled config to skipped pre-state and ReviewPlan gate", () => {
    const status = resolveGraphValidationPreStatus({
      config: configWithGraphValidation(false),
      graphContextAvailable: true,
    });

    expect(status).toEqual({
      gate: "graph-validation",
      status: "skipped",
      reason: "config-disabled",
      enabled: false,
      graphContextAvailable: true,
    });
    expect(graphValidationGateForReviewPlan(status)).toEqual({
      name: "graph-validation",
      status: "skipped",
      reason: "config-disabled",
    });
  });

  test("maps enabled config without graph context to unavailable", () => {
    const status = resolveGraphValidationPreStatus({
      config: configWithGraphValidation(true),
      graphContextAvailable: false,
    });

    expect(status).toEqual({
      gate: "graph-validation",
      status: "unavailable",
      reason: "graph-context-unavailable",
      enabled: true,
      graphContextAvailable: false,
    });
  });

  test("maps enabled config with graph context to enabled pre-state", () => {
    const status = resolveGraphValidationPreStatus({
      config: configWithGraphValidation(true),
      graphContextAvailable: true,
    });

    expect(status).toEqual({
      gate: "graph-validation",
      status: "enabled",
      reason: "graph-context-available",
      enabled: true,
      graphContextAvailable: true,
    });
  });

  test("returns bounded runtime skipped and unavailable statuses", () => {
    expect(graphValidationSkippedRuntimeStatus({
      config: configWithGraphValidation(false),
      graphContextAvailable: true,
      findingCount: 3,
    })).toEqual({
      gate: "graph-validation",
      gateResult: "skipped",
      reason: "config-disabled",
      enabled: false,
      graphContextAvailable: true,
      findingCount: 3,
    });

    expect(graphValidationSkippedRuntimeStatus({
      config: configWithGraphValidation(true),
      graphContextAvailable: false,
      findingCount: 3,
    })).toEqual({
      gate: "graph-validation",
      gateResult: "unavailable",
      reason: "graph-context-unavailable",
      enabled: true,
      graphContextAvailable: false,
      findingCount: 3,
    });
  });

  test("returns null skipped runtime status when validation should run", () => {
    expect(graphValidationSkippedRuntimeStatus({
      config: configWithGraphValidation(true),
      graphContextAvailable: true,
      findingCount: 3,
    })).toBeNull();
  });

  test("maps validator results to applied, no-op, and failure runtime statuses", () => {
    expect(graphValidationAppliedRuntimeStatus({
      result: validationResult(),
      findingCount: 5,
    })).toEqual({
      gate: "graph-validation",
      gateResult: "applied",
      reason: "validation-applied",
      enabled: true,
      graphContextAvailable: true,
      findingCount: 5,
      validatedCount: 2,
      confirmedCount: 1,
      uncertainCount: 1,
    });

    expect(graphValidationAppliedRuntimeStatus({
      result: validationResult({ validatedCount: 0, confirmedCount: 0, uncertainCount: 0 }),
      findingCount: 5,
    })).toMatchObject({
      gate: "graph-validation",
      gateResult: "skipped",
      reason: "no-findings-validated",
      validatedCount: 0,
    });

    expect(graphValidationAppliedRuntimeStatus({
      result: validationResult({ succeeded: false, errorMessage: "private error" }),
      findingCount: 5,
    })).toMatchObject({
      gate: "graph-validation",
      gateResult: "failure",
      reason: "validation-failed",
      findingCount: 5,
    });
  });

  test("maps thrown validator failures without raw error content", () => {
    expect(graphValidationThrownRuntimeStatus({ findingCount: 4 })).toEqual({
      gate: "graph-validation",
      gateResult: "failure",
      reason: "validation-threw",
      enabled: true,
      graphContextAvailable: true,
      findingCount: 4,
    });
  });
});
