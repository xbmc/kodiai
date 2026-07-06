import { createHash } from "node:crypto";
import type { Logger } from "pino";
import type { TriageCooldownStore } from "../lib/mention-state-stores.ts";
import {
  generateGenericNudge as defaultGenerateGenericNudge,
  generateGuidanceComment as defaultGenerateGuidanceComment,
  generateLabelRecommendation as defaultGenerateLabelRecommendation,
  validateIssue as defaultValidateIssue,
} from "../triage/triage-agent.ts";
import type { TriageValidationResult } from "../triage/types.ts";

type ValidateIssue = (params: {
  workspaceDir: string;
  issueBody: string | null;
}) => Promise<TriageValidationResult | null>;

export async function buildMentionTriageContext(params: {
  enabled: boolean;
  isIssueThreadComment: boolean;
  owner: string;
  repo: string;
  issueNumber: number;
  issueBody: string | null;
  workspaceDir: string;
  cooldownMinutes?: number;
  labelAllowlist?: string[];
  cooldownStore: TriageCooldownStore;
  now?: () => number;
  logger: Pick<Logger, "warn">;
  validateIssue?: ValidateIssue;
  generateGuidanceComment?: (result: TriageValidationResult) => string;
  generateLabelRecommendation?: (params: {
    result: TriageValidationResult;
    labelAllowlist: string[];
  }) => string | null;
  generateGenericNudge?: () => string;
}): Promise<string> {
  if (!params.isIssueThreadComment || !params.enabled) {
    return "";
  }

  const cooldownKey = `${params.owner}/${params.repo}#${params.issueNumber}`;
  const bodyHash = createHash("sha256")
    .update(params.issueBody ?? "")
    .digest("hex")
    .slice(0, 16);
  const now = params.now?.() ?? Date.now();
  const cooldownEntry = params.cooldownStore.get(cooldownKey);
  const cooldownMs = (params.cooldownMinutes ?? 30) * 60 * 1000;

  const withinCooldown =
    cooldownEntry !== undefined
    && cooldownEntry.bodyHash === bodyHash
    && now - cooldownEntry.lastTriagedAt < cooldownMs;

  if (withinCooldown) {
    return "";
  }

  try {
    const validateIssue = params.validateIssue ?? defaultValidateIssue;
    const validationResult = await validateIssue({
      workspaceDir: params.workspaceDir,
      issueBody: params.issueBody,
    });

    let triageContext = "";
    if (validationResult === null) {
      triageContext = (params.generateGenericNudge ?? defaultGenerateGenericNudge)();
    } else if (!validationResult.valid) {
      triageContext = (params.generateGuidanceComment ?? defaultGenerateGuidanceComment)(validationResult);
      const labelRecommendation = (params.generateLabelRecommendation ?? defaultGenerateLabelRecommendation)({
        result: validationResult,
        labelAllowlist: params.labelAllowlist ?? [],
      });

      if (labelRecommendation) {
        triageContext += `\n\nRecommended label: \`${labelRecommendation}\``;
      }
    }

    params.cooldownStore.set(cooldownKey, { lastTriagedAt: now, bodyHash });
    return triageContext;
  } catch (err) {
    params.logger.warn(
      { err, issueNumber: params.issueNumber },
      "Triage validation failed (fail-open)",
    );
    return "";
  }
}
