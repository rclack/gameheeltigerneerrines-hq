import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getDeploymentProvenance } from "../../src/lib/deploymentProvenance.ts";

const sha = "0123456789abcdef0123456789abcdef01234567";

test("returns immutable Vercel deployment provenance", () => {
  assert.deepEqual(
    getDeploymentProvenance({
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_SHA: sha,
      VERCEL_GIT_COMMIT_REF: "main",
      VERCEL_DEPLOYMENT_ID: "dpl_7Gw5ZMBpQA8h9GF832KGp7nwbuh3",
    }),
    {
      environment: "production",
      gitCommitSha: sha,
      gitCommitShortSha: "0123456",
      gitRef: "main",
      deploymentId: "dpl_7Gw5ZMBpQA8h9GF832KGp7nwbuh3",
    },
  );
});

test("degrades safely when local deployment metadata is unavailable", () => {
  assert.deepEqual(getDeploymentProvenance({}), {
    environment: "local",
    gitCommitSha: null,
    gitCommitShortSha: null,
    gitRef: null,
    deploymentId: null,
  });
});

test("does not expose malformed deployment metadata", () => {
  assert.deepEqual(
    getDeploymentProvenance({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_SHA: "not-a-sha",
      VERCEL_GIT_COMMIT_REF: "unsafe ref with spaces",
      VERCEL_DEPLOYMENT_ID: "not-a-deployment-id",
    }),
    {
      environment: "preview",
      gitCommitSha: null,
      gitCommitShortSha: null,
      gitRef: null,
      deploymentId: null,
    },
  );
});

test("the public health route exposes only the validated provenance contract", () => {
  const healthRoute = readFileSync(
    new URL("../../src/app/api/health/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(healthRoute, /deployment: getDeploymentProvenance\(process\.env\)/);
  assert.doesNotMatch(
    healthRoute,
    /VERCEL_GIT_COMMIT_MESSAGE|VERCEL_GIT_COMMIT_AUTHOR|VERCEL_GIT_REPO|process\.env\s*[,}]/,
  );
});
