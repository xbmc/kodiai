import { auditEmbeddings, renderEmbeddingAuditReport } from "../src/knowledge/embedding-audit.ts";

export function parseAuditCliArgs(args: string[]): {
  help?: boolean;
  json?: boolean;
} {
  return {
    help: args.includes("--help") || args.includes("-h"),
    json: args.includes("--json"),
  };
}

export async function runEmbeddingAuditCli(deps?: {
  auditEmbeddings?: typeof auditEmbeddings;
}): Promise<{
  report: Awaited<ReturnType<typeof auditEmbeddings>>;
  human: string;
  json: string;
}> {
  const runAudit = deps?.auditEmbeddings ?? auditEmbeddings;
  const report = await runAudit();
  return {
    report,
    human: renderEmbeddingAuditReport(report),
    json: `${JSON.stringify(report, null, 2)}\n`,
  };
}

function usage(): string {
  return [
    "Usage: bun run audit:embeddings [--json]",
    "",
    "Options:",
    "  --json   Print machine-readable JSON output",
    "  --help   Show this help",
    "",
    "Environment:",
    "  DATABASE_URL   PostgreSQL connection string (required)",
  ].join("\n");
}

export async function main(
  args: string[] = process.argv.slice(2),
  deps?: {
    auditEmbeddings?: typeof auditEmbeddings;
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
  },
): Promise<number> {
  const options = parseAuditCliArgs(args);
  const stdout = deps?.stdout ?? process.stdout;
  const stderr = deps?.stderr ?? process.stderr;

  if (options.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  try {
    const { report, human, json } = await runEmbeddingAuditCli({
      auditEmbeddings: deps?.auditEmbeddings,
    });

    stdout.write(options.json ? json : human);
    return report.success ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`audit:embeddings failed: ${message}\n`);
    return 1;
  }
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
