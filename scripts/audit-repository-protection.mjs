import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY = 'engineersmiley/virtual-studio-app';
export const BRANCH = 'main';
export const REQUIRED_CHECK = 'PR TypeScript check';
// Public GitHub Actions App ID on github.com (not a credential).
export const GITHUB_ACTIONS_APP_ID = 15368;
const endpoint = `https://api.github.com/repos/${REPOSITORY}/branches/${BRANCH}/protection`;
const settings = `https://github.com/${REPOSITORY}/settings/branches`;

export function protectionProblems(protection) {
  const problems = [];
  const status = protection?.required_status_checks;
  if (!Array.isArray(status?.checks) || !status.checks.some(check =>
    check?.context === REQUIRED_CHECK && check.app_id === GITHUB_ACTIONS_APP_ID
  )) {
    problems.push(`Require "${REQUIRED_CHECK}" with expected source GitHub Actions (app ID ${GITHUB_ACTIONS_APP_ID}), not "any source".`);
  }
  if (status?.strict !== true) {
    problems.push('Enable "Require branches to be up to date before merging" under required status checks.');
  }
  if (protection?.enforce_admins?.enabled !== true) {
    problems.push('Enable "Do not allow bypassing the above settings" (administrator enforcement).');
  }
  return problems;
}

function httpGuidance(status) {
  if (status === 401) return 'Authentication was rejected. Supply a valid runtime GITHUB_TOKEN.';
  if (status === 403) return 'Access was denied or rate limited. Check repository access, token permissions, organization SSO authorization, and GitHub rate limits.';
  if (status === 404) return 'The main protection rule is missing, or the repository is not visible to this token. Check repository access and restore the main branch protection rule if missing.';
  if (status === 429) return 'GitHub rate limited the audit. Retry after the rate limit resets.';
  if (status >= 500) return 'GitHub is unavailable. Retry the audit; protection has NOT been verified.';
  return 'Check GitHub API availability and repository access, then retry.';
}

// Deliberately no writes, credential persistence, API-body logging, or fallback
// to the local workflow: only GitHub can report current merge protection.
export async function auditRepositoryProtection({ token, fetchImpl = fetch }) {
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('GITHUB_TOKEN is required at runtime. Use an existing credential with repository Administration: read access; never put it in source files or command arguments.');
  }
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'GET',
      redirect: 'error',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // Exceptions and GitHub response bodies may contain sensitive input.
    throw new Error('GitHub could not be reached within the audit request (network failure, timeout, or redirect). Check connectivity and retry; protection has NOT been verified.');
  }
  if (!response.ok) {
    throw new Error(`GitHub protection query failed (HTTP ${response.status}). ${httpGuidance(response.status)}`);
  }
  let protection;
  try {
    protection = await response.json();
  } catch {
    throw new Error('GitHub returned invalid JSON; protection has NOT been verified. Retry the audit.');
  }
  const problems = protectionProblems(protection);
  if (problems.length) {
    throw new Error(`Merge protection is missing or has drifted:\n${problems.map(problem => `- ${problem}`).join('\n')}\nA repository administrator must correct the main rule at ${settings}, then rerun this audit. No settings were changed.`);
  }
  return `PASS: ${REPOSITORY} ${BRANCH} requires "${REQUIRED_CHECK}" from GitHub Actions, up-to-date branches, and administrator enforcement. No settings were changed.`;
}

export async function main({ env = process.env, fetchImpl = fetch, log = console.log, error = console.error } = {}) {
  try {
    log(await auditRepositoryProtection({ token: env.GITHUB_TOKEN, fetchImpl }));
    return 0;
  } catch (failure) {
    error(`FAIL: repository protection audit for ${REPOSITORY} ${BRANCH}\n${failure.message}\nSee docs/repository-protection-audit.md for access requirements and corrective guidance.`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
