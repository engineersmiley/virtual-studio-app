export function isIceRestartCoordinator(localUserId: string, remoteUserId: string): boolean {
  return localUserId.localeCompare(remoteUserId) < 0;
}

export function nextIceRestartDelay(attempt: number): number {
  const exponent = Math.max(0, Math.trunc(attempt) - 1);
  return Math.min(5_000 * 2 ** exponent, 30_000);
}
