import type { Logger } from "pino";
import type { GeneratedRuleRecord, GeneratedRuleStore } from "./generated-rule-store.ts";

export const DEFAULT_ACTIVATION_THRESHOLD = 0.7;
export const ACTIVATION_THRESHOLD_ENV_VAR = "GENERATED_RULE_ACTIVATION_THRESHOLD";

const DEFAULT_PENDING_LIMIT = 100;

/**
 * Reads the activation threshold from the environment variable
 * GENERATED_RULE_ACTIVATION_THRESHOLD, falling back to DEFAULT_ACTIVATION_THRESHOLD.
 * Invalid or out-of-range values (not in [0,1]) are ignored in favour of the default.
 */
export function getActivationThreshold(): number {
  const raw = process.env[ACTIVATION_THRESHOLD_ENV_VAR];
  if (raw) {
    const parsed = parseFloat(raw);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
      return parsed;
    }
  }
  return DEFAULT_ACTIVATION_THRESHOLD;
}

/**
 * Pure predicate: returns true when a rule's signalScore meets or exceeds the
 * activation threshold.  Exported for use in unit tests without any store dependency.
 */
export function shouldAutoActivate(signalScore: number, threshold: number): boolean {
  return signalScore >= threshold;
}

export type ApplyActivationPolicyOptions = {
  store: GeneratedRuleStore;
  logger: Logger;
  repo: string;
  /** Defaults to getActivationThreshold(). Explicit value overrides env lookup. */
  threshold?: number;
  /** Max pending rules to evaluate in one run (default: 100). */
  limit?: number;
};

export type ActivationPolicyResult = {
  repo: string;
  threshold: number;
  pendingEvaluated: number;
  activated: number;
  skipped: number;
  activationFailures: number;
  activatedRules: GeneratedRuleRecord[];
  durationMs: number;
};

/**
 * Fetch all pending rules for a repo, evaluate each against the threshold, and
 * activate qualifying rules via the store.  Fail-open: activation failures for
 * individual rules are logged and counted, but do not abort the run.
 */
export async function applyActivationPolicy(
  opts: ApplyActivationPolicyOptions,
): Promise<ActivationPolicyResult> {
  const {
    store,
    logger,
    repo,
    threshold = getActivationThreshold(),
    limit = DEFAULT_PENDING_LIMIT,
  } = opts;

  const startTime = Date.now();
  const activationLogger = typeof logger.child === "function"
    ? logger.child({ module: "generated-rule-activation", repo })
    : logger;

  const pending = await store.listRulesForRepo(repo, { status: "pending", limit });

  activationLogger.info(
    { repo, pendingCount: pending.length, threshold },
    "Activation policy: evaluating pending rules",
  );

  let activated = 0;
  let skipped = 0;
  let activationFailures = 0;
  const activatedRules: GeneratedRuleRecord[] = [];

  for (const rule of pending) {
    const qualifies = shouldAutoActivate(rule.signalScore, threshold);

    if (!qualifies) {
      skipped++;
      activationLogger.debug(
        {
          ruleId: rule.id,
          title: rule.title,
          signalScore: rule.signalScore,
          threshold,
          decision: "skipped",
          reason: "below-threshold",
        },
        "Activation policy: rule below threshold",
      );
      continue;
    }

    // Threshold hit — attempt activation
    activationLogger.info(
      {
        ruleId: rule.id,
        title: rule.title,
        signalScore: rule.signalScore,
        threshold,
        decision: "activating",
      },
      "Activation policy: threshold hit — activating rule",
    );

    try {
      const activatedRule = await store.activateRule(rule.id);
      if (activatedRule) {
        activated++;
        activatedRules.push(activatedRule);
        activationLogger.info(
          {
            ruleId: activatedRule.id,
            title: activatedRule.title,
            signalScore: activatedRule.signalScore,
            memberCount: activatedRule.memberCount,
            activatedAt: activatedRule.activatedAt,
            repo,
          },
          "Activation policy: rule auto-activated",
        );
      } else {
        // Rule disappeared between list and activate (race condition or already gone)
        activationLogger.warn(
          { ruleId: rule.id, title: rule.title, repo },
          "Activation policy: activateRule returned null — rule may have been removed concurrently",
        );
        activationFailures++;
      }
    } catch (err) {
      activationFailures++;
      activationLogger.warn(
        { err, ruleId: rule.id, title: rule.title, repo },
        "Activation policy: rule activation failed (fail-open)",
      );
    }
  }

  const result: ActivationPolicyResult = {
    repo,
    threshold,
    pendingEvaluated: pending.length,
    activated,
    skipped,
    activationFailures,
    activatedRules,
    durationMs: Date.now() - startTime,
  };

  activationLogger.info(
    {
      repo,
      threshold,
      pendingEvaluated: result.pendingEvaluated,
      activated: result.activated,
      skipped: result.skipped,
      activationFailures: result.activationFailures,
      durationMs: result.durationMs,
    },
    "Activation policy: run complete",
  );

  return result;
}
