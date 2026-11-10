---
name: Touch compatibility clicks
description: Browser targeting behavior that matters when suppressing remote clicks after touch gestures.
---

Suppress touch-generated compatibility clicks at every ancestor that can send remote clicks, not only at the touched video.

**Why:** When a touch starts on the video and finishes over its surrounding container, the browser can target the follow-up click at their common ancestor. The video's click handler never sees that event, so its suppression and propagation guard cannot protect the container.

**How to apply:** When changing remote touch recognition, exercise post-gesture clicks targeted directly at the container as well as the video. Confirm intentional desktop clicks still work outside the short suppression window.

Browser gesture tests must verify the hit target, not just the number of remote commands.

**Why:** A tap on the audio-enable overlay can bubble into the remote-click container and produce a convincing one-click result even though no video touch handler ran. This caused a false-positive during browser coverage development.

**How to apply:** Dismiss overlapping controls through the UI and assert the touch actually lands on the video before relying on command counts. Native default prevention may suppress compatibility events entirely; exercise genuine browser compatibility events at an ancestor separately rather than injecting synthetic DOM clicks.

Touch tap recognition must tolerate small finger drift while still rejecting clear drags.

**Why:** A phone tap can move enough to be treated as a drag, sending pointer movement without the click the user intended.

**How to apply:** Keep the tap movement threshold forgiving, and test both small-drift taps and drags that travel away and return before release.
