import { describe, expect, test } from "bun:test";

import {
  evaluateM068CandidatePublicationProof,
  parseCandidateLine,
} from "./verify-m068-candidate-publication.ts";

const exactKey = "kodiai-review-output:v1:inst-109141824:xbmc/xbmc:pr-28172:action-synchronize:delivery-3a63ea30-4cee-11f1-951a-db5e2665bb61:head-1972551b75bfcabecd45d61ae3a75223f9988865";
const deliveryId = "3a63ea30-4cee-11f1-951a-db5e2665bb61";

const baseInput = {
  reviewOutputKey: exactKey,
  deliveryId,
  artifactCounts: { reviews: 0, reviewComments: 0, issueComments: 1 },
  url: "https://github.com/xbmc/xbmc/pull/28172#issuecomment-4417527175",
};

describe("M068 candidate publication proof verifier", () => {
  test("accepts exact-key candidate-approved publication with zero direct fallback", () => {
    const report = evaluateM068CandidatePublicationProof({
      ...baseInput,
      mode: "candidate-approved",
      candidatePublished: 5,
      directFallback: 0,
    });

    expect(report).toMatchObject({
      success: true,
      status_code: "m068_ok",
      mode: "candidate-approved",
      candidatePublished: 5,
      directFallback: 0,
      exactKeyArtifactCount: 1,
      issues: [],
    });
  });

  test("rejects the fresh production direct-fallback proof even when Review Details is visible", () => {
    const report = evaluateM068CandidatePublicationProof({
      ...baseInput,
      candidateLine: "- Review candidate publication: mode=direct-fallback approved=1 rewritten=4 published=0 directFallback=1 reasons=candidate-publisher-skipped,direct-fallback-attempted,direct-fallback-published,direct-fallback-disallowed",
    });

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m068_direct_fallback");
    expect(report.mode).toBe("direct-fallback");
    expect(report.candidatePublished).toBe(0);
    expect(report.directFallback).toBe(1);
    expect(report.issues).toContain("Direct fallback evidence is present and cannot count as candidate-approved publication.");
  });

  test("accepts live candidate-approved proof with one Review Details comment and multiple inline candidate comments", () => {
    const report = evaluateM068CandidatePublicationProof({
      ...baseInput,
      mode: "candidate-approved",
      candidatePublished: 4,
      directFallback: 0,
      artifactCounts: { reviews: 0, reviewComments: 4, issueComments: 1 },
      url: "https://github.com/xbmc/xbmc/pull/28172#issuecomment-4423943241",
    });

    expect(report).toMatchObject({
      success: true,
      status_code: "m068_ok",
      mode: "candidate-approved",
      candidatePublished: 4,
      directFallback: 0,
      exactKeyArtifactCount: 5,
      issues: [],
    });
  });

  test("rejects candidate-approved-looking evidence with extra Review Details artifacts", () => {
    const report = evaluateM068CandidatePublicationProof({
      ...baseInput,
      mode: "candidate-approved",
      candidatePublished: 1,
      directFallback: 0,
      artifactCounts: { reviews: 1, reviewComments: 1, issueComments: 1 },
    });

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m068_malformed_evidence");
    expect(report.issues).toContain("Expected exactly one bounded Review Details artifact; found 2.");
  });

  test("parses bounded GitHub-visible candidate publication lines", () => {
    expect(parseCandidateLine("mode=direct-fallback approved=1 rewritten=4 published=0 directFallback=1 reasons=a,b")).toEqual({
      mode: "direct-fallback",
      published: 0,
      directFallback: 1,
    });
  });
});
