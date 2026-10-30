---
name: Portable npm lockfiles
description: Keep package-manager-generated lockfiles usable outside the workspace registry proxy.
---

Registry-proxy installations can serialize internal tarball addresses into lockfiles. Normalize those addresses to their public npm equivalents while preserving exact versions and integrity hashes.

**Why:** The package installation callback regenerated a lockfile with private registry URLs that external CI could not use. Omitting registry URLs was not sufficient: regeneration from an installed tree also lost integrity metadata and required registry metadata during offline installation.

**How to apply:** After dependency updates, verify lockfile integrity fields and public registry addresses. Use the project's lockfile normalization command if install scripts were skipped. Check a clean offline install using the public registry configuration and cached tarballs; do not disable the workspace package firewall.
