export function captainPoints(basePoints: number, captainApplied: boolean) {
  return basePoints * (captainApplied ? 2 : 1);
}

export function captainUsage(allowed: number, deployments: Array<{ locked: boolean }>) {
  const used = deployments.filter((deployment) => deployment.locked).length;
  const reserved = deployments.length - used;
  return { allowed, used, reserved, remaining: Math.max(allowed - used - reserved, 0) };
}
