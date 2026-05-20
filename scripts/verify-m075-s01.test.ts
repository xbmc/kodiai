import { describe, expect, test } from "bun:test";

import {
  COMMAND_NAME,
  DEFAULT_FIXTURE_PATH,
  EXPECTED_PACKAGE_SCRIPT,
  evaluateEvidence,
  evaluateM075S01Contract,
  main,
  parseM075S01Args,
  type M075S01EvidenceSnapshot,
} from "./verify-m075-s01.ts";
import type { NormalizedLogAnalyticsRow } from "../src/review-audit/log-analytics.ts";

function packageJson(script = EXPECTED_PACKAGE_SCRIPT): string {
  return JSON.stringify({ scripts: { [COMMAND_NAME]: script } });
}

async function asyncFixture(overrides: (fixture: M075S01EvidenceSnapshot) => void = () => undefined): Promise<M075S01EvidenceSnapshot> {
  const fixture = await Bun.file(DEFAULT_FIXTURE_PATH).json() as M075S01EvidenceSnapshot;
  const copy = JSON.parse(JSON.stringify(fixture)) as M075S01EvidenceSnapshot;
  overrides(copy);
  return copy;
}

function row(params: { msg: string; malformed?: boolean; parsedLog?: Record<string, unknown> | null; rawLog?: string | null }): NormalizedLogAnalyticsRow {
  const parsedLog = params.parsedLog === undefined ? { msg: params.msg, repo: "xbmc/xbmc", prNumber: 701, deliveryId: "delivery-701", reviewOutputKey: "review-output-701" } : params.parsedLog;
  return {
    timeGenerated: "2026-05-20T12:00:00.000Z",
    rawLog: params.rawLog ?? (parsedLog ? JSON.stringify(parsedLog) : null),
    malformed: params.malformed ?? false,
    deliveryId: typeof parsedLog?.deliveryId === "string" ? parsedLog.deliveryId : null,
    reviewOutputKey: typeof parsedLog?.reviewOutputKey === "string" ? parsedLog.reviewOutputKey : null,
    message: params.msg,
    revisionName: "ca-kodiai--0000076",
    containerAppName: "ca-kodiai",
    parsedLog,
  };
}

describe("verify-m075-s01", () => {
  test("parses CLI arguments and rejects unsafe combinations", () => {
    expect(parseM075S01Args([])).toEqual({ json: false, help: false, live: false, allowBlocked: false });
    expect(parseM075S01Args(["--json", "--fixture", DEFAULT_FIXTURE_PATH])).toEqual({ json: true, help: false, live: false, allowBlocked: false, fixturePath: DEFAULT_FIXTURE_PATH });
    expect(parseM075S01Args(["--live", "--allow-blocked"])).toEqual({ json: false, help: false, live: true, allowBlocked: true });
    expect(parseM075S01Args(["--help"])).toEqual({ json: false, help: true, live: false, allowBlocked: false });
    expect(() => parseM075S01Args(["--live", "--fixture", DEFAULT_FIXTURE_PATH])).toThrow(/choose either --live or --fixture/);
    expect(() => parseM075S01Args(["--fixture", ".gsd/secret.json"])).toThrow(/must not read ignored/);
    expect(() => parseM075S01Args(["--bogus"])).toThrow(/invalid_cli_args/);
  });

  test("fixture verification succeeds with bounded baseline evidence", async () => {
    const report = await evaluateM075S01Contract(parseM075S01Args(["--fixture", DEFAULT_FIXTURE_PATH]), {
      generatedAt: "2026-05-20T14:00:00.000Z",
      readPackageJsonText: async () => packageJson(),
    });

    expect(report).toMatchObject({
      command: "verify:m075:s01",
      generatedAt: "2026-05-20T14:00:00.000Z",
      success: true,
      statusCode: "m075_s01_ok",
      fixturePath: DEFAULT_FIXTURE_PATH,
      observed: { sourceAvailability: "present", workspaceCount: 1, windowsPresent: ["last12h", "last7d"], malformedRows: 5 },
    });
    expect(report.failedCheckIds).toEqual([]);
    expect(report.observed.classCounts["knowledge-store.undefined-write"].last12h).toBe(2);
    expect(report.observed.classCounts["azure.platform-noise"].last7d).toBe(18);
    expect(JSON.stringify(report)).not.toContain("Log_s");
  });

  test("fails when last7d window is missing", async () => {
    const fixture = await asyncFixture((copy) => {
      delete (copy.report.windows as unknown as Record<string, unknown>).last7d;
    });
    const report = await evaluateM075S01Contract(parseM075S01Args(["--fixture", DEFAULT_FIXTURE_PATH]), {
      readFileText: async () => JSON.stringify(fixture),
      readPackageJsonText: async () => packageJson(),
    });

    expect(report.success).toBe(false);
    expect(report.statusCode).toBe("m075_s01_malformed_evidence");
    expect(report.failedCheckIds).toContain("fixture.shape");
  });

  test("fails closed for unsafe fixture evidence without copying raw payloads into issue examples", async () => {
    const fixture = await asyncFixture((copy) => {
      const first = copy.report.windows.last12h.issueClasses[0] as unknown as Record<string, unknown>;
      first.classification = "azure-platform";
      first.downstreamOwner = null;
      first.Log_s = "RAW_PROMPT_CANARY token=ghp_123456789012345678901234567890123456";
      copy.report.windows.last12h.redaction.passed = false;
      copy.report.windows.last12h.redaction.violations = [{ reason: "raw-log-output", path: "windows.last12h.issueClasses[0].Log_s" }];
    });
    const report = await evaluateM075S01Contract(parseM075S01Args(["--fixture", DEFAULT_FIXTURE_PATH]), {
      readFileText: async () => JSON.stringify(fixture),
      readPackageJsonText: async () => packageJson(),
    });

    expect(report.success).toBe(false);
    expect(report.failedCheckIds).toEqual(expect.arrayContaining(["classification.separated", "owner.mapping.exact", "redaction.safe"]));
    expect(report.issues.join("\n")).toContain("redaction.safe");
  });

  test("reports source-blocked live access as blocked evidence, not operational success", async () => {
    const report = await evaluateM075S01Contract(parseM075S01Args(["--live", "--allow-blocked"]), {
      generatedAt: "2026-05-20T14:00:00.000Z",
      readPackageJsonText: async () => packageJson(),
      liveCollectors: {},
    });

    expect(report.success).toBe(false);
    expect(report.statusCode).toBe("m075_s01_live_source_blocked");
    expect(report.checks.find((check) => check.id === "source.available")?.status).toBe("blocked");
    expect(report.observed.queryMetadata.mode).toBe("live");
  });

  test("live mode queries bounded last-12h and last-7d windows and counts malformed rows", async () => {
    const calls: Array<{ window: string; timespan: string; limit: number }> = [];
    const report = await evaluateM075S01Contract(parseM075S01Args(["--live"]), {
      generatedAt: "2026-05-20T14:00:00.000Z",
      readPackageJsonText: async () => packageJson(),
      liveCollectors: {
        discoverWorkspaces: async () => ["workspace-1"],
        queryLogs: async ({ window, timespan, limit }) => {
          calls.push({ window, timespan, limit });
          return {
            query: `ContainerAppConsoleLogs_CL | where TimeGenerated > ago(${timespan}) | project TimeGenerated, Log_s | take ${limit}`,
            rows: [
              row({ msg: "Knowledge store write failed (non-fatal): undefined persistence payload" }),
              row({ msg: "ACA Job completed status=succeeded revision ca-kodiai--0000076" }),
              row({ msg: "{not-json", parsedLog: null, malformed: true, rawLog: "{not-json" }),
            ],
          };
        },
      },
    });

    expect(report.success).toBe(true);
    expect(calls).toEqual([
      { window: "last12h", timespan: "PT12H", limit: 200 },
      { window: "last7d", timespan: "P7D", limit: 200 },
    ]);
    expect(report.observed.malformedRows).toBe(2);
    expect(report.observed.queryMetadata.windows.last12h.query).toContain("take 200");
    expect(JSON.stringify(report.baseline)).not.toContain("Log_s");
  });

  test("package wiring check fails when script is missing or drifted", async () => {
    const report = await evaluateM075S01Contract(parseM075S01Args(["--fixture", DEFAULT_FIXTURE_PATH]), {
      readPackageJsonText: async () => JSON.stringify({ scripts: {} }),
    });

    expect(report.success).toBe(false);
    expect(report.failedCheckIds).toContain("package-wiring.present");
    expect(report.issues).toContain(`package-wiring.present: expected ${COMMAND_NAME} -> ${EXPECTED_PACKAGE_SCRIPT}`);
  });

  test("exact downstream owner mapping is enforced for S02 through S06", async () => {
    const fixture = await asyncFixture((copy) => {
      copy.report.windows.last7d.issueClasses.find((issueClass) => issueClass.id === "addon-check.timeout")!.downstreamOwner = "S05";
    });
    const result = evaluateEvidence(fixture, { id: "package-wiring.present", status: "pass", message: "ok", issues: [] });

    expect(result.checks.find((check) => check.id === "owner.mapping.exact")?.status).toBe("fail");
    expect(result.checks.find((check) => check.id === "owner.mapping.exact")?.issues.join("\n")).toContain("addon-check.timeout downstreamOwner expected S06 got S05");
  });

  test("malformed fixture JSON and main invalid args return safe exit codes", async () => {
    const invalidJson = await evaluateM075S01Contract(parseM075S01Args(["--fixture", DEFAULT_FIXTURE_PATH]), {
      readFileText: async () => "{not-json",
      readPackageJsonText: async () => packageJson(),
    });
    expect(invalidJson.statusCode).toBe("m075_s01_invalid_json");
    expect(invalidJson.success).toBe(false);
    expect(await main(["--invalid"], { stdout: { write: () => undefined }, stderr: { write: () => undefined } })).toBe(2);
  });
});
