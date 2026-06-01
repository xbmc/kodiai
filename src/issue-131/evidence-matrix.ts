import {
  ISSUE_131_DEFERRED_HANDOFF_ROWS,
  ISSUE_131_R104_OWNER,
  validateIssue131DeferredHandoffRows,
  type Issue131DeferredHandoffRow,
} from "./deferred-handoff.ts";

export const ISSUE_131_STATUSES = ["complete", "partial", "missing", "deferred"] as const;
export type Issue131Status = typeof ISSUE_131_STATUSES[number];

export type Issue131IssueCategory =
  | "missing_source"
  | "weak_evidence"
  | "forbidden_evidence_path"
  | "raw_field_leak"
  | "unwired_package_script"
  | "deferred_owner"
  | "deferred_handoff"
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

export type Issue131DeferredHandoffProjection = {
  readonly row_id: string;
  readonly requirement_refs: readonly string[];
  readonly owner_milestone: string;
  readonly owner_slice: string;
  readonly proof_required: string;
};

export type Issue131R104OwnershipResolution = {
  readonly requirement_ref: "R104";
  readonly row_id: string;
  readonly owner_milestone: string;
  readonly owner_slice: string;
  readonly owned_by_m071: boolean;
  readonly resolution: "deferred_outside_m071" | "unsafe_m071_owner";
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
  deferred_handoff: readonly Issue131DeferredHandoffProjection[];
  r104_ownership: Issue131R104OwnershipResolution;
  issues: readonly string[];
};

export type Issue131EvidenceReaders = {
  readFileText: (path: Issue131SourcePath) => string | undefined;
  readPackageJsonText: () => string | undefined;
  generatedAt?: string;
  handoffRows?: readonly Issue131DeferredHandoffRow[];
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
  "src/review-orchestration/review-plan.ts",
  "src/lib/review-details-formatting.ts",
  "src/lib/review-details-plan-formatting.ts",
  "src/execution/config.ts",
  "src/review-graph/validation.ts",
  "src/review-graph/graph-validation-status.ts",
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

const FOUNDATION_ROW_IDS = [
  "review-plan-contract",
  "normal-handler-plan-construction",
  "review-details-plan-summary",
  "typed-graph-validation-config",
  "truthful-graph-validation-status",
  "package-verifier-wiring",
] as const satisfies readonly Issue131RowId[];

const EXPECTED_DEFERRED_OWNERS = {
  "candidate-finding-mcp-publication-bridge": { milestone: "M072", slice: "S01" },
  "reducer-extraction": { milestone: "M073", slice: "S01" },
  "specialist-lane-proof": { milestone: "M074", slice: "S01" },
  "metrics-tier-closure": { milestone: "M075", slice: "S01" },
} as const;
type ExpectedDeferredRowId = keyof typeof EXPECTED_DEFERRED_OWNERS;

const EXPECTED_FINAL_STATUS_COUNTS: Record<Issue131Status, number> = {
  complete: FOUNDATION_ROW_IDS.length,
  partial: 0,
  missing: 0,
  deferred: Object.keys(EXPECTED_DEFERRED_OWNERS).length,
};

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
    reviewPlan: readers.readFileText("src/review-orchestration/review-plan.ts") ?? "",
    reviewDetailsFormatting: [
      readers.readFileText("src/lib/review-details-formatting.ts") ?? "",
      readers.readFileText("src/lib/review-details-plan-formatting.ts") ?? "",
    ].join("\n"),
    config: readers.readFileText("src/execution/config.ts") ?? "",
    validation: readers.readFileText("src/review-graph/validation.ts") ?? "",
    graphValidationStatus: readers.readFileText("src/review-graph/graph-validation-status.ts") ?? "",
    packageJson: readers.readPackageJsonText() ?? "",
  };

  const handoffRows = readers.handoffRows ?? ISSUE_131_DEFERRED_HANDOFF_ROWS;
  const rows = ROW_DEFINITIONS.map((definition) => classifyRow(definition, source, handoffRows));
  const counts = countStatuses(rows);
  const handoffValidation = validateMatrixHandoff(rows, handoffRows);
  const issues = [...collectRowIssues(rows, counts), ...handoffValidation.reasons];
  const checks = buildChecks(rows, source.packageJson, issues, counts, handoffValidation);
  const allCheckIssues = checks.flatMap((check) => check.passed ? [] : [check.detail]);
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
    deferred_handoff: buildHandoffProjection(handoffRows),
    r104_ownership: buildR104OwnershipResolution(handoffRows),
    issues: [...issues, ...allCheckIssues],
  };
}

function classifyRow(definition: RowDefinition, source: { review: string; reviewPlan: string; reviewDetailsFormatting: string; config: string; validation: string; graphValidationStatus: string; packageJson: string }, handoffRows: readonly Issue131DeferredHandoffRow[]): Issue131MatrixRow {
  if (definition.deferredTo) {
    const handoff = handoffRows.find((row) => row.rowId === definition.id);
    const deferredTo = handoff ? {
      milestone: handoff.owner.milestone as "M072" | "M073" | "M074" | "M075",
      slice: handoff.owner.slice,
      reason: definition.deferredTo.reason,
    } : definition.deferredTo;
    return makeRow(definition, "deferred", [], [], deferredTo);
  }

  switch (definition.id) {
    case "review-plan-contract": {
      const hasTypedContract = /export\s+type\s+ReviewPlan\b|export\s+interface\s+ReviewPlan\b/.test(source.reviewPlan);
      const hasBuilder = /export\s+function\s+buildReviewPlan\b/.test(source.reviewPlan);
      const hasStableHash = /hash\s*:\s*string/.test(source.reviewPlan) && /hashCanonical|createHash/.test(source.reviewPlan);
      const hasSafeDiagnosticProjection = /export\s+function\s+toReviewPlanDetailsSummary\b/.test(source.reviewPlan)
        && /Review plan: ready/.test(source.reviewPlan)
        && /sanitizeSummaryToken/.test(source.reviewPlan);
      return hasTypedContract && hasBuilder && hasStableHash && hasSafeDiagnosticProjection
        ? makeRow(definition, "complete", [{ path: "src/review-orchestration/review-plan.ts", reason: "Exports the typed ReviewPlan contract, stable hash, builder, and safe Review Details projection." }])
        : makeRow(definition, "missing", [], ["No exported typed ReviewPlan contract with stable hash, builder, and safe Review Details projection was found in src/review-orchestration/review-plan.ts."]);
    }
    case "normal-handler-plan-construction": {
      const hasReviewPlanImport = /from\s+[\"']\.\.\/review-orchestration\/review-plan\.ts[\"']/.test(source.review)
        && /\bbuildReviewPlan\b/.test(source.review)
        && /\btoReviewPlanDetailsSummary\b/.test(source.review);
      const construction = findReviewPlanConstruction(source.review);
      const constructsBeforePublication = construction.found && construction.beforePublication;
      const hasSafeStableHashProjection = /toReviewPlanDetailsSummary\s*\(\s*reviewPlan\s*\)/.test(source.review)
        || /\breviewPlan\.hash\b/.test(source.review);
      if (hasReviewPlanImport && constructsBeforePublication && hasSafeStableHashProjection) {
        return makeRow(definition, "complete", [{ path: "src/handlers/review.ts", reason: "Normal review flow imports, constructs, and logs a safe ReviewPlan projection before nearby publication side effects." }]);
      }
      if (hasReviewPlanImport || construction.found || /\bReviewPlan\b/.test(source.review)) {
        return makeRow(definition, "partial", [{ path: "src/handlers/review.ts", reason: "ReviewPlan is mentioned, but normal-path construction before publication with safe hash/projection is not proven." }], ["ReviewPlan naming exists without a normal-path construction seam before publication side effects and safe stable-hash projection."]);
      }
      return makeRow(definition, "missing", [], ["No ReviewPlan construction seam was found in normal review-handler flow."]);
    }
    case "review-details-plan-summary": {
      const projection = findReviewDetailsPlanProjection(source.reviewPlan);
      const formatter = findReviewDetailsPlanFormatter(source.reviewDetailsFormatting);
      const handler = findReviewDetailsPlanHandlerWiring(source.review);
      const hasReviewDetails = source.review.includes("formatReviewDetailsSummary")
        || source.reviewDetailsFormatting.includes("<summary>Review Details</summary>");

      if (projection.complete && formatter.complete && handler.complete) {
        return makeRow(definition, "complete", [
          { path: "src/review-orchestration/review-plan.ts", reason: "Exports the compact public ReviewPlan Review Details projection with hash, route, budget, gate, policy, graph, candidate, and doctrine fields." },
          { path: "src/lib/review-details-plan-formatting.ts", reason: "Formats the public ReviewPlan projection into a bounded Review Details line without raw review artifacts." },
          { path: "src/handlers/review.ts", reason: "Normal review publication passes the ReviewPlan Review Details projection to formatReviewDetailsSummary with fail-open warning logs." },
        ]);
      }

      const partialEvidence: Issue131Evidence[] = [];
      if (projection.present) partialEvidence.push({ path: "src/review-orchestration/review-plan.ts", reason: "Public ReviewPlan Review Details projection exists but is not fully proven." });
      if (formatter.present) partialEvidence.push({ path: "src/lib/review-details-plan-formatting.ts", reason: "Review Details formatter mentions ReviewPlan summary but bounded safe output is not fully proven." });
      if (handler.present || hasReviewDetails) partialEvidence.push({ path: "src/handlers/review.ts", reason: "Review Details publication exists or mentions ReviewPlan summary, but source-owned projection-to-formatter wiring is incomplete." });

      const failureReasons = [...projection.reasons, ...formatter.reasons, ...handler.reasons];
      if (hasReviewDetails || projection.present || formatter.present || handler.present) {
        return makeRow(definition, "partial", partialEvidence, failureReasons.length > 0 ? failureReasons : ["Review Details plan-summary evidence is incomplete."]);
      }
      return makeRow(definition, "missing", [], ["Review Details summary publication evidence was not found."]);
    }
    case "typed-graph-validation-config": {
      const configProbe = findTypedGraphValidationConfig(source.config);
      const handlerProbe = findTypedGraphValidationHandlerConsumption(source.review);
      const validationTypesExist = source.validation.includes("export type GraphValidationOptions") && source.validation.includes("enabled?: boolean");

      if (configProbe.complete && handlerProbe.complete) {
        return makeRow(definition, "complete", [
          { path: "src/execution/config.ts", reason: "Repo config schema preserves review.graphValidation.enabled with fail-open defaults and bounded validation budgets." },
          { path: "src/handlers/review.ts", reason: "Normal review handler consumes config.review.graphValidation directly without the old untyped cast." },
        ]);
      }

      const evidence: Issue131Evidence[] = [];
      if (configProbe.present) evidence.push({ path: "src/execution/config.ts", reason: "review.graphValidation schema/default evidence is present but incomplete." });
      if (handlerProbe.present) evidence.push({ path: "src/handlers/review.ts", reason: handlerProbe.usesUntypedCast ? "Review handler still gates graph validation through an untyped cast." : "Review handler references typed graph-validation config but complete consumption is not proven." });
      if (validationTypesExist) evidence.push({ path: "src/review-graph/validation.ts", reason: "Graph-validation option types exist separately from repo config parsing." });

      if (evidence.length > 0) {
        return makeRow(definition, "partial", evidence, [...configProbe.reasons, ...handlerProbe.reasons]);
      }
      return makeRow(definition, "missing", [], ["No graph-validation source evidence was found."]);
    }
    case "truthful-graph-validation-status": {
      const statusProbe = findTruthfulGraphValidationStatus(source.review, source.reviewPlan, source.graphValidationStatus, source.validation);
      if (statusProbe.complete) {
        return makeRow(definition, "complete", [
          { path: "src/review-graph/graph-validation-status.ts", reason: "Shared status mapper owns bounded graph-validation pre/runtime states, reasons, counts, and fail-open failure status." },
          { path: "src/handlers/review.ts", reason: "Normal review path feeds graph-validation into ReviewPlan gates and bounded skipped, unavailable, applied, and failure runtime logs." },
          { path: "src/review-orchestration/review-plan.ts", reason: "ReviewPlan gate taxonomy supports enabled, applied, skipped, and unavailable graph-validation gate states." },
        ]);
      }
      if (statusProbe.present) {
        return makeRow(definition, "partial", statusProbe.evidence, statusProbe.reasons);
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
    case "candidate-finding-mcp-publication-bridge":
    case "reducer-extraction":
    case "specialist-lane-proof":
    case "metrics-tier-closure":
      return makeRow(definition, "deferred", [], [], definition.deferredTo);
    default: {
      const exhaustive: never = definition.id;
      return exhaustive;
    }
  }
}

type SourceEvidenceProbe = {
  present: boolean;
  complete: boolean;
  reasons: string[];
};

function makeProbe(present: boolean, checks: readonly [boolean, string][]): SourceEvidenceProbe {
  return {
    present,
    complete: present && checks.every(([passed]) => passed),
    reasons: checks.filter(([passed]) => !passed).map(([, reason]) => reason),
  };
}


function stripTypeScriptComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

function findTypedGraphValidationConfig(configSource: string): SourceEvidenceProbe {
  const source = stripTypeScriptComments(configSource);
  const present = /graphValidationSchema|graphValidation\s*:\s*graphValidationSchema/.test(source);
  return makeProbe(present, [
    [/const\s+graphValidationSchema\s*=\s*z\s*\.object\s*\(/.test(source), "src/execution/config.ts does not define a source-owned graphValidationSchema object."],
    [/enabled\s*:\s*z\.boolean\(\)\.default\(false\)/.test(source), "review.graphValidation.enabled does not default to false for fail-open opt-in behavior."],
    [/maxFindingsToValidate\s*:\s*z\.number\(\)\.int\(\)\.min\(1\)\.max\(100\)\.default\(10\)/.test(source), "review.graphValidation.maxFindingsToValidate bounded default is missing."],
    [/contextMaxChars\s*:\s*z\.number\(\)\.int\(\)\.min\(100\)\.max\(10000\)\.default\(1000\)/.test(source), "review.graphValidation.contextMaxChars bounded default is missing."],
    [/graphValidation\s*:\s*graphValidationSchema/.test(source), "reviewSchema does not preserve review.graphValidation through repo config parsing."],
    [/graphValidation\s*:\s*\{[\s\S]*?enabled\s*:\s*false[\s\S]*?maxFindingsToValidate\s*:\s*10[\s\S]*?contextMaxChars\s*:\s*1000[\s\S]*?\}/.test(source), "reviewSchema default object does not preserve graphValidation defaults."],
  ]);
}

function findTypedGraphValidationHandlerConsumption(reviewSource: string): SourceEvidenceProbe & { usesUntypedCast: boolean } {
  const source = stripTypeScriptComments(reviewSource);
  const usesUntypedCast = /config\.review\s+as\s+Record<string, unknown>|as\s+Record<string, unknown>\s*&\s*\{\s*graphValidation\?/.test(source);
  const present = /graphValidation|validateGraphAmplifiedFindings|graphValidationRunner/.test(source);
  const probe = makeProbe(present, [
    [/config\.review\.graphValidation/.test(source), "Review handler does not consume config.review.graphValidation directly."],
    [/graphValidationRunner\s*\([\s\S]*?config\.review\.graphValidation/.test(source), "Review handler does not pass typed review.graphValidation into the validation runner."],
    [/graphValidationSkippedRuntimeStatus\s*\(\s*\{[\s\S]*?config\s*,/.test(source), "Review handler does not derive skipped/unavailable runtime status from typed repo config."],
    [/resolveGraphValidationPreStatus\s*\(\s*\{[\s\S]*?config\s*,/.test(source), "Review handler does not derive ReviewPlan pre-status from typed repo config."],
    [!usesUntypedCast, "Review handler still contains the old untyped graphValidation config cast."],
  ]);
  return { ...probe, usesUntypedCast };
}

type GraphValidationStatusProbe = SourceEvidenceProbe & { evidence: Issue131Evidence[] };

function findTruthfulGraphValidationStatus(reviewSource: string, reviewPlanSource: string, statusSource: string, validationSource: string): GraphValidationStatusProbe {
  const review = stripTypeScriptComments(reviewSource);
  const reviewPlan = stripTypeScriptComments(reviewPlanSource);
  const status = stripTypeScriptComments(statusSource);
  const validation = stripTypeScriptComments(validationSource);
  const present = /graphValidation|graph-validation|GraphValidationRuntimeStatus/.test(`${review}\n${status}`);
  const statusChecks: readonly [boolean, string][] = [
    [/export\s+const\s+GRAPH_VALIDATION_GATE\s*=\s*["']graph-validation["']/.test(status), "No source-owned graph-validation gate constant was found."],
    [/export\s+type\s+GraphValidationPreStatus/.test(status) && /status\s*:\s*ReviewPlanGateStatus/.test(status), "Graph-validation pre-status is not typed as a ReviewPlan gate status."],
    [/export\s+type\s+GraphValidationRuntimeStatus/.test(status) && /gateResult\s*:\s*["']skipped["']\s*\|\s*["']unavailable["']\s*\|\s*["']applied["']\s*\|\s*["']failure["']/.test(status), "Graph-validation runtime status does not expose bounded skipped/unavailable/applied/failure states."],
    [["enabled", "graphContextAvailable", "findingCount", "validatedCount", "confirmedCount", "uncertainCount"].every((field) => status.includes(field)), "Graph-validation runtime status does not expose enabled/context/count fields."],
    [/resolveGraphValidationPreStatus/.test(status) && /graphValidationGateForReviewPlan/.test(status), "Graph-validation pre-status is not mapped into a ReviewPlan gate."],
    [/graphValidationSkippedRuntimeStatus/.test(status) && /gateResult:\s*preStatus\.status === ["']skipped["'] \? ["']skipped["'] : ["']unavailable["']/.test(status), "Skipped/unavailable graph-validation runtime status is not source-owned."],
    [/graphValidationAppliedRuntimeStatus/.test(status) && /validation-failed/.test(status) && /validation-applied/.test(status) && /no-findings-validated/.test(status), "Applied/fail-open graph-validation runtime status mapping is incomplete."],
    [/graphValidationThrownRuntimeStatus/.test(status) && /validation-threw/.test(status), "Thrown graph-validation fail-open runtime status is missing."],
    [/const\s+GATE_STATUSES\s*=\s*\[[^\]]*["']enabled["'][^\]]*["']applied["'][^\]]*["']skipped["'][^\]]*["']unavailable["']/.test(reviewPlan), "ReviewPlan gate taxonomy does not include enabled/applied/skipped/unavailable."],
    [/graphValidationGateForReviewPlan\s*\(\s*graphValidationPreStatus\s*\)/.test(review), "Normal review handler does not add graph-validation to ReviewPlan gates."],
    [/graphValidationSkippedRuntimeStatus\s*\(/.test(review) && /logger\.info\s*\([\s\S]*?skippedGraphValidationStatus/.test(review), "Normal review handler does not log skipped/unavailable graph-validation status."],
    [/graphValidationAppliedRuntimeStatus\s*\(/.test(review) && /logger\.(?:info|warn)\s*\([\s\S]*?runtimeStatus/.test(review), "Normal review handler does not log applied/failure graph-validation status."],
    [/graphValidationThrownRuntimeStatus\s*\(/.test(review) && /logger\.warn\s*\([\s\S]*?graphValidationThrownRuntimeStatus/.test(review), "Normal review handler does not log thrown fail-open graph-validation status."],
    [/Fail-open/i.test(validation) || /fail-open/i.test(review), "Graph-validation failure-open behavior is not documented in source."],
  ];
  const probe = makeProbe(present, statusChecks);
  const evidence: Issue131Evidence[] = [];
  if (/GraphValidationRuntimeStatus|GRAPH_VALIDATION_GATE|graphValidationAppliedRuntimeStatus/.test(status)) evidence.push({ path: "src/review-graph/graph-validation-status.ts", reason: "Graph-validation status mapper exists but the full evidence contract is not proven." });
  if (/graphValidationGateForReviewPlan|graphValidationSkippedRuntimeStatus|graphValidationAppliedRuntimeStatus|graphValidationThrownRuntimeStatus/.test(review)) evidence.push({ path: "src/handlers/review.ts", reason: "Review handler references graph-validation status helpers but complete ReviewPlan/runtime surfacing is not proven." });
  if (/GraphValidationPlanStatus|graphValidation/.test(reviewPlan)) evidence.push({ path: "src/review-orchestration/review-plan.ts", reason: "ReviewPlan graph-validation status taxonomy exists but graph-validation status wiring is incomplete." });
  return { ...probe, evidence };
}

function findReviewDetailsPlanProjection(reviewPlanSource: string): SourceEvidenceProbe {
  const present = /toReviewPlanDetailsSummary|ReviewPlanDetailsSummary|Review plan: ready/.test(reviewPlanSource);
  return makeProbe(present, [
    [/export\s+type\s+ReviewPlanDetailsSummary\b/.test(reviewPlanSource), "No exported ReviewPlanDetailsSummary type was found in source."],
    [/export\s+function\s+toReviewPlanDetailsSummary\s*\(\s*plan\s*:\s*ReviewPlan\s*\|\s*DegradedReviewPlan/.test(reviewPlanSource), "No source-owned ReviewPlan-to-Review Details line projection was found."],
    [/Review plan: ready/.test(reviewPlanSource) && /Review plan: degraded/.test(reviewPlanSource), "Review Details projection does not render ready and degraded Review plan lines."],
    [["hash", "route", "task", "files", "lines", "budget", "gates", "publish", "graph", "candidates", "doctrine"].every((field) => reviewPlanSource.includes(field)), "Review Details projection does not include hash, route, task, files, lines, budget, gates, publish, graph, candidates, and doctrine truth."],
    [/boundSummary|sanitizeSummaryToken/.test(reviewPlanSource), "Review Details projection does not prove bounded/sanitized visible output."],
  ]);
}

function findReviewDetailsPlanFormatter(reviewDetailsFormatterSource: string): SourceEvidenceProbe {
  const present = /formatReviewPlanDetailsLine|reviewPlan\?: ReviewPlanDetailsSummary/.test(reviewDetailsFormatterSource);
  const formatterBody = extractFunctionBody(reviewDetailsFormatterSource, "formatReviewPlanDetailsLine");
  const forbiddenVisibleTokens = ["rawPrompt", "modelPrompt", "rawModelOutput", "rawDiff", "candidatePayload", "candidateFindingPayload", "commentBody", "rawCommentBody", "apiKey", "password", "secret"];
  return makeProbe(present, [
    [/ReviewPlanDetailsSummary/.test(reviewDetailsFormatterSource), "Formatter does not consume the canonical ReviewPlanDetailsSummary type."],
    [formatterBody !== "" && /reviewPlan\?\.text/.test(formatterBody), "Review Details formatter does not render the source-owned Review plan line."],
    [!/(ReviewPlanReviewDetailsFormatterSummary|formatReviewPlanReviewDetailsLine|reviewPlanSummary)/.test(reviewDetailsFormatterSource), "Review Details formatter still contains the legacy reviewPlanSummary path."],
    [!forbiddenVisibleTokens.some((token) => formatterBody.includes(token)), "Review Plan formatter visible output contains raw review artifact field names or canaries."],
  ]);
}

function findReviewDetailsPlanHandlerWiring(reviewSource: string): SourceEvidenceProbe {
  const source = stripTypeScriptComments(reviewSource);
  const present = /toReviewPlanDetailsSummary|reviewPlanDetailsSummary|reviewPlan\s*:/.test(source);
  return makeProbe(present, [
    [/toReviewPlanDetailsSummary/.test(source), "Review handler does not import/use the public ReviewPlan Review Details projection."],
    [/toReviewPlanDetailsSummary\s*\(\s*reviewPlan\s*\)/.test(source), "Review handler does not derive the public ReviewPlan summary from the typed ReviewPlan instance."],
    [/reviewPlan\s*:\s*reviewPlanDetailsSummary/.test(source), "Review handler does not pass the public ReviewPlan summary into formatReviewDetailsSummary."],
    [hasBoundedReviewPlanDegradation(source), "Review handler does not prove bounded fail-open ReviewPlan degradation behavior."],
  ]);
}

function hasBoundedReviewPlanDegradation(reviewSource: string): boolean {
  const projectionIndex = reviewSource.search(/toReviewPlanDetailsSummary\s*\(\s*reviewPlan\s*\)/);
  if (projectionIndex < 0) return false;
  const beforeProjection = reviewSource.slice(0, projectionIndex);
  for (const catchMatch of beforeProjection.matchAll(/\bcatch\b/g)) {
    const catchBlock = extractBracedBlockAfter(beforeProjection, catchMatch.index);
    if (!catchBlock) continue;
    if (!/\breviewPlan\s*=\s*createDegradedReviewPlan\s*\(\s*\{[\s\S]*?reason\s*:\s*["']builder-error["']/.test(catchBlock.body)) {
      continue;
    }
    const tryBlock = findAdjacentTryBlock(beforeProjection, catchMatch.index);
    if (!tryBlock) continue;
    if (/\breviewPlan\s*=/.test(tryBlock.body) && /(?:buildReviewPlan|reviewPlanBuilder)\s*\(/.test(tryBlock.body)) {
      return true;
    }
  }
  return false;
}

function findAdjacentTryBlock(source: string, catchIndex: number): { body: string; closeIndex: number } | null {
  const tryMatches = [...source.slice(0, catchIndex).matchAll(/\btry\b/g)].reverse();
  for (const tryMatch of tryMatches) {
    const block = extractBracedBlockAfter(source, tryMatch.index);
    if (!block || block.closeIndex > catchIndex) continue;
    if (source.slice(block.closeIndex + 1, catchIndex).trim().length === 0) return block;
  }
  return null;
}

function extractBracedBlockAfter(source: string, startIndex: number): { body: string; closeIndex: number } | null {
  const openIndex = source.indexOf("{", startIndex);
  if (openIndex < 0) return null;
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return { body: source.slice(openIndex + 1, index), closeIndex: index };
      }
    }
  }
  return null;
}

function extractFunctionBody(source: string, functionName: string): string {
  const signature = new RegExp(`function\\s+${functionName}\\b`);
  const match = signature.exec(source);
  if (!match) return "";
  const openIndex = source.indexOf("{", match.index);
  if (openIndex < 0) return "";
  let depth = 0;
  for (let index = openIndex; index < source.length; index++) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex, index + 1);
    }
  }
  return "";
}

function findReviewPlanConstruction(text: string): { found: boolean; beforePublication: boolean } {
  const constructionIndex = findFirstIndex(text, [
    "reviewPlanBuilder({",
    "buildReviewPlan({",
    "createReviewPlan({",
    "resolveReviewPlan({",
  ]);
  if (constructionIndex < 0) return { found: false, beforePublication: false };

  const precedingWindow = text.slice(Math.max(0, constructionIndex - 1800), constructionIndex);
  return {
    found: true,
    beforePublication: firstPublicationIndex(precedingWindow) === Number.POSITIVE_INFINITY,
  };
}

function findFirstIndex(text: string, needles: readonly string[]): number {
  const indexes = needles.map((needle) => text.indexOf(needle)).filter((index) => index >= 0);
  return indexes.length === 0 ? -1 : Math.min(...indexes);
}

function firstPublicationIndex(text: string): number {
  const indexes = [
    text.indexOf(".rest.issues.createComment("),
    text.indexOf(".rest.issues.updateComment("),
    text.indexOf(".rest.pulls.createReview("),
    text.indexOf("postOrUpdateErrorComment("),
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

function collectRowIssues(rows: readonly Issue131MatrixRow[], counts: Record<Issue131Status, number>): string[] {
  const issues: string[] = [];
  const finalClosure = validateFinalClosureRows(rows, counts);
  issues.push(...finalClosure.reasons);
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

function buildHandoffProjection(rows: readonly Issue131DeferredHandoffRow[]): Issue131DeferredHandoffProjection[] {
  return rows.map((row) => ({
    row_id: row.rowId,
    requirement_refs: [...row.requirementRefs],
    owner_milestone: row.owner.milestone,
    owner_slice: row.owner.slice,
    proof_required: row.proofRequiredBeforePromotion,
  }));
}

function buildR104OwnershipResolution(rows: readonly Issue131DeferredHandoffRow[]): Issue131R104OwnershipResolution {
  const r104 = rows.find((row) => row.rowId === "repo-doctrine-contract-ownership" && row.requirementRefs.includes("R104")) ?? ISSUE_131_R104_OWNER;
  const ownedByM071 = r104.owner.milestone === "M071";
  return {
    requirement_ref: "R104",
    row_id: r104.rowId,
    owner_milestone: r104.owner.milestone,
    owner_slice: r104.owner.slice,
    owned_by_m071: ownedByM071,
    resolution: ownedByM071 ? "unsafe_m071_owner" : "deferred_outside_m071",
  };
}

function validateMatrixHandoff(rows: readonly Issue131MatrixRow[], handoffRows: readonly Issue131DeferredHandoffRow[]): { passed: boolean; reasons: string[] } {
  const reasons = [...validateIssue131DeferredHandoffRows(handoffRows).reasons];
  for (const matrixRow of rows.filter((row) => row.status === "deferred")) {
    const handoff = handoffRows.find((row) => row.rowId === matrixRow.id);
    if (!handoff) {
      reasons.push(`${matrixRow.id}: matching source handoff row is missing.`);
      continue;
    }
    if (matrixRow.deferredTo?.milestone !== handoff.owner.milestone || matrixRow.deferredTo?.slice !== handoff.owner.slice) {
      reasons.push(`${matrixRow.id}: matrix owner ${matrixRow.deferredTo?.milestone ?? "missing"}/${matrixRow.deferredTo?.slice ?? "missing"} does not match source handoff owner ${handoff.owner.milestone}/${handoff.owner.slice}.`);
    }
    if (handoff.proofRequiredBeforePromotion.trim().length === 0) {
      reasons.push(`${matrixRow.id}: handoff proof-required summary is empty.`);
    }
  }

  const r104Rows = handoffRows.filter((row) => row.requirementRefs.includes("R104"));
  if (r104Rows.length === 0) reasons.push("R104: no source handoff row owns downstream repo-doctrine proof.");
  for (const row of r104Rows) {
    if (row.owner.milestone === "M071") reasons.push(`${row.rowId}: R104 source handoff owner must be outside M071.`);
  }

  return { passed: reasons.length === 0, reasons };
}

function buildChecks(rows: readonly Issue131MatrixRow[], packageJsonText: string, issues: readonly string[], counts: Record<Issue131Status, number>, handoffValidation: { passed: boolean; reasons: readonly string[] }): Issue131Check[] {
  const invalidStatuses = rows.filter((row) => !isIssue131Status(row.status));
  const evidenceIssues = issues.filter((issue) => /evidence|path|forbidden|empty/i.test(issue));
  const finalClosure = validateFinalClosureRows(rows, counts);
  const deferredOwnership = validateDeferredOwnership(rows);
  const deferredHandoffPassed = deferredOwnership.passed && handoffValidation.passed;
  const packageScripts = parsePackageScripts(packageJsonText);
  const packageWired = typeof packageScripts["verify:m071"] === "string";
  const safetyIssues = findForbiddenReportFields({ rows });

  return [
    makeCheck("M071-ISSUE-131-STATUS-TAXONOMY", invalidStatuses.length === 0, "All rows use the exact issue #131 status taxonomy.", invalidStatuses.map((row) => row.id).join(", "), ["weak_evidence"]),
    makeCheck("M071-ISSUE-131-EVIDENCE-PATHS", evidenceIssues.length === 0, "Non-deferred claims use repo-relative non-planning evidence paths with short reasons.", evidenceIssues.join(" "), ["forbidden_evidence_path", "weak_evidence"]),
    makeCheck("M071-ISSUE-131-ROW-CLASSIFICATION", finalClosure.passed, "Final M071 closure has six complete foundation rows, zero partial/missing rows, and four explicitly deferred future rows.", finalClosure.reasons.join(" "), ["weak_evidence", "schema_gap", "normal_path_gap", "unwired_package_script"]),
    makeCheck("M071-ISSUE-131-DEFERRED-OWNERSHIP", deferredHandoffPassed, "Deferred rows exactly match source handoff owners and R104 is owned outside M071.", [...deferredOwnership.reasons, ...handoffValidation.reasons].join(" "), ["deferred_owner", "deferred_handoff"]),
    makeCheck("M071-ISSUE-131-PACKAGE-WIRING", packageWired, "package.json exposes verify:m071.", "verify:m071 is not yet wired in package.json.", ["unwired_package_script"]),
    makeCheck("M071-ISSUE-131-REPORT-SAFETY", safetyIssues.length === 0, "Report-shaped data excludes raw prompts, model output, comments, and diffs.", safetyIssues.join(" "), ["raw_field_leak"]),
  ];
}

function validateFinalClosureRows(rows: readonly Issue131MatrixRow[], counts: Record<Issue131Status, number>): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  for (const status of ISSUE_131_STATUSES) {
    if (counts[status] !== EXPECTED_FINAL_STATUS_COUNTS[status]) {
      reasons.push(`Expected ${EXPECTED_FINAL_STATUS_COUNTS[status]} ${status} rows for final M071 closure, found ${counts[status]}.`);
    }
  }

  const foundationRows = new Set<Issue131RowId>(FOUNDATION_ROW_IDS);
  for (const id of FOUNDATION_ROW_IDS) {
    const row = rows.find((entry) => entry.id === id);
    if (!row) {
      reasons.push(`${id}: final M071 foundation row is missing from the report.`);
    } else if (row.status !== "complete") {
      reasons.push(`${id}: final M071 foundation row must be complete, found ${row.status}.`);
    }
  }

  for (const row of rows) {
    if ((row.status === "partial" || row.status === "missing") && foundationRows.has(row.id)) {
      reasons.push(`${row.id}: final M071 closure cannot contain ${row.status} foundation rows.`);
    }
    if (!foundationRows.has(row.id) && row.status !== "deferred") {
      reasons.push(`${row.id}: post-M071 issue #131 gap must remain deferred, found ${row.status}.`);
    }
  }

  return { passed: reasons.length === 0, reasons };
}

function validateDeferredOwnership(rows: readonly Issue131MatrixRow[]): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const expectedIds = Object.keys(EXPECTED_DEFERRED_OWNERS) as ExpectedDeferredRowId[];
  const deferredRows = rows.filter((row) => row.status === "deferred");

  if (deferredRows.length !== expectedIds.length) {
    reasons.push(`Expected ${expectedIds.length} deferred rows for M072-M075 ownership, found ${deferredRows.length}.`);
  }

  for (const id of expectedIds) {
    const row = rows.find((entry) => entry.id === id);
    const expected = EXPECTED_DEFERRED_OWNERS[id];
    if (!row) {
      reasons.push(`${id}: expected deferred owner ${expected.milestone}/${expected.slice}, but row is missing.`);
      continue;
    }
    if (row.status !== "deferred") {
      reasons.push(`${id}: expected deferred owner ${expected.milestone}/${expected.slice}, but row status is ${row.status}.`);
      continue;
    }
    if (row.deferredTo?.milestone !== expected.milestone || row.deferredTo?.slice !== expected.slice) {
      reasons.push(`${id}: expected deferred owner ${expected.milestone}/${expected.slice}, found ${row.deferredTo?.milestone ?? "missing"}/${row.deferredTo?.slice ?? "missing"}.`);
    }
    if (!row.deferredTo?.reason?.trim()) {
      reasons.push(`${id}: deferred owner reason is required.`);
    }
  }

  for (const row of deferredRows) {
    if (!(row.id in EXPECTED_DEFERRED_OWNERS)) {
      reasons.push(`${row.id}: unexpected deferred row outside the M072-M075 owner map.`);
    }
  }

  return { passed: reasons.length === 0, reasons };
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
