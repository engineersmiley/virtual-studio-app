---
name: Mixed signaling transports
description: Why browser transport differences must not partition a collaboration room.
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
