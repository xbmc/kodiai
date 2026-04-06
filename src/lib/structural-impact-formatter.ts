import type {
  CanonicalCodeEvidence,
  StructuralCaller,
  StructuralImpactFile,
  StructuralImpactPayload,
  StructuralLikelyTest,
} from "../structural-impact/types.ts";
import { summarizeStructuralImpactDegradation } from "../structural-impact/degradation.ts";

export type StructuralImpactFormatterOptions = {
  maxCallers?: number;
  maxFiles?: number;
  maxTests?: number;
  maxEvidence?: number;
};

export type StructuralImpactRenderStats = {
  callersRendered: number;
  callersTotal: number;
  callersTruncated: boolean;
  filesRendered: number;
  filesTotal: number;
  filesTruncated: boolean;
  testsRendered: number;
  testsTotal: number;
  testsTruncated: boolean;
  evidenceRendered: number;
  evidenceTotal: number;
  evidenceTruncated: boolean;
};

export type StructuralImpactSection = {
  text: string;
  stats: StructuralImpactRenderStats;
};

const HARD_MAX_CALLERS = 6;
const HARD_MAX_FILES = 6;
const HARD_MAX_TESTS = 4;
const HARD_MAX_EVIDENCE = 3;

const DEFAULT_MAX_CALLERS = 4;
const DEFAULT_MAX_FILES = 4;
const DEFAULT_MAX_TESTS = 3;
const DEFAULT_MAX_EVIDENCE = 2;

function clamp(value: number | undefined, fallback: number, hardMax: number): number {
  const resolved = Number.isFinite(value) ? Math.floor(value as number) : fallback;
  return Math.max(0, Math.min(resolved, hardMax));
}

function confidenceLabel(confidence: number): "stronger graph evidence" | "probable graph evidence" {
  return confidence >= 0.99 ? "stronger graph evidence" : "probable graph evidence";
}

function compactReason(reasons: string[]): string {
  return reasons[0]?.trim() || "structural dependency";
}

function trimCodeFence(text: string): string {
  return text
    .replace(/^```[\w-]*\n?/, "")
    .replace(/\n?```$/, "")
    .trim();
}

function summarizeChunkText(text: string): string {
  const singleLine = trimCodeFence(text).replace(/\s+/g, " ").trim();
  if (singleLine.length <= 120) return singleLine;
  return `${singleLine.slice(0, 117)}...`;
}

function formatCaller(item: StructuralCaller): string {
  const name = item.qualifiedName ?? item.symbolName ?? item.stableKey;
  return `  - \`${name}\` in \`${item.filePath}\` (${confidenceLabel(item.confidence)}, score ${item.score.toFixed(3)}) — ${compactReason(item.reasons)}`;
}

function formatFile(item: StructuralImpactFile): string {
  const languageNote = item.languages.length > 0 ? `; languages: ${item.languages.join(", ")}` : "";
  return `  - \`${item.path}\` (${confidenceLabel(item.confidence)}, score ${item.score.toFixed(3)}${languageNote}) — ${compactReason(item.reasons)}`;
}

function formatTest(item: StructuralLikelyTest): string {
  const symbolNote = item.testSymbols.length > 0
    ? `; test symbols: ${item.testSymbols.slice(0, 2).join(", ")}${item.testSymbols.length > 2 ? ", ..." : ""}`
    : "";
  return `  - \`${item.path}\` (${confidenceLabel(item.confidence)}, score ${item.score.toFixed(3)}${symbolNote}) — ${compactReason(item.reasons)}`;
}

function formatEvidence(item: CanonicalCodeEvidence): string {
  const symbol = item.symbolName ? ` for \`${item.symbolName}\`` : "";
  return `  - \`${item.filePath}:${item.startLine}-${item.endLine}\` (${item.language} ${item.chunkType}${symbol}, distance ${item.distance.toFixed(3)}) — ${summarizeChunkText(item.chunkText)}`;
}

function buildBoundedSection<T>(params: {
  heading: string;
  items: T[];
  maxItems: number;
  render: (item: T) => string;
}): { lines: string[]; rendered: number; total: number; truncated: boolean } {
  const { heading, items, maxItems, render } = params;
  if (items.length === 0 || maxItems === 0) {
    return { lines: [], rendered: 0, total: items.length, truncated: items.length > 0 };
  }

  const shown = items.slice(0, maxItems);
  const truncated = items.length > shown.length;
  const lines = [
    `- ${heading}: ${shown.length}/${items.length} shown${truncated ? " (truncated)" : ""}`,
    ...shown.map(render),
  ];

  if (truncated) {
    lines.push(`  - ...${items.length - shown.length} more omitted to keep Review Details bounded.`);
  }

  return {
    lines,
    rendered: shown.length,
    total: items.length,
    truncated,
  };
}

function hasRenderableContent(payload: StructuralImpactPayload): boolean {
  return payload.probableCallers.length > 0
    || payload.impactedFiles.length > 0
    || payload.likelyTests.length > 0
    || payload.canonicalEvidence.length > 0;
}

function buildTruthfulEvidenceQualityLine(payload: StructuralImpactPayload): string {
  const degradation = summarizeStructuralImpactDegradation(payload);

  if (degradation.status === "partial") {
    const unavailableSources: string[] = [];
    if (!degradation.availability.graphAvailable) unavailableSources.push("graph data");
    if (!degradation.availability.corpusAvailable) unavailableSources.push("unchanged-code corpus data");

    const unavailableNote = unavailableSources.length > 0
      ? ` Missing ${unavailableSources.join(" and ")} is omitted rather than inferred.`
      : "";

    return `- Evidence quality: Partial structural evidence available; confidence claims below reflect only returned graph/corpus results.${unavailableNote}`;
  }

  if (degradation.status === "unavailable") {
    return "";
  }

  return "- Evidence quality: Structural evidence includes graph-ranked dependencies and unchanged-code retrieval; confidence claims below distinguish probable vs stronger graph support.";
}

export function buildStructuralImpactSection(
  payload: StructuralImpactPayload | null | undefined,
  options: StructuralImpactFormatterOptions = {},
): StructuralImpactSection {
  const degradation = summarizeStructuralImpactDegradation(payload);
  const normalizedPayload = payload
    ? {
        ...payload,
        status: degradation.status,
        degradations: degradation.degradations,
      }
    : payload;
  const emptyStats: StructuralImpactRenderStats = {
    callersRendered: 0,
    callersTotal: normalizedPayload?.probableCallers.length ?? 0,
    callersTruncated: false,
    filesRendered: 0,
    filesTotal: normalizedPayload?.impactedFiles.length ?? 0,
    filesTruncated: false,
    testsRendered: 0,
    testsTotal: normalizedPayload?.likelyTests.length ?? 0,
    testsTruncated: false,
    evidenceRendered: 0,
    evidenceTotal: normalizedPayload?.canonicalEvidence.length ?? 0,
    evidenceTruncated: false,
  };

  if (!normalizedPayload || normalizedPayload.status === "unavailable" || !hasRenderableContent(normalizedPayload)) {
    return { text: "", stats: emptyStats };
  }

  const maxCallers = clamp(options.maxCallers, DEFAULT_MAX_CALLERS, HARD_MAX_CALLERS);
  const maxFiles = clamp(options.maxFiles, DEFAULT_MAX_FILES, HARD_MAX_FILES);
  const maxTests = clamp(options.maxTests, DEFAULT_MAX_TESTS, HARD_MAX_TESTS);
  const maxEvidence = clamp(options.maxEvidence, DEFAULT_MAX_EVIDENCE, HARD_MAX_EVIDENCE);

  const callerSection = buildBoundedSection({
    heading: "Probable callers / dependents",
    items: normalizedPayload.probableCallers,
    maxItems: maxCallers,
    render: formatCaller,
  });
  const fileSection = buildBoundedSection({
    heading: "Impacted files",
    items: normalizedPayload.impactedFiles,
    maxItems: maxFiles,
    render: formatFile,
  });
  const testSection = buildBoundedSection({
    heading: "Likely affected tests",
    items: normalizedPayload.likelyTests,
    maxItems: maxTests,
    render: formatTest,
  });
  const evidenceSection = buildBoundedSection({
    heading: "Unchanged-code evidence",
    items: normalizedPayload.canonicalEvidence,
    maxItems: maxEvidence,
    render: formatEvidence,
  });

  const lines = ["", "### Structural Impact", ""];

  if (normalizedPayload.seedSymbols.length > 0) {
    const symbolNames = normalizedPayload.seedSymbols
      .slice(0, 3)
      .map((item) => item.qualifiedName ?? item.symbolName ?? item.stableKey);
    const overflow = normalizedPayload.seedSymbols.length - symbolNames.length;
    lines.push(`- Changed symbols: ${symbolNames.map((item) => `\`${item}\``).join(", ")}${overflow > 0 ? `, and ${overflow} more` : ""}`);
  }

  if (normalizedPayload.graphStats) {
    lines.push(
      `- Graph coverage: ${normalizedPayload.graphStats.changedFilesFound}/${normalizedPayload.graphStats.changedFilesRequested} changed files resolved in graph (${normalizedPayload.graphStats.files} files, ${normalizedPayload.graphStats.nodes} nodes, ${normalizedPayload.graphStats.edges} edges).`,
    );
  }

  const evidenceQualityLine = buildTruthfulEvidenceQualityLine(normalizedPayload);
  if (evidenceQualityLine) {
    lines.push(evidenceQualityLine);
  }

  for (const section of [callerSection, fileSection, testSection, evidenceSection]) {
    if (section.lines.length > 0) {
      lines.push(...section.lines);
    }
  }

  return {
    text: lines.join("\n"),
    stats: {
      callersRendered: callerSection.rendered,
      callersTotal: callerSection.total,
      callersTruncated: callerSection.truncated,
      filesRendered: fileSection.rendered,
      filesTotal: fileSection.total,
      filesTruncated: fileSection.truncated,
      testsRendered: testSection.rendered,
      testsTotal: testSection.total,
      testsTruncated: testSection.truncated,
      evidenceRendered: evidenceSection.rendered,
      evidenceTotal: evidenceSection.total,
      evidenceTruncated: evidenceSection.truncated,
    },
  };
}
