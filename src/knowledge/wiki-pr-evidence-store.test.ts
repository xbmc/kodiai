import { describe, expect, test, mock } from "bun:test";
import { storeWikiPrEvidence } from "./wiki-pr-evidence-store.ts";
import type { Sql } from "../db/client.ts";

function makeSqlRecorder(opts: { failBatch?: boolean; failFilePath?: string } = {}) {
  const insertedFilePaths: string[] = [];
  let batchAttempts = 0;
  let rowAttempts = 0;

  const sql = mock(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join(" ");
    if (query.includes("FROM unnest(")) {
      batchAttempts++;
      if (opts.failBatch) {
        throw new Error("batch insert failed");
      }
      const filePaths = values[6] as string[];
      insertedFilePaths.push(...filePaths);
      return [];
    }

    if (query.includes("VALUES (")) {
      rowAttempts++;
      const filePath = values[5] as string;
      if (filePath === opts.failFilePath) {
        throw new Error("row insert failed");
      }
      insertedFilePaths.push(filePath);
      return [];
    }

    return [];
  }) as unknown as Sql & ReturnType<typeof mock>;

  return {
    sql,
    stats: () => ({ batchAttempts, rowAttempts, insertedFilePaths }),
  };
}

function makeLogger() {
  return {
    warn: mock(() => {}),
    error: mock(() => {}),
  };
}

const pr = {
  number: 101,
  title: "Update video docs",
  body: "Fixes #100",
  author: "octocat",
  mergedAt: new Date("2026-06-01T00:00:00.000Z"),
};

const matches = [
  { filePath: "src/video/player.cpp", patch: "@@ player", pageId: 1, pageTitle: "Video Player", score: 3 },
  { filePath: "src/video/settings.cpp", patch: "@@ settings", pageId: 1, pageTitle: "Video Player", score: 3 },
];

describe("storeWikiPrEvidence", () => {
  test("stores all rows through the batch path when the batch insert succeeds", async () => {
    const recorder = makeSqlRecorder();
    const logger = makeLogger();

    const stored = await storeWikiPrEvidence({
      sql: recorder.sql,
      pr,
      matches,
      logger,
    });

    expect(stored).toBe(2);
    expect(recorder.stats()).toMatchObject({
      batchAttempts: 1,
      rowAttempts: 0,
      insertedFilePaths: ["src/video/player.cpp", "src/video/settings.cpp"],
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("falls back to per-row writes when the batch insert fails", async () => {
    const recorder = makeSqlRecorder({ failBatch: true });
    const logger = makeLogger();

    const stored = await storeWikiPrEvidence({
      sql: recorder.sql,
      pr,
      matches,
      logger,
    });

    expect(stored).toBe(2);
    expect(recorder.stats()).toMatchObject({
      batchAttempts: 1,
      rowAttempts: 2,
      insertedFilePaths: ["src/video/player.cpp", "src/video/settings.cpp"],
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  test("continues row fallback after one row fails", async () => {
    const recorder = makeSqlRecorder({
      failBatch: true,
      failFilePath: "src/video/player.cpp",
    });
    const logger = makeLogger();

    const stored = await storeWikiPrEvidence({
      sql: recorder.sql,
      pr,
      matches,
      logger,
    });

    expect(stored).toBe(1);
    expect(recorder.stats()).toMatchObject({
      batchAttempts: 1,
      rowAttempts: 2,
      insertedFilePaths: ["src/video/settings.cpp"],
    });
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
