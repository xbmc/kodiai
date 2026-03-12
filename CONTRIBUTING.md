# Contributing to KodiAI

Thanks for your interest in contributing. This guide covers everything you need to get started.

## Prerequisites

- **[Bun](https://bun.sh/)** — runtime, package manager, and test runner
- **Git**
- **PostgreSQL** (optional) — required only for database-backed tests and local runs with persistence

## Development Setup

```bash
git clone https://github.com/kodiai/kodiai.git
cd kodiai
bun install
cp .env.example .env
```

Edit `.env` with your configuration. See `.env.example` for all available variables with descriptions. At minimum you need:

- `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY` (or `GITHUB_PRIVATE_KEY_BASE64`), `GITHUB_WEBHOOK_SECRET`
- `CLAUDE_CODE_OAUTH_TOKEN`
- `DATABASE_URL` — PostgreSQL connection string

## Running the App

```bash
bun run dev      # Start with file watching (auto-restart on changes)
bun run start    # Start without watching
```

The server listens on `PORT` (default 3000).

## Testing

Run the full test suite:

```bash
bun test
```

Tests are located alongside source files as `*.test.ts`. The test runner is configured to scan `src/` only (see `bunfig.toml`).

### Database Tests

Tests that require PostgreSQL use the `describe.skipIf` pattern to skip automatically when no database is available:

```typescript
const TEST_DB_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB_URL)("MyStore (pgvector)", () => {
  // tests that need a live database
});
```

To run database tests, set `TEST_DATABASE_URL` in your environment:

```bash
TEST_DATABASE_URL="postgresql://localhost:5432/kodiai_test" bun test
```

Without `TEST_DATABASE_URL`, these tests are silently skipped — the rest of the suite still runs.

## Code Style

### TypeScript

The project uses TypeScript with strict mode enabled (`tsconfig.json`). All code should pass `tsc` with no errors.

### Logging

Use **pino** for structured logging — not `console.log`. The app initializes a pino logger; import and use it for any runtime output.

### Validation

Use **Zod** schemas for input validation, configuration parsing, and data shape enforcement. Prefer Zod over manual validation logic.

### Testing

Use **bun:test** (`describe`, `it`, `expect`) for all tests. Test files live next to the code they test with a `.test.ts` suffix.

## Pull Request Process

1. Branch from `main`
2. Write descriptive commit messages
3. Ensure `bun test` passes (non-DB tests at minimum)
4. Open a PR with a clear description of what changed and why
5. Address review feedback

## Project Structure

For a detailed module map and architectural overview, see [docs/architecture.md](docs/architecture.md).

Key top-level directories:

- `src/` — application source code
- `docs/` — project documentation
- `scripts/` — operational and migration scripts
