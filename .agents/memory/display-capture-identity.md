---
name: Display capture identity
description: Why full desktop input is restricted instead of guessing which browser-selected monitor is shared.
---

Do not infer browser capture identity from resolution, display labels, aspect ratio,
or a user confirmation checkbox. Full remote control currently uses the explicit
single-display/entire-screen restriction permitted by the product task.

**Why:** Standard browser screen capture does not expose a reliable Electron display
ID. Equal-sized monitors, mixed scales, and negative desktop origins make guessing
unsafe. Scaled Windows/Linux input requires a native-dimension cross-check and
an artist-approved cursor-only alignment stage before clicks or keys are enabled.
Simulated platform tests are not native hardware certification.

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

Ship required Agent capability changes with an actually available installer, not
only website changes or a locally updated download URL.

**Why:** A connected older Agent can still stream video but lack the capability
fields required by the website, leaving Control permanently disabled. Republishing
the website cannot upgrade the desktop process running on the artist's machine.

**How to apply:** Check the public release assets and the released Agent's protocol,
not just the workspace version. Explain separately when the website must be
republished and when the artist must quit, install, and reopen the Agent.

Do not treat missing display-capability confirmation as proof that the user
failed to install or restart the Agent.

**Why:** The user has repeatedly confirmed completing installation, full restart,
and entire-screen sharing while Mac-to-Windows control remained unavailable.
The server normalizes absent capability fields to false, so its stored state
alone cannot distinguish an older binary from another reporting failure.

**How to apply:** After the user confirms those steps, investigate the live
capability payload and identify the running Windows executable version before
prescribing another reinstall or setup cycle.

Verify report freshness and packaged source, not only the displayed version.

**Why:** A current Windows executable and an inspected official installer can
coexist with incomplete compatibility data retained by the live server. A
connection indicator does not establish that a fresh display report arrived.
That evidence also does not establish why remote video is black.

**How to apply:** Keep compatibility recovery tied to ongoing Agent liveness,
with ordered reports and no automatic control grant. Inspect the downloaded
installer's packaged application when release identity is in doubt. Diagnose
frame delivery separately from mouse/keyboard authorization.
