export class WritePolicyError extends Error {
  readonly code:
    | "write-policy-denied-path"
    | "write-policy-not-allowed"
    | "write-policy-secret-detected"
    | "write-policy-no-changes";

  /** Best-effort file path involved in the refusal. */
  readonly path?: string;

  /** Which policy family triggered (denyPaths, allowPaths, secretScan). */
  readonly rule?: "denyPaths" | "allowPaths" | "secretScan";

  /** Best-effort policy pattern that matched (for glob-based rules). */
  readonly pattern?: string;

  /** Best-effort secret detector identifier (for secretScan rules). */
  readonly detector?: string;

  constructor(
    code: WritePolicyError["code"],
    message: string,
    meta?: {
      path?: string;
      rule?: WritePolicyError["rule"];
      pattern?: string;
      detector?: string;
    },
  ) {
    super(message);
    this.name = "WritePolicyError";
    this.code = code;
    this.path = meta?.path;
    this.rule = meta?.rule;
    this.pattern = meta?.pattern;
    this.detector = meta?.detector;
  }
}
