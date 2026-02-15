# Phase 25: Reporting Tools - Research

**Researched:** 2026-02-11
**Domain:** CLI script for SQLite telemetry querying with `bun:sqlite` and `util.parseArgs`
**Confidence:** HIGH

## Summary

Phase 25 requires a standalone CLI script at `scripts/usage-report.ts` that opens the telemetry SQLite database (created by Phase 23) in read-only mode and runs aggregation queries to surface usage, cost, and duration metrics. The script needs to support time filtering (`--since`), repo filtering (`--repo`), and multiple output formats (human-readable table, JSON, CSV).

The technical domain is narrow and well-understood: all components are built into Bun (no new dependencies). `bun:sqlite` with `{ readonly: true }` provides safe concurrent reads while the server is writing (WAL mode, verified). `util.parseArgs` (Node.js built-in, available in Bun 1.3.8) handles CLI argument parsing. The output formatting uses `console.log` with manual column padding for the human-readable format, `JSON.stringify` for JSON, and comma-separated values for CSV.

The script does NOT import from `src/` -- it opens the SQLite database directly and runs raw SQL queries. This keeps it fully decoupled from the server code with zero risk of accidentally starting the server or importing its dependencies. The database schema is the `executions` table created by `createTelemetryStore` in Phase 23, with columns: `id`, `created_at`, `delivery_id`, `repo`, `pr_number`, `event_type`, `provider`, `model`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `duration_ms`, `cost_usd`, `conclusion`, `session_id`, `num_turns`, `stop_reason`.

**Primary recommendation:** Build a single self-contained `scripts/usage-report.ts` file that opens the DB read-only, parses args with `util.parseArgs`, builds SQL queries with WHERE clause fragments, and outputs to stdout in three formats. No npm dependencies needed.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `bun:sqlite` | Built-in (Bun 1.3.8) | Read-only SQLite database access | Already used by Phase 23 telemetry store; zero dependencies |
| `util.parseArgs` | Built-in (Node.js compat) | CLI argument parsing | Available in Bun 1.3.8; standard Node.js API, no npm package needed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:path` | Built-in | Resolve DB path | If `--db` flag is relative path |
| `node:process` | Built-in | `process.argv`, `process.exit()`, `process.stdout` | Always |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `util.parseArgs` | `commander` / `yargs` | External dependency for ~5 flags; not justified |
| Manual table formatting | `console.table()` | `console.table()` adds an index column and lacks formatting control (no $ prefix on costs, no number formatting) |
| Manual CSV generation | `csv-stringify` npm | External dependency for trivial join-with-commas; not justified |

**Installation:**
```bash
# No installation needed -- everything is built into Bun
```

## Architecture Patterns

### Recommended Project Structure
```
scripts/
  usage-report.ts      # Self-contained CLI script (REPORT-01)
```

The script is a single file. It does NOT import from `src/` and does NOT use the TelemetryStore interface. It opens the database file directly with `bun:sqlite` in read-only mode.

### Pattern 1: Self-Contained CLI Script
**What:** A standalone TypeScript file invoked directly with `bun scripts/usage-report.ts`. Parses its own args, opens the DB, runs queries, prints output, and exits.
**When to use:** Always for this phase. The script is an operator tool, not part of the server process.
**Example:**
```typescript
// scripts/usage-report.ts
import { Database } from "bun:sqlite";
import { parseArgs } from "util";
import { resolve } from "node:path";

const DEFAULT_DB_PATH = "./data/kodiai-telemetry.db";

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

const dbPath = resolve(values.db!);
// ... open DB, query, format, output
```

### Pattern 2: Read-Only Database Access
**What:** Open the telemetry DB with `{ readonly: true }` and set `PRAGMA busy_timeout = 5000` for safe concurrent access while the server is writing.
**When to use:** Always. The CLI script must never write to the database.
**Example:**
```typescript
import { Database } from "bun:sqlite";

const db = new Database(dbPath, { readonly: true });
db.run("PRAGMA busy_timeout = 5000");

// Queries run safely even while server is inserting via WAL mode
const results = db.query("SELECT ...").all();

db.close();
```

### Pattern 3: Dynamic WHERE Clause Construction
**What:** Build SQL WHERE clauses dynamically based on CLI flags (`--since`, `--repo`). Use parameterized queries to prevent SQL injection.
**When to use:** When any filter flag is provided.
**Example:**
```typescript
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

const whereClause = conditions.length > 0
  ? "WHERE " + conditions.join(" AND ")
  : "";
```

### Pattern 4: Time Parsing for --since
**What:** Parse `--since` values as either relative durations (`7d`, `30d`) or absolute ISO dates (`2026-01-01`).
**When to use:** Whenever `--since` is provided.
**Example:**
```typescript
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

  console.error(`Invalid --since format: "${value}". Use Nd (e.g., 7d) or YYYY-MM-DD`);
  process.exit(1);
}
```

**Important:** The `created_at` column stores values as `datetime('now')` in UTC (format: `YYYY-MM-DD HH:MM:SS`). The relative date computation should produce the same format for correct comparison. Using JavaScript's `Date` and converting to the same string format ensures consistency.

### Pattern 5: Event Type Categorization for REPORT-08
**What:** The requirement says "avg duration per event type (review vs mention)." Event types stored in the DB are granular (`pull_request.opened`, `issue_comment.created`, etc.). Use a SQL CASE expression to group them into "review" and "mention" categories.
**When to use:** For REPORT-08 duration breakdown.
**Example:**
```sql
SELECT
  CASE
    WHEN event_type LIKE 'pull_request.%' THEN 'review'
    ELSE 'mention'
  END as category,
  COUNT(*) as executions,
  ROUND(AVG(duration_ms)) as avg_duration_ms,
  SUM(cost_usd) as total_cost
FROM executions
GROUP BY category
ORDER BY avg_duration_ms DESC
```

Event type mapping (verified from handler code):
- **Review events** (`pull_request.*`): `pull_request.opened`, `pull_request.ready_for_review`, `pull_request.review_requested`
- **Mention events** (everything else): `issue_comment.created`, `pull_request_review_comment.created`, `pull_request_review.submitted`

### Anti-Patterns to Avoid
- **Importing from `src/`:** The script should NOT import `createTelemetryStore` or any server code. It opens the DB directly. Importing server code risks starting the Hono server or requiring environment variables.
- **Opening DB without `{ readonly: true }`:** The script must never write to the database. Read-only mode prevents accidental mutations.
- **Forgetting `busy_timeout`:** Without this PRAGMA, the script will fail with SQLITE_BUSY if the server is mid-write when the script opens a query.
- **String interpolation in SQL:** Always use parameterized queries (`$param`) for filter values, even though this is a local CLI tool. Defense in depth.
- **Using `console.table()` for the default format:** It adds an unwanted index column, lacks number formatting control, and produces inconsistent column widths. Manual formatting is better.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CLI argument parsing | Manual `process.argv` string splitting | `util.parseArgs` (built-in) | Handles flags, types, defaults, validation, short aliases |
| SQLite access | HTTP API to the running server | `bun:sqlite` read-only | Direct DB access is simpler, faster, works when server is down |
| CSV generation | Custom escaping logic | Simple `values.join(",")` | Fields are all numeric or simple strings (no commas or quotes in repo names) |
| Time duration parsing | Full ISO 8601 duration parser | Simple regex for `Nd` pattern | Only "days" granularity is needed per the requirements |

**Key insight:** The entire script is ~150-250 lines of straightforward TypeScript. Every capability (arg parsing, DB access, string formatting) is built into Bun. Zero npm dependencies.

## Common Pitfalls

### Pitfall 1: Database File Not Found
**What goes wrong:** The script fails with a cryptic `SQLITE_CANTOPEN` error when the DB file doesn't exist (e.g., server hasn't been deployed yet, or wrong path).
**Why it happens:** `new Database(path, { readonly: true })` throws when the file is missing.
**How to avoid:** Check `existsSync(dbPath)` before opening. Print a clear error: "Database not found at {path}. Has the server been started? Use --db to specify a custom path."
**Warning signs:** Users running the script for the first time on a dev machine.

### Pitfall 2: Timezone Confusion in --since
**What goes wrong:** Filtering with `--since 7d` produces unexpected results because `created_at` is in UTC but the user's local time is different.
**Why it happens:** `datetime('now')` in SQLite stores UTC. JavaScript's `new Date()` also computes UTC for `toISOString()`. This is consistent. But if a user passes `--since 2026-02-10`, they likely mean their local date, not UTC.
**How to avoid:** For relative durations (`7d`), compute the cutoff using `new Date()` which produces UTC -- this matches `created_at`. For absolute dates, document that dates are interpreted as UTC (or beginning-of-day UTC). This is acceptable for an operator tool.
**Warning signs:** Off-by-one-day results at day boundaries.

### Pitfall 3: No Data Returns Confusing Output
**What goes wrong:** When no executions match the filters, the report shows empty tables or zeros without explaining why.
**Why it happens:** Empty GROUP BY returns no rows. SUM/AVG on empty result returns zeros.
**How to avoid:** Check row count first. If zero, print "No executions found" with the active filters. For JSON/CSV, output the structure with zero counts (valid empty data).
**Warning signs:** Users thinking the tool is broken when it's actually correct.

### Pitfall 4: CSV Values Containing Commas
**What goes wrong:** If a repo name ever contained a comma, CSV would break.
**Why it happens:** GitHub repo names follow `owner/repo` format and cannot contain commas. This is a non-issue for current data.
**How to avoid:** For safety, quote string fields in CSV output (`"owner/repo"`). This costs nothing and prevents future breakage if the schema ever includes free-text fields.
**Warning signs:** None currently, but good practice.

### Pitfall 5: Very Large Result Sets in JSON/CSV
**What goes wrong:** If the database has thousands of rows and the user passes `--json` without filters, the script tries to output everything.
**Why it happens:** The report outputs aggregates (not raw rows), so this is unlikely. But if a future enhancement adds raw row export, it could be an issue.
**How to avoid:** The current design outputs aggregates only (totals, top repos, avg duration). Raw row export is out of scope. This naturally limits output size.
**Warning signs:** N/A for aggregate-only output.

### Pitfall 6: Type-Checking the Script
**What goes wrong:** `bunx tsc --noEmit` doesn't check `scripts/usage-report.ts` because `tsconfig.json` only includes `src/**/*.ts`.
**Why it happens:** The tsconfig `include` array is `["src/**/*.ts"]`, which excludes `scripts/`.
**How to avoid:** Either (a) add `"scripts/**/*.ts"` to `tsconfig.json` includes, or (b) run `bunx tsc --noEmit scripts/usage-report.ts` explicitly. Option (a) is simpler and ensures the script stays type-checked as part of normal CI.
**Warning signs:** Type errors in the script that `tsc --noEmit` doesn't catch.

## Code Examples

Verified patterns from local testing (Bun 1.3.8):

### CLI Argument Parsing with util.parseArgs
```typescript
// Source: Verified on Bun 1.3.8 via bun -e
import { parseArgs } from "util";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    since: { type: "string" },
    repo: { type: "string" },
    json: { type: "boolean", default: false },
    csv: { type: "boolean", default: false },
    db: { type: "string", default: "./data/kodiai-telemetry.db" },
    help: { type: "boolean", default: false, short: "h" },
  },
  strict: true,  // Throws on unknown flags
});
// values.since: string | undefined
// values.repo: string | undefined
// values.json: boolean
// values.csv: boolean
// values.db: string
// values.help: boolean
```

### Read-Only Database Opening with Error Handling
```typescript
// Source: Verified on Bun 1.3.8 via bun -e
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const dbPath = resolve(values.db!);

if (!existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  console.error("Has the Kodiai server been started? Use --db to specify a custom path.");
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });
db.run("PRAGMA busy_timeout = 5000");
```

### Aggregate Summary Query (REPORT-04)
```sql
-- Source: Verified on Bun 1.3.8 bun:sqlite with in-memory DB
SELECT
  COUNT(*) as total_executions,
  COALESCE(SUM(input_tokens), 0) as total_input_tokens,
  COALESCE(SUM(output_tokens), 0) as total_output_tokens,
  COALESCE(SUM(input_tokens + output_tokens), 0) as total_tokens,
  COALESCE(SUM(cost_usd), 0) as total_cost
FROM executions
{whereClause}
```

### Top Repos by Cost (REPORT-05)
```sql
-- Source: Verified on Bun 1.3.8 bun:sqlite with in-memory DB
SELECT
  repo,
  COUNT(*) as executions,
  SUM(input_tokens + output_tokens) as total_tokens,
  SUM(cost_usd) as total_cost,
  ROUND(AVG(duration_ms)) as avg_duration_ms
FROM executions
{whereClause}
GROUP BY repo
ORDER BY total_cost DESC
```

### Avg Duration by Event Category (REPORT-08)
```sql
-- Source: Verified on Bun 1.3.8 bun:sqlite with in-memory DB
SELECT
  CASE
    WHEN event_type LIKE 'pull_request.%' THEN 'review'
    ELSE 'mention'
  END as category,
  COUNT(*) as executions,
  ROUND(AVG(duration_ms)) as avg_duration_ms,
  SUM(cost_usd) as total_cost
FROM executions
{whereClause}
GROUP BY category
ORDER BY avg_duration_ms DESC
```

### Human-Readable Table Formatting
```typescript
// Source: Verified on Bun 1.3.8 via bun -e
function padRight(str: string, len: number): string {
  return str.slice(0, len).padEnd(len);
}
function padLeft(str: string, len: number): string {
  return str.slice(0, len).padStart(len);
}

// Header
const header = padRight("Repo", 35) + padLeft("Execs", 8) + padLeft("Tokens", 12) + padLeft("Cost", 10);
console.log(header);
console.log("-".repeat(header.length));

// Rows
for (const row of repos) {
  console.log(
    padRight(row.repo, 35) +
    padLeft(row.executions.toString(), 8) +
    padLeft(row.total_tokens.toLocaleString(), 12) +
    padLeft("$" + row.total_cost.toFixed(4), 10)
  );
}
```

### JSON Output Structure (REPORT-06)
```typescript
// Structured JSON for piping to jq, etc.
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
```

### CSV Output (REPORT-07)
```typescript
// CSV header + rows, suitable for piping to file or spreadsheet import
// Repos section
console.log("repo,executions,total_tokens,total_cost,avg_duration_ms");
for (const row of repos) {
  console.log(`"${row.repo}",${row.executions},${row.total_tokens},${row.total_cost},${row.avg_duration_ms}`);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `yargs` / `commander` for CLI parsing | `util.parseArgs` (Node.js built-in) | Node.js 18.3+ (2022) | Zero dependencies for simple CLI tools |
| `better-sqlite3` for reads | `bun:sqlite` (built-in) | Bun 1.0 (2023) | Zero dependencies, faster |
| Custom arg parsing with `process.argv.slice(2)` | `util.parseArgs` with types and defaults | Node.js 20.0+ stable | Type-safe, validates unknown flags |

**Deprecated/outdated:**
- `yargs` / `commander`: Still popular but overkill for 5 flags on a private operator tool
- `minimist`: Unmaintained, replaced by `util.parseArgs`

## Open Questions

1. **Should the script be added to package.json scripts?**
   - What we know: Current scripts section has `dev` and `start`. The existing shell scripts in `scripts/` are not in package.json.
   - What's unclear: Whether `bun run report` would be more discoverable than `bun scripts/usage-report.ts`.
   - Recommendation: Add a `"report": "bun scripts/usage-report.ts"` entry to package.json scripts for convenience. This follows common patterns for operator tools.

2. **Should tsconfig be updated to include scripts/?**
   - What we know: `tsconfig.json` includes only `src/**/*.ts`. The script at `scripts/usage-report.ts` would not be type-checked by `bunx tsc --noEmit`.
   - What's unclear: Whether adding scripts to tsconfig would cause issues with the existing `src/index.ts` module setup.
   - Recommendation: Add `"scripts/**/*.ts"` to the tsconfig `include` array. This ensures type-checking covers the script. Verified: Bun runs scripts fine regardless of tsconfig.

3. **Default DB path when running on the container vs locally**
   - What we know: The server uses `process.env.TELEMETRY_DB_PATH ?? "./data/kodiai-telemetry.db"`. The Dockerfile creates `/app/data/`.
   - What's unclear: When an operator runs the script, they may be in a different working directory.
   - Recommendation: The script should use the same default (`./data/kodiai-telemetry.db`) and support `--db /path/to/db` override. Document the `TELEMETRY_DB_PATH` env var as well. On the container, the operator would run `bun scripts/usage-report.ts --db /app/data/kodiai-telemetry.db`.

## Sources

### Primary (HIGH confidence)
- `bun:sqlite` official docs (https://bun.com/docs/runtime/sqlite) -- Database constructor with `{ readonly: true }`, WAL mode concurrent reads
- `util.parseArgs` Node.js docs (https://nodejs.org/api/util.html#utilparseargsconfig) -- Options schema, types, defaults, strict mode
- Phase 23 implementation (`src/telemetry/store.ts`, `src/telemetry/types.ts`) -- Database schema, column names, data types
- Local verification on Bun 1.3.8 -- All SQL queries, arg parsing, read-only DB access, table formatting tested via `bun -e`

### Secondary (MEDIUM confidence)
- Phase 23 RESEARCH.md -- Architecture decisions, WAL mode rationale, busy_timeout
- STACK.md -- Stack decisions for v0.3, CLI reporting section
- Handler code (`src/handlers/review.ts`, `src/handlers/mention.ts`) -- Event type formats, telemetry record fields

### Tertiary (LOW confidence)
- None -- all findings verified through local testing and codebase inspection

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- `bun:sqlite` and `util.parseArgs` both verified working on Bun 1.3.8 via local tests
- Architecture: HIGH -- Single self-contained script pattern; SQL queries verified against actual schema
- Pitfalls: HIGH -- Edge cases (missing DB, empty results, timezone) identified from practical testing
- Query patterns: HIGH -- All aggregation queries tested with in-memory SQLite and correct results

**Key technical facts verified:**
- `new Database(path, { readonly: true })` works in Bun 1.3.8 and correctly rejects writes
- `PRAGMA busy_timeout = 5000` works on read-only connections
- `util.parseArgs` supports `type: "string"`, `type: "boolean"`, `default`, `short` aliases, and `strict: true`
- Empty table aggregations return COUNT=0 and SUM=0 (via COALESCE), not null
- SQLite CASE expressions work for event type categorization
- CSV output is trivial since repo names (`owner/name`) never contain commas
- The `scripts/` directory already exists with shell scripts; adding a `.ts` file follows convention

**Database schema (from Phase 23, verified in `src/telemetry/store.ts`):**
```
executions table:
  id               INTEGER PRIMARY KEY AUTOINCREMENT
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))   -- UTC, format: YYYY-MM-DD HH:MM:SS
  delivery_id      TEXT
  repo             TEXT NOT NULL                             -- format: owner/name
  pr_number        INTEGER
  event_type       TEXT NOT NULL                             -- e.g., pull_request.opened, issue_comment.created
  provider         TEXT NOT NULL DEFAULT 'anthropic'
  model            TEXT NOT NULL
  input_tokens     INTEGER NOT NULL DEFAULT 0
  output_tokens    INTEGER NOT NULL DEFAULT 0
  cache_read_tokens    INTEGER NOT NULL DEFAULT 0
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0
  duration_ms      INTEGER NOT NULL DEFAULT 0
  cost_usd         REAL NOT NULL DEFAULT 0
  conclusion       TEXT NOT NULL
  session_id       TEXT
  num_turns        INTEGER
  stop_reason      TEXT

Indexes:
  idx_executions_created_at ON executions(created_at)
  idx_executions_repo ON executions(repo)
```

**Event types in the wild:**
- Review: `pull_request.opened`, `pull_request.ready_for_review`, `pull_request.review_requested`
- Mention: `issue_comment.created`, `pull_request_review_comment.created`, `pull_request_review.submitted`

**Research date:** 2026-02-11
**Valid until:** 2026-03-13 (30 days -- stable domain, no moving parts)
