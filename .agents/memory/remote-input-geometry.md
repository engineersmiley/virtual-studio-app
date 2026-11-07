---
name: Remote input geometry
description: Why absolute video input and pointer-locked relative motion use different policies.
---

Absolute movement and clicks must map to the same remote location, including at video edges and inside letterbox bars. Do not reintroduce fullscreen-only edge acceleration for absolute input.

**Why:** Edge acceleration can move the remote cursor away from the location where the next click lands. Pointer-locked input is a separate relative-motion interaction, where sensitivity and edge overreach remain intentional.

**How to apply:** Reuse the shared object-contain mapping for absolute input and read the video element's current bounds and intrinsic dimensions per event. Preserve relative pointer-lock behavior unless explicitly changing that interaction.

Keep agent screen dimensions in Electron's logical coordinate space. Treat display scale as metadata, not an additional coordinate multiplier, when refreshing display geometry.

**Why:** The existing agent input contract uses logical desktop coordinates; multiplying refreshed dimensions by the Retina/display scale would apply scaling twice.

**How to apply:** Preserve this coordinate contract across display-change publication and browser mapping. Any future native-input coordinate conversion must be verified separately on the supported operating systems.
