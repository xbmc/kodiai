import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  M045_S03_CHECK_IDS,
  buildM045S03ProofHarness,
  buildM045S03RetrievalFixtures,
  evaluateM045S03,
} from "./verify-m045-s03.ts";

describe("evaluateM045S03", () => {
  test("embeds the full S01 report and passes retrieval drift checks for the default fixture matrix", async () => {
    const report = await evaluateM045S03();

    expect(report.command).toBe("verify:m045:s03");
    expect(report.check_ids).toEqual([...M045_S03_CHECK_IDS]);
    expect(report.overallPassed).toBe(true);
    expect(report.githubReview).not.toBeNull();
    if (!report.githubReview) {
      throw new Error("expected embedded S01 report");
    }
    expect(report.githubReview.command).toBe("verify:m045:s01");
    expect(report.githubReview.checks).toHaveLength(report.githubReview.check_ids.length);
    expect(report.githubReview.overallPassed).toBe(true);
    expect(report.githubReview.scenarios.map((scenario) => scenario.scenarioId)).toEqual([
      "profile-backed",
      "coarse-fallback",
      "generic-unknown",
      "generic-opt-out",
      "generic-degraded",
    ]);
    expect(report.retrieval.scenarios.map((scenario) => scenario.scenarioId)).toEqual([
      "profile-backed",
      "coarse-fallback",
      "generic-unknown",
      "generic-opt-out",
      "generic-degraded",
    ]);
    expect(report.retrieval.scenarios[0]?.multiQuery.query).toContain("author: established contributor");
    expect(report.retrieval.scenarios[0]?.legacyQuery.query).toContain("Author: established contributor");
    expect(report.retrieval.scenarios[1]?.multiQuery.query).toContain("author: returning contributor");
    expect(report.retrieval.scenarios[2]?.multiQuery.query).not.toContain("author:");
    expect(report.retrieval.scenarios[2]?.legacyQuery.query).not.toContain("Author:");
    expect(report.checks.map((check) => check.id)).toEqual([...M045_S03_CHECK_IDS]);
    expect(report.checks.every((check) => check.passed)).toBe(true);
  });

  test("records named diagnostics when retrieval fixtures drift to blank or contributor-leaking queries", async () => {
    const fixtures = buildM045S03RetrievalFixtures().map((fixture) => {
      if (fixture.scenarioId !== "profile-backed") {
        return fixture;
      }

      return {
        ...fixture,
        multiQueryInput: {
          ...fixture.multiQueryInput,
          title: "   ",
          body: "",
          conventionalType: null,
          authorHint: "   ",
          prLanguages: [],
          riskSignals: [],
          filePaths: [],
        },
        legacySignals: {
          ...fixture.legacySignals,
          prTitle: "   ",
          prBody: "",
          conventionalType: null,
          authorHint: "   ",
          detectedLanguages: [],
          riskSignals: [],
          topFilePaths: [],
        },
      };
    });

    const report = await evaluateM045S03({
      _retrievalFixtures: fixtures,
    });

    expect(report.overallPassed).toBe(false);
    expect(
      report.checks.find((check) => check.id === "M045-S03-RETRIEVAL-MULTI-QUERY-CONTRACT")?.status_code,
    ).toBe("retrieval_multi_query_contract_drift");
    expect(
      report.checks.find((check) => check.id === "M045-S03-RETRIEVAL-LEGACY-QUERY-CONTRACT")?.status_code,
    ).toBe("retrieval_legacy_query_contract_drift");
    expect(
      report.retrieval.scenarios.find((scenario) => scenario.scenarioId === "profile-backed")?.multiQuery.detail,
    ).toContain("query text was empty");
    expect(
      report.retrieval.scenarios.find((scenario) => scenario.scenarioId === "profile-backed")?.legacyQuery.detail,
    ).toContain("query text was empty");
    expect(
      report.retrieval.scenarios.find((scenario) => scenario.scenarioId === "profile-backed")?.multiQuery.missingPhrases,
    ).toContain("author: established contributor");
    expect(
      report.retrieval.scenarios.find((scenario) => scenario.scenarioId === "profile-backed")?.legacyQuery.missingPhrases,
    ).toContain("Author: established contributor");
  });
});

describe("buildM045S03ProofHarness", () => {
  test("emits json output, wires the package script, and exits non-zero when a retrieval check fails", async () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["verify:m045:s03"]).toBe("bun scripts/verify-m045-s03.ts");

    const stdout: string[] = [];
    const stderr: string[] = [];

    const { exitCode } = await buildM045S03ProofHarness({
      stdout: { write: (chunk) => void stdout.push(chunk) },
      stderr: { write: (chunk) => void stderr.push(chunk) },
      json: true,
      _retrievalFixtures: buildM045S03RetrievalFixtures().map((fixture) =>
        fixture.scenarioId === "generic-unknown"
          ? {
              ...fixture,
              legacySignals: {
                ...fixture.legacySignals,
                authorHint: "senior contributor",
              },
            }
          : fixture
      ),
    });

    const parsed = JSON.parse(stdout.join(""));
    expect(parsed.command).toBe("verify:m045:s03");
    expect(parsed.githubReview.command).toBe("verify:m045:s01");
    expect(parsed.retrieval.scenarios.find((scenario: { scenarioId: string }) => scenario.scenarioId === "generic-unknown")?.legacyQuery.unexpectedPhrases).toContain(
      "Author:",
    );
    expect(stderr.join("")).toContain("M045-S03-RETRIEVAL-LEGACY-QUERY-CONTRACT:retrieval_legacy_query_contract_drift");
    expect(exitCode).toBe(1);
  });
});
