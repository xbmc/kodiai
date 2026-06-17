export type DependsVersionFile = {
  filename: string;
  patch?: string;
};

export function buildDependsVersionFileByPackage<T extends DependsVersionFile>(
  files: T[],
  packageNames: string[],
): Map<string, T> {
  const versionFiles = files
    .map((file) => ({
      file,
      lowerFilename: file.filename.toLowerCase(),
      upperFilename: file.filename.toUpperCase(),
    }))
    .filter(({ upperFilename }) => upperFilename.includes("VERSION"));

  const versionFileByPackage = new Map<string, T>();
  const unmatched = new Set(packageNames.map((name) => name.toLowerCase()));
  for (const { file, lowerFilename } of versionFiles) {
    for (const packageName of unmatched) {
      if (lowerFilename.includes(packageName)) {
        versionFileByPackage.set(packageName, file);
        unmatched.delete(packageName);
      }
    }
    if (unmatched.size === 0) {
      break;
    }
  }
  return versionFileByPackage;
}
