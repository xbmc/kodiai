import type { Logger } from "pino";
import type { GeneratedRuleRecord, GeneratedRuleStore } from "./generated-rule-store.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default signal-score floor below which an active rule is retired.
 * Rules with signalScore < retirementFloor are considered signal-decayed.
 */
export const DEFAULT_RETIREMENT_FLOOR = 0.3;
export const RETIREMENT_FLOOR_ENV_VAR = "GENERATED_RULE_RETIREMENT_FLOOR";

/**
 * Default minimum member count required to keep a rule active.
 * Rules with memberCount < minMemberCount are considered evidence-decayed.
 */
export const DEFAULT_MIN_MEMBER_COUNT = 3;
export const MIN_MEMBER_COUNT_ENV_VAR = "GENERATED_RULE_MIN_MEMBER_COUNT";

const DEFAULT_ACTIVE_LIMIT = 100;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RetirementReason = "below-floor" | "member-decay";

export type RuleRetirementDecision = {
  ruleId: number;
  title: string;
  signalScore: number;
  memberCount: number;
  shouldRetire: boolean;
  reason: RetirementReason | null;
};

export type ApplyRetirementPolicyOptions = {
  store: GeneratedRuleStore;
  logger: Logger;
  repo: string;
  /** Floor below which signalScore triggers retirement (default: getRetirementFloor()). */
  floor?: number;
  /** Minimum member count; below this triggers retirement (default: getMinMemberCount()). */
  minMemberCount?: number;
  /** Max active rules to evaluate in one run (default: 100). */
  limit?: number;
};

export type RetirementPolicyResult = {
  repo: string;
  floor: number;
  minMemberCount: number;
  activeEvaluated: number;
  retired: number;
  kept: number;
  retirementFailures: number;
  retiredRules: GeneratedRuleRecord[];
  durationMs: number;
};

// ---------------------------------------------------------------------------
// Environment-sourced configuration
// ---------------------------------------------------------------------------

/**
 * Reads the retirement floor from GENERATED_RULE_RETIREMENT_FLOOR, falling
 * back to DEFAULT_RETIREMENT_FLOOR.  Invalid or out-of-range values ([0,1])
 * are ignored in favour of the default.
 */
export function getRetirementFloor(): number {
  const raw = process.env[RETIREMENT_FLOOR_ENV_VAR];
  if (raw) {
    const parsed = parseFloat(raw);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
      return parsed;
    }
  }
  return DEFAULT_RETIREMENT_FLOOR;
}

/**
 * Reads the minimum member count from GENERATED_RULE_MIN_MEMBER_COUNT, falling
 * back to DEFAULT_MIN_MEMBER_COUNT.  Must be a positive integer; invalid values
 * fall back to the default.
 */
export function getMinMemberCount(): number {
  const raw = process.env[MIN_MEMBER_COUNT_ENV_VAR];
  if (raw) {
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_MIN_MEMBER_COUNT;
}

// ---------------------------------------------------------------------------
// Pure predicate
// ---------------------------------------------------------------------------

/**
 * Pure decision function: returns whether a rule should be retired and the
 * primary reason.  When multiple conditions apply, `below-floor` takes
 * precedence over `member-decay` in the returned reason (both are still
 * logged by the caller).
 */
export function shouldRetireRule(
  rule: GeneratedRuleRecord,
  opts: { floor: number; minMemberCount: number },
): RuleRetirementDecision {
  const signalDecayed = rule.signalScore < opts.floor;
  const memberDecayed = rule.memberCount < opts.minMemberCount;

  const shouldRetire = signalDecayed || memberDecayed;
  let reason: RetirementReason | null = null;
  if (signalDecayed) reason = "below-floor";
  else if (memberDecayed) reason = "member-decay";

  return {
    ruleId: rule.id,
    title: rule.title,
    signalScore: rule.signalScore,
    memberCount: rule.memberCount,
    shouldRetire,
    reason,
  };
}

// ---------------------------------------------------------------------------
// Policy runner
// ---------------------------------------------------------------------------

/**
 * Fetch all active rules for a repo, evaluate each against the retirement
 * criteria, and retire qualifying rules via the store.
 *
 * Fail-open: retirement failures for individual rules are logged and counted,
 * but do not abort the run.
 *
 * Observability:
 * - Logs the retirement decision (with reason) for every rule evaluated.
 * - Logs a run-complete summary with counts and durationMs.
 */
export async function applyRetirementPolicy(
  opts: ApplyRetirementPolicyOptions,
): Promise<RetirementPolicyResult> {
  const {
    store,
    logger,
    repo,
    floor = getRetirementFloor(),
    minMemberCount = getMinMemberCount(),
    limit = DEFAULT_ACTIVE_LIMIT,
  } = opts;

  const startTime = Date.now();
  const retirementLogger =
    typeof logger.child === "function"
      ? logger.child({ module: "generated-rule-retirement", repo })
      : logger;

  const active = await store.listRulesForRepo(repo, { status: "active", limit });

  retirementLogger.info(
    { repo, activeCount: active.length, floor, minMemberCount },
    "Retirement policy: evaluating active rules",
  );

  let retired = 0;
  let kept = 0;
  let retirementFailures = 0;
  const retiredRules: GeneratedRuleRecord[] = [];

  for (const rule of active) {
    const decision = shouldRetireRule(rule, { floor, minMemberCount });

    if (!decision.shouldRetire) {
      kept++;
      retirementLogger.debug(
        {
          ruleId: rule.id,
          title: rule.title,
          signalScore: rule.signalScore,
          memberCount: rule.memberCount,
          floor,
          minMemberCount,
          decision: "kept",
        },
        "Retirement policy: rule passes all criteria — keeping active",
      );
      continue;
    }

    retirementLogger.info(
      {
        ruleId: rule.id,
        title: rule.title,
        signalScore: rule.signalScore,
        memberCount: rule.memberCount,
        floor,
        minMemberCount,
        reason: decision.reason,
        decision: "retiring",
      },
      "Retirement policy: retirement criterion met — retiring rule",
    );

    try {
      const retiredRule = await store.retireRule(rule.id);
      if (retiredRule) {
        retired++;
        retiredRules.push(retiredRule);
        retirementLogger.info(
          {
            ruleId: retiredRule.id,
            title: retiredRule.title,
            signalScore: retiredRule.signalScore,
            memberCount: retiredRule.memberCount,
            retiredAt: retiredRule.retiredAt,
            reason: decision.reason,
            repo,
          },
          "Retirement policy: rule retired",
        );
      } else {
        // Rule disappeared between list and retire (race or concurrent deletion)
        retirementLogger.warn(
          { ruleId: rule.id, title: rule.title, repo },
          "Retirement policy: retireRule returned null — rule may have been removed concurrently",
        );
        retirementFailures++;
      }
    } catch (err) {
      retirementFailures++;
      retirementLogger.warn(
        { err, ruleId: rule.id, title: rule.title, repo },
        "Retirement policy: rule retirement failed (fail-open)",
      );
    }
  }

  const result: RetirementPolicyResult = {
    repo,
    floor,
    minMemberCount,
    activeEvaluated: active.length,
    retired,
    kept,
    retirementFailures,
    retiredRules,
    durationMs: Date.now() - startTime,
  };

  retirementLogger.info(
    {
      repo,
      floor,
      minMemberCount,
      activeEvaluated: result.activeEvaluated,
      retired: result.retired,
      kept: result.kept,
      retirementFailures: result.retirementFailures,
      durationMs: result.durationMs,
    },
    "Retirement policy: run complete",
  );

  return result;
}
