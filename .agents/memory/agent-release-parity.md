---
name: Agent release parity
description: Keep Windows and Mac Agent version numbers aligned across download releases.
---

Keep Windows and macOS Agent release numbers in lockstep, including Intel and Apple Silicon Mac builds. Do not advertise a shared version until each platform's installer is available.

**Why:** The user explicitly wants both computers to receive the same update so remote control works in either direction without managing different versions.

**How to apply:** Release Windows and Mac installers under the same numbered version, verify each download URL points to that release's actual asset, and publish the download-page version only after the required assets exist.
