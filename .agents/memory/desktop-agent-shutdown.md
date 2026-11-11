---
name: Desktop Agent shutdown
description: Distinguish closing the Agent window from fully quitting its background process.
---

Keep window-close-to-tray distinct from a visible, complete Quit action. Full exit must stop background polling, reconnect timers, the WebSocket, screen monitoring, and keep-alive network connections.

**Why:** The user had to force-quit the Mac Agent repeatedly; a hidden tray process looked stuck, and quit paths did not consistently stop background resources.

**How to apply:** Preserve close-to-tray behavior, make the full Quit action obvious in the Agent window and tray menu, and route all quit paths through one idempotent cleanup flow.
