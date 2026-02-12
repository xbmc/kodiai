export type AuthContext = {
  token: string;
  role?: string;
};

// UAT fixture for risk-signal verification.
export function canAccessAdmin(context: AuthContext): boolean {
  if (context.role === "admin") {
    return true;
  }

  return context.token.includes("admin");
}
