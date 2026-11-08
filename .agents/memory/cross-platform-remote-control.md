---
name: Cross-platform remote control
description: Keep mouse and keyboard control responsive and consistent in both Mac-to-Windows and Windows-to-Mac sessions.
---

Remote mouse and keyboard control must work responsively in either direction between Mac and Windows; do not optimize only one artist/engineer operating-system combination.

**Why:** The user wants mouse movement to feel smooth whichever computer is controlling the other.

**How to apply:** Verify Mac-to-Windows and Windows-to-Mac paths for pointer movement and clicks, and apply shared input timing/protocol improvements to both Agent builds.

Keep the screen-share capture rate stable at 30 fps; mouse input has its own low-latency path and does not need 60 fps video.

**Why:** A recent 60 fps capture change was followed by a report of a black remote screen. Production signaling continued, but telemetry cannot confirm media-frame health; higher capture load is an avoidable cross-platform risk.

**How to apply:** Cap capture at 30 fps for both Mac and Windows, avoid changing track constraints mid-share, and optimize pointer message timing independently.
