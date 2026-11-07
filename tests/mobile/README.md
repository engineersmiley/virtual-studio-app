# Mobile remote-video browser regression

Run:

```sh
npx playwright install --with-deps chromium
npm run test:mobile
```

On Replit, the preinstalled browser can be used without downloading another:

```sh
MOBILE_CHROMIUM_PATH=/repl/tools/bin/chromium npm run test:mobile
```

The required PR job installs Chromium and runs this suite. Missing browsers,
server startup errors, and failed assertions fail the job; no desktop agent,
database, subscription, camera, microphone, or credentials are needed.

The isolated Vite server renders the **actual Session page and production CSS**.
Only the WebRTC hook and unused recording-upload hook are replaced at test-server
resolution time. A canvas supplies a real 1920×1080 MediaStream; remote commands
are recorded in memory with the normal 50ms click delay. The fixture is not a
production route and is not included in the app build. It does not test the
transport's authorization/lifetime implementation, which has separate unit tests.

Playwright's mobile Chromium context and CDP touch input produce trusted
TouchLists, cancellation, and compatibility mouse events. No test constructs
DOM TouchEvents/MouseEvents or calls handlers directly. The suite checks:

- Inline and the real mobile CSS fullscreen overlay: one click per tap,
  return-to-origin drag rejection, second-finger rejection after a finger lifts,
  native cancellation followed by a successful fresh tap.
- Browser default prevention: video taps do not generate compatibility clicks.
- Browser-generated compatibility clicks that bubble into the inline container
  remain suppressed after a video gesture. This case exposes extra blank
  container space by adjusting only its bottom padding, then verifies trusted
  mouse event order and that the same container path works after suppression.
- Authorized drags send movement without scrolling, zooming, or browser
  cancellation; a non-authorized viewer can still scroll normally.

The real audio prompt is dismissed before testing, with a hit-target assertion
to ensure touches reach the video rather than an overlay. Fullscreen is entered
through a browser click to isolate the video gestures from the toggle's own
touch behavior. Distinct compositor frames prevent move coalescing from erasing
an away-and-back drag.

Traces and failure screenshots go into ignored `generated-artifacts/mobile-touch`.
This is Chromium mobile emulation, not physical Android or iOS/Safari coverage;
the CDP multi-touch/cancel driver is Chromium-specific.
