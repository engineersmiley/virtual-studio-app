---
name: Display capture identity
description: Why full desktop input is restricted instead of guessing which browser-selected monitor is shared.
---

Do not infer browser capture identity from resolution, display labels, aspect ratio,
or a user confirmation checkbox. Full remote control currently uses the explicit
single-display/entire-screen restriction permitted by the product task.

**Why:** Standard browser screen capture does not expose a reliable Electron display
ID. Equal-sized monitors, mixed scales, and negative desktop origins make guessing
unsafe. Physical Windows/Linux high-DPI input conversion has not been verified;
100% scaling is the supported boundary there. Simulated platform tests are not
native hardware certification.

**How to apply:** Preserve fail-closed capture identity and topology revocation until
a reliable artist-to-agent display pairing flow and native coordinate verification
replace the restriction. Viewing secondary displays must remain available.

Capture eligibility reporting must follow the joined signaling session, not WebRTC
peer connectivity.

**Why:** WebRTC video can keep flowing after a WebSocket failure while signaling
reconnects through HTTP polling. Treating peer connectivity as signaling readiness
can leave an active full-screen share unreported.

**How to apply:** Re-publish the current live capture state after each successful
signaling join or rejoin. Keep explicit monitor identification and topology checks
fail-closed.
