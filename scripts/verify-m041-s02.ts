import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import pino from "pino";
import { backfillCanonicalCodeSnapshot } from "../src/knowledge/canonical-code-backfill.ts";
import { createRetriever } from "../src/knowledge/retrieval.ts";
import type { CanonicalChunkWriteInput, CanonicalCorpusBackfillState } from "../src/knowledge/canonical-code-types.ts";
import type { EmbeddingProvider, RetrievalResult, RetrievalWithProvenance } from "../src/knowledge/types.ts";
import type { WorkspaceManager } from "../src/jobs/types.ts";
import type { IsolationLayer } from "../src/knowledge/isolation.ts";
import type { CodeSnippetStore, CodeSnippetSearchResult } from "../src/knowledge/code-snippet-types.ts";

export const M041_S02_CHECK_IDS = [
  "M041-S02-BACKFILL-STORES-CANONICAL-CHUNKS",
  "M041-S02-RETRIEVAL-RETURNS-CANONICAL-CURRENT-CODE",
  "M041-S02-RETRIEVAL-PRESERVES-CORPUS-SEPARATION",
  "M041-S02-NONMAIN-DEFAULT-BRANCH-IS-RESPECTED",
] as const;

export type M041S02CheckId = (typeof M041_S02_CHECK_IDS)[number];

export type M041S02Check = {
  id: M041S02CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type M041S02EvaluationReport = {
  check_ids: readonly string[];
  overallPassed: boolean;
  checks: M041S02Check[];
};

export type M041S02ProofFixtureResult = {
  backfill: {
    status: "completed" | "partial" | "failed";
    canonicalRef: string;
    commitSha: string;
    filesDone: number;
    chunksDone: number;
    chunksFailed: number;
    warnings: number;
  };
  canonicalStoreRows: Array<{
    repo: string;
    owner: string;
    canonicalRef: string;
    commitSha: string;
    filePath: string;
    chunkType: string;
    symbolName: string | null;
    contentHash: string;
  }>;
  retrieval: {
    canonicalRefRequested: string;
    canonicalCodeCount: number;
    snippetCount: number;
    unifiedSources: string[];
    topUnifiedSource: string | null;
    topUnifiedLabel: string | null;
    topCanonicalFilePath: string | null;
    topSnippetFilePath: string | null;
    contextWindow: string;
  };
};

type InMemoryCanonicalStore = {
  getBackfillState(params: { repo: string; owner: string; canonicalRef: string }): Promise<CanonicalCorpusBackfillState | null>;
  saveBackfillState(state: CanonicalCorpusBackfillState): Promise<void>;
  deleteChunksForFile(params: { repo: string; owner: string; canonicalRef: string; filePath: string }): Promise<number>;
  upsertChunk(input: CanonicalChunkWriteInput, embedding: Float32Array): Promise<"inserted" | "replaced" | "dedup">;
  searchByEmbedding(params: {
    queryEmbedding: Float32Array;
    repo: string;
    canonicalRef: string;
    topK: number;
    language?: string;
    distanceThreshold?: number;
  }): Promise<Array<{
    id: bigint;
    repo: string;
    owner: string;
    canonicalRef: string;
    commitSha: string;
    filePath: string;
    language: string;
    startLine: number;
    endLine: number;
    chunkType: "function" | "class" | "method" | "module" | "block";
    symbolName: string | null;
    chunkText: string;
    contentHash: string;
    distance: number;
    embeddingModel: string | null;
  }>>;
  rows: Array<CanonicalChunkWriteInput & { id: bigint; embedding: Float32Array }>;
  getLastSearchParams(): { repo: string; canonicalRef: string; topK: number; language?: string; distanceThreshold?: number } | null;
};

function createLogger() {
  return pino({ level: "silent" });
}

async function createWorkspaceFixture(files: Record<string, string>, defaultBranch = "trunk") {
  const dir = await mkdtemp(join(tmpdir(), "m041-s02-verify-"));
  await $`git init -b ${defaultBranch} ${dir}`.quiet();
  await $`git -C ${dir} config user.name "test"`.quiet();
  await $`git -C ${dir} config user.email "test@example.com"`.quiet();

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(dir, relativePath);
    await mkdir(join(absolutePath, ".."), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }

  await $`git -C ${dir} add -A`.quiet();
  await $`git -C ${dir} commit -m "fixture"`.quiet();
  const sha = (await $`git -C ${dir} rev-parse HEAD`.quiet()).text().trim();

  return {
    dir,
    sha,
    defaultBranch,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function createWorkspaceManagerForDir(dir: string): Pick<WorkspaceManager, "create"> {
  return {
    async create() {
      return {
        dir,
        async cleanup() {},
      };
    },
  };
}

function normalizeText(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter(Boolean);
}

function scoreDistance(query: string, chunkText: string): number {
  const queryTokens = new Set(normalizeText(query));
  const chunkTokens = new Set(normalizeText(chunkText));
  if (queryTokens.size === 0 || chunkTokens.size === 0) return 1;
  let overlap = 0;
  for (const token of queryTokens) {
    if (chunkTokens.has(token)) overlap += 1;
  }
  const similarity = overlap / queryTokens.size;
  return Math.max(0, 1 - similarity);
}

function createEmbeddingProvider(): EmbeddingProvider {
  return {
    async generate(text: string, _inputType: "document" | "query") {
      const lowered = text.toLowerCase();
      const vector = new Float32Array([
        lowered.includes("token") ? 1 : 0,
        lowered.includes("rotation") ? 1 : 0,
        lowered.includes("canonical") ? 1 : 0,
      ]);
      return {
        embedding: vector,
        model: "verify-m041-s02-embedding",
        dimensions: vector.length,
      };
    },
    get model() {
      return "verify-m041-s02-embedding";
    },
    get dimensions() {
      return 3;
    },
  };
}

function createInMemoryCanonicalStore(): InMemoryCanonicalStore {
  const rows: Array<CanonicalChunkWriteInput & { id: bigint; embedding: Float32Array }> = [];
  const deletedFiles = new Set<string>();
  let nextId = 1n;
  let state: CanonicalCorpusBackfillState | null = null;
  let lastSearchParams: { repo: string; canonicalRef: string; topK: number; language?: string; distanceThreshold?: number } | null = null;

  return {
    rows,
    async getBackfillState() {
      return state ? { ...state } : null;
    },
    async saveBackfillState(next) {
      state = { ...next };
    },
    async deleteChunksForFile(params) {
      const before = rows.length;
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        const row = rows[index]!;
        if (
          row.repo === params.repo &&
          row.owner === params.owner &&
          row.canonicalRef === params.canonicalRef &&
          row.filePath === params.filePath
        ) {
          rows.splice(index, 1);
        }
      }
      deletedFiles.add(`${params.repo}:${params.owner}:${params.canonicalRef}:${params.filePath}`);
      return before - rows.length;
    },
    async upsertChunk(input, embedding) {
      const existing = rows.find((row) =>
        row.repo === input.repo &&
        row.owner === input.owner &&
        row.canonicalRef === input.canonicalRef &&
        row.filePath === input.filePath &&
        row.chunkType === input.chunkType &&
        row.symbolName === input.symbolName,
      );

      if (existing) {
        if (existing.contentHash === input.contentHash) {
          return "dedup";
        }
        Object.assign(existing, input, { embedding });
        return "replaced";
      }

      rows.push({ ...input, id: nextId++, embedding });
      return "inserted";
    },
    async searchByEmbedding(params) {
      lastSearchParams = {
        repo: params.repo,
        canonicalRef: params.canonicalRef,
        topK: params.topK,
        language: params.language,
        distanceThreshold: params.distanceThreshold,
      };
      const query = params.queryEmbedding[0] === 1 && params.queryEmbedding[1] === 1
        ? "token rotation"
        : "";
      return rows
        .filter((row) => row.repo === params.repo && row.canonicalRef === params.canonicalRef)
        .filter((row) => !params.language || row.language === params.language)
        .map((row) => ({
          id: row.id,
          repo: row.repo,
          owner: row.owner,
          canonicalRef: row.canonicalRef,
          commitSha: row.commitSha,
          filePath: row.filePath,
          language: row.language,
          startLine: row.startLine,
          endLine: row.endLine,
          chunkType: row.chunkType,
          symbolName: row.symbolName,
          chunkText: row.chunkText,
          contentHash: row.contentHash,
          distance: scoreDistance(query, row.chunkText),
          embeddingModel: row.embeddingModel,
        }))
        .filter((row) => row.distance <= (params.distanceThreshold ?? 1))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, params.topK);
    },
    getLastSearchParams() {
      return lastSearchParams;
    },
  };
}

function createSnippetStore(query: string): CodeSnippetStore {
  const snippetResults: CodeSnippetSearchResult[] = [
    {
      contentHash: "snippet-legacy-1",
      embeddedText: "Historical PR hunk mentioning token rotation from an old diff, not the current branch implementation.",
      distance: scoreDistance(query, "old diff token rotation historical hunk") + 0.2,
      language: "typescript",
      repo: "owner/repo",
      prNumber: 41,
      prTitle: "Old token rotation patch",
      filePath: "src/legacy/token-rotation.patch.ts",
      startLine: 3,
      endLine: 12,
      createdAt: "2026-04-01T00:00:00Z",
    },
  ];

  return {
    async writeSnippet() {},
    async writeOccurrence() {},
    async searchByEmbedding() {
      return snippetResults;
    },
    async searchByFullText() {
      return [];
    },
    close() {},
  };
}

function createIsolationLayer(): IsolationLayer {
  const results: RetrievalResult[] = [];
  return {
    async retrieveWithIsolation(): Promise<RetrievalWithProvenance> {
      return {
        results,
        provenance: {
          repoSources: ["owner/repo"],
          sharedPoolUsed: false,
          totalCandidates: 0,
          query: { repo: "owner/repo", topK: 10, threshold: 0.7 },
        },
      };
    },
  };
}

export async function runM041S02Fixture(): Promise<M041S02ProofFixtureResult> {
  const logger = createLogger();
  const embeddingProvider = createEmbeddingProvider();
  const canonicalStore = createInMemoryCanonicalStore();
  const defaultBranch = "trunk";
  const repo = "owner/repo";
  const owner = "owner";
  const query = "token rotation";

  const fixture = await createWorkspaceFixture({
    "src/auth/token.ts": [
      "export function rotateToken(current: string) {",
      "  const canonicalRotation = `${current}-next`;",
      "  const tokenRotationAudit = `token rotation:${canonicalRotation}`;",
      "  return tokenRotationAudit;",
      "}",
    ].join("\n"),
    "src/auth/index.ts": [
      "import { rotateToken } from './token';",
      "export function rotateAndLog(current: string) {",
      "  return rotateToken(current);",
      "}",
    ].join("\n"),
    "README.md": "General repository notes for auth internals.\n",
  }, defaultBranch);

  try {
    const backfill = await backfillCanonicalCodeSnapshot(
      {
        githubApp: {
          async getRepoInstallationContext() {
            return { installationId: 1, defaultBranch };
          },
        },
        workspaceManager: createWorkspaceManagerForDir(fixture.dir),
        store: canonicalStore,
        embeddingProvider,
        logger,
      },
      { owner, repo },
    );

    const retriever = createRetriever({
      embeddingProvider,
      isolationLayer: createIsolationLayer(),
      config: {
        retrieval: {
          enabled: true,
          topK: 5,
          distanceThreshold: 0.8,
          adaptive: false,
          maxContextChars: 4000,
        },
        sharing: { enabled: false },
      },
      canonicalCodeStore: canonicalStore,
      codeSnippetStore: createSnippetStore(query),
    });

    const retrieval = await retriever.retrieve({
      repo,
      owner,
      canonicalRef: defaultBranch,
      queries: [query],
      logger,
      triggerType: "pr_review",
    });

    if (!retrieval) {
      throw new Error("Expected retriever to return a result");
    }

    const topCanonical = retrieval.unifiedResults.find((chunk) => chunk.source === "canonical_code") ?? null;
    const topSnippet = retrieval.unifiedResults.find((chunk) => chunk.source === "snippet") ?? null;

    return {
      backfill: {
        status: backfill.status,
        canonicalRef: backfill.canonicalRef,
        commitSha: backfill.commitSha,
        filesDone: backfill.filesDone,
        chunksDone: backfill.chunksDone,
        chunksFailed: backfill.chunksFailed,
        warnings: backfill.warnings.length,
      },
      canonicalStoreRows: canonicalStore.rows.map((row) => ({
        repo: row.repo,
        owner: row.owner,
        canonicalRef: row.canonicalRef,
        commitSha: row.commitSha,
        filePath: row.filePath,
        chunkType: row.chunkType,
        symbolName: row.symbolName,
        contentHash: row.contentHash,
      })),
      retrieval: {
        canonicalRefRequested: canonicalStore.getLastSearchParams()?.canonicalRef ?? "",
        canonicalCodeCount: retrieval.provenance.canonicalCodeCount,
        snippetCount: retrieval.provenance.snippetCount,
        unifiedSources: retrieval.unifiedResults.map((chunk) => chunk.source),
        topUnifiedSource: retrieval.unifiedResults[0]?.source ?? null,
        topUnifiedLabel: retrieval.unifiedResults[0]?.sourceLabel ?? null,
        topCanonicalFilePath: topCanonical?.metadata?.filePath as string | null ?? null,
        topSnippetFilePath: topSnippet?.metadata?.filePath as string | null ?? null,
        contextWindow: retrieval.contextWindow,
      },
    };
  } finally {
    await fixture.cleanup();
  }
}

export async function runBackfillStoresCanonicalChunksCheck(
  runFn: () => Promise<M041S02ProofFixtureResult> = runM041S02Fixture,
): Promise<M041S02Check> {
  const result = await runFn();
  const problems: string[] = [];

  if (result.backfill.status !== "completed") {
    problems.push(`backfill status=${result.backfill.status}`);
  }
  if (result.backfill.chunksDone < 2) {
    problems.push(`chunksDone=${result.backfill.chunksDone} expected >= 2`);
  }
  if (result.backfill.chunksFailed !== 0) {
    problems.push(`chunksFailed=${result.backfill.chunksFailed} expected 0`);
  }
  if (result.canonicalStoreRows.length === 0) {
    problems.push("canonicalStoreRows is empty");
  }

  if (problems.length === 0) {
    return {
      id: "M041-S02-BACKFILL-STORES-CANONICAL-CHUNKS",
      passed: true,
      skipped: false,
      status_code: "backfill_persisted_canonical_snapshot_rows",
      detail: `canonicalRef=${result.backfill.canonicalRef} filesDone=${result.backfill.filesDone} chunksDone=${result.backfill.chunksDone} storedRows=${result.canonicalStoreRows.length}`,
    };
  }

  return {
    id: "M041-S02-BACKFILL-STORES-CANONICAL-CHUNKS",
    passed: false,
    skipped: false,
    status_code: "canonical_backfill_verification_failed",
    detail: problems.join("; "),
  };
}

export async function runRetrievalReturnsCanonicalCurrentCodeCheck(
  runFn: () => Promise<M041S02ProofFixtureResult> = runM041S02Fixture,
): Promise<M041S02Check> {
  const result = await runFn();
  const problems: string[] = [];

  if (result.retrieval.canonicalCodeCount === 0) {
    problems.push("canonicalCodeCount=0");
  }
  if (!result.retrieval.unifiedSources.includes("canonical_code")) {
    problems.push(`unifiedSources=${JSON.stringify(result.retrieval.unifiedSources)}`);
  }
  if (!result.retrieval.topUnifiedLabel?.includes("[canonical:") && !result.retrieval.contextWindow.includes("[canonical:")) {
    problems.push(`topUnifiedLabel=${result.retrieval.topUnifiedLabel ?? "null"}`);
  }
  if (result.retrieval.topCanonicalFilePath !== "src/auth/token.ts") {
    problems.push(`topCanonicalFilePath=${result.retrieval.topCanonicalFilePath ?? "null"}`);
  }

  if (problems.length === 0) {
    return {
      id: "M041-S02-RETRIEVAL-RETURNS-CANONICAL-CURRENT-CODE",
      passed: true,
      skipped: false,
      status_code: "retrieval_prefers_canonical_current_code",
      detail: `topUnifiedSource=${result.retrieval.topUnifiedSource} canonicalCodeCount=${result.retrieval.canonicalCodeCount} topCanonicalFilePath=${result.retrieval.topCanonicalFilePath}`,
    };
  }

  return {
    id: "M041-S02-RETRIEVAL-RETURNS-CANONICAL-CURRENT-CODE",
    passed: false,
    skipped: false,
    status_code: "canonical_retrieval_verification_failed",
    detail: problems.join("; "),
  };
}

export async function runRetrievalPreservesCorpusSeparationCheck(
  runFn: () => Promise<M041S02ProofFixtureResult> = runM041S02Fixture,
): Promise<M041S02Check> {
  const result = await runFn();
  const problems: string[] = [];

  if (result.retrieval.snippetCount === 0) {
    problems.push("snippetCount=0");
  }
  if (!result.retrieval.unifiedSources.includes("snippet")) {
    problems.push(`unifiedSources=${JSON.stringify(result.retrieval.unifiedSources)}`);
  }
  if (!result.retrieval.contextWindow.includes("[canonical:")) {
    problems.push("contextWindow missing canonical label");
  }
  if (!result.retrieval.contextWindow.includes("[snippet]")) {
    problems.push("contextWindow missing snippet label");
  }
  if (result.retrieval.topSnippetFilePath !== "src/legacy/token-rotation.patch.ts") {
    problems.push(`topSnippetFilePath=${result.retrieval.topSnippetFilePath ?? "null"}`);
  }

  if (problems.length === 0) {
    return {
      id: "M041-S02-RETRIEVAL-PRESERVES-CORPUS-SEPARATION",
      passed: true,
      skipped: false,
      status_code: "retrieval_keeps_canonical_and_historical_corpora_distinct",
      detail: `snippetCount=${result.retrieval.snippetCount} unifiedSources=${JSON.stringify(result.retrieval.unifiedSources)}`,
    };
  }

  return {
    id: "M041-S02-RETRIEVAL-PRESERVES-CORPUS-SEPARATION",
    passed: false,
    skipped: false,
    status_code: "corpus_separation_verification_failed",
    detail: problems.join("; "),
  };
}

export async function runNonMainDefaultBranchCheck(
  runFn: () => Promise<M041S02ProofFixtureResult> = runM041S02Fixture,
): Promise<M041S02Check> {
  const result = await runFn();
  const problems: string[] = [];

  if (result.backfill.canonicalRef !== "trunk") {
    problems.push(`backfill canonicalRef=${result.backfill.canonicalRef}`);
  }
  if (result.retrieval.canonicalRefRequested !== "trunk") {
    problems.push(`retrieval canonicalRefRequested=${result.retrieval.canonicalRefRequested}`);
  }
  if (!result.canonicalStoreRows.every((row) => row.canonicalRef === "trunk")) {
    problems.push(`stored canonical refs=${JSON.stringify(result.canonicalStoreRows.map((row) => row.canonicalRef))}`);
  }

  if (problems.length === 0) {
    return {
      id: "M041-S02-NONMAIN-DEFAULT-BRANCH-IS-RESPECTED",
      passed: true,
      skipped: false,
      status_code: "nonmain_default_branch_propagated_end_to_end",
      detail: `backfillCanonicalRef=${result.backfill.canonicalRef} retrievalCanonicalRef=${result.retrieval.canonicalRefRequested}`,
    };
  }

  return {
    id: "M041-S02-NONMAIN-DEFAULT-BRANCH-IS-RESPECTED",
    passed: false,
    skipped: false,
    status_code: "canonical_ref_propagation_failed",
    detail: problems.join("; "),
  };
}

export async function evaluateM041S02(opts?: {
  _runFixture?: () => Promise<M041S02ProofFixtureResult>;
}): Promise<M041S02EvaluationReport> {
  const runFixture = opts?._runFixture ?? runM041S02Fixture;
  const [backfillCheck, retrievalCheck, separationCheck, branchCheck] = await Promise.all([
    runBackfillStoresCanonicalChunksCheck(runFixture),
    runRetrievalReturnsCanonicalCurrentCodeCheck(runFixture),
    runRetrievalPreservesCorpusSeparationCheck(runFixture),
    runNonMainDefaultBranchCheck(runFixture),
  ]);

  const checks = [backfillCheck, retrievalCheck, separationCheck, branchCheck];
  const overallPassed = checks.filter((check) => !check.skipped).every((check) => check.passed);

  return {
    check_ids: M041_S02_CHECK_IDS,
    overallPassed,
    checks,
  };
}

function renderReport(report: M041S02EvaluationReport): string {
  const lines = [
    "M041 S02 proof harness: canonical default-branch backfill and semantic retrieval",
    `Final verdict: ${report.overallPassed ? "PASS" : "FAIL"}`,
    "Checks:",
  ];

  for (const check of report.checks) {
    const verdict = check.skipped ? "SKIP" : check.passed ? "PASS" : "FAIL";
    const detail = check.detail ? ` ${check.detail}` : "";
    lines.push(`- ${check.id} ${verdict} status_code=${check.status_code}${detail}`);
  }

  return `${lines.join("\n")}\n`;
}

export async function buildM041S02ProofHarness(opts?: {
  _runFixture?: () => Promise<M041S02ProofFixtureResult>;
  stdout?: { write: (chunk: string) => void };
  stderr?: { write: (chunk: string) => void };
  json?: boolean;
}): Promise<{ exitCode: number }> {
  const stdout = opts?.stdout ?? process.stdout;
  const stderr = opts?.stderr ?? process.stderr;
  const useJson = opts?.json ?? false;

  const report = await evaluateM041S02({ _runFixture: opts?._runFixture });

  if (useJson) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderReport(report));
  }

  if (!report.overallPassed) {
    const failingCodes = report.checks
      .filter((check) => !check.passed && !check.skipped)
      .map((check) => `${check.id}:${check.status_code}`)
      .join(", ");
    stderr.write(`verify:m041:s02 failed: ${failingCodes}\n`);
  }

  return { exitCode: report.overallPassed ? 0 : 1 };
}

if (import.meta.main) {
  const useJson = process.argv.includes("--json");
  const { exitCode } = await buildM041S02ProofHarness({ json: useJson });
  process.exit(exitCode);
}
