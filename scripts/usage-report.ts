/**
 * Kodiai Usage Report CLI
 *
 * Self-contained CLI script that opens the telemetry SQLite database in
 * read-only mode and surfaces usage, cost, and duration metrics with
 * filtering and multiple output formats.
 *
 * Usage: bun scripts/usage-report.ts [options]
 *
 * Does NOT import from src/ -- opens the database directly with bun:sqlite.
 */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "util";

const DEFAULT_DB_PATH = "./data/kodiai-telemetry.db";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    since: { type: "string" },
    repo: { type: "string" },
    json: { type: "boolean", default: false },
    csv: { type: "boolean", default: false },
    db: { type: "string", default: DEFAULT_DB_PATH },
    help: { type: "boolean", default: false, short: "h" },
  },
  strict: true,
});

if (values.help) {
  printUsage();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Database opening
// ---------------------------------------------------------------------------

const dbPath = resolve(values.db!);

if (!existsSync(dbPath)) {
  console.error(
    `Database not found at ${dbPath}. Has the Kodiai server been started? Use --db to specify a custom path.`,
  );
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });
db.run("PRAGMA busy_timeout = 5000");

// ---------------------------------------------------------------------------
// parseSince — converts --since value to YYYY-MM-DD HH:MM:SS format
// ---------------------------------------------------------------------------

function parseSince(value: string): string {
  // Relative: Nd (days)
  const relMatch = value.match(/^(\d+)d$/);
  if (relMatch) {
    const days = parseInt(relMatch[1]!);
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
  }

  // Absolute: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value + " 00:00:00";
  }

  // Full ISO datetime
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value)) {
    return value.replace("T", " ");
  }

  console.error(
    `Invalid --since format: "${value}". Use Nd (e.g., 7d) or YYYY-MM-DD`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Dynamic WHERE clause construction
// ---------------------------------------------------------------------------

const conditions: string[] = [];
const params: Record<string, string | number> = {};

if (values.since) {
  const cutoff = parseSince(values.since);
  conditions.push("created_at >= $since");
  params.$since = cutoff;
}

if (values.repo) {
  conditions.push("repo = $repo");
  params.$repo = values.repo;
}

const whereClause =
  conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

// ---------------------------------------------------------------------------
// SQL queries
// ---------------------------------------------------------------------------

type SummaryRow = {
  total_executions: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  total_cost: number;
};

type RepoRow = {
  repo: string;
  executions: number;
  total_tokens: number;
  total_cost: number;
  avg_duration_ms: number;
};

type CategoryRow = {
  category: string;
  executions: number;
  avg_duration_ms: number;
  total_cost: number;
};

const summaryQuery = db.query<SummaryRow, Record<string, string | number>>(
  `SELECT
    COUNT(*) as total_executions,
    COALESCE(SUM(input_tokens), 0) as total_input_tokens,
    COALESCE(SUM(output_tokens), 0) as total_output_tokens,
    COALESCE(SUM(input_tokens + output_tokens), 0) as total_tokens,
    COALESCE(SUM(cost_usd), 0) as total_cost
  FROM executions
  ${whereClause}`,
);

const reposQuery = db.query<RepoRow, Record<string, string | number>>(
  `SELECT
    repo,
    COUNT(*) as executions,
    SUM(input_tokens + output_tokens) as total_tokens,
    SUM(cost_usd) as total_cost,
    ROUND(AVG(duration_ms)) as avg_duration_ms
  FROM executions
  ${whereClause}
  GROUP BY repo
  ORDER BY total_cost DESC`,
);

const categoryQuery = db.query<CategoryRow, Record<string, string | number>>(
  `SELECT
    CASE
      WHEN event_type LIKE 'pull_request.%' THEN 'review'
      ELSE 'mention'
    END as category,
    COUNT(*) as executions,
    ROUND(AVG(duration_ms)) as avg_duration_ms,
    SUM(cost_usd) as total_cost
  FROM executions
  ${whereClause}
  GROUP BY category
  ORDER BY avg_duration_ms DESC`,
);

const summary = summaryQuery.get(params)!;
const repos = reposQuery.all(params);
const categories = categoryQuery.all(params);

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function padRight(str: string, len: number): string {
  return str.slice(0, len).padEnd(len);
}

function padLeft(str: string, len: number): string {
  return str.slice(0, len).padStart(len);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

if (values.json) {
  // --json output (REPORT-06)
  const output = {
    generated: new Date().toISOString(),
    filters: {
      since: values.since ?? null,
      repo: values.repo ?? null,
    },
    summary: {
      totalExecutions: summary.total_executions,
      totalInputTokens: summary.total_input_tokens,
      totalOutputTokens: summary.total_output_tokens,
      totalTokens: summary.total_tokens,
      totalCost: summary.total_cost,
    },
    topRepos: repos,
    durationByCategory: categories,
  };
  console.log(JSON.stringify(output, null, 2));
} else if (values.csv) {
  // --csv output (REPORT-07)
  // Summary section
  console.log("section,metric,value");
  console.log(`summary,total_executions,${summary.total_executions}`);
  console.log(`summary,total_input_tokens,${summary.total_input_tokens}`);
  console.log(`summary,total_output_tokens,${summary.total_output_tokens}`);
  console.log(`summary,total_tokens,${summary.total_tokens}`);
  console.log(`summary,total_cost,${summary.total_cost}`);
  console.log("");

  // Repos section
  console.log("repo,executions,total_tokens,total_cost,avg_duration_ms");
  for (const row of repos) {
    console.log(
      `"${row.repo}",${row.executions},${row.total_tokens},${row.total_cost},${row.avg_duration_ms}`,
    );
  }
  console.log("");

  // Category section
  console.log("category,executions,avg_duration_ms,total_cost");
  for (const row of categories) {
    console.log(
      `${row.category},${row.executions},${row.avg_duration_ms},${row.total_cost}`,
    );
  }
} else {
  // Human-readable output (default)
  console.log("Kodiai Usage Report");
  console.log("=".repeat(65));

  // Active filters
  if (values.since || values.repo) {
    console.log("");
    console.log("Filters:");
    if (values.since) console.log(`  Since: ${values.since}`);
    if (values.repo) console.log(`  Repo:  ${values.repo}`);
  }

  if (summary.total_executions === 0) {
    console.log("");
    console.log("No executions found.");
    if (values.since || values.repo) {
      console.log("Try adjusting the filters above.");
    }
    db.close();
    process.exit(0);
  }

  // Summary section
  console.log("");
  console.log("Summary");
  console.log("-".repeat(35));
  console.log(`  Total Executions:  ${summary.total_executions}`);
  console.log(
    `  Input Tokens:      ${summary.total_input_tokens.toLocaleString()}`,
  );
  console.log(
    `  Output Tokens:     ${summary.total_output_tokens.toLocaleString()}`,
  );
  console.log(
    `  Total Tokens:      ${summary.total_tokens.toLocaleString()}`,
  );
  console.log(`  Total Cost:        $${summary.total_cost.toFixed(4)}`);

  // Top Repos by Cost
  if (repos.length > 0) {
    console.log("");
    console.log("Top Repos by Cost");
    const header =
      padRight("Repo", 35) +
      padLeft("Execs", 8) +
      padLeft("Tokens", 12) +
      padLeft("Cost", 10) +
      padLeft("Avg Duration", 14);
    console.log(header);
    console.log("-".repeat(header.length));
    for (const row of repos) {
      console.log(
        padRight(row.repo, 35) +
          padLeft(String(row.executions), 8) +
          padLeft(row.total_tokens.toLocaleString(), 12) +
          padLeft("$" + row.total_cost.toFixed(4), 10) +
          padLeft(formatDuration(row.avg_duration_ms), 14),
      );
    }
  }

  // Duration by Event Type
  if (categories.length > 0) {
    console.log("");
    console.log("Duration by Event Type");
    const catHeader =
      padRight("Category", 12) +
      padLeft("Execs", 8) +
      padLeft("Avg Duration", 14) +
      padLeft("Cost", 10);
    console.log(catHeader);
    console.log("-".repeat(catHeader.length));
    for (const row of categories) {
      console.log(
        padRight(row.category, 12) +
          padLeft(String(row.executions), 8) +
          padLeft(formatDuration(row.avg_duration_ms), 14) +
          padLeft("$" + row.total_cost.toFixed(4), 10),
      );
    }
  }
}

db.close();

// ---------------------------------------------------------------------------
// Help output
// ---------------------------------------------------------------------------

function printUsage(): void {
  console.log(`Usage: bun scripts/usage-report.ts [options]

Options:
  --since <value>   Filter by time (e.g., 7d, 30d, 2026-01-01)
  --repo <value>    Filter by repository (e.g., owner/name)
  --json            Output as JSON
  --csv             Output as CSV
  --db <path>       Database path (default: ./data/kodiai-telemetry.db)
  -h, --help        Show this help

Examples:
  bun scripts/usage-report.ts
  bun scripts/usage-report.ts --since 7d
  bun scripts/usage-report.ts --repo kodiai/xbmc --json
  bun scripts/usage-report.ts --since 30d --csv > report.csv`);
}
