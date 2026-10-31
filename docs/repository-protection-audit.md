# Read-only merge protection audit

Run from the repository root with Node.js 22.12 or newer:

```sh
npm run audit:protection
```

The command queries GitHub's current branch protection for
`engineersmiley/virtual-studio-app` → `main` and exits **0 only when all three
conditions are verified**:

- `PR TypeScript check` is required specifically from the GitHub Actions app
  (github.com app ID `15368`). A context name alone, an unrestricted source, or
  a different app is not sufficient.
- Required status checks require branches to be up to date (`strict: true`).
- Branch protection applies to administrators (`enforce_admins.enabled: true`).

Any missing/disabled setting, unreadable protection, API error, or network
failure exits **1**. An unsuccessful audit is never evidence that merging is safe.
The command uses only a GET request and never changes repository settings,
prints API response bodies, or saves credentials.

## Access

Supply an existing `GITHUB_TOKEN` through the runtime's secure environment, not
through source files, command arguments, or committed configuration. The token
must have access to this repository. For a fine-grained personal access token or
GitHub App installation token, the branch protection endpoint requires repository
**Administration: read** permission. Organization SSO authorization may also be
required. Do not grant Administration: write for this audit.

The default GitHub Actions `GITHUB_TOKEN` generally cannot read branch protection
because it lacks Administration: read; `contents: read` is not sufficient. Do not
add this live audit to the required PR job using that token, or expose a privileged
credential to fork PRs. This command is an explicit operator audit, **not a
scheduled monitor**. Run it before repository maintenance/release and after
changing protection. Its offline tests run in the existing PR workflow but do
not verify live GitHub state.

## Correcting failures

Open [repository branch settings](https://github.com/engineersmiley/virtual-studio-app/settings/branches)
as a repository administrator and edit the protection rule applying to `main`:

1. Enable **Require status checks to pass before merging**.
2. Require **PR TypeScript check** and select **GitHub Actions** as the expected
   source, not **any source**. Keep the job name in
   `.github/workflows/typecheck.yml` synchronized with the required check.
3. Enable **Require branches to be up to date before merging**.
4. Enable **Do not allow bypassing the above settings** (administrator
   enforcement; older interfaces label this **Include administrators**).
5. Save the rule manually and rerun `npm run audit:protection`.

If the check is not available in the selector, run the existing TypeScript
workflow first. Do not remove required checks or disable protection to get a
green audit. All detected setting failures are printed together.

- **401:** the runtime credential is invalid/expired; replace it securely.
- **403:** check token permissions, repository access, SSO authorization, and rate
  limits. Do not interpret access denied as a successful audit.
- **404:** GitHub may hide an inaccessible repository, or the branch may have no
  protection. Confirm token access, repository/branch existence, and the rule.
- **429 / 5xx / network failure:** retry when GitHub/connectivity recovers.
- **Invalid JSON or unexpected payload:** audit fails closed; investigate the API
  response without publishing credentials or unredacted request logs.

This audit checks the classic branch protection API, matching the existing
policy. It does not treat rulesets as a substitute. If intentionally migrating to
rulesets, update and test the audit against the new effective policy rather than
silencing failures.

## Offline regression tests

```sh
npm run test:workflows
```

These tests cover missing settings, wrong/unrestricted check sources, combined
drift, authorization/API/network failures, and read-only credential-safe behavior
without contacting GitHub or needing credentials.
