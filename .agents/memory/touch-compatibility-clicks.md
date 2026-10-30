---
name: Touch compatibility clicks
description: Browser targeting behavior that matters when suppressing remote clicks after touch gestures.
---

Suppress touch-generated compatibility clicks at every ancestor that can send remote clicks, not only at the touched video.

**Why:** When a touch starts on the video and finishes over its surrounding container, the browser can target the follow-up click at their common ancestor. The video's click handler never sees that event, so its suppression and propagation guard cannot protect the container.

**How to apply:** When changing remote touch recognition, exercise post-gesture clicks targeted directly at the container as well as the video. Confirm intentional desktop clicks still work outside the short suppression window.
