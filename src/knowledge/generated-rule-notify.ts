import type { Logger } from "pino";
import type { GeneratedRuleRecord } from "./generated-rule-store.ts";
import type { ActivationPolicyResult } from "./generated-rule-activation.ts";
import type { RetirementPolicyResult } from "./generated-rule-retirement.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single lifecycle event (activation or retirement) ready for notification.
 */
export type LifecycleEvent = {
  type: "activated" | "retired";
  repo: string;
  ruleId: number;
  title: string;
  signalScore: number;
  memberCount: number;
  reason?: string | null;
  timestamp: string;
};

/**
 * Optional notification hook called once per run with all events.
 * Implementors may post to Slack, write to a queue, etc.
 * Must NOT throw — errors are caught and logged fail-open.
 */
export type LifecycleNotifyHook = (
  events: LifecycleEvent[],
) => Promise<void>;

export type GeneratedRuleNotifyOptions = {
  logger: Logger;
  /** Optional external notification hook (e.g., Slack). Fail-open. */
  notifyHook?: LifecycleNotifyHook;
};

export type NotifyActivationOptions = GeneratedRuleNotifyOptions & {
  result: ActivationPolicyResult;
};

export type NotifyRetirementOptions = GeneratedRuleNotifyOptions & {
  result: RetirementPolicyResult;
};

export type NotifyLifecycleRunOptions = GeneratedRuleNotifyOptions & {
  activation: ActivationPolicyResult;
  retirement: RetirementPolicyResult;
};

export type LifecycleNotifyResult = {
  repo: string;
  activationEvents: number;
  retirementEvents: number;
  notifyHookCalled: boolean;
  notifyHookFailed: boolean;
  durationMs: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getNotifyLogger(logger: Logger, repo: string): Logger {
  return typeof logger.child === "function"
    ? logger.child({ module: "generated-rule-notify", repo })
    : logger;
}

function makeActivationEvents(
  repo: string,
  rules: GeneratedRuleRecord[],
  timestamp: string,
): LifecycleEvent[] {
  return rules.map((rule) => ({
    type: "activated" as const,
    repo,
    ruleId: rule.id,
    title: rule.title,
    signalScore: rule.signalScore,
    memberCount: rule.memberCount,
    reason: null,
    timestamp,
  }));
}

function makeRetirementEvents(
  repo: string,
  rules: GeneratedRuleRecord[],
  timestamp: string,
): LifecycleEvent[] {
  // Retirement records don't carry reason — we reconstruct from the rule's
  // current signalScore and memberCount. Just surface what is known.
  return rules.map((rule) => ({
    type: "retired" as const,
    repo,
    ruleId: rule.id,
    title: rule.title,
    signalScore: rule.signalScore,
    memberCount: rule.memberCount,
    reason: rule.retiredAt ? "policy" : null,
    timestamp,
  }));
}

// ---------------------------------------------------------------------------
// Log emission — one info line per event
// ---------------------------------------------------------------------------

function logLifecycleEvents(notifyLogger: Logger, events: LifecycleEvent[]): void {
  for (const event of events) {
    notifyLogger.info(
      {
        eventType: event.type,
        ruleId: event.ruleId,
        title: event.title,
        signalScore: event.signalScore,
        memberCount: event.memberCount,
        reason: event.reason ?? undefined,
        timestamp: event.timestamp,
        repo: event.repo,
      },
      event.type === "activated"
        ? "Generated-rule lifecycle: rule activated"
        : "Generated-rule lifecycle: rule retired",
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Emit lifecycle notifications for a combined activation + retirement run.
 *
 * Observability:
 * - Emits one structured info log per lifecycle event (activation or retirement).
 * - Calls the optional notifyHook with all events as a batch.
 * - notifyHook failures are caught, logged, and never propagate — caller's
 *   lifecycle state transitions are unaffected.
 *
 * Fail-open: this function should never throw.
 */
export async function notifyLifecycleRun(
  opts: NotifyLifecycleRunOptions,
): Promise<LifecycleNotifyResult> {
  const { logger, activation, retirement, notifyHook } = opts;
  const startTime = Date.now();

  // Use activation repo (retirement will always be same repo in a paired run)
  const repo = activation.repo;
  const notifyLogger = getNotifyLogger(logger, repo);

  const timestamp = new Date().toISOString();
  const activationEvents = makeActivationEvents(repo, activation.activatedRules, timestamp);
  const retirementEvents = makeRetirementEvents(repo, retirement.retiredRules, timestamp);
  const allEvents = [...activationEvents, ...retirementEvents];

  // Structured per-event logs
  logLifecycleEvents(notifyLogger, allEvents);

  // Run-summary log
  notifyLogger.info(
    {
      repo,
      activationEvents: activationEvents.length,
      retirementEvents: retirementEvents.length,
      totalEvents: allEvents.length,
    },
    "Generated-rule lifecycle: notification run complete",
  );

  // Optional notification hook — fail-open
  let notifyHookCalled = false;
  let notifyHookFailed = false;

  if (notifyHook && allEvents.length > 0) {
    notifyHookCalled = true;
    try {
      await notifyHook(allEvents);
    } catch (err) {
      notifyHookFailed = true;
      notifyLogger.warn(
        { err, eventCount: allEvents.length },
        "Generated-rule lifecycle: notification hook failed (fail-open)",
      );
    }
  }

  return {
    repo,
    activationEvents: activationEvents.length,
    retirementEvents: retirementEvents.length,
    notifyHookCalled,
    notifyHookFailed,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Convenience: emit notifications for activation policy result only.
 * Useful when calling activation without a paired retirement sweep.
 */
export async function notifyActivation(
  opts: NotifyActivationOptions,
): Promise<LifecycleNotifyResult> {
  const { logger, result, notifyHook } = opts;
  const startTime = Date.now();
  const repo = result.repo;
  const notifyLogger = getNotifyLogger(logger, repo);

  const timestamp = new Date().toISOString();
  const events = makeActivationEvents(repo, result.activatedRules, timestamp);

  logLifecycleEvents(notifyLogger, events);

  notifyLogger.info(
    { repo, activationEvents: events.length },
    "Generated-rule lifecycle: activation notification complete",
  );

  let notifyHookCalled = false;
  let notifyHookFailed = false;

  if (notifyHook && events.length > 0) {
    notifyHookCalled = true;
    try {
      await notifyHook(events);
    } catch (err) {
      notifyHookFailed = true;
      notifyLogger.warn(
        { err, eventCount: events.length },
        "Generated-rule lifecycle: activation notification hook failed (fail-open)",
      );
    }
  }

  return {
    repo,
    activationEvents: events.length,
    retirementEvents: 0,
    notifyHookCalled,
    notifyHookFailed,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Convenience: emit notifications for retirement policy result only.
 * Useful when calling retirement without a paired activation sweep.
 */
export async function notifyRetirement(
  opts: NotifyRetirementOptions,
): Promise<LifecycleNotifyResult> {
  const { logger, result, notifyHook } = opts;
  const startTime = Date.now();
  const repo = result.repo;
  const notifyLogger = getNotifyLogger(logger, repo);

  const timestamp = new Date().toISOString();
  const events = makeRetirementEvents(repo, result.retiredRules, timestamp);

  logLifecycleEvents(notifyLogger, events);

  notifyLogger.info(
    { repo, retirementEvents: events.length },
    "Generated-rule lifecycle: retirement notification complete",
  );

  let notifyHookCalled = false;
  let notifyHookFailed = false;

  if (notifyHook && events.length > 0) {
    notifyHookCalled = true;
    try {
      await notifyHook(events);
    } catch (err) {
      notifyHookFailed = true;
      notifyLogger.warn(
        { err, eventCount: events.length },
        "Generated-rule lifecycle: retirement notification hook failed (fail-open)",
      );
    }
  }

  return {
    repo,
    activationEvents: 0,
    retirementEvents: events.length,
    notifyHookCalled,
    notifyHookFailed,
    durationMs: Date.now() - startTime,
  };
}
