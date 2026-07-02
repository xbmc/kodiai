import type { FindingCategory, FindingSeverity } from "../lib/review-finding-metadata.ts";
import type { ProcessedReviewFinding } from "./review-reducer.ts";

export type CommentSlopFinding = {
  filePath: string;
  line: number;
  title: string;
  body: string;
  severity: FindingSeverity;
  category: FindingCategory | "maintainability";
  evidence: string;
};

const COMMENT_SLOP_SYNTHETIC_ID_OFFSET = 900_000;

type AddedLine = {
  filePath: string;
  line: number;
  text: string;
};

const DECORATIVE_LINE = /^\s*(?:(?:\/\/+|#)\s*)?[=*_#-]{6,}\s*$/;
const LINE_COMMENT = /^\s*(?:(?:\/\/+)|#)\s*(.+?)\s*$/;
const OBVIOUS_HEADER_TEXT = /^(?:constructor|destructor|cleanup|initiali[sz]ation|thread cleanup|resource cleanup)$/i;
const FUNCTION_LIKE_CODE = /^(?:[\w:~<>,*&\s]+\s+)?[A-Za-z_~][\w:~<>]*\s*\([^;{}]*\)\s*(?:const\s*)?(?:noexcept\s*)?(?:=\s*default|[{:;]|$)/;

export function detectCommentSlopInDiff(diffText: string): CommentSlopFinding[] {
  const addedLines = parseAddedLines(diffText);
  const findings: CommentSlopFinding[] = [];
  const consumed = new Set<number>();

  for (let index = 0; index < addedLines.length; index += 1) {
    if (consumed.has(index)) continue;
    const line = addedLines[index]!;
    if (DECORATIVE_LINE.test(line.text)) {
      const block = collectAdjacentCommentBlock(addedLines, index);
      for (let blockIndex = index; blockIndex < index + block.length; blockIndex += 1) {
        consumed.add(blockIndex);
      }

      findings.push({
        filePath: line.filePath,
        line: line.line,
        title: "Remove decorative comment banner",
        severity: "major",
        category: "maintainability",
        evidence: block.map((entry) => entry.text).join("\n"),
        body: "This added comment banner is decorative and appears to restate the declaration that follows. Please remove separator/banner comments and keep comments terse, only when they explain non-obvious intent.",
      });
      continue;
    }

    const obviousHeader = classifyObviousHeader(addedLines, index);
    if (obviousHeader) {
      consumed.add(index);
      findings.push(obviousHeader);
    }
  }

  return findings;
}

export function toCommentSlopReducerFindings(
  findings: readonly CommentSlopFinding[],
): ProcessedReviewFinding[] {
  return findings.map((finding, index) => ({
    commentId: -(COMMENT_SLOP_SYNTHETIC_ID_OFFSET + index),
    filePath: finding.filePath,
    title: finding.title,
    severity: finding.severity,
    category: finding.category,
    startLine: finding.line,
    endLine: finding.line,
    confidence: 95,
    body: finding.body,
    evidence: finding.evidence,
    deterministicFindingSource: "comment-slop-detector",
  }));
}

function classifyObviousHeader(lines: readonly AddedLine[], index: number): CommentSlopFinding | null {
  const line = lines[index]!;
  const comment = line.text.match(LINE_COMMENT)?.[1]?.trim();
  if (!comment || !OBVIOUS_HEADER_TEXT.test(comment)) return null;

  const nextLine = lines[index + 1];
  if (!nextLine || nextLine.filePath !== line.filePath || nextLine.line !== line.line + 1) return null;
  if (!FUNCTION_LIKE_CODE.test(nextLine.text.trim())) return null;

  return {
    filePath: line.filePath,
    line: line.line,
    title: "Remove obvious code comment",
    severity: "major",
    category: "maintainability",
    evidence: `${line.text}\n${nextLine.text}`,
    body: "This added comment only labels the code that immediately follows. Please remove obvious header comments and keep comments terse, only when they explain non-obvious intent.",
  };
}

function parseAddedLines(diffText: string): AddedLine[] {
  const addedLines: AddedLine[] = [];
  let filePath: string | null = null;
  let newLine: number | null = null;

  for (const rawLine of diffText.split("\n")) {
    if (rawLine.startsWith("+++ ")) {
      filePath = normalizeDiffPath(rawLine.slice(4).trim());
      continue;
    }

    const hunk = rawLine.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
    if (hunk) {
      newLine = Number.parseInt(hunk[1]!, 10);
      continue;
    }

    if (filePath === null || newLine === null) continue;
    if (rawLine.startsWith("+") && !rawLine.startsWith("+++")) {
      addedLines.push({ filePath, line: newLine, text: rawLine.slice(1) });
      newLine += 1;
      continue;
    }
    if (rawLine.startsWith("-") && !rawLine.startsWith("---")) {
      continue;
    }
    newLine += 1;
  }

  return addedLines;
}

function normalizeDiffPath(path: string): string {
  if (path === "/dev/null") return path;
  return path.replace(/^b\//, "");
}

function collectAdjacentCommentBlock(lines: readonly AddedLine[], startIndex: number): AddedLine[] {
  const block: AddedLine[] = [];
  const filePath = lines[startIndex]?.filePath;
  let expectedLine = lines[startIndex]?.line;

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.filePath !== filePath || line.line !== expectedLine || !isCommentLike(line.text)) break;
    block.push(line);
    expectedLine += 1;
  }

  return block;
}

function isCommentLike(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("#") || DECORATIVE_LINE.test(trimmed);
}
