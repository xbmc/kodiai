import { z } from "zod";
import yaml from "js-yaml";
import { readTextFileBounded } from "../lib/bounded-file.ts";
import {
  MAX_REPO_CONFIG_BYTES,
  feedbackSchema,
  guardrailsSchema,
  knowledgeSchema,
  languageRulesSchema,
  largePRSchema,
  mentionSchema,
  modelsSchema,
  repoBudgetSchema,
  repoConfigSchema,
  repoDoctrineSchema,
  reviewSchema,
  telemetrySchema,
  timeoutSchema,
  triageSchema,
  writeSchema,
} from "./config-schema.ts";

export { MAX_REPO_CONFIG_BYTES } from "./config-schema.ts";

export type RepoConfig = z.infer<typeof repoConfigSchema>;

export interface ConfigWarning {
  section: string;
  issues: string[];
}

export interface LoadConfigResult {
  config: RepoConfig;
  warnings: ConfigWarning[];
}

const DEFAULT_REPO_BUDGETS: Record<string, number> = {
  "xbmc/xbmc": 300,
  "xbmc/xbmc-addons": 300,
  "xbmc/kodiai": 900,
};

function resolveRepoBudgetSeconds(owner: string, repo: string): number {
  const envKey = `REPO_BUDGET_${owner.toUpperCase()}_${repo.toUpperCase()}`;
  const envValue = process.env[envKey];
  if (envValue) {
    const parsed = parseInt(envValue, 10);
    if (!isNaN(parsed) && parsed >= 30 && parsed <= 3600) {
      return parsed;
    }
  }
  const repoKey = `${owner}/${repo}`;
  return DEFAULT_REPO_BUDGETS[repoKey] ?? 1860; // ACA default fallback
}

function isConfigRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeConfigValue(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (
    typeof value === "number"
    || typeof value === "boolean"
    || value === null
    || value === undefined
  ) {
    return String(value);
  }

  return "present";
}

function collectConfigCompatibilityWarnings(
  parsed: unknown,
  config: RepoConfig,
): ConfigWarning[] {
  if (!isConfigRecord(parsed)) {
    return [];
  }

  const review = parsed.review;
  if (!isConfigRecord(review)) {
    return [];
  }

  if (!Object.prototype.hasOwnProperty.call(review, "onSynchronize")) {
    return [];
  }

  const legacyValue = describeConfigValue(review.onSynchronize);
  return [{
    section: "review",
    issues: [
      `Legacy review.onSynchronize=${legacyValue} is ignored; effective review.triggers.onSynchronize=${config.review.triggers.onSynchronize}. Move this setting to review.triggers.onSynchronize.`,
    ],
  }];
}

function doctrineIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = ["doctrine", ...issue.path.map(String)].join(".");
    return `${path}: ${issue.message}; using default disabled doctrine`;
  });
}

function sanitizeParsedDoctrine(parsed: unknown): {
  parsed: unknown;
  warnings: ConfigWarning[];
} {
  if (!isConfigRecord(parsed)) {
    return { parsed, warnings: [] };
  }

  const review = parsed.review;
  if (!isConfigRecord(review) || !Object.prototype.hasOwnProperty.call(review, "doctrine")) {
    return { parsed, warnings: [] };
  }

  const result = repoDoctrineSchema.safeParse(review.doctrine);
  if (result.success) {
    return { parsed, warnings: [] };
  }

  return {
    parsed: {
      ...parsed,
      review: {
        ...review,
        doctrine: repoDoctrineSchema.parse({}),
      },
    },
    warnings: [{
      section: "review.doctrine",
      issues: doctrineIssues(result.error),
    }],
  };
}

export async function loadRepoConfig(
  workspaceDir: string,
  owner?: string,
  repo?: string,
): Promise<LoadConfigResult> {
  const configPath = `${workspaceDir}/.kodiai.yml`;
  const file = Bun.file(configPath);

  const defaultRepoBudgetSeconds = owner && repo ? resolveRepoBudgetSeconds(owner, repo) : 1860;

  if (!(await file.exists())) {
    return {
      config: repoConfigSchema.parse({
        repoBudget: { targetRemoteRuntimeSeconds: defaultRepoBudgetSeconds },
      }),
      warnings: [],
    };
  }

  const raw = await readTextFileBounded(configPath, MAX_REPO_CONFIG_BYTES);

  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    throw new Error(
      `Invalid .kodiai.yml: YAML parse error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const doctrineSanitized = sanitizeParsedDoctrine(parsed);
  parsed = doctrineSanitized.parsed;

  // Pass 1 (fast path): try full schema parse
  const fullResult = repoConfigSchema.safeParse(parsed);
  if (fullResult.success) {
    return {
      config: fullResult.data,
      warnings: [
        ...doctrineSanitized.warnings,
        ...collectConfigCompatibilityWarnings(parsed, fullResult.data),
      ],
    };
  }

  // Pass 2 (section fallback): parse each section independently
  const isObject = typeof parsed === "object" && parsed !== null;
  const obj = isObject ? (parsed as Record<string, unknown>) : {};

  const warnings: ConfigWarning[] = [...doctrineSanitized.warnings];

  if (!isObject) {
    warnings.push({
      section: "root",
      issues: ["Config is not an object, using all defaults"],
    });
  }

  // model
  const modelSchema = z.string().default("claude-sonnet-5");
  const modelResult = modelSchema.safeParse(obj.model);
  let model: string;
  if (modelResult.success) {
    model = modelResult.data;
  } else {
    model = "claude-sonnet-5";
    warnings.push({
      section: "model",
      issues: modelResult.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    });
  }

  // maxTurns
  const maxTurnsSchema = z.number().min(1).max(100).default(40);
  const maxTurnsResult = maxTurnsSchema.safeParse(obj.maxTurns);
  let maxTurns: number;
  if (maxTurnsResult.success) {
    maxTurns = maxTurnsResult.data;
  } else {
    maxTurns = 40;
    warnings.push({
      section: "maxTurns",
      issues: maxTurnsResult.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    });
  }

  // timeoutSeconds
  const timeoutSecondsSchema = z.number().min(30).max(1800).default(600);
  const timeoutSecondsResult = timeoutSecondsSchema.safeParse(
    obj.timeoutSeconds,
  );
  let timeoutSeconds: number;
  if (timeoutSecondsResult.success) {
    timeoutSeconds = timeoutSecondsResult.data;
  } else {
    timeoutSeconds = 600;
    warnings.push({
      section: "timeoutSeconds",
      issues: timeoutSecondsResult.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    });
  }

  // systemPromptAppend
  const systemPromptAppendSchema = z.string().optional();
  const systemPromptAppendResult = systemPromptAppendSchema.safeParse(
    obj.systemPromptAppend,
  );
  let systemPromptAppend: string | undefined;
  if (systemPromptAppendResult.success) {
    systemPromptAppend = systemPromptAppendResult.data;
  } else {
    systemPromptAppend = undefined;
    warnings.push({
      section: "systemPromptAppend",
      issues: systemPromptAppendResult.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    });
  }

  // review
  const reviewResult = reviewSchema.safeParse(obj.review);
  let review: z.infer<typeof reviewSchema>;
  if (reviewResult.success) {
    review = reviewResult.data;
  } else {
    review = reviewSchema.parse({});
    warnings.push({
      section: "review",
      issues: reviewResult.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    });
  }

  // write
  const writeResult = writeSchema.safeParse(obj.write);
  let write: z.infer<typeof writeSchema>;
  if (writeResult.success) {
    write = writeResult.data;
  } else {
    write = writeSchema.parse({});
    warnings.push({
      section: "write",
      issues: writeResult.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    });
  }

  // mention
  const mentionResult = mentionSchema.safeParse(obj.mention);
  let mention: z.infer<typeof mentionSchema>;
  if (mentionResult.success) {
    mention = mentionResult.data;
  } else {
    mention = mentionSchema.parse({});
    warnings.push({
      section: "mention",
      issues: mentionResult.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    });
  }

  // telemetry
  const telemetryResult = telemetrySchema.safeParse(obj.telemetry);
  let telemetry: z.infer<typeof telemetrySchema>;
  if (telemetryResult.success) {
    telemetry = telemetryResult.data;
  } else {
    telemetry = telemetrySchema.parse({});
    warnings.push({
      section: "telemetry",
      issues: telemetryResult.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    });
  }

  // knowledge
  const knowledgeResult = knowledgeSchema.safeParse(obj.knowledge);
  let knowledge: z.infer<typeof knowledgeSchema>;
  if (knowledgeResult.success) {
    knowledge = knowledgeResult.data;
  } else {
    knowledge = knowledgeSchema.parse({});
    warnings.push({
      section: "knowledge",
      issues: knowledgeResult.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    });
  }

  // languageRules
  const languageRulesResult = languageRulesSchema.safeParse(obj.languageRules);
  let languageRules: z.infer<typeof languageRulesSchema>;
  if (languageRulesResult.success) {
    languageRules = languageRulesResult.data;
  } else {
    languageRules = languageRulesSchema.parse({});
    warnings.push({
      section: "languageRules",
      issues: languageRulesResult.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    });
  }

  // largePR
  const largePRResult = largePRSchema.safeParse(obj.largePR);
  let largePR: z.infer<typeof largePRSchema>;
  if (largePRResult.success) {
    largePR = largePRResult.data;
  } else {
    largePR = largePRSchema.parse({});
    warnings.push({
      section: "largePR",
      issues: largePRResult.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    });
  }

  // feedback
  const feedbackResult = feedbackSchema.safeParse(obj.feedback);
  let feedback: z.infer<typeof feedbackSchema>;
  if (feedbackResult.success) {
    feedback = feedbackResult.data;
  } else {
    feedback = feedbackSchema.parse({});
    warnings.push({
      section: "feedback",
      issues: feedbackResult.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    });
  }

  // timeout
  const timeoutResult = timeoutSchema.safeParse(obj.timeout);
  let timeout: z.infer<typeof timeoutSchema>;
  if (timeoutResult.success) {
    timeout = timeoutResult.data;
  } else {
    timeout = timeoutSchema.parse({});
    warnings.push({
      section: "timeout",
      issues: timeoutResult.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    });
  }

  // triage
  const triageResult = triageSchema.safeParse(obj.triage);
  let triage: z.infer<typeof triageSchema>;
  if (triageResult.success) {
    triage = triageResult.data;
  } else {
    triage = triageSchema.parse({});
    warnings.push({
      section: "triage",
      issues: triageResult.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    });
  }

  // guardrails
  const guardrailsResult = guardrailsSchema.safeParse(obj.guardrails);
  let guardrails: z.infer<typeof guardrailsSchema>;
  if (guardrailsResult.success) {
    guardrails = guardrailsResult.data;
  } else {
    guardrails = guardrailsSchema.parse({});
    warnings.push({
      section: "guardrails",
      issues: guardrailsResult.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    });
  }

  // models
  const modelsResult = modelsSchema.safeParse(obj.models);
  let models: z.infer<typeof modelsSchema>;
  if (modelsResult.success) {
    models = modelsResult.data;
  } else {
    models = modelsSchema.parse({});
    warnings.push({
      section: "models",
      issues: modelsResult.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    });
  }

  // defaultModel
  const defaultModelSchema = z.string().optional();
  const defaultModelResult = defaultModelSchema.safeParse(obj.defaultModel);
  let defaultModel: string | undefined;
  if (defaultModelResult.success) {
    defaultModel = defaultModelResult.data;
  } else {
    defaultModel = undefined;
    warnings.push({
      section: "defaultModel",
      issues: defaultModelResult.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    });
  }

  // defaultFallbackModel
  const defaultFallbackModelSchema = z.string().optional();
  const defaultFallbackModelResult = defaultFallbackModelSchema.safeParse(
    obj.defaultFallbackModel,
  );
  let defaultFallbackModel: string | undefined;
  if (defaultFallbackModelResult.success) {
    defaultFallbackModel = defaultFallbackModelResult.data;
  } else {
    defaultFallbackModel = undefined;
    warnings.push({
      section: "defaultFallbackModel",
      issues: defaultFallbackModelResult.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    });
  }

  // repoBudget
  const repoBudgetResult = repoBudgetSchema.safeParse(obj.repoBudget);
  let repoBudget: z.infer<typeof repoBudgetSchema>;
  if (repoBudgetResult.success) {
    repoBudget = repoBudgetResult.data;
  } else {
    repoBudget = {
      targetRemoteRuntimeSeconds: defaultRepoBudgetSeconds,
    };
    if (repoBudgetResult.error.issues.length > 0) {
      warnings.push({
        section: "repoBudget",
        issues: repoBudgetResult.error.issues.map(
          (i) => `${i.path.join(".")}: ${i.message}`,
        ),
      });
    }
  }

  const config: RepoConfig = {
    model,
    maxTurns,
    timeoutSeconds,
    systemPromptAppend,
    models,
    defaultModel,
    defaultFallbackModel,
    repoBudget,
    review,
    write,
    mention,
    telemetry,
    knowledge,
    languageRules,
    largePR,
    feedback,
    timeout,
    triage,
    guardrails,
  };

  return {
    config,
    warnings: [...warnings, ...collectConfigCompatibilityWarnings(parsed, config)],
  };
}

