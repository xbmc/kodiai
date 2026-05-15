export const ISSUE_131_STATUSES = ["complete", "partial", "missing", "deferred"] as const;
export type Issue131Status = typeof ISSUE_131_STATUSES[number];

export type Issue131IssueCategory =
  | "missing_source"
  | "weak_evidence"
  | "forbidden_evidence_path"
  | "raw_field_leak"
  | "unwired_package_script"
  | "deferred_owner"
  | "schema_gap"
  | "normal_path_gap";

export type Issue131Evidence = {
  path: string;
  reason: string;
};

export type Issue131MatrixRow = {
  id: Issue131RowId;
  title: string;
  status: Issue131Status;
  requirementRefs: readonly string[];
  decisionRefs: readonly string[];
  evidence: readonly Issue131Evidence[];
  issueCategories: readonly Issue131IssueCategory[];
  failureReasons: readonly string[];
  deferredTo?: {
    milestone: "M072" | "M073" | "M074" | "M075";
    slice: string;
    reason: string;
  };
};

export type Issue131Check = {
  id: Issue131CheckId;
  passed: boolean;
  status: "passed" | "failed";
  issueCategories: readonly Issue131IssueCategory[];
  detail: string;
};

export type Issue131EvidenceMatrixReport = {
  command: "verify:m071";
  generatedAt: string;
  success: boolean;
  statusCode: "m071_issue_131_matrix_ok" | "m071_issue_131_matrix_failed";
  checkIds: readonly Issue131CheckId[];
  checks: readonly Issue131Check[];
  rows: readonly Issue131MatrixRow[];
  counts: Record<Issue131Status, number>;
  issues: readonly string[];
};

export type Issue131EvidenceReaders = {
  readFileText: (path: Issue131SourcePath) => string | undefined;
  readPackageJsonText: () => string | undefined;
  generatedAt?: string;
};

export const ISSUE_131_CHECK_IDS = [
  "M071-ISSUE-131-STATUS-TAXONOMY",
  "M071-ISSUE-131-EVIDENCE-PATHS",
  "M071-ISSUE-131-ROW-CLASSIFICATION",
  "M071-ISSUE-131-DEFERRED-OWNERSHIP",
  "M071-ISSUE-131-PACKAGE-WIRING",
  "M071-ISSUE-131-REPORT-SAFETY",
] as const;
export type Issue131CheckId = typeof ISSUE_131_CHECK_IDS[number];

export const ISSUE_131_SOURCE_PATHS = [
  "src/handlers/review.ts",
  "src/execution/config.ts",
  "src/review-graph/validation.ts",
  "package.json",
] as const;
export type Issue131SourcePath = typeof ISSUE_131_SOURCE_PATHS[number];

export const ISSUE_131_ROW_IDS = [
  "review-plan-contract",
  "normal-handler-plan-construction",
  "review-details-plan-summary",
  "typed-graph-validation-config",
  "truthful-graph-validation-status",
  "candidate-finding-mcp-publication-bridge",
  "reducer-extraction",
  "specialist-lane-proof",
  "metrics-tier-closure",
  "package-verifier-wiring",
] as const;
export type Issue131RowId = typeof ISSUE_131_ROW_IDS[number];

type RowDefinition = {
  id: Issue131RowId;
  title: string;
  requirementRefs: readonly string[];
  decisionRefs: readonly string[];
  issueCategory: Issue131IssueCategory;
  deferredTo?: Issue131MatrixRow["deferredTo"];
};

const ROW_DEFINITIONS: readonly RowDefinition[] = [
  {
    id: "review-plan-contract",
    title: "Typed ReviewPlan contract exists as a source-owned seam",
    requirementRefs: ["R125"],
    decisionRefs: ["D238", "D239"],
    issueCategory: "missing_source",
  },
  {
    id: "normal-handler-plan-construction",
    title: "Normal review handler constructs ReviewPlan before publication side effects",
    requirementRefs: ["R125", "R129"],
    decisionRefs: ["D238", "D240"],
    issueCategory: "normal_path_gap",
  },
  {
    id: "review-details-plan-summary",
    title: "Review Details includes compact, bounded plan summary evidence",
    requirementRefs: ["R125"],
    decisionRefs: ["D241"],
    issueCategory: "weak_evidence",
  },
  {
    id: "typed-graph-validation-config",
    title: "review.graphValidation.enabled is typed, parsed, and preserved",
    requirementRefs: ["R125"],
    decisionRefs: ["D238", "D242"],
    issueCategory: "schema_gap",
  },
  {
    id: "truthful-graph-validation-status",
    title: "Graph-validation status is surfaced truthfully and fail-open",
    requirementRefs: ["R125"],
    decisionRefs: ["D242"],
    issueCategory: "weak_evidence",
  },
  {
    id: "candidate-finding-mcp-publication-bridge",
    title: "Candidate-finding MCP/publication bridge is implemented",
    requirementRefs: ["R129"],
    decisionRefs: ["D240"],
    issueCategory: "deferred_owner",
    deferredTo: { milestone: "M072", slice: "S01", reason: "Owned by the follow-up candidate-publication implementation milestone." },
  },
  {
    id: "reducer-extraction",
    title: "Review plan reducer is extracted from handler flow",
    requirementRefs: ["R125"],
    decisionRefs: ["D239"],
    issueCategory: "deferred_owner",
    deferredTo: { milestone: "M073", slice: "S01", reason: "Owned by the reducer extraction milestone." },
  },
  {
    id: "specialist-lane-proof",
    title: "Specialist lane proof is available for issue #131 acceptance",
    requirementRefs: ["R129"],
    decisionRefs: ["D240"],
    issueCategory: "deferred_owner",
    deferredTo: { milestone: "M074", slice: "S01", reason: "Owned by the specialist proof milestone." },
  },
  {
    id: "metrics-tier-closure",
    title: "Metrics and tier closure evidence is wired",
    requirementRefs: ["R129"],
    decisionRefs: ["D241"],
    issueCategory: "deferred_owner",
    deferredTo: { milestone: "M075", slice: "S01", reason: "Owned by the metrics/tier closure milestone." },
  },
  {
    id: "package-verifier-wiring",
    title: "Package script exposes verify:m071 for the evidence matrix",
    requirementRefs: ["R125"],
    decisionRefs: ["D238"],
    issueCategory: "unwired_package_script",
  },
];

const FORBIDDEN_PATH_PREFIXES = [".gsd/", ".planning/", ".audits/"] as const;
const FORBIDDEN_REPORT_KEYS = new Set([
  "prompt",
  "rawPrompt",
  "modelPrompt",
  "modelOutput",
  "rawModelOutput",
  "commentBody",
  "rawCommentBody",
  "body",
  "diff",
  "rawDiff",
]);

export function isIssue131Status(value: string): value is Issue131Status {
  return (ISSUE_131_STATUSES as readonly string[]).includes(value);
}

export function validateIssue131EvidencePath(path: string): { valid: true } | { valid: false; reason: string } {
  const trimmed = path.trim();
  if (trimmed.length === 0) return { valid: false, reason: "Evidence path is empty." };
  if (trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    return { valid: false, reason: `Evidence path must be repo-relative: ${path}` };
  }
  if (trimmed.includes("\\")) return { valid: false, reason: `Evidence path must use forward slashes: ${path}` };
  if (trimmed === "." || trimmed.includes("../") || trimmed.startsWith("../")) {
    return { valid: false, reason: `Evidence path must not traverse directories: ${path}` };
  }
  for (const prefix of FORBIDDEN_PATH_PREFIXES) {
    if (trimmed === prefix.slice(0, -1) || trimmed.startsWith(prefix)) {
      return { valid: false, reason: `Evidence path is forbidden for issue #131 source evidence: ${path}` };
    }
  }
  return { valid: true };
}

export function evaluateIssue131EvidenceMatrix(readers: Issue131EvidenceReaders): Issue131EvidenceMatrixReport {
  const source = {
    review: readers.readFileText("src/handlers/review.ts") ?? "",
    config: readers.readFileText("src/execution/config.ts") ?? "",
    validation: readers.readFileText("src/review-graph/validation.ts") ?? "",
    packageJson: readers.readPackageJsonText() ?? "",
  };

  const rows = ROW_DEFINITIONS.map((definition) => classifyRow(definition, source));
  const issues = collectRowIssues(rows);
  const checks = buildChecks(rows, source.packageJson, issues);
  const allCheckIssues = checks.flatMap((check) => check.passed ? [] : [check.detail]);
  const counts = countStatuses(rows);
  const success = checks.every((check) => check.passed);

  return {
    command: "verify:m071",
    generatedAt: readers.generatedAt ?? new Date().toISOString(),
    success,
    statusCode: success ? "m071_issue_131_matrix_ok" : "m071_issue_131_matrix_failed",
    checkIds: ISSUE_131_CHECK_IDS,
    checks,
    rows,
    counts,
    issues: [...issues, ...allCheckIssues],
  };
}

function classifyRow(definition: RowDefinition, source: { review: string; config: string; validation: string; packageJson: string }): Issue131MatrixRow {
  if (definition.deferredTo) {
    return makeRow(definition, "deferred", [], [], definition.deferredTo);
  }

  switch (definition.id) {
    case "review-plan-contract": {
      const hasTypedContract = /export\s+type\s+ReviewPlan\b|export\s+interface\s+ReviewPlan\b/.test(source.review);
      return hasTypedContract
        ? makeRow(definition, "complete", [{ path: "src/handlers/review.ts", reason: "Exports a typed ReviewPlan contract." }])
        : makeRow(definition, "missing", [], ["No exported ReviewPlan type/interface was found in the review handler surface."]);
    }
    case "normal-handler-plan-construction": {
      const hasContract = /\bReviewPlan\b/.test(source.review);
      const constructsBeforePublication = /\b(build|create|resolve)ReviewPlan\b/.test(source.review)
        && source.review.indexOf("ReviewPlan") >= 0
        && source.review.indexOf("ReviewPlan") < firstPublicationIndex(source.review);
      if (hasContract && constructsBeforePublication) {
        return makeRow(definition, "complete", [{ path: "src/handlers/review.ts", reason: "Normal review flow constructs a ReviewPlan before publication code." }]);
      }
      if (hasContract) {
        return makeRow(definition, "partial", [{ path: "src/handlers/review.ts", reason: "ReviewPlan is mentioned, but normal-path construction before publication is not proven." }], ["ReviewPlan naming exists without a normal-path construction seam before publication side effects."]);
      }
      return makeRow(definition, "missing", [], ["No ReviewPlan construction seam was found in normal review-handler flow."]);
    }
    case "review-details-plan-summary": {
      const hasReviewDetails = source.review.includes("formatReviewDetailsSummary") && source.review.includes("<summary>Review Details</summary>");
      const hasPlanSummary = /ReviewPlan|planSummary|reviewPlanSummary/i.test(source.review);
      if (hasReviewDetails && hasPlanSummary) {
        return makeRow(definition, "complete", [{ path: "src/handlers/review.ts", reason: "Review Details publication includes plan-summary evidence." }]);
      }
      if (hasReviewDetails) {
        return makeRow(definition, "partial", [{ path: "src/handlers/review.ts", reason: "Review Details publication exists, but no bounded ReviewPlan summary is wired." }], ["Review Details exists without a compact ReviewPlan summary field."]);
      }
      return makeRow(definition, "missing", [], ["Review Details summary publication evidence was not found."]);
    }
    case "typed-graph-validation-config": {
      const reviewUsesGraphValidation = source.review.includes("graphValidation") && source.review.includes("validateGraphAmplifiedFindings");
      const usesUntypedCast = /config\.review\s+as\s+Record<string, unknown>\s*&\s*\{\s*graphValidation\?/.test(source.review);
      const configHasTypedSchema = /graphValidationSchema|graphValidation:\s*graphValidationSchema|graphValidation:\s*z\./.test(source.config);
      const validationTypesExist = source.validation.includes("export type GraphValidationOptions") && source.validation.includes("enabled?: boolean");
      if (reviewUsesGraphValidation && configHasTypedSchema && !usesUntypedCast) {
        return makeRow(definition, "complete", [
          { path: "src/handlers/review.ts", reason: "Review handler consumes typed graph-validation config without a local cast." },
          { path: "src/execution/config.ts", reason: "Config schema includes review.graphValidation." },
        ]);
      }
      if (reviewUsesGraphValidation || validationTypesExist) {
        return makeRow(definition, "partial", [
          { path: "src/handlers/review.ts", reason: usesUntypedCast ? "Review handler gates graph validation through an untyped cast." : "Review handler references graph validation." },
          { path: "src/review-graph/validation.ts", reason: "Graph-validation option types exist separately from repo config parsing." },
        ], [configHasTypedSchema ? "Review handler still does not prove typed consumption." : "src/execution/config.ts does not expose typed review.graphValidation schema support."]);
      }
      return makeRow(definition, "missing", [], ["No graph-validation source evidence was found."]);
    }
    case "truthful-graph-validation-status": {
      const validates = source.review.includes("validateGraphAmplifiedFindings");
      const surfacesCounts = source.review.includes("validatedCount") && source.review.includes("confirmedCount") && source.review.includes("uncertainCount");
      const failOpen = source.validation.includes("Fail-open") || source.review.includes("fail-open");
      if (validates && surfacesCounts && failOpen && /graphValidationVerdict/.test(source.review)) {
        return makeRow(definition, "partial", [
          { path: "src/handlers/review.ts", reason: "Runtime logs and finding metadata expose graph-validation counts/verdicts." },
          { path: "src/review-graph/validation.ts", reason: "Validation module documents fail-open behavior and typed result metadata." },
        ], ["Graph-validation status is not yet tied to the issue #131 ReviewPlan acceptance surface."]);
      }
      if (validates) {
        return makeRow(definition, "partial", [{ path: "src/handlers/review.ts", reason: "Graph validation is invoked but status surface is incomplete." }], ["Graph-validation status evidence is incomplete."]);
      }
      return makeRow(definition, "missing", [], ["No truthful graph-validation status surface was found."]);
    }
    case "package-verifier-wiring": {
      const scripts = parsePackageScripts(source.packageJson);
      const command = scripts["verify:m071"];
      if (typeof command === "string" && command.includes("verify-m071")) {
        return makeRow(definition, "complete", [{ path: "package.json", reason: "package.json exposes verify:m071." }]);
      }
      return makeRow(definition, "missing", [{ path: "package.json", reason: "package.json scripts do not expose verify:m071 yet." }], ["verify:m071 is not wired in package.json."]);
    }
    default: {
      const exhaustive: never = definition.id;
      return exhaustive;
    }
  }
}

function firstPublicationIndex(text: string): number {
  const indexes = [
    text.indexOf("createReview"),
    text.indexOf("createComment"),
    text.indexOf("updateComment"),
    text.indexOf("publish"),
    text.indexOf("Review Details publication"),
  ].filter((index) => index >= 0);
  return indexes.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...indexes);
}

function makeRow(
  definition: RowDefinition,
  status: Issue131Status,
  evidence: Issue131Evidence[],
  failureReasons: readonly string[] = [],
  deferredTo?: Issue131MatrixRow["deferredTo"],
): Issue131MatrixRow {
  const invalidEvidence = evidence.filter((entry) => validateIssue131EvidencePath(entry.path).valid === false || entry.reason.trim().length === 0);
  const issueCategories = new Set<Issue131IssueCategory>();
  if (status !== "complete") issueCategories.add(definition.issueCategory);
  if (invalidEvidence.length > 0) issueCategories.add("forbidden_evidence_path");
  if (status === "deferred") issueCategories.add("deferred_owner");
  if ((status === "complete" || status === "partial") && evidence.length === 0) issueCategories.add("weak_evidence");

  return {
    id: definition.id,
    title: definition.title,
    status,
    requirementRefs: definition.requirementRefs,
    decisionRefs: definition.decisionRefs,
    evidence,
    issueCategories: [...issueCategories].sort(),
    failureReasons,
    ...(deferredTo ? { deferredTo } : {}),
  };
}

function parsePackageScripts(packageJsonText: string): Record<string, string> {
  try {
    const parsed = JSON.parse(packageJsonText) as { scripts?: unknown };
    if (!parsed.scripts || typeof parsed.scripts !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed.scripts as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

function countStatuses(rows: readonly Issue131MatrixRow[]): Record<Issue131Status, number> {
  return {
    complete: rows.filter((row) => row.status === "complete").length,
    partial: rows.filter((row) => row.status === "partial").length,
    missing: rows.filter((row) => row.status === "missing").length,
    deferred: rows.filter((row) => row.status === "deferred").length,
  };
}

function collectRowIssues(rows: readonly Issue131MatrixRow[]): string[] {
  const issues: string[] = [];
  for (const row of rows) {
    if ((row.status === "complete" || row.status === "partial") && row.evidence.length === 0) {
      issues.push(`${row.id}: ${row.status} rows must include concrete source-path evidence.`);
    }
    if (row.status === "deferred" && !row.deferredTo) {
      issues.push(`${row.id}: deferred rows must name owning milestone/slice.`);
    }
    for (const evidence of row.evidence) {
      const validation = validateIssue131EvidencePath(evidence.path);
      if (!validation.valid) issues.push(`${row.id}: ${validation.reason}`);
      if (evidence.reason.trim().length === 0) issues.push(`${row.id}: evidence reason is empty for ${evidence.path}.`);
    }
  }
  return issues;
}

function buildChecks(rows: readonly Issue131MatrixRow[], packageJsonText: string, issues: readonly string[]): Issue131Check[] {
  const invalidStatuses = rows.filter((row) => !isIssue131Status(row.status));
  const evidenceIssues = issues.filter((issue) => /evidence|path|forbidden|empty/i.test(issue));
  const missingCurrentGaps = [
    rows.find((row) => row.id === "review-plan-contract")?.status === "missing",
    rows.find((row) => row.id === "typed-graph-validation-config")?.status === "partial",
    rows.find((row) => row.id === "package-verifier-wiring")?.status === "missing",
  ].every(Boolean);
  const deferredRows = rows.filter((row) => row.status === "deferred");
  const packageScripts = parsePackageScripts(packageJsonText);
  const packageWired = typeof packageScripts["verify:m071"] === "string";
  const safetyIssues = findForbiddenReportFields({ rows });

  return [
    makeCheck("M071-ISSUE-131-STATUS-TAXONOMY", invalidStatuses.length === 0, "All rows use the exact issue #131 status taxonomy.", invalidStatuses.map((row) => row.id).join(", "), ["weak_evidence"]),
    makeCheck("M071-ISSUE-131-EVIDENCE-PATHS", evidenceIssues.length === 0, "Non-deferred claims use repo-relative non-planning evidence paths with short reasons.", evidenceIssues.join(" "), ["forbidden_evidence_path", "weak_evidence"]),
    makeCheck("M071-ISSUE-131-ROW-CLASSIFICATION", missingCurrentGaps, "Current repo gaps remain fail-closed as missing/partial instead of complete.", "Current ReviewPlan, graph-validation, or package wiring classifications drifted.", ["weak_evidence", "schema_gap", "normal_path_gap"]),
    makeCheck("M071-ISSUE-131-DEFERRED-OWNERSHIP", deferredRows.length === 4 && deferredRows.every((row) => row.deferredTo), "Deferred rows name owning follow-up milestones/slices.", "Deferred issue #131 rows are missing owner metadata.", ["deferred_owner"]),
    makeCheck("M071-ISSUE-131-PACKAGE-WIRING", packageWired, "package.json exposes verify:m071.", "verify:m071 is not yet wired in package.json.", ["unwired_package_script"]),
    makeCheck("M071-ISSUE-131-REPORT-SAFETY", safetyIssues.length === 0, "Report-shaped data excludes raw prompts, model output, comments, and diffs.", safetyIssues.join(" "), ["raw_field_leak"]),
  ];
}

function makeCheck(id: Issue131CheckId, passed: boolean, okDetail: string, failDetail: string, issueCategories: readonly Issue131IssueCategory[]): Issue131Check {
  return {
    id,
    passed,
    status: passed ? "passed" : "failed",
    issueCategories: passed ? [] : issueCategories,
    detail: passed ? okDetail : failDetail,
  };
}

export function findForbiddenReportFields(value: unknown): string[] {
  const findings: string[] = [];
  visitReportValue(value, "$", findings);
  return findings;
}

function visitReportValue(value: unknown, path: string, findings: string[]): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitReportValue(item, `${path}[${index}]`, findings));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_REPORT_KEYS.has(key)) findings.push(`${path}.${key}`);
    visitReportValue(child, `${path}.${key}`, findings);
  }
}
