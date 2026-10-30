---
name: Required PR check
description: External GitHub merge protection and the required TypeScript status.
---

The GitHub repository's `main` branch requires the `PR TypeScript check` status from the GitHub Actions app, requires branches to be up to date, and applies protection to administrators.

**Why:** The user requires TypeScript failures to prevent merging, not merely to appear in optional release checks. These settings live in GitHub, not in the repository's workflow files.

**How to apply:** When renaming or replacing the PR check, update GitHub's required status as well. Preserve the GitHub Actions app restriction so a status from another source cannot satisfy it. Do not weaken protection to push changes; use a pull request containing the workflow.
