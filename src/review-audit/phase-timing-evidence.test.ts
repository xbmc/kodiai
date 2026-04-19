import { describe, expect, test } from "bun:test";
import type { ReviewPhaseTiming } from "../execution/types.ts";
import type { NormalizedLogAnalyticsRow } from "./log-analytics.ts";

const REQUIRED_PHASES = [
  "queue wait",
  "workspace preparation",
  "retrieval/context assembly",
  "executor handoff",
  "remote runtime",
  "publication",
] as const;

function makePhases(overrides?: Partial<Record<(typeof REQUIRED_PHASES)[number], Partial<ReviewPhaseTiming>>>) {
  return REQUIRED_PHASES.map((name, index) => ({
    name,
    status: "completed" as const,
    durationMs: (index + 1) * 100,
    ...(overrides?.[name] ?? {}),
  }));
}

function makeRow(params?: {
  reviewOutputKey?: string;
  deliveryId?: string;
  totalDurationMs?: number;
  phases?: Array<Record<string, unknown>>;
  conclusion?: string | null;
  omitConclusion?: boolean;
  published?: boolean | null;
  omitPublished?: boolean;
  timeGenerated?: string;
}): NormalizedLogAnalyticsRow {
  const payload = {
    msg: "Review phase timing summary",
    reviewOutputKey: params?.reviewOutputKey ?? "rok-123",
    deliveryId: params?.deliveryId ?? "delivery-123",
    totalDurationMs: params && "totalDurationMs" in params ? params.totalDurationMs : 2_100,
    ...(!params?.omitConclusion
      ? { conclusion: params && "conclusion" in params ? params.conclusion : "success" }
      : {}),
    ...(!params?.omitPublished
      ? { published: params && "published" in params ? params.published : true }
      : {}),
    phases: params?.phases ?? makePhases(),
  } satisfies Record<string, unknown>;

  return {
    timeGenerated: params?.timeGenerated ?? "2026-04-12T16:00:00.000Z",
    rawLog: JSON.stringify(payload),
    malformed: false,
    deliveryId: String(payload.deliveryId),
    reviewOutputKey: String(payload.reviewOutputKey),
    message: "Review phase timing summary",
    revisionName: "ca-kodiai--0000101",
    containerAppName: "ca-kodiai",
    parsedLog: payload,
  };
}

async function loadModule() {
  return await import("./phase-timing-evidence.ts");
}

describe("phase timing evidence normalization", () => {
  test("normalizes one matching phase summary row and collapses duplicate rows into one evidence report", async () => {
    const { buildPhaseTimingEvidence } = await loadModule();
    const row = makeRow();

    const result = buildPhaseTimingEvidence({
      reviewOutputKey: "rok-123",
      deliveryId: "delivery-123",
      rows: [row, { ...row }],
    });

    expect(result.status).toBe("ok");
    expect(result.sourceAvailability.azureLogs).toBe("present");
    expect(result.correlation.matchedRowCount).toBe(2);
    expect(result.correlation.duplicateRowCount).toBe(1);
    expect(result.evidence?.reviewOutputKey).toBe("rok-123");
    expect(result.evidence?.deliveryId).toBe("delivery-123");
    expect(result.evidence?.totalDurationMs).toBe(2_100);
    expect(result.evidence?.phases.map((phase: ReviewPhaseTiming) => phase.name)).toEqual([...REQUIRED_PHASES]);
  });

  test("fails with a named correlation-mismatch status when rows drift to a different delivery id", async () => {
    const { buildPhaseTimingEvidence } = await loadModule();

    const result = buildPhaseTimingEvidence({
      reviewOutputKey: "rok-123",
      deliveryId: "delivery-123",
      rows: [makeRow({ deliveryId: "delivery-999" })],
    });

    expect(result.status).toBe("correlation-mismatch");
    expect(result.correlation.driftedRowCount).toBe(1);
    expect(result.evidence).toBeNull();
    expect(result.issues).toContain("No phase timing log rows matched the requested reviewOutputKey + deliveryId correlation.");
  });

  test("treats rows missing conclusion as invalid payload drift while preserving matched evidence", async () => {
    const { buildPhaseTimingEvidence } = await loadModule();

    const result = buildPhaseTimingEvidence({
      reviewOutputKey: "rok-123",
      deliveryId: "delivery-123",
      rows: [makeRow({ omitConclusion: true })],
    });

    expect(result.status).toBe("invalid-phase-payload");
    expect(result.issues).toContain("Missing conclusion on Review phase timing summary payload.");
    expect(result.evidence?.reviewOutputKey).toBe("rok-123");
    expect(result.evidence?.deliveryId).toBe("delivery-123");
    expect(result.evidence?.conclusion).toBeNull();
    expect(result.evidence?.published).toBe(true);
    expect(result.evidence?.phases.map((phase: ReviewPhaseTiming) => phase.name)).toEqual([...REQUIRED_PHASES]);
  });

  test("treats rows missing published as invalid payload drift while preserving normalized phases", async () => {
    const { buildPhaseTimingEvidence } = await loadModule();

    const result = buildPhaseTimingEvidence({
      reviewOutputKey: "rok-123",
      deliveryId: "delivery-123",
      rows: [makeRow({ omitPublished: true })],
    });

    expect(result.status).toBe("invalid-phase-payload");
    expect(result.issues).toContain("Missing published on Review phase timing summary payload.");
    expect(result.evidence?.conclusion).toBe("success");
    expect(result.evidence?.published).toBeNull();
    expect(result.evidence?.phases.map((phase: ReviewPhaseTiming) => phase.name)).toEqual([...REQUIRED_PHASES]);
  });

  test("keeps missing interpretation fields visible alongside other malformed payload issues", async () => {
    const { buildPhaseTimingEvidence } = await loadModule();
    const row = makeRow({
      omitConclusion: true,
      omitPublished: true,
      totalDurationMs: undefined,
      phases: [
        ...makePhases().slice(0, 5),
        {
          name: "mystery phase",
          status: "completed",
          durationMs: 50,
        },
      ],
    });

    const result = buildPhaseTimingEvidence({
      reviewOutputKey: "rok-123",
      deliveryId: "delivery-123",
      rows: [row, { ...row }],
    });

    expect(result.status).toBe("invalid-phase-payload");
    expect(result.correlation.matchedRowCount).toBe(2);
    expect(result.correlation.duplicateRowCount).toBe(1);
    expect(result.issues).toContain("Missing conclusion on Review phase timing summary payload.");
    expect(result.issues).toContain("Missing published on Review phase timing summary payload.");
    expect(result.issues).toContain("Unknown review phase names: mystery phase.");
    expect(result.issues).toContain("Missing totalDurationMs on Review phase timing summary payload.");
    expect(result.evidence?.reviewOutputKey).toBe("rok-123");
    expect(result.evidence?.deliveryId).toBe("delivery-123");
    expect(result.evidence?.conclusion).toBeNull();
    expect(result.evidence?.published).toBeNull();
    expect(result.evidence?.phases.find((phase: ReviewPhaseTiming) => phase.name === "publication")).toEqual({
      name: "publication",
      status: "unavailable",
      detail: "phase timing unavailable",
    });
  });

  test("keeps timeout reviews truthful by preserving degraded and unavailable phases", async () => {
    const { buildPhaseTimingEvidence } = await loadModule();

    const result = buildPhaseTimingEvidence({
      reviewOutputKey: "rok-123",
      deliveryId: "delivery-123",
      rows: [makeRow({
        conclusion: "timeout",
        published: false,
        phases: makePhases({
          publication: {
            status: "unavailable",
            detail: "review timed out before publication",
            durationMs: undefined,
          },
          "remote runtime": {
            status: "degraded",
            detail: "executor terminated after timeout",
          },
        }),
      })],
    });

    expect(result.status).toBe("ok");
    expect(result.evidence?.conclusion).toBe("timeout");
    expect(result.evidence?.published).toBe(false);
    expect(result.evidence?.phases.find((phase: ReviewPhaseTiming) => phase.name === "remote runtime")).toEqual({
      name: "remote runtime",
      status: "degraded",
      durationMs: 500,
      detail: "executor terminated after timeout",
    });
    expect(result.evidence?.phases.find((phase: ReviewPhaseTiming) => phase.name === "publication")).toEqual({
      name: "publication",
      status: "unavailable",
      detail: "review timed out before publication",
    });
  });
});
