---
name: Required PR check
description: External GitHub merge protection and the required TypeScript status.
---

The GitHub repository's `main` branch requires the `PR TypeScript check` status from the GitHub Actions app, requires branches to be up to date, and applies protection to administrators.

**Why:** The user requires TypeScript failures to prevent merging, not merely to appear in optional release checks. These settings live in GitHub, not in the repository's workflow files.

**How to apply:** When renaming or replacing the PR check, update GitHub's required status as well. Preserve the GitHub Actions app restriction so a status from another source cannot satisfy it. Do not weaken protection to push changes; use a pull request containing the workflow.

Privileged merge-protection monitoring credentials must be restricted to trusted
`main` execution using an environment with an explicit branch allowlist, never
repository-wide secrets or PR execution. Use Administration: read only and keep
issue-notification permission on a separate short-lived token.

**Why:** The default Actions token cannot verify this policy, and monitoring must
continue even when the branch stops being protected. An environment allowing
"protected branches only" can block the very audit intended to detect that loss.

**How to apply:** Restrict the audit environment to the literal `main` branch,
without tag access or manual approvals. Treat a successful live audit and a
received failure notification as activation evidence, not offline test success.
