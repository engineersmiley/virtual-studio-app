// Browser getDisplayMedia IDs cannot be matched to Electron display IDs.
// Never guess from a label, resolution, scale, or display ordering.
function getDisplayControlState(screen, platform = process.platform) {
  const displays = screen.getAllDisplays();
  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.bounds;
  let reason = null;
  if (displays.length !== 1) {
    reason = 'Full remote control requires exactly one connected display. Disconnect extra displays and share your entire screen.';
  } else if (x !== 0 || y !== 0) {
    reason = 'Full remote control requires a display at desktop origin (0, 0).';
  } else if (platform !== 'darwin' && display.scaleFactor !== 1) {
    reason = 'Full remote control on Windows and Linux currently requires 100% display scaling.';
  }
  return {
    supported: reason === null,
    reason,
    signature: JSON.stringify(displays.map(d => ({
      id: d.id, bounds: d.bounds, scaleFactor: d.scaleFactor,
    })).sort((a, b) => String(a.id).localeCompare(String(b.id)))),
    width,
    height,
  };
}

function canControlCapture(message) {
  return message.captureSurface === 'monitor' &&
    typeof message.captureId === 'string' && message.captureId.length > 0;
}

module.exports = { getDisplayControlState, canControlCapture };
