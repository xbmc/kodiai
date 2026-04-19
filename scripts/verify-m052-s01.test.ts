import { describe, expect, test } from "bun:test";

async function loadModule() {
  return await import("./verify-m052-s01.ts");
}

describe("verify-m052-s01", () => {
  test("evaluateM052S01 passes when accepted, suppressed, and malformed proofs match the contract", async () => {
    const { evaluateM052S01 } = await loadModule();

    const report = await evaluateM052S01({
      generatedAt: "2026-04-19T04:00:00.000Z",
    });

    expect(report.command).toBe("verify:m052:s01");
    expect(report.success).toBe(true);
    expect(report.status_code).toBe("m052_s01_ok");
    expect(report.checks.map((check) => [check.id, check.status])).toEqual([
      ["M052-S01-ACCEPT", "pass"],
      ["M052-S01-SUPPRESS", "pass"],
      ["M052-S01-INVALID", "pass"],
    ]);
    expect(report.acceptedResult).toMatchObject({
      verdict: "accept",
      event: {
        sourceId: "buildkite",
        eventType: "build.failed",
      },
    });
    expect(report.suppressedResult).toMatchObject({
      verdict: "suppress",
      reason: "text_excluded_substring",
      sourceId: "buildkite",
    });
    expect(report.invalidResult).toEqual({
      verdict: "invalid",
      reason: "malformed_payload",
      sourceId: "buildkite",
      issues: ["text", "url"],
    });
  });

  test("evaluateM052S01 fails loudly when the accepted fixture stops producing an accept verdict", async () => {
    const { evaluateM052S01 } = await loadModule();

    const report = await evaluateM052S01({
      generatedAt: "2026-04-19T04:00:00.000Z",
      acceptedPayload: {
        eventType: "build.started",
        title: "Build started",
        summary: "CI started for xbmc/xbmc.",
        url: "https://ci.example.test/builds/999",
        text: "Build started for xbmc/xbmc.",
      },
    });

    expect(report.success).toBe(false);
    expect(report.status_code).toBe("m052_s01_contract_drift");
    expect(report.checks.find((check) => check.id === "M052-S01-ACCEPT")).toMatchObject({
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
        command: "verify:m052:s01",
        generated_at: opts.generatedAt ?? "2026-04-19T04:00:00.000Z",
        success: true,
        status_code: "m052_s01_ok",
        checks: [
          { id: "M052-S01-ACCEPT", status: "pass", detail: "accepted fixture normalized" },
        ],
        acceptedResult: { verdict: "accept", event: { sourceId: "buildkite", targetChannel: "C", eventType: "build.failed", title: "t", summary: "s", url: "https://x.test", text: "failed", metadata: {}, filterMetadata: { eventTypes: [], textIncludes: [], textExcludes: [] } } },
        suppressedResult: { verdict: "suppress", reason: "text_excluded_substring", sourceId: "buildkite", eventType: "build.failed", detail: "flaky" },
        invalidResult: { verdict: "invalid", reason: "malformed_payload", sourceId: "buildkite", issues: ["text", "url"] },
        issues: [],
      }),
    });

    expect(exitCode).toBe(0);
    expect(stderrChunks.join("")).toBe("");
    expect(JSON.parse(stdoutChunks.join("")).status_code).toBe("m052_s01_ok");
  });
});
