---
name: Electron app identity during rebrands
description: Preserve the installed app identity while changing user-facing Electron branding.
---

When rebranding the desktop agent, update user-facing labels and `productName`, but keep the Electron `appId` unchanged.

**Why:** Existing installations and update flows rely on the app identity; changing it can make the renamed app appear as a separate installation or break updates.

**How to apply:** Keep the existing `com.remotestudio.agent` identifiers when changing the visible brand to Virtual Studio.
