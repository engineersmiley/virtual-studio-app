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
ended room. If the artist's capture proof changes or disappears, revoke input
immediately and require a fresh share and approval; never preserve consent
after capture loss. An engineer's signaling socket closing alone is different:
keep the existing room-level grant during the reconnect window while the
artist's capture proof remains valid. The disconnected engineer cannot send
input; revoke if they explicitly leave, fail to rejoin before the grace expires,
or the capture/Agent becomes invalid. An established socket should switch
promptly to the fallback transport so recovery completes within the departure
grace.

Prefer the desktop Agent's authenticated WebSocket for low-latency input, with
polling retained as recovery. Reconnect between completed polls so queued input
is not lost or duplicated. Coalesce or drop only stale cursor samples; preserve
clicks, keys, and the original approval and capture boundaries. A transport
change alone must not grant or revoke control.

**Why:** Production showed an engineer WebSocket closing while the Agent and
artist capture stayed connected; immediately sending `control-end` caused the
Agent to become inactive during polling fallback. Preserving the grant only
through transport recovery avoids that loss without keeping input active after
the artist's screen capture changes.
Repeated HTTP polling and queued cursor samples can add delay, while dropping
discrete actions or weakening grant boundaries would make control unreliable
or unsafe.
**How to apply:** Send Agent input on the ordered WebSocket while it is open.
Keep the existing polling fallback and enforce the same room, capture, and
engineer authorization checks on both transports.
Explicitly ending/leaving a room still stops control. Server restarts and
publishing currently lose in-memory signaling state; do not promise seamless
or uninterrupted sessions across those events.

Place desktop installer updates on the desktop download page, not the homepage.

**Why:** The user explicitly corrected the requested location.

**How to apply:** Keep per-platform versions and architecture labels accurate;
only link assets that actually exist in published releases.
