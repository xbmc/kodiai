import { describe, expect, test } from "bun:test";

async function loadModule() {
  return await import("./verify-m052-s02.ts");
}

describe("verify-m052-s02", () => {
  test("evaluateM052S02 proves delivered, suppressed, and failed-delivery route outcomes", async () => {
    const { evaluateM052S02 } = await loadModule();

    const report = await evaluateM052S02({
      generatedAt: "2026-04-19T05:00:00.000Z",
    });

    expect(report.command).toBe("verify:m052:s02");
    expect(report.success).toBe(true);
    expect(report.status_code).toBe("m052_s02_ok");
    expect(report.checks.map((check) => [check.id, check.status])).toEqual([
      ["M052-S02-DELIVERED", "pass"],
      ["M052-S02-SUPPRESSED", "pass"],
      ["M052-S02-DELIVERY-FAILED", "pass"],
    ]);
    expect(report.delivered.status).toBe(202);
    expect(report.suppressed.status).toBe(202);
    expect(report.deliveryFailed.status).toBe(502);
  });

  test("evaluateM052S02 fails loudly when the delivered case stops returning an accept verdict", async () => {
    const { evaluateM052S02 } = await loadModule();

    const report = await evaluateM052S02({
      generatedAt: "2026-04-19T05:00:00.000Z",
      acceptedPayload: {
        eventType: "build.started",
        title: "Build started",
        summary: "CI started for xbmc/xbmc.",
        url: "https://ci.example.test/builds/999",
        text: "Build started for xbmc/xbmc.",
      },
    });

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m052_s02_integration_drift");
    expect(report.checks.find((check) => check.id === "M052-S02-DELIVERED")).toMatchObject({
      status: "fail",
    });
  });

  test("main prints JSON when --json is passed", async () => {
    const { main } = await loadModule();
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const exitCode = await main(["--json"], {
      stdout: { write: (chunk: string) => void stdoutChunks.push(chunk) },
      stderr: { write: (chunk: string) => void stderrChunks.push(chunk) },
      evaluate: async (opts = {}) => ({
        command: "verify:m052:s02",
        generated_at: opts.generatedAt ?? "2026-04-19T05:00:00.000Z",
        success: true,
        status_code: "m052_s02_ok",
        checks: [
          { id: "M052-S02-DELIVERED", status: "pass", detail: "delivered" },
        ],
        delivered: { status: 202, body: { ok: true, verdict: "accept" } },
        suppressed: { status: 202, body: { ok: true, verdict: "suppress" } },
        deliveryFailed: { status: 502, body: { ok: false, reason: "delivery_failed" } },
        issues: [],
      }),
    });

    expect(exitCode).toBe(0);
    expect(stderrChunks.join("")).toBe("");
    expect(JSON.parse(stdoutChunks.join("")).status_code).toBe("m052_s02_ok");
  });
});
