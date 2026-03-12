import pino from "pino";
import { createDbClient } from "../src/db/client.ts";
import { createKnowledgeRuntime } from "../src/knowledge/runtime.ts";
import { renderRetrieverVerificationReport, verifyRetriever } from "../src/knowledge/retriever-verifier.ts";

export function parseRetrieverVerifyCliArgs(args: string[]): {
  help?: boolean;
  json?: boolean;
  repo?: string;
  query?: string;
} {
  let repo: string | undefined;
  let query: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--repo") {
      repo = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--query") {
      query = args[index + 1];
      index += 1;
      continue;
    }
  }

  return {
    help: args.includes("--help") || args.includes("-h"),
    json: args.includes("--json"),
    repo,
    query,
  };
}

function usage(): string {
  return [
    "Usage: bun run verify:retriever --repo <owner/repo> --query <text> [--json]",
    "",
    "Options:",
    "  --repo    Repository in owner/repo form",
    "  --query   Query text to run through createRetriever(...).retrieve(...)",
    "  --json    Print machine-readable JSON output",
    "  --help    Show this help",
    "",
    "Environment:",
    "  DATABASE_URL     PostgreSQL connection string (required)",
    "  VOYAGE_API_KEY   Enables live query embeddings; without it the verifier reports query_embedding_unavailable",
  ].join("\n");
}

function parseOwnerFromRepo(repo: string): string {
  const [owner] = repo.split("/");
  if (!owner) {
    throw new Error(`Invalid repo '${repo}'. Expected owner/repo.`);
  }
  return owner;
}

export async function runRetrieverVerifyCli(deps?: {
  repo?: string;
  query?: string;
  verifyRetriever?: () => Promise<Awaited<ReturnType<typeof verifyRetriever>>>;
}): Promise<{
  report: Awaited<ReturnType<typeof verifyRetriever>>;
  human: string;
  json: string;
}> {
  const runVerifier = deps?.verifyRetriever ?? (async () => {
    const repo = deps?.repo;
    const query = deps?.query;
    if (!repo) {
      throw new Error("Missing required --repo <owner/repo>");
    }
    if (!query) {
      throw new Error("Missing required --query <text>");
    }

    const logger = pino({ level: "silent" });
    const db = createDbClient({ logger });

    try {
      const runtime = createKnowledgeRuntime({ sql: db.sql, logger });
      if (!runtime.retriever) {
        throw new Error("retriever wiring unavailable");
      }

      return await verifyRetriever({
        repo,
        owner: parseOwnerFromRepo(repo),
        query,
        queryEmbeddingProvider: runtime.embeddingProvider,
        retriever: {
          retrieve: async ({ repo, owner, queries, logger: requestLogger }) => runtime.retriever!.retrieve({
            repo,
            owner,
            queries,
            logger: (requestLogger ?? logger) as never,
          }),
        },
        logger,
      });
    } finally {
      await db.close();
    }
  });

  const report = await runVerifier();
  return {
    report,
    human: renderRetrieverVerificationReport(report),
    json: `${JSON.stringify(report, null, 2)}\n`,
  };
}

export async function main(
  args: string[] = process.argv.slice(2),
  deps?: {
    verifyRetriever?: () => Promise<Awaited<ReturnType<typeof verifyRetriever>>>;
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
  },
): Promise<number> {
  const options = parseRetrieverVerifyCliArgs(args);
  const stdout = deps?.stdout ?? process.stdout;
  const stderr = deps?.stderr ?? process.stderr;

  if (options.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  try {
    const { report, human, json } = await runRetrieverVerifyCli({
      repo: options.repo,
      query: options.query,
      verifyRetriever: deps?.verifyRetriever,
    });

    stdout.write(options.json ? json : human);
    return report.success ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`verify:retriever failed: ${message}\n`);
    return 1;
  }
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
