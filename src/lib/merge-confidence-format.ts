import type { MergeConfidence } from "./merge-confidence.ts";

export function renderApprovalConfidence(mc: MergeConfidence): string {
  const emoji = mc.level === "high" ? ":green_circle:" : mc.level === "medium" ? ":yellow_circle:" : ":red_circle:";
  const label = mc.level === "high" ? "High" : mc.level === "medium" ? "Review Recommended" : "Careful Review Required";
  return `${emoji} **Merge Confidence: ${label}** — ${mc.rationale[0] ?? ""}`;
}
