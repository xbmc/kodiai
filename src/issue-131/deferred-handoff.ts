export const ISSUE_131_DEFERRED_HANDOFF_ROW_IDS = [
  "candidate-finding-mcp-publication-bridge",
  "reducer-extraction",
  "specialist-lane-proof",
  "metrics-tier-closure",
  "repo-doctrine-contract-ownership",
] as const;

export type Issue131DeferredHandoffRowId = typeof ISSUE_131_DEFERRED_HANDOFF_ROW_IDS[number];

export type Issue131DeferredRequirementRef = "R104" | "R130" | "R131" | "R132" | "R133";
export type Issue131DeferredOwnerMilestone = "M072" | "M073" | "M074" | "M075";
export type Issue131DeferredOwnerSlice = `S${string}`;

export type Issue131DeferredHandoffRow = {
  readonly rowId: Issue131DeferredHandoffRowId;
  readonly requirementRefs: readonly Issue131DeferredRequirementRef[];
  readonly owner: {
    readonly milestone: Issue131DeferredOwnerMilestone;
    readonly slice: Issue131DeferredOwnerSlice;
  };
  readonly consumerOwnerLabel: string;
  readonly proofRequiredBeforePromotion: string;
  readonly reason: string;
};

export type Issue131DeferredHandoffValidation = {
  readonly passed: boolean;
  readonly reasons: readonly string[];
};

const FORBIDDEN_RAW_FIELD_NAMES = new Set([
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

function rowIdSet(rows: readonly Issue131DeferredHandoffRow[]): Set<string> {
  return new Set(rows.map((row) => row.rowId));
}

function hasForbiddenPlanningPath(value: string): boolean {
  return /(?:^|[\s`'"])(?:\.gsd|\.planning|\.audits)\//.test(value);
}

function visitForForbiddenFields(value: unknown, path: string, findings: string[]): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((child, index) => visitForForbiddenFields(child, `${path}[${index}]`, findings));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_RAW_FIELD_NAMES.has(key)) findings.push(`${path}.${key}`);
    visitForForbiddenFields(child, `${path}.${key}`, findings);
  }
}

export function findForbiddenDeferredHandoffFields(value: unknown): string[] {
  const findings: string[] = [];
  visitForForbiddenFields(value, "$", findings);
  return findings;
}

export function validateIssue131DeferredHandoffRows(rows: readonly Issue131DeferredHandoffRow[]): Issue131DeferredHandoffValidation {
  const reasons: string[] = [];
  const ids = rowIdSet(rows);

  for (const id of ISSUE_131_DEFERRED_HANDOFF_ROW_IDS) {
    if (!ids.has(id)) reasons.push(`${id}: handoff row is missing.`);
  }

  for (const row of rows) {
    if (!ISSUE_131_DEFERRED_HANDOFF_ROW_IDS.includes(row.rowId)) {
      reasons.push(`${row.rowId}: handoff row id is not part of the stable source contract.`);
    }
    if (row.requirementRefs.length === 0) reasons.push(`${row.rowId}: at least one requirement ref is required.`);
    if (!row.owner.milestone || !row.owner.slice) reasons.push(`${row.rowId}: owner milestone and slice are required.`);
    if (row.owner.milestone === "M071") reasons.push(`${row.rowId}: deferred handoff rows must not be owned by M071.`);
    if (!row.consumerOwnerLabel.trim()) reasons.push(`${row.rowId}: consumer/owner label is required.`);
    if (!row.proofRequiredBeforePromotion.trim()) reasons.push(`${row.rowId}: proof required before promotion is required.`);
    if (!row.reason.trim()) reasons.push(`${row.rowId}: compact safe reason is required.`);

    const searchableText = [row.consumerOwnerLabel, row.proofRequiredBeforePromotion, row.reason].join("\n");
    if (hasForbiddenPlanningPath(searchableText)) reasons.push(`${row.rowId}: handoff proof must not depend on planning artifact paths.`);
  }

  const r104OwnershipRows = rows.filter((row) => row.rowId === "repo-doctrine-contract-ownership" && row.requirementRefs.includes("R104"));
  if (r104OwnershipRows.length !== 1) reasons.push(`R104: expected exactly one dedicated downstream ownership row, found ${r104OwnershipRows.length}.`);
  for (const row of rows.filter((entry) => entry.requirementRefs.includes("R104"))) {
    if (row.owner.milestone === "M071") reasons.push(`${row.rowId}: R104 must not be owned by M071.`);
  }

  const forbiddenFields = findForbiddenDeferredHandoffFields(rows);
  if (forbiddenFields.length > 0) reasons.push(`Forbidden raw handoff fields detected: ${forbiddenFields.join(", ")}.`);

  return { passed: reasons.length === 0, reasons };
}

export const ISSUE_131_DEFERRED_HANDOFF_ROWS = [
  {
    rowId: "candidate-finding-mcp-publication-bridge",
    requirementRefs: ["R130"],
    owner: { milestone: "M072", slice: "S01" },
    consumerOwnerLabel: "M072/S01 candidate-publication bridge owner",
    proofRequiredBeforePromotion: "Source-owned candidate capture before public GitHub publication, reducer handoff input shape, and package verifier row proving the bridge without raw candidate payloads.",
    reason: "M071 only proves foundation readiness; candidate publication remains deferred to the bridge implementation owner.",
  },
  {
    rowId: "reducer-extraction",
    requirementRefs: ["R130", "R132"],
    owner: { milestone: "M073", slice: "S01" },
    consumerOwnerLabel: "M073/S01 reducer extraction owner",
    proofRequiredBeforePromotion: "Typed reducer contract, fixture-backed reduction behavior, and verifier evidence that publication consumes reducer-approved findings rather than direct model output.",
    reason: "Reducer extraction is required before issue #131 candidate output can be promoted beyond M071 foundation evidence.",
  },
  {
    rowId: "specialist-lane-proof",
    requirementRefs: ["R131", "R104"],
    owner: { milestone: "M074", slice: "S01" },
    consumerOwnerLabel: "M074/S01 specialist and repo-doctrine config contract owner",
    proofRequiredBeforePromotion: "Checked-in `.kodiai.yml` doctrine schema parsing, bounded specialist shadow evidence, and source tests proving repo invariant contracts are consumed as auditable review inputs.",
    reason: "Repo-doctrine contracts are not implemented by M071; they are deferred with specialist/config proof instead of claimed provisionally.",
  },
  {
    rowId: "metrics-tier-closure",
    requirementRefs: ["R133"],
    owner: { milestone: "M075", slice: "S01" },
    consumerOwnerLabel: "M075/S01 metrics and rollout closure owner",
    proofRequiredBeforePromotion: "Verifier and runtime telemetry showing rollout gates, cost/noise controls, and tier closure evidence before final issue #131 promotion.",
    reason: "Final closure needs operational telemetry beyond M071's source-contract foundation.",
  },
  {
    rowId: "repo-doctrine-contract-ownership",
    requirementRefs: ["R104"],
    owner: { milestone: "M074", slice: "S01" },
    consumerOwnerLabel: "M074/S01 repo-doctrine contract implementation owner",
    proofRequiredBeforePromotion: "`.kodiai.yml` repo-doctrine schema, source parser integration, ReviewPlan/reducer consumption, and package verifier proof for API, migration, performance, tracing, feature-flag, forbidden-pattern, and docs-update invariants.",
    reason: "R104 is foundation-adjacent but unimplemented in M071, so ownership is explicitly downstream and not an M071 provisional claim.",
  },
] as const satisfies readonly Issue131DeferredHandoffRow[];

export const ISSUE_131_R104_OWNER = ISSUE_131_DEFERRED_HANDOFF_ROWS.find((row) => row.rowId === "repo-doctrine-contract-ownership")!;
