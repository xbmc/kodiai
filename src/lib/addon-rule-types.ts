export type AddonRuleFinding = {
  addonId: string;
  path?: string;
  line?: number;
  rule: string;
  level: "ERROR" | "WARN";
  source: "deterministic" | "llm";
  message: string;
};

export type AddonRuleIncompleteReason =
  | "rules-fallback"
  | "llm-incomplete"
  | "patch-unavailable"
  | "patch-truncated"
  | "checker-incomplete";

export type AddonRuleReviewComment = {
  rulesSource: { kind: "wiki" | "fallback"; url: string };
  summary: string;
  findings: AddonRuleFinding[];
  incompleteReasons: AddonRuleIncompleteReason[];
};
