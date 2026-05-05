import { redactGitHubTokens } from "../lib/sanitizer.ts";

export const FORMATTER_STDERR_SUMMARY_MAX_CHARS = 500;
export const FORMATTER_PROCESS_STREAM_MAX_CHARS = 1_000_000;

export type FormatterCommandStatus =
  | "success"
  | "no-command"
  | "no-op"
  | "failed"
  | "timed-out";

export interface ResolveFormatterCommandOptions {
  command: string | undefined;
  baseRef: string;
  headRef: string;
  diffRange: string;
}

export interface FormatterProcessRequest {
  command: string;
  cwd: string;
  timeoutMs: number;
}

export interface FormatterProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export type FormatterProcessRunner = (
  request: FormatterProcessRequest,
) => Promise<FormatterProcessResult>;

export interface RunFormatterCommandOptions extends ResolveFormatterCommandOptions {
  workspaceDir: string;
  timeoutMs: number;
  runProcess?: FormatterProcessRunner;
}

export interface FormatterCommandResult {
  status: FormatterCommandStatus;
  stdout: string;
  stderrSummary: string;
  timedOut: boolean;
  durationMs: number;
  resolvedCommand?: string;
  exitCode?: number;
}

export type FormatterSuggestionSkipReason =
  | "target-range-not-in-pr-diff"
  | "pure-insertion"
  | "pure-deletion"
  | "unsupported-file"
  | "malformed-diff"
  | "max-suggestions-exceeded";

export type FormatterDiffLineKind = "context" | "removed" | "added";

export interface FormatterDiffLine {
  kind: FormatterDiffLineKind;
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface FormatterDiffHunk {
  oldStart: number;
  oldLineCount: number;
  newStart: number;
  newLineCount: number;
  section: string;
  lines: FormatterDiffLine[];
}

export interface FormatterDiffFile {
  oldPath: string;
  newPath: string;
  hunks: FormatterDiffHunk[];
}

export interface FormatterDiffSkip {
  reason: FormatterSuggestionSkipReason;
  detail: string;
  oldPath?: string;
  newPath?: string;
}

export type PrDiffCommentabilityIndex = Map<string, Set<number>>;

export interface FormatterSuggestionPayload {
  path: string;
  line: number;
  startLine?: number;
  side: "RIGHT";
  suggestionBody: string;
  oldStart: number;
  oldEnd: number;
  newStart: number;
  hunkHeader: string;
}

export interface MapFormatterDiffToSuggestionsOptions {
  formatterDiff: string;
  prDiffIndex: PrDiffCommentabilityIndex;
  maxSuggestions: number;
}

export interface FormatterSuggestionCounts {
  suggestions: number;
  skipped: number;
  capped: number;
  parsedFiles: number;
  parserSkipped: number;
  candidateGroups: number;
}

export interface MapFormatterDiffToSuggestionsResult {
  suggestions: FormatterSuggestionPayload[];
  skipped: FormatterDiffSkip[];
  counts: FormatterSuggestionCounts;
  capped: boolean;
}

export interface ParseFormatterUnifiedDiffResult {
  files: FormatterDiffFile[];
  skipped: FormatterDiffSkip[];
}

const GIT_DIFF_HEADER_RE = /^diff --git\s+(\S+)\s+(\S+)$/;
const FORMATTER_HUNK_HEADER_RE = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@\s?(.*)$/;
const PR_HUNK_HEADER_RE = /^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@/;

interface MutableFormatterDiffFile {
  oldPath?: string;
  newPath?: string;
  hunks: FormatterDiffHunk[];
  hasDiffBody: boolean;
  malformed: boolean;
  unsupportedDetail?: string;
  oldCursor?: number;
  newCursor?: number;
  currentHunk?: FormatterDiffHunk;
}

function normalizeDiffPath(path: string | undefined): string | undefined {
  if (!path || path === "/dev/null") {
    return undefined;
  }
  if (path.startsWith("a/") || path.startsWith("b/")) {
    return path.slice(2);
  }
  return path;
}

function parseDiffHeaderPath(path: string): string | undefined {
  return normalizeDiffPath(path);
}

function parseFileHeaderPath(line: string): string | undefined {
  return normalizeDiffPath(line.slice(4).trim().split("\t")[0]);
}

function makeSkip(
  reason: FormatterSuggestionSkipReason,
  detail: string,
  file: Pick<MutableFormatterDiffFile, "oldPath" | "newPath">,
): FormatterDiffSkip {
  return {
    reason,
    detail,
    oldPath: file.oldPath,
    newPath: file.newPath,
  };
}

function finalizeFormatterDiffFile(
  file: MutableFormatterDiffFile | undefined,
  result: ParseFormatterUnifiedDiffResult,
): void {
  if (!file) {
    return;
  }

  if (file.unsupportedDetail) {
    result.skipped.push(makeSkip("unsupported-file", file.unsupportedDetail, file));
    return;
  }

  if (file.malformed || (file.hasDiffBody && file.hunks.length === 0)) {
    result.skipped.push(makeSkip("malformed-diff", "file has diff body but no valid hunks", file));
    return;
  }

  if (!file.oldPath || !file.newPath) {
    result.skipped.push(makeSkip("malformed-diff", "file is missing old or new path headers", file));
    return;
  }

  if (file.hunks.length > 0) {
    result.files.push({
      oldPath: file.oldPath,
      newPath: file.newPath,
      hunks: file.hunks,
    });
  }
}

function markUnsupported(file: MutableFormatterDiffFile, detail: string): void {
  file.unsupportedDetail ??= detail;
}

export function parseFormatterUnifiedDiff(diffText: string): ParseFormatterUnifiedDiffResult {
  const result: ParseFormatterUnifiedDiffResult = { files: [], skipped: [] };
  if (diffText.length === 0) {
    return result;
  }

  const lines = diffText.split(/\r?\n/);
  let currentFile: MutableFormatterDiffFile | undefined;

  for (const line of lines) {
    const diffHeaderMatch = GIT_DIFF_HEADER_RE.exec(line);
    if (diffHeaderMatch) {
      finalizeFormatterDiffFile(currentFile, result);
      currentFile = {
        oldPath: parseDiffHeaderPath(diffHeaderMatch[1]!),
        newPath: parseDiffHeaderPath(diffHeaderMatch[2]!),
        hunks: [],
        hasDiffBody: false,
        malformed: false,
      };
      continue;
    }

    if (!currentFile) {
      if (line.trim().length > 0) {
        result.skipped.push({ reason: "malformed-diff", detail: "diff text does not start with a git file header" });
      }
      continue;
    }

    if (line === "") {
      continue;
    }

    if (line.startsWith("\\ No newline at end of file")) {
      continue;
    }

    if (line === "new file mode" || line.startsWith("new file mode ")) {
      markUnsupported(currentFile, "added file is not supported");
      continue;
    }

    if (line === "deleted file mode" || line.startsWith("deleted file mode ")) {
      markUnsupported(currentFile, "deleted file is not supported");
      continue;
    }

    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      markUnsupported(currentFile, "binary diff is not supported");
      continue;
    }

    if (line.startsWith("rename from ") || line.startsWith("rename to ")) {
      markUnsupported(currentFile, "renamed file is not supported");
      continue;
    }

    if (line.startsWith("--- ")) {
      currentFile.oldPath = parseFileHeaderPath(line);
      if (!currentFile.oldPath) {
        markUnsupported(currentFile, "added file is not supported");
      }
      continue;
    }

    if (line.startsWith("+++ ")) {
      currentFile.newPath = parseFileHeaderPath(line);
      if (!currentFile.newPath) {
        markUnsupported(currentFile, "deleted file is not supported");
      }
      continue;
    }

    if (line.startsWith("@@")) {
      currentFile.hasDiffBody = true;
      const hunkHeaderMatch = FORMATTER_HUNK_HEADER_RE.exec(line);
      if (!hunkHeaderMatch) {
        currentFile.malformed = true;
        currentFile.currentHunk = undefined;
        continue;
      }

      const oldStart = Number.parseInt(hunkHeaderMatch[1]!, 10);
      const oldLineCount = Number.parseInt(hunkHeaderMatch[2] ?? "1", 10);
      const newStart = Number.parseInt(hunkHeaderMatch[3]!, 10);
      const newLineCount = Number.parseInt(hunkHeaderMatch[4] ?? "1", 10);
      if (![oldStart, oldLineCount, newStart, newLineCount].every(Number.isFinite)) {
        currentFile.malformed = true;
        currentFile.currentHunk = undefined;
        continue;
      }

      const hunk: FormatterDiffHunk = {
        oldStart,
        oldLineCount,
        newStart,
        newLineCount,
        section: hunkHeaderMatch[5]?.trim() ?? "",
        lines: [],
      };
      currentFile.hunks.push(hunk);
      currentFile.currentHunk = hunk;
      currentFile.oldCursor = oldStart;
      currentFile.newCursor = newStart;
      continue;
    }

    if (line.startsWith("index ") || line.startsWith("old mode ") || line.startsWith("new mode ") || line.startsWith("similarity index ") || line.startsWith("dissimilarity index ")) {
      continue;
    }

    if (line.startsWith(" ") || line.startsWith("+") || line.startsWith("-")) {
      currentFile.hasDiffBody = true;
      if (!currentFile.currentHunk || currentFile.oldCursor === undefined || currentFile.newCursor === undefined) {
        currentFile.malformed = true;
        continue;
      }

      const text = line.slice(1);
      if (line.startsWith(" ")) {
        currentFile.currentHunk.lines.push({
          kind: "context",
          text,
          oldLine: currentFile.oldCursor,
          newLine: currentFile.newCursor,
        });
        currentFile.oldCursor += 1;
        currentFile.newCursor += 1;
      } else if (line.startsWith("-")) {
        currentFile.currentHunk.lines.push({
          kind: "removed",
          text,
          oldLine: currentFile.oldCursor,
        });
        currentFile.oldCursor += 1;
      } else {
        currentFile.currentHunk.lines.push({
          kind: "added",
          text,
          newLine: currentFile.newCursor,
        });
        currentFile.newCursor += 1;
      }
      continue;
    }

    currentFile.hasDiffBody = true;
    currentFile.malformed = true;
  }

  finalizeFormatterDiffFile(currentFile, result);
  return result;
}

export function buildPrDiffCommentabilityIndex(prDiffText: string): PrDiffCommentabilityIndex {
  const index: PrDiffCommentabilityIndex = new Map();
  let currentPath: string | undefined;
  let rightCursor: number | undefined;

  for (const line of prDiffText.split(/\r?\n/)) {
    const diffHeaderMatch = GIT_DIFF_HEADER_RE.exec(line);
    if (diffHeaderMatch) {
      currentPath = parseDiffHeaderPath(diffHeaderMatch[2]!);
      rightCursor = undefined;
      continue;
    }

    if (line.startsWith("+++ ")) {
      currentPath = parseFileHeaderPath(line);
      rightCursor = undefined;
      continue;
    }

    if (line.startsWith("@@")) {
      const hunkHeaderMatch = PR_HUNK_HEADER_RE.exec(line);
      rightCursor = hunkHeaderMatch ? Number.parseInt(hunkHeaderMatch[1]!, 10) : undefined;
      continue;
    }

    if (!currentPath || rightCursor === undefined) {
      continue;
    }

    if (line.startsWith(" ") || line.startsWith("+")) {
      let pathLines = index.get(currentPath);
      if (!pathLines) {
        pathLines = new Set<number>();
        index.set(currentPath, pathLines);
      }
      pathLines.add(rightCursor);
      rightCursor += 1;
      continue;
    }

    if (line.startsWith("-")) {
      continue;
    }

    if (line.startsWith("\\ No newline at end of file") || line === "") {
      continue;
    }

    rightCursor = undefined;
  }

  return index;
}

interface FormatterChangeGroup {
  removed: FormatterDiffLine[];
  added: FormatterDiffLine[];
}

function formatFormatterHunkHeader(hunk: FormatterDiffHunk): string {
  const oldRange = hunk.oldLineCount === 1 ? `${hunk.oldStart}` : `${hunk.oldStart},${hunk.oldLineCount}`;
  const newRange = hunk.newLineCount === 1 ? `${hunk.newStart}` : `${hunk.newStart},${hunk.newLineCount}`;
  const section = hunk.section ? ` ${hunk.section}` : "";
  return `@@ -${oldRange} +${newRange} @@${section}`;
}

function extractFormatterChangeGroups(hunk: FormatterDiffHunk): FormatterChangeGroup[] {
  const groups: FormatterChangeGroup[] = [];
  let current: FormatterChangeGroup | undefined;

  const flushCurrent = () => {
    if (current && (current.removed.length > 0 || current.added.length > 0)) {
      groups.push(current);
    }
    current = undefined;
  };

  for (const line of hunk.lines) {
    if (line.kind === "context") {
      flushCurrent();
      continue;
    }

    current ??= { removed: [], added: [] };
    if (line.kind === "removed") {
      current.removed.push(line);
    } else {
      current.added.push(line);
    }
  }

  flushCurrent();
  return groups;
}

function makeSuggestionBody(lines: FormatterDiffLine[]): string {
  return `\`\`\`suggestion\n${lines.map((line) => line.text).join("\n")}\n\`\`\``;
}

function hasEveryTargetLine(index: PrDiffCommentabilityIndex, path: string, oldStart: number, oldEnd: number): boolean {
  const commentableLines = index.get(path);
  if (!commentableLines) {
    return false;
  }

  for (let line = oldStart; line <= oldEnd; line += 1) {
    if (!commentableLines.has(line)) {
      return false;
    }
  }
  return true;
}

function normalizedSuggestionLimit(maxSuggestions: number): number {
  if (!Number.isFinite(maxSuggestions)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, Math.floor(maxSuggestions));
}

export function mapFormatterDiffToSuggestions(
  options: MapFormatterDiffToSuggestionsOptions,
): MapFormatterDiffToSuggestionsResult {
  const parsed = parseFormatterUnifiedDiff(options.formatterDiff);
  const suggestions: FormatterSuggestionPayload[] = [];
  const skipped: FormatterDiffSkip[] = [...parsed.skipped];
  const maxSuggestions = normalizedSuggestionLimit(options.maxSuggestions);
  let candidateGroups = 0;
  let capped = 0;

  for (const file of parsed.files) {
    for (const hunk of file.hunks) {
      for (const group of extractFormatterChangeGroups(hunk)) {
        candidateGroups += 1;
        if (group.removed.length === 0) {
          skipped.push({
            reason: "pure-insertion",
            detail: `${file.newPath}:${group.added[0]?.newLine ?? hunk.newStart} has no existing PR RIGHT-side range to replace`,
            oldPath: file.oldPath,
            newPath: file.newPath,
          });
          continue;
        }

        if (group.added.length === 0) {
          const oldStart = group.removed[0]?.oldLine ?? hunk.oldStart;
          const oldEnd = group.removed.at(-1)?.oldLine ?? oldStart;
          skipped.push({
            reason: "pure-deletion",
            detail: `${file.newPath}:${oldStart}-${oldEnd} has no formatter replacement lines`,
            oldPath: file.oldPath,
            newPath: file.newPath,
          });
          continue;
        }

        const oldStart = group.removed[0]?.oldLine;
        const oldEnd = group.removed.at(-1)?.oldLine;
        const newStart = group.added[0]?.newLine;
        if (oldStart === undefined || oldEnd === undefined || newStart === undefined) {
          skipped.push({
            reason: "malformed-diff",
            detail: `${file.newPath} formatter change group is missing line metadata`,
            oldPath: file.oldPath,
            newPath: file.newPath,
          });
          continue;
        }

        if (!hasEveryTargetLine(options.prDiffIndex, file.newPath, oldStart, oldEnd)) {
          skipped.push({
            reason: "target-range-not-in-pr-diff",
            detail: `${file.newPath}:${oldStart}-${oldEnd} is not fully commentable on the PR RIGHT side`,
            oldPath: file.oldPath,
            newPath: file.newPath,
          });
          continue;
        }

        if (suggestions.length >= maxSuggestions) {
          capped += 1;
          skipped.push({
            reason: "max-suggestions-exceeded",
            detail: `${file.newPath}:${oldStart}-${oldEnd} exceeded maxSuggestions=${maxSuggestions}`,
            oldPath: file.oldPath,
            newPath: file.newPath,
          });
          continue;
        }

        suggestions.push({
          path: file.newPath,
          line: oldEnd,
          startLine: oldStart === oldEnd ? undefined : oldStart,
          side: "RIGHT",
          suggestionBody: makeSuggestionBody(group.added),
          oldStart,
          oldEnd,
          newStart,
          hunkHeader: formatFormatterHunkHeader(hunk),
        });
      }
    }
  }

  return {
    suggestions,
    skipped,
    counts: {
      suggestions: suggestions.length,
      skipped: skipped.length,
      capped,
      parsedFiles: parsed.files.length,
      parserSkipped: parsed.skipped.length,
      candidateGroups,
    },
    capped: capped > 0,
  };
}

function substituteFormatterPlaceholder(value: string, options: ResolveFormatterCommandOptions): string {
  switch (value) {
    case "baseRef":
      return options.baseRef;
    case "headRef":
      return options.headRef;
    case "diffRange":
      return options.diffRange;
    default:
      return `{${value}}`;
  }
}

export function resolveFormatterCommand(
  options: ResolveFormatterCommandOptions,
): string | undefined {
  const command = options.command?.trim();
  if (!command) {
    return undefined;
  }

  return command.replace(/\{([^{}]+)\}/g, (_match, placeholder: string) =>
    substituteFormatterPlaceholder(placeholder, options)
  );
}

function normalizeProcessText(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function summarizeFormatterStderr(stderr: unknown): string {
  const redacted = redactGitHubTokens(normalizeProcessText(stderr));
  if (redacted.length <= FORMATTER_STDERR_SUMMARY_MAX_CHARS) {
    return redacted;
  }
  return redacted.slice(0, FORMATTER_STDERR_SUMMARY_MAX_CHARS);
}

async function readProcessStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) {
    return "";
  }

  const text = await new Response(stream).text();
  if (text.length <= FORMATTER_PROCESS_STREAM_MAX_CHARS) {
    return text;
  }
  return text.slice(0, FORMATTER_PROCESS_STREAM_MAX_CHARS);
}

export const defaultFormatterProcessRunner: FormatterProcessRunner = async ({
  command,
  cwd,
  timeoutMs,
}) => {
  const startedAt = performance.now();
  const proc = Bun.spawn(["bash", "-lc", command], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdoutPromise = readProcessStream(proc.stdout);
  const stderrPromise = readProcessStream(proc.stderr);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  try {
    const exitCode = timeoutMs > 0 && Number.isFinite(timeoutMs)
      ? await Promise.race([
          proc.exited,
          new Promise<number>((resolve) => {
            timer = setTimeout(() => {
              timedOut = true;
              try {
                proc.kill();
              } catch {
                // The process may have exited between timeout and kill.
              }
              resolve(124);
            }, timeoutMs);
          }),
        ])
      : await proc.exited;

    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
    return {
      exitCode,
      stdout,
      stderr,
      timedOut,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    };
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
};

export async function runFormatterCommand(
  options: RunFormatterCommandOptions,
): Promise<FormatterCommandResult> {
  const resolvedCommand = resolveFormatterCommand(options);
  if (!resolvedCommand) {
    return {
      status: "no-command",
      stdout: "",
      stderrSummary: "",
      timedOut: false,
      durationMs: 0,
    };
  }

  const runProcess = options.runProcess ?? defaultFormatterProcessRunner;
  const processResult = await runProcess({
    command: resolvedCommand,
    cwd: options.workspaceDir,
    timeoutMs: options.timeoutMs,
  });

  const stdout = normalizeProcessText(processResult.stdout);
  const stderrSummary = summarizeFormatterStderr(processResult.stderr);
  const timedOut = Boolean(processResult.timedOut);
  const exitCode = Number.isFinite(processResult.exitCode)
    ? processResult.exitCode
    : 1;
  const durationMs = Number.isFinite(processResult.durationMs)
    ? Math.max(0, Math.round(processResult.durationMs))
    : 0;

  if (timedOut) {
    return {
      status: "timed-out",
      stdout,
      stderrSummary,
      timedOut: true,
      durationMs,
      resolvedCommand,
      exitCode,
    };
  }

  if (exitCode !== 0) {
    return {
      status: "failed",
      stdout,
      stderrSummary,
      timedOut: false,
      durationMs,
      resolvedCommand,
      exitCode,
    };
  }

  return {
    status: stdout.trim().length === 0 ? "no-op" : "success",
    stdout,
    stderrSummary,
    timedOut: false,
    durationMs,
    resolvedCommand,
    exitCode,
  };
}
