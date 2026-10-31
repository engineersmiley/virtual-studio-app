---
name: GitHub workflow push permission
description: Permission requirements for publishing releases that change GitHub Actions workflows.
---

Pushing a tag whose commit changes `.github/workflows/*` can be rejected when the connected GitHub OAuth app lacks the `workflow` scope, even when ordinary tags can be pushed. Do not retry the same push; either obtain the required permission or use the existing workflow and match its generated asset names.

**Why:** The Git remote enforces GitHub's workflow-file authorization, and release tags carry the workflow snapshot that Actions executes.

**How to apply:** Before updating release workflows or tagging a commit that includes them, confirm the connected GitHub permission or build from a tag whose workflow files are unchanged.

Replit shells may rewrite `https://github.com/` URLs to `https://github.replit.internal/`, which can cause a PAT-authenticated push to use the Replit OAuth credential instead. For a PAT push, disable the system/global rewrite for that invocation and supply an ephemeral HTTP authorization header; never store the token in a remote URL or Git config.

**Why:** The shell's Git proxy rewrite can silently route a direct GitHub URL through the wrong credential provider, reproducing the same workflow-scope rejection.

**How to apply:** Check `git config --show-origin --get-regexp '^url\\..*\\.insteadof$'`; for a PAT push, use `GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null` and a one-command `http.extraheader`.
