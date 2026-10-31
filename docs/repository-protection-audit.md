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
credential to PR code. The standalone command remains available for operators.
The separate trusted monitor below runs periodically after activation. Offline
tests run in the existing PR workflow but do not verify live GitHub state.

## Scheduled monitoring and activation

`.github/workflows/repository-protection-audit.yml` runs every six hours at
00:17, 06:17, 12:17, and 18:17 UTC, and supports manual runs. GitHub schedules
are best-effort and can be delayed. The workflow must be merged into the
repository's default branch (`main`) before GitHub will schedule it.

A repository administrator must perform this one-time setup:

1. In **Settings → Environments**, create `repository-protection-audit`.
   Set **Deployment branches and tags → Selected branches and tags** with
   exactly one **branch** rule, `main`, and no tag rules. Do not use "Protected
   branches only": this monitor must still run if branch protection disappears.
   Do not require manual deployment approval, which would block unattended runs.
2. Add **environment secret** `REPOSITORY_PROTECTION_TOKEN` using GitHub's
   secure secret form. Use a fine-grained credential limited to
   `engineersmiley/virtual-studio-app` with **Administration: read** (and the
   implicit Metadata: read), not Administration: write. Set a suitable expiry
   and arrange rotation. Never put it in repository/organization secrets,
   workflow files, shell arguments, logs, artifacts, or PR-accessible code.
   The environment restriction is essential; a missing environment is
   automatically created by Actions without branch restrictions.
3. Enable repository **Issues** and allow the workflow's default Actions token
   to have **Issues: write**. This short-lived notification token is separate
   from the Administration: read credential; never use the privileged token
   to create alerts.
4. Merge the workflow and run **Actions → Repository protection monitor →
   Run workflow**, selecting `main`. Confirm the audit passes. A dispatch on
   any other branch is deliberately skipped.
5. Confirm the notification path by temporarily removing the environment
   secret and manually running on `main` (do not disable protection).
   Expect a failed audit and an assigned issue mentioning `@engineersmiley`
   with the run link and authentication/drift remediation. Restore the secret
   securely, rerun successfully, and close the test issue.
6. The maintainer should enable GitHub web/email notifications for mentions,
   assignments, and issue participation, and watch this repository's Actions
   failures as a fallback. Verify receipt during step 5; repository code cannot
   override personal notification preferences.

The audit checks out only the audit script from trusted `main`, installs no
project dependencies, and injects the credential only into the read-only Node
step. It has no PR, `pull_request_target`, or `workflow_run` trigger. The
notification job has no source checkout or Administration credential. On any
audit job failure (including missing credentials or checkout/setup failure), it
opens an assigned issue, or comments on the existing open bot-created alert.
Repeated failures therefore keep notifying the subscribed maintainer without
creating an issue per run. Closing an unresolved alert causes the next failure
to open a new one. Recovery never auto-closes an alert or changes settings.

If issue delivery itself fails (for example, Issues is disabled or the default
token is restricted), the notification job fails visibly in Actions; inspect
that run and restore notification access. Keep Actions failure notifications
enabled as this fallback. GitHub may disable schedules in inactive public
repositories, and a disabled/deleted workflow cannot notify about its own
absence: periodically check **Actions** for recent runs and re-enable the
workflow if needed.

Activation is not verified merely by passing offline tests. Record a successful
live run and a received failure alert before relying on scheduled monitoring.

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
