export type DeploymentProvenance = {
  environment: string;
  gitCommitSha: string | null;
  gitCommitShortSha: string | null;
  gitRef: string | null;
  deploymentId: string | null;
};

type DeploymentEnvironment = Record<string, string | undefined>;

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
const SAFE_REF = /^[A-Za-z0-9._/-]{1,255}$/;
const VERCEL_DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]+$/;

export function getDeploymentProvenance(
  environment: DeploymentEnvironment,
): DeploymentProvenance {
  const gitCommitSha = FULL_GIT_SHA.test(environment.VERCEL_GIT_COMMIT_SHA ?? "")
    ? environment.VERCEL_GIT_COMMIT_SHA!.toLowerCase()
    : null;
  const gitRef = SAFE_REF.test(environment.VERCEL_GIT_COMMIT_REF ?? "")
    ? environment.VERCEL_GIT_COMMIT_REF!
    : null;
  const deploymentId = VERCEL_DEPLOYMENT_ID.test(environment.VERCEL_DEPLOYMENT_ID ?? "")
    ? environment.VERCEL_DEPLOYMENT_ID!
    : null;

  return {
    environment: environment.VERCEL_ENV ?? "local",
    gitCommitSha,
    gitCommitShortSha: gitCommitSha?.slice(0, 7) ?? null,
    gitRef,
    deploymentId,
  };
}
