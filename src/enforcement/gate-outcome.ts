import type { FindingSeverity } from "../knowledge/types.ts";

/**
 * Shared vocabulary for enforcement gates that fact-check a finding and may
 * pull its severity down.
 *
 * Each gate used to stamp its own parallel family of fields onto the finding
 * (`groundingChecked`/`groundingVerified`/`groundingDowngraded`/
 * `groundingReason`/`preGroundingSeverity`, then the same five again with a
 * `semantic` prefix). Every consumer then had to know all of them: the reducer
 * carried six optional fields, OR-ed two `...Downgraded` flags in two places,
 * duplicated its audit/log block per gate, and reconstructed the original
 * severity with a `preGroundingSeverity ?? preSemanticGroundingSeverity ??`
 * chain whose correctness depended on knowing the gate execution order.
 *
 * One ordered list of outcomes replaces all of it. Gate order is positional
 * fact rather than tribal knowledge, so "the severity before any gate touched
 * this finding" is just the first recorded `from`, and adding a third gate
 * costs no new fields anywhere.
 */
export type SeverityGate = "diff-grounding" | "semantic-grounding";

export type GateOutcome = {
  gate: SeverityGate;
  /** Gate-specific reason code (see each gate's reason-code union). */
  reason: string;
  /** Whether the gate actually evaluated this finding (false = skipped/fail-open). */
  checked: boolean;
  /** Whether the finding passed. Skipped findings are `true` -- absence of evidence is not evidence. */
  verified: boolean;
  /** Severity before this gate's downgrade. Present only when the gate downgraded. */
  from?: FindingSeverity;
  /** Severity after this gate's downgrade. Present only when the gate downgraded. */
  to?: FindingSeverity;
  /** Free-text explanation, when the gate produces one (e.g. an LLM justification). */
  justification?: string;
};

export type GateAdjustedFinding = {
  /**
   * Append-only, in gate execution order -- always add via `withGateOutcome`.
   *
   * `severityBeforeGates` depends on this ordering and nothing else: the first
   * outcome carrying a `from` belongs to the first gate that downgraded, and
   * that gate's input severity is by definition the severity before any gate
   * touched the finding. Note this holds whichever order the gates run in, so
   * reordering the pipeline is safe; what would break it is building this array
   * out of execution order, which `readonly` is here to discourage.
   */
  gateOutcomes?: readonly GateOutcome[];
};

/** Severities whose citation/reasoning is expensive enough to warrant a gate check. */
export const GATE_ELIGIBLE_SEVERITIES: ReadonlySet<FindingSeverity> = new Set(["critical", "major"]);

/** Target severity when a gate cannot verify a finding. Gates downgrade, never drop. */
export const GATE_DOWNGRADE_TARGET: FindingSeverity = "medium";

/** Append an outcome without mutating the input finding. */
export function withGateOutcome<T extends GateAdjustedFinding>(
  finding: T,
  outcome: GateOutcome,
): T & Required<GateAdjustedFinding> {
  return { ...finding, gateOutcomes: [...(finding.gateOutcomes ?? []), outcome] };
}

export function gateOutcomeFor(
  finding: GateAdjustedFinding,
  gate: SeverityGate,
): GateOutcome | undefined {
  return finding.gateOutcomes?.find((outcome) => outcome.gate === gate);
}

/** True when any gate pulled this finding's severity down. */
export function wasDowngradedByGate(finding: GateAdjustedFinding): boolean {
  return finding.gateOutcomes?.some((outcome) => outcome.from !== undefined) ?? false;
}

/**
 * The severity this finding held before any gate touched it.
 *
 * Downstream filters that drop by severity (abbreviated-tier suppression, the
 * `minConfidence` floor) must judge on this, not the post-downgrade value --
 * otherwise a gate downgrade to `medium` silently deletes the finding and
 * breaks every gate's "never drop, downgrade instead" invariant.
 */
export function severityBeforeGates(
  finding: GateAdjustedFinding & { severity: FindingSeverity },
): FindingSeverity {
  // First recorded `from` == first gate that downgraded == pre-gate severity.
  // See the ordering note on GateAdjustedFinding.gateOutcomes.
  return finding.gateOutcomes?.find((outcome) => outcome.from !== undefined)?.from ?? finding.severity;
}
