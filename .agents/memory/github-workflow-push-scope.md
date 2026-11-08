---
name: GitHub workflow push permission
description: Permission requirements for publishing releases that change GitHub Actions workflows.
---

Pushing a commit that changes `.github/workflows/*` requires GitHub workflow-file permission. Starting `workflow_dispatch` is a separate permission check and can require Actions write access even when a fine-grained token can push repository contents and workflow files.

**Why:** A release can successfully publish a branch or tag while the same token is still unable to start a workflow through the Actions API.

**How to apply:** Check the token's workflow-file and Actions permissions separately. If Actions dispatch is unavailable, use GitHub's Actions UI or, after explicit release approval, push the version tag that runs the existing tag-triggered workflow.

Replit shells may rewrite `https://github.com/` URLs to `https://github.replit.internal/`, which can cause a PAT-authenticated push to use the Replit OAuth credential instead. For a PAT push, disable the system/global rewrite for that invocation and supply an ephemeral HTTP authorization header; never store the token in a remote URL or Git config.

**Why:** The shell's Git proxy rewrite can silently route a direct GitHub URL through the wrong credential provider, reproducing the same workflow-scope rejection.

**How to apply:** Check `git config --show-origin --get-regexp '^url\\..*\\.insteadof$'`; for a PAT push, use `GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null` and a one-command `http.extraheader`.
