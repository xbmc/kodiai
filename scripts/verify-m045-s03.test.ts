import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER } from "../src/contributor/profile-trust.ts";
import {
  M045_S03_CHECK_IDS,
  buildM045S03IdentityFixtures,
  buildM045S03ProofHarness,
  buildM045S03RetrievalFixtures,
  buildM045S03SlackFixtures,
  evaluateM045S03,
  renderM045S03Report,
} from "./verify-m045-s03.ts";

describe("evaluateM045S03", () => {
  test("keeps trusted Slack fixtures explicit so active linked copy depends on the current trust marker", () => {
    const fixtures = buildM045S03SlackFixtures();
    const linkedProfile = fixtures.find((fixture) => fixture.scenarioId === "linked-profile");
    const activeOptIn = fixtures.find((fixture) => fixture.scenarioId === "profile-opt-in");

    expect(linkedProfile?.profiles[0]).toMatchObject({
      trustMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
    });
    expect(activeOptIn?.profiles[0]).toMatchObject({
      trustMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
    });
  });

  test("embeds GitHub proof and passes retrieval, Slack, and identity contract checks for the default fixture matrix", async () => {
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

    expect(report.retrieval.scenarios.map((scenario) => scenario.scenarioId)).toEqual([
      "profile-backed",
      "coarse-fallback",
      "generic-unknown",
      "generic-opt-out",
      "generic-degraded",
    ]);
    expect(report.retrieval.scenarios[0]?.multiQuery.query).toContain("author: established contributor");
    expect(report.retrieval.scenarios[0]?.legacyQuery.query).toContain("Author: established contributor");
    expect(report.retrieval.scenarios[2]?.multiQuery.query).not.toContain("author:");
    expect(report.retrieval.scenarios[2]?.legacyQuery.query).not.toContain("Author:");

    expect(report.slack.scenarios.map((scenario) => scenario.scenarioId)).toEqual([
      "linked-profile",
      "opted-out-profile",
      "malformed-tier-profile",
      "profile-opt-out",
      "profile-opt-in",
      "unknown-command-help",
    ]);
    expect(report.slack.scenarios.find((scenario) => scenario.scenarioId === "linked-profile")?.text).toContain(
      "Status: Linked contributor guidance is active.",
    );
    expect(report.slack.scenarios.find((scenario) => scenario.scenarioId === "opted-out-profile")?.text).toContain(
      "You opted out of contributor-specific guidance. Kodiai will keep reviews generic until you opt back in.",
    );
    expect(report.slack.scenarios.find((scenario) => scenario.scenarioId === "opted-out-profile")?.text).not.toContain(
      "*Top Expertise:*",
    );
    expect(report.slack.scenarios.find((scenario) => scenario.scenarioId === "malformed-tier-profile")?.text).toContain(
      "Kodiai does not have a reliable contributor signal for this profile yet, so reviews stay generic.",
    );
    expect(report.slack.scenarios.find((scenario) => scenario.scenarioId === "profile-opt-out")?.text).toContain(
      "`/kodiai profile opt-in`",
    );
    expect(report.slack.scenarios.find((scenario) => scenario.scenarioId === "profile-opt-in")?.text).toContain(
      "`/kodiai profile opt-out`",
    );
    expect(report.slack.scenarios.find((scenario) => scenario.scenarioId === "unknown-command-help")?.text).toContain(
      "`profile opt-in`, `profile opt-out`",
    );

    expect(report.identity.scenarios.map((scenario) => scenario.scenarioId)).toEqual([
      "existing-linked-profile",
      "no-high-confidence-match",
      "high-confidence-match-dm",
      "slack-api-failure-warning",
    ]);
    expect(report.identity.scenarios.find((scenario) => scenario.scenarioId === "existing-linked-profile")?.fetchUrls).toEqual([]);
    expect(report.identity.scenarios.find((scenario) => scenario.scenarioId === "no-high-confidence-match")?.fetchUrls).toEqual([
      "https://slack.com/api/users.list",
    ]);
    expect(report.identity.scenarios.find((scenario) => scenario.scenarioId === "high-confidence-match-dm")?.dmText).toContain(
      "Kodiai can use your linked contributor profile when available.",
    );
    expect(report.identity.scenarios.find((scenario) => scenario.scenarioId === "high-confidence-match-dm")?.dmText).toContain(
      "`/kodiai profile opt-out`",
    );
    expect(report.identity.scenarios.find((scenario) => scenario.scenarioId === "high-confidence-match-dm")?.dmText).not.toContain(
      "personalized code reviews",
    );
    expect(report.identity.scenarios.find((scenario) => scenario.scenarioId === "slack-api-failure-warning")?.warningLogged).toBe(
      true,
    );

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

  test("renders Slack and identity sections in the human-readable report", async () => {
    const report = await evaluateM045S03({
      generatedAt: "2026-04-10T00:00:00.000Z",
    });

    expect(renderM045S03Report(report)).toContain("Slack:");
    expect(renderM045S03Report(report)).toContain("Identity link:");
    expect(renderM045S03Report(report)).toContain("linked-profile");
    expect(renderM045S03Report(report)).toContain("high-confidence-match-dm");
  });
});

describe("buildM045S03ProofHarness", () => {
  test("emits json output, wires the package script, and exits non-zero when Slack and identity checks drift", async () => {
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
      _slackFixtures: buildM045S03SlackFixtures().map((fixture) =>
        fixture.scenarioId === "profile-opt-in"
          ? {
              ...fixture,
              requiredPhrases: [...fixture.requiredPhrases, "missing opt-in proof phrase"],
            }
          : fixture
      ),
      _identityFixtures: buildM045S03IdentityFixtures().map((fixture) =>
        fixture.scenarioId === "high-confidence-match-dm"
          ? {
              ...fixture,
              bannedPhrases: [...fixture.bannedPhrases, "linked contributor profile"],
            }
          : fixture
      ),
    });

    const parsed = JSON.parse(stdout.join(""));
    expect(parsed.command).toBe("verify:m045:s03");
    expect(parsed.githubReview.command).toBe("verify:m045:s01");
    expect(
      parsed.slack.scenarios.find((scenario: { scenarioId: string }) => scenario.scenarioId === "profile-opt-in")
        ?.missingPhrases,
    ).toContain("missing opt-in proof phrase");
    expect(
      parsed.identity.scenarios.find(
        (scenario: { scenarioId: string }) => scenario.scenarioId === "high-confidence-match-dm",
      )?.unexpectedPhrases,
    ).toContain("linked contributor profile");
    expect(stderr.join("")).toContain(
      "M045-S03-SLACK-SURFACES-CONTRACT:slack_surface_contract_drift",
    );
    expect(stderr.join("")).toContain(
      "M045-S03-IDENTITY-LINK-CONTRACT:identity_link_contract_drift",
    );
    expect(exitCode).toBe(1);
  });
});
