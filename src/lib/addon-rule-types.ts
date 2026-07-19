export type AddonRuleFinding = {
  addonId: string;
  path?: string;
  rule: string;
  level: "ERROR" | "WARN";
  source: "deterministic" | "llm";
  message: string;
};

export type AddonRuleReviewComment = {
  rulesSource: { kind: "wiki" | "fallback"; url: string };
  findings: AddonRuleFinding[];
  incompleteReason?: string;
};
