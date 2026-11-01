// Electron reports logical display dimensions, matching the agent's input coordinates.
// Keep scaleFactor as metadata; multiplying by it would double-scale Retina input.
const { getDisplayControlState } = require('./display-control');

function monitorScreenInfo({
  screen, publish, onError, onChange = () => {}, retryMs = 2000,
  getControlState = () => getDisplayControlState(screen),
}) {
  let stopped = false;
  let running = false;
  let lastPublished = null;
  let retryTimer = null;
  const controller = new AbortController();
  const events = ['display-metrics-changed', 'display-added', 'display-removed'];

  async function refresh() {
    if (stopped || running) return;
    clearTimeout(retryTimer);
    retryTimer = null;
    running = true;
    try {
      // Serialize requests so a slow, older update cannot overwrite a newer one.
      // Re-read after each request to catch changes that happened while it ran.
      while (!stopped) {
        const display = screen.getPrimaryDisplay();
        const control = getControlState();
        const info = {
          screenWidth: control.width,
          screenHeight: control.height,
          scaleFactor: display.scaleFactor,
          displayControlSupported: control.supported,
          displayControlReason: control.reason,
          controlCalibrationRequired: control.calibrationRequired,
        };
        const signature = JSON.stringify({ topology: control.signature, ...info });
        if (signature === lastPublished) break;
        onChange(control);
        const response = await publish(info, controller.signal);
        if (!response.ok) throw new Error(`Screen info request failed (${response.status})`);
        lastPublished = signature;
      }
    } catch (error) {
      if (!stopped) {
        onError(error);
        // A failed update must not require another display event to be retried.
        retryTimer = setTimeout(refresh, retryMs);
      }
    } finally {
      running = false;
    }
  }

  const changed = () => {
    // Revoke locally before any network request, even while publication is busy.
    onChange(getControlState());
    void refresh();
  };
  for (const event of events) screen.on(event, changed);
  void refresh();

  return () => {
    stopped = true;
    clearTimeout(retryTimer);
    controller.abort();
    for (const event of events) screen.removeListener(event, changed);
  };
}

module.exports = { monitorScreenInfo };
