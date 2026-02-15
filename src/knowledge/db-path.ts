import { resolve } from "node:path";

export const DEFAULT_KNOWLEDGE_DB_PATH = "./data/kodiai-knowledge.db";

export type KnowledgeDbPathSource = "arg" | "env" | "default";

export type ResolveKnowledgeDbPathResult = {
  dbPath: string;
  source: KnowledgeDbPathSource;
};

export function resolveKnowledgeDbPath(overrides?: {
  dbPath?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}): ResolveKnowledgeDbPathResult {
  const env = overrides?.env ?? process.env;
  const cwd = overrides?.cwd ?? process.cwd();
  const explicitDbPath = overrides?.dbPath?.trim();
  const envDbPath = env.KNOWLEDGE_DB_PATH?.trim();

  if (explicitDbPath) {
    return {
      dbPath: resolve(cwd, explicitDbPath),
      source: "arg",
    };
  }

  if (envDbPath) {
    return {
      dbPath: resolve(cwd, envDbPath),
      source: "env",
    };
  }

  return {
    dbPath: resolve(cwd, DEFAULT_KNOWLEDGE_DB_PATH),
    source: "default",
  };
}
