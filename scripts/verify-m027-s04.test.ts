import { describe, expect, test } from "bun:test";

type RetrieverReport = {
  success: boolean;
  status_code: string;
  query_embedding?: { status: string };
  not_in_retriever?: string[];
};

type AuditReport = {
  success: boolean;
  status_code: string;
  overall_status: string;
  corpora: Array<{
    corpus: string;
    status: string;
    severity: string;
    expected_model: string;
    actual_models: string[];
    model_mismatch: number;
    missing_or_null: number;
  }>;
};

type S01Report = {
  repo: string;
  query: string;
  generated_at: string;
  success: boolean;
  overallPassed: boolean;
  status_code: string;
  check_ids: string[];
  checks: Array<{
    id: string;
    passed: boolean;
    status_code: string;
    detail: string;
  }>;
  audit: AuditReport;
  retriever: RetrieverReport;
};

type WikiRepairReport = {
  command: "repair:wiki-embeddings";
  mode: "repair" | "status";
  success: boolean;
  status_code: string;
  target_model: string;
  requested_page_title: string | null;
  resumed: boolean;
  run: {
    run_id: string;
    status: "running" | "completed" | "failed" | "resume_required" | "not_needed";
    page_id: number | null;
    page_title: string | null;
    window_index: number | null;
    windows_total: number | null;
    repaired: number;
    skipped: number;
    failed: number;
    retry_count: number;
    failure_summary: {
      by_class: Record<string, number>;
      last_failure_class: string | null;
      last_failure_message: string | null;
    };
    used_split_fallback: boolean;
    updated_at: string;
  };
};

type S02Report = {
  command: "verify:m027:s02";
  generated_at: string;
  page_title: string | null;
  success: boolean;
  overallPassed: boolean;
  status_code: string;
  check_ids: string[];
  checks: Array<{
    id: string;
    passed: boolean;
    status_code: string;
    detail: string;
  }>;
  repair_evidence: WikiRepairReport;
  status_evidence: WikiRepairReport;
  audit_evidence: AuditReport;
};

type EmbeddingRepairCorpus = "review_comments" | "learning_memories" | "code_snippets" | "issues" | "issue_comments";

type NonWikiRepairReport = {
  command: "repair:embeddings";
  mode: "repair" | "status";
  success: boolean;
  status_code: string;
  corpus: EmbeddingRepairCorpus;
  target_model: string;
  resumed: boolean;
  dry_run: boolean;
  run: {
    run_id: string;
    status: "running" | "completed" | "failed" | "resume_required" | "not_needed";
    corpus: EmbeddingRepairCorpus;
    batch_index: number | null;
    batches_total: number | null;
    last_row_id: number | null;
    processed: number;
    repaired: number;
    skipped: number;
    failed: number;
    failure_summary: {
      by_class: Record<string, number>;
      last_failure_class: string | null;
      last_failure_message: string | null;
    };
    updated_at: string;
  };
};

type S03Report = {
  command: "verify:m027:s03";
  generated_at: string;
  corpus: EmbeddingRepairCorpus;
  noop_corpus: EmbeddingRepairCorpus;
  success: boolean;
  overallPassed: boolean;
  status_code: string;
  check_ids: string[];
  checks: Array<{
    id: string;
    passed: boolean;
    status_code: string;
    detail: string;
  }>;
  repair_evidence: NonWikiRepairReport;
  status_evidence: NonWikiRepairReport;
  noop_probe_evidence: NonWikiRepairReport;
  audit_evidence: AuditReport;
};

type VerifyM027S04Module = {
  parseVerifyM027S04Args: (args: string[]) => {
    help?: boolean;
    json?: boolean;
    repo?: string;
    query?: string;
    pageTitle?: string;
    corpus?: EmbeddingRepairCorpus;
  };
  evaluateM027S04Checks: (deps: {
    runS01: () => Promise<S01Report>;
    runS02: () => Promise<S02Report>;
    runS03: () => Promise<S03Report>;
  }) => Promise<{
    check_ids: string[];
    overallPassed: boolean;
    status_code: string;
    checks: Array<{
      id: string;
      passed: boolean;
      status_code: string;
      detail: string;
    }>;
    s01: S01Report;
    s02: S02Report;
    s03: S03Report;
  }>;
  renderM027S04Report: (report: {
    check_ids: string[];
    overallPassed: boolean;
    status_code: string;
    checks: Array<{
      id: string;
      passed: boolean;
      status_code: string;
      detail: string;
    }>;
    s01: S01Report;
    s02: S02Report;
    s03: S03Report;
  }) => string;
  main: (args: string[], deps?: {
    runS01?: () => Promise<S01Report>;
    runS02?: () => Promise<S02Report>;
    runS03?: () => Promise<S03Report>;
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
  }) => Promise<number> | number;
};

async function loadVerifyM027S04Module(): Promise<VerifyM027S04Module> {
  try {
    return await import("./verify-m027-s04.ts") as unknown as VerifyM027S04Module;
  } catch (error) {
    throw new Error(
      "Missing S04 implementation: expected scripts/verify-m027-s04.ts to export parseVerifyM027S04Args(), evaluateM027S04Checks(), renderM027S04Report(), and main() for bun run verify:m027:s04 -- --repo <owner/repo> --query <text> --page-title <title> --corpus <name> [--json].",
      { cause: error },
    );
  }
}

function makeFullAuditReport(overrides: Partial<AuditReport> = {}): AuditReport {
  return {
    success: true,
    status_code: "audit_ok",
    overall_status: "pass",
    corpora: [
      {
        corpus: "wiki_pages",
        status: "pass",
        severity: "info",
        expected_model: "voyage-context-3",
        actual_models: ["voyage-context-3"],
        model_mismatch: 0,
        missing_or_null: 0,
      },
      {
        corpus: "issues",
        status: "pass",
        severity: "info",
        expected_model: "voyage-code-3",
        actual_models: ["voyage-code-3"],
        model_mismatch: 0,
        missing_or_null: 0,
      },
      {
        corpus: "issue_comments",
        status: "pass",
        severity: "info",
        expected_model: "voyage-code-3",
        actual_models: ["voyage-code-3"],
        model_mismatch: 0,
        missing_or_null: 0,
      },
      {
        corpus: "review_comments",
        status: "pass",
        severity: "info",
        expected_model: "voyage-code-3",
        actual_models: ["voyage-code-3"],
        model_mismatch: 0,
        missing_or_null: 0,
      },
      {
        corpus: "code_snippets",
        status: "pass",
        severity: "info",
        expected_model: "voyage-code-3",
        actual_models: ["voyage-code-3"],
        model_mismatch: 0,
        missing_or_null: 0,
      },
      {
        corpus: "learning_memories",
        status: "pass",
        severity: "info",
        expected_model: "voyage-code-3",
        actual_models: ["voyage-code-3"],
        model_mismatch: 0,
        missing_or_null: 0,
      },
    ],
    ...overrides,
  };
}

function makeS01Report(overrides: Partial<S01Report> = {}): S01Report {
  return {
    repo: "xbmc/xbmc",
    query: "json-rpc subtitle delay",
    generated_at: "2026-03-12T12:30:00.000Z",
    success: true,
    overallPassed: true,
    status_code: "m027_s01_ok",
    check_ids: ["M027-S01-AUDIT", "M027-S01-RETRIEVER"],
    checks: [
      {
        id: "M027-S01-AUDIT",
        passed: true,
        status_code: "audit_ok",
        detail: "audit status_code=audit_ok overall_status=pass",
      },
      {
        id: "M027-S01-RETRIEVER",
        passed: true,
        status_code: "retrieval_hits",
        detail: "retriever status_code=retrieval_hits query_embedding=generated not_in_retriever=issue_comments",
      },
    ],
    audit: makeFullAuditReport(),
    retriever: {
      success: true,
      status_code: "retrieval_hits",
      query_embedding: { status: "generated" },
      not_in_retriever: ["issue_comments"],
    },
    ...overrides,
  };
}

function makeWikiRepairEvidence(overrides: Partial<WikiRepairReport> = {}): WikiRepairReport {
  return {
    command: "repair:wiki-embeddings",
    mode: "repair",
    success: true,
    status_code: "repair_completed",
    target_model: "voyage-context-3",
    requested_page_title: "JSON-RPC API/v8",
    resumed: false,
    run: {
      run_id: "wiki-repair-2026-03-12T12:00:00.000Z",
      status: "completed",
      page_id: 881,
      page_title: "JSON-RPC API/v8",
      window_index: 3,
      windows_total: 4,
      repaired: 12,
      skipped: 0,
      failed: 0,
      retry_count: 1,
      failure_summary: {
        by_class: {},
        last_failure_class: null,
        last_failure_message: null,
      },
      used_split_fallback: true,
      updated_at: "2026-03-12T12:10:00.000Z",
    },
    ...overrides,
  };
}

function makeS02Report(overrides: Partial<S02Report> = {}): S02Report {
  return {
    command: "verify:m027:s02",
    generated_at: "2026-03-12T12:31:00.000Z",
    page_title: "JSON-RPC API/v8",
    success: false,
    overallPassed: false,
    status_code: "m027_s02_failed",
    check_ids: ["M027-S02-REPAIR", "M027-S02-STATUS", "M027-S02-AUDIT"],
    checks: [
      {
        id: "M027-S02-REPAIR",
        passed: false,
        status_code: "repair_not_needed",
        detail: "status_code=repair_not_needed run_status=not_needed page_title=JSON-RPC API/v8 window=none repaired=0 failed=0 retry_count=0 used_split_fallback=false last_failure_class=none",
      },
      {
        id: "M027-S02-STATUS",
        passed: true,
        status_code: "repair_completed",
        detail: "status_code=repair_completed run_status=completed cursor_page_title=JSON-RPC API/v8 window=4/4 repaired=12 failed=0 failure_classes=none last_failure_class=none",
      },
      {
        id: "M027-S02-AUDIT",
        passed: true,
        status_code: "audit_ok",
        detail: "status_code=audit_ok overall_status=pass wiki_status=pass",
      },
    ],
    repair_evidence: makeWikiRepairEvidence({
      status_code: "repair_not_needed",
      run: {
        run_id: "wiki-repair-2026-03-12T12:00:00.000Z",
        status: "not_needed",
        page_id: 881,
        page_title: "JSON-RPC API/v8",
        window_index: null,
        windows_total: null,
        repaired: 0,
        skipped: 0,
        failed: 0,
        retry_count: 0,
        failure_summary: {
          by_class: {},
          last_failure_class: null,
          last_failure_message: null,
        },
        used_split_fallback: false,
        updated_at: "2026-03-12T12:11:00.000Z",
      },
    }),
    status_evidence: makeWikiRepairEvidence({ mode: "status" }),
    audit_evidence: makeFullAuditReport(),
    ...overrides,
  };
}

function makeNonWikiRepairEvidence(overrides: Partial<NonWikiRepairReport> = {}): NonWikiRepairReport {
  return {
    command: "repair:embeddings",
    mode: "repair",
    success: true,
    status_code: "repair_not_needed",
    corpus: "review_comments",
    target_model: "voyage-code-3",
    resumed: false,
    dry_run: false,
    run: {
      run_id: "embedding-repair-review_comments-2026-03-12T12:20:00.000Z",
      status: "not_needed",
      corpus: "review_comments",
      batch_index: null,
      batches_total: null,
      last_row_id: 3033,
      processed: 0,
      repaired: 0,
      skipped: 0,
      failed: 0,
      failure_summary: {
        by_class: {},
        last_failure_class: null,
        last_failure_message: null,
      },
      updated_at: "2026-03-12T12:20:00.000Z",
    },
    ...overrides,
  };
}

function makeS03Report(overrides: Partial<S03Report> = {}): S03Report {
  return {
    command: "verify:m027:s03",
    generated_at: "2026-03-12T12:32:00.000Z",
    corpus: "review_comments",
    noop_corpus: "issues",
    success: true,
    overallPassed: true,
    status_code: "m027_s03_ok",
    check_ids: ["M027-S03-REPAIR", "M027-S03-STATUS", "M027-S03-NOOP", "M027-S03-AUDIT"],
    checks: [
      {
        id: "M027-S03-REPAIR",
        passed: true,
        status_code: "repair_not_needed",
        detail: "status_code=repair_not_needed run_status=not_needed corpus=review_comments",
      },
      {
        id: "M027-S03-STATUS",
        passed: true,
        status_code: "repair_completed",
        detail: "status_code=repair_completed run_status=completed corpus=review_comments cursor_last_row_id=3033 batch=2/2 processed=4 repaired=4 failed=0 failure_classes=none last_failure_class=none",
      },
      {
        id: "M027-S03-NOOP",
        passed: true,
        status_code: "repair_not_needed",
        detail: "status_code=repair_not_needed run_status=not_needed corpus=issues",
      },
      {
        id: "M027-S03-AUDIT",
        passed: true,
        status_code: "audit_ok",
        detail: "status_code=audit_ok overall_status=pass review_comments:status=pass issues:status=pass",
      },
    ],
    repair_evidence: makeNonWikiRepairEvidence(),
    status_evidence: makeNonWikiRepairEvidence({
      mode: "status",
      status_code: "repair_completed",
      run: {
        run_id: "embedding-repair-review_comments-2026-03-12T12:15:00.000Z",
        status: "completed",
        corpus: "review_comments",
        batch_index: 1,
        batches_total: 2,
        last_row_id: 3033,
        processed: 4,
        repaired: 4,
        skipped: 0,
        failed: 0,
        failure_summary: {
          by_class: {},
          last_failure_class: null,
          last_failure_message: null,
        },
        updated_at: "2026-03-12T12:15:00.000Z",
      },
    }),
    noop_probe_evidence: makeNonWikiRepairEvidence({
      corpus: "issues",
      dry_run: true,
      run: {
        run_id: "embedding-repair-issues-2026-03-12T12:25:00.000Z",
        status: "not_needed",
        corpus: "issues",
        batch_index: null,
        batches_total: null,
        last_row_id: null,
        processed: 0,
        repaired: 0,
        skipped: 0,
        failed: 0,
        failure_summary: {
          by_class: {},
          last_failure_class: null,
          last_failure_message: null,
        },
        updated_at: "2026-03-12T12:25:00.000Z",
      },
    }),
    audit_evidence: makeFullAuditReport(),
    ...overrides,
  };
}

describe("final integrated S04 proof harness contract for scripts/verify-m027-s04.ts", () => {
  test("passes only when the full audit, live retriever, wiki durable status, and non-wiki durable status all pass while preserving nested raw s01/s02/s03 evidence", async () => {
    const module = await loadVerifyM027S04Module();

    const s01 = makeS01Report();
    const s02 = makeS02Report();
    const s03 = makeS03Report();

    const report = await module.evaluateM027S04Checks({
      runS01: async () => s01,
      runS02: async () => s02,
      runS03: async () => s03,
    });

    expect(report.check_ids).toEqual([
      "M027-S04-FULL-AUDIT",
      "M027-S04-RETRIEVER",
      "M027-S04-WIKI-REPAIR-STATE",
      "M027-S04-NON-WIKI-REPAIR-STATE",
    ]);
    expect(report.overallPassed).toBe(true);
    expect(report.status_code).toBe("m027_s04_ok");
    expect(report.checks).toEqual([
      expect.objectContaining({ id: "M027-S04-FULL-AUDIT", passed: true, status_code: "audit_ok" }),
      expect.objectContaining({ id: "M027-S04-RETRIEVER", passed: true, status_code: "retrieval_hits" }),
      expect.objectContaining({ id: "M027-S04-WIKI-REPAIR-STATE", passed: true, status_code: "repair_completed" }),
      expect.objectContaining({ id: "M027-S04-NON-WIKI-REPAIR-STATE", passed: true, status_code: "repair_completed" }),
    ]);
    expect(report.s01).toEqual(s01);
    expect(report.s02).toEqual(s02);
    expect(report.s03).toEqual(s03);

    const rendered = module.renderM027S04Report(report);
    expect(rendered).toContain("Final verdict: PASS");
    expect(rendered).toContain("M027-S04-FULL-AUDIT");
    expect(rendered).toContain("M027-S04-RETRIEVER");
    expect(rendered).toContain("issue_comments");
    expect(rendered).toContain("repair_not_needed");
  });

  test("fails for the right reason when the milestone-wide audit regresses even if slice-local wiki and non-wiki proof reports still look green", async () => {
    const module = await loadVerifyM027S04Module();

    const report = await module.evaluateM027S04Checks({
      runS01: async () => makeS01Report({
        success: false,
        overallPassed: false,
        status_code: "m027_s01_failed",
        checks: [
          {
            id: "M027-S01-AUDIT",
            passed: false,
            status_code: "audit_failed",
            detail: "audit status_code=audit_failed overall_status=fail",
          },
          {
            id: "M027-S01-RETRIEVER",
            passed: true,
            status_code: "retrieval_hits",
            detail: "retriever status_code=retrieval_hits query_embedding=generated not_in_retriever=issue_comments",
          },
        ],
        audit: makeFullAuditReport({
          success: false,
          status_code: "audit_failed",
          overall_status: "fail",
          corpora: makeFullAuditReport().corpora.map((corpus) => corpus.corpus === "code_snippets"
            ? { ...corpus, status: "fail", severity: "critical", missing_or_null: 9 }
            : corpus),
        }),
      }),
      runS02: async () => makeS02Report(),
      runS03: async () => makeS03Report(),
    });

    expect(report.overallPassed).toBe(false);
    expect(report.status_code).toBe("m027_s04_failed");
    expect(report.checks.find((check) => check.id === "M027-S04-FULL-AUDIT")).toEqual(
      expect.objectContaining({
        passed: false,
        status_code: "audit_failed",
        detail: expect.stringContaining("code_snippets"),
      }),
    );
  });

  test("fails loudly when live retrieval cannot generate the query embedding instead of flattening retriever degradation into a generic milestone failure", async () => {
    const module = await loadVerifyM027S04Module();

    const report = await module.evaluateM027S04Checks({
      runS01: async () => makeS01Report({
        success: false,
        overallPassed: false,
        status_code: "m027_s01_failed",
        checks: [
          {
            id: "M027-S01-AUDIT",
            passed: true,
            status_code: "audit_ok",
            detail: "audit status_code=audit_ok overall_status=pass",
          },
          {
            id: "M027-S01-RETRIEVER",
            passed: false,
            status_code: "query_embedding_unavailable",
            detail: "retriever status_code=query_embedding_unavailable query_embedding=unavailable not_in_retriever=issue_comments",
          },
        ],
        retriever: {
          success: false,
          status_code: "query_embedding_unavailable",
          query_embedding: { status: "unavailable" },
          not_in_retriever: ["issue_comments"],
        },
      }),
      runS02: async () => makeS02Report(),
      runS03: async () => makeS03Report(),
    });

    expect(report.overallPassed).toBe(false);
    expect(report.checks.find((check) => check.id === "M027-S04-RETRIEVER")).toEqual(
      expect.objectContaining({
        passed: false,
        status_code: "query_embedding_unavailable",
        detail: expect.stringContaining("query_embedding_unavailable"),
      }),
    );

    const rendered = module.renderM027S04Report(report);
    expect(rendered).toContain("Final verdict: FAIL");
    expect(rendered).toContain("M027-S04-RETRIEVER");
    expect(rendered).toContain("query_embedding_unavailable");
  });

  test("fails with a resume-required milestone verdict when wiki or non-wiki durable status drifts back to repair_resume_available", async () => {
    const module = await loadVerifyM027S04Module();

    const wikiResume = await module.evaluateM027S04Checks({
      runS01: async () => makeS01Report(),
      runS02: async () => makeS02Report({
        success: false,
        overallPassed: false,
        status_code: "m027_s02_resume_required",
        checks: [
          makeS02Report().checks[0]!,
          {
            id: "M027-S02-STATUS",
            passed: false,
            status_code: "repair_resume_available",
            detail: "status_code=repair_resume_available run_status=resume_required cursor_page_title=JSON-RPC API/v8 window=2/4 repaired=6 failed=1 failure_classes=timeout_transient last_failure_class=timeout_transient",
          },
          makeS02Report().checks[2]!,
        ],
        status_evidence: makeWikiRepairEvidence({
          mode: "status",
          success: false,
          status_code: "repair_resume_available",
          run: {
            run_id: "wiki-repair-2026-03-12T12:00:00.000Z",
            status: "resume_required",
            page_id: 881,
            page_title: "JSON-RPC API/v8",
            window_index: 1,
            windows_total: 4,
            repaired: 6,
            skipped: 0,
            failed: 1,
            retry_count: 2,
            failure_summary: {
              by_class: { timeout_transient: 2 },
              last_failure_class: "timeout_transient",
              last_failure_message: "provider timed out after retry budget",
            },
            used_split_fallback: true,
            updated_at: "2026-03-12T12:05:00.000Z",
          },
        }),
      }),
      runS03: async () => makeS03Report(),
    });

    expect(wikiResume.overallPassed).toBe(false);
    expect(wikiResume.status_code).toBe("m027_s04_resume_required");
    expect(wikiResume.checks.find((check) => check.id === "M027-S04-WIKI-REPAIR-STATE")).toEqual(
      expect.objectContaining({
        passed: false,
        status_code: "repair_resume_available",
        detail: expect.stringContaining("timeout_transient"),
      }),
    );

    const nonWikiResume = await module.evaluateM027S04Checks({
      runS01: async () => makeS01Report(),
      runS02: async () => makeS02Report(),
      runS03: async () => makeS03Report({
        success: false,
        overallPassed: false,
        status_code: "m027_s03_resume_required",
        checks: [
          makeS03Report().checks[0]!,
          {
            id: "M027-S03-STATUS",
            passed: false,
            status_code: "repair_resume_available",
            detail: "status_code=repair_resume_available run_status=resume_required corpus=review_comments cursor_last_row_id=1516 batch=1/2 processed=2 repaired=2 failed=1 failure_classes=timeout_transient=2 last_failure_class=timeout_transient",
          },
          makeS03Report().checks[2]!,
          makeS03Report().checks[3]!,
        ],
        status_evidence: makeNonWikiRepairEvidence({
          mode: "status",
          success: false,
          status_code: "repair_resume_available",
          run: {
            run_id: "embedding-repair-review_comments-2026-03-12T12:00:00.000Z",
            status: "resume_required",
            corpus: "review_comments",
            batch_index: 0,
            batches_total: 2,
            last_row_id: 1516,
            processed: 2,
            repaired: 2,
            skipped: 0,
            failed: 1,
            failure_summary: {
              by_class: { timeout_transient: 2 },
              last_failure_class: "timeout_transient",
              last_failure_message: "provider timed out after retry budget",
            },
            updated_at: "2026-03-12T12:05:00.000Z",
          },
        }),
      }),
    });

    expect(nonWikiResume.overallPassed).toBe(false);
    expect(nonWikiResume.status_code).toBe("m027_s04_resume_required");
    expect(nonWikiResume.checks.find((check) => check.id === "M027-S04-NON-WIKI-REPAIR-STATE")).toEqual(
      expect.objectContaining({
        passed: false,
        status_code: "repair_resume_available",
        detail: expect.stringContaining("review_comments"),
      }),
    );
  });

  test("fails if the retriever proof stops surfacing issue_comments under not_in_retriever so the final milestone proof cannot overstate live coverage", async () => {
    const module = await loadVerifyM027S04Module();

    const report = await module.evaluateM027S04Checks({
      runS01: async () => makeS01Report({
        retriever: {
          success: true,
          status_code: "retrieval_hits",
          query_embedding: { status: "generated" },
          not_in_retriever: [],
        },
        checks: [
          {
            id: "M027-S01-AUDIT",
            passed: true,
            status_code: "audit_ok",
            detail: "audit status_code=audit_ok overall_status=pass",
          },
          {
            id: "M027-S01-RETRIEVER",
            passed: true,
            status_code: "retrieval_hits",
            detail: "retriever status_code=retrieval_hits query_embedding=generated not_in_retriever=none",
          },
        ],
      }),
      runS02: async () => makeS02Report(),
      runS03: async () => makeS03Report(),
    });

    expect(report.overallPassed).toBe(false);
    expect(report.status_code).toBe("m027_s04_failed");
    expect(report.checks.find((check) => check.id === "M027-S04-RETRIEVER")).toEqual(
      expect.objectContaining({
        passed: false,
        status_code: "retriever_scope_mismatch",
        detail: expect.stringContaining("issue_comments"),
      }),
    );
  });

  test("main returns stable exit codes and emits the final JSON envelope with nested s01/s02/s03 evidence for bun run verify:m027:s04", async () => {
    const module = await loadVerifyM027S04Module();

    const okStdout: string[] = [];
    const okExit = await module.main([
      "--repo",
      "xbmc/xbmc",
      "--query",
      "json-rpc subtitle delay",
      "--page-title",
      "JSON-RPC API/v8",
      "--corpus",
      "review_comments",
      "--json",
    ], {
      runS01: async () => makeS01Report(),
      runS02: async () => makeS02Report(),
      runS03: async () => makeS03Report(),
      stdout: { write: (chunk: string) => void okStdout.push(chunk) },
      stderr: { write: () => undefined },
    });

    expect(okExit).toBe(0);
    expect(JSON.parse(okStdout.join(""))).toMatchObject({
      overallPassed: true,
      status_code: "m027_s04_ok",
      check_ids: [
        "M027-S04-FULL-AUDIT",
        "M027-S04-RETRIEVER",
        "M027-S04-WIKI-REPAIR-STATE",
        "M027-S04-NON-WIKI-REPAIR-STATE",
      ],
      s01: { status_code: "m027_s01_ok" },
      s02: { status_code: "m027_s02_failed" },
      s03: { status_code: "m027_s03_ok" },
    });

    const failStderr: string[] = [];
    const failExit = await module.main([
      "--repo",
      "xbmc/xbmc",
      "--query",
      "json-rpc subtitle delay",
      "--page-title",
      "JSON-RPC API/v8",
      "--corpus",
      "review_comments",
      "--json",
    ], {
      runS01: async () => makeS01Report({
        success: false,
        overallPassed: false,
        status_code: "m027_s01_failed",
        retriever: {
          success: false,
          status_code: "query_embedding_unavailable",
          query_embedding: { status: "unavailable" },
          not_in_retriever: ["issue_comments"],
        },
        checks: [
          {
            id: "M027-S01-AUDIT",
            passed: true,
            status_code: "audit_ok",
            detail: "audit status_code=audit_ok overall_status=pass",
          },
          {
            id: "M027-S01-RETRIEVER",
            passed: false,
            status_code: "query_embedding_unavailable",
            detail: "retriever status_code=query_embedding_unavailable query_embedding=unavailable not_in_retriever=issue_comments",
          },
        ],
      }),
      runS02: async () => makeS02Report(),
      runS03: async () => makeS03Report(),
      stdout: { write: () => undefined },
      stderr: { write: (chunk: string) => void failStderr.push(chunk) },
    });

    expect(failExit).toBe(1);
    expect(failStderr.join(" ")).toContain("verify:m027:s04 failed");
    expect(failStderr.join(" ")).toContain("query_embedding_unavailable");
    expect(failStderr.join(" ")).toContain("M027-S04-RETRIEVER");
  });
});
