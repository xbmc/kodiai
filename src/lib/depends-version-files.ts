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
  for (const rawPackageName of packageNames) {
    const packageName = rawPackageName.toLowerCase();
    const versionFile = versionFiles.find(({ lowerFilename }) =>
      lowerFilename.includes(packageName)
    )?.file;
    if (versionFile) {
      versionFileByPackage.set(packageName, versionFile);
    }
  }
  return versionFileByPackage;
}
