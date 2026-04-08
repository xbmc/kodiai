import { describe, expect, it, mock } from "bun:test";
import { backfillCanonicalCodeSnapshot } from "./canonical-code-backfill.ts";
import type { CanonicalChunkWriteInput, CanonicalCorpusBackfillState } from "./canonical-code-types.ts";
import type { EmbeddingProvider } from "./types.ts";
import type { WorkspaceManager } from "../jobs/types.ts";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

function createMockLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as const;
}

async function createWorkspaceFixture(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "canonical-backfill-test-"));
  await $`git init ${dir}`.quiet();
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

function createEmbeddingProvider(config?: {
  nullFor?: string[];
  throwFor?: string[];
}): Pick<EmbeddingProvider, "generate"> {
  return {
    async generate(text: string) {
      if (config?.throwFor?.some((needle) => text.includes(needle))) {
        throw new Error(`embedding exploded for ${text}`);
      }
      if (config?.nullFor?.some((needle) => text.includes(needle))) {
        return null;
      }
      return {
        embedding: new Float32Array([text.length, text.length / 10]),
        model: "voyage-test",
        dimensions: 2,
      };
    },
  };
}

function createStoreHarness(initialState: CanonicalCorpusBackfillState | null = null) {
  const deleteCalls: Array<{ repo: string; owner: string; canonicalRef: string; filePath: string }> = [];
  const upsertCalls: CanonicalChunkWriteInput[] = [];
  const savedStates: CanonicalCorpusBackfillState[] = [];
  let state = initialState;

  return {
    deleteCalls,
    upsertCalls,
    savedStates,
    store: {
      async getBackfillState() {
        return state;
      },
      async saveBackfillState(next: CanonicalCorpusBackfillState) {
        state = { ...next };
        savedStates.push({ ...next });
      },
      async deleteChunksForFile(params: {
        repo: string;
        owner: string;
        canonicalRef: string;
        filePath: string;
      }) {
        deleteCalls.push(params);
        return 0;
      },
      async upsertChunk(input: CanonicalChunkWriteInput) {
        upsertCalls.push(input);
        return "inserted" as const;
      },
    },
  };
}

describe("backfillCanonicalCodeSnapshot", () => {
  it("resolves the default branch workspace and backfills eligible files", async () => {
    const fixture = await createWorkspaceFixture({
      "src/player.ts": [
        "export const config = { enabled: true };",
        "",
        "export function boot() {",
        "  return config.enabled;",
        "}",
      ].join("\n"),
      "README.md": "# docs\n",
      "vendor/generated.ts": "export const ignored = true;\n",
    });

    try {
      const harness = createStoreHarness();
      const logger = createMockLogger();

      const result = await backfillCanonicalCodeSnapshot(
        {
          githubApp: {
            async getRepoInstallationContext() {
              return { installationId: 99, defaultBranch: "main" };
            },
          },
          workspaceManager: createWorkspaceManagerForDir(fixture.dir),
          store: harness.store,
          embeddingProvider: createEmbeddingProvider(),
          logger: logger as never,
        },
        { owner: "xbmc", repo: "kodi" },
      );

      expect(result.canonicalRef).toBe("main");
      expect(result.commitSha).toBe(fixture.sha);
      expect(result.status).toBe("completed");
      expect(result.filesTotal).toBe(3);
      expect(result.filesDone).toBe(3);
      expect(result.filesSkipped).toBe(1);
      expect(result.chunksDone).toBe(3);
      expect(result.chunksFailed).toBe(0);
      expect(harness.deleteCalls.map((call) => call.filePath)).toEqual(["README.md", "src/player.ts"]);
      expect(harness.upsertCalls.map((call) => call.filePath)).toEqual(["README.md", "src/player.ts", "src/player.ts"]);
      expect(harness.savedStates.at(-1)?.status).toBe("completed");
    } finally {
      await fixture.cleanup();
    }
  });

  it("fails open when an embedding returns null and records bounded warnings + partial state", async () => {
    const fixture = await createWorkspaceFixture({
      "src/player.ts": [
        "export function boot() {",
        "  return true;",
        "}",
      ].join("\n"),
    });

    try {
      const harness = createStoreHarness();
      const logger = createMockLogger();

      const result = await backfillCanonicalCodeSnapshot(
        {
          githubApp: {
            async getRepoInstallationContext() {
              return { installationId: 99, defaultBranch: "main" };
            },
          },
          workspaceManager: createWorkspaceManagerForDir(fixture.dir),
          store: harness.store,
          embeddingProvider: createEmbeddingProvider({ nullFor: ["boot"] }),
          logger: logger as never,
        },
        { owner: "xbmc", repo: "kodi" },
      );

      expect(result.status).toBe("partial");
      expect(result.chunksDone).toBe(0);
      expect(result.chunksFailed).toBe(1);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]?.class).toBe("embedding");
      expect(harness.deleteCalls).toHaveLength(0);
      expect(harness.upsertCalls).toHaveLength(0);
      expect(harness.savedStates.at(-1)?.status).toBe("partial");
      expect(harness.savedStates.at(-1)?.chunksFailed).toBe(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it("resumes from stored lastFilePath using localeCompare ordering, including non-ASCII filenames, when the commit sha still matches", async () => {
    const filePaths = ["alpha.ts", "éclair.ts", "ångström.ts", "zeta.ts"];
    const sortedPaths = [...filePaths].sort((a, b) => a.localeCompare(b));
    const checkpointIndex = 1;
    const checkpointFilePath = sortedPaths[checkpointIndex]!;
    const processedBeforeResume = checkpointIndex + 1;
    const expectedResumedPaths = sortedPaths.filter(
      (filePath) => filePath.localeCompare(checkpointFilePath) > 0,
    );
    const fixture = await createWorkspaceFixture(
      Object.fromEntries(
        filePaths.map((filePath) => [filePath, `export const marker = ${JSON.stringify(filePath)};\n`]),
      ),
    );

    try {
      const existingState: CanonicalCorpusBackfillState = {
        repo: "kodi",
        owner: "xbmc",
        canonicalRef: "main",
        runId: "run-existing",
        status: "running",
        filesTotal: filePaths.length,
        filesDone: processedBeforeResume,
        chunksTotal: null,
        chunksDone: processedBeforeResume,
        chunksSkipped: 0,
        chunksFailed: 0,
        lastFilePath: checkpointFilePath,
        commitSha: fixture.sha,
        errorMessage: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const harness = createStoreHarness(existingState);

      const result = await backfillCanonicalCodeSnapshot(
        {
          githubApp: {
            async getRepoInstallationContext() {
              return { installationId: 99, defaultBranch: "main" };
            },
          },
          workspaceManager: createWorkspaceManagerForDir(fixture.dir),
          store: harness.store,
          embeddingProvider: createEmbeddingProvider(),
          logger: createMockLogger() as never,
        },
        { owner: "xbmc", repo: "kodi" },
      );

      expect(result.resumed).toBe(true);
      expect(result.runId).toBe("run-existing");
      expect(harness.deleteCalls.map((call) => call.filePath)).toEqual(expectedResumedPaths);
      expect(harness.savedStates[0]?.filesDone).toBe(processedBeforeResume);
      expect(harness.savedStates.at(-1)?.filesDone).toBe(filePaths.length);
    } finally {
      await fixture.cleanup();
    }
  });
});
