import { z } from "zod";
import yaml from "js-yaml";

const writeSecretScanSchema = z
  .object({
    enabled: z.boolean().default(true),
  })
  .default({ enabled: true });

const writeSchema = z
  .object({
    enabled: z.boolean().default(false),
    /** If set, every changed path must match at least one allowPaths pattern. */
    allowPaths: z.array(z.string()).default([]),
    /** Changed paths matching any denyPaths pattern are blocked. Deny wins over allow. */
    denyPaths: z
      .array(z.string())
      .default([
        ".github/",
        ".git/",
        ".planning/",
        ".kodiai.yml",
        ".env",
        ".env.*",
        "**/*.pem",
        "**/*.key",
        "**/*.p12",
        "**/*.pfx",
        "**/*credentials*",
        "**/*secret*",
      ]),
    /** Basic rate limit for write-mode requests. 0 = no limit. */
    minIntervalSeconds: z.number().min(0).max(86400).default(0),
    secretScan: writeSecretScanSchema,
  })
  .default({
    enabled: false,
    allowPaths: [],
    denyPaths: [
      ".github/",
      ".git/",
      ".planning/",
      ".kodiai.yml",
      ".env",
      ".env.*",
      "**/*.pem",
      "**/*.key",
      "**/*.p12",
      "**/*.pfx",
      "**/*credentials*",
      "**/*secret*",
    ],
    minIntervalSeconds: 0,
    secretScan: { enabled: true },
  });

const reviewTriggersSchema = z
  .object({
    onOpened: z.boolean().default(true),
    onReadyForReview: z.boolean().default(true),
    onReviewRequested: z.boolean().default(true),
    onSynchronize: z.boolean().default(false),
  })
  .default({
    onOpened: true,
    onReadyForReview: true,
    onReviewRequested: true,
    onSynchronize: false,
  });

const pathInstructionSchema = z.object({
  path: z.union([z.string(), z.array(z.string())]),
  instructions: z.string(),
});

const suppressionPatternSchema = z.object({
  pattern: z.string().min(1),
  severity: z
    .array(z.enum(["critical", "major", "medium", "minor"]))
    .optional(),
  category: z
    .array(
      z.enum([
        "security",
        "correctness",
        "performance",
        "style",
        "documentation",
      ]),
    )
    .optional(),
  paths: z.array(z.string()).optional(),
});

const findingPrioritizationWeightsSchema = z
  .object({
    severity: z.number().min(0).max(1).default(0.45),
    fileRisk: z.number().min(0).max(1).default(0.3),
    category: z.number().min(0).max(1).default(0.15),
    recurrence: z.number().min(0).max(1).default(0.1),
  })
  .default({
    severity: 0.45,
    fileRisk: 0.3,
    category: 0.15,
    recurrence: 0.1,
  });

const reviewSchema = z
  .object({
    enabled: z.boolean().default(true),
    /**
     * Optional team slug/name to use for UI-based re-review.
     * When configured, Kodiai can ensure the team is requested on PR open so it appears
     * under Reviewers. Humans can then remove/re-request to retrigger a review.
     */
    uiRereviewTeam: z.string().optional(),
    /** If true, request uiRereviewTeam on opened/ready_for_review events (best-effort). */
    requestUiRereviewTeamOnOpen: z.boolean().default(false),
    triggers: reviewTriggersSchema,
    autoApprove: z.boolean().default(true),
    prompt: z.string().optional(),
    skipAuthors: z.array(z.string()).default([]),
    skipPaths: z.array(z.string()).default([]),
    /** Review mode: standard preserves current behavior, enhanced adds structured YAML metadata per comment. */
    mode: z.enum(["standard", "enhanced"]).default("standard"),
    /** Severity filtering: only report findings at or above this level. */
    severity: z
      .object({
        minLevel: z
          .enum(["critical", "major", "medium", "minor"])
          .default("minor"),
      })
      .default({ minLevel: "minor" }),
    /** Focus area targeting: concentrate review on these categories. Empty = all categories. */
    focusAreas: z
      .array(
        z.enum([
          "security",
          "correctness",
          "performance",
          "style",
          "documentation",
        ]),
      )
      .default([]),
    /** Explicit exclude list: skip these categories unless finding is CRITICAL. */
    ignoredAreas: z
      .array(
        z.enum([
          "security",
          "correctness",
          "performance",
          "style",
          "documentation",
        ]),
      )
      .default([]),
    /** Maximum inline comments per review. Range 1-25, default 7. */
    maxComments: z.number().min(1).max(25).default(7),
    suppressions: z
      .array(z.union([z.string().min(1), suppressionPatternSchema]))
      .default([]),
    minConfidence: z.number().min(0).max(100).default(0),
    prioritization: findingPrioritizationWeightsSchema,
    pathInstructions: z.array(pathInstructionSchema).default([]),
    profile: z.enum(["strict", "balanced", "minimal"]).optional(),
    /** Output language for review prose. Free-form string (ISO code or full name). Default: "en". */
    outputLanguage: z.string().default("en"),
    fileCategories: z
      .object({
        source: z.array(z.string()).optional(),
        test: z.array(z.string()).optional(),
        config: z.array(z.string()).optional(),
        docs: z.array(z.string()).optional(),
        infra: z.array(z.string()).optional(),
      })
      .optional(),
  })
  .default({
    enabled: true,
    triggers: {
      onOpened: true,
      onReadyForReview: true,
      onReviewRequested: true,
      onSynchronize: false,
    },
    autoApprove: true,
    requestUiRereviewTeamOnOpen: false,
    skipAuthors: [],
    skipPaths: [],
    mode: "standard",
    severity: { minLevel: "minor" },
    focusAreas: [],
    ignoredAreas: [],
    maxComments: 7,
    suppressions: [],
    minConfidence: 0,
    prioritization: {
      severity: 0.45,
      fileRisk: 0.3,
      category: 0.15,
      recurrence: 0.1,
    },
    pathInstructions: [],
    outputLanguage: "en",
  });

const conversationSchema = z
  .object({
    maxTurnsPerPr: z.number().min(1).max(50).default(10),
    contextBudgetChars: z.number().min(1000).max(50000).default(8000),
  })
  .default({ maxTurnsPerPr: 10, contextBudgetChars: 8000 });

const mentionSchema = z
  .object({
    enabled: z.boolean().default(true),
    acceptClaudeAlias: z.boolean().default(true),
    /** If non-empty, only these GitHub users can trigger @kodiai mentions. Empty = all users allowed. */
    allowedUsers: z.array(z.string()).default([]),
    prompt: z.string().optional(),
    conversation: conversationSchema,
  })
  .default({
    enabled: true,
    acceptClaudeAlias: true,
    allowedUsers: [],
    conversation: { maxTurnsPerPr: 10, contextBudgetChars: 8000 },
  });

const telemetrySchema = z
  .object({
    /** If false, skip telemetry recording for this repo. Default: true. */
    enabled: z.boolean().default(true),
    /** If set and > 0, warn when execution cost exceeds this USD threshold. 0 = no warning. */
    costWarningUsd: z.number().min(0).default(0),
  })
  .default({ enabled: true, costWarningUsd: 0 });

const embeddingsSchema = z
  .object({
    enabled: z.boolean().default(true),
    model: z.string().default("voyage-code-3"),
    dimensions: z.number().min(256).max(2048).default(1024),
  })
  .default({ enabled: true, model: "voyage-code-3", dimensions: 1024 });

const sharingSchema = z
  .object({
    enabled: z.boolean().default(false),
  })
  .default({ enabled: false });

const retrievalSchema = z
  .object({
    enabled: z.boolean().default(true),
    topK: z.number().min(1).max(20).default(5),
    distanceThreshold: z.number().min(0).max(2).default(0.3),
    adaptive: z.boolean().default(true),
    maxContextChars: z.number().min(0).max(5000).default(2000),
  })
  .default({
    enabled: true,
    topK: 5,
    distanceThreshold: 0.3,
    adaptive: true,
    maxContextChars: 2000,
  });

const knowledgeSchema = z
  .object({
    /**
     * Global knowledge sharing is opt-in only.
     * false = repository-scoped writes only.
     * @deprecated Use sharing.enabled instead.
     */
    shareGlobal: z.boolean().default(false),
    /** Owner-level sharing configuration. */
    sharing: sharingSchema,
    /** Embedding generation configuration. */
    embeddings: embeddingsSchema,
    /** Retrieval configuration for context-aware reviews. */
    retrieval: retrievalSchema,
  })
  .default({
    shareGlobal: false,
    sharing: { enabled: false },
    embeddings: { enabled: true, model: "voyage-code-3", dimensions: 1024 },
    retrieval: {
      enabled: true,
      topK: 5,
      distanceThreshold: 0.3,
      adaptive: true,
      maxContextChars: 2000,
    },
  });

const severityFloorOverrideSchema = z.object({
  pattern: z.string().min(1),
  language: z.string().optional(),
  minSeverity: z.enum(["critical", "major", "medium", "minor"]),
  skipTestFiles: z.boolean().default(true),
});

const toolingOverrideSchema = z.object({
  language: z.string(),
  suppressFormatting: z.boolean().default(true),
  suppressImportOrder: z.boolean().default(true),
  configFiles: z.array(z.string()).optional(),
});

const languageRulesSchema = z
  .object({
    severityFloors: z.array(severityFloorOverrideSchema).default([]),
    toolingOverrides: z.array(toolingOverrideSchema).default([]),
    disableBuiltinFloors: z.boolean().default(false),
  })
  .default({
    severityFloors: [],
    toolingOverrides: [],
    disableBuiltinFloors: false,
  });

const riskWeightsSchema = z
  .object({
    linesChanged: z.number().min(0).max(1).default(0.3),
    pathRisk: z.number().min(0).max(1).default(0.3),
    fileCategory: z.number().min(0).max(1).default(0.2),
    languageRisk: z.number().min(0).max(1).default(0.1),
    fileExtension: z.number().min(0).max(1).default(0.1),
  })
  .default({
    linesChanged: 0.3,
    pathRisk: 0.3,
    fileCategory: 0.2,
    languageRisk: 0.1,
    fileExtension: 0.1,
  });

const largePRSchema = z
  .object({
    /** Number of files that triggers large PR triage. Default 50. */
    fileThreshold: z.number().min(10).max(1000).default(50),
    /** Number of files to review at full depth. Default 30. */
    fullReviewCount: z.number().min(5).max(200).default(30),
    /** Number of files to review at abbreviated depth (critical/major only). Default 20. */
    abbreviatedCount: z.number().min(0).max(200).default(20),
    /** Risk scoring weights. Normalized at runtime so they need not sum to exactly 1.0. */
    riskWeights: riskWeightsSchema,
  })
  .default({
    fileThreshold: 50,
    fullReviewCount: 30,
    abbreviatedCount: 20,
    riskWeights: {
      linesChanged: 0.3,
      pathRisk: 0.3,
      fileCategory: 0.2,
      languageRisk: 0.1,
      fileExtension: 0.1,
    },
  });

const timeoutSchema = z
  .object({
    dynamicScaling: z.boolean().default(true),
    autoReduceScope: z.boolean().default(true),
  })
  .default({ dynamicScaling: true, autoReduceScope: true });

const feedbackAutoSuppressThresholdsSchema = z
  .object({
    minThumbsDown: z.number().min(1).max(50).default(3),
    minDistinctReactors: z.number().min(1).max(50).default(3),
    minDistinctPRs: z.number().min(1).max(50).default(2),
  })
  .default({
    minThumbsDown: 3,
    minDistinctReactors: 3,
    minDistinctPRs: 2,
  });

const feedbackAutoSuppressSchema = z
  .object({
    enabled: z.boolean().default(false),
    thresholds: feedbackAutoSuppressThresholdsSchema,
  })
  .default({
    enabled: false,
    thresholds: {
      minThumbsDown: 3,
      minDistinctReactors: 3,
      minDistinctPRs: 2,
    },
  });

const feedbackSchema = z
  .object({
    autoSuppress: feedbackAutoSuppressSchema,
  })
  .default({
    autoSuppress: {
      enabled: false,
      thresholds: {
        minThumbsDown: 3,
        minDistinctReactors: 3,
        minDistinctPRs: 2,
      },
    },
  });

const repoConfigSchema = z.object({
  model: z.string().default("claude-sonnet-4-5-20250929"),
  maxTurns: z.number().min(1).max(100).default(25),
  timeoutSeconds: z.number().min(30).max(1800).default(600),
  systemPromptAppend: z.string().optional(),
  /**
   * Write-mode gates mention-driven code modifications (branch/commit/push).
   * This is deny-by-default. Enabling this does not affect review-only behavior.
   */
  write: writeSchema,
  review: reviewSchema,
  mention: mentionSchema,
  telemetry: telemetrySchema,
  knowledge: knowledgeSchema,
  languageRules: languageRulesSchema,
  largePR: largePRSchema,
  feedback: feedbackSchema,
  timeout: timeoutSchema,
});

export type RepoConfig = z.infer<typeof repoConfigSchema>;

export interface ConfigWarning {
  section: string;
  issues: string[];
}

export interface LoadConfigResult {
  config: RepoConfig;
  warnings: ConfigWarning[];
}

export async function loadRepoConfig(
  workspaceDir: string,
): Promise<LoadConfigResult> {
  const configPath = `${workspaceDir}/.kodiai.yml`;
  const file = Bun.file(configPath);

  if (!(await file.exists())) {
    return { config: repoConfigSchema.parse({}), warnings: [] };
  }

  const raw = await file.text();

  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    throw new Error(
      `Invalid .kodiai.yml: YAML parse error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Pass 1 (fast path): try full schema parse
  const fullResult = repoConfigSchema.safeParse(parsed);
  if (fullResult.success) {
    return { config: fullResult.data, warnings: [] };
  }

  // Pass 2 (section fallback): parse each section independently
  const isObject = typeof parsed === "object" && parsed !== null;
  const obj = isObject ? (parsed as Record<string, unknown>) : {};

  const warnings: ConfigWarning[] = [];

  if (!isObject) {
    warnings.push({
      section: "root",
      issues: ["Config is not an object, using all defaults"],
    });
  }

  // model
  const modelSchema = z.string().default("claude-sonnet-4-5-20250929");
  const modelResult = modelSchema.safeParse(obj.model);
  let model: string;
  if (modelResult.success) {
    model = modelResult.data;
  } else {
    model = "claude-sonnet-4-5-20250929";
    warnings.push({
      section: "model",
      issues: modelResult.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    });
  }

  // maxTurns
  const maxTurnsSchema = z.number().min(1).max(100).default(25);
  const maxTurnsResult = maxTurnsSchema.safeParse(obj.maxTurns);
  let maxTurns: number;
  if (maxTurnsResult.success) {
    maxTurns = maxTurnsResult.data;
  } else {
    maxTurns = 25;
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

  const config: RepoConfig = {
    model,
    maxTurns,
    timeoutSeconds,
    systemPromptAppend,
    review,
    write,
    mention,
    telemetry,
    knowledge,
    languageRules,
    largePR,
    feedback,
    timeout,
  };

  return { config, warnings };
}
