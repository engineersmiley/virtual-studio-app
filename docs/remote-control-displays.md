# Supported screen sharing for full remote control

## Current safety boundary

Screen viewing and audio sharing continue to work with secondary monitors, windows,
and tabs. **Full desktop input is deliberately restricted**, not automatically
matched to the artist's chosen monitor:

- Exactly one display must be connected, including virtual/mirrored displays
  reported separately by Electron.
- The browser must positively report a live, unmuted `monitor` capture. Window,
  tab, audio-only, and browsers without `displaySurface` information are view-only.
- The display must start at desktop origin `(0, 0)`.
- macOS uses Electron logical coordinates, including Retina displays.
- On Windows and Linux, scaled control is available only when the Agent can
  verify that native input dimensions match either logical pixels or the
  reported scale factor. The Agent maps pointer coordinates using those measured
  dimensions; it does not infer them from the video.
- Scaled sessions start in a **pointer-only alignment test**. The artist must
  check cursor placement on their computer and click **Enable Mouse & Keyboard**
  in the Agent before clicks, scrolling, or keyboard input are accepted.
- Use an updated desktop agent. Older agents do not report the supported-display
  capability and cannot receive full control commands from the updated server.

The browser picker does not expose an Electron-compatible display ID. Display
names, video resolution, primary-display ordering, and matching aspect ratios are
not proof of identity. In particular, two monitors can have identical dimensions
but different origins or scaling. An "I selected the primary monitor" checkbox
would not enforce this boundary.

## Changes during control

Connecting another monitor immediately revokes local agent permission, before
waiting for a network request. Removal, primary-display changes, resolution, and
scale changes cannot silently move an existing approval to a new layout. After
returning to a supported configuration, request approval again.

Stopping, muting, replacing, or changing the artist's capture to a window/tab
revokes server permission. A resumed/replaced capture has a distinct control
identity. Out-of-order HTTP capture updates are ignored. Engineers cannot choose
the artist's capture identity in a command. An approval arriving after its capture
stopped cannot authorize the new share.

## Verification

Run `npm test` (including `agent-screen-info.test.mjs` and
`display-control.test.mjs`). Tests execute the real agent input handler and server
forwarding callbacks with simulated Electron display inventories for `darwin`,
`win32`, and `linux`. They cover:

- Adding/selecting a second display with identical dimensions, mixed scales,
  origins left of or above the primary, and changing which display is primary.
- Removing a second display, replacing a display, and requiring renewed approval.
- Clamping single-display input within the logical desktop.
- Mapping scaled Windows pointer coordinates and rejecting inconsistent native
  dimensions.
- Blocking clicks and keys in both the server and Agent until the artist
  confirms the alignment test.
- Display/capture changes while the native approval dialog is pending.
- Window/tab/unidentified capture rejection, track replacement, stale HTTP
  updates, artist binding, both signaling transports, and late approvals.

These are automated simulations, **not physical Windows/macOS/Linux hardware
certification**. This workspace cannot operate native multi-monitor desktops.
Before using scaled control on a real Windows computer:

1. Keep one display connected and share the entire screen at the desired scale.
2. Request control and approve **Allow Cursor Test** on the artist's computer.
3. Move the engineer's pointer to the center and all four corners. Compare the
   visible pointer position on the artist's screen.
4. If any position is wrong, click **Stop Remote Control** and do not unlock
   clicks or keyboard. If every position matches, the artist can click
   **Enable Mouse & Keyboard** in the Agent.
5. Confirm the artist can stop control at any time. Adding, removing, or
   changing a display must revoke the grant and require a new request.

Until this physical check succeeds, keep using view-only sharing or 100% scale.
