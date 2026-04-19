import { describe, expect, test } from "bun:test";

async function loadModule() {
  return await import("./verify-m052.ts");
}

describe("verify-m052", () => {
  test("evaluateM052 composes the S01 and S02 proof surfaces", async () => {
    const { evaluateM052 } = await loadModule();

    const report = await evaluateM052({
      generatedAt: "2026-04-19T06:00:00.000Z",
    });

    expect(report.command).toBe("verify:m052");
    expect(report.overallPassed).toBe(true);
    expect(report.status_code).toBe("m052_ok");
    expect(report.checks.map((check) => [check.id, check.passed])).toEqual([
      ["M052-S03-S01-PROOF", true],
      ["M052-S03-S02-PROOF", true],
    ]);
    expect(report.s01?.status_code).toBe("m052_s01_ok");
    expect(report.s02?.status_code).toBe("m052_s02_ok");
  });

  test("evaluateM052 fails when the nested S02 proof drifts", async () => {
    const { evaluateM052 } = await loadModule();

    const report = await evaluateM052({
      generatedAt: "2026-04-19T06:00:00.000Z",
      _evaluateS02: async () => ({
        command: "verify:m052:s02",
        generated_at: "2026-04-19T06:00:00.000Z",
        success: false,
        status_code: "m052_s02_integration_drift",
        checks: [],
        delivered: { status: 202, body: { ok: true } },
        suppressed: { status: 202, body: { ok: true } },
        deliveryFailed: { status: 502, body: { ok: false } },
        issues: ["drift"],
      }),
    });

    expect(report.overallPassed).toBe(false);
    expect(report.status_code).toBe("m052_proof_drift");
    expect(report.checks.find((check) => check.id === "M052-S03-S02-PROOF")).toMatchObject({
      passed: false,
    });
  });

  test("package.json wires verify:m052 to the milestone proof script", async () => {
    const packageJson = await Bun.file(new URL("../package.json", import.meta.url)).json() as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["verify:m052"]).toBe("bun scripts/verify-m052.ts");
  });

  test("main prints JSON when --json is passed", async () => {
    const { main } = await loadModule();
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const exitCode = await main(["--json"], {
      stdout: { write: (chunk: string) => void stdoutChunks.push(chunk) },
      stderr: { write: (chunk: string) => void stderrChunks.push(chunk) },
      evaluate: async () => ({
        command: "verify:m052",
        generatedAt: "2026-04-19T06:00:00.000Z",
        overallPassed: true,
        status_code: "m052_ok",
        checks: [
          { id: "M052-S03-S01-PROOF", passed: true, detail: "ok" },
          { id: "M052-S03-S02-PROOF", passed: true, detail: "ok" },
        ],
        s01: null,
        s02: null,
        issues: [],
      }),
    });

    expect(exitCode).toBe(0);
    expect(stderrChunks.join("")).toBe("");
    expect(JSON.parse(stdoutChunks.join("")).status_code).toBe("m052_ok");
  });
});
