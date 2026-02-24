/**
 * @deprecated Database connection is now managed via DATABASE_URL and src/db/client.ts.
 * This module is retained only for backward compatibility during the migration period.
 * Use createDbClient() from src/db/client.ts instead.
 */

export const DEFAULT_KNOWLEDGE_DB_PATH = "./data/kodiai-knowledge.db";

export type KnowledgeDbPathSource = "arg" | "env" | "default";

export type ResolveKnowledgeDbPathResult = {
  dbPath: string;
  source: KnowledgeDbPathSource;
};

/**
 * @deprecated Use DATABASE_URL env var and createDbClient() from src/db/client.ts instead.
 */
export function resolveKnowledgeDbPath(overrides?: {
  dbPath?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}): ResolveKnowledgeDbPathResult {
  const env = overrides?.env ?? process.env;
  const connectionString = env.DATABASE_URL?.trim();

  if (connectionString) {
    return {
      dbPath: connectionString,
      source: "env",
    };
  }

  return {
    dbPath: env.KNOWLEDGE_DB_PATH?.trim() || DEFAULT_KNOWLEDGE_DB_PATH,
    source: env.KNOWLEDGE_DB_PATH?.trim() ? "env" : "default",
  };
}
