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
- Windows and Linux require 100% scaling until their native input conversion is
  separately verified. This intentionally avoids guessing physical coordinates.
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
- Display/capture changes while the native approval dialog is pending.
- Window/tab/unidentified capture rejection, track replacement, stale HTTP
  updates, artist binding, both signaling transports, and late approvals.

These are automated simulations, **not physical Windows/macOS/Linux hardware
certification**. This workspace cannot operate native multi-monitor desktops.
For native release checks on each target OS:

1. With one display at supported scaling, share the entire screen, approve
   control, and check corners and center against the visible cursor.
2. Connect a second display (try mixed scaling and negative origins). Confirm
   active control stops and no new request is enabled. Viewing either display
   should still work.
3. Switch the shared display and primary display while both are connected.
   Both configurations must remain view-only.
4. Remove the extra display. Restore `(0, 0)`/supported scaling, share the
   remaining screen, and confirm a fresh approval is required.
5. Try a window, tab, audio-only share, and stopping sharing during the approval
   dialog. No desktop input should be delivered.

Do not remove the restrictions based only on resolution-matching tests.
