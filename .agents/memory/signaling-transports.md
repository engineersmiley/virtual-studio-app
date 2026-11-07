---
name: Signaling connection reliability
description: Mixed transports, upgrade ownership, and retry health checks for collaboration rooms.
---

Treat WebSocket and HTTP-polling participants as one logical room.

**Why:** In a real Mac/Windows collaboration, the artist can report active
broadcasting while the engineer receives no stream and the browsers show
different participant counts. Transport-specific membership and signaling
delivery can cause this even when both users entered the correct room.
An operating-system-specific symptom is not proof of an OS input-permission
failure.

**How to apply:** Verify presence, late joins, offers, answers, ICE candidates,
departure, and timeout across all sender/receiver transport combinations.
Deduplicate presence during handoff, preserve an artist still connected through
the other transport, and never broadcast a targeted signal just because its
recipient is absent from one transport.

Assign one HTTP-upgrade owner to the application's WebSocket paths.

**Why:** Independently attaching multiple path-filtered WebSocket servers to the
same HTTP server can make one send an HTTP error after another sent the upgrade
response. A real two-browser reproduction showed invalid WebSocket frames and
no incoming video even though local capture was active.

**How to apply:** Dispatch owned paths explicitly to servers that do not attach
their own competing upgrade listeners. Do not reject unrelated upgrade paths,
including development HMR. Verify actual frame exchange, not just the open event.

A socket opening is not evidence of a healthy joined session.

**Why:** Resetting retries on every open let repeated open/fail cycles stay at
the first retry indefinitely, so HTTP fallback never ran in the browser test.

**How to apply:** Bound room-join waits, count error/close as one failure, and
reset the retry budget only after a stable joined connection. Keep local screen
capture status distinct from confirmed peer connectivity.
