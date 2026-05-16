import { createHash } from "node:crypto";

export type GraphValidationPlanStatus = "enabled" | "unavailable" | "skipped" | "applied";
export type GraphValidationPlanReason =
  | "config-disabled"
  | "review-graph-query-not-configured"
  | "trivial-change-bypass"
  | "no-graph-blast-radius"
  | "graph-blast-radius-available"
  | "validated-findings";
export type GraphValidationPlanProjection = {
  status: GraphValidationPlanStatus;
  reason: GraphValidationPlanReason;
};
export type ResolveGraphValidationPlanStatusInput = {
  configEnabled?: boolean;
  graphQueryAvailable?: boolean;
  graphBlastRadiusAvailable?: boolean;
  trivialChangeBypass?: boolean;
  finalValidationApplied?: boolean;
};
export type CandidateFindingMode = "unavailable" | "shadow" | "preferred";
export type ReviewPlanStatus = "ready";
export type DegradedReviewPlanStatus = "degraded";

export type ReviewPlanInput = {
  task: {
    taskType: string;
    routingReason: string;
  };
  change: {
    changedFileCount: number;
    linesChanged: number;
    linesChangedSource: string;
  };
  budget?: {
    timeoutSeconds?: number;
    maxTurns?: number;
    maxTurnsSource?: string;
  };
  context?: {
    sources?: string[];
    summary?: string;
  };
  gates?: {
    enabled?: string[];
    current?: string[];
  };
  policy: {
    publish: string;
    tools: string;
    retry: string;
  };
  graphValidation?: {
    status: GraphValidationPlanStatus;
    reason?: GraphValidationPlanReason | string;
  };
  candidateFinding?: {
    mode: CandidateFindingMode;
    reason?: string;
  };
};

export type ReviewPlan = {
  status: ReviewPlanStatus;
  hash: string;
  task: {
    taskType: string;
    routingReason: string;
  };
  change: {
    changedFileCount: number;
    linesChanged: number;
    linesChangedSource: string;
  };
  budget: {
    timeoutSeconds?: number;
    maxTurns?: number;
    maxTurnsSource?: string;
  };
  context: {
    sources: string[];
    summary?: string;
  };
  gates: {
    enabled: string[];
    current: string[];
  };
  policy: {
    publish: string;
    tools: string;
    retry: string;
  };
  graphValidation: {
    status: GraphValidationPlanStatus;
    reason?: GraphValidationPlanReason | string;
  };
  candidateFinding: {
    mode: CandidateFindingMode;
    reason?: string;
  };
};

export type DegradedReviewPlan = {
  status: DegradedReviewPlanStatus;
  hash: string;
  degraded: {
    reason: string;
    message?: string;
  };
  task: {
    taskType?: string;
    routingReason?: string;
  };
  graphValidation: {
    status: "skipped";
    reason: "review-plan-degraded";
  };
  candidateFinding: {
    mode: "unavailable";
    reason: "review-plan-degraded";
  };
};

export type ReviewPlanBuildResult =
  | { status: "ready"; plan: ReviewPlan }
  | { status: "degraded"; plan: DegradedReviewPlan };

export type ReviewPlanDetailsSummary = {
  label: "Review plan";
  text: string;
  status: ReviewPlanStatus | DegradedReviewPlanStatus;
  hash: string;
};

type DegradedReviewPlanInput = {
  reason: string;
  message?: string;
  taskType?: string;
  routingReason?: string;
};

export function resolveGraphValidationPlanStatus(input: ResolveGraphValidationPlanStatusInput): GraphValidationPlanProjection {
  if (!input.configEnabled) {
    return { status: "skipped", reason: "config-disabled" };
  }

  if (!input.graphQueryAvailable) {
    return { status: "unavailable", reason: "review-graph-query-not-configured" };
  }

  if (input.trivialChangeBypass) {
    return { status: "skipped", reason: "trivial-change-bypass" };
  }

  if (!input.graphBlastRadiusAvailable) {
    return { status: "skipped", reason: "no-graph-blast-radius" };
  }

  if (input.finalValidationApplied) {
    return { status: "applied", reason: "validated-findings" };
  }

  return { status: "enabled", reason: "graph-blast-radius-available" };
}

export function buildReviewPlan(input: ReviewPlanInput): Extract<ReviewPlanBuildResult, { status: "ready" }> {
  const planWithoutHash = {
    status: "ready" as const,
    task: {
      taskType: input.task.taskType,
      routingReason: input.task.routingReason,
    },
    change: {
      changedFileCount: input.change.changedFileCount,
      linesChanged: input.change.linesChanged,
      linesChangedSource: input.change.linesChangedSource,
    },
    budget: normalizeBudget(input.budget),
    context: normalizeContext(input.context),
    gates: normalizeGates(input.gates),
    policy: {
      publish: input.policy.publish,
      tools: input.policy.tools,
      retry: input.policy.retry,
    },
    graphValidation: normalizeGraphValidation(input.graphValidation),
    candidateFinding: normalizeCandidateFinding(input.candidateFinding),
  };
  const hash = hashCanonical(planWithoutHash);

  return {
    status: "ready",
    plan: {
      ...planWithoutHash,
      hash,
    },
  };
}

export function createDegradedReviewPlan(input: DegradedReviewPlanInput): DegradedReviewPlan {
  const degradedWithoutHash = {
    status: "degraded" as const,
    degraded: {
      reason: input.reason,
      ...(input.message === undefined ? {} : { message: input.message }),
    },
    task: {
      ...(input.taskType === undefined ? {} : { taskType: input.taskType }),
      ...(input.routingReason === undefined ? {} : { routingReason: input.routingReason }),
    },
    graphValidation: {
      status: "skipped" as const,
      reason: "review-plan-degraded" as const,
    },
    candidateFinding: {
      mode: "unavailable" as const,
      reason: "review-plan-degraded" as const,
    },
  };
  const hash = `degraded-${hashCanonical(degradedWithoutHash).slice(0, 16)}`;

  return {
    ...degradedWithoutHash,
    hash,
  };
}

export function toReviewPlanDetailsSummary(plan: ReviewPlan | DegradedReviewPlan): ReviewPlanDetailsSummary {
  if (plan.status === "degraded") {
    const route = plan.task.routingReason ?? "unknown";
    const reason = sanitizeSummaryToken(plan.degraded.reason);
    return {
      label: "Review plan",
      status: "degraded",
      hash: plan.hash,
      text: boundSummary(`Review plan: degraded hash=${plan.hash} route=${route} reason=${reason} graph=skipped candidates=unavailable`),
    };
  }

  return {
    label: "Review plan",
    status: "ready",
    hash: plan.hash,
    text: boundSummary([
      `Review plan: ready hash=${plan.hash.slice(0, 12)}`,
      `route=${sanitizeSummaryToken(plan.task.routingReason)}`,
      `task=${sanitizeSummaryToken(plan.task.taskType)}`,
      `files=${plan.change.changedFileCount}`,
      `lines=${plan.change.linesChanged}(${sanitizeSummaryToken(plan.change.linesChangedSource)})`,
      `budget=${formatBudget(plan.budget)}`,
      `gates=${plan.gates.current.length}/${plan.gates.enabled.length}`,
      `publish=${sanitizeSummaryToken(plan.policy.publish)}`,
      `graph=${plan.graphValidation.status}`,
      `candidates=${plan.candidateFinding.mode}`,
    ].join(" ")),
  };
}

function normalizeBudget(input: ReviewPlanInput["budget"]): ReviewPlan["budget"] {
  if (!input) {
    return {};
  }

  return stripUndefinedObject({
    timeoutSeconds: input.timeoutSeconds,
    maxTurns: input.maxTurns,
    maxTurnsSource: input.maxTurnsSource,
  });
}

function normalizeContext(input: ReviewPlanInput["context"]): ReviewPlan["context"] {
  if (!input) {
    return { sources: [] };
  }

  return {
    sources: [...(input.sources ?? [])],
    ...(input.summary === undefined && "summary" in input ? { summary: input.summary } : input.summary === undefined ? {} : { summary: input.summary }),
  };
}

function normalizeGates(input: ReviewPlanInput["gates"]): ReviewPlan["gates"] {
  return {
    enabled: [...(input?.enabled ?? [])],
    current: [...(input?.current ?? [])],
  };
}

function normalizeGraphValidation(input: ReviewPlanInput["graphValidation"]): ReviewPlan["graphValidation"] {
  if (!input) {
    return resolveGraphValidationPlanStatus({ configEnabled: false });
  }

  return {
    status: input.status,
    ...(input.reason === undefined ? {} : { reason: sanitizeSummaryToken(String(input.reason)) }),
  };
}

function normalizeCandidateFinding(input: ReviewPlanInput["candidateFinding"]): ReviewPlan["candidateFinding"] {
  const mode = input?.mode === "shadow" || input?.mode === "preferred" ? input.mode : "unavailable";
  return {
    mode,
    ...(input?.reason === undefined ? {} : { reason: input.reason }),
  };
}

function stripUndefinedObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)) as T;
}

function hashCanonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown, path = ""): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Unsupported non-finite number at ${path || "<root>"}`);
    }
    return JSON.stringify(value);
  }

  if (value === undefined) {
    throw new TypeError(`Unsupported undefined value at ${path || "<root>"}`);
  }

  if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") {
    throw new TypeError(`Unsupported ${typeof value} value at ${path || "<root>"}`);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item, index) => canonicalJson(item, `${path}[${index}]`)).join(",")}]`;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key], path ? `${path}.${key}` : key)}`).join(",")}}`;
  }

  throw new TypeError(`Unsupported value at ${path || "<root>"}`);
}

function formatBudget(budget: ReviewPlan["budget"]): string {
  const maxTurns = budget.maxTurns === undefined ? "na" : `${budget.maxTurns}t`;
  const timeout = budget.timeoutSeconds === undefined ? "na" : `${budget.timeoutSeconds}s`;
  return `${maxTurns}/${timeout}`;
}

function sanitizeSummaryToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9._:-]+/g, "-").slice(0, 48) || "unknown";
}

function boundSummary(value: string): string {
  return value.length <= 240 ? value : `${value.slice(0, 239)}…`;
}
