import { describe, expect, test } from "bun:test";
import {
  normalizeFindingLifecycle,
  toFindingLifecyclePublicProjection,
  type ReviewFindingInput,
  type ReviewFindingLifecycleInput,
} from "./finding-lifecycle.ts";

const baseUnit = {
  repo: "acme/widgets",
  pullNumber: 42,
  reviewOutputKey: "review-details-42",
  deliveryId: "delivery-abc",
  commitSha: "abc123def456",
} satisfies Omit<ReviewFindingLifecycleInput, "findings">;

function finding(overrides: Partial<ReviewFindingInput> = {}): ReviewFindingInput {
  return {
    filePath: "src/service.ts",
    startLine: 12,
    endLine: 14,
    severity: "major",
    category: "correctness",
    title: "Missing rollback when publish fails",
    confidence: 88,
    actionability: "actionable",
    validationNeeds: ["needs-tests"],
    revalidationState: "pending",
    evidenceRefs: [
      { kind: "file", ref: "src/service.ts:12" },
      { kind: "test", ref: "publish rollback regression" },
    ],
    reasonCodes: ["missing-rollback", "transactional-safety"],
    statusHistory: [
      { status: "detected", reasonCode: "review-detected", evidenceRefs: [{ kind: "file", ref: "src/service.ts:12" }] },
      { status: "validated", reasonCode: "test-needed", evidenceRefs: [{ kind: "test", ref: "publish rollback regression" }] },
    ],
    body: "Private explanatory body that should not be projected.",
    ...overrides,
  };
}

describe("normalizeFindingLifecycle", () => {
  test("creates deterministic stable IDs from bounded identity fields only", () => {
    const first = normalizeFindingLifecycle({
      ...baseUnit,
      findings: [finding({ body: "first private body" })],
    });
    const second = normalizeFindingLifecycle({
      ...baseUnit,
      findings: [finding({ body: "changed private body and model chatter" })],
    });

    expect(first.status).toBe("normalized");
    expect(second.status).toBe("normalized");
    expect(first.records[0]?.id).toBe(second.records[0]?.id);
    expect(first.records[0]?.identityHash).toBe(second.records[0]?.identityHash);

    const changedTitle = normalizeFindingLifecycle({
      ...baseUnit,
      findings: [finding({ title: "Different bounded identity title" })],
    });
    expect(changedTitle.records[0]?.id).not.toBe(first.records[0]?.id);
  });

  test("records lifecycle history plus actionability, validation needs, and revalidation state", () => {
    const result = normalizeFindingLifecycle({ ...baseUnit, findings: [finding()] });
    const record = result.records[0];

    expect(record).toMatchObject({
      severity: "major",
      category: "correctness",
      confidence: 88,
      actionability: "actionable",
      validationNeeds: ["needs-tests"],
      revalidationState: "pending",
      reasonCodes: ["missing-rollback", "transactional-safety"],
    });
    expect(record?.statusHistory.map((entry) => entry.status)).toEqual(["detected", "validated"]);
    expect(record?.evidenceRefs).toEqual([
      { kind: "file", ref: "src/service.ts:12" },
      { kind: "test", ref: "publish rollback regression" },
    ]);
  });

  test("fails closed when correlation metadata is malformed or missing", () => {
    const result = normalizeFindingLifecycle({
      repo: "acme/widgets",
      pullNumber: 42,
      reviewOutputKey: "",
      commitSha: "abc123",
      findings: [finding(), finding({ title: "Second" })],
    });

    expect(result.status).toBe("unavailable");
    expect(result.records).toHaveLength(0);
    expect(result.counts).toMatchObject({ input: 2, recorded: 0, rejected: 2 });
    expect(result.rejections).toEqual([
      { index: 0, reason: "missing-correlation" },
      { index: 1, reason: "missing-correlation" },
    ]);
  });

  test("disambiguates duplicate same-identity findings deterministically", () => {
    const result = normalizeFindingLifecycle({
      ...baseUnit,
      findings: [
        finding({ body: "private body A" }),
        finding({ body: "private body B" }),
        finding({ body: "private body C" }),
      ],
    });

    expect(result.records.map((record) => record.id)).toEqual([
      expect.stringMatching(/^rfl-[a-f0-9]{16}$/),
      expect.stringMatching(/^rfl-[a-f0-9]{16}-2$/),
      expect.stringMatching(/^rfl-[a-f0-9]{16}-3$/),
    ]);
    expect(result.records[0]?.identityHash).toBe(result.records[1]?.identityHash);
    expect(result.records[1]?.identityHash).toBe(result.records[2]?.identityHash);
  });

  test("rejects oversized and raw unsafe fields without including private payloads in records", () => {
    const result = normalizeFindingLifecycle({
      ...baseUnit,
      findings: [
        finding({ title: "x".repeat(161) }),
        finding({ filePath: "../secret.ts" }),
        finding({ rawPrompt: "BEGIN PROMPT raw prompt canary" }),
        finding({ title: "Safe finding", body: "private body that is allowed but not retained" }),
      ],
    });

    expect(result.status).toBe("degraded");
    expect(result.records).toHaveLength(1);
    expect(result.rejections.map((rejection) => rejection.reason)).toEqual([
      "field-too-long",
      "unsafe-file-path",
      "unsafe-text",
    ]);
    expect(JSON.stringify(result.records[0])).not.toContain("private body that is allowed");
  });
});

describe("toFindingLifecyclePublicProjection", () => {
  test("returns bounded counts, statuses, references, reason codes, and explicit redaction flags", () => {
    const result = normalizeFindingLifecycle({
      ...baseUnit,
      findings: [
        finding(),
        finding({
          filePath: "src/security.ts",
          startLine: 3,
          severity: "critical",
          category: "security",
          title: "Token comparison leaks timing",
          actionability: "needs-reproduction",
          validationNeeds: ["needs-security-review"],
          revalidationState: "not-required",
          statusHistory: [{ status: "open", reasonCode: "security-review-needed" }],
        }),
      ],
    });

    const projection = toFindingLifecyclePublicProjection(result);

    expect(projection.schema).toBe("review-finding-lifecycle.v1");
    expect(projection.counts.recorded).toBe(2);
    expect(projection.counts.status.detected).toBe(1);
    expect(projection.counts.status.validated).toBe(1);
    expect(projection.counts.status.open).toBe(1);
    expect(projection.counts.severity.major).toBe(1);
    expect(projection.counts.severity.critical).toBe(1);
    expect(projection.counts.category.security).toBe(1);
    expect(projection.counts.actionability.actionable).toBe(1);
    expect(projection.counts.validationNeeds["needs-security-review"]).toBe(1);
    expect(projection.counts.revalidationState.pending).toBe(1);
    expect(projection.reasonCodes).toContain("missing-rollback");
    expect(projection.references).toHaveLength(2);
    expect(projection.references[0]).toEqual({
      id: result.records[0]!.id,
      status: "validated",
      severity: "major",
      category: "correctness",
      actionability: "actionable",
      validationNeeds: ["needs-tests"],
      revalidationState: "pending",
      reasonCodes: ["missing-rollback", "transactional-safety"],
      evidenceRefs: [
        { kind: "file", ref: "src/service.ts:12" },
        { kind: "test", ref: "publish rollback regression" },
      ],
    });
    expect(projection.redaction).toMatchObject({
      privateOnly: true,
      rawPromptsIncluded: false,
      rawModelOutputIncluded: false,
      candidateBodiesIncluded: false,
      toolPayloadsIncluded: false,
      secretLikeStringsIncluded: false,
      diffsIncluded: false,
      unboundedArraysIncluded: false,
    });
  });

  test("never exposes raw prompt, raw model output, candidate body, tool payload, secret-like token, or diff canaries", () => {
    const canaries = {
      rawPrompt: "RAW_PROMPT_CANARY BEGIN PROMPT hidden instructions",
      rawModelOutput: "RAW_MODEL_OUTPUT_CANARY model output",
      candidateBody: "CANDIDATE_BODY_CANARY candidate body",
      toolPayload: { private: "TOOL_PAYLOAD_CANARY" },
      body: "SECRET_TOKEN_CANARY token=sk-supersecret12345",
      diffText: "DIFF_TEXT_CANARY diff --git a/src/a.ts b/src/a.ts",
    };
    const result = normalizeFindingLifecycle({
      ...baseUnit,
      findings: [
        finding({ ...canaries }),
        finding({ title: "Safe surviving finding", body: "Private but not secret body" }),
      ],
    });

    const projectionJson = JSON.stringify(toFindingLifecyclePublicProjection(result));

    expect(result.records).toHaveLength(1);
    for (const forbidden of [
      "RAW_PROMPT_CANARY",
      "RAW_MODEL_OUTPUT_CANARY",
      "CANDIDATE_BODY_CANARY",
      "TOOL_PAYLOAD_CANARY",
      "SECRET_TOKEN_CANARY",
      "sk-supersecret12345",
      "DIFF_TEXT_CANARY",
      "diff --git",
      "Private but not secret body",
    ]) {
      expect(projectionJson).not.toContain(forbidden);
    }
  });

  test("caps public arrays so larger inputs increase counts instead of visible volume", () => {
    const findings = Array.from({ length: 60 }, (_, index) => finding({
      filePath: `src/file-${index}.ts`,
      startLine: index + 1,
      endLine: index + 1,
      title: `Finding ${index}`,
      reasonCodes: [`reason-${index}`],
    }));
    const result = normalizeFindingLifecycle({ ...baseUnit, findings });
    const projection = toFindingLifecyclePublicProjection(result);

    expect(projection.counts.input).toBe(60);
    expect(projection.counts.recorded).toBe(60);
    expect(projection.references).toHaveLength(5);
    expect(projection.reasonCodes).toHaveLength(8);
    expect(projection.omitted.references).toBe(55);
    expect(projection.omitted.reasonCodes).toBeGreaterThan(0);

    const tenFindingsProjection = toFindingLifecyclePublicProjection(
      normalizeFindingLifecycle({ ...baseUnit, findings: findings.slice(0, 10) }),
    );
    expect(projection.references.length).toBe(tenFindingsProjection.references.length);
    expect(projection.reasonCodes.length).toBe(tenFindingsProjection.reasonCodes.length);
    expect(projection.counts.recorded).toBe(tenFindingsProjection.counts.recorded * 6);
  });
});
