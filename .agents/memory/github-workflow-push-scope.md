---
name: GitHub workflow push permission
description: Permission requirements for publishing releases that change GitHub Actions workflows.
---

Pushing a tag whose commit changes `.github/workflows/*` can be rejected when the connected GitHub OAuth app lacks the `workflow` scope, even when ordinary tags can be pushed. Do not retry the same push; either obtain the required permission or use the existing workflow and match its generated asset names.

**Why:** The Git remote enforces GitHub's workflow-file authorization, and release tags carry the workflow snapshot that Actions executes.

**How to apply:** Before updating release workflows or tagging a commit that includes them, confirm the connected GitHub permission or build from a tag whose workflow files are unchanged.
