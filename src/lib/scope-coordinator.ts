export type ScopeGroup = {
  scope: string;
  packages: string[];
};

/**
 * Detect multi-package coordination: returns scope groups with 2+ packages.
 *
 * Non-scoped packages are ignored.
 */
export function detectScopeCoordination(packageNames: string[]): ScopeGroup[] {
  const byScope = new Map<string, string[]>();

  for (const pkg of packageNames) {
    if (!pkg.startsWith("@")) continue;
    const scope = pkg.split("/")[0];
    if (!scope) continue;

    const list = byScope.get(scope) ?? [];
    list.push(pkg);
    byScope.set(scope, list);
  }

  return Array.from(byScope.entries())
    .filter(([_, pkgs]) => pkgs.length >= 2)
    .map(([scope, packages]) => ({
      scope,
      packages: [...packages].sort(),
    }))
    .sort((a, b) => a.scope.localeCompare(b.scope));
}
