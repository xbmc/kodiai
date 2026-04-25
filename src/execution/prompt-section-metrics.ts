import type { PromptSectionMetric, PromptSectionRecord } from "../telemetry/types.ts";

export type PromptSectionInput = {
  sectionName: string;
  text: string;
  truncated?: boolean;
};

export type PromptBuildResult = {
  text: string;
  sections: PromptSectionMetric[];
};

export function estimatePromptTokens(charCount: number): number {
  return Math.max(0, Math.ceil(Math.max(0, charCount) / 4));
}

export function buildPromptSectionMetrics(
  sections: PromptSectionInput[],
  separator = "\n",
): PromptSectionMetric[] {
  return sections.map((section, index) => {
    const separatorChars = index < sections.length - 1 ? separator.length : 0;
    const charCount = section.text.length + separatorChars;
    return {
      sectionName: section.sectionName,
      sectionPosition: index,
      charCount,
      estimatedTokens: estimatePromptTokens(charCount),
      ...(section.truncated ? { truncated: true } : {}),
    };
  });
}

export function buildPromptBuildResult(
  sections: PromptSectionInput[],
  separator = "\n",
): PromptBuildResult {
  return {
    text: sections.map((section) => section.text).join(separator),
    sections: buildPromptSectionMetrics(sections, separator),
  };
}

export function buildPromptSectionRecord(params: {
  deliveryId?: string;
  repo: string;
  taskType: string;
  promptKind: string;
  sections: PromptSectionMetric[];
}): PromptSectionRecord {
  return {
    deliveryId: params.deliveryId,
    repo: params.repo,
    taskType: params.taskType,
    promptKind: params.promptKind,
    sections: params.sections,
  };
}
