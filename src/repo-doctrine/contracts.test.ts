import { describe, expect, test } from "bun:test";
import {
  normalizeRepoDoctrineProjection,
  redactDoctrineText,
  REPO_DOCTRINE_LIMITS,
  type RepoDoctrineConfig,
} from "./contracts.ts";

const baseContract = {
  id: "api-public-contract",
  type: "api-compatibility" as const,
  paths: ["src/api/**"],
  severity: "major" as const,
  category: "correctness" as const,
  instructions: "Preserve public API compatibility unless migration evidence is present.",
  evidence: "Show compatibility notes or migration evidence.",
};

describe("repo doctrine public projection", () => {
  test("disabled doctrine projects only disabled aggregate status", () => {
    const projection = normalizeRepoDoctrineProjection({
      enabled: false,
      contracts: [baseContract],
    });

    expect(projection.enabled).toBe(false);
    expect(projection.status).toBe("disabled");
    expect(projection.contracts).toEqual([]);
    expect(projection.reasonCodes).toEqual(["disabled"]);
  });

  test("valid contracts project stable IDs, type coverage, and bounded path candidates without raw instructions", () => {
    const projection = normalizeRepoDoctrineProjection({
      enabled: true,
      contracts: [
        baseContract,
        {
          ...baseContract,
          id: "docs-public-contract",
          type: "docs-update",
          paths: ["docs/**"],
          severity: "minor",
          category: "documentation",
          instructions: "Update docs for user-visible behavior changes.",
          evidence: "Show corresponding docs changes.",
        },
      ],
    }, ["src/api/routes.ts", "docs/api.md", "README.md"]);

    expect(projection.status).toBe("active");
    expect(projection.contractCount).toBe(2);
    expect(projection.consumedContractCount).toBe(2);
    expect(projection.omittedContractCount).toBe(0);
    expect(projection.typeCoverage).toEqual({
      "api-compatibility": 1,
      "docs-update": 1,
    });
    expect(projection.contracts.map((contract) => contract.id)).toEqual([
      "api-public-contract",
      "docs-public-contract",
    ]);
    expect(projection.matchedPathCandidates).toEqual(["src/api/routes.ts", "docs/api.md"]);
    expect(JSON.stringify(projection)).not.toContain("Preserve public API compatibility");
    expect(JSON.stringify(projection)).not.toContain("Show corresponding docs changes");
  });

  test("duplicate and empty IDs are omitted with reason codes", () => {
    const projection = normalizeRepoDoctrineProjection({
      enabled: true,
      contracts: [
        baseContract,
        { ...baseContract, id: "api-public-contract", type: "migration" },
        { ...baseContract, id: "   ", type: "tracing" },
      ],
    });

    expect(projection.consumedContractCount).toBe(1);
    expect(projection.omittedContractCount).toBe(2);
    expect(projection.reasonCodes).toContain("duplicate-id");
    expect(projection.reasonCodes).toContain("empty-id");
  });

  test("oversized instructions and glob abuse are bounded before projection growth", () => {
    const projection = normalizeRepoDoctrineProjection({
      enabled: true,
      contracts: [
        {
          ...baseContract,
          id: "too-large",
          instructions: "x".repeat(REPO_DOCTRINE_LIMITS.maxInstructionLength + 1),
        },
        {
          ...baseContract,
          id: "too-many-globs",
          paths: Array.from({ length: REPO_DOCTRINE_LIMITS.maxPathGlobsPerContract + 4 }, (_, index) => `src/${index}/**`),
        },
      ],
    }, ["src/0/a.ts", "src/10/a.ts"]);

    expect(projection.consumedContractCount).toBe(1);
    expect(projection.omittedContractCount).toBe(1);
    expect(projection.reasonCodes).toContain("oversized-instruction");
    expect(projection.reasonCodes).toContain("too-many-globs");
    expect(projection.matchedPathCandidates).toEqual(["src/0/a.ts"]);
  });

  test("too many contracts and matched paths are capped with omitted counts", () => {
    const config: RepoDoctrineConfig = {
      enabled: true,
      contracts: Array.from({ length: REPO_DOCTRINE_LIMITS.maxContracts + 5 }, (_, index) => ({
        ...baseContract,
        id: `contract-${index}`,
        paths: ["src/**"],
      })),
    };
    const changedPaths = Array.from({ length: REPO_DOCTRINE_LIMITS.maxMatchedPathCandidates + 3 }, (_, index) => `src/file-${index}.ts`);

    const projection = normalizeRepoDoctrineProjection(config, changedPaths);

    expect(projection.consumedContractCount).toBe(REPO_DOCTRINE_LIMITS.maxContracts);
    expect(projection.omittedContractCount).toBe(5);
    expect(projection.matchedPathCandidates).toHaveLength(REPO_DOCTRINE_LIMITS.maxMatchedPathCandidates);
    expect(projection.omittedMatchedPathCandidateCount).toBeGreaterThan(0);
    expect(projection.reasonCodes).toContain("too-many-contracts");
    expect(projection.reasonCodes).toContain("matched-path-candidates-truncated");
  });

  test("path patterns matching no changed files are reported without omitting the contract", () => {
    const projection = normalizeRepoDoctrineProjection({
      enabled: true,
      contracts: [baseContract],
    }, ["README.md"]);

    expect(projection.consumedContractCount).toBe(1);
    expect(projection.matchedPathCandidates).toEqual([]);
    expect(projection.reasonCodes).toContain("unmatched-paths");
  });

  test("redaction helper strips canary secrets before any public string use", () => {
    const redacted = redactDoctrineText("token=ghp_123456789012345678901234 and email ops@example.com");

    expect(redacted.redacted).toBe(true);
    expect(redacted.text).toContain("[redacted]");
    expect(redacted.text).not.toContain("ghp_123456789012345678901234");
    expect(redacted.text).not.toContain("ops@example.com");
    expect(redacted.reasonCodes).toEqual(["redaction-applied"]);
  });

  test("secret canary text in doctrine produces only a reason code in projection", () => {
    const projection = normalizeRepoDoctrineProjection({
      enabled: true,
      contracts: [{
        ...baseContract,
        instructions: "Never leak token=ghp_123456789012345678901234 in output.",
      }],
    });

    expect(projection.reasonCodes).toContain("redaction-applied");
    expect(JSON.stringify(projection)).not.toContain("ghp_123456789012345678901234");
    expect(JSON.stringify(projection)).not.toContain("Never leak token");
  });
});
