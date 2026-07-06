import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import type { RepoDoctrineConfig } from "../repo-doctrine/contracts.ts";
import { resolveReviewRepoDoctrineContext } from "./review-repo-doctrine-context.ts";

function makeLogger() {
  const entries: Array<{ data: Record<string, unknown>; message: string }> = [];
  return {
    entries,
    logger: {
      info(data: Record<string, unknown>, message: string) {
        entries.push({ data, message });
      },
    } as unknown as Pick<Logger, "info">,
  };
}

const doctrineConfig: RepoDoctrineConfig = {
  enabled: true,
  contracts: [{
    id: "api-contract",
    type: "api-compatibility",
    paths: ["src/api/**"],
    severity: "major",
    category: "correctness",
    instructions: "Preserve existing API behavior.",
    evidence: "Public API compatibility contract.",
  }],
};

describe("resolveReviewRepoDoctrineContext", () => {
  test("builds bounded projections and logs the repo-doctrine gate", () => {
    const { logger, entries } = makeLogger();

    const result = resolveReviewRepoDoctrineContext({
      doctrine: doctrineConfig,
      changedFiles: ["src/api/router.ts", "README.md"],
      baseLog: { deliveryId: "delivery", prNumber: 42 },
      logger,
    });

    expect(result.repoDoctrineProjection).toMatchObject({
      enabled: true,
      status: "active",
      contractCount: 1,
      consumedContractCount: 1,
      matchedPathCandidateCount: 1,
      matchedPathCandidates: ["src/api/router.ts"],
    });
    expect(result.repoDoctrineReviewSurface).toEqual({
      status: "applied",
      contractCount: 1,
      matchedCount: 1,
      omittedCount: 0,
      reasonCodes: ["none"],
    });
    expect(entries).toEqual([
      {
        data: {
          deliveryId: "delivery",
          prNumber: 42,
          gate: "repo-doctrine",
          gateResult: "applied",
          repoDoctrineStatus: "applied",
          repoDoctrineContractCount: 1,
          repoDoctrineConsumedContractCount: 1,
          repoDoctrineMatchedPathCandidateCount: 1,
          repoDoctrineOmittedCount: 0,
          repoDoctrineReasonCodes: ["none"],
        },
        message: "Resolved bounded repository doctrine projection",
      },
    ]);
  });

  test("returns disabled surface when doctrine is disabled", () => {
    const { logger, entries } = makeLogger();

    const result = resolveReviewRepoDoctrineContext({
      doctrine: { enabled: false, contracts: [] },
      changedFiles: ["src/api/router.ts"],
      baseLog: { deliveryId: "delivery" },
      logger,
    });

    expect(result.repoDoctrineProjection).toMatchObject({
      enabled: false,
      status: "disabled",
      reasonCodes: ["disabled"],
    });
    expect(result.repoDoctrineReviewSurface).toEqual({
      status: "disabled",
      contractCount: 0,
      matchedCount: 0,
      omittedCount: 0,
      reasonCodes: ["disabled"],
    });
    expect(entries[0]?.data).toMatchObject({
      deliveryId: "delivery",
      gate: "repo-doctrine",
      gateResult: "disabled",
      repoDoctrineStatus: "disabled",
    });
  });
});
