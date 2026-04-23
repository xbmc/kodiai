import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const COMMAND_NAME = "verify:m055:s03" as const;
const DOCS_INDEX_PATH = path.resolve(import.meta.dir, "../docs/INDEX.md");
const PACKAGE_JSON_PATH = path.resolve(import.meta.dir, "../package.json");
const DOCS_ROOT = path.resolve(import.meta.dir, "../docs");
const REPO_ROOT = path.resolve(import.meta.dir, "..");
const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m055-s03.ts";
const REQUIRED_RUNBOOK_PATHS = [
  path.resolve(import.meta.dir, "../docs/runbooks/deploy-rollback.md"),
  path.resolve(import.meta.dir, "../docs/runbooks/key-rotation.md"),
  path.resolve(import.meta.dir, "../docs/runbooks/aca-job-debugging.md"),
  path.resolve(import.meta.dir, "../docs/runbooks/nightly-sync-failures.md"),
] as const;

export const M055_S03_CHECK_IDS = [
  "M055-S03-DOCS-INDEX-INVENTORY",
  "M055-S03-REQUIRED-RUNBOOKS-PRESENT",
  "M055-S03-RUNBOOK-COMMAND-REFERENCES",
  "M055-S03-PACKAGE-WIRING",
] as const;

export type M055S03CheckId = (typeof M055_S03_CHECK_IDS)[number];

export type Check = {
  id: M055S03CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type EvaluationReport = {
  command: typeof COMMAND_NAME;
  generatedAt: string;
  check_ids: readonly M055S03CheckId[];
  overallPassed: boolean;
  checks: Check[];
};

type StdWriter = {
  write: (chunk: string) => boolean | void;
};

type EvaluateOptions = {
  generatedAt?: string;
  readTextFile?: (filePath: string) => Promise<string>;
  listDocsPaths?: () => Promise<string[]>;
  fileExists?: (filePath: string) => Promise<boolean>;
};

type BuildOptions = EvaluateOptions & {
  json?: boolean;
  stdout?: StdWriter;
  stderr?: StdWriter;
};

type CommandReference = {
  runbookPath: string;
  command: string;
  target: string;
  resolution: "package-script" | "typescript-file" | "unresolved";
};

export async function evaluateM055S03DocsTruth(
  options: EvaluateOptions = {},
): Promise<EvaluationReport> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const readTextFile = options.readTextFile ?? defaultReadTextFile;
  const listDocsPaths = options.listDocsPaths ?? defaultListDocsPaths;
  const fileExists = options.fileExists ?? defaultFileExists;

  let docsIndexContent: string | null = null;
  let docsIndexReadError: unknown = null;
  try {
    docsIndexContent = await readTextFile(DOCS_INDEX_PATH);
  } catch (error) {
    docsIndexReadError = error;
  }

  let docsPaths: string[] | null = null;
  let docsPathsError: unknown = null;
  try {
    docsPaths = await listDocsPaths();
  } catch (error) {
    docsPathsError = error;
  }

  const runbookStates = await Promise.all(
    REQUIRED_RUNBOOK_PATHS.map(async (runbookPath) => {
      try {
        const content = await readTextFile(runbookPath);
        return { path: runbookPath, content, error: null as unknown };
      } catch (error) {
        return { path: runbookPath, content: null as string | null, error };
      }
    }),
  );

  let packageJsonContent: string | null = null;
  let packageJsonReadError: unknown = null;
  try {
    packageJsonContent = await readTextFile(PACKAGE_JSON_PATH);
  } catch (error) {
    packageJsonReadError = error;
  }

  const checks: Check[] = [
    docsIndexContent == null
      ? failCheck(
          "M055-S03-DOCS-INDEX-INVENTORY",
          "docs_index_unreadable",
          docsIndexReadError,
        )
      : docsPaths == null
        ? failCheck(
            "M055-S03-DOCS-INDEX-INVENTORY",
            "docs_tree_unreadable",
            docsPathsError,
          )
        : buildDocsIndexInventoryCheck(docsIndexContent, docsPaths),
    buildRequiredRunbooksPresentCheck(runbookStates),
    packageJsonContent == null
      ? failCheck(
          "M055-S03-RUNBOOK-COMMAND-REFERENCES",
          "package_file_unreadable",
          packageJsonReadError,
        )
      : await buildRunbookCommandReferencesCheck(runbookStates, packageJsonContent, fileExists),
    packageJsonContent == null
      ? failCheck(
          "M055-S03-PACKAGE-WIRING",
          "package_file_unreadable",
          packageJsonReadError,
        )
      : buildPackageWiringCheck(packageJsonContent),
  ];

  return {
    command: COMMAND_NAME,
    generatedAt,
    check_ids: M055_S03_CHECK_IDS,
    overallPassed: checks.every((check) => check.passed || check.skipped),
    checks,
  };
}

export function renderM055S03Report(report: EvaluationReport): string {
  const lines = [
    "M055 S03 docs/runbooks verifier",
    `Generated at: ${report.generatedAt}`,
    `Docs/runbooks proof surface: ${report.overallPassed ? "PASS" : "FAIL"}`,
    "Checks:",
  ];

  for (const check of report.checks) {
    const verdict = check.skipped ? "SKIP" : check.passed ? "PASS" : "FAIL";
    lines.push(
      `- ${check.id} ${verdict} status_code=${check.status_code}${check.detail ? ` ${check.detail}` : ""}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

export async function buildM055S03ProofHarness(
  options: BuildOptions = {},
): Promise<{ exitCode: number; report: EvaluationReport }> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const report = await evaluateM055S03DocsTruth(options);

  if (options.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderM055S03Report(report));
  }

  if (!report.overallPassed) {
    const failingCodes = report.checks
      .filter((check) => !check.passed && !check.skipped)
      .map((check) => `${check.id}:${check.status_code}`)
      .join(", ");
    stderr.write(`verify:m055:s03 failed: ${failingCodes}\n`);
  }

  return {
    exitCode: report.overallPassed ? 0 : 1,
    report,
  };
}

export function parseM055S03Args(args: readonly string[]): { json: boolean } {
  let json = false;

  for (const arg of args) {
    if (arg === "--json") {
      json = true;
      continue;
    }

    throw new Error(`invalid_cli_args: Unknown argument: ${arg}`);
  }

  return { json };
}

function buildDocsIndexInventoryCheck(indexContent: string, docsPaths: string[]): Check {
  const indexedPaths = parseIndexedDocsPaths(indexContent);
  const expectedDocsPaths = [...docsPaths]
    .map(normalizeRepoRelativePath)
    .filter((candidate) => candidate.startsWith("docs/"))
    .sort();

  const missingEntries = expectedDocsPaths.filter((docPath) => !indexedPaths.has(docPath));
  const extraEntries = [...indexedPaths].filter((docPath) => !expectedDocsPaths.includes(docPath));

  if (missingEntries.length > 0 || extraEntries.length > 0) {
    const detailParts: string[] = [];
    if (missingEntries.length > 0) {
      detailParts.push(`missing: ${missingEntries.join(", ")}`);
    }
    if (extraEntries.length > 0) {
      detailParts.push(`extra: ${extraEntries.join(", ")}`);
    }

    return failCheck(
      "M055-S03-DOCS-INDEX-INVENTORY",
      "docs_index_inventory_missing_entries",
      `docs/INDEX.md inventory drift detected (${detailParts.join("; ")})`,
    );
  }

  return passCheck(
    "M055-S03-DOCS-INDEX-INVENTORY",
    "docs_index_inventory_ok",
    `docs/INDEX.md inventories ${expectedDocsPaths.length} tracked docs paths.`,
  );
}

function buildRequiredRunbooksPresentCheck(
  runbookStates: Array<{ path: string; content: string | null; error: unknown }>,
): Check {
  const missingPaths = runbookStates
    .filter((state) => state.content == null)
    .map((state) => normalizeRepoRelativePath(state.path));

  if (missingPaths.length > 0) {
    return failCheck(
      "M055-S03-REQUIRED-RUNBOOKS-PRESENT",
      "required_runbooks_missing",
      `Required runbooks are missing or unreadable: ${missingPaths.join(", ")}`,
    );
  }

  return passCheck(
    "M055-S03-REQUIRED-RUNBOOKS-PRESENT",
    "required_runbooks_present",
    `All required runbooks are present: ${runbookStates.map((state) => normalizeRepoRelativePath(state.path)).join(", ")}`,
  );
}

async function buildRunbookCommandReferencesCheck(
  runbookStates: Array<{ path: string; content: string | null; error: unknown }>,
  packageJsonContent: string,
  fileExists: (filePath: string) => Promise<boolean>,
): Promise<Check> {
  const readableRunbooks = runbookStates.filter(
    (state): state is { path: string; content: string; error: unknown } => state.content != null,
  );

  let packageJson: { scripts?: Record<string, string> };
  try {
    packageJson = JSON.parse(packageJsonContent) as { scripts?: Record<string, string> };
  } catch (error) {
    return failCheck(
      "M055-S03-RUNBOOK-COMMAND-REFERENCES",
      "package_json_invalid",
      error,
    );
  }

  const references = await collectCommandReferences(readableRunbooks, packageJson, fileExists);
  const unresolved = references.filter((reference) => reference.resolution === "unresolved");

  if (unresolved.length > 0) {
    return failCheck(
      "M055-S03-RUNBOOK-COMMAND-REFERENCES",
      "runbook_command_references_unresolved",
      unresolved
        .map(
          (reference) =>
            `${reference.target} from ${reference.runbookPath} via \`${reference.command}\``,
        )
        .join("; "),
    );
  }

  return passCheck(
    "M055-S03-RUNBOOK-COMMAND-REFERENCES",
    "runbook_command_references_ok",
    references.length === 0
      ? "No Bun/package-script command references were detected in the required runbooks."
      : `Resolved ${references.length} Bun/package-script command references across required runbooks.`,
  );
}

function buildPackageWiringCheck(packageJsonContent: string): Check {
  let packageJson: { scripts?: Record<string, string> };
  try {
    packageJson = JSON.parse(packageJsonContent) as { scripts?: Record<string, string> };
  } catch (error) {
    return failCheck(
      "M055-S03-PACKAGE-WIRING",
      "package_json_invalid",
      error,
    );
  }

  const actualScript = packageJson.scripts?.[COMMAND_NAME];
  if (actualScript == null) {
    return failCheck(
      "M055-S03-PACKAGE-WIRING",
      "package_wiring_missing",
      `package.json must define scripts.${COMMAND_NAME}=${EXPECTED_PACKAGE_SCRIPT}`,
    );
  }

  if (actualScript !== EXPECTED_PACKAGE_SCRIPT) {
    return failCheck(
      "M055-S03-PACKAGE-WIRING",
      "package_wiring_incorrect",
      `Expected scripts.${COMMAND_NAME}=${EXPECTED_PACKAGE_SCRIPT} but found ${actualScript}`,
    );
  }

  return passCheck(
    "M055-S03-PACKAGE-WIRING",
    "package_wiring_ok",
    `package.json wires ${COMMAND_NAME} to ${EXPECTED_PACKAGE_SCRIPT}`,
  );
}

async function collectCommandReferences(
  runbookStates: Array<{ path: string; content: string; error: unknown }>,
  packageJson: { scripts?: Record<string, string> },
  fileExists: (filePath: string) => Promise<boolean>,
): Promise<CommandReference[]> {
  const scripts = packageJson.scripts ?? {};
  const references: CommandReference[] = [];
  const seen = new Set<string>();

  for (const runbookState of runbookStates) {
    const runbookPath = normalizeRepoRelativePath(runbookState.path);
    for (const command of extractCandidateCommands(runbookState.content)) {
      const target = extractResolvableTarget(command);
      if (target == null) {
        continue;
      }

      const key = `${runbookPath}:${command}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      const resolution = await resolveCommandTarget(target, scripts, fileExists);
      references.push({ runbookPath, command, target, resolution });
    }
  }

  return references;
}

function extractCandidateCommands(markdown: string): string[] {
  const matches = [
    ...markdown.matchAll(/```bash\n([\s\S]*?)```/g),
    ...markdown.matchAll(/`([^`\n]+)`/g),
  ];

  const commands = new Set<string>();

  for (const match of matches) {
    const blockOrInline = match[1]?.trim();
    if (blockOrInline == null || blockOrInline.length === 0) {
      continue;
    }

    const lines = blockOrInline
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    for (const line of lines) {
      if (line.startsWith("bun ")) {
        commands.add(line);
      }
    }
  }

  return [...commands];
}

function extractResolvableTarget(command: string): string | null {
  let match = command.match(/^bun\s+run\s+([a-z0-9:-]+)(?:\s|$)/i);
  if (match?.[1] != null && !match[1].includes("/") && !match[1].includes(".")) {
    return match[1];
  }

  match = command.match(/^bun\s+run\s+((?:src|scripts)\/[^\s]+\.ts)(?:\s|$)/i);
  if (match?.[1] != null) {
    return match[1];
  }

  match = command.match(/^bun\s+((?:src|scripts)\/[^\s]+\.ts)(?:\s|$)/i);
  if (match?.[1] != null) {
    return match[1];
  }

  return null;
}

async function resolveCommandTarget(
  target: string,
  scripts: Record<string, string>,
  fileExists: (filePath: string) => Promise<boolean>,
): Promise<CommandReference["resolution"]> {
  if (!target.includes("/") && scripts[target] != null) {
    return "package-script";
  }

  if (target.endsWith(".ts")) {
    const absolutePath = path.resolve(REPO_ROOT, target);
    if (await fileExists(absolutePath)) {
      return "typescript-file";
    }
  }

  return "unresolved";
}

function parseIndexedDocsPaths(indexContent: string): Set<string> {
  const indexedPaths = new Set<string>();

  for (const match of indexContent.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
    const linkText = match[1]?.trim();
    const href = match[2]?.trim();

    const candidates = [linkText, href]
      .filter((value): value is string => value != null && value.length > 0)
      .map((value) => value.replace(/^`|`$/g, ""));

    for (const candidate of candidates) {
      const normalized = normalizeIndexedDocsPath(candidate);
      if (normalized != null) {
        indexedPaths.add(normalized);
      }
    }
  }

  return indexedPaths;
}

function normalizeIndexedDocsPath(candidate: string): string | null {
  if (candidate.startsWith("docs/")) {
    return normalizeRepoRelativePath(candidate);
  }

  if (candidate.startsWith("./")) {
    return normalizeRepoRelativePath(path.posix.join("docs", candidate.slice(2)));
  }

  if (candidate.startsWith("../")) {
    return null;
  }

  if (candidate.endsWith(".md")) {
    return normalizeRepoRelativePath(path.posix.join("docs", candidate));
  }

  return null;
}

function passCheck(id: M055S03CheckId, status_code: string, detail?: unknown): Check {
  return {
    id,
    passed: true,
    skipped: false,
    status_code,
    detail: detail == null ? undefined : normalizeDetail(detail),
  };
}

function failCheck(id: M055S03CheckId, status_code: string, detail?: unknown): Check {
  return {
    id,
    passed: false,
    skipped: false,
    status_code,
    detail: detail == null ? undefined : normalizeDetail(detail),
  };
}

function normalizeDetail(detail: unknown): string {
  if (detail instanceof Error) {
    return detail.message;
  }
  if (typeof detail === "string") {
    return detail;
  }
  return String(detail);
}

function normalizeRepoRelativePath(filePath: string): string {
  const relativePath = path.isAbsolute(filePath) ? path.relative(REPO_ROOT, filePath) : filePath;
  return relativePath.split(path.sep).join("/");
}

async function defaultReadTextFile(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}

async function defaultListDocsPaths(): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      results.push(normalizeRepoRelativePath(absolutePath));
    }
  }

  await walk(DOCS_ROOT);
  results.sort();
  return results;
}

async function defaultFileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

if (import.meta.main) {
  try {
    const args = parseM055S03Args(process.argv.slice(2));
    const { exitCode } = await buildM055S03ProofHarness(args);
    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`verify:m055:s03 failed: ${message}\n`);
    process.exit(1);
  }
}
