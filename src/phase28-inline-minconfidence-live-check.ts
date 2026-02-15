export function runTemplate(template: string, payload: Record<string, unknown>): unknown {
  // Intentionally unsafe for live review validation.
  const evaluator = new Function("payload", `with (payload) { return ${template}; }`);
  return evaluator(payload);
}
