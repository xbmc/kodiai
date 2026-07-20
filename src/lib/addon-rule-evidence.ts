import type { AddonRuleAddonContext } from "./addon-rule-context.ts";

export type AddonRuleAddedLine = { line: number; text: string };

export type AddonRuleEvidenceFile = {
  path: string;
  status?: string;
  additions?: number | null;
  deletions?: number | null;
  addedLines: AddonRuleAddedLine[];
};

export type AddonRuleEvidenceContext = {
  addonId: string;
  allChangedPaths: string[];
  files: AddonRuleEvidenceFile[];
};

export const MAX_ADDON_RULE_LLM_PROMPT_CHARS = 28_000;

export type AddonRuleEvidencePack = {
  chunks: AddonRuleEvidenceContext[][];
  omittedFiles: number;
  omittedOversizedLines: number;
};

export function collectAddedRightSideEvidence(patch: string): AddonRuleAddedLine[] {
  const result: AddonRuleAddedLine[] = [];
  let rightLine: number | undefined;
  let rightLinesRemaining = 0;

  for (const patchLine of patch.split("\n")) {
    const hunk = patchLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunk) {
      rightLine = Number.parseInt(hunk[1]!, 10);
      rightLinesRemaining = hunk[2] == null ? 1 : Number.parseInt(hunk[2], 10);
      continue;
    }
    if (rightLine === undefined
      || rightLinesRemaining === 0
      || patchLine === "\\ No newline at end of file") continue;
    if (patchLine.startsWith("-")) continue;
    if (patchLine.startsWith("+")) {
      result.push({ line: rightLine, text: patchLine.slice(1) });
    }
    if (patchLine.startsWith("+") || patchLine.startsWith(" ")) {
      rightLine += 1;
      rightLinesRemaining -= 1;
    }
  }

  return result;
}

export function projectAddonRuleEvidence(
  contexts: readonly AddonRuleAddonContext[],
): AddonRuleEvidenceContext[] {
  return contexts.map((context) => ({
    addonId: context.addonId,
    allChangedPaths: [...context.allChangedPaths],
    files: context.files.flatMap((file) => file.patch == null ? [] : [{
      path: file.path,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      addedLines: collectAddedRightSideEvidence(file.patch),
    }]),
  }));
}

export function packAddonRuleEvidence(
  contexts: readonly AddonRuleEvidenceContext[],
  renderPrompt: (contexts: readonly AddonRuleEvidenceContext[]) => string,
  maxPromptChars = MAX_ADDON_RULE_LLM_PROMPT_CHARS,
): AddonRuleEvidencePack {
  const chunks: AddonRuleEvidenceContext[][] = [];
  let current: AddonRuleEvidenceContext[] = [];
  let omittedFiles = 0;
  let omittedOversizedLines = 0;

  const fits = (candidate: readonly AddonRuleEvidenceContext[]) => (
    renderPrompt(candidate).length <= maxPromptChars
  );
  const flush = () => {
    if (current.length > 0) chunks.push(current);
    current = [];
  };

  for (const context of contexts) {
    for (const file of context.files) {
      const metadataCandidate = appendFileMetadata(current, context, file);
      if (fits(metadataCandidate)) {
        current = metadataCandidate;
      } else {
        flush();
        const metadataOnly = singleFileChunk(context, file);
        if (!fits(metadataOnly)) {
          omittedFiles += 1;
          omittedOversizedLines += file.addedLines.length;
          continue;
        }
        current = metadataOnly;
      }

      for (const line of file.addedLines) {
        const candidate = current.length > 0
          ? appendLineToLastFile(current, line)
          : singleFileChunk(context, file, line);
        if (fits(candidate)) {
          current = candidate;
          continue;
        }

        flush();
        const singleLine = singleFileChunk(context, file, line);
        if (fits(singleLine)) current = singleLine;
        else omittedOversizedLines += 1;
      }
    }
  }

  flush();
  return { chunks, omittedFiles, omittedOversizedLines };
}

function appendFileMetadata(
  chunk: readonly AddonRuleEvidenceContext[],
  sourceContext: AddonRuleEvidenceContext,
  sourceFile: AddonRuleEvidenceFile,
): AddonRuleEvidenceContext[] {
  const candidate = cloneChunk(chunk);
  const lastContext = candidate.at(-1);
  const file = metadataOnlyFile(sourceFile);

  if (lastContext != null
    && lastContext.addonId === sourceContext.addonId
    && arraysEqual(lastContext.allChangedPaths, sourceContext.allChangedPaths)) {
    lastContext.files.push(file);
  } else {
    candidate.push({
      addonId: sourceContext.addonId,
      allChangedPaths: [...sourceContext.allChangedPaths],
      files: [file],
    });
  }

  return candidate;
}

function appendLineToLastFile(
  chunk: readonly AddonRuleEvidenceContext[],
  line: AddonRuleAddedLine,
): AddonRuleEvidenceContext[] {
  const candidate = cloneChunk(chunk);
  candidate.at(-1)!.files.at(-1)!.addedLines.push({ ...line });
  return candidate;
}

function singleFileChunk(
  context: AddonRuleEvidenceContext,
  file: AddonRuleEvidenceFile,
  line?: AddonRuleAddedLine,
): AddonRuleEvidenceContext[] {
  return [{
    addonId: context.addonId,
    allChangedPaths: [...context.allChangedPaths],
    files: [{
      ...metadataOnlyFile(file),
      addedLines: line == null ? [] : [{ ...line }],
    }],
  }];
}

function metadataOnlyFile(file: AddonRuleEvidenceFile): AddonRuleEvidenceFile {
  return {
    path: file.path,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    addedLines: [],
  };
}

function cloneChunk(chunk: readonly AddonRuleEvidenceContext[]): AddonRuleEvidenceContext[] {
  return chunk.map((context) => ({
    addonId: context.addonId,
    allChangedPaths: [...context.allChangedPaths],
    files: context.files.map((file) => ({
      ...metadataOnlyFile(file),
      addedLines: file.addedLines.map((line) => ({ ...line })),
    })),
  }));
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
