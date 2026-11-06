---
name: Desktop release inspection
description: Native installer audit pitfalls with the workspace archive tooling.
---

Do not infer a DMG's architecture or app contents from an unqualified archive
listing in this workspace.

**Why:** The installed archive utility misidentified a DMG as an embedded
universal Mach-O stub. Forcing the DMG container type exposed an APFS payload,
but this utility could not read APFS. That misleading listing was not evidence
that the installer lacked its app or contained the wrong architecture.

**How to apply:** Audit the native build architecture and packaged app
independently with APFS-capable tooling. A raw image's Mach-O header counts can
corroborate architecture but do not identify the app's exact main executable.
Verify the packaged version and actual input code, not just an installer filename.
