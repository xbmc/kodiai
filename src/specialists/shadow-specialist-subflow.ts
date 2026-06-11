import {
  classifyDocsConfigTruthTrigger,
  DOCS_CONFIG_TRUTH_LANE_ID,
  normalizeShadowSpecialistOutput,
  type NormalizedShadowSpecialistOutput,
  type ShadowSpecialistLaneId,
  type ShadowSpecialistOutputInput,
  type ShadowSpecialistTriggerResult,
} from "./shadow-specialist.ts";

export const DEFAULT_SHADOW_SPECIALIST_SUBFLOW_TIMEOUT_MS = 2_500;

const MAX_TIMEOUT_MS = 30_000;

export type ReadOnlyShadowSpecialistRunnerInput = {
  readonly laneId: ShadowSpecialistLaneId;
  readonly matchedPaths: readonly string[];
  readonly changedPaths: readonly string[];
  readonly diffText?: string | null;
  readonly diffSnippet?: string | null;
  readonly workspaceDir?: string | null;
  readonly deliveryId?: string | null;
  readonly reviewOutputKey?: string | null;
  readonly correlationKey?: string | null;
  readonly readOnly: true;
};

export type ReadOnlyShadowSpecialistRunner = (
  input: ReadOnlyShadowSpecialistRunnerInput,
) => Promise<ShadowSpecialistOutputInput | null | undefined> | ShadowSpecialistOutputInput | null | undefined;

export type ShadowSpecialistSubflowInput = {
  readonly changedPaths: readonly unknown[];
  readonly diffText?: string | null;
  readonly diffSnippet?: string | null;
  readonly workspaceDir?: string | null;
  readonly deliveryId?: string | null;
  readonly reviewOutputKey?: string | null;
  readonly correlationKey?: string | null;
  readonly timeoutMs?: number | null;
  readonly runner?: ReadOnlyShadowSpecialistRunner | null;
  readonly now?: () => number;
};

export type ShadowSpecialistSubflowReason =
  | "not-triggered"
  | "runner-timeout"
  | "runner-error"
  | "malformed-output";

export type ShadowSpecialistSubflowResult = {
  readonly trigger: ShadowSpecialistTriggerResult;
  readonly output: NormalizedShadowSpecialistOutput;
  readonly durationMs: number;
  readonly laneId: ShadowSpecialistLaneId | null;
  readonly triggerStatus: ShadowSpecialistTriggerResult["status"];
  readonly skipReason: ShadowSpecialistTriggerResult["skipReason"] | ShadowSpecialistSubflowReason | null;
  readonly degradedReason: ShadowSpecialistTriggerResult["degradedReason"] | ShadowSpecialistSubflowReason | null;
  readonly errorKind: ShadowSpecialistTriggerResult["errorKind"] | ShadowSpecialistSubflowReason | null;
  readonly timeoutReason: "runner-timeout" | null;
  readonly errorReason: "runner-error" | null;
  readonly unclassifiableReason: "malformed-output" | null;
  readonly deliveryId: string | null;
  readonly reviewOutputKey: string | null;
  readonly correlationKey: string | null;
  readonly candidateCount: number;
  readonly decisionCount: number;
  readonly duplicateCount: number;
  readonly disagreementCount: number;
  readonly metricAvailability: NormalizedShadowSpecialistOutput["metricAvailability"];
  readonly redactionFlags: NormalizedShadowSpecialistOutput["redactionFlags"];
  readonly shadowOnly: true;
  readonly publishesFindings: false;
};

export async function runShadowSpecialistSubflow(
  input: ShadowSpecialistSubflowInput,
): Promise<ShadowSpecialistSubflowResult> {
  const now = input.now ?? Date.now;
  const startMs = now();
  const trigger = classifyDocsConfigTruthTrigger({
    changedPaths: input.changedPaths,
    correlationKey: input.correlationKey,
  });

  if (trigger.status !== "triggered" || trigger.laneId !== DOCS_CONFIG_TRUTH_LANE_ID) {
    const output = normalizeShadowSpecialistOutput({
      laneId: DOCS_CONFIG_TRUTH_LANE_ID,
      status: "skipped",
      skipReason: "not-applicable",
      deliveryId: input.deliveryId,
      reviewOutputKey: input.reviewOutputKey,
      correlationKey: trigger.correlationKey,
    });

    return buildResult({
      trigger,
      output,
      durationMs: elapsedMs(now, startMs),
      skipReason: trigger.skipReason ?? "not-triggered",
      degradedReason: trigger.degradedReason,
      errorKind: trigger.errorKind,
      timeoutReason: null,
      errorReason: null,
      unclassifiableReason: null,
    });
  }

  const timeoutMs = normalizeTimeoutMs(input.timeoutMs);
  const runner = input.runner ?? defaultReadOnlyShadowSpecialistRunner;

  try {
    const runnerOutput = await runWithTimeout(
      () => runner({
        laneId: DOCS_CONFIG_TRUTH_LANE_ID,
        matchedPaths: trigger.matchedPaths,
        changedPaths: normalizeRunnerChangedPaths(input.changedPaths),
        ...(input.diffSnippet ? { diffSnippet: input.diffSnippet } : { diffText: input.diffText ?? null }),
        workspaceDir: input.workspaceDir ?? null,
        deliveryId: input.deliveryId ?? null,
        reviewOutputKey: input.reviewOutputKey ?? null,
        correlationKey: trigger.correlationKey,
        readOnly: true,
      }),
      timeoutMs,
    );

    const output = normalizeShadowSpecialistOutput({
      ...runnerOutput,
      deliveryId: input.deliveryId ?? runnerOutput?.deliveryId,
      reviewOutputKey: input.reviewOutputKey ?? runnerOutput?.reviewOutputKey,
      correlationKey: trigger.correlationKey ?? runnerOutput?.correlationKey,
    });
    const unclassifiableReason = output.status === "unclassifiable" ? "malformed-output" : null;

    return buildResult({
      trigger,
      output,
      durationMs: elapsedMs(now, startMs),
      skipReason: null,
      degradedReason: unclassifiableReason ?? trigger.degradedReason,
      errorKind: trigger.errorKind,
      timeoutReason: null,
      errorReason: null,
      unclassifiableReason,
    });
  } catch (error) {
    const timeoutReason = error instanceof ShadowSpecialistTimeoutError ? "runner-timeout" : null;
    const errorReason = timeoutReason ? null : "runner-error";
    const status = timeoutReason ? "degraded" : "error";
    const output = normalizeShadowSpecialistOutput({
      laneId: DOCS_CONFIG_TRUTH_LANE_ID,
      status,
      skipReason: "missing-output",
      deliveryId: input.deliveryId,
      reviewOutputKey: input.reviewOutputKey,
      correlationKey: trigger.correlationKey,
      metrics: timeoutReason ? { latencyMs: timeoutMs } : undefined,
    });

    return buildResult({
      trigger,
      output,
      durationMs: elapsedMs(now, startMs),
      skipReason: null,
      degradedReason: timeoutReason,
      errorKind: errorReason,
      timeoutReason,
      errorReason,
      unclassifiableReason: null,
    });
  }
}

function defaultReadOnlyShadowSpecialistRunner(
  input: ReadOnlyShadowSpecialistRunnerInput,
): ShadowSpecialistOutputInput {
  return {
    laneId: input.laneId,
    status: "skipped",
    skipReason: "no-candidates",
    deliveryId: input.deliveryId,
    reviewOutputKey: input.reviewOutputKey,
    correlationKey: input.correlationKey,
  };
}

function buildResult(params: {
  trigger: ShadowSpecialistTriggerResult;
  output: NormalizedShadowSpecialistOutput;
  durationMs: number;
  skipReason: ShadowSpecialistSubflowResult["skipReason"];
  degradedReason: ShadowSpecialistSubflowResult["degradedReason"];
  errorKind: ShadowSpecialistSubflowResult["errorKind"];
  timeoutReason: ShadowSpecialistSubflowResult["timeoutReason"];
  errorReason: ShadowSpecialistSubflowResult["errorReason"];
  unclassifiableReason: ShadowSpecialistSubflowResult["unclassifiableReason"];
}): ShadowSpecialistSubflowResult {
  return {
    trigger: params.trigger,
    output: params.output,
    durationMs: params.durationMs,
    laneId: params.trigger.laneId,
    triggerStatus: params.trigger.status,
    skipReason: params.skipReason,
    degradedReason: params.degradedReason,
    errorKind: params.errorKind,
    timeoutReason: params.timeoutReason,
    errorReason: params.errorReason,
    unclassifiableReason: params.unclassifiableReason,
    deliveryId: params.output.deliveryId,
    reviewOutputKey: params.output.reviewOutputKey,
    correlationKey: params.trigger.correlationKey ?? params.output.correlationKey,
    candidateCount: params.output.candidateCount,
    decisionCount: params.output.metrics.decisionCount,
    duplicateCount: params.output.duplicateCount,
    disagreementCount: params.output.disagreementCount,
    metricAvailability: params.output.metricAvailability,
    redactionFlags: params.output.redactionFlags,
    shadowOnly: true,
    publishesFindings: false,
  };
}

function normalizeRunnerChangedPaths(changedPaths: readonly unknown[]): readonly string[] {
  return changedPaths.filter((path): path is string => typeof path === "string").map((path) => path.trim()).filter(Boolean);
}

function normalizeTimeoutMs(timeoutMs: number | null | undefined): number {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return DEFAULT_SHADOW_SPECIALIST_SUBFLOW_TIMEOUT_MS;
  }

  return Math.min(Math.ceil(timeoutMs), MAX_TIMEOUT_MS);
}

function elapsedMs(now: () => number, startMs: number): number {
  return Math.max(0, Math.round(now() - startMs));
}

class ShadowSpecialistTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`shadow specialist timed out after ${timeoutMs}ms`);
    this.name = "ShadowSpecialistTimeoutError";
  }
}

function runWithTimeout<T>(operation: () => Promise<T> | T, timeoutMs: number): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new ShadowSpecialistTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  return Promise.race([Promise.resolve().then(operation), timeoutPromise]).finally(() => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  });
}
