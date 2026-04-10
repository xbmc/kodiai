import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

type SnapshotModule = {
  assertValidXbmcFixtureSnapshot?: (value: unknown) => any;
};

type CalibrationModule = {
  evaluateCalibrationSnapshot?: (
    snapshot: any,
    options?: { referenceTime?: string | Date },
  ) => {
    recommendation: {
      verdict: "keep" | "retune" | "replace";
      rationale: string[];
    };
  };
};

type ContractInventoryEntry = {
  appliesTo: readonly ("keep" | "retune" | "replace")[];
  bucket: "keep" | "change" | "replace";
  mechanism: string;
  summary: string;
  rationale: string;
  evidence: readonly string[];
  impactedSurfaces: readonly string[];
};

type ContractModule = {
  buildCalibrationChangeContract?: (
    recommendation: {
      verdict?: unknown;
      rationale?: unknown;
    },
    options?: {
      inventory?: readonly ContractInventoryEntry[];
    },
  ) => {
    verdict: "keep" | "retune" | "replace";
    rationale: string[];
    keep: Array<{
      mechanism: string;
      summary: string;
      rationale: string;
      evidence: string[];
      impactedSurfaces: string[];
    }>;
    change: Array<{
      mechanism: string;
      summary: string;
      rationale: string;
      evidence: string[];
      impactedSurfaces: string[];
    }>;
    replace: Array<{
      mechanism: string;
      summary: string;
      rationale: string;
      evidence: string[];
      impactedSurfaces: string[];
    }>;
  };
  CalibrationChangeContractError?: new (
    message: string,
    code: string,
  ) => Error & { code: string };
};

const importModule = new Function(
  "specifier",
  "return import(specifier)",
) as (specifier: string) => Promise<unknown>;

async function loadSnapshotModule(): Promise<SnapshotModule | null> {
  return (await importModule("./xbmc-fixture-snapshot.ts").catch(
    () => null,
  )) as SnapshotModule | null;
}

async function loadCalibrationModule(): Promise<CalibrationModule | null> {
  return (await importModule("./calibration-evaluator.ts").catch(
    () => null,
  )) as CalibrationModule | null;
}

async function loadContractModule(): Promise<ContractModule | null> {
  return (await importModule("./calibration-change-contract.ts").catch(
    () => null,
  )) as ContractModule | null;
}

async function readJsonFixture(relativePath: string): Promise<any> {
  const file = new URL(`../../${relativePath}`, import.meta.url);
  return JSON.parse(await readFile(file, "utf8"));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function expectContractError(
  fn: () => unknown,
  expectedCode: string,
): void {
  try {
    fn();
    throw new Error(`Expected CalibrationChangeContractError(${expectedCode})`);
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error & { code?: string }).code).toBe(expectedCode);
  }
}

function buildValidReplaceRecommendation(): {
  verdict: "replace";
  rationale: string[];
} {
  return {
    verdict: "replace",
    rationale: [
      "The live incremental path compresses the retained cohort into the same unscored outcome because the snapshot cannot replay changed-file arrays honestly.",
      "The full-signal model differentiates fuzzard, koprajs from the live incremental path instead of leaving them all at the newcomer default.",
      "Freshness caveats remain for fkoemep, so snapshot-based calibration still needs explicit degradation reporting.",
    ],
  };
}

describe("calibration change contract", () => {
  test("exports a pure helper and typed contract error", async () => {
    const contractModule = await loadContractModule();

    expect(contractModule).not.toBeNull();
    if (!contractModule) {
      return;
    }

    expect(typeof contractModule.buildCalibrationChangeContract).toBe("function");
    expect(typeof contractModule.CalibrationChangeContractError).toBe("function");
  });

  test("derives the current replace contract from the checked-in calibration recommendation with stable bucket inventory, evidence, and impacted surfaces", async () => {
    const snapshotModule = await loadSnapshotModule();
    const calibrationModule = await loadCalibrationModule();
    const contractModule = await loadContractModule();

    expect(snapshotModule).not.toBeNull();
    expect(calibrationModule).not.toBeNull();
    expect(contractModule).not.toBeNull();
    if (
      !snapshotModule?.assertValidXbmcFixtureSnapshot ||
      !calibrationModule?.evaluateCalibrationSnapshot ||
      !contractModule?.buildCalibrationChangeContract
    ) {
      return;
    }

    const snapshot = snapshotModule.assertValidXbmcFixtureSnapshot(
      await readJsonFixture("fixtures/contributor-calibration/xbmc-snapshot.json"),
    );
    const calibration = calibrationModule.evaluateCalibrationSnapshot(
      clone(snapshot),
      {
        referenceTime: "2026-04-10T20:42:03.000Z",
      },
    );

    const contract = contractModule.buildCalibrationChangeContract(
      calibration.recommendation,
    );

    expect(contract).toEqual({
      verdict: "replace",
      rationale: calibration.recommendation.rationale,
      keep: [
        {
          mechanism: "m045-contributor-experience-contract-vocabulary",
          summary:
            "Keep the M045 contributor-experience contract vocabulary as the durable interface for prompt and profile projections.",
          rationale:
            "The replace verdict targets calibration and scoring internals, not the public contributor-experience states already introduced in M045.",
          evidence: [
            "src/contributor/experience-contract.ts already defines stable `profile-backed`, `coarse-fallback`, and generic contributor-experience states.",
            "src/contributor/experience-contract.ts already projects prompt and Slack guidance from that vocabulary without depending on calibration-specific score math.",
          ],
          impactedSurfaces: [
            "src/contributor/experience-contract.ts::projectContributorExperienceContract",
            "src/contributor/experience-contract.ts::buildContributorExperiencePromptSection",
          ],
        },
      ],
      change: [
        {
          mechanism: "stored-tier-consumer-surfaces",
          summary:
            "Change review and Slack consumers to read the future M047 contract without changing their outward contributor-guidance surfaces.",
          rationale:
            "These consumers should survive M047, but they must stop trusting today’s stored tier inputs as the source of truth for contributor guidance.",
          evidence: [
            "src/handlers/review.ts currently derives review behavior from stored contributor tiers via `projectContributorExperienceContract(...)` and preserves coarse-fallback cache behavior.",
            "src/slack/slash-command-handler.ts formats linked-profile status from `profile.overallTier` through `resolveContributorExperienceSlackProfileProjection(...)`.",
          ],
          impactedSurfaces: [
            "src/handlers/review.ts::resolveAuthorTier",
            "src/slack/slash-command-handler.ts::formatProfileCard",
            "src/contributor/experience-contract.ts::resolveContributorExperienceSlackProfileProjection",
          ],
        },
      ],
      replace: [
        {
          mechanism: "live-incremental-pr-authored-scoring",
          summary:
            "Replace the live incremental `pr_authored`-only contributor scoring path with the M047 full-signal calibration contract.",
          rationale:
            "S02’s replace recommendation is driven by the live path collapsing retained contributors into the newcomer default while the intended full-signal model separates them.",
          evidence: [
            "src/handlers/review.ts only emits incremental expertise updates for `type: \"pr_authored\"`, which matches the S02 live-path compression finding.",
            "The S02 recommendation reports that the full-signal model differentiates retained contributors beyond the live newcomer default.",
          ],
          impactedSurfaces: [
            "src/handlers/review.ts::updateExpertiseIncremental(type=pr_authored)",
          ],
        },
      ],
    });

    expect(contract.keep).not.toHaveLength(0);
    expect(contract.change).not.toHaveLength(0);
    expect(contract.replace).not.toHaveLength(0);
  });

  test("pins the source seam markers that ground the contract in current runtime code paths", async () => {
    const experienceContractSource = await readFile(
      new URL("./experience-contract.ts", import.meta.url),
      "utf8",
    );
    const reviewHandlerSource = await readFile(
      new URL("../handlers/review.ts", import.meta.url),
      "utf8",
    );
    const slashHandlerSource = await readFile(
      new URL("../slack/slash-command-handler.ts", import.meta.url),
      "utf8",
    );

    expect(experienceContractSource).toContain('state: "profile-backed"');
    expect(experienceContractSource).toContain('state: "coarse-fallback"');
    expect(experienceContractSource).toContain(
      'text: "profile-backed (using linked contributor profile guidance)"',
    );
    expect(reviewHandlerSource).toContain(
      'const contract = projectContributorExperienceContract({',
    );
    expect(reviewHandlerSource).toContain('contract.state === "coarse-fallback"');
    expect(reviewHandlerSource).toContain('type: "pr_authored"');
    expect(slashHandlerSource).toContain(
      "resolveContributorExperienceSlackProfileProjection",
    );
    expect(slashHandlerSource).toContain("profile.overallTier");
  });

  test("fails fast on missing verdict, empty rationale, and unsupported verdicts", async () => {
    const contractModule = await loadContractModule();

    expect(contractModule).not.toBeNull();
    if (!contractModule?.buildCalibrationChangeContract) {
      return;
    }

    expectContractError(
      () => contractModule.buildCalibrationChangeContract!({
        rationale: ["replace the live path"],
      }),
      "missing-recommendation-verdict",
    );
    expectContractError(
      () => contractModule.buildCalibrationChangeContract!({
        verdict: "replace",
        rationale: [],
      }),
      "missing-recommendation-rationale",
    );
    expectContractError(
      () => contractModule.buildCalibrationChangeContract!({
        verdict: "unsupported",
        rationale: ["replace the live path"],
      }),
      "unsupported-recommendation-verdict",
    );
  });

  test("fails fast when an active entry omits impacted surfaces", async () => {
    const contractModule = await loadContractModule();

    expect(contractModule).not.toBeNull();
    if (!contractModule?.buildCalibrationChangeContract) {
      return;
    }

    expectContractError(
      () =>
        contractModule.buildCalibrationChangeContract!(
          buildValidReplaceRecommendation(),
          {
            inventory: [
              {
                appliesTo: ["replace"],
                bucket: "replace",
                mechanism: "live-incremental-pr-authored-scoring",
                summary: "Replace the live path.",
                rationale: "The live path compresses the cohort.",
                evidence: ["review.ts still emits pr_authored-only updates."],
                impactedSurfaces: [],
              },
            ],
          },
        ),
      "missing-impacted-surface",
    );
  });

  test("fails fast on duplicate mechanisms inside one bucket and contradictory bucket assignments across buckets", async () => {
    const contractModule = await loadContractModule();

    expect(contractModule).not.toBeNull();
    if (!contractModule?.buildCalibrationChangeContract) {
      return;
    }

    expectContractError(
      () =>
        contractModule.buildCalibrationChangeContract!(
          buildValidReplaceRecommendation(),
          {
            inventory: [
              {
                appliesTo: ["replace"],
                bucket: "change",
                mechanism: "stored-tier-consumer-surfaces",
                summary: "Change stored-tier consumers.",
                rationale: "Consumers should read the new contract.",
                evidence: ["review.ts currently reads stored tiers."],
                impactedSurfaces: ["src/handlers/review.ts::resolveAuthorTier"],
              },
              {
                appliesTo: ["replace"],
                bucket: "change",
                mechanism: "stored-tier-consumer-surfaces",
                summary: "Change stored-tier consumers again.",
                rationale: "Duplicate inventory should fail.",
                evidence: ["slash-command-handler.ts still reads profile.overallTier."],
                impactedSurfaces: ["src/slack/slash-command-handler.ts::formatProfileCard"],
              },
            ],
          },
        ),
      "duplicate-mechanism",
    );

    expectContractError(
      () =>
        contractModule.buildCalibrationChangeContract!(
          buildValidReplaceRecommendation(),
          {
            inventory: [
              {
                appliesTo: ["replace"],
                bucket: "keep",
                mechanism: "m045-contributor-experience-contract-vocabulary",
                summary: "Keep the M045 vocabulary.",
                rationale: "The public contract stays.",
                evidence: ["experience-contract.ts keeps stable states."],
                impactedSurfaces: [
                  "src/contributor/experience-contract.ts::projectContributorExperienceContract",
                ],
              },
              {
                appliesTo: ["replace"],
                bucket: "replace",
                mechanism: "m045-contributor-experience-contract-vocabulary",
                summary: "Replace the same mechanism.",
                rationale: "Contradictory inventory should fail.",
                evidence: ["contradictory bucket assignment"],
                impactedSurfaces: [
                  "src/contributor/experience-contract.ts::projectContributorExperienceContract",
                ],
              },
            ],
          },
        ),
      "contradictory-mechanism-bucket",
    );
  });
});
