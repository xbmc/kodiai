export type AdvisorySeverity = "critical" | "high" | "medium" | "low" | "unknown";

const SEVERITY_ORDER: Record<AdvisorySeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  unknown: 0,
};

export function normalizeAdvisorySeverity(value: string | null | undefined): AdvisorySeverity {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized in SEVERITY_ORDER ? normalized as AdvisorySeverity : "unknown";
}

export function maxAdvisorySeverity(
  advisories: Array<string | { severity?: string | null }>,
): AdvisorySeverity {
  let max: AdvisorySeverity = "unknown";
  let maxOrder = 0;
  for (const advisory of advisories) {
    const severity = normalizeAdvisorySeverity(
      typeof advisory === "string" ? advisory : advisory.severity,
    );
    const order = SEVERITY_ORDER[severity];
    if (order > maxOrder) {
      maxOrder = order;
      max = severity;
    }
  }
  return max;
}
