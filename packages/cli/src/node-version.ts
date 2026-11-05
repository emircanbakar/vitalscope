/** `node:sqlite` bu sürümden beri release candidate; daha eskisinde deneysel veya hiç yok. */
export const MIN_NODE = "24.15.0";

export function isSupportedNode(version: string): boolean {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major > 24 || (major === 24 && minor >= 15);
}
