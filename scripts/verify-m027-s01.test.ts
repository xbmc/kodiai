import { describe, expect, test } from "bun:test";

type CombinedVerificationModule = {
  evaluateM027S01Checks: (deps: {
    runAudit: () => Promise<{ success: boolean; status_code: string; overall_status?: string }>;
    runRetrieverVerify: () => Promise<{
      success: boolean;
      status_code: string;
      query_embedding?: { status: string };
      not_in_retriever?: string[];
    }>;
  }) => Promise<{
    check_ids: string[];
    overallPassed: boolean;
    checks: Array<{
      id: string;
      passed: boolean;
      status_code: string;
      detail: string;
    }>;
  }>;
  renderM027S01Report: (report: {
    check_ids: string[];
    overallPassed: boolean;
    checks: Array<{
      id: string;
      passed: boolean;
      status_code: string;
      detail: string;
    }>;
  }) => string;
  main: (args: string[], deps?: {
    runAudit?: () => Promise<{ success: boolean; status_code: string; overall_status?: string }>;
    runRetrieverVerify?: () => Promise<{
      success: boolean;
      status_code: string;
      query_embedding?: { status: string };
      not_in_retriever?: string[];
    }>;
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
  }) => Promise<number> | number;
};

async function loadCombinedVerificationModule(): Promise<CombinedVerificationModule> {
  try {
    return await import("./verify-m027-s01.ts") as CombinedVerificationModule;
  } catch (error) {
    throw new Error(
      "Missing S01 implementation: expected scripts/verify-m027-s01.ts to export evaluateM027S01Checks(), renderM027S01Report(), and main() for bun run verify:m027:s01 --repo <repo> --query <query>.",
      { cause: error },
    );
  }
}

describe("combined S01 proof harness contract for scripts/verify-m027-s01.ts", () => {
  test("passes only when bun run audit:embeddings and bun run verify:retriever both pass", async () => {
    const module = await loadCombinedVerificationModule();

    const report = await module.evaluateM027S01Checks({
      runAudit: async () => ({
        success: true,
        status_code: "audit_ok",
        overall_status: "pass",
      }),
      runRetrieverVerify: async () => ({
        success: true,
        status_code: "retrieval_hits",
        query_embedding: { status: "generated" },
        not_in_retriever: ["issue_comments"],
      }),
    });

    expect(report.check_ids).toEqual(["M027-S01-AUDIT", "M027-S01-RETRIEVER"]);
    expect(report.overallPassed).toBe(true);
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "M027-S01-AUDIT",
        passed: true,
        status_code: "audit_ok",
      }),
      expect.objectContaining({
        id: "M027-S01-RETRIEVER",
        passed: true,
        status_code: "retrieval_hits",
        detail: expect.stringContaining("issue_comments"),
      }),
    ]);
  });

  test("fails loudly when the retriever surface reports query_embedding_unavailable instead of collapsing it into generic failure", async () => {
    const module = await loadCombinedVerificationModule();

    const report = await module.evaluateM027S01Checks({
      runAudit: async () => ({
        success: true,
        status_code: "audit_ok",
        overall_status: "pass",
      }),
      runRetrieverVerify: async () => ({
        success: false,
        status_code: "query_embedding_unavailable",
        query_embedding: { status: "unavailable" },
        not_in_retriever: ["issue_comments"],
      }),
    });

    expect(report.overallPassed).toBe(false);
    expect(report.checks.find((check) => check.id === "M027-S01-RETRIEVER")).toEqual(
      expect.objectContaining({
        passed: false,
        status_code: "query_embedding_unavailable",
        detail: expect.stringContaining("query_embedding_unavailable"),
      }),
    );

    const rendered = module.renderM027S01Report(report);
    expect(rendered).toContain("Final verdict: FAIL");
    expect(rendered).toContain("M027-S01-RETRIEVER");
    expect(rendered).toContain("query_embedding_unavailable");
  });

  test("main returns stable exit codes for bun run verify:m027:s01 --repo xbmc/xbmc --query 'json-rpc subtitle delay'", async () => {
    const module = await loadCombinedVerificationModule();

    const okStdout: string[] = [];
    const okExit = await module.main(["--repo", "xbmc/xbmc", "--query", "json-rpc subtitle delay"], {
      runAudit: async () => ({ success: true, status_code: "audit_ok", overall_status: "pass" }),
      runRetrieverVerify: async () => ({
        success: true,
        status_code: "retrieval_hits",
        query_embedding: { status: "generated" },
        not_in_retriever: ["issue_comments"],
      }),
      stdout: { write: (chunk: string) => void okStdout.push(chunk) },
      stderr: { write: () => undefined },
    });

    expect(okExit).toBe(0);
    expect(okStdout.join(" ")).toContain("Final verdict: PASS");

    const failStderr: string[] = [];
    const failExit = await module.main(["--repo", "xbmc/xbmc", "--query", "json-rpc subtitle delay"], {
      runAudit: async () => ({ success: false, status_code: "audit_failed", overall_status: "fail" }),
      runRetrieverVerify: async () => ({
        success: false,
        status_code: "query_embedding_unavailable",
        query_embedding: { status: "unavailable" },
        not_in_retriever: ["issue_comments"],
      }),
      stdout: { write: () => undefined },
      stderr: { write: (chunk: string) => void failStderr.push(chunk) },
    });

    expect(failExit).toBe(1);
    expect(failStderr.join(" ")).toContain("verify:m027:s01 failed");
    expect(failStderr.join(" ")).toContain("audit_failed");
    expect(failStderr.join(" ")).toContain("query_embedding_unavailable");
  });
});
