import { describe, expect, test } from "bun:test";

import {
  COMMAND_NAME,
  DEFAULT_FIXTURE_PATH,
  EXPECTED_PACKAGE_SCRIPT,
  evaluateEvidence,
  evaluateM075S03Contract,
  main,
  parseM075S03Args,
  type M075S03EvidenceSnapshot,
} from "./verify-m075-s03.ts";

function packageJson(script = EXPECTED_PACKAGE_SCRIPT): string {
  return JSON.stringify({ scripts: { [COMMAND_NAME]: script } });
}

async function fixture(overrides: (copy: M075S03EvidenceSnapshot) => void = () => undefined): Promise<M075S03EvidenceSnapshot> {
  const loaded = await Bun.file(DEFAULT_FIXTURE_PATH).json() as M075S03EvidenceSnapshot;
  const copy = JSON.parse(JSON.stringify(loaded)) as M075S03EvidenceSnapshot;
  overrides(copy);
  return copy;
}

async function reportFor(copy: M075S03EvidenceSnapshot) {
  return evaluateM075S03Contract(parseM075S03Args(["--fixture", DEFAULT_FIXTURE_PATH]), {
    readFileText: async () => JSON.stringify(copy),
    readPackageJsonText: async () => packageJson(),
  });
}

describe("verify-m075-s03", () => {
  test("parses fixture-only CLI arguments and rejects unsafe inputs", () => {
    expect(parseM075S03Args([])).toEqual({ json: false, help: false });
    expect(parseM075S03Args(["--json", "--fixture", DEFAULT_FIXTURE_PATH])).toEqual({ json: true, help: false, fixturePath: DEFAULT_FIXTURE_PATH });
    expect(parseM075S03Args(["--help"])).toEqual({ json: false, help: true });
    expect(() => parseM075S03Args(["--live"])).toThrow(/fixture-only/);
    expect(() => parseM075S03Args(["--fixture", ".gsd/raw.json"])).toThrow(/must not read ignored/);
    expect(() => parseM075S03Args(["--fixture", "../raw.json"])).toThrow(/must not traverse/);
    expect(() => parseM075S03Args(["--bogus"])).toThrow(/invalid_cli_args/);
  });

  test("fixture verification succeeds for bounded Review Details preservation evidence", async () => {
    const report = await evaluateM075S03Contract(parseM075S03Args(["--fixture", DEFAULT_FIXTURE_PATH]), {
      generatedAt: "2026-05-20T15:30:00.000Z",
      readPackageJsonText: async () => packageJson(),
    });

    expect(report).toMatchObject({
      command: "verify:m075:s03",
      generatedAt: "2026-05-20T15:30:00.000Z",
      success: true,
      statusCode: "m075_s03_ok",
      fixturePath: DEFAULT_FIXTURE_PATH,
      observed: {
        reviewDetailsAvailable: true,
        reviewOutputKeyPresent: true,
        deliveryIdPresent: true,
        movedToDetails: 1,
        detailsOnlyFindings: 1,
        directFallback: 0,
        inlineCandidatePublished: 0,
        visibleLineCount: 4,
        genericFailureMode: "blocked",
      },
    });
    expect(report.failedCheckIds).toEqual([]);
    expect(JSON.stringify(report)).not.toContain("rawBodyCanary");
    expect(JSON.stringify(report)).not.toContain("diff --git");
  });

  test("fails closed when Review Details source is missing", async () => {
    const copy = await fixture((next) => {
      next.reviewDetails.sourceAvailable = false;
      next.reviewDetails.published = false;
    });
    const report = await reportFor(copy);

    expect(report.success).toBe(false);
    expect(report.failedCheckIds).toContain("source.available");
  });

  test("fails closed when moved finding evidence is missing", async () => {
    const copy = await fixture((next) => {
      next.candidatePublication.counts.candidateMovedToDetails = 0;
      next.candidatePublication.counts.candidateDetailsOnlyFindings = 0;
      next.candidatePublication.movedToDetails.counts.total = 0;
    });
    const report = await reportFor(copy);

    expect(report.success).toBe(false);
    expect(report.failedCheckIds).toContain("moved-to-details.present");
  });

  test("fails closed when direct fallback evidence is present", async () => {
    const copy = await fixture((next) => {
      next.candidatePublication.counts.directPublished = 1;
    });
    const report = await reportFor(copy);

    expect(report.success).toBe(false);
    expect(report.failedCheckIds).toContain("direct-fallback.absent");
  });

  test("fails closed when inline candidate publication or fabricated processed findings are present", async () => {
    const inline = await fixture((next) => {
      next.candidatePublication.counts.candidatePublished = 1;
      next.flow.publishedCommentIds = [123];
    });
    const fabricated = await fixture((next) => {
      next.flow.hasFabricatedProcessedFindings = true;
      next.flow.convertedProcessedFindingCount = 1;
      next.candidatePublication.counts.convertedProcessedFindings = 1;
    });

    expect((await reportFor(inline)).failedCheckIds).toContain("inline-publication.absent");
    expect((await reportFor(fabricated)).failedCheckIds).toContain("fabricated-processed.absent");
  });

  test("fails closed when reviewOutputKey or deliveryId correlation is absent", async () => {
    const copy = await fixture((next) => {
      next.reviewDetails.reviewOutputKey = "";
      next.reviewDetails.deliveryId = "";
      next.reviewDetails.correlation.reviewOutputKey = false;
      next.reviewDetails.correlation.deliveryId = false;
    });
    const report = await reportFor(copy);

    expect(report.success).toBe(false);
    expect(report.failedCheckIds).toContain("correlation.present");
    expect(report.issues.join("\n")).toContain("reviewOutputKey");
  });

  test("fails closed for raw canaries, secret-like values, and unsafe redaction flags", async () => {
    const copy = await fixture((next) => {
      next.candidatePublication.movedToDetails.redaction.rawPromptsIncluded = true;
      next.reviewDetails.visibleBody.lines.push("RAW_PROMPT_CANARY TOKEN=abc123 diff --git feature fixed safely");
      next.reviewDetails.visibleBody.lineCount = next.reviewDetails.visibleBody.lines.length;
      (next.provenance as Record<string, unknown>).candidatePayload = "SECRET_TOKEN_CANARY";
    });
    const report = await reportFor(copy);

    expect(report.success).toBe(false);
    expect(report.failedCheckIds).toContain("redaction.safe");
    expect(report.issues.join("\n")).toContain("redaction.safe");
  });

  test("fails closed when visible Review Details output is unbounded", async () => {
    const copy = await fixture((next) => {
      next.reviewDetails.visibleBody.maxLineCount = 99;
      next.reviewDetails.visibleBody.lines = Array.from({ length: 21 }, (_, index) => `line ${index}`);
      next.reviewDetails.visibleBody.lineCount = 21;
    });
    const report = await reportFor(copy);

    expect(report.success).toBe(false);
    expect(report.failedCheckIds).toContain("output.bounded");
  });

  test("fails closed when moved-to-details reason is not explicit", async () => {
    const copy = await fixture((next) => {
      next.candidatePublication.reasons = [];
      delete next.candidatePublication.movedToDetails.reasonCounts["line-not-commentable"];
      next.fixEligibility.reasonCounts = {};
      next.reviewDetails.visibleBody.lines = next.reviewDetails.visibleBody.lines.map((line) => line.replace("reason=line-not-commentable", "reason=unknown"));
    });
    const report = await reportFor(copy);

    expect(report.success).toBe(false);
    expect(report.failedCheckIds).toContain("reason.explicit");
  });

  test("fails closed when generic publication failure is mislabeled as moved-to-details", async () => {
    const copy = await fixture((next) => {
      next.negativeControls.genericPublicationFailure.gateResult = "moved-to-details";
      next.negativeControls.genericPublicationFailure.mode = "moved-to-details";
      next.negativeControls.genericPublicationFailure.counts.candidateFailed = 0;
      next.negativeControls.genericPublicationFailure.counts.candidateMovedToDetails = 1;
      next.negativeControls.genericPublicationFailure.movedToDetailsPresent = true;
      next.negativeControls.genericPublicationFailure.detailsProjectionPresent = true;
    });
    const report = await reportFor(copy);

    expect(report.success).toBe(false);
    expect(report.failedCheckIds).toContain("failure-classification.separated");
  });

  test("package wiring, malformed JSON, and main invalid args fail safely", async () => {
    const drifted = await evaluateM075S03Contract(parseM075S03Args(["--fixture", DEFAULT_FIXTURE_PATH]), {
      readPackageJsonText: async () => JSON.stringify({ scripts: {} }),
    });
    const invalidJson = await evaluateM075S03Contract(parseM075S03Args(["--fixture", DEFAULT_FIXTURE_PATH]), {
      readFileText: async () => "{not-json",
      readPackageJsonText: async () => packageJson(),
    });

    expect(drifted.success).toBe(false);
    expect(drifted.failedCheckIds).toContain("package-wiring.present");
    expect(invalidJson.statusCode).toBe("m075_s03_invalid_json");
    expect(await main(["--invalid"], { stdout: { write: () => undefined }, stderr: { write: () => undefined } })).toBe(2);
  });

  test("evaluateEvidence can be used directly by later S07 aggregation", async () => {
    const copy = await fixture();
    const result = evaluateEvidence(copy, { id: "package-wiring.present", status: "pass", message: "ok", issues: [] });

    expect(result.checks.every((check) => check.status === "pass")).toBe(true);
    expect(result.observed).toMatchObject({ movedToDetails: 1, detailsOnlyFindings: 1, directFallback: 0 });
  });
});
