---
name: Session continuity
description: Unlimited collaboration duration, disconnect safety, and remaining restart limitations.
---

Collaboration rooms must not have an arbitrary elapsed-time limit.

**Why:** The user explicitly requested unlimited runtime after whole rooms
closed within minutes. Production evidence showed repeated artist signaling
departures around five minutes apart, not a configured room-duration cap.
The initiating disconnect cause was not conclusively identified.

**How to apply:** Keep signaling alive even when media is peer-to-peer and
signaling otherwise idle. Distinguish expired transport membership from an
ended room. Short reconnect grace must revoke input immediately and require
fresh capture validation/consent, not preserve an authorization grant.
Explicitly ending/leaving a room still stops control. Server restarts and
publishing currently lose in-memory signaling state; do not promise seamless
or uninterrupted sessions across those events.

Place desktop installer updates on the desktop download page, not the homepage.

**Why:** The user explicitly corrected the requested location.

**How to apply:** Keep per-platform versions and architecture labels accurate;
only link assets that actually exist in published releases.
