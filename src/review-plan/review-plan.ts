import { createHash } from "node:crypto";

export const REVIEW_PLAN_VERSION = 1 as const;
export const REVIEW_PLAN_HASH_PREFIX = `review-plan:v${REVIEW_PLAN_VERSION}:` as const;

const MAX_REPRESENTATIVE_SCOPE_PATHS = 10;
const MAX_REPRESENTATIVE_CONTEXT_PATHS = 5;

const GATE_STATUSES = ["enabled", "applied", "skipped", "unavailable"] as const;
export type ReviewPlanGateStatus = typeof GATE_STATUSES[number];
export type ReviewPlanContextSourceStatus = ReviewPlanGateStatus;

export type ReviewPlanRoute = {
  kind: "pull_request" | "retry" | "continuation" | "candidate" | "unknown";
  owner?: string;
  repo?: string;
  pullNumber?: number;
  eventName?: string;
  taskType?: string;
  routingReason?: string;
};

export type ReviewPlanScope = {
  changedFileCount: number;
  reviewedFileCount: number;
  totalLinesChanged: number;
  representativePaths: readonly string[];
  omittedPathCount: number;
};

export type ReviewPlanContextSource = {
  name: string;
  status: ReviewPlanContextSourceStatus;
  itemCount: number;
  reason?: string;
  representativePaths: readonly string[];
  omittedPathCount: number;
};

export type ReviewPlanGate = {
  name: string;
  status: ReviewPlanGateStatus;
  reason?: string;
  findingCount?: number;
};

export type ReviewPlanBudget = {
  maxComments: number;
  maxTurns?: number;
  timeoutSeconds?: number;
  tokenBudget?: number;
};

export type ReviewPlanPublishPolicy = {
  mode: "review-comment" | "approve" | "skip" | "dry-run";
  autoApprove: boolean;
  publishReviewDetails: boolean;
  inlineComments: boolean;
  candidateVerificationRequired: boolean;
};

export type ReviewPlan = {
  version: typeof REVIEW_PLAN_VERSION;
  route: ReviewPlanRoute;
  scope: ReviewPlanScope;
  contextSources: readonly ReviewPlanContextSource[];
  gates: readonly ReviewPlanGate[];
  budgets: ReviewPlanBudget;
  publishPolicy: ReviewPlanPublishPolicy;
  stableHash: string;
};

export type ReviewPlanScopeInput = {
  changedFileCount: number;
  reviewedFileCount: number;
  totalLinesChanged: number;
  paths?: readonly string[];
  representativePaths?: readonly string[];
};

export type ReviewPlanContextSourceInput = {
  name: string;
  status?: ReviewPlanContextSourceStatus;
  enabled?: boolean;
  itemCount?: number;
  reason?: string;
  representativePaths?: readonly string[];
};

export type ReviewPlanGateInput = {
  name: string;
  status?: ReviewPlanGateStatus;
  enabled?: boolean;
  reason?: string;
  findingCount?: number;
};

export type ReviewPlanInput = {
  route: ReviewPlanRoute;
  scope: ReviewPlanScopeInput;
  contextSources: readonly ReviewPlanContextSourceInput[];
  gates: readonly ReviewPlanGateInput[];
  budgets: ReviewPlanBudget;
  publishPolicy: ReviewPlanPublishPolicy;
  /** Accepted for caller convenience, intentionally excluded from normalized plan hash material. */
  createdAt?: string;
};

export type ReviewPlanDiagnosticSummary = {
  gate: "review-plan";
  planHash: string;
  route: Pick<ReviewPlanRoute, "kind" | "taskType" | "routingReason">;
  scope: ReviewPlanScope;
  contextSources: readonly ReviewPlanContextSource[];
  gates: readonly ReviewPlanGate[];
  budgets: ReviewPlanBudget;
  publishPolicy: ReviewPlanPublishPolicy;
};

const FORBIDDEN_RAW_FIELD_KEYS = new Set([
  "prompt",
  "rawPrompt",
  "modelPrompt",
  "modelOutput",
  "rawModelOutput",
  "diff",
  "rawDiff",
  "candidatePayload",
  "candidateFindingPayload",
  "commentBody",
  "rawCommentBody",
  "body",
  "secret",
  "secrets",
  "token",
  "apiKey",
  "password",
]);

export function buildReviewPlan(input: ReviewPlanInput): ReviewPlan {
  assertNoForbiddenRawFields(input);

  const hashMaterial = {
    version: REVIEW_PLAN_VERSION,
    route: normalizeRoute(input.route),
    scope: normalizeScope(input.scope),
    contextSources: normalizeContextSources(input.contextSources),
    gates: normalizeGates(input.gates),
    budgets: normalizeBudgets(input.budgets),
    publishPolicy: normalizePublishPolicy(input.publishPolicy),
  } satisfies Omit<ReviewPlan, "stableHash">;

  return {
    ...hashMaterial,
    stableHash: `${REVIEW_PLAN_HASH_PREFIX}${sha256(canonicalJson(hashMaterial))}`,
  };
}

export function summarizeReviewPlanForDiagnostics(plan: ReviewPlan): ReviewPlanDiagnosticSummary {
  return {
    gate: "review-plan",
    planHash: plan.stableHash,
    route: {
      kind: plan.route.kind,
      taskType: plan.route.taskType,
      routingReason: plan.route.routingReason,
    },
    scope: plan.scope,
    contextSources: plan.contextSources,
    gates: plan.gates,
    budgets: plan.budgets,
    publishPolicy: plan.publishPolicy,
  };
}

function normalizeRoute(route: ReviewPlanRoute): ReviewPlanRoute {
  return withoutUndefined({
    kind: typeof route.kind === "string" ? route.kind : "unknown",
    owner: normalizeOptionalString(route.owner),
    repo: normalizeOptionalString(route.repo),
    pullNumber: normalizeOptionalInteger(route.pullNumber),
    eventName: normalizeOptionalString(route.eventName),
    taskType: normalizeOptionalString(route.taskType),
    routingReason: normalizeOptionalString(route.routingReason),
  });
}

function normalizeScope(scope: ReviewPlanScopeInput): ReviewPlanScope {
  const paths = normalizePathList(scope.representativePaths ?? scope.paths ?? []);
  return {
    changedFileCount: normalizeCount(scope.changedFileCount),
    reviewedFileCount: normalizeCount(scope.reviewedFileCount),
    totalLinesChanged: normalizeCount(scope.totalLinesChanged),
    representativePaths: paths.slice(0, MAX_REPRESENTATIVE_SCOPE_PATHS),
    omittedPathCount: Math.max(0, paths.length - MAX_REPRESENTATIVE_SCOPE_PATHS),
  };
}

function normalizeContextSources(contextSources: readonly ReviewPlanContextSourceInput[]): readonly ReviewPlanContextSource[] {
  return [...contextSources]
    .map((source) => {
      const paths = normalizePathList(source.representativePaths ?? []);
      return withoutUndefined({
        name: normalizeRequiredName(source.name, "context source"),
        status: normalizeStatus(source.status, source.enabled),
        itemCount: normalizeCount(source.itemCount ?? 0),
        reason: normalizeOptionalString(source.reason),
        representativePaths: paths.slice(0, MAX_REPRESENTATIVE_CONTEXT_PATHS),
        omittedPathCount: Math.max(0, paths.length - MAX_REPRESENTATIVE_CONTEXT_PATHS),
      });
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeGates(gates: readonly ReviewPlanGateInput[]): readonly ReviewPlanGate[] {
  return [...gates]
    .map((gate) => withoutUndefined({
      name: normalizeRequiredName(gate.name, "gate"),
      status: normalizeStatus(gate.status, gate.enabled),
      reason: normalizeOptionalString(gate.reason),
      findingCount: gate.findingCount === undefined ? undefined : normalizeCount(gate.findingCount),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeBudgets(budgets: ReviewPlanBudget): ReviewPlanBudget {
  return withoutUndefined({
    maxComments: normalizeCount(budgets.maxComments),
    maxTurns: budgets.maxTurns === undefined ? undefined : normalizeCount(budgets.maxTurns),
    timeoutSeconds: budgets.timeoutSeconds === undefined ? undefined : normalizeCount(budgets.timeoutSeconds),
    tokenBudget: budgets.tokenBudget === undefined ? undefined : normalizeCount(budgets.tokenBudget),
  });
}

function normalizePublishPolicy(policy: ReviewPlanPublishPolicy): ReviewPlanPublishPolicy {
  return {
    mode: ["review-comment", "approve", "skip", "dry-run"].includes(policy.mode) ? policy.mode : "review-comment",
    autoApprove: policy.autoApprove === true,
    publishReviewDetails: policy.publishReviewDetails === true,
    inlineComments: policy.inlineComments === true,
    candidateVerificationRequired: policy.candidateVerificationRequired === true,
  };
}

function normalizeStatus(status: unknown, enabled?: boolean): ReviewPlanGateStatus {
  if (enabled === false) return "skipped";
  if ((GATE_STATUSES as readonly unknown[]).includes(status)) return status as ReviewPlanGateStatus;
  return status === undefined ? "enabled" : "unavailable";
}

function normalizePathList(paths: readonly string[]): string[] {
  return [...new Set(paths.map((path) => path.trim()).filter((path) => path.length > 0))];
}

function normalizeRequiredName(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`ReviewPlan ${label} name must not be empty.`);
  return normalized;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeOptionalInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.floor(value));
}

function normalizeCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function assertNoForbiddenRawFields(value: unknown, path: readonly string[] = []): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenRawFields(item, [...path, String(index)]));
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_RAW_FIELD_KEYS.has(key)) {
      throw new Error(`Forbidden raw review-plan field: ${[...path, key].join(".")}`);
    }
    assertNoForbiddenRawFields(child, [...path, key]);
  }
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined)) as T;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(toCanonicalValue(value));
}

function toCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toCanonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, toCanonicalValue(child)]),
    );
  }
  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
